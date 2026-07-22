// ═══════════════════════════════════════════════════════════════
// THE SCORE-INPUT COLUMN MANIFEST — which columns can move a Health Score.
//
// WHY THIS FILE EXISTS. The rescore trigger used to fire on "we wrote a row". But the results
// ingest blind-overwrites every column on every pass (`create: data, update: data`) and decides
// to rewrite on `filingDate` alone — never on a value. Measured: rows rewritten ~19× each, and
// 158 of 168 resulting rescores (94%) moved no score at all. This manifest is what lets the
// trigger ask the honest question instead: "did a column the SCORER ACTUALLY READS change value?"
//
// ⚠️  THE CLASSIFICATION IS PER-TABLE, AND THAT IS NOT PEDANTRY — IT IS THE WHOLE POINT.
//     `operatingMargin` is COSMETIC on quarterly_results (the momentum engine derives OPM itself
//     from operatingProfit; loadMomentumStandalone never reads the stored column) and
//     SCORE-RELEVANT on fundamentals (loadFoundationStandalone reads it in its `stored:{}` block).
//     The same is true of pcr / costToIncomeRatio / netInterestMargin / nii: read from
//     banking_fundamentals, NOT read from banking_quarterly_results.
//     A global "derived ratios are cosmetic" rule would silently drop real Foundation changes.
//
// HOW EACH SET WAS DERIVED — from the loader, not from intent. The loaders return a TYPED object,
// and the scoring engine can only ever see that object. So a column absent from the loader's
// `.map()` is structurally unreachable by any metric. Each set below cites its loader; if you
// change a loader, change the set in the same commit.
//
// KEYS COUNT AS SCORE-RELEVANT. stockId / resultType / reportDate / fiscalYear / quarter are not
// "values", but they decide WHICH rows load (the `where`), the point-in-time gate, and the sort
// order. Move one and a different series reaches the engine. They are inputs.
//
// FAIL-LOUD ON DRIFT: every field of each model must appear in exactly one of the two lists.
// src/scripts/verify-score-input-columns.ts asserts that against prisma/schema.prisma and fails
// the build otherwise — so a newly-added column can never DEFAULT to cosmetic and silently drop
// a real score change. That default is the one failure mode this whole mechanism exists to prevent.
// ═══════════════════════════════════════════════════════════════

/** The tables whose writes can move a Vytal Health Score. */
export type ScoreInputTable =
  | "quarterly_results"
  | "fundamentals"
  | "banking_quarterly_results"
  | "banking_fundamentals"
  | "shareholding_patterns";

export interface ColumnClassification {
  /** The Prisma model name — used by the build guard to read the field list from schema.prisma. */
  model: string;
  /** The loader whose `.map()` this set was read off. Change one, change the other. */
  derivedFrom: string;
  /** Columns the scorer reads. A CHANGE HERE MUST TRIGGER A RESCORE. */
  relevant: readonly string[];
  /** Columns no scoring path reads. Written, displayed, audited — never scored. */
  cosmetic: readonly string[];
  /** Relation fields — not columns; excluded from the completeness check. */
  relations: readonly string[];
}

// ── quarterly_results ────────────────────────────────────────────────────────────────────────
// Loader: src/scoring/metrics/load.ts → loadMomentumStandalone (the SOLE composite-path reader;
// scoring/read/* are display services and errors/stale-snapshot-guard.ts only groupBy's createdAt).
const QUARTERLY_RESULTS: ColumnClassification = {
  model: "QuarterlyResult",
  derivedFrom: "loadMomentumStandalone (src/scoring/metrics/load.ts:76)",
  relevant: [
    // keys: the `where` (stockId, resultType), the PIT gate (reportDate), the sort (fiscalYear, quarter)
    "stockId", "resultType", "reportDate", "fiscalYear", "quarter",
    // values actually mapped into MomentumQuarter
    "revenue", "otherIncome", "interest", "depreciation",
    "profitBeforeTax", "netProfit", "operatingProfit",
  ],
  cosmetic: [
    "id", "filingDate", "xbrlUrl", "source", "xbrlTaxonomy",
    // written by the ingest, never mapped into MomentumQuarter:
    "expenses", "tax",
    // ⚠️ COSMETIC *HERE ONLY* — the engine derives OPM from operatingProfit/revenue.
    "operatingMargin", "netMargin",
    // derived display ratios (deriveIndAsQuarterly) — no metric reads them
    "revenueQoq", "revenueYoy", "profitQoq", "profitYoy",
    "extraMetrics", "createdAt", "updatedAt",
  ],
  relations: ["stock"],
};

// ── fundamentals ─────────────────────────────────────────────────────────────────────────────
// Loader: src/scoring/metrics/load.ts → loadFoundationStandalone. NOTE its `stored:{}` block —
// those NINE derived ratios ARE read, which is what makes this table's rule the opposite of
// quarterly_results'.
const FUNDAMENTALS: ColumnClassification = {
  model: "Fundamental",
  derivedFrom: "loadFoundationStandalone (src/scoring/metrics/load.ts:29)",
  relevant: [
    "stockId", "resultType", "reportDate", "fiscalYear",
    // mapped raw fields
    "revenue", "otherIncome", "financeCosts", "depreciation", "profitBeforeTax", "netProfit",
    "equityShareCapital", "otherEquity", "totalEquity",
    "borrowingsCurrent", "borrowingsNoncurrent", "totalDebt",
    "totalAssets", "currentLiabilities",
    "tradeReceivablesCurrent", "tradeReceivablesNoncurrent",
    "propertyPlantAndEquipment", "capitalWorkInProgress",
    "cashFromOperating", "capex", "cashFromFinancing", "faceValueShare",
    // the `stored:{}` block — ⚠️ operatingMargin IS SCORE-RELEVANT HERE
    "roce", "roe", "debtToEquity", "interestCoverage", "receivablesDays",
    "assetTurnover", "netWorth", "operatingMargin", "ebitda",
  ],
  cosmetic: [
    "id", "filingDate", "xbrlUrl", "source", "xbrlTaxonomy",
    "expenses", "employeeBenefitExpense", "tax",
    // equityAttributableToOwners feeds netWorth in the derive — but netWorth itself is compared,
    // so a change that moves the score is caught there, and one that doesn't cannot move it.
    "equityAttributableToOwners",
    "tradePayablesCurrent", "tradePayablesNoncurrent",
    "otherCurrentLiabilities", "otherNoncurrentLiabilities",
    "otherCurrentFinancialLiabilities", "otherNoncurrentFinancialLiabilities",
    "provisionsCurrent", "provisionsNoncurrent", "currentTaxLiabilities",
    "deferredTaxLiabilitiesNet", "noncurrentLiabilities",
    "goodwill", "otherIntangibleAssets", "intangibleAssetsUnderDevelopment",
    "noncurrentInvestments", "loansNoncurrent", "otherNoncurrentFinancialAssets",
    "otherNoncurrentAssets", "deferredTaxAssetsNet", "investmentProperty",
    "investmentsEquityMethod", "noncurrentAssets",
    "inventories", "currentInvestments", "cashAndCashEquivalents", "bankBalanceOther",
    "loansCurrent", "otherCurrentFinancialAssets", "otherCurrentAssets",
    "currentTaxAssets", "noncurrentAssetsHeldForSale", "currentAssets",
    "cashFromInvesting", "netCashFlow",
    "proceedsFromBorrowings", "repaymentsOfBorrowings", "dividendsPaid", "interestPaid", "fcf",
    "basicEps", "dilutedEps", "paidUpEquityCapital",
    "netMargin", "bookValuePerShare", "inventoryTurnover",
    "revenueGrowthYoy", "profitGrowthYoy", "epsGrowthYoy",
    "extraMetrics", "createdAt", "updatedAt",
  ],
  relations: ["stock"],
};

// ── banking_quarterly_results ────────────────────────────────────────────────────────────────
// Loader: src/scoring/metrics/banking-load.ts → loadBankingQuarterlyStandalone.
// ⚠️ Unlike its ANNUAL sibling, this loader has NO `stored:{}` block: pcr / costToIncomeRatio /
//    nii / netMargin are written here but never read. Same asymmetry as operatingMargin.
const BANKING_QUARTERLY: ColumnClassification = {
  model: "BankingQuarterlyResult",
  derivedFrom: "loadBankingQuarterlyStandalone (src/scoring/metrics/banking-load.ts:54)",
  relevant: [
    "stockId", "resultType", "reportDate", "fiscalYear", "quarter",
    "interestEarned", "interestExpended", "otherIncome", "operatingExpenses", "ppop", "netProfit",
    "gnpaAbsolute", "nnpaAbsolute", "gnpaPct", "nnpaPct",
    "cet1Ratio", "additionalTier1Ratio", "roaQuarterly",
  ],
  cosmetic: [
    "id", "filingDate", "xbrlUrl", "source", "xbrlTaxonomy",
    "employeesCost", "expenditureExclProvisions", "provisions", "exceptionalItems",
    "profitBeforeTax", "tax", "profitAfterTax",
    // ⚠️ COSMETIC *HERE ONLY* — the ANNUAL loader reads these; the quarterly one does not.
    "pcr", "tier1Ratio", "nii", "totalIncome", "costToIncomeRatio", "netMargin",
    "auditPending",
    "niiQoq", "niiYoy", "patQoq", "patYoy",
    "extraMetrics", "createdAt", "updatedAt",
  ],
  relations: ["stock"],
};

// ── banking_fundamentals ─────────────────────────────────────────────────────────────────────
// Loader: src/scoring/metrics/banking-load.ts → loadBankingAnnualStandalone (HAS a `stored:{}`).
const BANKING_FUNDAMENTALS: ColumnClassification = {
  model: "BankingFundamental",
  derivedFrom: "loadBankingAnnualStandalone (src/scoring/metrics/banking-load.ts:16)",
  relevant: [
    "stockId", "resultType", "reportDate", "fiscalYear",
    "interestEarned", "interestExpended", "otherIncome", "operatingExpenses", "ppop",
    "profitBeforeTax", "netProfit",
    "advances", "investments", "cashAndBalancesWithRbi", "balancesWithBanks",
    "totalAssets", "deposits",
    "gnpaAbsolute", "nnpaAbsolute", "gnpaPct", "nnpaPct",
    "cet1Ratio", "additionalTier1Ratio", "tier1Ratio", "roaDisclosed",
    // the `stored:{}` block — read HERE, unlike on the quarterly table
    "pcr", "costToIncomeRatio", "netInterestMargin", "nii",
  ],
  cosmetic: [
    "id", "filingDate", "xbrlUrl", "source", "xbrlTaxonomy",
    "interestOnAdvances", "revenueOnInvestments", "interestOnRbiBalances", "otherInterest",
    "employeesCost", "otherOperatingExpenses", "expenditureExclProvisions",
    "provisions", "exceptionalItems", "extraordinaryItems", "tax", "profitAfterTax",
    "capital", "reservesAndSurplus", "reserveExclRevaluation", "borrowings",
    "otherLiabilities", "capitalAndLiabilities", "fixedAssets", "otherAssets",
    "cashFromOperating", "cashFromInvesting", "cashFromFinancing", "netCashFlow",
    "basicEps", "dilutedEps", "faceValueShare", "paidUpEquityCapital",
    "totalIncome", "creditCostPct", "roe", "creditDepositRatio", "netWorth", "bookValuePerShare",
    "niiGrowthYoy", "patGrowthYoy", "depositGrowthYoy", "advanceGrowthYoy", "assetGrowthYoy",
    "extraMetrics", "createdAt", "updatedAt",
  ],
  relations: ["stock"],
};

// ── shareholding_patterns ────────────────────────────────────────────────────────────────────
// Loader: the explicit `select` at src/scoring/composite/score-pass.ts:234, which builds
// OwnershipQuarter. The findings hook reads the SAME `r.own`, so that select is the whole surface.
// ⚠️ promoterPledgedPct / promoterPledgedSharesPct are COSMETIC: computeOwnership derives pledge
//    from the raw pledgedShares / promoterShares BigInts, never from the stored percentages.
const SHAREHOLDING_PATTERNS: ColumnClassification = {
  model: "ShareholdingPattern",
  derivedFrom: "the shareholding select in computePgScores (src/scoring/composite/score-pass.ts:234)",
  relevant: [
    "stockId", "asOnDate", "quarter", "fiscalYear",
    "promoterShares", "totalShares", "pledgedShares",
    "promoterPct", "fiiPct", "diiPct", "retailPct",
  ],
  cosmetic: [
    "id", "symbol",
    "publicPct", "employeeTrustPct", "othersPct",
    "mutualFundPct", "insurancePct", "banksFisPct",
    "promoterPledgedPct", "promoterPledgedSharesPct",
    "xbrlUrl", "sourceDate", "createdAt",
  ],
  relations: ["stock"],
};

export const SCORE_INPUT_COLUMNS: Record<ScoreInputTable, ColumnClassification> = {
  quarterly_results: QUARTERLY_RESULTS,
  fundamentals: FUNDAMENTALS,
  banking_quarterly_results: BANKING_QUARTERLY,
  banking_fundamentals: BANKING_FUNDAMENTALS,
  shareholding_patterns: SHAREHOLDING_PATTERNS,
};

/** The Prisma `select` for reading the prior row's score-relevant values. */
export function scoreRelevantSelect(table: ScoreInputTable): Record<string, true> {
  const out: Record<string, true> = {};
  for (const c of SCORE_INPUT_COLUMNS[table].relevant) out[c] = true;
  return out;
}
