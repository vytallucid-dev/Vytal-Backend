// File: src/scoring/findings/rules/g-convergence.ts
//
// G — Convergence (File 1 §5G · severity Low). TRAJECTORY rule. Fire: a previously-notable
// pillar gap NARROWS over the series. Typed: HEALTHY RESOLUTION (the laggard rose) vs
// DETERIORATION CONVERGENCE (the leader fell) — the verdict states which pillar moved.
//
// Single-signal vs C (divergence at a point): C = is-diverged-NOW (current gap ≥ wide); G =
// WAS-diverged, now narrowing. To keep them complementary, G requires the CURRENT spread to
// have fallen BELOW wide (if still ≥ wide, the C family owns the still-open divergence).
// Uses the same K2 spread thresholds as C.

import { pillarSpread } from "../trajectory/cross.js";
import { seriesWithCurrent, CALIBRATION_NOTE } from "../trajectory/view.js";
import { K2_NOTABLE, K2_WIDE } from "../thresholds.js";
import type { FireRule } from "../types.js";

export const G_NARROW_PP = 8; // the gap must have narrowed ≥ 8pp from its peak — FLAG: provisional

export const ruleG: FireRule = (ctx) => {
  const series = seriesWithCurrent(ctx);
  if (series.length < 2) return null;
  const curSpread = pillarSpread(series[series.length - 1]);
  if (!curSpread) return null;
  if (curSpread.spread >= K2_WIDE) return null; // still wide → C owns the open divergence

  // Peak spread among the priors (the reference divergence we are converging from).
  let ref: ReturnType<typeof pillarSpread> = null, refPeriod = "";
  for (const p of series.slice(0, -1)) {
    const sp = pillarSpread(p);
    if (sp && (!ref || sp.spread > ref.spread)) { ref = sp; refPeriod = p.periodKey; }
  }
  if (!ref || ref.spread < K2_NOTABLE) return null;        // was never notably diverged
  const narrowed = ref.spread - curSpread.spread;
  if (narrowed < G_NARROW_PP) return null;                  // not converging materially

  // Typed: laggard rose (min up) vs leader fell (max down) — dominant move names the story.
  const minRose = curSpread.min - ref.min; // laggard delta (+ = rose)
  const maxFell = ref.max - curSpread.max; // leader delta (+ = fell)
  const healthy = minRose >= maxFell;
  const r1 = (x: number) => Math.round(x * 10) / 10;

  return {
    kind: "pattern",
    key: "trajectory_G_convergence",
    severity: "low", // §5G
    direction: healthy ? "positive" : "negative",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "G", name: "Convergence",
      type: healthy ? "healthy_resolution" : "deterioration_convergence",
      peakSpread: r1(ref.spread), peakPeriod: refPeriod, currentSpread: r1(curSpread.spread), narrowedPp: r1(narrowed),
      laggardPillar: ref.minPillar, leaderPillar: ref.maxPillar, laggardRosePp: r1(minRose), leaderFellPp: r1(maxFell),
      calibration: CALIBRATION_NOTE,
      verdict: healthy
        ? `Converging — the ${ref.minPillar} laggard rose ${r1(minRose)}pp, closing a ${r1(ref.spread)}pp pillar gap to ${r1(curSpread.spread)}pp (healthy resolution).`
        : `Converging — the ${ref.maxPillar} leader fell ${r1(maxFell)}pp, closing a ${r1(ref.spread)}pp pillar gap to ${r1(curSpread.spread)}pp (deterioration convergence).`,
    },
    metricRefs: [ref.minPillar, ref.maxPillar],
  };
};
