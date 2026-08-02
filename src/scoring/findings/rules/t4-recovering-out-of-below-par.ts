// File: src/scoring/findings/rules/t4-recovering-out-of-below-par.ts
//
// T4 · RECOVERING OUT OF BELOW PAR. Vytal_Trajectory_Tool_Spec Part 2, T4.
// Display-only · magnitude null · nothing rescores.
//
//     Composite_prev < 62  AND  Composite_now ≥ 62
//
// The business has climbed out of soft territory into Steady. The band-crossing version of T1 —
// narrower and cleaner to state.
//
// ── ★ THE SAMPLE SIZE WAS NOT PRESERVED, AND THAT MUST TRAVEL WITH THE CARD ──────────────────────
// The spec's own note: "Sample size was not preserved in the retrieved output for this cell. Treat as
// directional and re-verify before giving it prominence."
// So T4 is the one pattern in this family whose n is UNKNOWN — not small, unknown. It ships with
// `sampleSizePreserved: false` and `evidencedN: null`, and the verdict names the limitation rather
// than quoting +6.6% as though it were sampled like T1's n=26. A figure without its n is a figure a
// reader cannot weigh, and presenting it beside T1's would imply a confidence that was never
// established. This is why the rule carries the caveat as DATA — a comment could be dropped by any
// surface that renders evidence; a field cannot.
//
// Reading (directional only): +6.6%, and notably +22.1% in STRESSED phases — recovery crossings out
// of the low bands carried most in calm and stressed markets, less uniquely in hot ones.
//
// ── REGIME · TIER 3 (magnitude caveat) ────────────────────────────────────────────────────────────
// Reads across phases; magnitudes flattered in HOT. The STRESSED figure is recorded but inherits the
// same unpreserved-n caveat — it is not a separate claim with its own sample.
//
// ── COMPOSITE BAND ON A COMPOSITE VALUE ───────────────────────────────────────────────────────────
// 62 is the Steady floor from LABEL_BAND_MAP, applied to the COMPOSITE. No pillar is involved, so
// §1.2's "never borrow a composite band for a pillar" is not in play here.

import { compositePrevNow } from "../trajectory/prev-now.js";
import { TIER_MAGNITUDE_CAVEAT, trajectorySeverity } from "../trajectory/regime-tier.js";
import { CALIBRATION_NOTE } from "../trajectory/view.js";
import type { FireRule } from "../types.js";

/** The Steady floor (composite band edge, applied to the composite). */
export const T4_STEADY_FLOOR = 62;

const KEY = "trajectory_D_T4_recovering_out_of_below_par";
const r1 = (x: number) => Math.round(x * 10) / 10;

export const ruleT4: FireRule = (ctx) => {
  const c = compositePrevNow(ctx);
  if (!c) return null;
  if (c.prev >= T4_STEADY_FLOOR) return null; // was not below par
  if (c.now < T4_STEADY_FLOOR) return null;   // has not crossed up

  return {
    kind: "pattern",
    key: KEY,
    severity: trajectorySeverity(KEY),
    direction: "positive",
    polarity: "positive",
    temporalClass: "EVENT",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "T4",
      name: "Recovering Out of Below Par",
      compositePrior: r1(c.prev),
      compositeNow: r1(c.now),
      crossedAbove: T4_STEADY_FLOOR,
      isCrossing: true,
      priorPeriod: c.priorPeriodKey,
      ...TIER_MAGNITUDE_CAVEAT,
      // ★ THE CAVEAT AS DATA — every surface can see it, none can drop it
      sampleSizePreserved: false,
      evidencedN: null,
      directionalOnly: true,
      caveat: "Sample size was not preserved for this cell. Treat as directional and re-verify before giving it prominence.",
      readingPct: 6.6,
      stressedPct: 22.1,
      calibration: CALIBRATION_NOTE,
    },
    metricRefs: ["composite"],
  };
};
