// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// VERDICT FIXTURES — one realistic evidence payload per finding key, plus the branch variants.
//
// Shared by TWO harnesses on purpose:
//   scripts/verify-verdicts.ts       — the permanent gate (every key renders, non-empty, correct branch)
//   the Stage-3 byte-identity proof  — renders the SAME fixtures through the frontend's original
//                                      renderers and asserts the two outputs are character-identical
//
// If the fixtures lived in the gate, the identity proof would need its own copy and the two could
// disagree about what "the same input" means — which would make a passing identity proof worthless.
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

  // ── C · divergence · ★ BOTH BRANCHES OF C2 AND C3 (3d — the rule-decided discriminants) ─────────
  {
    label: "divergence_C1_price_ahead",
    key: "divergence_C1_price_ahead",
    evidence: { market: 72, foundation: 35, momentum: 20, gap: 44.2, meanFundamentals: 27.6 },
    expectContains: "sits 44.2 pts above its fundamentals (F35 / M20)",
  },
  {
    label: "divergence_C2 (subtype = exit_under_strength)",
    key: "divergence_C2_ownership_vs_fundamentals",
    evidence: { subtype: "exit_under_strength", foundation: 72, ownership: 50, gap: 22 },
    expectContains: "Owners stepping back beneath a holding floor",
  },
  {
    label: "divergence_C2 (subtype = build_under_weakness)",
    key: "divergence_C2_ownership_vs_fundamentals",
    evidence: { subtype: "build_under_weakness", foundation: 35, ownership: 75, gap: 40 },
    expectContains: "Smart money building under weakness",
  },
  {
    label: "divergence_C3 (floorLed = true)",
    key: "divergence_C3_floor_trajectory_split",
    evidence: { floorLed: true, foundation: 81, momentum: 53, gap: 28 },
    expectContains: "the balance sheet holds while the near-term trajectory lags",
  },
  {
    label: "divergence_C3 (floorLed = false)",
    key: "divergence_C3_floor_trajectory_split",
    evidence: { floorLed: false, foundation: 53, momentum: 80, gap: 27 },
    expectContains: "the trajectory outruns the floor",
  },
  {
    label: "divergence_C_over_time_widening",
    key: "divergence_C_over_time_widening",
    evidence: { recentLowGap: 12.4, currentGap: 19.8 },
    expectContains: "up from 12.4 to 19.8 pts",
  },

  // ── B / D · trajectory crosses (all three B variants) ───────────────────────────────────────────
  {
    label: "trajectory_B_deterioration (variant = pillar)",
    key: "trajectory_B_deterioration",
    evidence: { variant: "pillar", leg: "market", sustainedSnapshots: 2 },
    expectContains: "Market slipped below its strong mark",
  },
  {
    label: "trajectory_B_deterioration (variant = out_of_pristine)",
    key: "trajectory_B_deterioration",
    evidence: { variant: "out_of_pristine", sustainedSnapshots: 3 },
    expectContains: "out of Pristine",
  },
  {
    label: "trajectory_B_deterioration (composite out of Healthy)",
    key: "trajectory_B_deterioration",
    evidence: { variant: "composite", sustainedSnapshots: 2 },
    expectContains: "composite fell out of Healthy",
  },
  {
    label: "trajectory_D_recovery (pillar-led)",
    key: "trajectory_D_recovery",
    evidence: { isPillar: true, leg: "momentum", sustainedSnapshots: 2 },
    expectContains: "Momentum leads the recovery",
  },
  {
    label: "trajectory_D_recovery (composite)",
    key: "trajectory_D_recovery",
    evidence: { isPillar: false, sustainedSnapshots: 2 },
    expectContains: "composite crossed up out of Below-par",
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
  {
    label: "trajectory_G_convergence (healthy_resolution)",
    key: "trajectory_G_convergence",
    evidence: { type: "healthy_resolution", laggardPillar: "momentum", laggardRosePp: 9.2, peakSpread: 31.0, currentSpread: 14.4 },
    expectContains: "the Momentum laggard rose 9.2pp",
  },
  {
    label: "trajectory_G_convergence (deterioration)",
    key: "trajectory_G_convergence",
    evidence: { type: "deterioration_convergence", leaderPillar: "market", leaderFellPp: 12.7, peakSpread: 28.0, currentSpread: 11.1 },
    expectContains: "the Market leader fell 12.7pp",
  },
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
  {
    label: "trajectory_I_band_transition",
    key: "trajectory_I_band_transition",
    evidence: { toBand: "Below-par", sustainedSnapshots: 2 },
    expectContains: "Crossed into Below-par.",
  },

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
    key: "trajectory_I_band_transition",
    evidence: { toBand: "Healthy", verdict: "ENGINE SENTENCE — must not win" },
    expectContains: "Crossed into Healthy.",
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
