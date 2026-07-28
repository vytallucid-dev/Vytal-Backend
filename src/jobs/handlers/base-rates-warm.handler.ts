// ─────────────────────────────────────────────────────────────
// BASE_RATES_WARM HANDLER
//
// Nightly warm of the universe base-rate cache (Relational L4 · §3.5.1). One indexed aggregate over
// score_patterns joined to the in-force head snapshots; the result is held in memory by
// relational/base-rates.ts and served to the UE (echo) family.
//
// ★ NO TABLE, BY DESIGN. Every number is derived and recoverable by re-running the same query, so the
// cache is a performance optimisation rather than a store. A cold instance computes on first demand;
// this job exists only so the first reader of the day does not pay for it. Safe to re-run, safe to
// skip — skipping costs one query on the next request, never a wrong answer.
//
// A failed warm leaves the PREVIOUS snapshot serving (bounded staleness) rather than emptying the
// cache. Base rates move only when a rescore runs, so a day-old denominator on "17 of 95" does not
// change what the reader takes from the sentence.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { BaseRatesWarmPayload } from "../types.js";
import { warmBaseRates } from "../../relational/base-rates.js";

export async function handleBaseRatesWarm(ctx: JobContext<BaseRatesWarmPayload>) {
  await ctx.reportProgress(5, "Computing universe base rates from in-force head snapshots");
  const snap = await warmBaseRates();
  if (!snap) {
    // Not a throw: the UE family degrades honestly without base rates, and a failed warm must not
    // mark the nightly run as broken when the read path already handles the absence.
    await ctx.reportProgress(100, "Base-rate warm failed — previous snapshot (if any) still serving");
    return { warmed: false, keys: 0, universeCount: 0 };
  }
  await ctx.reportProgress(
    100,
    `Base rates warmed — ${snap.rates.size} pattern keys over ${snap.universeCount} scored stocks`,
  );
  return { warmed: true, keys: snap.rates.size, universeCount: snap.universeCount, asOfDate: snap.asOfDate };
}
