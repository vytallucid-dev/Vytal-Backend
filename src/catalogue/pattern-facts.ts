// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PATTERN FACTS — the DECLARED, pattern-defining facts for the divergence (D/S) and trajectory (T)
// families. One record per pattern, total over a closed key union, bound to the rules at COMPILE TIME.
//
// ── ★ WHY THIS MODULE EXISTS ──────────────────────────────────────────────────────────────────────
// The catalogue already centralised pattern COPY. It did not centralise pattern FACTS. Every surface
// that needed one — which pillars a pattern compares, what threshold it fires at, what the regime does
// to it, how many decimals its numbers are shown at — DERIVED it locally, and those derivations
// disagreed with each other and with the finding:
//
//   the rule fires at Momentum's native weak mark (54)          scoring/findings/rules/t6-*.ts
//   the read layer re-declares 54 in its own NATIVE_MARKS map   scoring/read/health-view.service.ts
//   the tool page picks the widest scored pair with its own      Vytal-Frontend/…/divergence-data.ts
//     `pickScoredPair`, unaware which pair the finding is about
//   the verdict formats the same gap at 0 decimals, the tool     scoring/findings/verdicts.ts
//     chart at 1, the readout at 0
//
// A fact with four homes is a fact with four values the day one of them is edited. So: ONE record per
// pattern, here, and the rule reads its own thresholds off it.
//
// ── ★ WHAT A "FACT" IS, AND WHAT IT IS NOT ────────────────────────────────────────────────────────
// A fact is what MAKES the pattern the pattern: its pillars, its basis, its floors, its evidenced
// tier, its regime map, its measured stats, its display precision. It is NOT copy (stock-findings.ts),
// NOT a fired instance's evidence (the rule stamps that), and NOT a severity token (regime-tier.ts /
// divergence/bands.ts own that, and they are deliberately opposite — see the R1 note there).
//
// ── ★ WHAT IS SERVED, AND WHAT IS NOT (corrected) ─────────────────────────────────────────────────
// `StockFindingEntry.facts` is NARROWED to `{ pillarPair, basis, displayPrecision }` by
// catalogue/serialise.ts before the document is built — see `ServedPatternFacts` below. Those three
// are DISPLAY GEOMETRY (which pillars a chart draws, what shape the trigger is, how many decimals to
// print) — a reading surface needs them and none of them discloses a bar. Everything else here —
// every gapFloor, movementFloor, evidencedTier, leg value, sustainReadings, regimeMap, evidenceStats —
// IS a scoring bar (the catalogue endpoint's stated boundary forbids serving those) and stays
// engine-side only.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { Pillar } from "../scoring/composite/types.js";
import type { Regime } from "../scoring/regime/regime.js";

// ── the vocabulary ─────────────────────────────────────────────────────────────────────────────────

/**
 * What `pillarPair` may name. Every divergence pattern (D1–D7, S2, S1) is genuinely about a pair (or,
 * for S1, all four) of real pillars. The trajectory COMPOSITE patterns (T1–T4) are not about any
 * pillar pair at all — they are about the composite score moving along its own path — so `"composite"`
 * is admitted as the one non-pillar member this field can carry.
 */
export type PatternSubject = Pillar | "composite";

/**
 * What the pattern is ABOUT — the shape of its trigger, not its wording.
 *
 *   gap        a STANDING distance between two (or, for S1, four) pillars. §1.2's severity scale
 *              applies: 12–15 material · 16–24 stretched · 25+ extreme.
 *   movement   a Δ between two adjacent readings — of a pillar, of the composite, or of ownership.
 *              The §1.2 gap scale must NOT be applied (Trajectory §1.3 inverts it outright).
 *   crossing   a boundary crossed between two adjacent readings. Defined by the boundary, never by
 *              the size of the move; no severity gradient (Divergence D6/D7, Trajectory T3–T6).
 *   level      a standing level with no second pillar and no Δ. Declared for completeness; no pattern
 *              in the ruled set uses it today.
 */
export type PatternBasis = "gap" | "movement" | "crossing" | "level";

/**
 * What the market phase does to a pattern's directional claim.
 *
 *   reads_true             the measured claim stands in this phase.
 *   masked                 the phase hides or inverts it (T2's false +15% in the 2021–26 bank bull;
 *                          T6's +9.6% in HOT; D1/D2's +9.6% "still paying" in HOT).
 *   no_directional_read    the evidence supports NO direction in this phase. Trajectory §1.4 line 87
 *                          is binding here: show the crossing regardless, and say plainly that the
 *                          phase carries no read rather than asserting one.
 *
 * ⚠ NO GLOBAL DEFAULT. The two Tier-1 trajectory patterns point OPPOSITE ways — T3 reads in HOT and
 * is blank in NORMAL; T6 reads in NORMAL and is masked in HOT — which is exactly why the Trajectory
 * spec calls the regime mapping "a required field per pattern".
 */
export type RegimeRead = "reads_true" | "masked" | "no_directional_read";

/** Total over the three phases. A phase cannot be omitted — an omitted phase is an unstated claim. */
export type RegimeMap = Readonly<Record<Regime, RegimeRead>>;

/**
 * The relaxed register: below `threshold` the pattern still fires, but the study's claim may NOT be
 * spoken, and `floor` is the smallest movement/gap that may surface at all. Null ⇒ the pattern is
 * STRICT: it fires at its evidenced tier or not at all (D5, D6, D7, S1, S2 and every T pattern).
 */
export interface RelaxedTier {
  readonly threshold: number;
  readonly floor: number;
}

/**
 * The pattern's own measured population.
 *
 * `hitRatePct` is PERCENT POSITIVE — the share of cases whose price ROSE — the same quantity every
 * rule already stamps as `evidencedPositivePct`. One meaning across all records, so a bearish
 * pattern's 42 and a bullish pattern's 81 are the same measurement, not two conventions.
 * `effectPct` is the pattern's headline size (sector-excess where the study gave one, else the
 * absolute/median figure the spec quotes).
 * `measured: false` ⇒ this pattern has NO measurement of its own — D1/D2 inherit theirs from the
 * shared n=79 configuration, and S2 carries no return claim at all.
 */
/**
 * ★ FORMED / BUILDING / ABSENT — the ruling, and the correction it makes.
 *
 * ── ⚠ THE THRESHOLD WAS BEING USED BACKWARDS ─────────────────────────────────────────────────────
 * D1–D4 treated their thresholds as GATES: cross them and the pattern exists, miss them and it does
 * not. That inverts what the pattern is. The pattern IS THE SHAPE — Market elevated against a weak
 * fundamental pillar. Where the pillars sit relative to their thresholds decides HOW LOUDLY IT
 * SPEAKS, not WHETHER it speaks.
 *
 * GLENMARK is the case: a 43-point Market↔Momentum gap rendered "no pattern" because the rule gated
 * at Market ≥ 74 while the evidenced configuration is 68. It was Formed the whole time.
 *
 *   formed     both legs past their evidenced thresholds. The measured/inherited claim may be spoken.
 *   building   the shape holds, but at least one leg has not crossed. NO claim of any kind.
 *   absent     the shape does not hold — it is not a weaker version of the pattern, it is not the
 *              pattern. Nothing surfaces.
 *
 * ⚠ `absent` IS NOT A STATE A FINDING CARRIES. It is the answer "this did not fire", and a rule
 * returning it returns null. It is named here so the three-way decision is total in one place rather
 * than being half a boolean and half an early return.
 */
export type PatternState = "formed" | "building" | "absent";

/**
 * ★ THE THIRD EVIDENCE MARKING. There were two, and Building is neither of them.
 *
 *   measured    this pattern's own population was measured. The figures are its own.
 *   inherited   measured on a DIFFERENT configuration and carried across — D1/D2's n=79, which
 *               measured Market against the combined fundamental average, so neither half has a
 *               reading of its own but both know the direction.
 *   described   NOT MEASURED AT ALL, anywhere, by anyone. The shape is named and its quantities are
 *               stated; nothing is claimed about what follows.
 *   tested_not_shipped
 *               ★ NEW. The model LOOKED, measured, and DECLINED. The configuration was tested and
 *               deliberately not shipped — the not-covered registry (catalogue/not-covered.ts).
 *
 * ⚠ WHY `described` MUST NOT COLLAPSE INTO `inherited`. "Measured elsewhere" and "not measured" are
 * different epistemic positions, and the whole point of the inherited marking was to stop a borrowed
 * figure reading as an owned one. Filing Building under `inherited` would undo exactly that: it would
 * license the n=79 direction on a stock whose legs are not in the n=79 configuration. Building has no
 * evidence base, so it gets a marking that says so.
 *
 * ⚠ AND WHY `tested_not_shipped` IS NOT `described` EITHER. `described` is "we never looked at this".
 * `tested_not_shipped` is "we looked, we have a number, and the number is why you are not getting a
 * read." Collapsing them would erase the single most useful thing a not-covered note says — that the
 * silence is a DECISION rather than a gap. They are opposite claims about our own diligence.
 */
export type EvidenceBasis = "measured" | "inherited" | "described" | "tested_not_shipped";

export interface EvidenceStats {
  readonly n: number | null;
  readonly hitRatePct: number | null;
  readonly effectPct: number | null;
  /** ⚠ Replaces the old `measured: boolean`. A boolean could not express `described` — see above. */
  readonly basis: EvidenceBasis;
}

/** One comparison op a leg may use. */
export type PatternLegOp = ">=" | ">" | "<" | "<=";

/**
 * One current-value threshold condition on a real pillar — `{foundation, "<", 58}` reads "Foundation
 * is currently below 58". A leg is a fact about the CURRENT reading only: it cannot express a movement
 * (that is `movementFloor`) or a prior-reading requirement (a crossing's "was previously ≥ X", which
 * is inherently about two points in time and has no single-value shape). `pillar` is a real `Pillar`
 * only — never `"composite"` — because every pattern that declares legs triggers on real pillar
 * levels, not the composite.
 */
export interface PatternLeg {
  readonly pillar: Pillar;
  readonly op: PatternLegOp;
  readonly value: number;
}

/**
 * Whether a declared `movementFloor` is itself a measured/ruled number, or a stand-in awaiting
 * calibration. `null` when the pattern has no movementFloor at all (nothing to characterise).
 */
export type FloorBasis = "measured" | "provisional";

/**
 * What a declared `movementFloor` actually DOES to the rule that reads it.
 *
 *   firing     the rule refuses to fire below the floor — a hard gate on the fired set.
 *   register   the floor selects which language a firing instance may use (evidence register),
 *              never whether it fires. Declared for completeness; no pattern in the ruled set uses
 *              this today — every register selector in the live set keys off `evidencedTier`, not
 *              `movementFloor` (see D3/D4's own comments).
 *   none       declared and carried in evidence, but wired to nothing — the number is data, not a
 *              gate of any kind.
 */
export type GateType = "firing" | "register" | "none";

/** The declared, pattern-defining facts. Every field is required — an omitted fact is the defect. */
export interface PatternFacts {
  /** The subject(s) the pattern is ABOUT. Two real pillars for most divergence patterns, all four for
   *  S1, one real pillar for a trajectory pillar-pattern (T5–T9), or `["composite"]` for a trajectory
   *  COMPOSITE pattern (T1–T4), which has no pillar pair at all. */
  readonly pillarPair: readonly PatternSubject[];
  readonly basis: PatternBasis;
  /** The smallest STANDING gap this pattern may surface at. Null when the basis is not a gap. */
  readonly gapFloor: number | null;
  /** The smallest Δ this pattern may surface at. Null when the basis is not a movement. */
  readonly movementFloor: number | null;
  /** Whether `movementFloor` is measured or still provisional. Null iff `movementFloor` is null. */
  readonly floorBasis: FloorBasis | null;
  /** What `movementFloor` actually gates. Null iff `movementFloor` is null. */
  readonly gateType: GateType | null;
  /** The threshold at or above which the study's claim may be SPOKEN. For a crossing this is the
   *  boundary crossed; for a level-gated pattern it is that level; for a movement register it is the
   *  size the measured population was selected on. */
  readonly evidencedTier: number;
  readonly relaxedTier: RelaxedTier | null;
  /** The pattern's complete set of current-value pillar-threshold conditions, or null when the
   *  trigger has no such condition expressible in this shape (a bare movement, or a single-leg
   *  crossing already fully carried by `evidencedTier`/`basis`). See {@link PatternLeg}. */
  readonly legs: readonly PatternLeg[] | null;
  /** The minimum number of CONSECUTIVE readings a state must sustain across before it may surface.
   *  Null for every pattern but S2, the only one with a run-length requirement. */
  readonly sustainReadings: number | null;
  readonly regimeMap: RegimeMap;
  readonly evidenceStats: EvidenceStats;
  /**
   * ★ THE REGISTER THE COPY MUST SPEAK IN — because the reader can no longer see the number.
   *
   * `evidenceStats` (n, hit-rate, effect size) is STILL ON THE RECORD and is still the truth, but it
   * no longer reaches a card: figures were stripped from every D/T verdict. That left a real hole —
   * "this happened" read identically whether it rested on n=226 or n=5, and the reader had no way to
   * tell a measured regularity from a handful of cases.
   *
   * So the confidence carries what the number used to. It is a DECLARED property of the pattern, not
   * a threshold on the stock, and nothing fires or is suppressed by it:
   *
   *   robust       "consistently", "in most of these"          — a measured regularity
   *   directional  "in the few cases of this we have",
   *                "this has tended to"                        — a direction, sample-starved
   *   described    mechanism only, NO consequence clause       — nothing was measured here
   *
   * ⚠ NO STATIC RECORD CARRIES `described`, AND THE VALUE IS STILL REQUIRED IN THE UNION. It is the
   * register of a pattern in the BUILDING state (a runtime fact — the shape holds, the configuration
   * is incomplete, so the measured population does not contain this stock) and of every not-covered
   * record (catalogue/not-covered.ts, which carries its own `evidenceBasis: "tested_not_shipped"`).
   * Both are cases where a pattern that is otherwise robust must speak with no consequence clause at
   * all, which is a property of the INSTANCE, not of the record.
   */
  readonly confidence: PatternConfidence;
  /** Decimals. THE ONLY precision this pattern's numbers are ever formatted at, on any surface. */
  readonly displayPrecision: number;
  /**
   * ★ A COPY-REGISTER CUT — OPTIONAL, because exactly one pattern has one today.
   *
   * Not a firing gate and not `evidencedTier` (T7 already has its own: Momentum's native weak mark,
   * 54 — the ceiling the pattern sits beneath). This is a SECOND, independent cut some patterns need:
   * a size above which the study's own evidence says the move already happened in price before the
   * finding could have been read (Part 4 · R3 — "For large positive Momentum moves, the copy must not
   * imply the user is early"). D3/D4's `evidencedTier` (±8pp) is the precedent for a non-firing,
   * register-selecting number living on this interface rather than beside the rule; this field is the
   * same idea for a cut that isn't `evidencedTier` itself, because T7's `evidencedTier` is already
   * spoken for.
   *
   * ⚠ OPTIONAL, NOT `number | null`. Widening every other field the way `gapFloor`/`movementFloor`
   * are `T | null` would force the other seventeen records to carry an explicit `null` for a fact
   * none of them has — the exact "one flat shape with every field nullable" this module's header (see
   * finding-facts.ts) already rejected once, one level up, for measured-vs-unmeasured. An optional key
   * lets it be ABSENT on every record but T7's, which is what "no other pattern has this cut" actually
   * means, and it changes nothing about how `gapFloor`/`movementFloor`/`evidencedTier`/etc. are typed
   * at the sixteen existing call sites that already read them as non-optional on their own record.
   */
  readonly largeMoveCutPp?: number;
}

/** See {@link PatternFacts.confidence}. */
export type PatternConfidence = "robust" | "directional" | "described";

/** The subset of {@link PatternFacts} the catalogue endpoint serves — see catalogue/serialise.ts.
 *  Display geometry only: which pillars a chart draws, what shape the trigger is, how many decimals
 *  to print. Every threshold field (gapFloor, movementFloor, evidencedTier, legs, regimeMap,
 *  evidenceStats, sustainReadings, floorBasis, gateType) is a scoring bar and is stripped. */
export type ServedPatternFacts = Pick<PatternFacts, "pillarPair" | "basis" | "displayPrecision">;

// ── the universal floor ────────────────────────────────────────────────────────────────────────────

/**
 * ★ THE UNIVERSAL MATERIAL GAP FLOOR (Divergence §1.1). Below this a standing gap carries no
 * demonstrated meaning and must not surface: ≤7 is ALIGNED (proven neutral, −0.1% / 49% positive,
 * n=226) and 8–11 is MINOR ("a gap exists but carries no demonstrated meaning. Do not surface.").
 *
 * ⚠ WHERE IT IS EVIDENCED, AND WHERE IT IS INHERITED. The stickiness that establishes 12 was measured
 * on FOUNDATION ↔ MOMENTUM: at 12+ apart, neither pillar reliably converges at the next reading
 * (median movement ≈ 0). Every OTHER pillar pair inherits it — the number is carried across, not
 * re-measured there. Each record's `gapFloor` says which it is in its own comment.
 *
 * ⚠ RULING 1 — MEASURED BEATS TRANSFERRED. This is a UNIVERSAL floor, inherited by every pattern that
 * has no measurement of its own at a different level. It is NOT a ceiling on a pattern whose OWN
 * evidence was measured at a lower floor — D5's own n=5 population was selected at ≥8, and D5 fires at
 * 8, not 12. Composing `Math.max(ownFloor, MATERIAL_GAP_FLOOR)` for such a pattern would silently let
 * the transferred number override the measured one; the correct rule is that a pattern's own
 * `gapFloor` IS the enforced floor, and this constant is what other patterns inherit ONLY when they
 * have no measurement of their own to prefer.
 */
export const MATERIAL_GAP_FLOOR = 12;

/** The pair MATERIAL_GAP_FLOOR was measured on. Every other pair's gapFloor is inherited from it. */
export const MATERIAL_GAP_FLOOR_EVIDENCED_ON: readonly [Pillar, Pillar] = ["foundation", "momentum"];

/** §1.1 — the alignment ceiling S1 tests against. At or below this the pillars agree. */
export const ALIGNED_GAP_CEILING = 7;

/**
 * ★ THE HIGH SIDE MUST GENUINELY BE HIGH — the Market pillar's panel median.
 *
 * ── WHY THE SHAPE TEST NEEDS A THIRD CONDITION ────────────────────────────────────────────────────
 * Direction plus a 12-point gap is not enough to mean "price has run ahead". Market 55 against
 * Foundation 40 is twelve points apart in the right direction and NOTHING has run ahead — that is two
 * weak pillars, one weaker. Requiring the high side to sit above its own median is what separates
 * "elevated against a laggard" from "both depressed".
 *
 * ── ★ DERIVED, NOT CHOSEN. AND FROZEN, NOT LIVE. ─────────────────────────────────────────────────
 * Measured off the panel: the median Market subtotal across the 94 in-force head snapshots of the
 * scored universe (min 29.9 · p25 53.0 · MEDIAN 64.68 · p75 75.5 · max 88.9). It is a fact about the
 * distribution, not a bar anyone picked.
 *
 * ⚠ IT IS A CONSTANT AND MUST STAY ONE. Recomputing it per request would make a stock's STATE depend
 * on the other stocks in the panel that day — a cross-sectional coupling in a per-stock test, where a
 * name could change state because an unrelated company was rescored. Freezing it means the number
 * moves only when someone re-derives it deliberately, in this file, and says so.
 *
 * ⚠ MARKET-ONLY BY CONSTRUCTION. Market is the high side of the only two patterns that use this test
 * (D1, D2). A future pattern with a different high-side pillar needs ITS pillar's median derived and
 * declared here — it must not borrow this one, which is a fact about Market's distribution alone.
 */
export const MARKET_ELEVATED_FLOOR = 64.68;

// ── the closed pattern-key union ───────────────────────────────────────────────────────────────────

/**
 * Every key that carries pattern facts. Total over the eighteen ruled patterns — the seven divergence
 * patterns, the two divergence states (S1, S2), and the nine trajectory patterns.
 *
 * ★ S1 IS NOW A REAL CATALOGUE KEY (Ruling 3 — S1 is a measured state driving the divergence headline,
 * not a fact with no home). It carries a `never_emitted` status (types.ts's `KeyStatus`): a real entry
 * with real copy and real facts, but — unlike `dormant` (a registered rule that could fire and simply
 * hasn't recently) or `synthesised` (composed by the read layer from OTHER findings) — no rule and no
 * read-layer composition EVER produces it as a fired finding. It is a tool state, read directly by
 * findings/divergence/aligned.ts. A STRICT SUBSET of StockFindingKey is asserted in stock-findings.ts,
 * where both unions are in scope.
 */
export const PATTERN_KEYS = [
  // C · divergence (Vytal_Divergence_Tool_Spec Parts 2–3)
  "divergence_S1_aligned",
  "divergence_D1_price_ahead_quality",
  "divergence_D2_price_ahead_trajectory",
  "divergence_D3_ownership_building_weak_foundation",
  "divergence_D4_ownership_exiting_healthy",
  "divergence_D5_laggard_catching_up",
  "divergence_D6_quality_rolling_over",
  "divergence_D7_trajectory_breaking_base_holds",
  "divergence_S2_sticky_divergence",
  // B/D · trajectory (Vytal_Trajectory_Tool_Spec Parts 2–3)
  "trajectory_D_T1_recovery_low_zone",
  "trajectory_B_T2_deterioration_high_base",
  "trajectory_B_T3_falling_out_of_pristine",
  "trajectory_D_T4_recovering_out_of_below_par",
  "trajectory_D_T5_foundation_out_of_weak",
  "trajectory_B_T6_momentum_breaking_into_weak",
  "trajectory_D_T7_momentum_improving_while_weak",
  "trajectory_D_T8_foundation_strong_improving",
  "trajectory_B_T9_foundation_weak_declining",
] as const;

export type PatternKey = (typeof PATTERN_KEYS)[number];

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE RECORDS.
//
// ★ `satisfies`, NOT `:`. The annotation would widen every number to `number | null` and every rule
// reading `FACTS.gapFloor` would need a non-null assertion — which is the compile-time binding this
// module exists to provide, thrown away one line after it is created. `satisfies` proves totality and
// shape against Record<PatternKey, PatternFacts> while KEEPING each record's own inferred types, so
// `PATTERN_FACTS.divergence_S2_sticky_divergence.gapFloor` is `number` and
// `PATTERN_FACTS.divergence_D6_quality_rolling_over.gapFloor` is `null` — each provably at the site
// that reads it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const PATTERN_FACTS = {
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // S1 · ALIGNED — NO TENSION. The study's neutral CONTROL (−0.1%, 49% positive, n=226) — the reading
  // that proves the other patterns are not artefacts of the method. Rendered by the divergence tool
  // directly (findings/divergence/aligned.ts); never persisted as a fired finding — see the
  // `never_emitted` status note on PATTERN_KEYS and the "why" in aligned.ts itself.
  //
  // ⚠ `gapFloor` HERE IS A CEILING, NOT A FLOOR — the ONE record where the number bounds from above.
  // S1 fires when the widest pillar spread is ≤ 7. The field is named for the seventeen records where
  // it is a floor; naming the inversion here is cheaper than adding a field one record uses.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  divergence_S1_aligned: {
    pillarPair: ["foundation", "momentum", "market", "ownership"],
    basis: "gap",
    gapFloor: ALIGNED_GAP_CEILING, // ⚠ a CEILING — see above
    movementFloor: null,
    floorBasis: null,
    gateType: null,
    evidencedTier: ALIGNED_GAP_CEILING,
    relaxedTier: null,
    legs: null,
    sustainReadings: null,
    // Verifiably, deliberately neutral in every phase. A control makes no directional claim to mask.
    regimeMap: { HOT: "no_directional_read", NORMAL: "no_directional_read", STRESSED: "no_directional_read" },
    evidenceStats: { n: 226, hitRatePct: 49, effectPct: -0.1, basis: "measured" },
    confidence: "robust",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // D1 · PRICE AHEAD OF QUALITY — Market vs Foundation. The re-rating story.
  //
  // ★ `legs` IS THE **FORMED** TEST NOW, NOT A FIRING GATE. The pattern fires on the SHAPE
  // (direction + gap ≥ 12 + Market above its own median); these two thresholds decide whether that
  // shape is FORMED or still BUILDING. See PatternState's note for why the old reading was backwards.
  //
  // ⚠ THE MARKET LEG MOVED 74 → 68, AND THAT IS THE CORRECTION. 68 is where the n=79 configuration
  // was measured; 74 is Market's own native strong mark, which the rule had been gating on. Gating at
  // 74 meant a stock sitting in the evidenced configuration reported NO PATTERN — GLENMARK, 43 points
  // apart on Market↔Momentum, is the case. ≥74 survives as an INTENSITY WITHIN Formed, carried by
  // severity via `evidencedTier`; it is not a separate state and never was.
  //
  // gapFloor is INHERITED — Market↔Foundation was never the pair 12 was measured on.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  divergence_D1_price_ahead_quality: {
    pillarPair: ["market", "foundation"],
    basis: "gap",
    gapFloor: MATERIAL_GAP_FLOOR, // inherited
    movementFloor: null,
    floorBasis: null,
    gateType: null,
    evidencedTier: 74,
    relaxedTier: { threshold: 68, floor: MATERIAL_GAP_FLOOR },
    // ★ THE FORMED LEGS. Market at the n=79 threshold, Foundation below its weak mark.
    legs: [
      { pillar: "market", op: ">=", value: 68 },
      { pillar: "foundation", op: "<", value: 58 },
    ],
    sustainReadings: null,
    // HOT +9.6% — "masked, still paying". NORMAL +0.2%, 40% positive on a bearish pattern.
    // STRESSED was not split out; the pooled reading is carried across.
    regimeMap: { HOT: "masked", NORMAL: "reads_true", STRESSED: "reads_true" },
    // measured: false — the split was NOT separately measured. Both halves inherit the direction.
    evidenceStats: { n: 79, hitRatePct: 42, effectPct: -2.9, basis: "inherited" },
    confidence: "robust",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // D2 · PRICE AHEAD OF TRAJECTORY — Market vs Momentum. The expectations story.
  // The other half of D1's single n=79 configuration: same tiers, same stats, same inheritance.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  divergence_D2_price_ahead_trajectory: {
    pillarPair: ["market", "momentum"],
    basis: "gap",
    gapFloor: MATERIAL_GAP_FLOOR, // inherited
    movementFloor: null,
    floorBasis: null,
    gateType: null,
    evidencedTier: 74,
    relaxedTier: { threshold: 68, floor: MATERIAL_GAP_FLOOR },
    // ★ THE FORMED LEGS — see D1's note; same configuration, other half.
    legs: [
      { pillar: "market", op: ">=", value: 68 },
      { pillar: "momentum", op: "<", value: 58 },
    ],
    sustainReadings: null,
    regimeMap: { HOT: "masked", NORMAL: "reads_true", STRESSED: "reads_true" },
    evidenceStats: { n: 79, hitRatePct: 42, effectPct: -2.9, basis: "inherited" },
    confidence: "robust",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // D3 · OWNERSHIP BUILDING AGAINST A WEAK FOUNDATION — the strongest positive in the study.
  //
  // A MOVEMENT pattern: the trigger is ΔOwnership, not a standing gap, so gapFloor is null and the
  // §1.2 severity scale does not apply. ±8 selects the REGISTER, never whether it fires — the ruled
  // relaxed floor is 2.
  //
  // `legs` carries ONLY the Foundation level — the one condition genuinely expressible as a current-
  // value pillar threshold. ΔOwnership is a DELTA, not a level, and forcing it into `{pillar, op,
  // value}` would silently claim it is a level check when it is not; it already has a home
  // (`movementFloor`, `basis: "movement"`) and does not need a second, misleading one.
  // ★ movementFloor: 2 IS NOW WIRED, AS THE **BUILDING FLOOR**. The state mapping for a movement
  // pattern is by size of move, not by level: |ΔOwn| ≥ 8 is FORMED, [2, 8) is BUILDING, below 2 is
  // ABSENT. So the number that used to be declared-and-unwired is exactly the Absent/Building
  // boundary, and `evidencedTier` (8) is the Building/Formed one. Both were already on the record;
  // what changed is that the rule now reads them as a three-way state rather than as an on/off gate.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  divergence_D3_ownership_building_weak_foundation: {
    pillarPair: ["ownership", "foundation"],
    basis: "movement",
    gapFloor: null,
    movementFloor: 2,
    floorBasis: "measured",
    gateType: "none", // declared, wired to nothing — see the header
    evidencedTier: 8,
    relaxedTier: { threshold: 8, floor: 2 },
    legs: [{ pillar: "foundation", op: "<", value: 60 }],
    sustainReadings: null,
    // STRESSED 100% positive (n=7) — the only pattern in the study that held up through stress.
    // HOT/NORMAL were not split out; the pooled reading (+1.9%, 58% positive) is carried across.
    regimeMap: { HOT: "reads_true", NORMAL: "reads_true", STRESSED: "reads_true" },
    evidenceStats: { n: 26, hitRatePct: 58, effectPct: 1.9, basis: "measured" },
    confidence: "directional",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // D4 · OWNERSHIP EXITING A HEALTHY BUSINESS — the mirror of D3. Sample-starved (n=11, n=3 on the
  // short-window check): "a reason to investigate, never a verdict."
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  divergence_D4_ownership_exiting_healthy: {
    pillarPair: ["ownership", "foundation"],
    basis: "movement",
    gapFloor: null,
    movementFloor: 2,
    floorBasis: "measured",
    gateType: "none",
    evidencedTier: 8,
    relaxedTier: { threshold: 8, floor: 2 },
    legs: [{ pillar: "foundation", op: ">=", value: 72 }],
    sustainReadings: null,
    // No phase split in the spec; the pooled reading is carried across all three.
    regimeMap: { HOT: "reads_true", NORMAL: "reads_true", STRESSED: "reads_true" },
    evidenceStats: { n: 11, hitRatePct: 36, effectPct: -3.4, basis: "measured" },
    confidence: "directional",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // D5 · LAGGARD CATCHING UP — Momentum converging toward a strong Foundation.
  //
  // ★ gapFloor 8 IS D5's OWN ENFORCED FLOOR (Ruling 1 — measured beats transferred). The n=5
  //   population that produced +17.7% was selected at (F − M) ≥ 8, so 8 is the honest floor of the
  //   EVIDENCE, and it is what the rule now enforces directly — no composition against the universal
  //   MATERIAL_GAP_FLOOR (12), which would silently let a transferred number override a measured one.
  //   §1.1's "nothing in 8–11 may surface" is the UNIVERSAL default for patterns with no floor of
  //   their own; D5 has one, so it does not apply here.
  //
  // movementFloor 5 is the spec's own ΔMomentum ≥ +5 leg, already enforced as a firing gate.
  // relaxedTier: null — strict; not in the `legs` list (D5 is not one of the six named for it).
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  divergence_D5_laggard_catching_up: {
    pillarPair: ["foundation", "momentum"],
    basis: "gap",
    gapFloor: 8, // ★ D5's own enforced floor — Ruling 1
    movementFloor: 5,
    floorBasis: "measured",
    gateType: "firing",
    evidencedTier: 8,
    relaxedTier: null,
    legs: null,
    sustainReadings: null,
    // NORMAL +17.7% measured — "one of very few patterns that works in calm markets rather than only
    // in a rally". HOT/STRESSED carry the pooled +13.5% rerun.
    regimeMap: { HOT: "reads_true", NORMAL: "reads_true", STRESSED: "reads_true" },
    evidenceStats: { n: 5, hitRatePct: 80, effectPct: 17.7, basis: "measured" },
    confidence: "directional",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // D6 · QUALITY ROLLING OVER — the Siemens pattern. Momentum crossing DOWN through its strong mark
  // while Foundation holds strong.
  //
  // ★ A CROSSING: STRICT, relaxedTier null, NO SEVERITY GRADIENT. gapFloor is null on purpose — the
  //   F−M gap at the moment of firing can legitimately be tiny (F 72, M 74) or large, and tiering it
  //   would attach "material / stretched / extreme" to a quantity the pattern is not about.
  //   evidencedTier is the boundary crossed (Momentum's native strong mark), not a gap.
  //
  // `legs` carries both CURRENT-value conditions (Foundation ≥ 72, Momentum < 75). The crossing's
  // PRIOR-reading requirement (Momentum was ≥ 75 last time) is not expressible as a single-value leg
  // and is not claimed here — legs states what is true of the CURRENT reading only.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  divergence_D6_quality_rolling_over: {
    pillarPair: ["foundation", "momentum"],
    basis: "crossing",
    gapFloor: null,
    movementFloor: null,
    floorBasis: null,
    gateType: null,
    evidencedTier: 75,
    relaxedTier: null,
    legs: [
      { pillar: "foundation", op: ">=", value: 72 },
      { pillar: "momentum", op: "<", value: 75 },
    ],
    sustainReadings: null,
    // HOT −7.3%, 33% positive — WORSE in HOT, not masked by it. Pooled −3.4% carried elsewhere.
    regimeMap: { HOT: "reads_true", NORMAL: "reads_true", STRESSED: "reads_true" },
    evidenceStats: { n: 11, hitRatePct: 45, effectPct: -3.4, basis: "measured" },
    confidence: "directional",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // D7 · TRAJECTORY BREAKING WHILE THE BASE HOLDS — Momentum crossing DOWN through its weak mark
  // while Foundation still reads sound. Same crossing discipline as D6.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  divergence_D7_trajectory_breaking_base_holds: {
    pillarPair: ["foundation", "momentum"],
    basis: "crossing",
    gapFloor: null,
    movementFloor: null,
    floorBasis: null,
    gateType: null,
    evidencedTier: 54,
    relaxedTier: null,
    legs: [
      { pillar: "foundation", op: ">=", value: 60 },
      { pillar: "momentum", op: "<", value: 54 },
    ],
    sustainReadings: null,
    // NORMAL −4.9%, 38% positive — "reads more clearly in calm markets". Pooled −2.9% elsewhere.
    regimeMap: { HOT: "reads_true", NORMAL: "reads_true", STRESSED: "reads_true" },
    evidenceStats: { n: 10, hitRatePct: 40, effectPct: -2.9, basis: "measured" },
    confidence: "directional",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // S2 · STICKY DIVERGENCE — Foundation ↔ Momentum, ALWAYS that pair, strict at 12.
  //
  // ★ THE ONLY RECORD WHOSE gapFloor IS EVIDENCED RATHER THAN INHERITED. The stickiness at 12+ was
  //   measured on exactly this pair.
  // ★ AND THE ONLY ONE WITH NO RETURN CLAIM. The spec attaches no figure, so evidenceStats is empty
  //   and measured is false — and the regime does nothing to a claim that was never made, which is
  //   why all three phases read `no_directional_read` rather than `reads_true`.
  //
  // `sustainReadings: 2` is S2's run-length requirement — the one condition in either family that is
  // neither a level, a gap, nor a movement, and so has no home in `legs`, `gapFloor` or
  // `movementFloor`. It is the pattern that gave this field its name.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  divergence_S2_sticky_divergence: {
    pillarPair: ["foundation", "momentum"],
    basis: "gap",
    gapFloor: MATERIAL_GAP_FLOOR, // ★ EVIDENCED on this pair
    movementFloor: null,
    floorBasis: null,
    gateType: null,
    evidencedTier: MATERIAL_GAP_FLOOR,
    relaxedTier: null,
    legs: null,
    sustainReadings: 2,
    regimeMap: { HOT: "no_directional_read", NORMAL: "no_directional_read", STRESSED: "no_directional_read" },
    evidenceStats: { n: null, hitRatePct: null, effectPct: null, basis: "inherited" },
    confidence: "robust",
    displayPrecision: 1,
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // THE TRAJECTORY FAMILY. ONE score along its own path.
  //
  // ⚠ NO GAP FLOOR ANYWHERE IN THIS FAMILY. Trajectory §1.3 inverts divergence's magnitude law: the
  //   SMALLEST Foundation gains carried the cleanest drift (+1.9%, 64% positive) and the largest
  //   carried none; the largest Momentum gains reacted NEGATIVELY. Attaching a gap tier here would
  //   import the opposite of what was measured.
  //
  // ★ pillarPair, CORRECTED. T1–T4 are COMPOSITE patterns — the trigger is the composite score's own
  //   move or crossing, with no pillar pair involved at all — and now declare `["composite"]`. T5–T9
  //   are PILLAR patterns measured against their OWN prior reading, not a pair of anything, and now
  //   declare a ONE-element array (`["foundation"]` / `["momentum"]`) rather than the same pillar
  //   named twice. A chart reading `pillarPair` to decide what to draw would have drawn two unrelated
  //   pillars for T1–T4 (Foundation vs Momentum, when the pattern is about the COMPOSITE) and a
  //   pointless self-pair for T5–T9; both are corrected here.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // T1 · RECOVERY FROM THE LOW ZONE — composite, prev ≤ 58, Δ ≥ +6.
  //
  // The non-price pillars were shown to DRIVE a move of this size (5.7 of 10.6 points on average,
  // driving more than half the move in 56% of cases) — the fact that makes T1 a business inflection
  // rather than a price echo. That is supporting evidence for WHY the composite move is meaningful; it
  // is not a claim that T1 is "about" Foundation and Momentum specifically, which is why it is NOT
  // encoded into `pillarPair` — the pattern's trigger is the composite, full stop.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  trajectory_D_T1_recovery_low_zone: {
    pillarPair: ["composite"],
    basis: "movement",
    gapFloor: null,
    movementFloor: 6, // §1.2 — a material trajectory event
    floorBasis: "measured",
    gateType: "firing", // already enforced: c.delta < T1_MIN_RISE ⇒ not_fired
    evidencedTier: 58, // the low zone the move must start from
    relaxedTier: null,
    legs: null,
    sustainReadings: null,
    // Reads across phases; magnitude flattered in HOT (the tier-3 caveat, not a masking).
    regimeMap: { HOT: "reads_true", NORMAL: "reads_true", STRESSED: "reads_true" },
    evidenceStats: { n: 26, hitRatePct: 81, effectPct: 12.8, basis: "measured" },
    confidence: "robust",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // T2 · DETERIORATION FROM A HIGH BASE — composite, prev ≥ 70, Δ ≤ −6.
  //
  // ★ hitRatePct 21 IS 100 − 79. The spec states "79% of cases FELL"; every record here states
  //   PERCENT POSITIVE, so the complement is recorded and the derivation is stated rather than left
  //   for a reader to notice that one record counts the other way.
  // ★ HOT IS MASKED, AND THAT IS THE WHOLE POINT OF THIS CARD. In the 2021–26 bank bull it showed a
  //   FALSE +15%. In the 2017–21 two-sided window the same events coincided with −35.9% mean price,
  //   every case negative.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  trajectory_B_T2_deterioration_high_base: {
    pillarPair: ["composite"],
    basis: "movement",
    gapFloor: null,
    movementFloor: 6, // magnitude; the DIRECTION is the pattern's, not the floor's
    floorBasis: "measured",
    gateType: "firing", // already enforced: c.delta > T2_MIN_FALL ⇒ not_fired
    evidencedTier: 70, // the high base the fall must start from
    relaxedTier: null,
    legs: null,
    sustainReadings: null,
    regimeMap: { HOT: "masked", NORMAL: "reads_true", STRESSED: "reads_true" },
    evidenceStats: { n: 28, hitRatePct: 21, effectPct: -6.1, basis: "measured" },
    confidence: "robust",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // T3 · FALLING OUT OF PRISTINE — composite crossing DOWN through 74.
  //
  // ★ THE PHASE DECIDES WHETHER A READ EXISTS. Pooled it is flat (+0.2%) because the phases CANCEL:
  //   HOT −5.2%, 29% positive (n=7) versus NORMAL +2.2% and no directional history. STRESSED was
  //   never split out, so it is absent from the read table too — and an absent phase is a MEANINGFUL
  //   omission here, not an oversight. The stats below are the HOT cell, because that is the only
  //   claim that may be spoken.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  trajectory_B_T3_falling_out_of_pristine: {
    pillarPair: ["composite"],
    basis: "crossing",
    gapFloor: null,
    movementFloor: null,
    floorBasis: null,
    gateType: null,
    evidencedTier: 74, // the Pristine floor
    relaxedTier: null,
    legs: null,
    sustainReadings: null,
    regimeMap: { HOT: "reads_true", NORMAL: "no_directional_read", STRESSED: "no_directional_read" },
    evidenceStats: { n: 7, hitRatePct: 29, effectPct: -5.2, basis: "measured" },
    confidence: "directional",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // T4 · RECOVERING OUT OF BELOW PAR — composite crossing UP through 62.
  //
  // ★ n IS UNKNOWN, NOT SMALL. "Sample size was not preserved in the retrieved output for this cell.
  //   Treat as directional and re-verify before giving it prominence." So n is null and hitRatePct is
  //   null — the spec quotes neither. `measured: true` because the effect WAS measured (+6.6%); it is
  //   the sample behind it that is missing, and collapsing those two into one flag would lose which.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  trajectory_D_T4_recovering_out_of_below_par: {
    pillarPair: ["composite"],
    basis: "crossing",
    gapFloor: null,
    movementFloor: null,
    floorBasis: null,
    gateType: null,
    evidencedTier: 62, // the Steady floor
    relaxedTier: null,
    legs: null,
    sustainReadings: null,
    regimeMap: { HOT: "reads_true", NORMAL: "reads_true", STRESSED: "reads_true" },
    evidenceStats: { n: null, hitRatePct: null, effectPct: 6.6, basis: "measured" },
    confidence: "directional",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // T5 · FOUNDATION GROWING OUT OF THE WEAK ZONE — Foundation crossing UP through its NATIVE weak
  // mark. Never a composite band: borrowing one flipped T6's sign, and this is the same class of
  // mistake one pillar over.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  trajectory_D_T5_foundation_out_of_weak: {
    pillarPair: ["foundation"], // one score against its own prior reading — not a doubled pair
    basis: "crossing",
    gapFloor: null,
    movementFloor: null,
    floorBasis: null,
    gateType: null,
    evidencedTier: 60, // Foundation's native weak mark
    relaxedTier: null,
    legs: null,
    sustainReadings: null,
    regimeMap: { HOT: "reads_true", NORMAL: "reads_true", STRESSED: "reads_true" },
    evidenceStats: { n: 31, hitRatePct: 71, effectPct: 3.2, basis: "measured" },
    confidence: "robust",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // T6 · MOMENTUM BREAKING INTO WEAK — Momentum crossing DOWN through its NATIVE weak mark.
  //
  // ★ THE OPPOSITE TABLE TO T3's, AND THE PAIR IS WHY THE REGIME MAP IS PER-PATTERN. T3 reads in HOT
  //   and is blank in NORMAL; T6 reads in NORMAL (−1.9%, 40% positive, n=15) and is MASKED in HOT
  //   (+9.6%, n=3). STRESSED was never split, so it carries no read.
  // ★ AND THE NATIVE-THRESHOLD PROOF LIVES HERE: on the borrowed composite 60 this read a FALSE
  //   +3.2%. At Momentum's own 54 it is negative. The stats below are the NORMAL cell.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  trajectory_B_T6_momentum_breaking_into_weak: {
    pillarPair: ["momentum"],
    basis: "crossing",
    gapFloor: null,
    movementFloor: null,
    floorBasis: null,
    gateType: null,
    evidencedTier: 54, // Momentum's native weak mark — NOT the composite's 60
    relaxedTier: null,
    legs: null,
    sustainReadings: null,
    regimeMap: { HOT: "masked", NORMAL: "reads_true", STRESSED: "no_directional_read" },
    evidenceStats: { n: 15, hitRatePct: 40, effectPct: -1.9, basis: "measured" },
    confidence: "robust",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // T7 · MOMENTUM IMPROVING WHILE STILL WEAK — below the weak mark AND rising.
  //
  // ★ THE MOVEMENT-FLOOR RULING — movementFloor 1.0 IS NOW A FIRING GATE. It is no longer provisional-
  //   and-unwired: the rule requires an ACTUAL rise of at least 1.0pp, enforced directly. The epsilon
  //   (TRAJECTORY_DELTA_EPSILON, 0.0001) keeps its ORIGINAL role — rejecting persistence round-trip
  //   noise so a non-move never reads as a direction — but no longer decides whether T7 FIRES; the
  //   movement floor does. Both gates run, in order: epsilon first (is this a real move at all, and
  //   which way), movementFloor second (is it big enough to be the pattern the study measured).
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  trajectory_D_T7_momentum_improving_while_weak: {
    pillarPair: ["momentum"],
    basis: "movement",
    gapFloor: null,
    movementFloor: 1.0,
    floorBasis: "measured",
    gateType: "firing", // ★ corrected — was declared, unenforced; now a hard gate on the fired set
    evidencedTier: 54, // Momentum's native weak mark, the ceiling this sits beneath
    relaxedTier: null,
    legs: null,
    sustainReadings: null,
    regimeMap: { HOT: "reads_true", NORMAL: "reads_true", STRESSED: "reads_true" },
    evidenceStats: { n: 19, hitRatePct: 63, effectPct: 5.8, basis: "measured" },
    confidence: "robust",
    displayPrecision: 1,
    // ★ THE R3 COPY CUT (Part 4 · R3) — at or above this rise, price has already run and the reader is
    //   late; see `largeMoveCutPp`'s note on PatternFacts above for why it is a distinct field from
    //   `evidencedTier`. RELOCATION, NOT RECALIBRATION: this was a bare `T7_LARGE_MOVE_PP = 15` in
    //   rules/t7-momentum-improving-while-weak.ts with no declared home — the value is unchanged.
    largeMoveCutPp: 15,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // T8 · FOUNDATION STRONG AND STILL IMPROVING — at or above the native strong mark AND rising.
  // NOT a crossing: the cross INTO strong is on the spec's EXCLUDED list (a single +59% outlier drove
  // its mean), so implementing this as a crossing would build the excluded condition.
  // ⚠ movementFloor now a firing gate — same ruling as T7, see its header note.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  trajectory_D_T8_foundation_strong_improving: {
    pillarPair: ["foundation"],
    basis: "movement",
    gapFloor: null,
    movementFloor: 1.0,
    floorBasis: "measured",
    gateType: "firing",
    evidencedTier: 72, // Foundation's native strong mark
    relaxedTier: null,
    legs: null,
    sustainReadings: null,
    regimeMap: { HOT: "reads_true", NORMAL: "reads_true", STRESSED: "reads_true" },
    evidenceStats: { n: 17, hitRatePct: 69, effectPct: 5.8, basis: "measured" },
    confidence: "robust",
    displayPrecision: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // T9 · FOUNDATION WEAK AND STILL DECLINING — below the native weak mark AND falling.
  //
  // ★ THE ONE RECORD WHERE effectPct MUST NOT LEAD. +0.6% at 15 days but only 36% POSITIVE (n=22) —
  //   "the worst odds of any trajectory story tested". The mean is dragged up by a few outliers while
  //   roughly two-thirds of cases fell, and the spec is explicit: the HIT-RATE is the honest number.
  //   Both are declared; the rule stamps `headlineFigure: "hitRate"` so no surface can pick the mean
  //   by accident.
  // ⚠ movementFloor now a firing gate — same ruling as T7, see its header note.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  trajectory_B_T9_foundation_weak_declining: {
    pillarPair: ["foundation"],
    basis: "movement",
    gapFloor: null,
    movementFloor: 1.0,
    floorBasis: "measured",
    gateType: "firing",
    evidencedTier: 60, // Foundation's native weak mark
    relaxedTier: null,
    legs: null,
    sustainReadings: null,
    regimeMap: { HOT: "reads_true", NORMAL: "reads_true", STRESSED: "reads_true" },
    evidenceStats: { n: 22, hitRatePct: 36, effectPct: 0.6, basis: "measured" },
    confidence: "robust",
    displayPrecision: 1,
  },
} satisfies Readonly<Record<PatternKey, PatternFacts>>;

/** Is this key one the facts registry carries? Narrows for the read layer, which handles any key. */
export const isPatternKey = (key: string): key is PatternKey =>
  (PATTERN_KEYS as readonly string[]).includes(key);
