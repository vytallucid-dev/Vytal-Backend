// File: src/scoring/findings/rules/c3-floor-trajectory-split.ts
//
// C3 — Floor–trajectory split (File 1 §5C · High if wide, else Medium). POINT-IN-TIME.
// Trigger (File 1): |Foundation − Momentum| ≥ wide (25) — the structural floor and the
// near-term trajectory disagree sharply (a strong balance sheet with cratering momentum, or
// vice-versa). Both pillars must be genuinely scored (inert-0 guard).

import { K2_WIDE } from "../thresholds.js";
import type { FireRule } from "../types.js";

export const ruleC3: FireRule = (ctx) => {
  const f = ctx.current.pillars.foundation, m = ctx.current.pillars.momentum;
  if (f.state !== "scored" || m.state !== "scored" || f.subtotal === null || m.subtotal === null) return null;
  const gap = Math.abs(f.subtotal - m.subtotal);
  // File 1 §5C: C3 is the WIDE split (|F − M| ≥ wide = 25), like C1. The notable-but-not-wide
  // F/M gap is a generic "notable divergence" the read layer can surface, not the C3 sub-type.
  if (gap < K2_WIDE) return null;
  const wide = true;
  const floorLed = f.subtotal > m.subtotal;
  const r0 = (x: number) => x.toFixed(0);
  return {
    kind: "pattern",
    key: "divergence_C3_floor_trajectory_split",
    severity: wide ? "high" : "medium", // §5C
    direction: "negative",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "C3", name: "Floor–trajectory split",
      foundation: Math.round(f.subtotal * 10) / 10, momentum: Math.round(m.subtotal * 10) / 10,
      gap: Math.round(gap * 10) / 10, tier: wide ? "wide" : "notable", floorLed,
      verdict: floorLed
        ? `Floor–trajectory split — a strong Foundation ${r0(f.subtotal)} over weak Momentum ${r0(m.subtotal)} (a ${r0(gap)}pt gap): the balance sheet holds while the near-term trajectory lags.`
        : `Floor–trajectory split — Momentum ${r0(m.subtotal)} running well ahead of Foundation ${r0(f.subtotal)} (a ${r0(gap)}pt gap): the trajectory outruns the floor.`,
    },
    metricRefs: ["foundation", "momentum"],
  };
};
