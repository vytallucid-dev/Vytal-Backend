// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// VERDICT FIXTURES — one realistic evidence payload per finding key, plus the branch variants.
//
// Shared by THREE harnesses on purpose:
//   scripts/verify-verdicts.ts          — the permanent gate (every key renders, non-empty, correct branch)
//   the Stage-3 byte-identity proof     — renders the SAME fixtures through the frontend's original
//                                         renderers and asserts the two outputs are character-identical
//   scripts/verify-evidence-register.ts — for the D/T/S keys, whose authored sentence lives only here
//                                         (no rule-file verdict/verbatim to scan), renders every branch
//                                         fixture for the key and register-scans THAT output instead
//
// If the fixtures lived in any one consumer, the others would need their own copy and could disagree
// about what "the same input" means — which would make a passing check worthless.
//
// ⚠ THE EVIDENCE KEYS HERE ARE THE ENGINE'S, NOT INVENTED. Each was read off the rule that writes it
// (scoring/findings/rules/*.ts) and off ownership/primary.ts for R1. A fixture with a misspelled key
// would render an "—" placeholder and the gate would pass on a sentence no reader ever sees.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface VerdictFixture {
  /** Label for the report line — usually the key, or "<key> (branch)". */
  label: string;
  key: string;
  evidence: Record<string, unknown>;
  /** A substring the rendered sentence MUST contain — proves the right branch was taken. */
  expectContains?: string;
  /** ★ A substring the rendered sentence MUST NOT contain. Needed because the claim rule is about an
   *  ABSENCE: a relaxed-tier card is correct precisely when the study's sentence is missing, and a
   *  contains-only assertion cannot express that. Without this, deleting the suppression would still
   *  pass every fixture. */
  expectOmits?: string;
}

export const VERDICT_FIXTURES: VerdictFixture[] = [
  // ── A · red flags ───────────────────────────────────────────────────────────────────────────────
  {
    label: "ownership_R1_pledge (level only)",
    key: "ownership_R1_pledge",
    evidence: { pledgeRatioQ: 62.4, qoqRisePp: 3.1, thresholdPct: 50, verdict: "engine sentence" },
    expectContains: "is at 62.4%",
  },
  {
    label: "ownership_R1_pledge (sharp quarterly rise)",
    key: "ownership_R1_pledge",
    evidence: { pledgeRatioQ: 62.4, qoqRisePp: 14.2, thresholdPct: 50 },
    expectContains: "rose 14.2pp this quarter",
  },
  {
    label: "ownership_R2_promoter_exit",
    key: "ownership_R2_promoter_exit",
    evidence: { promoterPctDropPp: 7.31, currentPeriod: "FY26Q1", thresholdPp: 5 },
    expectContains: "fell 7.31pp into FY26Q1",
  },
  {
    label: "foundation_R3_earnings_quality",
    key: "foundation_R3_earnings_quality",
    evidence: { consecutiveYears: 5, series: [{ fy: "FY21" }, { fy: "FY22" }, { fy: "FY23" }, { fy: "FY24" }, { fy: "FY25" }] },
    expectContains: "5 straight years (FY21–FY25)",
  },
  {
    label: "foundation_R4_debt_explosion",
    key: "foundation_R4_debt_explosion",
    evidence: { deRatioLatest: 3.42, latestPeriod: "FY25", threshold: 3 },
    expectContains: "reached 3.42× in FY25",
  },
  {
    label: "foundation_R5_interest_coverage",
    key: "foundation_R5_interest_coverage",
    evidence: { threshold: 1.5, consecutiveQuarters: 3, latestTtmIC: 1.12 },
    expectContains: "for 3 straight quarters",
  },
  {
    label: "ownership_R6_distribution",
    key: "ownership_R6_distribution",
    evidence: { promoterDeltaPp: -6.3, fiiDeltaPp: -2.1, retailDeltaPp: 8.4, currentPeriod: "FY26Q1" },
    expectContains: "promoter -6.30pp and FII -2.10pp",
  },

  // ── E · patterns ────────────────────────────────────────────────────────────────────────────────
  {
    label: "ownership_P1_clean_rotation",
    key: "ownership_P1_clean_rotation",
    evidence: { diiDeltaPp: 2.4, fiiDeltaPp: -2.2, period: "FY26Q1" },
    expectContains: "DII added (+2.40pp)",
  },
  {
    label: "ownership_P4_dual_exit",
    key: "ownership_P4_dual_exit",
    evidence: { fiiDeltaPp: -1.8, diiDeltaPp: -1.2, period: "FY26Q1" },
    expectContains: "FII (-1.80pp) and DII (-1.20pp)",
  },
  {
    label: "ownership_P5_insider_distress",
    key: "ownership_P5_insider_distress",
    evidence: { distinctSellers: 3, netSellCr: 47, composite: 41 },
    expectContains: "3 insiders sold",
  },
  {
    label: "ownership_P5_insider_distress (single seller — singular)",
    key: "ownership_P5_insider_distress",
    evidence: { distinctSellers: 1, netSellCr: 12, composite: 44 },
    expectContains: "1 insider sold",
  },
  {
    label: "ownership_P6_insider_conviction",
    key: "ownership_P6_insider_conviction",
    evidence: { distinctBuyers: 2, netBuyCr: 18 },
    expectContains: "2 directors/KMP bought",
  },
  {
    label: "foundation_P7_accruals (positive OCF)",
    key: "foundation_P7_accruals",
    evidence: { ocf: 420, netProfit: 759, cashBackPct: 55, accrualsGap: 339, latestPeriod: "FY25" },
    expectContains: "operating cash backed only 55%",
  },
  {
    label: "foundation_P7_accruals (NEGATIVE OCF branch)",
    key: "foundation_P7_accruals",
    evidence: { ocf: -104, netProfit: 759, latestPeriod: "FY25" },
    expectContains: "operating cash flow was negative",
  },
  {
    label: "foundation_P8_receivables (revenue grew)",
    key: "foundation_P8_receivables",
    evidence: { receivablesGrowthPct: 29.6, revenueGrowthPct: 4.2, outpacePp: 25.4, latestPeriod: "FY26" },
    expectContains: "while revenue grew 4.2%",
  },
  {
    label: "foundation_P8_receivables (revenue FELL branch)",
    key: "foundation_P8_receivables",
    evidence: { receivablesGrowthPct: 29.6, revenueGrowthPct: -8.5, outpacePp: 38.1, latestPeriod: "FY26" },
    expectContains: "while revenue fell 8.5%",
  },
  {
    label: "ownership_P10_promoter_defense",
    key: "ownership_P10_promoter_defense",
    evidence: { promoterNetBuyCr: 64, buyTxns: 3, marketPillar: 31.4 },
    expectContains: "(3 trades)",
  },
  {
    label: "ownership_P10_promoter_defense (single trade — singular)",
    key: "ownership_P10_promoter_defense",
    evidence: { promoterNetBuyCr: 12, buyTxns: 1, marketPillar: 28 },
    expectContains: "(1 trade)",
  },
  {
    label: "momentum_P11_margin_compression",
    key: "momentum_P11_margin_compression",
    evidence: { quartersOfDecline: 3, opmSeries: [{ opm: 30.8 }, { opm: 29.1 }, { opm: 28.0 }] },
    expectContains: "30.8 → 29.1 → 28.0",
  },
  {
    label: "momentum_P12_margin_recovery",
    key: "momentum_P12_margin_recovery",
    evidence: { opmSeries: [{ opm: 11.2 }, { opm: 12.9 }, { opm: 14.4 }] },
    expectContains: "recovering from trough: 11.2 → 12.9 → 14.4",
  },
  {
    label: "momentum_P13_revenue_inflection (accelerating)",
    key: "momentum_P13_revenue_inflection",
    evidence: { priorTtmGrowthPct: 6.2, latestTtmGrowthPct: 11.9, deltaPp: 5.7 },
    expectContains: "accelerated from 6.2% to 11.9%",
  },
  {
    label: "momentum_P13_revenue_inflection (decelerating)",
    key: "momentum_P13_revenue_inflection",
    evidence: { priorTtmGrowthPct: 14.0, latestTtmGrowthPct: 8.1, deltaPp: -5.9 },
    expectContains: "decelerated from 14.0% to 8.1%",
  },

  // ── C · DIVERGENCE (Vytal_Divergence_Tool_Spec Parts 2–3) ───────────────────────────────────────
  // ★ The three EVIDENCE-GATED branches are covered on BOTH sides, because each gate is a claim the
  //   copy is allowed to make only under a condition the rule stamped:
  //     D1/D2 — must say the direction is INHERITED, never claim its own measurement
  //     D3/D4 — `strong` selects whether the study's figures may be spoken at all
  //   A one-sided fixture would let the ungated branch regress silently, which is exactly how a
  //   measured figure ends up attached to a population it was never measured on.
  // ── ★ FORMED / BUILDING ─────────────────────────────────────────────────────────────────────────
  // The state is the discriminant, so BOTH sides are covered. A Building card is correct precisely
  // when the study sentence is ABSENT — a contains-only assertion cannot express that, which is what
  // expectOmits is for.
  {
    label: "★ divergence_D1 BUILDING (Market below 68) ⇒ shape named, NO claim",
    key: "divergence_D1_price_ahead_quality",
    evidence: {
      state: "building", market: 66.4, foundation: 41.2, gapPp: 25, tier: "extreme", sharedN: 79,
      marketFormedAt: 68,
      legs: [
        { pillar: "market", reading: 66.4, threshold: 68, shortfall: 1.6, crossed: false },
        { pillar: "foundation", reading: 41.2, threshold: 58, shortfall: -16.8, crossed: true },
      ],
      regimeTier: "magnitude_caveat", regimeReadPhases: null, regimeAtEvent: { regime: "HOT" },
    },
    expectContains: "The price is running ahead of what the balance sheet shows, though modestly so far.",
    expectOmits: "More often than not it has been the Market pillar that moved",
  },
  {
    label: "★ divergence_D1 BUILDING ⇒ names BOTH leg distances (the mixed case)",
    key: "divergence_D1_price_ahead_quality",
    evidence: {
      state: "building", market: 79.0, foundation: 59.2, gapPp: 20, tier: "stretched", sharedN: 79,
      marketFormedAt: 68,
      legs: [
        { pillar: "market", reading: 79.0, threshold: 68, shortfall: -11, crossed: true },
        { pillar: "foundation", reading: 59.2, threshold: 58, shortfall: 1.2, crossed: false },
      ],
      regimeTier: "magnitude_caveat", regimeReadPhases: null,
    },
    expectContains: "though modestly so far",
    expectOmits: "More often than not",
  },
  // ★ NET-NEW FIXTURES — the intensity mapping had NO coverage. Both Building fixtures above carry
  //   `tier`, which is not the field the renderer reads (`tierWord`, as the rule stamps it), so both
  //   render the default word and neither would notice if the mapping broke. These three pin it.
  //
  //   ⚠ AND THEY ASSERT THE ABSENCE OF A THRESHOLD. A Building card states intensity as an ordinary
  //   adverb and must never name the level it is short of — "approaching the level where this fires"
  //   describes our model, not the company, and turns a reading into a countdown.
  {
    label: "★ divergence_D1 BUILDING · material ⇒ 'modestly', and NO threshold named",
    key: "divergence_D1_price_ahead_quality",
    evidence: { state: "building", market: 70.1, foundation: 55.0, gapPp: 15, tierWord: "material" },
    expectContains: "though modestly so far",
    expectOmits: "58",
  },
  {
    label: "★ divergence_D1 BUILDING · stretched ⇒ 'moderately'",
    key: "divergence_D1_price_ahead_quality",
    evidence: { state: "building", market: 76.0, foundation: 54.0, gapPp: 22, tierWord: "stretched" },
    expectContains: "and by a moderate margin",
  },
  {
    label: "★ divergence_D2 BUILDING · extreme ⇒ 'sharply' (the third register word)",
    key: "divergence_D2_price_ahead_trajectory",
    evidence: { state: "building", market: 80.0, momentum: 44.0, gapPp: 36, tierWord: "extreme" },
    expectContains: "The Market pillar is moving well ahead of the trajectory.",
    expectOmits: "a single set of results is enough to settle it",
  },
  {
    label: "divergence_D1_price_ahead_quality (inheritance stated)",
    key: "divergence_D1_price_ahead_quality",
    evidence: { market: 78, foundation: 53, gapPp: 25, tier: "extreme", sharedN: 79, evidenceInherited: true },
    expectContains: "More often than not it has been the Market pillar that moved.",
  },
  {
    label: "divergence_D2_price_ahead_trajectory (inheritance stated)",
    key: "divergence_D2_price_ahead_trajectory",
    evidence: { market: 78, momentum: 48, gapPp: 30, tier: "extreme", sharedN: 79, evidenceInherited: true },
    expectContains: "a single set of results is enough to settle it",
  },
  {
    label: "divergence_D3 (strong ⇒ the evidenced claim IS spoken)",
    key: "divergence_D3_ownership_building_weak_foundation",
    evidence: {
      foundation: 48, ownershipDeltaPp: 9, ownershipFrom: 60, ownershipTo: 69, strong: true,
      cause: "shareholding_changed", driver: "Behind it: FII +1.20pp, DII +0.80pp.",
    },
    expectContains: "In the few cases of this we have, the Market pillar has strengthened in the readings that followed.",
  },
  {
    label: "divergence_D3 (NOT strong ⇒ the evidenced claim is WITHHELD)",
    key: "divergence_D3_ownership_building_weak_foundation",
    evidence: {
      foundation: 48, ownershipDeltaPp: 2, ownershipFrom: 60, ownershipTo: 62, strong: false,
      cause: "flow_activity", driver: "The shareholding filing is unchanged — this moved on 3 block deals.",
    },
    // ★ THE CLAIM RULE. At the relaxed tier NO claim clause is emitted — not a hedged one. The old
    // expectation was the hedge itself ("below the size that population was measured on, so no
    // outcome is claimed"), which names the evidenced pattern in order to withhold it and so still
    // borrows its authority. The card now states the movement and its driver, and stops. The absence
    // of the study's sentence is asserted directly below.
    expectContains: "Institutional ownership is rising while Foundation still reads as weak.",
    expectOmits: "In the few cases of this we have, the Market pillar has strengthened",
  },
  {
    label: "divergence_D4 (strong ⇒ evidenced + the n=11 caveat)",
    key: "divergence_D4_ownership_exiting_healthy",
    evidence: {
      foundation: 74, ownershipDeltaPp: -12, ownershipFrom: 72, ownershipTo: 60, strong: true,
      evidencedN: 11, cause: "shareholding_changed", driver: "Behind it: FII -2.10pp.",
    },
    expectContains: "In the few cases of this we have, Foundation has tended to weaken in the readings that followed.",
  },
  {
    label: "divergence_D4 (NOT strong ⇒ withheld)",
    key: "divergence_D4_ownership_exiting_healthy",
    evidence: {
      foundation: 74, ownershipDeltaPp: -3, ownershipFrom: 72, ownershipTo: 69, strong: false,
      cause: "undetermined", driver: "The shareholding filing is unchanged since the last reading; no insider or block activity is recorded to account for it.",
    },
    // ★ Same claim rule, exiting side. See the D3 note above.
    expectContains: "Institutional ownership has fallen while Foundation still reads as sound.",
    expectOmits: "In the few cases of this we have, Foundation has tended to weaken",
  },
  {
    label: "divergence_D5_laggard_catching_up (mirror + n=5 caveat both present)",
    key: "divergence_D5_laggard_catching_up",
    evidence: { foundation: 78, momentum: 60, momentumRisePp: 7, gapPp: 18, evidencedN: 5 },
    // ★ Capitalisation only. The mirror sentence used to trail a colon inside the observation; it is
    // now the `size` clause and therefore sentence-initial. The words are unchanged.
    expectContains: "this has tended to be the more constructive version",
  },
  {
    label: "divergence_D6_quality_rolling_over (crossing named)",
    key: "divergence_D6_quality_rolling_over",
    evidence: { foundation: 73, momentum: 67, momentumPrior: 80, crossedBelow: 75 },
    // ★ Turn-3 precision fix: `momentum` now renders at the pattern's own displayPrecision (1dp),
    // not the old hardcoded 0dp — "67" became "67.0". `crossedBelow` is a threshold CONSTANT (out of
    // scope for the fix, stays 0dp) — precision-only change, no wording moved.
    // ★ Part 6: the pillar is now NAMED as the subject rather than trailing a descriptive stand-in.
    expectContains: "Momentum has slowed and is now turning the other way",
  },
  {
    label: "divergence_D7_trajectory_breaking_base_holds (the base does NOT cushion it)",
    key: "divergence_D7_trajectory_breaking_base_holds",
    evidence: { foundation: 66, momentum: 49, momentumPrior: 57, crossedBelow: 54 },
    expectContains: "the intact base did not cushion it",
  },
  {
    label: "divergence_S2_sticky_divergence (sustain count + no return claim)",
    key: "divergence_S2_sticky_divergence",
    evidence: { foundation: 74, momentum: 55, gapPp: 19, sustainedReadings: 3, sincePeriod: "FY25Q4" },
    // ★ The duration is now the `movement` clause, in the shared vocabulary rather than S2's private
    // phrasing. With no lifecycle supplied it is sourced from the rule's own `sustainedReadings`.
    expectContains: "They have sat at this distance for 3 consecutive readings without converging.",
  },

  // ── T · TRAJECTORY (Vytal_Trajectory_Tool_Spec Parts 2–3) ──────────────────────────────────────
  // ★ THE TIER-1 PATTERNS ARE COVERED ON BOTH SIDES OF THEIR PHASE TABLE. T3 reads in HOT and is
  //   blank in NORMAL; T6 is the exact reverse. A one-sided fixture would let the "no directional
  //   read" branch regress into a bearish assertion — the single failure §1.4 exists to prevent.
  {
    label: "T3 · HOT ⇒ the directional read IS spoken",
    key: "trajectory_B_T3_falling_out_of_pristine",
    evidence: {
      card: "T3", compositePrior: 76, compositeNow: 71, regimeTier: "decides_read",
      regimeReadPhases: ["HOT"], regimeAtEvent: { regime: "HOT" },
    },
    expectContains: "while the sector is running hot",
  },
  {
    label: "★ T3 · NORMAL ⇒ crossing SHOWN, direction WITHHELD (§1.4 line 87)",
    key: "trajectory_B_T3_falling_out_of_pristine",
    evidence: {
      card: "T3", compositePrior: 76, compositeNow: 71, regimeTier: "decides_read",
      regimeReadPhases: ["HOT"], regimeAtEvent: { regime: "NORMAL" },
    },
    expectContains: "Markets are calm, so this reading now rests on what future results deliver",
  },
  {
    label: "★ T3 · regime UNKNOWN ⇒ says so, never the no-read line",
    key: "trajectory_B_T3_falling_out_of_pristine",
    evidence: {
      card: "T3", compositePrior: 76, compositeNow: 71, regimeTier: "decides_read",
      regimeReadPhases: ["HOT"], regimeAtEvent: { regime: null },
    },
    expectContains: "market phase could not be established",
  },
  {
    label: "T6 · NORMAL ⇒ the directional read IS spoken",
    key: "trajectory_B_T6_momentum_breaking_into_weak",
    evidence: {
      card: "T6", momentumPrior: 57, momentumNow: 49, regimeTier: "decides_read",
      regimeReadPhases: ["NORMAL"], regimeAtEvent: { regime: "NORMAL" },
    },
    expectContains: "This reads most clearly in calm markets",
  },
  {
    label: "★ T6 · HOT ⇒ masked, crossing shown without a direction",
    key: "trajectory_B_T6_momentum_breaking_into_weak",
    evidence: {
      card: "T6", momentumPrior: 57, momentumNow: 49, regimeTier: "decides_read",
      regimeReadPhases: ["NORMAL"], regimeAtEvent: { regime: "HOT" },
    },
    expectContains: "in a hot sector it has consistently been masked",
  },
  {
    label: "★ T2 · Tier 2 — the phase is ALWAYS displayed (NORMAL)",
    key: "trajectory_B_T2_deterioration_high_base",
    evidence: {
      card: "T2", compositePrior: 76, compositeNow: 68, regimeTier: "always_display",
      regimeReadPhases: null, regimeAtEvent: { regime: "NORMAL" },
    },
    expectContains: "Market phase at the time of this reading: NORMAL.",
  },
  {
    label: "★ T2 · HOT appends the spec's postponement sentence",
    key: "trajectory_B_T2_deterioration_high_base",
    evidence: {
      card: "T2", compositePrior: 76, compositeNow: 68, regimeTier: "always_display",
      regimeReadPhases: null, regimeAtEvent: { regime: "HOT" },
    },
    expectContains: "postponed this kind of deterioration showing up in the Market pillar rather than cancelling it",
  },
  {
    label: "T1 · Tier 3 — HOT adds the magnitude caveat",
    key: "trajectory_D_T1_recovery_low_zone",
    evidence: {
      card: "T1", compositePrior: 52, compositeNow: 61, regimeTier: "magnitude_caveat",
      regimeReadPhases: null, regimeAtEvent: { regime: "HOT" },
    },
    expectContains: "flatters the size of moves like this one",
  },
  {
    label: "T4 · the unpreserved-n caveat rides in the sentence",
    key: "trajectory_D_T4_recovering_out_of_below_par",
    evidence: { card: "T4", compositePrior: 59, compositeNow: 63, regimeTier: "magnitude_caveat", regimeReadPhases: null },
    expectContains: "A recovery that has held long enough to cross a band.",
  },
  {
    label: "T5 · small gains carried the drift (R1 on the card)",
    key: "trajectory_D_T5_foundation_out_of_weak",
    evidence: { card: "T5", foundationPrior: 57, foundationNow: 62, regimeTier: "magnitude_caveat", regimeReadPhases: null },
    expectContains: "Of the single-pillar improvements, this one has held up most consistently.",
  },
  {
    label: "★ T7 · a LARGE Momentum rise says the price already ran (R3)",
    key: "trajectory_D_T7_momentum_improving_while_weak",
    evidence: {
      card: "T7", momentumPrior: 26, momentumNow: 48, risePp: 22, largeMovePriceAlreadyRan: true,
      regimeTier: "magnitude_caveat", regimeReadPhases: null,
    },
    expectContains: "the Market pillar has usually already moved before the reading catches up",
  },
  {
    label: "T7 · a small rise omits the R3 clause",
    key: "trajectory_D_T7_momentum_improving_while_weak",
    evidence: {
      card: "T7", momentumPrior: 44, momentumNow: 48, risePp: 4, largeMovePriceAlreadyRan: false,
      regimeTier: "magnitude_caveat", regimeReadPhases: null,
    },
    expectContains: "earliest point at which a recovery becomes visible",
  },
  {
    label: "T8 · already strong, still strengthening",
    key: "trajectory_D_T8_foundation_strong_improving",
    evidence: { card: "T8", foundationPrior: 75, foundationNow: 79, regimeTier: "magnitude_caveat", regimeReadPhases: null },
    expectContains: "A business that was already sound is getting sounder.",
  },
  {
    label: "★ T9 · quotes the HIT-RATE, never the misleading +0.6% mean",
    key: "trajectory_B_T9_foundation_weak_declining",
    evidence: {
      card: "T9", foundationPrior: 55, foundationNow: 51, evidencedPositivePct: 36, meanPct: 0.6,
      regimeTier: "magnitude_caveat", regimeReadPhases: null,
    },
    expectContains: "has shown up in the Market pillar in the readings that followed",
  },

  // ── F / G / H / I ───────────────────────────────────────────────────────────────────────────────
  {
    label: "composition_F1_atypical",
    key: "composition_F1_atypical",
    evidence: { composite: 66, band: "below_par", maskingPillar: "foundation", maskingDevPp: 15, laggingPillar: "market", laggingDevPp: -29 },
    expectContains: "isn't a typical below-par",
  },
  {
    label: "trajectory_F2_composition_shift (leader changed)",
    key: "trajectory_F2_composition_shift",
    evidence: { compositeHeld: { prior: 75, current: 77 }, leaderChanged: true, leaderPrior: "foundation", leaderCurrent: "ownership" },
    expectContains: "lead passed from Foundation to Ownership",
  },
  {
    label: "trajectory_F2_composition_shift (leader held)",
    key: "trajectory_F2_composition_shift",
    evidence: { compositeHeld: { prior: 75, current: 77 }, leaderChanged: false },
    expectContains: "Mix shifted while the score held (75→77).",
  },
  // ⚠ trajectory_G_convergence fixtures REMOVED with the rule. G is retired (narrowing spread is on
  //   the spec's EXCLUDED list), so it has no renderer and a fixture for it would assert the
  //   behaviour of a key that can never reach renderVerdict. Its resolution TYPING survives as
  //   findings/divergence/resolution.ts, which is pure and un-fired — nothing to render.
  {
    label: "ownership_H_block_events (net buying)",
    key: "ownership_H_block_events",
    evidence: { deals: 2, netCr: 157, grossCr: 312 },
    expectContains: "2 block/bulk deals (₹312 Cr, net buying)",
  },
  {
    label: "ownership_H_block_events (single deal, net selling)",
    key: "ownership_H_block_events",
    evidence: { deals: 1, netCr: -88, grossCr: 88 },
    expectContains: "1 block/bulk deal (₹88 Cr, net selling)",
  },
  {
    label: "ownership_H_block_events (two-sided)",
    key: "ownership_H_block_events",
    evidence: { deals: 4, netCr: 0, grossCr: 640 },
    expectContains: "two-sided",
  },
  // ⚠ trajectory_I_band_transition fixtures REMOVED with the rule (it fired the EXCLUDED composite
  //   ↓62 and the untested ↑68). T3 is the one composite crossing that survived the phase split.

  // ── N · Notable — the spec templates, plus the §8.3 missing-evidence guard ──────────────────────
  {
    label: "foundation_N1_cash_backed_earnings",
    key: "foundation_N1_cash_backed_earnings",
    evidence: { years: 6 },
    expectContains: "converted to cash for 6 straight years",
  },
  {
    label: "foundation_N1 (⚠ evidence key ABSENT → falls back to the DESCRIPTION, never 'undefined')",
    key: "foundation_N1_cash_backed_earnings",
    evidence: {},
    expectContains: "Operating cash flow has covered reported profit",
  },
  {
    label: "foundation_N2_working_capital",
    key: "foundation_N2_working_capital",
    evidence: { years: 4 },
    expectContains: "grown slower than revenue for 4 years",
  },
  {
    label: "foundation_N3_deleveraging",
    key: "foundation_N3_deleveraging",
    evidence: { years: 3, deFrom: 1.8, deTo: 0.6 },
    expectContains: "from 1.8× to 0.6×",
  },
  {
    label: "foundation_N3 (partial evidence → description, not a half-sentence)",
    key: "foundation_N3_deleveraging",
    evidence: { years: 3 },
    expectContains: "Borrowings relative to net worth have fallen",
  },
  {
    label: "foundation_N4_coverage_strengthening",
    key: "foundation_N4_coverage_strengthening",
    evidence: { quarters: 4, troughCoverage: 1.2 },
    expectContains: "from a thin 1.2×",
  },
  {
    label: "ownership_N5_dual_institutional_build",
    key: "ownership_N5_dual_institutional_build",
    evidence: { fiiDeltaPp: 1.4, diiDeltaPp: 0.9 },
    expectContains: "FII 1.4pp, DII 0.9pp",
  },
  {
    label: "ownership_N6_promoter_accumulation",
    key: "ownership_N6_promoter_accumulation",
    evidence: { quarters: 3, cumulativePp: 2.7 },
    expectContains: "for 3 straight quarters — up 2.7pp",
  },
  {
    label: "ownership_N7_pledge_release",
    key: "ownership_N7_pledge_release",
    evidence: { pledgeFromPct: 41.0, pledgeToPct: 12.5 },
    expectContains: "from 41% to 12.5% of their holding",
  },

  // ── PRECEDENCE + FALLBACK — the three-tier resolution, exercised deliberately ───────────────────
  {
    label: "★ precedence · an authored renderer BEATS the engine's own evidence.verdict",
    // Re-pointed off the retired I key onto a live one. The precedence rule is what is under test,
    // not the key — but a fixture keyed to a retired finding tests a path no reader can reach.
    key: "trajectory_D_T8_foundation_strong_improving",
    evidence: {
      card: "T8", foundationPrior: 75, foundationNow: 79, regimeTier: "magnitude_caveat",
      regimeReadPhases: null, verdict: "ENGINE SENTENCE — must not win",
    },
    expectContains: "A business that was already sound is getting sounder",
  },
  {
    label: "★ fallback 2 · no authored renderer → the engine's evidence.verbatim",
    key: "lens_lm3_NII",
    evidence: { verbatim: "NII: below its absolute bar but above the peer field — the peer group is weak on this metric." },
    expectContains: "below its absolute bar but above the peer field",
  },
  {
    label: "★ fallback 2 · no authored renderer → the engine's evidence.verdict",
    key: "lens_lp5_foundation",
    evidence: { verdict: "foundation: a majority of metrics are declining against their own history." },
    expectContains: "a majority of metrics are declining",
  },
  {
    label: "★ fallback 3 · nothing at all, family A → the generic override sentence",
    key: "ownership_R9_unknown_flag",
    evidence: {},
    expectContains: "an override condition that takes precedence over the composite score.",
  },
  {
    label: "★ fallback 3 · nothing at all, non-A → the generic conditional sentence",
    key: "foundation_P99_unknown",
    evidence: {},
    expectContains: "a conditional signal; review the evidence below.",
  },
];
