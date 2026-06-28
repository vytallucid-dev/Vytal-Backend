// ─────────────────────────────────────────────────────────────
// FILL_CASCADE_RESCORE HANDLER
//
// General (PG-type-agnostic) forward-cascade self-heal. Enqueued by the raw-field
// fill write (applyRawFieldEdit) when a PAST fundamentals/shareholding period is
// corrected. Delegates to runGeneralCascade — the banking cascade's Option-1
// live/PIT split lifted to every PG: rescore the stock's scored PG(s) for
// [editedPeriod .. current], PIT for each historical period (Market frozen at
// quarter-end), LIVE for the current period (Option-1). The deriveFromRow
// re-derive already ran on the edited row before this job, so each PIT period
// reads the corrected raw + re-derived ratios. REUSES computePgScores +
// persistMember verbatim (no forked scoring). Idempotent (skip-identical).
//
// Banking edits do NOT come here — applyRawFieldEdit routes them to the existing
// PG_CASCADE_RESCORE (runBankingCascade) path, unchanged.
// ─────────────────────────────────────────────────────────────

import type { JobContext } from "../context.js";
import { JobCancelledError } from "../context.js";
import type { FillCascadeRescorePayload } from "../types.js";
import { runGeneralCascade, type FillEdit } from "../../scoring/rescore/general-cascade.js";

export interface FillCascadeRescoreResult {
  symbol: string;
  triggeredBy: string;
  reason: string | null;
  pgCount: number;
  periodsRescored: number;
  superseded: number;
  created: number;
  skippedIdentical: number;
  noSnapshot: number;
  runId: string | null;
  /** Per-(PG,period) roll-up for the audit trail. */
  perStep: { pgId: string; periodKey: string; mode: "pit" | "live"; superseded: number; skipped: number; created: number }[];
}

export async function handleFillCascadeRescore(
  ctx: JobContext<FillCascadeRescorePayload>,
): Promise<FillCascadeRescoreResult> {
  const { symbol, editKind, editReportDateIso, editPeriodKey, triggeredBy, reason, dryRun } = ctx.payload;
  if (!symbol) throw new Error("fill_cascade_rescore: payload missing symbol");

  const edit: FillEdit =
    editKind === "annual"
      ? { kind: "annual", reportDate: new Date(editReportDateIso ?? "") }
      : { kind: "quarter", periodKey: editPeriodKey ?? "" };
  if (editKind === "annual" && Number.isNaN(edit.kind === "annual" ? edit.reportDate.getTime() : 0)) {
    throw new Error(`fill_cascade_rescore: bad editReportDateIso "${editReportDateIso}"`);
  }
  if (editKind === "quarter" && !editPeriodKey) {
    throw new Error("fill_cascade_rescore: quarter edit missing editPeriodKey");
  }

  await ctx.reportProgress(2, `fill cascade ${symbol} (${editKind}) — planning`);
  // Idempotent + per-period committed, so a cancel mid-cascade leaves a self-completing
  // partial (a re-trigger skip-identicals the done periods).
  if (await ctx.shouldCancel()) throw new JobCancelledError();

  const result = await runGeneralCascade(symbol, edit, {
    dryRun: !!dryRun,
    onProgress: (pct, note) => ctx.reportProgress(pct, note),
  });

  const reasonText = reason ?? null;
  if (!result) {
    await ctx.reportProgress(100, `${symbol}: in no scored PG — no cascade`);
    return { symbol, triggeredBy, reason: reasonText, pgCount: 0, periodsRescored: 0, superseded: 0, created: 0, skippedIdentical: 0, noSnapshot: 0, runId: null, perStep: [] };
  }

  const perStep = result.perPg.flatMap((pg) =>
    pg.steps.map((s) => ({
      pgId: pg.ref.pgId,
      periodKey: s.periodKey,
      mode: s.mode,
      superseded: s.results.filter((r) => r.action === "created" && r.superseded).length,
      skipped: s.results.filter((r) => r.action === "skipped_identical").length,
      created: s.results.filter((r) => r.action === "created" && !r.superseded).length,
    })),
  );

  await ctx.reportProgress(
    100,
    `${symbol} (${result.perPg.length} PG): ${result.superseded} superseded, ${result.skippedIdentical} skip across ${perStep.length} period-step(s)`,
  );

  return {
    symbol,
    triggeredBy,
    reason: reasonText,
    pgCount: result.perPg.length,
    periodsRescored: perStep.length,
    superseded: result.superseded,
    created: result.created,
    skippedIdentical: result.skippedIdentical,
    noSnapshot: result.noSnapshot,
    runId: result.runId,
    perStep,
  };
}
