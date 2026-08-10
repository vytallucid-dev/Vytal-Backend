// File: src/scoring/findings/rules/t5-foundation-out-of-weak.ts
//
// T5 · FOUNDATION GROWING OUT OF THE WEAK ZONE. Vytal_Trajectory_Tool_Spec Part 3, T5.
// Display-only · magnitude null · nothing rescores.
//
//     Foundation_prev < 60  AND  Foundation_now ≥ 60
//
// Genuine balance-sheet improvement has pushed the business past its weak mark. The cleanest and most
// consistent of all the pillar-trajectory readings, and the strongest of the nine zone-stories tested.
//
// ── EVIDENCE ──────────────────────────────────────────────────────────────────────────────────────
// +3.2%, 71% positive over 15 days from the results disclosure (n=31). On a sector-excess basis the
// SMALL-move version returned +1.9%, 64% positive.
//
// ── ★ THE SIZE NOTE IS THE R1 CASE IN MINIATURE — AND IT IS ON THIS CARD ─────────────────────────
// "Consistent with §1.3 — the SMALL Foundation gains carried this drift; gains of 15+ points did
// nothing." (1–3 pts → +1.9%, 64% positive · 4–10 → −0.2%, 50% · 15+ → −0.5%, 50%, n=4.)
// So a reader looking at a 20-point Foundation jump must not be told it is a stronger version of this
// pattern. It is the version the evidence found NOTHING in. `smallMoveCarriedTheDrift` is stamped so
// the copy can say that, and severity comes from trajectorySeverity() which cannot see the delta.
//
// ── NATIVE PILLAR ZONE ────────────────────────────────────────────────────────────────────────────
// 60 is Foundation's OWN weak mark, declared on T5's record, never a composite band. §1.2's
// prohibition is live here: borrowing a composite value for a pillar flipped T6's sign.
//
// ── ★ NOT EPSILON-GATED, AND VERIFIED THAT IT SHOULDN'T BE ────────────────────────────────────────
// The epsilon fix (prev-now.ts) covers T7/T8/T9, which gate on a bare delta SIGN — `f.delta > 0` /
// `< 0` with no boundary. T5 has no such gate: it is `f.prev < 60 AND f.now >= 60`, a genuine
// CROSSING against a fixed boundary 60 points from either operand's typical range. The diagnostic
// that found the T7/T8/T9 bug explicitly ruled crossings out (noise at the ~1e-4 level cannot
// manufacture a crossing of a boundary that far away), and this file's own gate confirms there is no
// delta-sign comparison here to protect. Recorded so the next reader doesn't add one "for symmetry."
//
// ── REGIME · TIER 3 (magnitude caveat) ────────────────────────────────────────────────────────────

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { pillarPrevNow } from "../trajectory/prev-now.js";
import { TIER_MAGNITUDE_CAVEAT, trajectorySeverity } from "../trajectory/regime-tier.js";
import { CALIBRATION_NOTE } from "../trajectory/view.js";
import { distinctAtPrecision, roundToPrecision } from "../format.js";
import type { FireRule } from "../types.js";

/** ★ THE RECORD, NOT A RE-TYPED STRING — see d1-price-ahead-quality.ts for the full note. */
const ENTRY = STOCK_FINDINGS.trajectory_D_T5_foundation_out_of_weak;
const FACTS = ENTRY.facts;

/** Foundation's NATIVE weak mark — never the composite's. Declared on T5's own record. */
export const T5_FOUNDATION_WEAK = FACTS.evidencedTier; // 60

/** ★ ONE FORMATTER, THE PATTERN'S OWN PRECISION — see d1-price-ahead-quality.ts's full note. */
const round = (x: number) => roundToPrecision(x, FACTS.displayPrecision);

export const ruleT5: FireRule = (ctx) => {
  const f = pillarPrevNow(ctx, "foundation");
  if (!f) return null;
  if (f.prev >= T5_FOUNDATION_WEAK) return null; // was not weak
  if (f.now < T5_FOUNDATION_WEAK) return null;   // has not crossed up
  // ★ THE DISPLAY-PRECISION GATE ("Ruling 3 on T9" — format.ts). REAL effect — T5 is a crossing with
  // no minimum-margin floor of its own, same shape as T3/T4/T6.
  if (!distinctAtPrecision(f.prev, f.now, FACTS.displayPrecision)) return null;

  return {
    kind: "pattern",
    key: ENTRY.key,
    severity: trajectorySeverity(ENTRY.key), // ★ R1 — cannot see f.delta
    direction: "positive",
    polarity: "positive",
    temporalClass: "EVENT",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "T5",
      name: "Foundation Growing Out of the Weak Zone",
      foundationPrior: round(f.prev),
      foundationNow: round(f.now),
      movePp: round(f.delta),
      crossedAbove: T5_FOUNDATION_WEAK,
      isCrossing: true,
      priorPeriod: f.priorPeriodKey,
      ...TIER_MAGNITUDE_CAVEAT,
      evidencedPct: 3.2,
      evidencedPositivePct: 71,
      evidencedN: 31,
      smallMoveSectorExcessPct: 1.9,
      smallMovePositivePct: 64,
      // ★ R1 on this card specifically: the drift belongs to the SMALL moves
      smallMoveCarriedTheDrift: true,
      largeMoveDidNothing: "Gains of 15+ points returned −0.5%, 50% positive (n=4). A bigger move is not a bigger signal.",
      calibration: CALIBRATION_NOTE,
    },
  };
};
