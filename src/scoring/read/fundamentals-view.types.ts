// File: src/scoring/read/fundamentals-view.types.ts
//
// Read-model for the FUNDAMENTALS view — the exact JSON shape returned by
// GET /api/stocks/:symbol/fundamentals. ONE dispatch-by-industry-family endpoint:
// a shared envelope (every family) + exactly one populated per-family payload, the
// other four null. `built:false` marks a family whose payload isn't implemented yet
// (envelope still carries identity so the tab renders an honest "coming" state).
//
// CONVENTIONS (mirror health-view / ownership-series): numbers are JS numbers; a field
// with no backing data is null with the KEY PRESENT; every value is already canonical
// (percent as percent, money as ₹ Cr, ratios as-is) — see fundamentals-normalize.ts.
// The UI does NO unit conversion.

export type IndustryFamily =
  | "non_financial"
  | "banking"
  | "nbfc"
  | "life_insurance"
  | "general_insurance";

export type Basis = "consolidated" | "standalone";

/** One quarter of the QUARTERLY SPINE (quarterly_results, chosen basis, oldest→newest).
 *  Growth fields are the STORED YoY/QoQ columns (already canonical %), null when absent. */
export interface QuarterPoint {
  periodKey: string; // "FY26Q4" — fiscalYear ("FY26") + quarter ("Q4")
  reportDate: string; // YYYY-MM-DD
  filingDate: string; // YYYY-MM-DD — when filed with NSE (drives the Results viewer header)
  xbrlUrl: string; // direct link to the source XBRL filing
  revenue: number | null; // ₹ Cr
  netProfit: number | null; // ₹ Cr
  operatingProfit: number | null; // ₹ Cr (EBITDA proxy)
  operatingMargin: number | null; // % (canonical)
  netMargin: number | null; // %
  revenueYoy: number | null; // %
  profitYoy: number | null; // %
  revenueQoq: number | null; // %
  profitQoq: number | null; // %
}

/** The three DuPont legs (ROE = netMargin × assetTurnover × equityMultiplier). All
 *  real: netMargin canonical %, assetTurnover & equityMultiplier as ratios. */
export interface DupontLegs {
  netMargin: number | null; // %
  assetTurnover: number | null; // x (revenue / totalAssets)
  equityMultiplier: number | null; // x (totalAssets / totalEquity)
}

/** ANNUAL CONTEXT — fundamentals, latest year, chosen basis. Derived fields are
 *  guarded read-layer arithmetic over stored columns (never scoring). */
export interface AnnualSnapshot {
  fiscalYear: string;

  // profitability — ALL canonical %
  roe: number | null;
  roce: number | null;
  netMargin: number | null;
  operatingMargin: number | null;
  roa: number | null; // DERIVED netProfit / totalAssets × 100

  // growth — % (null on latest year when no prior of the same basis exists)
  revenueGrowthYoy: number | null;
  profitGrowthYoy: number | null;
  epsGrowthYoy: number | null;

  // leverage & liquidity
  debtToEquity: number | null; // ratio
  interestCoverage: number | null; // x
  currentRatio: number | null; // DERIVED currentAssets / currentLiabilities
  quickRatio: number | null; // DERIVED (currentAssets − inventories) / currentLiabilities
  equityMultiplier: number | null; // DERIVED totalAssets / totalEquity

  // cash & returns
  netProfit: number | null; // ₹ Cr (annual P&L — pairs with cashFromOperating for cash conversion)
  fcf: number | null; // ₹ Cr
  capex: number | null; // ₹ Cr
  cashFromOperating: number | null;
  cashFromInvesting: number | null;
  cashFromFinancing: number | null;
  dividendPayout: number | null; // % DERIVED |dividendsPaid| / netProfit × 100

  // per-share
  basicEps: number | null;
  bookValuePerShare: number | null;

  // balance-sheet snapshot — ₹ Cr
  totalAssets: number | null;
  totalEquity: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  inventories: number | null;
  totalDebt: number | null;
  cashAndCashEquivalents: number | null;

  // dupont — all three legs
  dupont: DupontLegs | null;
}

/** PRICE-RELATIVE — trailing-year fcf/dividends over LIVE market cap (StockPrice).
 *  Honestly labelled via `asOfBasis`. Business-characteristic FACTS, not valuation. */
export interface YieldsBlock {
  marketCap: number | null; // ₹ Cr, live from StockPrice (null when not populated)
  fcfYield: number | null; // % DERIVED trailing fcf / marketCap × 100
  dividendYield: number | null; // % DERIVED trailing |dividendsPaid| / marketCap × 100
  asOfBasis: string; // honest label, e.g. "Trailing-year figures over current market cap"
}

/** One fiscal year of the CASH-CONVERSION view — operating cash flow against net profit.
 *  Profit that doesn't convert to cash is the signal; the divergence is what the chart draws.
 *  Built across ALL annual years on the chosen basis (oldest→newest), null-tolerant per year. */
export interface CashConversionPoint {
  fiscalYear: string;
  cashFromOperating: number | null; // ₹ Cr
  netProfit: number | null; // ₹ Cr
}

/** One fiscal year of the headline-ratio history — feeds the sparklines beside the annual
 *  return cards. All canonical % (non_financial stores ratios already-percent). */
export interface NfRatioHistoryPoint {
  fiscalYear: string;
  roe: number | null; // %
  roce: number | null; // %
  netMargin: number | null; // %
  operatingMargin: number | null; // %
}

export interface NonFinancialPayload {
  quarters: QuarterPoint[]; // oldest → newest
  annual: AnnualSnapshot | null;
  yields: YieldsBlock | null;
  cashConversion: CashConversionPoint[]; // oldest → newest; empty when no annual CFO on file
  ratioHistory: NfRatioHistoryPoint[]; // oldest → newest; for headline-ratio sparklines
}

// ─────────────────────────────────────────────────────────────────────────────
// BANKING family — a DIFFERENT P&L (NII not revenue; PPOP not EBITDA), led by the
// bank-risk lens (asset quality + capital adequacy). All units canonical: ratios
// arrive as PERCENT (the ×100 fired in the banking service branch), money ₹ Cr.
// auditPending is an honest STATE, not missing data — when true the asset-quality &
// capital fields are null for that row by design (not "no data"). No FCF for banks.
// ─────────────────────────────────────────────────────────────────────────────

/** One quarter of the BANKING EARNINGS SPINE (banking_quarterly_results, chosen
 *  basis, oldest→newest). Asset-quality & capital fields are null when auditPending. */
export interface BankingQuarter {
  periodKey: string; // "FY26Q4"
  reportDate: string; // YYYY-MM-DD
  auditPending: boolean; // true → asset-quality/capital fields null this row (honest state)

  // P&L spine — ₹ Cr (P&L-level; zeroToNull-guarded)
  interestEarned: number | null;
  interestExpended: number | null;
  nii: number | null; // net interest income
  otherIncome: number | null;
  totalIncome: number | null;
  ppop: number | null; // pre-provision operating profit
  provisions: number | null;
  netProfit: number | null;
  netMargin: number | null; // % (already-percent passthrough — NOT ×100)

  // asset quality (fraction→%); null when auditPending
  gnpaPct: number | null; // %
  nnpaPct: number | null; // %
  gnpaAbsolute: number | null; // ₹ Cr
  nnpaAbsolute: number | null; // ₹ Cr
  pcr: number | null; // % (provision coverage ratio)

  // capital (fraction→%); null when auditPending
  cet1: number | null; // %
  tier1: number | null; // %
  additionalTier1: number | null; // %

  // efficiency / returns (fraction→%)
  costToIncome: number | null; // %
  roaQuarterly: number | null; // % (annualised-by-convention)

  // growth (already %)
  niiQoq: number | null;
  niiYoy: number | null;
  patQoq: number | null;
  patYoy: number | null;
}

/** ANNUAL CONTEXT — banking_fundamentals, latest year, chosen basis. Ratios canonical
 *  PERCENT; money ₹ Cr; per-share ₹. NO fcf/capex (banks have no FCF). */
export interface BankingAnnual {
  fiscalYear: string;

  // profitability & efficiency (fraction→% unless noted)
  roe: number | null; // %
  roaDisclosed: number | null; // % (disclosed full-year ROA; distinct from quarterly)
  nim: number | null; // % (net interest margin)
  costToIncome: number | null; // %
  creditCostPct: number | null; // %

  // earnings mix — ₹ Cr (interestEarned is the denominator; advances = credit/lending interest,
  // revenueOnInvestments = treasury income, null when the bank doesn't disclose it separately)
  interestEarned: number | null;
  interestOnAdvances: number | null;
  revenueOnInvestments: number | null;

  // franchise — ₹ Cr
  deposits: number | null;
  advances: number | null;
  investments: number | null;
  borrowings: number | null;
  creditDepositRatio: number | null; // %

  // franchise growth (already %)
  depositGrowthYoy: number | null;
  advanceGrowthYoy: number | null;
  niiGrowthYoy: number | null;
  patGrowthYoy: number | null;
  assetGrowthYoy: number | null;

  // asset quality & capital (annual; fraction→%)
  gnpaPct: number | null; // %
  nnpaPct: number | null; // %
  pcr: number | null; // %
  gnpaAbsolute: number | null; // ₹ Cr
  nnpaAbsolute: number | null; // ₹ Cr
  cet1: number | null; // %
  tier1: number | null; // %

  // balance-sheet snapshot — ₹ Cr
  capital: number | null;
  reservesAndSurplus: number | null;
  netWorth: number | null;
  totalAssets: number | null;
  cashAndBalancesWithRbi: number | null;

  // per-share — ₹
  basicEps: number | null;
  bookValuePerShare: number | null;

  // cash flow — ₹ Cr (NO fcf/capex for banks)
  cashFromOperating: number | null;
  cashFromInvesting: number | null;
  cashFromFinancing: number | null;
}

/** One fiscal year of the banking headline-ratio history — feeds the sparklines beside the
 *  annual return cards. Canonical % (banking stores ratios as fractions → ×100 in service).
 *  Per-stock gated in the UI: a bank with < 3 reported years simply gets no sparkline. */
export interface BkRatioHistoryPoint {
  fiscalYear: string;
  roe: number | null; // %
  nim: number | null; // %
  costToIncome: number | null; // %
  creditCostPct: number | null; // %
}

// ── CASA (current-and-savings ratio) — entered quarterly, exposed for DISPLAY ─────
// CASA is a manually-entered supplementary (BankSupplementary, PERCENT) scored by the
// engine; this block carries it back out on the READ path so the UI can show it. The
// tier in `current.source` is the load-bearing field — it mirrors the admin status
// table's tiering EXACTLY (see ingestions/bank-supplementary/casa-status.ts). Banks-only:
// `casa` appears solely on the banking branch. A bank with no entered CASA is honest-empty
// (current.value null, source "none", series []) — never a fabricated number.

/** The current CASA reading + the tier context the UI needs to render it honestly. */
export interface BankingCasaCurrent {
  value: number | null; // CASA %, e.g. 34.5 — null when source === "none"
  quarter: string | null; // the quarter this value is FOR, e.g. "FY27/Q1"; null on legacy_live / none
  source: "quarter" | "legacy_live" | "none"; // resolved tier — THE field that drives honest display
  isCurrent: boolean; // true ONLY when the latest entered quarter === the current expected quarter
  asOf: string | null; // ISO — when the driving row was entered (null when none)
}

/** One entered CASA quarter for the history chart (quarter-keyed rows only, ascending). */
export interface BankingCasaSeriesPoint {
  quarter: string; // "FY26/Q3"
  value: number; // CASA % for that quarter (already percent — no conversion)
  periodEnd: string | null; // period-end date if stored (currently null — quarter is the period identity)
}

/** CASA block on the banking fundamentals view: the current tiered value (honest display)
 *  + the full entered quarter series (the CASA history chart). */
export interface BankingCasa {
  current: BankingCasaCurrent;
  series: BankingCasaSeriesPoint[]; // ascending by quarter; [] when no entered quarters
}

export interface BankingPayload {
  quarters: BankingQuarter[]; // oldest → newest
  annual: BankingAnnual | null;
  ratioHistory: BkRatioHistoryPoint[]; // oldest → newest; sparkline-eligible, per-stock gated
  casa: BankingCasa; // current CASA (tiered, honest) + full quarter series for the history chart
}

// ─────────────────────────────────────────────────────────────────────────────
// NBFC family — a lending P&L (NII not revenue), credit-cost as the (thinner) risk
// lens: no GNPA/PCR regime, no audit-pending concept, NO quarterly balance sheet.
// The balance sheet is ANNUAL-only context. Ratios arrive canonical PERCENT, EXCEPT
// borrowingsToEquity which is a LEVERAGE MULTIPLE (3.13×, never "313%") — the headline
// NBFC risk metric. depositsLiabilities is null for non-deposit-taking NBFCs (honest
// -empty, not a fake zero). No FCF for NBFCs.
// ─────────────────────────────────────────────────────────────────────────────

/** One quarter of the NBFC EARNINGS SPINE (nbfc_quarterly_results, P&L ONLY — there
 *  is no quarterly balance sheet for NBFCs, chosen basis, oldest→newest). */
export interface NbfcQuarter {
  periodKey: string; // "FY26Q4"
  reportDate: string; // YYYY-MM-DD

  // P&L spine — ₹ Cr (P&L-level; zeroToNull-guarded)
  revenue: number | null; // total income
  interestIncome: number | null;
  feeAndCommissionIncome: number | null;
  financeCosts: number | null;
  impairmentOnFinancialInstruments: number | null; // loan-loss provisioning (ECL)
  nii: number | null; // net interest income
  netProfit: number | null;
  netMargin: number | null; // % (already-percent passthrough — NOT ×100)

  // growth (already %)
  revenueYoy: number | null;
  patYoy: number | null;
  revenueQoq: number | null;
  patQoq: number | null;
}

/** ANNUAL CONTEXT — nbfc_fundamentals (the balance sheet lives here), latest year,
 *  chosen basis. NO fcf/capex (NBFCs carry no meaningful FCF). */
export interface NbfcAnnual {
  fiscalYear: string;

  // profitability & spread (fraction→%)
  roe: number | null; // %
  nim: number | null; // % (net interest margin)
  spread: number | null; // % (lending spread)
  costToIncomeRatio: number | null; // %
  creditCostPct: number | null; // % (impairment ÷ avg AUM)

  // leverage & capital
  borrowingsToEquity: number | null; // × (MULTIPLE — display 3.13×, NOT a percent)
  capitalToAssetsRatio: number | null; // % (CRAR proxy)

  // franchise / funding — ₹ Cr
  loans: number | null; // AUM (loan book)
  debtSecurities: number | null;
  borrowings: number | null;
  depositsLiabilities: number | null; // null for non-deposit-taking NBFCs (honest-empty)

  // growth (already %)
  aumGrowthYoy: number | null;
  revenueGrowthYoy: number | null;
  patGrowthYoy: number | null;

  // balance-sheet snapshot — ₹ Cr
  totalAssets: number | null;
  totalEquity: number | null;
  netWorth: number | null;
  investments: number | null;
  cashAndCashEquivalents: number | null;

  // per-share — ₹
  basicEps: number | null;
  bookValuePerShare: number | null;

  // cash flow — ₹ Cr (NO fcf/capex for NBFCs)
  cashFromOperating: number | null;
  cashFromInvesting: number | null;
  cashFromFinancing: number | null;
}

export interface NbfcPayload {
  quarters: NbfcQuarter[]; // oldest → newest
  annual: NbfcAnnual | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIFE INSURANCE family — policyholders'-fund accounting (premium income → benefits
// → change in valuation of liabilities → surplus), NOT a revenue/EBITDA P&L. The
// quality lens is PERSISTENCY (% of policies still in force at 13/25/37/49/61 months)
// and SOLVENCY. Ratios arrive canonical PERCENT, EXCEPT solvencyRatio which is a
// MULTIPLE (1.90×, never "1.9%") read against the IRDAI 150% floor. persistency*M are
// null when the source filing's value is suspect (SBILIFE ingestion discrepancy — see
// the service-branch guard). incomeFromInvestments / changeInValuationOfLiabilities can
// be legitimately NEGATIVE (mark-to-market) — preserved, never zero-stripped. NO FCF.
// Thin history (5Q / 2yr) → trend charts suppressed; tables + value cards only.
// ─────────────────────────────────────────────────────────────────────────────

/** One quarter of the LIFE-INSURANCE EARNINGS SPINE (life_insurance_quarterly_results,
 *  chosen basis, oldest→newest). */
export interface LifeInsuranceQuarter {
  periodKey: string; // "FY26Q4"
  reportDate: string; // YYYY-MM-DD

  // premium & earnings spine — ₹ Cr
  netPremiumIncome: number | null;
  grossPremiumIncome: number | null;
  // premium mix — the three lines sum to gross premium (₹ Cr). Renewal-heavy = a sticky book.
  incomeFirstYearPremium: number | null;
  incomeRenewalPremium: number | null;
  incomeSinglePremium: number | null;
  incomeFromInvestments: number | null; // ₹ Cr — CAN BE NEGATIVE (mark-to-market)
  benefitsPaidNet: number | null;
  changeInValuationOfLiabilities: number | null; // ₹ Cr — can be negative
  netProfit: number | null;
  netMargin: number | null; // % (already-percent passthrough — NOT ×100)

  solvencyRatio: number | null; // × (MULTIPLE — display 1.90×, NOT a percent)
  persistency13M: number | null; // % (fraction→%; null when source value suspect — guard)

  // growth (already %)
  premiumQoq: number | null;
  premiumYoy: number | null;
  patQoq: number | null;
  patYoy: number | null;
}

/** The 13/25/37/49/61-month persistency ladder — % of policies still in force after N
 *  months. Each leg is null when the source filing's value is suspect (guard). */
export interface PersistencyLadder {
  m13: number | null; // %
  m25: number | null; // %
  m37: number | null; // %
  m49: number | null; // %
  m61: number | null; // %
}

/** ANNUAL CONTEXT — life_insurance_fundamentals, latest year, chosen basis. Ratios
 *  canonical PERCENT (solvency is a MULTIPLE); money ₹ Cr; per-share ₹. NO fcf/capex. */
export interface LifeInsuranceAnnual {
  fiscalYear: string;

  // profitability & disclosed insurance ratios
  roe: number | null; // %
  solvencyRatio: number | null; // × (MULTIPLE — display 1.90×)
  newBusinessPremiumPct: number | null; // % (first-year ÷ total premium)
  expenseRatioPolicyholders: number | null; // % (opex ÷ premium)
  persistency: PersistencyLadder; // %, each leg guarded

  // premium mix — the three lines sum to gross premium (₹ Cr)
  incomeFirstYearPremium: number | null;
  incomeRenewalPremium: number | null;
  incomeSinglePremium: number | null;

  // growth (already %; null on the earliest year with no prior of the same basis)
  premiumGrowthYoy: number | null;
  patGrowthYoy: number | null;

  // balance sheet — the policyholders' fund dominates (₹ Cr)
  policyholdersFunds: number | null;
  assetsHeldToCoverLinkedLiabilities: number | null; // ₹ Cr (ULIP-linked)
  investmentsShareholders: number | null;
  investmentsPolicyholders: number | null;
  shareCapital: number | null;
  reservesAndSurplus: number | null;
  netWorth: number | null;
  totalAssets: number | null;

  // per-share — ₹
  basicEps: number | null;
  bookValuePerShare: number | null;
}

/** One fiscal year of the life-insurance headline-ratio history — feeds the solvency &
 *  persistency sparklines. solvency is the MULTIPLE (×); persistency13M the guarded %. */
export interface LiRatioHistoryPoint {
  fiscalYear: string;
  solvencyRatio: number | null; // × (MULTIPLE)
  persistency13M: number | null; // % (guarded; null when source value suspect)
}

export interface LifeInsurancePayload {
  quarters: LifeInsuranceQuarter[]; // oldest → newest
  annual: LifeInsuranceAnnual | null;
  ratioHistory: LiRatioHistoryPoint[]; // oldest → newest; for solvency/persistency sparklines
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERAL INSURANCE family — combined-ratio / underwriting accounting (gross premium
// → premium earned → incurred claims → underwriting result), a DIFFERENT statement
// from life. The risk lens is the COMBINED RATIO (claims + expenses as a % of premium;
// above 100% = an underwriting loss before investment income — a FACT, not a verdict)
// and SOLVENCY. combinedRatio is a PERCENT that CAN EXCEED 100. netUnderwritingMargin
// and underwritingProfitOrLoss can be legitimately NEGATIVE — preserved. solvencyRatio
// is a MULTIPLE (2.67×). The BS investments line is NOT reconciled to totalAssets (GI
// convention). Several XBRL columns are honestly null. Single stock, thin history. No FCF.
// ─────────────────────────────────────────────────────────────────────────────

/** One quarter of the GENERAL-INSURANCE EARNINGS SPINE (general_insurance_quarterly_
 *  results, chosen basis, oldest→newest). */
export interface GeneralInsuranceQuarter {
  periodKey: string; // "FY26Q4"
  reportDate: string; // YYYY-MM-DD

  // premium & earnings spine — ₹ Cr
  grossPremiumsWritten: number | null;
  netPremium: number | null;
  premiumEarned: number | null;
  incurredClaims: number | null;
  netCommission: number | null;
  underwritingProfitOrLoss: number | null; // ₹ Cr — CAN BE NEGATIVE (underwriting loss)
  netProfit: number | null;
  netMargin: number | null; // % (already-percent passthrough — NOT ×100)

  // underwriting ratios (fraction→%)
  combinedRatio: number | null; // % — CAN EXCEED 100 (above 100 = underwriting loss)
  incurredClaimRatio: number | null; // % (= loss ratio)
  expensesOfManagementRatio: number | null; // %
  netRetentionRatio: number | null; // %
  netUnderwritingMargin: number | null; // % — can be negative
  solvencyRatio: number | null; // × (MULTIPLE — display 2.67×, NOT a percent)

  // growth (already %)
  gpwQoq: number | null;
  gpwYoy: number | null;
  patQoq: number | null;
  patYoy: number | null;
}

/** ANNUAL CONTEXT — general_insurance_fundamentals, latest year, chosen basis. Ratios
 *  canonical PERCENT (solvency is a MULTIPLE); money ₹ Cr; per-share ₹. NO fcf/capex.
 *  investments is its OWN line — NOT reconciled against totalAssets (GI convention). */
export interface GeneralInsuranceAnnual {
  fiscalYear: string;

  // profitability & disclosed underwriting ratios
  roe: number | null; // %
  solvencyRatio: number | null; // × (MULTIPLE — display 2.67×)
  combinedRatio: number | null; // % — can exceed 100
  incurredClaimRatio: number | null; // %
  expensesOfManagementRatio: number | null; // %
  netRetentionRatio: number | null; // %
  netUnderwritingMargin: number | null; // % — can be negative

  // growth (already %; null on the earliest year)
  gpwGrowthYoy: number | null;
  patGrowthYoy: number | null;

  // reserve adequacy — ₹ Cr; the reserve set aside when premiums are inadequate for expected
  // claims. 0 = none required (adequate pricing); a positive figure is a reserve-adequacy flag.
  premiumDeficiency: number | null;

  // balance sheet — conventional GI; investments NOT cross-derived vs totalAssets
  investments: number | null; // ₹ Cr (own line)
  totalAssets: number | null; // ₹ Cr (context only)
  shareCapital: number | null;
  reservesAndSurplus: number | null;
  netWorth: number | null;

  // per-share — ₹
  basicEps: number | null;
  bookValuePerShare: number | null;
}

export interface GeneralInsurancePayload {
  quarters: GeneralInsuranceQuarter[]; // oldest → newest
  annual: GeneralInsuranceAnnual | null;
}

/** THE top-level read-model returned by GET /api/stocks/:symbol/fundamentals. */
export interface FundamentalsView {
  // ── shared envelope — every family ──
  symbol: string;
  name: string;
  industryType: IndustryFamily;
  family: IndustryFamily; // UI branch key (mirror of industryType)
  built: boolean; // false → family not yet implemented → honest "coming" state
  basis: Basis; // the basis actually used to build the payload
  basisAvailable: Basis[]; // which bases have data (enables the tab's basis toggle)
  historyDepth: { quarters: number; years: number };
  notes: string[]; // honest data-state flags ("limited history", "market cap unavailable", …)

  // ── exactly one populated per family; the other four null ──
  nonFinancial: NonFinancialPayload | null;
  banking: BankingPayload | null;
  nbfc: NbfcPayload | null;
  lifeInsurance: LifeInsurancePayload | null;
  generalInsurance: GeneralInsurancePayload | null;
}
