// File: src/scoring/findings/rules/t3-falling-out-of-pristine.ts
//
// T3 · FALLING OUT OF PRISTINE. Vytal_Trajectory_Tool_Spec Part 2, T3.
// Display-only · magnitude null · nothing rescores.
//
//     Composite_prev ≥ 74  AND  Composite_now < 74
//
// The top band is defined as FULLY PRICED — a business already recognised as excellent. Falling out
// of it means the one thing supporting a premium rating has started to slip.
//
// ── ★ REGIME · TIER 1 — THE PHASE DECIDES WHETHER A DIRECTIONAL READ EXISTS ──────────────────────
// Pooled, T3 reads FLAT (+0.2%) because the phases CANCEL. Split:
//
//     HOT     −5.2%, only 29% positive (n=7)   ← reads true
//     NORMAL  +2.2%                            ← NO directional read
//
// "It reads true precisely when the sector is stretched, which is when a fully-priced name has the
// most to lose." So the phase table is { HOT } and NOTHING else. NORMAL and STRESSED are ABSENT, and
// that absence is the meaningful part — it resolves to `no_read_in_phase`, not to a silent bearish
// default.
//
// ⚠ §1.4 line 87, binding: "show the crossing regardless — it is a fact about the user's stock. But
// where the evidence shows no directional signal in the current phase, say so plainly rather than
// asserting a direction the data cannot support."
// So T3 FIRES IN EVERY PHASE. What changes is the sentence: the spec supplies distinct HOT and
// NORMAL/STRESSED copy, and the verdict layer selects between them from the fire-time regime stamp.
// Pooling them — or defaulting NORMAL to the HOT reading — would assert −5.2% about a population
// that measured +2.2%.
//
// ── ⚠ THE DOWN-CROSS AT 68/62 IS NOT THIS PATTERN, AND IS EXCLUDED ────────────────────────────────
// Part 5 excludes "composite crossing down through 68" (+11.3%, HOT +18.7%) and "down through 62"
// (+5.4%) — both bull-masked, both read POSITIVE. The retired B/I fired exactly those. T3 crosses
// only at 74, the Pristine floor, which is the one down-cross that survived the phase split.

import { compositePrevNow } from "../trajectory/prev-now.js";
import { TIER_DECIDES_READ, trajectorySeverity } from "../trajectory/regime-tier.js";
import { CALIBRATION_NOTE } from "../trajectory/view.js";
import type { FireRule } from "../types.js";

/** The Pristine floor (composite band edge — a COMPOSITE threshold on a COMPOSITE value). */
export const T3_PRISTINE_FLOOR = 74;

const KEY = "trajectory_B_T3_falling_out_of_pristine";
const r1 = (x: number) => Math.round(x * 10) / 10;

export const ruleT3: FireRule = (ctx) => {
  const c = compositePrevNow(ctx);
  if (!c) return null;
  if (c.prev < T3_PRISTINE_FLOOR) return null; // was not in Pristine
  if (c.now >= T3_PRISTINE_FLOOR) return null; // still in Pristine — no crossing

  return {
    kind: "pattern",
    key: KEY,
    severity: trajectorySeverity(KEY),
    // ⚠ The DIRECTION field records that the crossing is downward. It does NOT assert a directional
    // READ — that is the regime's job, and in NORMAL there is none. The verdict is what must stay
    // silent on direction; the crossing itself is a fact.
    direction: "negative",
    polarity: "negative",
    temporalClass: "EVENT",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "T3",
      name: "Falling Out of Pristine",
      compositePrior: r1(c.prev),
      compositeNow: r1(c.now),
      crossedBelow: T3_PRISTINE_FLOOR,
      isCrossing: true,
      priorPeriod: c.priorPeriodKey,
      // ★ Tier 1 — HOT only. NORMAL/STRESSED absent ⇒ no directional read.
      ...TIER_DECIDES_READ(["HOT"]),
      pooledPct: 0.2, // flat — the phases cancel, which is why pooling it would be wrong
      hotPct: -5.2,
      hotPositivePct: 29,
      hotN: 7,
      normalPct: 2.2,
      normalHasDirectionalRead: false,
      calibration: CALIBRATION_NOTE,
    },
    metricRefs: ["composite"],
  };
};
