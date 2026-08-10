// ─────────────────────────────────────────────────────────────
// BASE_RATES_WARM HANDLER
//
// Nightly warm of the universe base-rate cache (Relational L4 · §3.5.1). TWO indexed aggregates as of
// step 5 — score_patterns joined to the in-force head snapshots, and stock_findings reduced to the
// current row per (stock, rule) — held in memory by relational/base-rates.ts and served to the UE
// (echo) family. A key belongs to exactly one of the two populations.
//
// ★ THIS JOB IS THE "BACKFILL". There is nothing on disk to migrate: splitting the denominators
// changed how the numbers are COMPUTED, not where they are kept, so every instance picks the new
// arithmetic up on its next warm (or its next cold-start compute, whichever comes first). Running
// this once after deploy is the whole of it.
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
  // ★ BOTH POPULATIONS ARE REPORTED, AND THE FILING ONE AS A RANGE. Its denominator is per RULE — the
  //   stocks that rule evaluated in — so a single number would be a fiction. The spread is the useful
  //   fact: a run where every filing rule suddenly shares one denominator means the evaluability
  //   distinction collapsed somewhere upstream.
  const scoredKeys = [...snap.rates.values()].filter((r) => r.population === "scored").length;
  const filingRates = [...snap.rates.values()].filter((r) => r.population === "filing");
  const dens = filingRates.map((r) => r.universeCount);
  const range = dens.length ? `${Math.min(...dens)}–${Math.max(...dens)}` : "none";
  await ctx.reportProgress(
    100,
    `Base rates warmed — ${scoredKeys} score keys over ${snap.universeCount} scored stocks · ` +
      `${filingRates.length} filing keys over their own evaluated populations (${range})`,
  );
  return {
    warmed: true,
    keys: snap.rates.size,
    scoredKeys,
    filingKeys: filingRates.length,
    universeCount: snap.universeCount,
    filingDenominatorRange: range,
    asOfDate: snap.asOfDate,
  };
}
