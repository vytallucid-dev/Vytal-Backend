// File: src/scoring/findings/rules/t8-foundation-strong-improving.ts
//
// T8 · FOUNDATION STRONG AND STILL IMPROVING. Vytal_Trajectory_Tool_Spec Part 3, T8.
// Display-only · magnitude null · nothing rescores.
//
//     Foundation_now ≥ 72  AND  Foundation_now > Foundation_prev
//
// A business that was already sound is getting sounder. Rare, and one of the few consistently
// positive readings on the strong side of the range.
//
// ── ★ THE RISE IS EPSILON-GATED, THEN MOVEMENT-FLOOR-GATED ───────────────────────────────────────
// TWO gates, in order — same shape as T7, see its header for the full note:
//   1. `movedUp()` — epsilon-gated (TRAJECTORY_DELTA_EPSILON, 0.0001), rejects persistence
//      round-trip noise. The same rescore that surfaced T9's bug found 5 of 11 T8 fires carrying
//      `risePp: 0` — Foundation hadn't moved; a tolerance-free `> 0` treated noise as a real rise.
//   2. `f.delta < T8_MOVEMENT_FLOOR` — ★ THE MOVEMENT-FLOOR RULING: now a FIRING gate, requiring an
//      actual rise of at least 1.0pp. Epsilon still decides direction; it no longer decides firing.
//
// ── EVIDENCE ──────────────────────────────────────────────────────────────────────────────────────
// +5.8%, 69% positive at 15 days (n=17); +4.6%, 71% positive at 7 days; +2.4%, 65% positive on the day.
//
// ── ★ THIS IS A LEVEL-AND-DIRECTION PATTERN, NOT A CROSSING ──────────────────────────────────────
// T8 does not require Foundation to have CROSSED 72 this period — only to be at or above it and
// higher than last reading. A stock sitting at 80 and rising to 82 fires it; that is the intent
// ("already strong, still strengthening"). The crossing INTO strong is a different condition, and
// Part 5 excludes it explicitly: "Foundation growing into strong (≥72) — +6.0%, 67%; a single +59%
// outlier drove the mean." So T8 must NOT be implemented as a cross, or it becomes the excluded one.
//
// ── ⚠ R1 — AND THE SIZE NOTE CUTS AGAINST THE INTUITION HERE TOO ─────────────────────────────────
// A larger Foundation improvement is not a stronger reading (1–3 pts drifted +1.9%/64%; 15+ did
// nothing). Severity is from trajectorySeverity(), which cannot see the delta.
//
// ── NATIVE PILLAR ZONE ────────────────────────────────────────────────────────────────────────────
// 72 is Foundation's OWN strong mark, declared on T8's record, never a composite band.
//
// ── REGIME · TIER 3 (magnitude caveat) ────────────────────────────────────────────────────────────

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { pillarPrevNow, movedUp } from "../trajectory/prev-now.js";
import { TIER_MAGNITUDE_CAVEAT, trajectorySeverity } from "../trajectory/regime-tier.js";
import { CALIBRATION_NOTE } from "../trajectory/view.js";
import { distinctAtPrecision, roundToPrecision } from "../format.js";
import type { FireRule } from "../types.js";

/** ★ THE RECORD, NOT A RE-TYPED STRING — see d1-price-ahead-quality.ts for the full note. */
const ENTRY = STOCK_FINDINGS.trajectory_D_T8_foundation_strong_improving;
const FACTS = ENTRY.facts;

/** Foundation's NATIVE strong mark — never the composite's. From T8's own record. */
export const T8_FOUNDATION_STRONG = FACTS.evidencedTier; // 72
/** ★ NOW A FIRING GATE — see t7-momentum-improving-while-weak.ts's header for the full note. */
export const T8_MOVEMENT_FLOOR = FACTS.movementFloor; // 1.0 — enforced

/** ★ ONE FORMATTER, THE PATTERN'S OWN PRECISION — see d1-price-ahead-quality.ts's full note. */
const round = (x: number) => roundToPrecision(x, FACTS.displayPrecision);

export const ruleT8: FireRule = (ctx) => {
  const f = pillarPrevNow(ctx, "foundation");
  if (!f) return null;
  if (f.now < T8_FOUNDATION_STRONG) return null; // not on the strong side
  if (!movedUp(f.delta)) return null;            // not still improving — epsilon-gated, see prev-now.ts
  if (f.delta < T8_MOVEMENT_FLOOR) return null;  // ★ real but too small — the movement-floor ruling
  // ★ THE DISPLAY-PRECISION GATE ("Ruling 3 on T9" — format.ts). Defensive here — see T7's identical
  // note; the enforced 1.0pp movement floor already sits above the rounding granularity.
  if (!distinctAtPrecision(f.prev, f.now, FACTS.displayPrecision)) return null;

  return {
    kind: "pattern",
    key: ENTRY.key,
    severity: trajectorySeverity(ENTRY.key), // ★ R1 — cannot see f.delta
    direction: "positive",
    polarity: "positive",
    temporalClass: "CONDITION", // a standing state (strong AND rising), not a dated crossing
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "T8",
      name: "Foundation Strong and Still Improving",
      foundationPrior: round(f.prev),
      foundationNow: round(f.now),
      risePp: round(f.delta),
      strongMark: T8_FOUNDATION_STRONG,
      // ★ NOT a crossing — the cross INTO strong is on the excluded list (a +59% outlier drove it)
      isCrossing: false,
      crossIntoStrongIsExcluded: true,
      priorPeriod: f.priorPeriodKey,
      ...TIER_MAGNITUDE_CAVEAT,
      evidencedPct: 5.8,
      evidencedPositivePct: 69,
      evidencedN: 17,
      sevenDayPct: 4.6,
      sevenDayPositivePct: 71,
      sameDayPct: 2.4,
      sameDayPositivePct: 65,
      calibration: CALIBRATION_NOTE,
    },
    metricRefs: ["foundation"],
  };
};
