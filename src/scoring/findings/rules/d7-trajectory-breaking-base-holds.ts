// File: src/scoring/findings/rules/d7-trajectory-breaking-base-holds.ts
//
// D7 · TRAJECTORY BREAKING WHILE THE BASE HOLDS — an early warning.
// Vytal_Divergence_Tool_Spec Part 2, D7. Display-only · magnitude null · nothing rescores.
//
//     Momentum falls below 54 (from ≥ 54)  AND  Foundation ≥ 60
//
// The balance sheet is still intact but the operating trajectory has broken into weakness. This is
// early — the base has not deteriorated yet, but the direction has changed.
//
// ── ★ THE COUNTER-INTUITIVE FINDING BELONGS IN THE COPY ───────────────────────────────────────────
// "Worth noting: the intact Foundation does NOT cushion this — the version with fundamentals holding
// is MORE negative than the bare Momentum break alone (−1.4%, 41% positive, n=22), which is the
// opposite of the intuitive expectation."
// So the reader must not be told "at least the balance sheet is fine". D7's own reading is −2.9%
// forward, 40% positive (n=10) — worse than the unconditioned break it is a subset of. That contrast
// travels in evidence and is spoken in the verdict, because a reader who supplies the intuitive
// reading themselves will get it exactly backwards.
//
// ── REGIME ────────────────────────────────────────────────────────────────────────────────────────
// "In NORMAL phases −4.9%, 38% positive — reads more clearly in calm markets, consistent with every
// directional pattern in the model." Recorded; D7 has no regime-conditional COPY in the spec (only D1
// and D6 do), so the phase is carried as evidence, not as an appended sentence.
//
// ── CROSSING, NOT A GAP — see d6-quality-rolling-over.ts for why §1.2's tier is not applied ───────
// Same reasoning: the trigger is a crossing (below 54 from ≥54), and the F−M gap at fire time is
// incidental to it. `gapPp` is context; no tier is claimed; the 8–11 suppression does not gate it.

import { scoredPair } from "../divergence/bands.js";
import { NATIVE_ZONES } from "../thresholds.js";
import type { FireRule } from "../types.js";

/** §Part 2 D7 — Momentum's native WEAK mark; the level being crossed DOWN through. */
export const D7_MOMENTUM_CROSS = NATIVE_ZONES.momentum.weak; // 54
/** §Part 2 D7 — Foundation's native weak mark; the base must be at or above it. */
export const D7_FOUNDATION_MIN = NATIVE_ZONES.foundation.weak; // 60

const r1 = (x: number) => Math.round(x * 10) / 10;

export const ruleD7: FireRule = (ctx) => {
  const f = ctx.current.pillars.foundation;
  const m = ctx.current.pillars.momentum;
  const p = scoredPair(f, m); // inert-0 guard
  if (!p) return null;
  const foundation = p.a, momentum = p.b;

  if (foundation < D7_FOUNDATION_MIN) return null;
  if (momentum >= D7_MOMENTUM_CROSS) return null; // must be BELOW now

  // ★ the crossing: the prior reading must have been AT OR ABOVE the mark.
  if (ctx.priorSnapshots.length === 0) return null;
  const prior = ctx.priorSnapshots[ctx.priorSnapshots.length - 1];
  if (!prior.momentumScored || prior.momentum === null) return null;
  if (prior.momentum < D7_MOMENTUM_CROSS) return null; // was already weak — not a break

  return {
    kind: "pattern",
    key: "divergence_D7_trajectory_breaking_base_holds",
    // Early warning, n=10 — investigate register, not alarm.
    severity: "medium",
    direction: "negative",
    polarity: "negative",
    temporalClass: "EVENT",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "D7",
      name: "Trajectory Breaking While the Base Holds",
      foundation: r1(foundation),
      momentum: r1(momentum),
      momentumPrior: r1(prior.momentum),
      momentumFallPp: r1(prior.momentum - momentum),
      crossedBelow: D7_MOMENTUM_CROSS,
      foundationMin: D7_FOUNDATION_MIN,
      gapPp: r1(foundation - momentum),
      gapTierApplies: false,
      isCrossing: true,
      evidencedForwardPct: -2.9,
      evidencedPositivePct: 40,
      evidencedN: 10,
      normalPhasePct: -4.9,
      normalPhasePositivePct: 38,
      // ★ the counter-intuitive contrast — the intact base does NOT cushion this
      bareBreakPct: -1.4,
      bareBreakPositivePct: 41,
      bareBreakN: 22,
      baseDoesNotCushion: true,
    },
    metricRefs: ["momentum", "foundation"],
  };
};
