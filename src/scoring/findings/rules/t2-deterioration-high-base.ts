// File: src/scoring/findings/rules/t2-deterioration-high-base.ts
//
// T2 · DETERIORATION FROM A HIGH BASE. Vytal_Trajectory_Tool_Spec Part 2, T2.
// Display-only · magnitude null · nothing rescores.
//
//     Composite_prev ≥ 70  AND  (Composite_now − Composite_prev) ≤ −6
//
// A business that was sound is measurably weakening. The mirror of T1, and the more important one for
// risk — this is the score doing the job a health score exists to do.
//
// ── ★ REGIME · TIER 2 — THE PHASE MUST ALWAYS BE DISPLAYED ────────────────────────────────────────
// This is the only Tier-2 pattern, and the reason is specific and serious: in the 2021–26 bank bull
// T2 showed a FALSE +15%. It is masked in one-way rallies and reads true when risk is two-sided —
// the 2017–21 neutral two-sided window had composite-deterioration events coinciding with −35.9%
// mean price, EVERY case negative (min −69%).
// So T2 fires in every phase (regime never gates display) but the card must ALWAYS show which phase
// it fired in. A T2 shown without its phase is a number the reader cannot weigh: the same card means
// "−35.9%, every case negative" in a two-sided market and "+15%, masked" in a one-way rally.
// The spec also supplies a HOT-appended sentence — carried by the verdict layer.
//
// ── EVIDENCE ──────────────────────────────────────────────────────────────────────────────────────
// −6.1% median, 79% of cases FELL in the same window (n=28).
//
// ── ⚠ Δ IS THE TRIGGER, NEVER THE SEVERITY (Part 4 · R1) ─────────────────────────────────────────

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { compositePrevNow } from "../trajectory/prev-now.js";
import { TIER_ALWAYS_DISPLAY, trajectorySeverity } from "../trajectory/regime-tier.js";
import { CALIBRATION_NOTE } from "../trajectory/view.js";
import { distinctAtPrecision, roundToPrecision } from "../format.js";
import type { FireRule } from "../types.js";

/** ★ THE RECORD, NOT A RE-TYPED STRING — see d1-price-ahead-quality.ts for the full note. */
const ENTRY = STOCK_FINDINGS.trajectory_B_T2_deterioration_high_base;
const FACTS = ENTRY.facts;

export const T2_PREV_MIN = FACTS.evidencedTier;   // 70 — the high base
/** ★ THE SIGN IS THE PATTERN'S, NOT THE RECORD'S. `movementFloor` declares the MAGNITUDE a move must
 *  reach (6, the same §1.2 event threshold T1 uses); which direction counts is what makes T2 the
 *  mirror of T1, and that belongs in the rule, not in a signed number in the catalogue. */
export const T2_MIN_FALL = -FACTS.movementFloor; // -6

/** ★ ONE FORMATTER, THE PATTERN'S OWN PRECISION — see d1-price-ahead-quality.ts's full note. */
const round = (x: number) => roundToPrecision(x, FACTS.displayPrecision);

export const ruleT2: FireRule = (ctx) => {
  const c = compositePrevNow(ctx);
  if (!c) return null;
  if (c.prev < T2_PREV_MIN) return null;    // not from a high base
  if (c.delta > T2_MIN_FALL) return null;   // drift, not a trajectory event
  // ★ THE DISPLAY-PRECISION GATE ("Ruling 3 on T9" — format.ts). Defensive here — see T1's note; the
  // mirror threshold is the same magnitude, same distance above the rounding granularity.
  if (!distinctAtPrecision(c.prev, c.now, FACTS.displayPrecision)) return null;

  return {
    kind: "pattern",
    key: ENTRY.key,
    severity: trajectorySeverity(ENTRY.key), // ★ R1 — cannot see c.delta
    direction: "negative",
    polarity: "negative",
    temporalClass: "EVENT",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "T2",
      name: "Deterioration from a High Base",
      compositePrior: round(c.prev),
      compositeNow: round(c.now),
      movePp: round(c.delta),
      prevMin: T2_PREV_MIN,
      minFall: T2_MIN_FALL,
      isMovePattern: true,
      priorPeriod: c.priorPeriodKey,
      // ★ Tier 2 — the phase is not optional decoration on this card
      ...TIER_ALWAYS_DISPLAY,
      mustDisplayPhase: true,
      evidencedMedianPct: -6.1,
      evidencedFellPct: 79,
      evidencedN: 28,
      twoSidedWindowMeanPct: -35.9, // 2017–21 neutral window: every case negative, min −69%
      twoSidedAllNegative: true,
      bullMaskedReading: 15.0,       // the FALSE +15% in the 2021–26 bank bull
      calibration: CALIBRATION_NOTE,
    },
    metricRefs: ["composite"],
  };
};
