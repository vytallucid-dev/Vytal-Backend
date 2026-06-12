// ─────────────────────────────────────────────────────────────
// LEGACY V2 → V3 SHAPE ADAPTER
//
// Routing is driven by Stock.industryType, NOT by v2's taxonomy detection.
// This is because v2 only distinguished banking vs ind_as — NBFC, LI, GI
// stocks were classified as ind_as in v2 but need to land in industry-specific
// v3 tables.
// ─────────────────────────────────────────────────────────────

import type { ParsedQuarterlyResult } from "../xbrl/types.js";
import type { ParsedQuarterly, ParsedAnnual } from "../xbrl/parser.js";
import type {
  ParsedIndAsQuarterly,
  ParsedIndAsAnnual,
} from "../xbrl/parser-indas.js";
import type {
  ParsedBankingQuarterly,
  ParsedBankingAnnual,
} from "../xbrl/parser-banking.js";
import type {
  ParsedNbfcQuarterly,
  ParsedNbfcAnnual,
} from "../xbrl/parser-nbfc.js";
import type {
  ParsedLifeInsuranceQuarterly,
  ParsedLifeInsuranceAnnual,
} from "../xbrl/parser-li.js";
import type {
  ParsedGeneralInsuranceQuarterly,
  ParsedGeneralInsuranceAnnual,
} from "../xbrl/parser-gi.js";
import type {
  ParsedV2Annual,
  ParsedV2AnnualIndAs,
  ParsedV2AnnualBanking,
} from "./parser-legacy-common.js";

type IndustryType =
  | "non_financial"
  | "banking"
  | "nbfc"
  | "life_insurance"
  | "general_insurance";

// ─────────────────────────────────────────────────────────────
// QUARTERLY adapters (v2 only extracted P&L)
// ─────────────────────────────────────────────────────────────

function adaptToIndAsQuarterly(
  v2: ParsedQuarterlyResult,
): ParsedIndAsQuarterly {
  return {
    symbol: v2.symbol,
    quarter: v2.quarter,
    fiscalYear: v2.fiscalYear,
    reportDate: v2.reportDate,
    filingDate: v2.filingDate,
    resultType: v2.resultType,
    xbrlUrl: v2.xbrlUrl,
    revenue: v2.revenue,
    otherIncome: v2.otherIncome,
    expenses: v2.expenses,
    depreciation: v2.depreciation,
    interest: v2.interest,
    profitBeforeTax: v2.profitBeforeTax,
    tax: v2.tax,
    netProfit: v2.netProfit,
    operatingProfit: v2.operatingProfit,
  };
}

function adaptToBankingQuarterly(
  v2: ParsedQuarterlyResult,
): ParsedBankingQuarterly {
  return {
    symbol: v2.symbol,
    quarter: v2.quarter,
    fiscalYear: v2.fiscalYear,
    reportDate: v2.reportDate,
    filingDate: v2.filingDate,
    resultType: v2.resultType,
    xbrlUrl: v2.xbrlUrl,
    interestEarned: v2.revenue, // banking revenue = InterestEarned
    interestExpended: null,
    otherIncome: v2.otherIncome,
    employeesCost: null,
    operatingExpenses: null,
    expenditureExclProvisions: v2.expenses,
    ppop: v2.operatingProfit,
    provisions: null,
    exceptionalItems: null,
    profitBeforeTax: v2.profitBeforeTax,
    tax: v2.tax,
    profitAfterTax: v2.netProfit,
    netProfit: v2.netProfit,
    gnpaAbsolute: null,
    nnpaAbsolute: null,
    gnpaPct: null,
    nnpaPct: null,
    cet1Ratio: null,
    additionalTier1Ratio: null,
    roaQuarterly: null,
    auditPending: false,
  };
}

function adaptToNbfcQuarterly(v2: ParsedQuarterlyResult): ParsedNbfcQuarterly {
  // NBFC quarterly v2 parsed using Ind-AS tags. revenue = RevenueFromOperations.
  // We can map revenue → revenue and interest → financeCosts, but the rest
  // (interestIncome, impairmentOnFinancialInstruments) wasn't extracted in v2.
  return {
    symbol: v2.symbol,
    quarter: v2.quarter,
    fiscalYear: v2.fiscalYear,
    reportDate: v2.reportDate,
    filingDate: v2.filingDate,
    resultType: v2.resultType,
    xbrlUrl: v2.xbrlUrl,
    revenue: v2.revenue,
    interestIncome: null,
    feeAndCommissionIncome: null,
    netGainOnFairValueChanges: null,
    otherIncome: v2.otherIncome,
    totalIncome:
      v2.revenue !== null && v2.otherIncome !== null
        ? v2.revenue + v2.otherIncome
        : null,
    financeCosts: v2.interest,
    impairmentOnFinancialInstruments: null,
    employeeBenefitExpense: null,
    depreciation: v2.depreciation,
    otherExpenses: null,
    totalExpenses: v2.expenses,
    profitBeforeTax: v2.profitBeforeTax,
    tax: v2.tax,
    netProfit: v2.netProfit,
  };
}

function adaptToLiQuarterly(
  v2: ParsedQuarterlyResult,
): ParsedLifeInsuranceQuarterly {
  // v2 did NOT have LI-specific tags. Map only what fits the LI schema.
  return {
    symbol: v2.symbol,
    quarter: v2.quarter,
    fiscalYear: v2.fiscalYear,
    reportDate: v2.reportDate,
    filingDate: v2.filingDate,
    resultType: v2.resultType,
    xbrlUrl: v2.xbrlUrl,
    grossPremiumIncome: v2.revenue, // best approximation: revenue ≈ gross premium
    netPremiumIncome: null,
    incomeFirstYearPremium: null,
    incomeRenewalPremium: null,
    incomeSinglePremium: null,
    reinsuranceCeded: null,
    incomeFromInvestments: null,
    totalRevenuePolicyholders: null,
    totalCommission: null,
    totalOperatingExpenses: v2.expenses,
    benefitsPaidNet: null,
    changeInValuationOfLiabilities: null,
    profitBeforeTax: v2.profitBeforeTax,
    tax: v2.tax,
    netProfit: v2.netProfit,
    solvencyRatio: null,
    persistencyRatio13Month: null,
    persistencyRatio25Month: null,
    persistencyRatio37Month: null,
    persistencyRatio49Month: null,
    persistencyRatio61Month: null,
  };
}

function adaptToGiQuarterly(
  v2: ParsedQuarterlyResult,
): ParsedGeneralInsuranceQuarterly {
  return {
    symbol: v2.symbol,
    quarter: v2.quarter,
    fiscalYear: v2.fiscalYear,
    reportDate: v2.reportDate,
    filingDate: v2.filingDate,
    resultType: v2.resultType,
    xbrlUrl: v2.xbrlUrl,
    grossPremiumsWritten: v2.revenue, // approximation
    netPremiumWritten: null,
    netPremium: null,
    premiumEarned: null,
    incomeFromInvestments: null,
    otherIncome: v2.otherIncome,
    totalRevenue:
      v2.revenue !== null && v2.otherIncome !== null
        ? v2.revenue + v2.otherIncome
        : null,
    claimsPaid: null,
    incurredClaims: null,
    netCommission: null,
    totalOperatingExpensesRelatedToInsurance: v2.expenses,
    underwritingProfitOrLoss: null,
    profitBeforeTax: v2.profitBeforeTax,
    tax: v2.tax,
    netProfit: v2.netProfit,
    combinedRatio: null,
    incurredClaimRatio: null,
    expensesOfManagementRatio: null,
    netRetentionRatio: null,
    solvencyRatio: null,
  };
}

// ─────────────────────────────────────────────────────────────
// ANNUAL adapters (v2 annual has full BS + CFS)
// ─────────────────────────────────────────────────────────────

function adaptToIndAsAnnual(v2: ParsedV2AnnualIndAs): ParsedIndAsAnnual {
  // 1:1 mapping — field names match v3 exactly
  return v2 as unknown as ParsedIndAsAnnual;
}

function adaptToBankingAnnual(v2: ParsedV2AnnualBanking): ParsedBankingAnnual {
  return v2 as unknown as ParsedBankingAnnual;
}

function adaptToNbfcAnnual(v2: ParsedV2Annual): ParsedNbfcAnnual {
  // v2 NBFCs parsed as ind_as. Map relevant fields, null the rest.
  const i = v2 as ParsedV2AnnualIndAs;
  return {
    symbol: i.symbol,
    fiscalYear: i.fiscalYear,
    reportDate: i.reportDate,
    filingDate: i.filingDate,
    resultType: i.resultType,
    xbrlUrl: i.xbrlUrl,
    revenue: i.revenue,
    interestIncome: null,
    feeAndCommissionIncome: null,
    netGainOnFairValueChanges: null,
    otherIncome: i.otherIncome,
    totalIncome:
      i.revenue !== null && i.otherIncome !== null
        ? i.revenue + i.otherIncome
        : null,
    financeCosts: i.financeCosts,
    feeAndCommissionExpense: null,
    impairmentOnFinancialInstruments: null,
    employeeBenefitExpense: i.employeeBenefitExpense,
    depreciation: i.depreciation,
    otherExpenses: null,
    totalExpenses: i.expenses,
    profitBeforeTax: i.profitBeforeTax,
    tax: i.tax,
    netProfit: i.netProfit,
    equityShareCapital: i.equityShareCapital,
    otherEquity: i.otherEquity,
    totalEquity: i.totalEquity,
    cashAndCashEquivalents: i.cashAndCashEquivalents,
    bankBalanceOther: i.bankBalanceOther,
    loans: null, // NBFC-specific, not in v2
    investments: i.noncurrentInvestments, // approximation
    derivativeFinancialAssets: null,
    receivablesTrade: i.tradeReceivablesCurrent,
    otherFinancialAssets: i.otherCurrentFinancialAssets,
    financialAssets: null,
    currentTaxAssetsNet: i.currentTaxAssets,
    deferredTaxAssetsNet: i.deferredTaxAssetsNet,
    propertyPlantAndEquipment: i.propertyPlantAndEquipment,
    capitalWorkInProgress: i.capitalWorkInProgress,
    intangibleAssetsUnderDevelopment: i.intangibleAssetsUnderDevelopment,
    goodwill: i.goodwill,
    otherIntangibleAssets: i.otherIntangibleAssets,
    otherNonFinancialAssets: i.otherCurrentAssets,
    nonFinancialAssets: null,
    totalAssets: i.totalAssets,
    derivativeFinancialLiabilities: null,
    payables: i.tradePayablesCurrent,
    debtSecurities: null,
    borrowings:
      i.borrowingsCurrent !== null || i.borrowingsNoncurrent !== null
        ? (i.borrowingsCurrent ?? 0) + (i.borrowingsNoncurrent ?? 0)
        : null,
    depositsLiabilities: null,
    subordinatedLiabilities: null,
    otherFinancialLiabilities: i.otherCurrentFinancialLiabilities,
    financialLiabilities: null,
    currentTaxLiabilitiesNet: i.currentTaxLiabilities,
    provisions: null,
    deferredTaxLiabilitiesNet: i.deferredTaxLiabilitiesNet,
    otherNonFinancialLiabilities: i.otherCurrentLiabilities,
    nonFinancialLiabilities: null,
    totalLiabilities: null,
    cashFromOperating: i.cashFromOperating,
    cashFromInvesting: i.cashFromInvesting,
    cashFromFinancing: i.cashFromFinancing,
    netCashFlow: i.netCashFlow,
    basicEps: i.basicEps,
    dilutedEps: i.dilutedEps,
    faceValueShare: i.faceValueShare,
    paidUpEquityCapital: i.paidUpEquityCapital,
  };
}

function adaptToLiAnnual(v2: ParsedV2Annual): ParsedLifeInsuranceAnnual {
  // v2 had no LI tags. Most fields null. Use best-effort mapping for what fits.
  const i = v2 as ParsedV2AnnualIndAs;
  const baseNull = null as number | null;
  return {
    symbol: i.symbol,
    fiscalYear: i.fiscalYear,
    reportDate: i.reportDate,
    filingDate: i.filingDate,
    resultType: i.resultType,
    xbrlUrl: i.xbrlUrl,

    grossPremiumIncome: i.revenue,
    netPremiumIncome: baseNull,
    incomeFirstYearPremium: baseNull,
    incomeRenewalPremium: baseNull,
    incomeSinglePremium: baseNull,
    reinsuranceCeded: baseNull,
    incomeFromInvestments: baseNull,
    otherIncomePolicyholders: i.otherIncome,
    totalRevenuePolicyholders: baseNull,

    commissionFirstYearPremium: baseNull,
    commissionRenewalPremium: baseNull,
    commissionSinglePremium: baseNull,
    totalCommission: baseNull,

    employeesRemuneration: i.employeeBenefitExpense,
    administrationExpenses: baseNull,
    advertisementAndPublicity: baseNull,
    totalOperatingExpenses: i.expenses,

    benefitsPaidNet: baseNull,
    changeInValuationOfLiabilities: baseNull,
    allocationOfBonusToPolicyholders: baseNull,

    surplusFromRevenueAccount: baseNull,

    transferFromPolicyholders: baseNull,
    incomeFromInvestmentsShareholders: baseNull,
    otherIncomeShareholders: baseNull,
    shareholdersExpenses: baseNull,
    profitBeforeTax: i.profitBeforeTax,
    tax: i.tax,
    netProfit: i.netProfit,

    shareCapital: i.equityShareCapital,
    reservesAndSurplus: i.otherEquity,
    fairValueChangeAccount: baseNull,
    borrowings:
      i.borrowingsCurrent !== null || i.borrowingsNoncurrent !== null
        ? (i.borrowingsCurrent ?? 0) + (i.borrowingsNoncurrent ?? 0)
        : null,
    policyholdersFunds: baseNull,
    fundsForFutureAppropriations: baseNull,
    totalSourcesOfFunds: baseNull,

    investmentsShareholders: baseNull,
    investmentsPolicyholders: baseNull,
    assetsHeldToCoverLinkedLiabilities: baseNull,
    loansApplicationOfFunds: baseNull,
    fixedAssets: i.propertyPlantAndEquipment,
    cashAndBankBalances: i.cashAndCashEquivalents,
    advancesAndOtherAssets: baseNull,
    currentLiabilities: i.currentLiabilities,
    provisions: baseNull,
    miscellaneousExpenditure: baseNull,
    debitBalanceProfitAndLoss: baseNull,
    totalApplicationOfFunds: baseNull,
    totalAssets: i.totalAssets,

    solvencyRatio: baseNull,
    persistencyRatio13Month: baseNull,
    persistencyRatio25Month: baseNull,
    persistencyRatio37Month: baseNull,
    persistencyRatio49Month: baseNull,
    persistencyRatio61Month: baseNull,

    basicEps: i.basicEps,
    dilutedEps: i.dilutedEps,
    faceValueShare: i.faceValueShare,
    paidUpEquityCapital: i.paidUpEquityCapital,
  };
}

function adaptToGiAnnual(v2: ParsedV2Annual): ParsedGeneralInsuranceAnnual {
  const i = v2 as ParsedV2AnnualIndAs;
  const baseNull = null as number | null;
  return {
    symbol: i.symbol,
    fiscalYear: i.fiscalYear,
    reportDate: i.reportDate,
    filingDate: i.filingDate,
    resultType: i.resultType,
    xbrlUrl: i.xbrlUrl,

    grossPremiumsWritten: i.revenue,
    netPremiumWritten: baseNull,
    netPremium: baseNull,
    premiumEarned: baseNull,
    reinsuranceCeded: baseNull,
    reinsuranceAccepted: baseNull,
    changeInUnexpiredRiskReserve: baseNull,

    incomeFromInvestments: baseNull,
    otherIncome: i.otherIncome,
    totalRevenue:
      i.revenue !== null && i.otherIncome !== null
        ? i.revenue + i.otherIncome
        : null,

    claimsPaid: baseNull,
    changeInOutstandingClaims: baseNull,
    incurredClaims: baseNull,
    reinsuranceRecoveriesOnClaims: baseNull,
    commissionPaid: baseNull,
    commissionReceivedFromReinsurance: baseNull,
    netCommission: baseNull,
    employeesRemuneration: i.employeeBenefitExpense,
    rentRatesAndTaxes: baseNull,
    legalAndProfessionalCharges: baseNull,
    advertisementAndPublicity: baseNull,
    totalOperatingExpensesRelatedToInsurance: i.expenses,

    premiumDeficiency: baseNull,
    underwritingProfitOrLoss: baseNull,

    profitBeforeTax: i.profitBeforeTax,
    tax: i.tax,
    netProfit: i.netProfit,

    shareCapital: i.equityShareCapital,
    reservesAndSurplus: i.otherEquity,
    fairValueChangeAccount: baseNull,
    borrowings:
      i.borrowingsCurrent !== null || i.borrowingsNoncurrent !== null
        ? (i.borrowingsCurrent ?? 0) + (i.borrowingsNoncurrent ?? 0)
        : null,
    totalSourcesOfFunds: baseNull,

    investments: i.noncurrentInvestments,
    loansApplicationOfFunds: baseNull,
    fixedAssets: i.propertyPlantAndEquipment,
    cashAndBankBalances: i.cashAndCashEquivalents,
    advancesAndOtherAssets: baseNull,
    currentLiabilities: i.currentLiabilities,
    provisions: baseNull,
    totalApplicationOfFunds: baseNull,
    totalAssets: i.totalAssets,

    combinedRatio: baseNull,
    incurredClaimRatio: baseNull,
    expensesOfManagementRatio: baseNull,
    netRetentionRatio: baseNull,
    solvencyRatio: baseNull,

    basicEps: i.basicEps,
    dilutedEps: i.dilutedEps,
    faceValueShare: i.faceValueShare,
    paidUpEquityCapital: i.paidUpEquityCapital,
  };
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export function adaptV2ToDispatchableQuarterly(
  v2: ParsedQuarterlyResult,
  industryType: IndustryType,
): ParsedQuarterly {
  switch (industryType) {
    case "banking":
      return { taxonomy: "banking", data: adaptToBankingQuarterly(v2) };
    case "nbfc":
      return { taxonomy: "nbfc", data: adaptToNbfcQuarterly(v2) };
    case "life_insurance":
      return { taxonomy: "li", data: adaptToLiQuarterly(v2) };
    case "general_insurance":
      return { taxonomy: "gi", data: adaptToGiQuarterly(v2) };
    case "non_financial":
    default:
      return { taxonomy: "indas", data: adaptToIndAsQuarterly(v2) };
  }
}

export function adaptV2ToDispatchableAnnual(
  v2: ParsedV2Annual,
  industryType: IndustryType,
): ParsedAnnual {
  switch (industryType) {
    case "banking":
      return {
        taxonomy: "banking",
        data: adaptToBankingAnnual(v2 as ParsedV2AnnualBanking),
      };
    case "nbfc":
      return { taxonomy: "nbfc", data: adaptToNbfcAnnual(v2) };
    case "life_insurance":
      return { taxonomy: "li", data: adaptToLiAnnual(v2) };
    case "general_insurance":
      return { taxonomy: "gi", data: adaptToGiAnnual(v2) };
    case "non_financial":
    default:
      return {
        taxonomy: "indas",
        data: adaptToIndAsAnnual(v2 as ParsedV2AnnualIndAs),
      };
  }
}
