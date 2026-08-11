// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// COALESCING FIXTURES — one fired set per reachable case from the ruling's §5 table.
//
// ★ WHY FIXTURES AND NOT LIVE DATA. Three of the four pattern coalescings do not occur in the current
// universe, and D6+D7 — the case the ruling was written for — has never occurred. A gate that only
// exercised live rows would assert nothing about them, and they would ship unverified. A fixture is
// also the only honest way to test D6+D7 at all: seeding a synthetic snapshot would put a stock that
// does not exist into the real universe.
//
// ⚠ THE FIRED SETS HERE ARE THE ENGINE'S OWN SHAPE. Each constituent's evidence carries the fields its
// RULE actually stamps (read off scoring/findings/rules/*.ts), because the coalescer hoists exactly
// those and the lifecycle service reads them by name. A fixture with an invented field would prove the
// merge works on data no rule produces.
//
// Shared by verify-coalescing.ts; kept here rather than inside it for verdict-fixtures.ts's reason —
// a second consumer must not need its own copy that can disagree about "the same input".
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { FiredFinding } from "../../scoring/findings/fired-finding.types.js";

export interface CoalesceFixture {
  label: string;
  /** The fired set the engine would hold BEFORE coalescing. */
  fired: FiredFinding[];
  /** The key the constituents must collapse into. */
  expectEntry: string;
  /** Constituent keys that must NO LONGER appear as separate entries. */
  expectAbsent: string[];
  /** `claim_source` on the merged evidence — null where the ruling says none may speak. */
  expectClaimSource: string | null;
  /** `evidenceBasis` on the merged evidence. */
  expectEvidenceBasis: string;
  /** Every mark the one move passed, ascending — the "named as facts" guarantee. */
  expectMarks: number[];
}

/** D6's fired shape at Foundation 72, Momentum 53 from a prior 75 — the ruling's own witness. */
const d6: FiredFinding = {
  kind: "pattern",
  key: "divergence_D6_quality_rolling_over",
  severity: "high",
  direction: "negative",
  polarity: "negative",
  temporalClass: "EVENT",
  magnitude: null,
  displayState: "active",
  evidence: {
    card: "D6",
    name: "Quality Rolling Over",
    foundation: 72,
    momentum: 53,
    momentumPrior: 75,
    momentumFallPp: 22,
    crossedBelow: 75,
    foundationMin: 72,
    gapPp: 19,
    gapTierApplies: false,
    isCrossing: true,
  },
};

/** D7 on the SAME move — the same prior reading, the lower mark. This is the whole point: one move. */
const d7: FiredFinding = {
  kind: "pattern",
  key: "divergence_D7_trajectory_breaking_base_holds",
  severity: "medium",
  direction: "negative",
  polarity: "negative",
  temporalClass: "EVENT",
  magnitude: null,
  displayState: "active",
  evidence: {
    card: "D7",
    name: "Trajectory Breaking While the Base Holds",
    foundation: 72,
    momentum: 53,
    momentumPrior: 75,
    momentumFallPp: 22,
    crossedBelow: 54,
    foundationMin: 60,
    gapPp: 19,
    gapTierApplies: false,
    isCrossing: true,
  },
};

/** S2 on the same pair — present to prove it does NOT block the merge and is not consumed by it. */
const s2: FiredFinding = {
  kind: "pattern",
  key: "divergence_S2_sticky_divergence",
  severity: "low",
  direction: null,
  magnitude: null,
  displayState: "active",
  evidence: { card: "S2", name: "Sticky Divergence", tier: "extreme", gapPp: 19, foundation: 72, momentum: 53, sustainedReadings: 3 },
};

const t2: FiredFinding = {
  kind: "pattern",
  key: "trajectory_B_T2_deterioration_high_base",
  severity: "high",
  direction: "negative",
  magnitude: null,
  displayState: "active",
  evidence: { card: "T2", name: "Deterioration from a High Base", compositeNow: 71, compositePrior: 78, movePp: -7 },
};

const t3: FiredFinding = {
  kind: "pattern",
  key: "trajectory_B_T3_falling_out_of_pristine",
  severity: "high",
  direction: "negative",
  magnitude: null,
  displayState: "active",
  evidence: { card: "T3", name: "Falling Out of Pristine", compositeNow: 71, crossedBelow: 74, isCrossing: true },
};

const t1: FiredFinding = {
  kind: "pattern",
  key: "trajectory_D_T1_recovery_low_zone",
  severity: "recovery",
  direction: "positive",
  magnitude: null,
  displayState: "active",
  evidence: { card: "T1", name: "Recovery from the Low Zone", compositeNow: 64, compositePrior: 56, movePp: 8 },
};

const t4: FiredFinding = {
  kind: "pattern",
  key: "trajectory_D_T4_recovering_out_of_below_par",
  severity: "recovery",
  direction: "positive",
  magnitude: null,
  displayState: "active",
  evidence: { card: "T4", name: "Recovering Out of Below Par", compositeNow: 64, crossedAbove: 62, isCrossing: true },
};

const t5: FiredFinding = {
  kind: "pattern",
  key: "trajectory_D_T5_foundation_out_of_weak",
  severity: "recovery",
  direction: "positive",
  magnitude: null,
  displayState: "active",
  evidence: { card: "T5", name: "Foundation Growing Out of the Weak Zone", foundationNow: 74, foundationPrior: 55, movePp: 19, crossedAbove: 60, isCrossing: true },
};

const t8: FiredFinding = {
  kind: "pattern",
  key: "trajectory_D_T8_foundation_strong_improving",
  severity: "recovery",
  direction: "positive",
  magnitude: null,
  displayState: "active",
  evidence: { card: "T8", name: "Foundation Strong and Still Improving", foundationNow: 74, risePp: 19, crossedAbove: 72 },
};

/** A pattern on a DIFFERENT pair — proves the coalescer touches only its own constituents. */
const d2: FiredFinding = {
  kind: "pattern",
  key: "divergence_D2_price_ahead_trajectory",
  severity: "high",
  direction: "negative",
  magnitude: null,
  displayState: "active",
  evidence: { card: "D2", name: "Price Ahead of Trajectory", gapPp: 30, market: 80, momentum: 50 },
};

export const COALESCE_FIXTURES: CoalesceFixture[] = [
  {
    // ★ THE RULING'S OWN CASE. Momentum ≥75 → <54 with Foundation ≥72, passing BOTH marks in one step.
    //   `claim_source: null` and `described` — neither constituent earned the right to speak, because
    //   the combined configuration sits outside both observed populations.
    label: "D6 + D7 → Trajectory Collapse (described, no claim) · S2 and D2 untouched",
    fired: [d6, d7, s2, d2],
    expectEntry: "divergence_D6_D7_trajectory_collapse",
    expectAbsent: ["divergence_D6_quality_rolling_over", "divergence_D7_trajectory_breaking_base_holds"],
    expectClaimSource: null,
    expectEvidenceBasis: "described",
    expectMarks: [54, 75],
  },
  {
    label: "T2 + T3 → Deterioration out of the top band (claim resolves on phase)",
    fired: [t2, t3],
    expectEntry: "trajectory_B_T2_T3_deterioration_out_of_top_band",
    expectAbsent: ["trajectory_B_T2_deterioration_high_base", "trajectory_B_T3_falling_out_of_pristine"],
    expectClaimSource: "trajectory_B_T3_falling_out_of_pristine",
    expectEvidenceBasis: "inherited",
    expectMarks: [74],
  },
  {
    label: "T1 + T4 → Recovery out of the low zone (T1 speaks; T4 a fact)",
    fired: [t1, t4],
    expectEntry: "trajectory_D_T1_T4_recovery_out_of_low_zone",
    expectAbsent: ["trajectory_D_T1_recovery_low_zone", "trajectory_D_T4_recovering_out_of_below_par"],
    expectClaimSource: "trajectory_D_T1_recovery_low_zone",
    expectEvidenceBasis: "inherited",
    expectMarks: [62],
  },
  {
    label: "T5 + T8 → Foundation weak to strong (described on R1 grounds)",
    fired: [t5, t8],
    expectEntry: "trajectory_D_T5_T8_foundation_weak_to_strong",
    expectAbsent: ["trajectory_D_T5_foundation_out_of_weak", "trajectory_D_T8_foundation_strong_improving"],
    expectClaimSource: null,
    expectEvidenceBasis: "described",
    expectMarks: [60, 72],
  },
];

/**
 * ★ NEGATIVE CONTROLS — sets that must NOT coalesce. A merge rule with no negative control is
 * indistinguishable from one that merges everything.
 */
export const COALESCE_NEGATIVE_FIXTURES: { label: string; fired: FiredFinding[] }[] = [
  { label: "D6 alone does not become the coalesced entry", fired: [d6] },
  { label: "D7 alone does not become the coalesced entry", fired: [d7] },
  { label: "D6 with an unrelated pattern (D2) does not coalesce", fired: [d6, d2] },
  { label: "T2 alone does not coalesce", fired: [t2] },
  { label: "S2 alone is never consumed", fired: [s2] },
];
