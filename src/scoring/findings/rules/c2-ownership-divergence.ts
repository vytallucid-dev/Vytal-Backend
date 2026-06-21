// File: src/scoring/findings/rules/c2-ownership-divergence.ts
//
// C2 — Ownership against fundamentals (File 1 §5C · High if wide, else Medium). POINT-IN-TIME
// (current snapshot pillar gaps — like C1; NOT a trajectory rule. File 1's C2/C3 are the
// point-in-time legs of the C family; the trajectory leg is C-over-time, built separately).
// Two regime cases (File 1):
//   • exit-under-strength:   Foundation ≥ mid (60) AND Foundation − Ownership ≥ notable (15)
//   • build-under-weakness:  Foundation < weak (60) AND Ownership − Foundation ≥ notable (15)
// Test grounding (File 1): build-under-weakness is the REGIME-ROBUST smart-money tell;
// exit-under-strength is owners stepping back beneath a holding floor.

import { NATIVE_ZONES, K2_NOTABLE, K2_WIDE } from "../thresholds.js";
import type { FireRule } from "../types.js";

const F_MID = NATIVE_ZONES.foundation.weak; // mid zone starts at the weak mark (60)

export const ruleC2: FireRule = (ctx) => {
  const f = ctx.current.pillars.foundation, own = ctx.current.pillars.ownership;
  if (f.state !== "scored" || own.state !== "scored" || f.subtotal === null || own.subtotal === null) return null;

  let kind: "exit_under_strength" | "build_under_weakness" | null = null, gap = 0;
  if (f.subtotal >= F_MID && f.subtotal - own.subtotal >= K2_NOTABLE) { kind = "exit_under_strength"; gap = f.subtotal - own.subtotal; }
  else if (f.subtotal < F_MID && own.subtotal - f.subtotal >= K2_NOTABLE) { kind = "build_under_weakness"; gap = own.subtotal - f.subtotal; }
  if (!kind) return null;

  const wide = gap >= K2_WIDE;
  const r0 = (x: number) => x.toFixed(0);
  return {
    kind: "pattern",
    key: "divergence_C2_ownership_vs_fundamentals",
    severity: wide ? "high" : "medium", // §5C
    direction: "negative",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "C2", name: "Ownership against fundamentals", subtype: kind,
      foundation: Math.round(f.subtotal * 10) / 10, ownership: Math.round(own.subtotal * 10) / 10,
      gap: Math.round(gap * 10) / 10, tier: wide ? "wide" : "notable",
      verdict: kind === "exit_under_strength"
        ? `Owners stepping back beneath a holding floor — Foundation ${r0(f.subtotal)} but Ownership only ${r0(own.subtotal)} (a ${r0(gap)}pt gap).`
        : `Smart money building under weakness — Ownership ${r0(own.subtotal)} above a weak Foundation ${r0(f.subtotal)} (a ${r0(gap)}pt gap, the regime-robust tell).`,
    },
    metricRefs: ["foundation", "ownership"],
  };
};
