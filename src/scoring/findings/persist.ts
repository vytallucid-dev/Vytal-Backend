// File: src/scoring/findings/persist.ts
//
// THE findings write contract. Writes a member's FiredFinding[] linked to ITS snapshot:
//   red_flag → score_red_flags   (mirrors composite/persist.ts toR1RedFlagRow)
//   pattern  → score_patterns    (the previously-empty table; tri-state + magnitude)
//
// APPEND-ONLY / VERSIONS-WITH-THE-SNAPSHOT: findings FK the snapshotId. A rescore creates
// a NEW snapshot (new version) and a fresh fired set linked to it; the prior set stays on
// the now-superseded snapshot. The read layer reads the head snapshot, so it sees only the
// current fired set. No supersede bookkeeping is needed here — the snapshot chain carries it.
//
// IDEMPOTENT within a snapshot: a re-run that re-emits the same (snapshotId, key) skips the
// duplicate (so calling twice for one created snapshot is safe). R1 keeps its own dedicated
// write in score-pass.ts — this path handles the NEW rules (R6 here; the rest in later stages).
//
// Runs on a passed Prisma.TransactionClient so the caller owns the transaction (the Stage-4
// proof writes then ROLLS BACK; the live path will commit per-member with the snapshot).

import type { Prisma } from "../../generated/prisma/client.js";
import type { FiredFinding } from "./types.js";
import type { NotCoveredId } from "../../catalogue/not-covered.js";

type Db = Prisma.TransactionClient;

export interface PersistFindingsResult {
  redFlags: number;
  patterns: number;
  skippedExisting: number;
}

export async function persistFindings(
  db: Db,
  snapshotId: string,
  symbol: string,
  asOfDate: Date,
  findings: FiredFinding[],
): Promise<PersistFindingsResult> {
  let redFlags = 0, patterns = 0, skippedExisting = 0;

  for (const f of findings) {
    if (f.kind === "red_flag") {
      // ★ UNREACHABLE, AND LOUD RATHER THAN SILENT — 2026-08-11, when score_red_flags was dropped.
      //
      // This branch used to write that table. It cannot fire: all six red-flag rules (R1…R6) live in
      // FILING_RULES (findings/engine.ts), `runFindings` defaults to SCORING_RULES, and the scoring
      // pass registers no red-flag rule at all — so no `kind: "red_flag"` finding can reach here. The
      // filing pass writes its own rows through filing/pass.ts and never comes through this function.
      //
      // Throwing rather than skipping is deliberate. A silent `continue` would turn "a red-flag rule
      // was somehow registered in the scoring pass" into a finding that evaluates, counts toward a
      // score and then vanishes with no record — which is the failure mode that is hardest to notice
      // and hardest to reconstruct afterwards.
      throw new Error(
        `[persistFindings] red-flag finding "${f.key}" reached the scoring persist path (${symbol}). ` +
          `score_red_flags no longer exists and every red-flag rule is a FILING rule — a rule has been ` +
          `registered in SCORING_RULES that belongs in FILING_RULES. See findings/engine.ts.`,
      );
    } else {
      const exists = await db.scorePattern.findFirst({ where: { snapshotId, patternKey: f.key }, select: { id: true } });
      if (exists) { skippedExisting++; continue; }
      await db.scorePattern.create({
        data: {
          snapshotId,
          symbol,
          asOfDate,
          patternKey: f.key,
          direction: f.direction ?? null,
          severity: f.severity ?? null,
          displayState: f.displayState ?? "active",
          magnitude: f.magnitude ?? null,
          evidence: f.evidence as object,
        },
      });
      patterns++;
    }
  }

  return { redFlags, patterns, skippedExisting };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// NOT-COVERED PERSISTENCE — a DELIBERATELY SEPARATE write, never routed through `persistFindings`
// above and never built from a `FiredFinding`. See catalogue/not-covered.ts's header for why this
// exists at all: a not-covered configuration is measured once per period, and discarding the firing
// discards the only data that could ever overturn the exclusion.
//
// ── ★ WHY NOT persistFindings + a widened FiredFindingKey ────────────────────────────────────────
// `FiredFinding.severity` is a required field with no natural not-covered value, and a
// `notcovered_${NotCoveredId}` key does not belong in `FiredFindingKey` — that union is "what a RULE
// may emit", and no rule emits these; score-pass.ts builds them directly from the not-covered match
// engine. A dedicated write keeps that boundary a type-level fact rather than a convention: there is
// no path through which a `FireRule` could produce one of these rows.
//
// severity / direction / magnitude are written NULL — not omitted, NULL — because the column exists
// on score_patterns and a real finding writes it; leaving it out would look like an oversight rather
// than the deliberate absence it is. displayState is the literal string "tested_not_shipped", so a row
// is self-describing even to someone reading the table directly, never "active" (which would claim
// this is a live reading).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface NotCoveredWriteRow {
  id: NotCoveredId;
  /** `notcovered_NC1` … `notcovered_NC10` — from catalogue/not-covered.ts's `notCoveredPatternKey`. */
  patternKey: string;
  /** Pillar values at fire time, the triggering gap/crossing's raw numbers, the period, and the
   *  regime-at-fire stamp (best-effort — absent if the regime lookup failed; see score-pass.ts). */
  evidence: Record<string, unknown>;
}

export interface PersistNotCoveredResult {
  written: number;
  skippedExisting: number;
}

/** IDEMPOTENT, same convention as persistFindings: a re-run that re-emits (snapshotId, patternKey)
 *  skips the duplicate. */
export async function persistNotCovered(
  db: Db,
  snapshotId: string,
  symbol: string,
  asOfDate: Date,
  rows: NotCoveredWriteRow[],
): Promise<PersistNotCoveredResult> {
  let written = 0, skippedExisting = 0;

  for (const r of rows) {
    const exists = await db.scorePattern.findFirst({ where: { snapshotId, patternKey: r.patternKey }, select: { id: true } });
    if (exists) { skippedExisting++; continue; }
    await db.scorePattern.create({
      data: {
        snapshotId,
        symbol,
        asOfDate,
        patternKey: r.patternKey,
        direction: null,
        severity: null,
        displayState: "tested_not_shipped",
        magnitude: null,
        evidence: r.evidence as object,
      },
    });
    written++;
  }

  return { written, skippedExisting };
}
