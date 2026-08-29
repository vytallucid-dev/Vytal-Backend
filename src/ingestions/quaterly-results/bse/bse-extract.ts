// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BSE DOCUMENT → CELLS.
//
// ★ THERE IS NO NEW PARSER HERE, AND THAT IS THE POINT. NSE's pre-2025 XBRL *is* the BSE taxonomy —
//   same `in-bse-fin` namespace, same OneD/FourD/OneI contexts, byte-identical values. VERIFIED on
//   ACC FY23: the NSE archive copy and the BSE copy both carry
//   RevenueFromOperations[FourD] = 222099700000.00. So this file reuses `extractNumber` from
//   legacy/parser-legacy-common.ts unchanged — including its ÷1e7 INR → ₹ Crore scaling, which is
//   exactly the 10,000,000 ratio the cross-source probe measured.
//
// ⚠ DO NOT reach for xbrl/extract.ts or xbrl/parser-common.ts::extractCommonMetadata here. Both
//   default to prefix="in-capmkt" and would return all-nulls SILENTLY on a BSE document rather than
//   throwing — a contentless row, not an error.
//
// ⚠ CONTEXT PER GRAIN IS LOAD-BEARING. Quarterly P&L is OneD; ANNUAL P&L is FourD; balance sheet is
//   OneI in both. A March filing carries OneD (Q4) *and* FourD (full year) with the SAME end date,
//   so the context is the only thing separating a quarter from a year. See bse-period-guard.ts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { extractNumber, factNs } from "../legacy/parser-legacy-common.js";
import { extractCommonPerShare } from "../xbrl/parser-common.js";
import { evaluateRatios, refusedFields, type RatioVerdict, type CrossDocReference } from "./bse-ratio-gate.js";
import type {
  QuarterlyCells,
  BankingQuarterlyCells,
  FundamentalCells,
  BankingFundamentalCells,
  NbfcQuarterlyCells,
  NbfcFundamentalCells,
  LifeInsuranceQuarterlyCells,
  LifeInsuranceFundamentalCells,
  GeneralInsuranceQuarterlyCells,
  GeneralInsuranceFundamentalCells,
} from "./bse-writer.js";

const QUARTER_CTX = "OneD";
const ANNUAL_CTX = "FourD";
const BS_CTX = "OneI";

export interface ExtractResult<T> {
  cells: T;
  /** Every ratio verdict, accepted and refused alike — the caller logs all of them. */
  ratioVerdicts: RatioVerdict[];
}

/**
 * A bank declares itself by carrying InterestEarned and no RevenueFromOperations.
 *
 * ⚠ NAMESPACE-AWARE. BSE's inline-XBRL filings use `in-capmkt`, not `in-bse-fin`. Hardcoding the old
 *   prefix here made every post-cutover document look non-banking — silently, because the test
 *   returns false rather than throwing, and a bank would then be read with the wrong extractor.
 */
export function isBankingDocument(xml: string): boolean {
  const ns = factNs(xml);
  const hasInterestEarned = new RegExp(`<${ns}:InterestEarned[\s>]`).test(xml);
  const hasRevenue = new RegExp(`<${ns}:RevenueFromOperations[\s>]`).test(xml);
  return hasInterestEarned && !hasRevenue;
}

export function extractQuarterlyCells(xml: string): ExtractResult<QuarterlyCells> {
  const n = (tag: string) => extractNumber(xml, tag, QUARTER_CTX);
  return {
    cells: {
      revenue: n("RevenueFromOperations"),
      otherIncome: n("OtherIncome"),
      expenses: n("Expenses"),
      depreciation: n("DepreciationDepletionAndAmortisationExpense"),
      interest: n("FinanceCosts"),
      profitBeforeTax: n("ProfitBeforeTax"),
      tax: n("TaxExpense"),
      netProfit: n("ProfitLossForPeriod"),
    },
    ratioVerdicts: [],
  };
}

export function extractBankingQuarterlyCells(
  xml: string,
  crossDoc?: CrossDocReference,
): ExtractResult<BankingQuarterlyCells> {
  const n = (tag: string) => extractNumber(xml, tag, QUARTER_CTX);
  const verdicts = evaluateRatios(xml, "banking", "quarterly", QUARTER_CTX, crossDoc);
  const refused = refusedFields(verdicts);
  const ratio = (field: string, tag: string): number | null =>
    refused.has(field) ? null : extractNumber(xml, tag, QUARTER_CTX);

  return {
    cells: {
      interestEarned: n("InterestEarned"),
      interestExpended: n("InterestExpended"),
      otherIncome: n("OtherIncome"),
      operatingExpenses: n("OperatingExpenses"),
      ppop: n("OperatingProfitBeforeProvisionAndContingencies"),
      profitBeforeTax: n("ProfitLossFromOrdinaryActivitiesBeforeTax"),
      tax: n("TaxExpense"),
      netProfit: n("ProfitLossForThePeriod"),
      gnpaAbsolute: n("GrossNonPerformingAssets"),
      nnpaAbsolute: n("NonPerformingAssets"),
      // ⚠ Every one of these is null unless the gate accepted it.
      gnpaPct: ratio("gnpa_pct", "PercentageOfGrossNpa"),
      nnpaPct: ratio("nnpa_pct", "PercentageOfNpa"),
      cet1Ratio: ratio("cet1_ratio", "CET1Ratio"),
      additionalTier1Ratio: ratio("additional_tier1_ratio", "AdditionalTier1Ratio"),
      roaQuarterly: ratio("roa_quarterly", "ReturnOnAssets"),
    },
    ratioVerdicts: verdicts,
  };
}

export function extractFundamentalCells(xml: string): ExtractResult<FundamentalCells> {
  const p = (tag: string) => extractNumber(xml, tag, ANNUAL_CTX);
  const b = (tag: string) => extractNumber(xml, tag, BS_CTX);
  const perShare = extractCommonPerShare(xml, ANNUAL_CTX, BS_CTX);
  return {
    cells: {
      revenue: p("RevenueFromOperations"),
      otherIncome: p("OtherIncome"),
      expenses: p("Expenses"),
      employeeBenefitExpense: p("EmployeeBenefitExpense"),
      financeCosts: p("FinanceCosts"),
      depreciation: p("DepreciationDepletionAndAmortisationExpense"),
      profitBeforeTax: p("ProfitBeforeTax"),
      tax: p("TaxExpense"),
      netProfit: p("ProfitLossForPeriod"),
      faceValueShare: p("FaceValueOfEquityShareCapital"),
      totalAssets: b("Assets"),
      propertyPlantAndEquipment: b("PropertyPlantAndEquipment"),
      capitalWorkInProgress: b("CapitalWorkInProgress"),
      tradeReceivablesCurrent: b("TradeReceivablesCurrent"),
      // ⚠ MEASURED: tagged 0 in 5 of 6 annual instances and omitted in the 6th (ACC, where our own
      //   DB also has it absent). A null here is a real absence, never a defaulted zero.
      tradeReceivablesNoncurrent: b("TradeReceivablesNoncurrent"),
      borrowingsCurrent: b("BorrowingsCurrent"),
      borrowingsNoncurrent: b("BorrowingsNoncurrent"),
      currentLiabilities: b("CurrentLiabilities"),
      equityShareCapital: b("EquityShareCapital"),
      otherEquity: b("OtherEquity"),
      totalEquity: b("Equity"),
      cashFromOperating: p("CashFlowsFromUsedInOperatingActivities"),
      cashFromFinancing: p("CashFlowsFromUsedInFinancingActivities"),
      capex: p("PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"),

      // -- BALANCE SHEET + CASH FLOW ----------------------------------------------------------
      // Every tag below is copied from parser-indas.ts, which reads the SAME taxonomy for the NSE
      // lane. Copied rather than re-derived so the lanes cannot drift on what a field is called: a
      // tag right in one lane and subtly wrong in the other is invisible until someone compares two
      // stocks and finds one inexplicably empty.
      equityAttributableToOwners: b("EquityAttributableToOwnersOfParent"),
      tradePayablesCurrent: b("TradePayablesCurrent"),
      tradePayablesNoncurrent: b("TradePayablesNoncurrent"),
      otherCurrentLiabilities: b("OtherCurrentLiabilities"),
      otherNoncurrentLiabilities: b("OtherNoncurrentLiabilities"),
      otherCurrentFinancialLiabilities: b("OtherCurrentFinancialLiabilities"),
      otherNoncurrentFinancialLiabilities: b("OtherNoncurrentFinancialLiabilities"),
      provisionsCurrent: b("ProvisionsCurrent"),
      provisionsNoncurrent: b("ProvisionsNoncurrent"),
      currentTaxLiabilities: b("CurrentTaxLiabilities"),
      deferredTaxLiabilitiesNet: b("DeferredTaxLiabilitiesNet"),
      noncurrentLiabilities: b("NoncurrentLiabilities"),
      goodwill: b("Goodwill"),
      otherIntangibleAssets: b("OtherIntangibleAssets"),
      intangibleAssetsUnderDevelopment: b("IntangibleAssetsUnderDevelopment"),
      noncurrentInvestments: b("NoncurrentInvestments"),
      loansNoncurrent: b("LoansNoncurrent"),
      otherNoncurrentFinancialAssets: b("OtherNoncurrentFinancialAssets"),
      otherNoncurrentAssets: b("OtherNoncurrentAssets"),
      deferredTaxAssetsNet: b("DeferredTaxAssetsNet"),
      investmentProperty: b("InvestmentProperty"),
      investmentsEquityMethod: b("InvestmentsAccountedForUsingEquityMethod"),
      noncurrentAssets: b("NoncurrentAssets"),
      inventories: b("Inventories"),
      currentInvestments: b("CurrentInvestments"),
      cashAndCashEquivalents: b("CashAndCashEquivalents"),
      bankBalanceOther: b("BankBalanceOtherThanCashAndCashEquivalents"),
      loansCurrent: b("LoansCurrent"),
      otherCurrentFinancialAssets: b("OtherCurrentFinancialAssets"),
      otherCurrentAssets: b("OtherCurrentAssets"),
      currentTaxAssets: b("CurrentTaxAssets"),
      noncurrentAssetsHeldForSale: b("NoncurrentAssetsClassifiedAsHeldForSale"),
      currentAssets: b("CurrentAssets"),
      cashFromInvesting: p("CashFlowsFromUsedInInvestingActivities"),
      netCashFlow: p("IncreaseDecreaseInCashAndCashEquivalents"),
      proceedsFromBorrowings: p("ProceedsFromBorrowingsClassifiedAsFinancingActivities"),
      repaymentsOfBorrowings: p("RepaymentsOfBorrowingsClassifiedAsFinancingActivities"),
      dividendsPaid: p("DividendsPaidClassifiedAsFinancingActivities"),

      // EPS and paid-up capital go through the shared helper, which already knows the three tag
      // spellings filers use for basic EPS. Re-implementing it here would be a fourth copy.
      //
      // ⚠ NOTE the explicit three-field pick rather than a spread. The helper ALSO returns
      //   faceValueShare, and spreading it would silently override the mapping a few lines above —
      //   which is already populated on BSE rows and was never part of this gap. tsc caught the
      //   collision (TS2783); taking only the three new fields leaves existing behaviour untouched.
      basicEps: perShare.basicEps,
      dilutedEps: perShare.dilutedEps,
      paidUpEquityCapital: perShare.paidUpEquityCapital,

      // Two tags, in this order — a filer may classify interest paid under financing OR
      // operating activities. Same fallback parser-indas.ts uses for the NSE lane.
      interestPaid: p("InterestPaidClassifiedAsFinancingActivities")
        ?? p("InterestPaidClassifiedAsOperatingActivities"),
    },
    ratioVerdicts: [],
  };
}

export function extractBankingFundamentalCells(xml: string): ExtractResult<BankingFundamentalCells> {
  const p = (tag: string) => extractNumber(xml, tag, ANNUAL_CTX);
  const b = (tag: string) => extractNumber(xml, tag, BS_CTX);
  const verdicts = evaluateRatios(xml, "banking", "annual", ANNUAL_CTX);
  const refused = refusedFields(verdicts);
  const ratio = (field: string, tag: string): number | null =>
    refused.has(field) ? null : extractNumber(xml, tag, ANNUAL_CTX);

  return {
    cells: {
      interestEarned: p("InterestEarned"),
      interestExpended: p("InterestExpended"),
      otherIncome: p("OtherIncome"),
      operatingExpenses: p("OperatingExpenses"),
      ppop: p("OperatingProfitBeforeProvisionAndContingencies"),
      profitBeforeTax: p("ProfitLossFromOrdinaryActivitiesBeforeTax"),
      tax: p("TaxExpense"),
      netProfit: p("ProfitLossForThePeriod"),
      advances: b("Advances"),
      deposits: b("Deposits"),
      investments: b("Investments"),
      cashAndBalancesWithRbi: b("CashAndBalancesWithReserveBankOfIndia"),
      balancesWithBanks: b("BalancesWithBanksAndMoneyAtCallAndShortNotice"),
      totalAssets: b("Assets"),
      gnpaAbsolute: p("GrossNonPerformingAssets"),
      nnpaAbsolute: p("NonPerformingAssets"),
      gnpaPct: ratio("gnpa_pct", "PercentageOfGrossNpa"),
      nnpaPct: ratio("nnpa_pct", "PercentageOfNpa"),
      cet1Ratio: ratio("cet1_ratio", "CET1Ratio"),
      additionalTier1Ratio: ratio("additional_tier1_ratio", "AdditionalTier1Ratio"),
      // ⚠ Tier1Ratio has NO TAG in in-bse-fin. Always null — never derived from CET1 + AT1.
      tier1Ratio: ratio("tier1_ratio", "Tier1Ratio"),
      roaDisclosed: ratio("roa_disclosed", "ReturnOnAssets"),
    },
    ratioVerdicts: verdicts,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// NBFC — the Ind-AS cell set, routed to the NBFC tables.
//
// ★ NO NEW TAGS. Verified on CANFINHOME: its FY2019 annual is a Main_Ind_As
//   document and its FY2020 quarterly sits in NBFCUploadDocument, and BOTH carry
//   the same in-bse-fin vocabulary in the same OneD / FourD / OneI contexts that
//   the non-financial extractors already read. The difference between an NBFC and
//   a non-financial filing here is WHERE THE ROW GOES, not how it is parsed.
//
// ⚠ Two derived values, both deliberate:
//   · tax — these documents split CurrentTax and DeferredTax and carry no combined
//     TaxExpense, so it is their sum. Null only when BOTH are absent, otherwise a
//     missing half would silently halve the tax line.
//   · borrowings / investments — the Ind-AS balance sheet splits current from
//     noncurrent; nbfc_fundamentals holds one column each, so they are summed on
//     the same null-safe rule.
// ═══════════════════════════════════════════════════════════════════════════════

/** Null-safe sum: null only when EVERY part is null, so one missing half cannot silently halve a line. */
function sumPresent(...parts: Array<number | null>): number | null {
  const present = parts.filter((v): v is number => v !== null && Number.isFinite(v));
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

export function extractNbfcQuarterlyCells(xml: string): ExtractResult<NbfcQuarterlyCells> {
  const n = (tag: string) => extractNumber(xml, tag, QUARTER_CTX);
  return {
    cells: {
      revenue: n("RevenueFromOperations"),
      otherIncome: n("OtherIncome"),
      totalIncome: n("Income"),
      financeCosts: n("FinanceCosts"),
      employeeBenefitExpense: n("EmployeeBenefitExpense"),
      depreciation: n("DepreciationDepletionAndAmortisationExpense"),
      totalExpenses: n("Expenses"),
      profitBeforeTax: n("ProfitBeforeTax"),
      tax: sumPresent(n("CurrentTax"), n("DeferredTax")),
      netProfit: n("ProfitLossForPeriod"),
    },
    ratioVerdicts: [],
  };
}

export function extractNbfcFundamentalCells(xml: string): ExtractResult<NbfcFundamentalCells> {
  const p = (tag: string) => extractNumber(xml, tag, ANNUAL_CTX);
  const b = (tag: string) => extractNumber(xml, tag, BS_CTX);
  return {
    cells: {
      revenue: p("RevenueFromOperations"),
      otherIncome: p("OtherIncome"),
      totalIncome: p("Income"),
      financeCosts: p("FinanceCosts"),
      employeeBenefitExpense: p("EmployeeBenefitExpense"),
      depreciation: p("DepreciationDepletionAndAmortisationExpense"),
      totalExpenses: p("Expenses"),
      profitBeforeTax: p("ProfitBeforeTax"),
      tax: sumPresent(p("CurrentTax"), p("DeferredTax")),
      netProfit: p("ProfitLossForPeriod"),
      equityShareCapital: b("EquityShareCapital"),
      otherEquity: b("OtherEquity"),
      totalEquity: b("Equity"),
      cashAndCashEquivalents: b("CashAndCashEquivalents"),
      bankBalanceOther: b("BankBalanceOtherThanCashAndCashEquivalents"),
      investments: sumPresent(b("CurrentInvestments"), b("NoncurrentInvestments")),
      propertyPlantAndEquipment: b("PropertyPlantAndEquipment"),
      capitalWorkInProgress: b("CapitalWorkInProgress"),
      goodwill: b("Goodwill"),
      intangibleAssetsUnderDevelopment: b("IntangibleAssetsUnderDevelopment"),
      totalAssets: b("Assets"),
      borrowings: sumPresent(b("BorrowingsCurrent"), b("BorrowingsNoncurrent")),
      totalLiabilities: b("Liabilities"),
      currentTaxAssetsNet: b("CurrentTaxAssets"),
      deferredTaxAssetsNet: b("DeferredTaxAssetsNet"),
      currentTaxLiabilitiesNet: b("CurrentTaxLiabilities"),
      deferredTaxLiabilitiesNet: b("DeferredTaxLiabilitiesNet"),
    },
    ratioVerdicts: [],
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// INSURANCE EXTRACTORS — life and general (Stage 7a, 2026-08-25).
//
// The prefix is `in-capmkt`, handled transparently by factNs() inside
// extractNumber. What differs is the VOCABULARY, and it differs a lot: insurers
// report premiums, claims, commissions and benefits, not revenue and expenses.
//
// ⚠️ NO RATIO TAGS ARE READ. CombinedRatio / IncurredClaimRatio /
//   ExpensesOfManagementRatio / NetRetentionRatio are present in these documents
//   but MIS-SCALED at source — ICICIGI FY19 files CombinedRatio = 0.0098 where the
//   ratio is ~0.98, and its other three are out by the same 100x. They belong
//   behind bse-ratio-gate.ts, not in a straight-through read.
// ═══════════════════════════════════════════════════════════════════════════════

export function extractLifeInsuranceQuarterlyCells(xml: string): ExtractResult<LifeInsuranceQuarterlyCells> {
  const n = (t: string) => extractNumber(xml, t, QUARTER_CTX);
  return {
    cells: {
      grossPremiumIncome: n("GrossPremiumIncome"),
      netPremiumIncome: n("NetPremiumIncome"),
      incomeFirstYearPremium: n("IncomeFirstYearPremium"),
      incomeRenewalPremium: n("IncomeRenewalPremium"),
      incomeSinglePremium: n("IncomeSinglePremium"),
      reinsuranceCeded: n("ReinsuranceCeded"),
      incomeFromInvestments: n("IncomeFromInvestmentsNet"),
      totalRevenuePolicyholders: n("Income"),
      totalCommission: n("Commission"),
      totalOperatingExpenses: n("ExpensesOfManagement"),
      benefitsPaidNet: n("BenefitsPaidNet"),
      changeInValuationOfLiabilities: n("ChangeInActuarialLiability"),
      profitBeforeTax: n("ProfitOrLossBeforeTax"),
      // These filings split the tax line; sum it null-safely rather than losing half.
      tax: sumPresent(n("CurrentTax"), n("DefferedTax")),
      netProfit: n("ProfitLossAfterTaxAndExtraordinaryItems"),
    },
    ratioVerdicts: [],
  };
}

export function extractLifeInsuranceFundamentalCells(xml: string): ExtractResult<LifeInsuranceFundamentalCells> {
  const n = (t: string) => extractNumber(xml, t, ANNUAL_CTX);
  return {
    cells: {
      grossPremiumIncome: n("GrossPremiumIncome"),
      netPremiumIncome: n("NetPremiumIncome"),
      incomeFirstYearPremium: n("IncomeFirstYearPremium"),
      incomeRenewalPremium: n("IncomeRenewalPremium"),
      incomeSinglePremium: n("IncomeSinglePremium"),
      reinsuranceCeded: n("ReinsuranceCeded"),
      incomeFromInvestments: n("IncomeFromInvestmentsNet"),
      otherIncomePolicyholders: n("OtherIncome"),
      totalRevenuePolicyholders: n("Income"),
      commissionFirstYearPremium: n("CommissionFirstYearPremium"),
      commissionRenewalPremium: n("CommissionRenewalPremium"),
      commissionSinglePremium: n("CommissionSinglePremium"),
      totalCommission: n("Commission"),
      employeesRemuneration: n("EmployeesRemunerationAndWelfareExpenses"),
      administrationExpenses: n("AdministrationExpenses"),
      advertisementAndPublicity: n("AdvertisementAndPublicity"),
      totalOperatingExpenses: n("ExpensesOfManagement"),
      benefitsPaidNet: n("BenefitsPaidNet"),
      changeInValuationOfLiabilities: n("ChangeInActuarialLiability"),
      profitBeforeTax: n("ProfitOrLossBeforeTax"),
      tax: sumPresent(n("CurrentTax"), n("DefferedTax")),
      netProfit: n("ProfitLossAfterTaxAndExtraordinaryItems"),
    },
    ratioVerdicts: [],
  };
}

export function extractGeneralInsuranceQuarterlyCells(xml: string): ExtractResult<GeneralInsuranceQuarterlyCells> {
  const n = (t: string) => extractNumber(xml, t, QUARTER_CTX);
  return {
    cells: {
      grossPremiumsWritten: n("GrossPremiumsWritten"),
      netPremiumWritten: n("NetPremiumWritten"),
      netPremium: n("NetPremium"),
      premiumEarned: n("PremiumEarned"),
      incomeFromInvestments: n("IncomeFromInvestmentsNet"),
      otherIncome: n("OtherIncome"),
      totalRevenue: n("OperatingIncome"),
      claimsPaid: n("ClaimsPaid"),
      incurredClaims: n("IncurredClaims"),
      netCommission: n("NetCommission"),
      totalOperatingExpensesRelatedToInsurance: n("OperatingExpensesRelatedToInsuranceBusiness"),
      underwritingProfitOrLoss: n("UnderwritingProfitOrLoss"),
      profitBeforeTax: n("ProfitOrLossBeforeTax"),
      tax: n("ProvisionForTax"),
      netProfit: n("ProfitLossAfterTax"),
    },
    ratioVerdicts: [],
  };
}

export function extractGeneralInsuranceFundamentalCells(xml: string): ExtractResult<GeneralInsuranceFundamentalCells> {
  const n = (t: string) => extractNumber(xml, t, ANNUAL_CTX);
  return {
    cells: {
      grossPremiumsWritten: n("GrossPremiumsWritten"),
      netPremiumWritten: n("NetPremiumWritten"),
      netPremium: n("NetPremium"),
      premiumEarned: n("PremiumEarned"),
      reinsuranceCeded: n("ReinsuranceCeded"),
      changeInUnexpiredRiskReserve: n("ChangeInUnexpiredRiskReserve"),
      incomeFromInvestments: n("IncomeFromInvestmentsNet"),
      otherIncome: n("OtherIncome"),
      totalRevenue: n("OperatingIncome"),
      claimsPaid: n("ClaimsPaid"),
      changeInOutstandingClaims: n("ChangeInOutstandingClaims"),
      incurredClaims: n("IncurredClaims"),
      netCommission: n("NetCommission"),
      employeesRemuneration: n("EmployeesRemunerationAndWelfareExpenses"),
      advertisementAndPublicity: n("AdvertisementAndPublicity"),
      totalOperatingExpensesRelatedToInsurance: n("OperatingExpensesRelatedToInsuranceBusiness"),
      premiumDeficiency: n("PremiumDeficiency"),
      underwritingProfitOrLoss: n("UnderwritingProfitOrLoss"),
      profitBeforeTax: n("ProfitOrLossBeforeTax"),
      tax: n("ProvisionForTax"),
      netProfit: n("ProfitLossAfterTax"),
    },
    ratioVerdicts: [],
  };
}
