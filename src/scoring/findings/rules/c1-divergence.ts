// File: src/scoring/findings/rules/c1-divergence.ts
//
// C1 — Price ahead of fundamentals (File 1 §5C · divergence card · severity High when wide).
// Trigger (File 1 §5C, C1 sub-type): Market − mean(Foundation, Momentum) ≥ wide (K2 = 25).
//
// INERT-0 GUARD (critical): an unavailable_redistributed pillar persists a subtotal of 0
// but is NOT a real score. Naively averaging F & M with a 0 momentum fabricates a huge
// gap (the audit found this dominates the naive candidate list). C1 fires ONLY when
// Foundation, Momentum AND Market are all genuinely `scored`. FLAG: the same guard is
// needed by every gap-based rule (C2/C3/F1) in later stages.
//
// SCOPE: Stage A implements the C1 WIDE sub-type only. The notable-but-not-wide tier
// (15–25) and the C2/C3 sub-types are added in the divergence stage.

import { K2_WIDE } from "../thresholds.js";
import type { FireRule } from "../types.js";

const round1 = (x: number) => Math.round(x * 10) / 10;

export const ruleC1: FireRule = (ctx) => {
  const f = ctx.current.pillars.foundation;
  const m = ctx.current.pillars.momentum;
  const mkt = ctx.current.pillars.market;

  // Inert-0 guard — all three must be genuinely scored.
  if (f.state !== "scored" || m.state !== "scored" || mkt.state !== "scored") return null;
  if (f.subtotal === null || m.subtotal === null || mkt.subtotal === null) return null;

  const meanFM = (f.subtotal + m.subtotal) / 2;
  const gap = mkt.subtotal - meanFM;
  if (gap < K2_WIDE) return null; // C1 is the WIDE sub-type

  return {
    kind: "pattern",
    // No canonical key in lib/finding-names.ts for the divergence family (C/B/D/G…) yet —
    // FLAG: add C-family entries there. Family-prefixed convention used here.
    key: "divergence_C1_price_ahead",
    severity: "high", // §5C: High when wide
    direction: "negative",
    magnitude: null, // structural divergence card — no §5E score magnitude
    displayState: "active",
    evidence: {
      card: "C1",
      name: "Price ahead of fundamentals",
      market: round1(mkt.subtotal),
      foundation: round1(f.subtotal),
      momentum: round1(m.subtotal),
      meanFundamentals: round1(meanFM),
      gap: round1(gap),
      tier: "wide",
      wideCut: K2_WIDE,
      // Verdict sentence (File 1 §5C style) — names the gap with the real pillar values.
      verdict:
        `Price (${mkt.subtotal.toFixed(0)}) sits ${round1(gap)} pts above its fundamentals ` +
        `(F${f.subtotal.toFixed(0)} / M${m.subtotal.toFixed(0)}, mean ${round1(meanFM)}) — a wide gap.`,
    },
    metricRefs: ["market", "foundation", "momentum"],
  };
};
