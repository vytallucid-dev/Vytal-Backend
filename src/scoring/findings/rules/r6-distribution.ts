// File: src/scoring/findings/rules/r6-distribution.ts
//
// R6 — Distribution Pattern (File 1 §5A · severity Critical · red flag).
// Trigger (File 1): SAME quarter, Promoter ↓ AND FII ↓ AND Retail ↑ (all three).
//
// REUSE: the firing decision is the engine's existing computeR6 (ownership/disturbances.ts),
// the SAME function that levies the −8 ownership pillar penalty. So the §5 red-flag CARD
// and the pillar penalty can never disagree on whether R6 fired. (The card is a finding
// row; it does NOT re-score — no double-count.) The red flag carries the breaching triple
// as evidence so the UI verdict sentence has the real numbers.

import { computeR6, R6_MIN_MOVE_PP } from "../../ownership/disturbances.js";
import type { FireRule } from "../types.js";

const signed = (x: number) => (x >= 0 ? `+${x.toFixed(2)}` : x.toFixed(2));
const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100); // clean evidence floats

export const ruleR6: FireRule = (ctx) => {
  const sh = ctx.shareholding;
  if (sh.length < 2) return null;
  // Score the snapshot's quarter = the latest shareholding row (point-in-time correct:
  // the series is already restricted to ≤ cutoff by the loader) vs the one before.
  const current = sh[sh.length - 1];
  const prior = sh[sh.length - 2];
  const r6 = computeR6(current, prior);
  if (!r6.fired) return null;

  const curPk = `${current.fiscalYear}${current.quarter}`;
  const priorPk = `${prior.fiscalYear}${prior.quarter}`;
  return {
    kind: "red_flag",
    key: "ownership_R6_distribution", // canonical key (lib/finding-names.ts convention)
    severity: "critical", // File 1 §5A
    evidence: {
      rule: "R6",
      name: "Distribution Pattern",
      currentPeriod: curPk,
      priorPeriod: priorPk,
      promoterPct: current.promoterPct,
      promoterPctPrior: prior.promoterPct,
      promoterDeltaPp: r2(r6.promoterDelta),
      fiiPct: current.fiiPct,
      fiiPctPrior: prior.fiiPct,
      fiiDeltaPp: r2(r6.fiiDelta),
      retailPct: current.retailPct,
      retailPctPrior: prior.retailPct,
      retailDeltaPp: r2(r6.retailDelta),
      noiseFloorPp: R6_MIN_MOVE_PP,
      // The verdict sentence the card renders — names the flag + the single breaching fact.
      verdict:
        `Distribution pattern — promoter and FII both cut while retail absorbed, same quarter ` +
        `(promoter ${signed(r6.promoterDelta!)}pp, FII ${signed(r6.fiiDelta!)}pp, retail ${signed(r6.retailDelta!)}pp into ${curPk}).`,
    },
    metricRefs: ["promoterPct", "fiiPct", "retailPct"],
  };
};
