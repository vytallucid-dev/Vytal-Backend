// ─────────────────────────────────────────────────────────────
// PG_CASCADE_RESCORE HANDLER
//
// CASA forward-cascade self-heal. Enqueued by the CASA admin write (controller) when a
// bank's CASA is edited. Delegates to runBankingCascade (the production cascade machinery),
// which:
//   • builds the plan from the edited period vs the current/live period:
//       - PAST edit    → rescore the bank's PG for [editedPeriod .. current], PIT for each
//         historical period (casaPeriodKey cutoff, no future-CASA leak), LIVE for the current
//         period (newest CASA + current Market — the Option-1 split).
//       - CURRENT edit → a single LIVE rescore of the current period (no backward cascade).
//   • commits each period oldest→newest under ONE ScoringRun (append-only supersede;
//     skip-identical no-ops periods/members whose CASA resolution didn't change).
// REUSES computePgScores + persistMember verbatim — no forked scoring logic. Banking-only.
// ─────────────────────────────────────────────────────────────

import type { JobContext } from "../context.js";
import { JobCancelledError } from "../context.js";
import type { PgCascadeRescorePayload } from "../types.js";
import { runBankingCascade } from "../../scoring/rescore/banking-cascade.js";

export interface PgCascadeRescoreResult {
  symbol: string;
  pgId: string;
  editedPeriod: string;
  currentPeriod: string | null;
  kind: "cascade" | "current_live" | "noop" | "not_banking";
  triggeredBy: string;
  reason: string | null;
  periodsRescored: number;
  superseded: number;
  created: number;
  skippedIdentical: number;
  noSnapshot: number;
  runId: string | null;
  /** Per-period roll-up for the audit trail. */
  perPeriod: { periodKey: string; mode: "pit" | "live"; superseded: number; skipped: number; created: number }[];
}

export async function handlePgCascadeRescore(
  ctx: JobContext<PgCascadeRescorePayload>,
): Promise<PgCascadeRescoreResult> {
  const { symbol, editedPeriod, triggeredBy, reason } = ctx.payload;
  if (!symbol || !editedPeriod) {
    throw new Error(`pg_cascade_rescore: payload missing symbol/editedPeriod (got symbol=${symbol}, editedPeriod=${editedPeriod})`);
  }
  const reasonText = reason ?? null;

  await ctx.reportProgress(2, `CASA cascade ${symbol} @ ${editedPeriod} — planning`);
  // Cancellation is honoured before the (first) write; runBankingCascade commits each period
  // in its own tx and is idempotent, so a cancel mid-cascade leaves a self-completing partial
  // (a re-trigger skip-identicals the done periods and finishes the rest).
  if (await ctx.shouldCancel()) throw new JobCancelledError();

  const result = await runBankingCascade(symbol, editedPeriod, {
    dryRun: false,
    onProgress: (pct, note) => ctx.reportProgress(pct, note),
  });

  // null ⇒ the symbol is not a banking-PG member. CASA is banking-only, so this is a
  // defensive no-op (never expected from the CASA write path).
  if (!result) {
    await ctx.reportProgress(100, `${symbol}: not a banking-PG member — no cascade`);
    return {
      symbol, pgId: ctx.payload.pgId, editedPeriod, currentPeriod: null, kind: "not_banking",
      triggeredBy, reason: reasonText, periodsRescored: 0, superseded: 0, created: 0,
      skippedIdentical: 0, noSnapshot: 0, runId: null, perPeriod: [],
    };
  }

  const perPeriod = result.steps.map((s) => ({
    periodKey: s.periodKey,
    mode: s.mode,
    superseded: s.results.filter((r) => r.action === "created" && r.superseded).length,
    skipped: s.results.filter((r) => r.action === "skipped_identical").length,
    created: s.results.filter((r) => r.action === "created" && !r.superseded).length,
  }));

  await ctx.reportProgress(
    100,
    `${symbol} @ ${editedPeriod} (${result.plan.kind}): ${result.superseded} superseded, ${result.skippedIdentical} skip across ${result.steps.length} period(s)`,
  );

  return {
    symbol,
    pgId: result.plan.pgId,
    editedPeriod,
    currentPeriod: result.plan.currentPeriod,
    kind: result.plan.kind,
    triggeredBy,
    reason: reasonText,
    periodsRescored: result.steps.length,
    superseded: result.superseded,
    created: result.created,
    skippedIdentical: result.skippedIdentical,
    noSnapshot: result.noSnapshot,
    runId: result.runId,
    perPeriod,
  };
}
