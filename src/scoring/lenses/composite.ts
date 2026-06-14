// File: src/scoring/lenses/composite.ts
//
// METRIC COMPOSITE — combine the three lens scores into one metric score.
//
//   metricScore = (L1 + L2 + L3) / 3   (§CN-3: EQUAL weight, never re-weighted)
//
// §5.8 FALLBACK: if a lens is UNAVAILABLE, average the lenses that ARE available
// (e.g. L3 short on history → (L1+L2)/2) and RECORD which fallback applied. The
// composite is always the faithful arithmetic mean of the present lenses — equal
// weight among whatever survives, never a re-weight.
//
// The LensFallback enum has only three states; the precise available-set is
// carried separately by the three boolean flags (l1/l2/l3 Available, which map to
// MetricScore.l1Available/l2Available/l3Available). So:
//   none                    → all three present
//   l3_insufficient_history → exactly L3 missing (L1 & L2 present) → (L1+L2)/2
//   l2_to_l1                → L2 missing (any case) → mean of the rest
// The score is correct in every case; the enum is the coarse summary and the
// booleans are the exact truth. See the FLAG in the harness.
//
// PURE. No DB, no I/O.

import type { Lens1Result } from "./lens-bars.js";
import type { ZLensResult } from "./lens-zscore.js";
import type { LensFallback } from "./types.js";

export interface MetricCompositeResult {
  metricScore: number; // mean of the available lens scores
  l1Available: boolean;
  l2Available: boolean;
  l3Available: boolean;
  lensesUsed: number; // 1..3 — how many lenses fed the mean
  lensFallbackApplied: LensFallback;
  /** True in the one structurally-unexpected case: L1 (the always-present
   *  absolute bar) was unavailable. The score still averages what remains, but
   *  the LensFallback enum cannot name this — surfaced for the caller. */
  l1MissingAnomaly: boolean;
  reasonText: string;
}

/**
 * Combine three lens results into the metric composite. PURE.
 *
 * @param l1 Lens-1 result (absolute bars). Expected always available.
 * @param l2 Lens-2 result (peer cross-section), or null if never invoked.
 * @param l3 Lens-3 result (own-history), or null if never invoked.
 */
export function combineLenses(
  l1: Lens1Result | null,
  l2: ZLensResult | null,
  l3: ZLensResult | null,
): MetricCompositeResult {
  const l1Available = l1?.available === true;
  const l2Available = l2?.available === true;
  const l3Available = l3?.available === true;

  const present: number[] = [];
  if (l1Available && l1) present.push(l1.score);
  if (l2Available && l2 && l2.score !== null) present.push(l2.score);
  if (l3Available && l3 && l3.score !== null) present.push(l3.score);

  const lensesUsed = present.length;
  // Faithful equal-weight mean of whatever is present. If nothing is present
  // (pathological — should never happen, L1 is always there) fall back to 0 and
  // flag via lensesUsed=0 so the caller cannot mistake it for a real score.
  const metricScore = lensesUsed > 0 ? present.reduce((a, b) => a + b, 0) / lensesUsed : 0;

  // ── Fallback label (coarse; booleans carry the precise truth) ────────────────
  let lensFallbackApplied: LensFallback;
  if (l1Available && l2Available && l3Available) {
    lensFallbackApplied = "none";
  } else if (l1Available && l2Available && !l3Available) {
    lensFallbackApplied = "l3_insufficient_history";
  } else {
    // L2 missing (with or without L3) — including the L1-missing anomaly.
    lensFallbackApplied = "l2_to_l1";
  }

  const l1MissingAnomaly = !l1Available;

  return {
    metricScore,
    l1Available,
    l2Available,
    l3Available,
    lensesUsed,
    lensFallbackApplied,
    l1MissingAnomaly,
    reasonText: buildReason(metricScore, lensesUsed, lensFallbackApplied, l1MissingAnomaly, {
      l1Available,
      l2Available,
      l3Available,
    }),
  };
}

function buildReason(
  score: number,
  used: number,
  fallback: LensFallback,
  l1Missing: boolean,
  avail: { l1Available: boolean; l2Available: boolean; l3Available: boolean },
): string {
  const set = [
    avail.l1Available ? "L1" : "—",
    avail.l2Available ? "L2" : "—",
    avail.l3Available ? "L3" : "—",
  ].join("+");
  const head = `metric=${score.toFixed(2)} = mean of ${used} lens(es) [${set}], fallback=${fallback}`;
  if (l1Missing) return `${head} — FLAG: L1 unavailable (unexpected — L1 should always be present)`;
  if (used === 0) return `${head} — FLAG: NO lenses available; score is a placeholder 0`;
  return head;
}
