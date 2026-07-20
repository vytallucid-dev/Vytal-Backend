// ─────────────────────────────────────────────────────────────────────────────
// INSTRUMENT HISTORY BACKFILL (Step 21) — populate/refresh the weekly chart series for HELD
// non-stock instruments. Two modes:
//   · single  { instrumentId }        — on first hold (manual add / broker snapshot-diff)
//   · refresh_all_held { mode }        — the weekly cron; adds the newest week to the whole book
//
// Idempotent (persist is ON CONFLICT DO NOTHING; the DB trigger keeps each instrument to 4y), so a
// retry or a re-hold stores nothing new. Progress is reported throughout — a stalled run shows a
// stale progressNote, and the worker's 30-min ABANDONED sweep catches a truly stuck one.
// ─────────────────────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { InstrumentHistoryBackfillPayload } from "../types.js";
import { runBackfill, loadTargets, heldNonStockInstrumentIds } from "../../portfolio/history/backfill.js";

export async function handleInstrumentHistoryBackfill(
  ctx: JobContext<InstrumentHistoryBackfillPayload>,
) {
  const { instrumentId, mode } = ctx.payload;

  let ids: string[];
  if (mode === "refresh_all_held") {
    ids = await heldNonStockInstrumentIds();
  } else if (instrumentId) {
    ids = [instrumentId];
  } else {
    throw new Error("instrument_history_backfill: payload needs { instrumentId } or { mode: 'refresh_all_held' }");
  }

  await ctx.reportProgress(1, `resolving ${ids.length} target instrument(s)`);
  if (ids.length === 0) return { targets: 0, charted: 0, excluded: 0, pointsStored: 0, outcomes: [] };

  const targets = await loadTargets(ids);
  const report = await runBackfill(targets, {
    report: (percent, note) => ctx.reportProgress(percent, note),
    signal: ctx.signal,
  });

  // The summary the admin/job view reads: how many charted, how many honest-excluded, why.
  return report;
}
