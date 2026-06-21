// File: src/scoring/findings/rules/i-band-transition.ts
//
// I — Band transition (File 1 §5I · severity Low). TRAJECTORY rule. Fire: composite crosses
// into Healthy (up, ≥68) or into Below-par (down, <62) — the average-band (Steady) edges.
// SUPPRESS if already represented by B or D (no double-cards) — the single-signal rule in
// File 1's own words. I is SUBORDINATE to B/D on the same directional move:
//   • into-Healthy (up) is suppressed when D fired (composite crossed UP out of Below-par —
//     the recovery narrative D owns).
//   • into-Below-par (down) is suppressed when B fired (composite crossed DOWN out of Healthy
//     — the deterioration narrative B owns).
// A transition WITHOUT a covering B/D (e.g. Steady→Healthy with no prior Below-par recovery,
// or Steady→Below-par with no prior Healthy deterioration) fires I standalone.

import { detectRecentSustainedCross, MIN_SUSTAIN, RECENT_MAX_RUN } from "../trajectory/cross.js";
import { seriesWithCurrent, CALIBRATION_NOTE } from "../trajectory/view.js";
import { ruleB } from "./b-deterioration.js";
import { ruleD } from "./d-recovery.js";
import type { FireRule } from "../types.js";

const OPTS = { minRun: MIN_SUSTAIN, recentMax: RECENT_MAX_RUN };

export const ruleI: FireRule = (ctx) => {
  const series = seriesWithCurrent(ctx);
  if (series.length < MIN_SUSTAIN + 1) return null;
  const comps = series.map((s) => s.composite);
  const cur = comps[comps.length - 1];

  const upIntoHealthy = detectRecentSustainedCross(comps, 68, "up", OPTS);
  const downIntoBelowPar = detectRecentSustainedCross(comps, 62, "down", OPTS);
  // DIRECTION-AWARE single-signal suppression: I is subordinate to B/D ON THE SAME DIRECTION.
  // B/D may fire on the composite OR a pillar — call the actual rules so any form covers.
  // into-Healthy (improving) suppressed by D (recovery); into-Below-par (deteriorating) by B.
  const bFired = ruleB(ctx) !== null;
  const dFired = ruleD(ctx) !== null;

  let dir: "into_healthy" | "into_below_par" | null = null, fromVal = 0, runLen = 0;
  if (upIntoHealthy.fired && !dFired) { dir = "into_healthy"; fromVal = upIntoHealthy.crossFromValue!; runLen = upIntoHealthy.runLen; }
  else if (downIntoBelowPar.fired && !bFired) { dir = "into_below_par"; fromVal = downIntoBelowPar.crossFromValue!; runLen = downIntoBelowPar.runLen; }
  if (!dir) return null;

  const toBand = dir === "into_healthy" ? "Healthy" : "Below-par";
  return {
    kind: "pattern",
    key: "trajectory_I_band_transition",
    severity: "low", // §5I
    direction: dir === "into_healthy" ? "positive" : "negative",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "I", name: "Band transition",
      direction: dir, toBand, crossFromComposite: Math.round(fromVal * 10) / 10, sustainedSnapshots: runLen,
      suppressedByBD: false, // by construction (we returned null when B/D covered it)
      trajectory: series.map((s) => `${s.periodKey}:${s.composite.toFixed(0)}/${s.labelBand}`),
      calibration: CALIBRATION_NOTE,
      verdict: `Crossed into ${toBand} (from ${fromVal.toFixed(1)} to ${cur.toFixed(1)}), held ${runLen} snapshots.`,
    },
    metricRefs: ["composite"],
  };
};
