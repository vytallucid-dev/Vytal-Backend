// File: src/scoring/findings/rules/c-over-time.ts
//
// C-over-time — Divergence widening (File 1 §5C trajectory leg · severity Medium). TRAJECTORY
// rule. The price-vs-fundamentals gap (Market − mean(Foundation, Momentum) — C1's metric) has
// been WIDENING over recent snapshots, currently NOTABLE but not yet WIDE.
//
// Single-signal separation (the three readings of the C family are disjoint):
//   • C1 (Stage A, point):   current gap ≥ WIDE (25).               → "diverged now"
//   • C-over-time (here):     NOTABLE ≤ current gap < WIDE AND rising. → "diverging — developing"
//   • G (convergence):        gap NARROWING from a notable peak.      → "converging"
// By construction C-over-time fires only below WIDE (C1 owns wide) and only while rising
// (G owns narrowing). Reuses the same K2 thresholds + the inert-0-guarded price gap.

import { seriesWithCurrent, priceGap, CALIBRATION_NOTE } from "../trajectory/view.js";
import { K2_NOTABLE, K2_WIDE } from "../thresholds.js";
import type { FireRule } from "../types.js";

export const C_WIDEN_PP = 8; // gap rose ≥ 8pp from its recent low ⇒ "widening" — FLAG: provisional
const WINDOW = 4;            // look back up to 4 snapshots for the recent low

export const ruleCOverTime: FireRule = (ctx) => {
  const series = seriesWithCurrent(ctx);
  const recent = series.slice(-WINDOW).map(priceGap).filter((g): g is number => g !== null);
  if (recent.length < 2) return null;
  const cur = recent[recent.length - 1];
  if (cur < K2_NOTABLE || cur >= K2_WIDE) return null; // developing band only (C1 owns ≥ wide)

  const recentLow = Math.min(...recent.slice(0, -1)); // lowest prior gap in the window
  const widenedBy = cur - recentLow;
  if (widenedBy < C_WIDEN_PP) return null;             // not widening materially
  if (cur < recentLow) return null;                    // must be rising vs the low

  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    kind: "pattern",
    key: "divergence_C_over_time_widening",
    severity: "medium", // §5C (notable tier)
    direction: "negative",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "C-over-time", name: "Divergence widening",
      currentGap: r1(cur), recentLowGap: r1(recentLow), widenedByPp: r1(widenedBy),
      notableCut: K2_NOTABLE, wideCut: K2_WIDE,
      gapTrajectory: series.slice(-WINDOW).map((s) => ({ period: s.periodKey, gap: priceGap(s) === null ? null : r1(priceGap(s) as number) })),
      calibration: CALIBRATION_NOTE,
      verdict: `Price-vs-fundamentals gap widening — up from ${r1(recentLow)} to ${r1(cur)} pts over recent snapshots (a developing divergence, not yet wide).`,
    },
    metricRefs: ["market", "foundation", "momentum"],
  };
};
