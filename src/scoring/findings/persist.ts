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
      const exists = await db.redFlag.findFirst({ where: { snapshotId, flagKey: f.key }, select: { id: true } });
      if (exists) { skippedExisting++; continue; }
      await db.redFlag.create({
        data: {
          snapshotId,
          symbol,
          asOfDate,
          flagKey: f.key,
          severity: f.severity,
          tier: "auto",
          triggeringValues: f.evidence as object,
          guardrailEventId: null,
        },
      });
      redFlags++;
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
          metricRefs: (f.metricRefs ?? undefined) as object | undefined,
        },
      });
      patterns++;
    }
  }

  return { redFlags, patterns, skippedExisting };
}
