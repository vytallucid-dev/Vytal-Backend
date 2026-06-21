// ─────────────────────────────────────────────────────────────
// PG_RESCORE HANDLER
//
// Recompute ONE peer group's Health Scores end-to-end and persist the result,
// append-only + idempotent. Enqueued by the scoring-trigger layer (Stage 3) after an
// ingestion lands new data, or manually (admin / proof). Mirrors the committed-score
// pattern (scripts/stage4-commit-scores.ts): computePgScores → ensureScaffold →
// persistMember per member. Reuses the scoring engine verbatim — no forked logic.
//
// INDUSTRY-AWARE: computePgScores classifies the PG internally (banking PGs load
// BankingCtx; PG6 inherits PG5's bars via resolveBarPath) and returns pg.industry,
// which is passed to persistMember as industryPath — so PG5/PG6 persist as "banking"
// exactly like bank-stage4-commit.ts. The handler does not branch on industry itself.
//
// IDEMPOTENT / CHEAP NO-OP: a PRE-CHECK compares each member's recomputed snapshot
// fingerprint to its committed v1 row. If NONE changed, the rescore writes nothing AND
// does not open a ScoringRun (no empty-run audit noise — important since prices enqueue
// 13 rescores every trading day, most of which find no change). If ANY changed, the
// whole PG persists in ONE transaction (unchanged members skip-identical inside;
// changed members supersede to v2).
// ─────────────────────────────────────────────────────────────

import type { JobContext } from "../context.js";
import { JobCancelledError } from "../context.js";
import type { PgRescorePayload } from "../types.js";
import { prisma } from "../../db/prisma.js";
import {
  computePgScores,
  ensureScaffold,
  finalizeRun,
  persistMember,
  type PgRef,
  type MemberWriteResult,
} from "../../scoring/composite/score-pass.js";
import { snapshotInputsFingerprint } from "../../scoring/composite/persist.js";

export interface PgRescoreMemberOutcome {
  symbol: string;
  /** "created" (first score) | "superseded" (v1 → v2 on genuine change) |
   *  "skipped_identical" (unchanged) | "unavailable_no_snapshot" (composite unavailable). */
  action: "created" | "superseded" | "skipped_identical" | "unavailable_no_snapshot";
  version: number;
  composite: number | null;
  band: string | null;
}

export interface PgRescoreResult {
  pgId: string;
  pgName: string;
  industry: string;
  triggeredBy: string;
  reason: string | null;
  members: number;
  created: number;
  superseded: number;
  skippedIdentical: number;
  noSnapshot: number;
  /** ScoringRun id for this rescore, or null when nothing was written (clean no-op). */
  runId: string | null;
  outcome: "wrote" | "no_op_all_identical";
  perMember: PgRescoreMemberOutcome[];
}

export async function handlePgRescore(
  ctx: JobContext<PgRescorePayload>,
): Promise<PgRescoreResult> {
  const { pgId, pgName, seedKey, triggeredBy, reason } = ctx.payload;
  if (!pgId || !pgName || !seedKey) {
    throw new Error(
      `pg_rescore: payload missing pgId/pgName/seedKey (got pgId=${pgId}, pgName=${pgName}, seedKey=${seedKey})`,
    );
  }
  const ref: PgRef = { pgId, seedKey, pgName };
  const reasonText = reason ?? null;

  await ctx.reportProgress(2, `Rescore ${pgId} (${pgName}) — computing`);

  // 1. COMPUTE — pure reads, no writes. Live (NOW), current DB data. Industry handled
  //    internally; pg.industry drives the persist's industryPath.
  //    withFindings ON (the gate flipped at Stage F/G): the §5 findings catalog fires +
  //    dampens per member, attached to m.findings, ready for persistMember to write.
  const pg = await computePgScores(ref, { withFindings: true });

  // Honour cancellation before the (only) write phase. The compute is already done;
  // aborting here simply means "don't persist".
  if (await ctx.shouldCancel()) throw new JobCancelledError();

  // 2. PRE-CHECK — would ANY member actually write? Compare each recomputed snapshot
  //    fingerprint to the committed v1 row (same identity persistMember uses). If all
  //    match, this rescore is a clean no-op: no snapshots, no ScoringRun.
  await ctx.reportProgress(
    45,
    `Computed ${pg.members.length} members — checking for input changes`,
  );
  // Compare each member's recomputed fingerprint to its LIVE (highest-version) snapshot
  // — the same identity persistMember chains from (NOT a hardcoded version:1; a member
  // may already be at v2+ from an earlier rescore this period). liveVersionByStock is
  // fully populated only when the loop runs to completion (the no-op path), which is
  // exactly where it's read.
  const liveVersionByStock = new Map<string, number>();
  let anyChange = false;
  for (const m of pg.members) {
    // Unavailable composite never produces a snapshot — neither now nor before; it is
    // not a "change". Skip it in the pre-check.
    if (m.composite.state !== "scored" || m.composite.composite === null) continue;
    const live = await prisma.scoreSnapshot.findFirst({
      where: {
        stockId: m.stockId,
        snapshotType: m.composite.snapshotType,
        periodKey: m.composite.periodKey,
      },
      orderBy: { version: "desc" },
      select: { version: true, inputsFingerprint: true },
    });
    if (live) liveVersionByStock.set(m.stockId, live.version);
    if (!live || live.inputsFingerprint !== snapshotInputsFingerprint(m.composite)) {
      anyChange = true;
      break;
    }
  }

  if (!anyChange) {
    await ctx.reportProgress(
      100,
      `${pgId}: no input change — all ${pg.members.length} members skip-identical, nothing written`,
    );
    return {
      pgId,
      pgName,
      industry: pg.industry,
      triggeredBy,
      reason: reasonText,
      members: pg.members.length,
      created: 0,
      superseded: 0,
      skippedIdentical: pg.members.length,
      noSnapshot: 0,
      runId: null,
      outcome: "no_op_all_identical",
      perMember: pg.members.map((m) => ({
        symbol: m.symbol,
        action:
          m.composite.state === "scored" && m.composite.composite !== null
            ? "skipped_identical"
            : "unavailable_no_snapshot",
        // Scored members have a live snapshot (≥1) in the map; unavailable members
        // (no snapshot) report 0.
        version: liveVersionByStock.get(m.stockId) ?? 0,
        composite: m.composite.composite,
        band: m.composite.labelBand,
      })),
    };
  }

  // 3. PERSIST — atomic per-PG. One ScoringRun (reuses spec "2026.1" + band mapping;
  //    marked post_ingest), every member written, run finalized — all in ONE
  //    transaction. A throw rolls the whole thing back (no dangling run, no partial
  //    snapshots). Unchanged members skip-identical inside; changed members supersede.
  await ctx.reportProgress(55, `${pgId}: changes detected — persisting`);
  const { results, runId } = await prisma.$transaction(
    async (tx) => {
      const scaffold = await ensureScaffold(tx as any, pg.asOf, {
        runType: "quarterly",
        triggerType: "post_ingest",
      });
      const out: MemberWriteResult[] = [];
      for (const m of pg.members) {
        out.push(
          await persistMember(
            tx as any,
            m,
            scaffold,
            pg.asOf,
            pg.peerGroupId,
            ref.pgId,
            pg.industry,
            pg.peerStats,
            { writeFindings: true }, // gate flipped (Stage F/G): a created/superseded snapshot persists its findings
          ),
        );
      }
      const createdN = out.filter((r) => r.action === "created").length;
      await finalizeRun(tx as any, scaffold.runId, createdN, new Date());
      return { results: out, runId: scaffold.runId };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  const created = results.filter((r) => r.action === "created" && !r.superseded).length;
  const superseded = results.filter((r) => r.action === "created" && r.superseded).length;
  const skipped = results.filter((r) => r.action === "skipped_identical").length;
  const noSnap = results.filter((r) => r.action === "unavailable_no_snapshot").length;

  await ctx.reportProgress(
    100,
    `${pgId}: ${created} created, ${superseded} superseded, ${skipped} skip-identical, ${noSnap} no-snapshot`,
  );

  return {
    pgId,
    pgName,
    industry: pg.industry,
    triggeredBy,
    reason: reasonText,
    members: pg.members.length,
    created,
    superseded,
    skippedIdentical: skipped,
    noSnapshot: noSnap,
    runId,
    outcome: "wrote",
    perMember: results.map((r) => ({
      symbol: r.symbol,
      action:
        r.action === "created"
          ? r.superseded
            ? "superseded"
            : "created"
          : r.action,
      version: r.version,
      composite: r.composite,
      band: r.band,
    })),
  };
}
