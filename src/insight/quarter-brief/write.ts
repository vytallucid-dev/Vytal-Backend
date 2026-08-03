// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — GENERATE-OR-SKIP, AND THE ONLY WRITER OF quarter_briefs.
//
// ── ★ THE RE-INGESTION PROBLEM THIS EXISTS TO SOLVE (4b-1) ──────────────────────────────────────────
// Re-ingestion is ROUTINE, and today it rewrites rows that did not change. `decideIngest` decides to
// rewrite on filingDate ALONE, and the ingesters blind-overwrite (`create: data, update: data`), so a
// re-filing carrying identical numbers still writes the row. This is measured, in this repo, in
// scan.ts's own header: rows rewritten ~19× each, and 158 of 168 resulting rescores (94%) moved no
// score at all.
//
// A trigger that regenerated on "a row was written" would therefore rewrite prose readers have already
// seen, 504 times, on every universe scan — an AI bill and a churn of text for no change in meaning.
// The scoring layer already solved its own version of this with `scoreRelevantChanged` (a per-column
// manifest of what the scorer reads). This is the same idea with a sharper instrument.
//
// ── WHY factsFingerprint AND NOT A COLUMN MANIFEST ─────────────────────────────────────────────────
// A manifest asks "did a column the brief reads move?". The fingerprint asks the question that
// actually matters: "would the model be handed different words?" It hashes the EXACT fact text — which
// already includes every derived comparison, every rounded display string and every gap sentence — so
// two ingests that produce byte-identical facts are provably a no-op, and a change anywhere in the
// rendering pipeline (a new gap, a suppressed margin, a re-worded finding) correctly counts as one.
// It cannot drift from what the model sees, because it IS what the model sees.
//
// ⚠ THE SKIP IS CHEAP AND MUST STAY CHEAP: build the block, render, hash, compare. No AI call is made
// on a no-op. The fact-block build is a handful of indexed reads; an AI call is a rate-limited second.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { buildQuarterBriefFactBlock } from "./fact-block.js";
import { renderFactText } from "./prompt.js";
import { generateQuarterBrief, type RefusalReason } from "./generate.js";
import { VERDICT_NONE } from "./verdict.js";

export const fingerprintOf = (factText: string): string =>
  createHash("sha256").update(factText).digest("hex").slice(0, 32);

export type WriteOutcome =
  | { kind: "written"; symbol: string; periodKey: string; verdictKey: string | null }
  | { kind: "skipped_unchanged"; symbol: string; periodKey: string }
  | { kind: "restored_unchanged"; symbol: string; periodKey: string }
  | { kind: "no_facts"; symbol: string }
  | { kind: "refused"; symbol: string; periodKey: string; reason: RefusalReason; detail: string };

export interface WriteOpts {
  /** Regenerate even when the fingerprint matches. For an operator-driven refresh, never for a scan. */
  force?: boolean;
}

/**
 * Generate and store ONE brief, or skip it because nothing the reader would see has changed.
 *
 * THE ONLY writer of quarter_briefs. A refusal writes NOTHING — the row is left as it was (absent, or
 * whatever previously passed the guards), because a brief is whole or it does not exist.
 */
export async function writeQuarterBrief(
  symbol: string,
  periodKey?: string,
  opts: WriteOpts = {},
): Promise<WriteOutcome> {
  const block = await buildQuarterBriefFactBlock(symbol, periodKey);
  if (!block) return { kind: "no_facts", symbol };

  const { stockId, quarter, fiscalYear, resultType } = {
    stockId: (await prisma.stock.findUnique({ where: { symbol }, select: { id: true } }))!.id,
    quarter: block.identity.quarter,
    fiscalYear: block.identity.fiscalYear,
    resultType: block.identity.basis,
  };

  const facts = renderFactText(block);
  const fingerprint = fingerprintOf(facts);

  const existing = await prisma.quarterBrief.findUnique({
    where: { stockId_quarter_fiscalYear_resultType: { stockId, quarter, fiscalYear, resultType } },
    select: { factsFingerprint: true, status: true },
  });

  // ★ THE NO-OP. A live row whose facts hash identically would produce the same brief — nothing to
  // say and nothing to pay for.
  if (!opts.force && existing && existing.status === "live" && existing.factsFingerprint === fingerprint) {
    return { kind: "skipped_unchanged", symbol, periodKey: block.identity.periodKey };
  }

  // ★ RESTORE WITHOUT REGENERATING. A stale row whose fingerprint is UNCHANGED was marked stale by a
  // correction that did not touch any fact THIS brief states. The prose is still exactly right, so
  // paying for an identical regeneration would be waste — and it is not rare waste: markBriefsStale
  // deliberately marks every LATER period too, and most of those read facts the edit never moved.
  // The row earns `live` back on evidence (a matching hash), not on assumption.
  if (!opts.force && existing && existing.status === "stale" && existing.factsFingerprint === fingerprint) {
    await prisma.quarterBrief.update({
      where: { stockId_quarter_fiscalYear_resultType: { stockId, quarter, fiscalYear, resultType } },
      data: { status: "live", staleReason: null, staleAt: null },
    });
    return { kind: "restored_unchanged", symbol, periodKey: block.identity.periodKey };
  }

  const res = await generateQuarterBrief(block);
  if (!res.ok) {
    return { kind: "refused", symbol, periodKey: block.identity.periodKey, reason: res.reason, detail: res.detail };
  }

  const data = {
    content: res.text,
    // The sentinel, not a literal — see verdict.ts's note. Read back through `readVerdict`.
    verdictKey: block.verdict?.key ?? VERDICT_NONE,
    verdictLabel: block.verdict?.label ?? "",
    scoredAsOf: block.healthMovement ? new Date(block.healthMovement.scoredAsOf) : null,
    status: "live" as const,
    staleReason: null,
    staleAt: null,
    factsFingerprint: fingerprint,
    model: res.model,
    promptTokens: res.promptTokens,
    outputTokens: res.outputTokens,
  };

  await prisma.quarterBrief.upsert({
    where: { stockId_quarter_fiscalYear_resultType: { stockId, quarter, fiscalYear, resultType } },
    create: { stockId, quarter, fiscalYear, resultType, ...data },
    update: data, // overwritten in place — one row per quarter, and a regeneration clears staleness
  });

  return { kind: "written", symbol, periodKey: block.identity.periodKey, verdictKey: block.verdict?.key ?? null };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// INVALIDATION (4c) — called from applyRawFieldEdit's cascade dispatch.
//
// Marks the edited period AND EVERY LATER ONE stale. Later periods matter because a brief's facts are
// comparative: correcting FY26Q2's revenue changes FY26Q3's "against the previous quarter" and
// FY27Q2's "against the same quarter last year". A correction ripples forward through exactly the
// sentences a reader would check.
//
// ⚠ THIS HIDES, IT DOES NOT DELETE. Both read paths filter to `live`, so a stale row renders as ABSENT
// on the detail page and the feed. The row survives so a regeneration can overwrite it and so the
// operator can see what was withdrawn and why — a silently deleted brief is unauditable.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export async function markBriefsStale(
  stockId: string,
  fromFiscalYear: string,
  fromQuarter: string,
  reason: string,
): Promise<number> {
  // Period order is lexical on (fiscalYear, quarter) because both are zero-padded fixed-width strings
  // ("FY26","Q1") — so string comparison IS chronological order here. Stated because it is only true
  // for this encoding, and a future FY-format change would silently break the ripple.
  const rows = await prisma.quarterBrief.findMany({
    where: { stockId, status: "live" },
    select: { id: true, fiscalYear: true, quarter: true },
  });
  const affected = rows
    .filter((r) => `${r.fiscalYear}${r.quarter}` >= `${fromFiscalYear}${fromQuarter}`)
    .map((r) => r.id);
  if (affected.length === 0) return 0;

  await prisma.quarterBrief.updateMany({
    where: { id: { in: affected } },
    data: { status: "stale", staleReason: reason, staleAt: new Date() },
  });
  return affected.length;
}
