// File: src/ingestions/quaterly-results/xbrl/parser-li.ts (NEW)

import { extractNumber } from "./extract.js";
import {
  BALANCE_SHEET_CONTEXT,
  ANNUAL_PNL_CONTEXT,
  QUARTERLY_PNL_CONTEXT,
} from "./contexts.js";
import {
  extractCommonMetadata,
  extractCommonPerShare,
  deriveFiscalPeriod,
} from "./parser-common.js";
import type { ParseContext } from "./parser-indas.js";

export interface ParsedLifeInsuranceQuarterly {
  symbol: string;
  quarter: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: "standalone" | "consolidated";
  xbrlUrl: string;

  // Revenue Account (Policyholders)
  grossPremiumIncome: number | null;
  netPremiumIncome: number | null;
  incomeFirstYearPremium: number | null;
  incomeRenewalPremium: number | null;
  incomeSinglePremium: number | null;
  reinsuranceCeded: number | null;
  incomeFromInvestments: number | null;
  totalRevenuePolicyholders: number | null;

  // Commission
  totalCommission: number | null;

  // Operating expenses
  totalOperatingExpenses: number | null;

  // Benefits
  benefitsPaidNet: number | null;
  changeInValuationOfLiabilities: number | null;

  // P&L (Shareholders)
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;

  // Disclosed ratios
  solvencyRatio: number | null;
  persistencyRatio13Month: number | null;
  persistencyRatio25Month: number | null;
  persistencyRatio37Month: number | null;
  persistencyRatio49Month: number | null;
  persistencyRatio61Month: number | null;
}

export interface ParsedLifeInsuranceAnnual {
  symbol: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: "standalone" | "consolidated";
  xbrlUrl: string;

  // Revenue Account
  grossPremiumIncome: number | null;
  netPremiumIncome: number | null;
  incomeFirstYearPremium: number | null;
  incomeRenewalPremium: number | null;
  incomeSinglePremium: number | null;
  reinsuranceCeded: number | null;
  incomeFromInvestments: number | null;
  otherIncomePolicyholders: number | null;
  totalRevenuePolicyholders: number | null;

  // Commission
  commissionFirstYearPremium: number | null;
  commissionRenewalPremium: number | null;
  commissionSinglePremium: number | null;
  totalCommission: number | null;

  // Operating expenses
  employeesRemuneration: number | null;
  administrationExpenses: number | null;
  advertisementAndPublicity: number | null;
  totalOperatingExpenses: number | null;

  // Benefits & reserves
  benefitsPaidNet: number | null;
  changeInValuationOfLiabilities: number | null;
  allocationOfBonusToPolicyholders: number | null;

  // Surplus
  surplusFromRevenueAccount: number | null;

  // P&L (Shareholders)
  transferFromPolicyholders: number | null;
  incomeFromInvestmentsShareholders: number | null;
  otherIncomeShareholders: number | null;
  shareholdersExpenses: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;

  // BS — Sources of Funds
  shareCapital: number | null;
  reservesAndSurplus: number | null;
  fairValueChangeAccount: number | null;
  borrowings: number | null;
  policyholdersFunds: number | null;
  fundsForFutureAppropriations: number | null;
  totalSourcesOfFunds: number | null;

  // BS — Application of Funds
  investmentsShareholders: number | null;
  investmentsPolicyholders: number | null;
  assetsHeldToCoverLinkedLiabilities: number | null;
  loansApplicationOfFunds: number | null;
  fixedAssets: number | null;
  cashAndBankBalances: number | null;
  advancesAndOtherAssets: number | null;
  currentLiabilities: number | null;
  provisions: number | null;
  miscellaneousExpenditure: number | null;
  debitBalanceProfitAndLoss: number | null;
  totalApplicationOfFunds: number | null;
  totalAssets: number | null;

  // Disclosed ratios
  solvencyRatio: number | null;
  persistencyRatio13Month: number | null;
  persistencyRatio25Month: number | null;
  persistencyRatio37Month: number | null;
  persistencyRatio49Month: number | null;
  persistencyRatio61Month: number | null;

  // Per-Share
  basicEps: number | null;
  dilutedEps: number | null;
  faceValueShare: number | null;
  paidUpEquityCapital: number | null;
}

/**
 * Common ratio extraction shared between LI quarterly and annual.
 * Insurance-specific tags exposed via in-capmkt-ent for the LI taxonomy.
 */
function extractLiRatios(xml: string, ctx: string) {
  const rawSolvency =
    extractNumber(xml, "SolvencyRatio", ctx) ??
    extractNumber(xml, "SolvencyMargin", ctx);
  // Three of five LI/GI filers (LICI, SBILIFE, ICICIGI) encode solvency as
  // multiple÷100 (e.g. 0.0196 = 1.96×) rather than the multiple directly.
  // Band-test mirrors normalizeSolvency() in fundamentals-view.service.ts.
  const solvencyRatio = rawSolvency !== null && rawSolvency < 0.5 ? rawSolvency * 100 : rawSolvency;
  return {
    solvencyRatio,
    persistencyRatio13Month:
      extractNumber(xml, "PersistencyRatio13ThMonth", ctx) ??
      extractNumber(xml, "PersistencyRatio13Month", ctx),
    persistencyRatio25Month:
      extractNumber(xml, "PersistencyRatio25ThMonth", ctx) ??
      extractNumber(xml, "PersistencyRatio25Month", ctx),
    persistencyRatio37Month:
      extractNumber(xml, "PersistencyRatio37ThMonth", ctx) ??
      extractNumber(xml, "PersistencyRatio37Month", ctx),
    persistencyRatio49Month:
      extractNumber(xml, "PersistencyRatio49ThMonth", ctx) ??
      extractNumber(xml, "PersistencyRatio49Month", ctx),
    persistencyRatio61Month:
      extractNumber(xml, "PersistencyRatio61ThMonth", ctx) ??
      extractNumber(xml, "PersistencyRatio61Month", ctx),
  };
}

export function parseLifeInsuranceQuarterly(
  xml: string,
  ctx: ParseContext,
): ParsedLifeInsuranceQuarterly {
  const meta = extractCommonMetadata(xml, "quarterly");
  if (
    !meta.reportPeriodEnd ||
    !meta.fyStart ||
    !meta.fyEnd ||
    !meta.filingDate
  ) {
    throw new Error(
      `Missing required dates in LI quarterly XBRL for ${ctx.symbol}`,
    );
  }
  const { quarter, fiscalYear } = deriveFiscalPeriod(
    meta.reportPeriodEnd,
    meta.fyStart,
    meta.fyEnd,
    "quarterly",
  );

  const PNL = QUARTERLY_PNL_CONTEXT;
  const ratios = extractLiRatios(xml, PNL);

  // Derive reinsuranceCeded since SEBI doesn't expose it directly
  const grossPremium = extractNumber(xml, "GrossPremiumIncome", PNL);
  const netPremium =
    extractNumber(xml, "NetPremium", PNL) ??
    extractNumber(xml, "NetPremiumIncome", PNL);
  const derivedReinsuranceCeded =
    grossPremium !== null && netPremium !== null
      ? grossPremium - netPremium
      : null;

  // Tax: prefer ProvisionForTax; fall back to CurrentTax + DefferedTax (sic)
  const provisionForTax = extractNumber(xml, "ProvisionForTax", PNL);
  const currentTax = extractNumber(xml, "CurrentTax", PNL);
  const defferedTax = extractNumber(xml, "DefferedTax", PNL); // SEBI typo
  const tax =
    provisionForTax ??
    (currentTax !== null || defferedTax !== null
      ? (currentTax ?? 0) + (defferedTax ?? 0)
      : null);

  return {
    symbol: ctx.symbol,
    quarter,
    fiscalYear,
    reportDate: meta.reportPeriodEnd,
    filingDate: meta.filingDate,
    resultType:
      ctx.consolidated === "Consolidated" ? "consolidated" : "standalone",
    xbrlUrl: ctx.xbrl,

    grossPremiumIncome: grossPremium,
    netPremiumIncome:
      extractNumber(xml, "NetPremiumIncome", PNL) ??
      extractNumber(xml, "NetPremium", PNL),
    incomeFirstYearPremium: extractNumber(xml, "IncomeFirstYearPremium", PNL),
    incomeRenewalPremium: extractNumber(xml, "IncomeRenewalPremium", PNL),
    incomeSinglePremium: extractNumber(xml, "IncomeSinglePremium", PNL),
    reinsuranceCeded:
      extractNumber(xml, "ReinsuranceCeded", PNL) ??
      extractNumber(xml, "PremiumCededOnReinsurance", PNL) ??
      derivedReinsuranceCeded,
    incomeFromInvestments:
      extractNumber(xml, "IncomeFormInvestments", PNL) ?? // SEBI typo
      extractNumber(xml, "IncomeFromInvestmentsNet", PNL) ??
      extractNumber(xml, "InvestmentIncome", PNL) ??
      extractNumber(xml, "IncomeFromInvestments", PNL),
    totalRevenuePolicyholders:
      extractNumber(xml, "Income", PNL) ??
      extractNumber(xml, "TotalRevenuePolicyholders", PNL) ??
      extractNumber(xml, "TotalRevenue", PNL),

    totalCommission:
      extractNumber(xml, "Commission", PNL) ??
      extractNumber(xml, "TotalCommission", PNL),

    totalOperatingExpenses:
      extractNumber(xml, "OperatingExpensesRelatedToInsuranceBusiness", PNL) ??
      extractNumber(xml, "ExpensesOfManagement", PNL) ??
      extractNumber(
        xml,
        "TotalOperatingExpensesRelatedToInsuranceBusiness",
        PNL,
      ) ??
      extractNumber(xml, "TotalOperatingExpenses", PNL),

    benefitsPaidNet: extractNumber(xml, "BenefitsPaidNet", PNL),
    changeInValuationOfLiabilities:
      extractNumber(xml, "ChangeInActuarialLiability", PNL) ??
      extractNumber(xml, "ChangeInValuationOfLiabilities", PNL),

    profitBeforeTax:
      extractNumber(xml, "ProfitLossBeforeTax", PNL) ??
      extractNumber(xml, "ProfitBeforeTax", PNL),
    tax,
    netProfit:
      extractNumber(xml, "ProfitLossAfterTaxAndExtraordinaryItems", PNL) ??
      extractNumber(xml, "ProfitLossAfterTaxBeforeExtraordinaryItems", PNL) ??
      extractNumber(xml, "ProfitLossForPeriod", PNL) ??
      extractNumber(xml, "ProfitLossForThePeriod", PNL),

    ...ratios,
  };
}

export function parseLifeInsuranceAnnual(
  xml: string,
  ctx: ParseContext,
): ParsedLifeInsuranceAnnual {
  const meta = extractCommonMetadata(xml, "annual");
  if (
    !meta.reportPeriodEnd ||
    !meta.fyStart ||
    !meta.fyEnd ||
    !meta.filingDate
  ) {
    throw new Error(
      `Missing required dates in LI annual XBRL for ${ctx.symbol}`,
    );
  }
  const { fiscalYear } = deriveFiscalPeriod(
    meta.reportPeriodEnd,
    meta.fyStart,
    meta.fyEnd,
    "annual",
  );

  const PNL = ANNUAL_PNL_CONTEXT;
  const BS = BALANCE_SHEET_CONTEXT;
  const ratios = extractLiRatios(xml, PNL);

  // LI uses combined Basic+Diluted EPS, same pattern as GI
  const liCombinedEps =
    extractNumber(
      xml,
      "BasicAndDilutedEPSAfterExtraordinaryItemsNetOfTaxExpenseForThePeriodNotToBeAnnualized",
      PNL,
    ) ??
    extractNumber(
      xml,
      "BasicAndDilutedEPSBeforeExtraordinaryItemsNetOfTaxExpenseForThePeriodNotToBeAnnualized",
      PNL,
    );
  const liBasicEps =
    extractNumber(
      xml,
      "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
      PNL,
    ) ??
    extractNumber(xml, "BasicEarningsPerShareAfterExtraordinaryItems", PNL) ??
    extractNumber(xml, "BasicEarningsLossPerShare", PNL) ??
    liCombinedEps;
  const liDilutedEps =
    extractNumber(
      xml,
      "DilutedEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
      PNL,
    ) ??
    extractNumber(xml, "DilutedEarningsPerShareAfterExtraordinaryItems", PNL) ??
    extractNumber(xml, "DilutedEarningsLossPerShare", PNL) ??
    liCombinedEps;
  const liFaceValue =
    extractNumber(xml, "FaceValueOfEquityShareCapital", BS) ??
    extractNumber(xml, "FaceValueOfEquityShareCapital", PNL);
  const liPaidUp =
    extractNumber(xml, "PaidUpValueOfEquityShareCapital", BS) ??
    extractNumber(xml, "PaidUpEquityCapital", BS);

  // Reinsurance: derived from gross minus net (no direct tag in LI XBRL)
  const grossPremium = extractNumber(xml, "GrossPremiumIncome", PNL);
  const netPremium =
    extractNumber(xml, "NetPremium", PNL) ??
    extractNumber(xml, "NetPremiumIncome", PNL);
  const derivedReinsuranceCeded =
    grossPremium !== null && netPremium !== null
      ? grossPremium - netPremium
      : null;

  // Tax: ProvisionForTax preferred; fall back to CurrentTax + DefferedTax (SEBI sic)
  const provisionForTax =
    extractNumber(xml, "ProvisionForTax", PNL) ??
    extractNumber(xml, "ProvisionsForTaxes", PNL);
  const currentTax =
    extractNumber(xml, "CurrentTax", PNL) ??
    extractNumber(xml, "CurrentTaxes", PNL);
  const defferedTax =
    extractNumber(xml, "DefferedTax", PNL) ??
    extractNumber(xml, "DefferedTaxes", PNL);
  const tax =
    provisionForTax ??
    (currentTax !== null || defferedTax !== null
      ? (currentTax ?? 0) + (defferedTax ?? 0)
      : null);

  return {
    symbol: ctx.symbol,
    fiscalYear,
    reportDate: meta.reportPeriodEnd,
    filingDate: meta.filingDate,
    resultType:
      ctx.consolidated === "Consolidated" ? "consolidated" : "standalone",
    xbrlUrl: ctx.xbrl,

    // Revenue Account
    grossPremiumIncome: grossPremium,
    netPremiumIncome:
      extractNumber(xml, "NetPremiumIncome", PNL) ??
      extractNumber(xml, "NetPremium", PNL),
    incomeFirstYearPremium: extractNumber(xml, "IncomeFirstYearPremium", PNL),
    incomeRenewalPremium: extractNumber(xml, "IncomeRenewalPremium", PNL),
    incomeSinglePremium: extractNumber(xml, "IncomeSinglePremium", PNL),
    reinsuranceCeded:
      extractNumber(xml, "ReinsuranceCeded", PNL) ??
      extractNumber(xml, "PremiumCededOnReinsurance", PNL) ??
      derivedReinsuranceCeded,
    incomeFromInvestments:
      extractNumber(xml, "IncomeFromInvestmentsNet", PNL) ??
      extractNumber(xml, "IncomeFormInvestments", PNL) ?? // SEBI typo
      extractNumber(xml, "InvestmentIncome", PNL) ??
      extractNumber(xml, "IncomeFromInvestments", PNL),
    otherIncomePolicyholders:
      extractNumber(xml, "PolicyholdersAccountOtherIncome", PNL) ??
      extractNumber(xml, "OtherIncomePolicyholders", PNL),
    totalRevenuePolicyholders:
      extractNumber(xml, "Income", PNL) ??
      extractNumber(xml, "TotalRevenuePolicyholders", PNL) ??
      extractNumber(xml, "TotalRevenue", PNL),

    // Commission
    commissionFirstYearPremium: extractNumber(
      xml,
      "CommissionFirstYearPremium",
      PNL,
    ),
    commissionRenewalPremium: extractNumber(
      xml,
      "CommissionRenewalPremium",
      PNL,
    ),
    commissionSinglePremium: extractNumber(xml, "CommissionSinglePremium", PNL),
    totalCommission:
      extractNumber(xml, "Commission", PNL) ??
      extractNumber(xml, "NetCommission", PNL) ??
      extractNumber(xml, "TotalCommission", PNL),

    // Operating expenses
    employeesRemuneration:
      extractNumber(xml, "EmployeesRemunerationAndWelfareExpenses", PNL) ??
      extractNumber(xml, "EmployeesRemunerationAndWelfareBenefits", PNL),
    administrationExpenses: extractNumber(xml, "AdministrationExpenses", PNL),
    advertisementAndPublicity: extractNumber(
      xml,
      "AdvertisementAndPublicity",
      PNL,
    ),
    totalOperatingExpenses:
      extractNumber(xml, "OperatingExpensesRelatedToInsuranceBusiness", PNL) ??
      extractNumber(xml, "ExpensesOfManagement", PNL) ??
      extractNumber(
        xml,
        "TotalOperatingExpensesRelatedToInsuranceBusiness",
        PNL,
      ) ??
      extractNumber(xml, "TotalOperatingExpenses", PNL),

    // Benefits & reserves
    benefitsPaidNet: extractNumber(xml, "BenefitsPaidNet", PNL),
    changeInValuationOfLiabilities:
      extractNumber(xml, "ChangeInActuarialLiability", PNL) ??
      extractNumber(xml, "PolicyLiabilities", PNL) ??
      extractNumber(xml, "ChangeInValuationOfLiabilities", PNL),
    allocationOfBonusToPolicyholders: extractNumber(
      xml,
      "AllocationOfBonusToPolicyholders",
      PNL,
    ),

    // Surplus
    surplusFromRevenueAccount:
      extractNumber(xml, "SurplusShownInTheRevenueAccount", PNL) ??
      extractNumber(xml, "SurplusDeficit", PNL) ??
      extractNumber(xml, "NetSurplusDeficit", PNL) ??
      extractNumber(xml, "SurplusFromRevenueAccount", PNL),

    // P&L Shareholders
    transferFromPolicyholders:
      extractNumber(xml, "TransferFromPolicyholdersAccount", PNL) ??
      extractNumber(xml, "TransferredToShareholdersAccount", PNL),
    incomeFromInvestmentsShareholders:
      extractNumber(xml, "ShareholdersAccountIncome", PNL) ??
      extractNumber(xml, "IncomeUnderShareholdersAccount", PNL) ??
      extractNumber(xml, "IncomeFromInvestmentsShareholders", PNL),
    otherIncomeShareholders:
      extractNumber(xml, "ShareholdersAccountOtherIncome", PNL) ??
      extractNumber(xml, "OtherIncomeShareholders", PNL),
    shareholdersExpenses:
      extractNumber(xml, "ShareholdersAccountExpenses", PNL) ??
      extractNumber(
        xml,
        "ExpensesOtherThanThoseRelatedToInsuranceBusiness",
        PNL,
      ),
    profitBeforeTax:
      extractNumber(xml, "ProfitLossBeforeTax", PNL) ??
      extractNumber(xml, "ProfitBeforeTax", PNL),
    tax,
    netProfit:
      extractNumber(xml, "ProfitLossAfterTaxAndExtraordinaryItems", PNL) ??
      extractNumber(xml, "ProfitLossAfterTaxBeforeExtraordinaryItems", PNL) ??
      extractNumber(xml, "ProfitLossForPeriod", PNL) ??
      extractNumber(xml, "ProfitLossForThePeriod", PNL),

    // BS — Sources
    shareCapital: extractNumber(xml, "ShareCapital", BS),
    reservesAndSurplus:
      extractNumber(xml, "ReservesAndSurplus", BS) ??
      extractNumber(xml, "ReservesAndSurplusExcludingRevaluationReserve", BS),
    fairValueChangeAccount:
      extractNumber(
        xml,
        "FairValueChangeAccountAndRevaluationReserveShareholders",
        BS,
      ) ??
      extractNumber(xml, "CreditDebitFairValueChangeAccount", BS) ??
      extractNumber(xml, "FairValueChangeAccount", BS),
    borrowings: extractNumber(xml, "Borrowings", BS),
    policyholdersFunds: extractNumber(xml, "PolicyholdersFunds", BS),
    fundsForFutureAppropriations: extractNumber(
      xml,
      "FundsForFutureAppropriations",
      BS,
    ),
    totalSourcesOfFunds:
      extractNumber(xml, "SourcesOfFunds", BS) ??
      extractNumber(xml, "TotalSourcesOfFunds", BS),

    // BS — Application
    investmentsShareholders:
      extractNumber(xml, "InvestmentsShareholdersFund", BS) ??
      extractNumber(xml, "InvestmentsShareholders", BS),
    investmentsPolicyholders:
      extractNumber(
        xml,
        "InvestmentsPolicyholdersFundExcludingLinkedAssets",
        BS,
      ) ?? extractNumber(xml, "InvestmentsPolicyholders", BS),
    assetsHeldToCoverLinkedLiabilities: extractNumber(
      xml,
      "AssetsHeldToCoverLinkedLiabilities",
      BS,
    ),
    loansApplicationOfFunds:
      extractNumber(xml, "LoansApplicationOfFunds", BS) ??
      extractNumber(xml, "Loans", BS),
    fixedAssets: extractNumber(xml, "FixedAssets", BS),
    cashAndBankBalances: extractNumber(xml, "CashAndBankBalances", BS),
    advancesAndOtherAssets: extractNumber(xml, "AdvancesAndOtherAssets", BS),
    currentLiabilities:
      extractNumber(xml, "CurrentLiabilitiesAndProvisions", BS) ??
      extractNumber(xml, "CurrentLiabilities", BS),
    provisions: extractNumber(xml, "Provisions", BS),
    miscellaneousExpenditure:
      extractNumber(
        xml,
        "MiscellaneousExpenditureToTheExtentNotWrittenOffOrAdjusted",
        BS,
      ) ?? extractNumber(xml, "MiscellaneousExpenditure", BS),
    debitBalanceProfitAndLoss:
      extractNumber(
        xml,
        "DebitBalanceInProfitAndLossAccountShareholdersAccount",
        BS,
      ) ?? extractNumber(xml, "DebitBalanceProfitAndLossAccount", BS),
    totalApplicationOfFunds:
      extractNumber(xml, "ApplicationOfFunds", BS) ??
      extractNumber(xml, "TotalApplicationOfFunds", BS),
    totalAssets:
      extractNumber(xml, "Assets", BS) ??
      extractNumber(xml, "ApplicationOfFunds", BS) ??
      extractNumber(xml, "TotalApplicationOfFunds", BS),

    ...ratios,

    basicEps: liBasicEps,
    dilutedEps: liDilutedEps,
    faceValueShare: liFaceValue,
    paidUpEquityCapital: liPaidUp,
  };
}
