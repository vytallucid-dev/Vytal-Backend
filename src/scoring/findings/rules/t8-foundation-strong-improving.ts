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
// ── ★ THE RISE IS EPSILON-GATED ───────────────────────────────────────────────────────────────────
// `movedUp()` (trajectory/prev-now.ts), not a bare `f.delta <= 0`. The same rescore that surfaced
// T9's bug found 5 of 11 T8 fires carrying `risePp: 0` — Foundation hadn't moved; live-vs-persisted
// rounding noise satisfied a tolerance-free `> 0`. See prev-now.ts's header for the full incident.
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
// 72 is Foundation's OWN strong mark (NATIVE_ZONES.foundation.strong), never a composite band.
//
// ── REGIME · TIER 3 (magnitude caveat) ────────────────────────────────────────────────────────────

import { pillarPrevNow, movedUp } from "../trajectory/prev-now.js";
import { TIER_MAGNITUDE_CAVEAT, trajectorySeverity } from "../trajectory/regime-tier.js";
import { CALIBRATION_NOTE } from "../trajectory/view.js";
import { NATIVE_ZONES } from "../thresholds.js";
import type { FireRule } from "../types.js";

/** Foundation's NATIVE strong mark — never the composite's. */
export const T8_FOUNDATION_STRONG = NATIVE_ZONES.foundation.strong; // 72

const KEY = "trajectory_D_T8_foundation_strong_improving";
const r1 = (x: number) => Math.round(x * 10) / 10;

export const ruleT8: FireRule = (ctx) => {
  const f = pillarPrevNow(ctx, "foundation");
  if (!f) return null;
  if (f.now < T8_FOUNDATION_STRONG) return null; // not on the strong side
  if (!movedUp(f.delta)) return null;            // not still improving — epsilon-gated, see prev-now.ts

  return {
    kind: "pattern",
    key: KEY,
    severity: trajectorySeverity(KEY), // ★ R1 — cannot see f.delta
    direction: "positive",
    polarity: "positive",
    temporalClass: "CONDITION", // a standing state (strong AND rising), not a dated crossing
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "T8",
      name: "Foundation Strong and Still Improving",
      foundationPrior: r1(f.prev),
      foundationNow: r1(f.now),
      risePp: r1(f.delta),
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
