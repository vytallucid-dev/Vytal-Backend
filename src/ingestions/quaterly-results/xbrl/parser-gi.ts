// File: src/ingestions/quaterly-results/xbrl/parser-gi.ts (NEW)

import {
  ANNUAL_PNL_CONTEXT,
  BALANCE_SHEET_CONTEXT,
  QUARTERLY_PNL_CONTEXT,
} from "./contexts.js";
import { extractNumber } from "./extract.js";
import { deriveFiscalPeriod, extractCommonMetadata } from "./parser-common.js";
import type { ParseContext } from "./parser-indas.js";

export interface ParsedGeneralInsuranceQuarterly {
  symbol: string;
  quarter: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: "standalone" | "consolidated";
  xbrlUrl: string;

  grossPremiumsWritten: number | null;
  netPremiumWritten: number | null;
  netPremium: number | null;
  premiumEarned: number | null;
  incomeFromInvestments: number | null;
  otherIncome: number | null;
  totalRevenue: number | null;
  claimsPaid: number | null;
  incurredClaims: number | null;
  netCommission: number | null;
  totalOperatingExpensesRelatedToInsurance: number | null;
  underwritingProfitOrLoss: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;

  combinedRatio: number | null;
  incurredClaimRatio: number | null;
  expensesOfManagementRatio: number | null;
  netRetentionRatio: number | null;
  solvencyRatio: number | null;
}

export interface ParsedGeneralInsuranceAnnual {
  symbol: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: "standalone" | "consolidated";
  xbrlUrl: string;

  // Revenue Account
  grossPremiumsWritten: number | null;
  netPremiumWritten: number | null;
  netPremium: number | null;
  premiumEarned: number | null;
  reinsuranceCeded: number | null;
  reinsuranceAccepted: number | null;
  changeInUnexpiredRiskReserve: number | null;

  // Investment income
  incomeFromInvestments: number | null;
  otherIncome: number | null;
  totalRevenue: number | null;

  // Claims
  claimsPaid: number | null;
  changeInOutstandingClaims: number | null;
  incurredClaims: number | null;
  reinsuranceRecoveriesOnClaims: number | null;

  // Commission
  commissionPaid: number | null;
  commissionReceivedFromReinsurance: number | null;
  netCommission: number | null;

  // Operating expenses
  employeesRemuneration: number | null;
  rentRatesAndTaxes: number | null;
  legalAndProfessionalCharges: number | null;
  advertisementAndPublicity: number | null;
  totalOperatingExpensesRelatedToInsurance: number | null;

  // Underwriting result
  premiumDeficiency: number | null;
  underwritingProfitOrLoss: number | null;

  // P&L Shareholders
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;

  // BS
  shareCapital: number | null;
  reservesAndSurplus: number | null;
  fairValueChangeAccount: number | null;
  borrowings: number | null;
  totalSourcesOfFunds: number | null;

  investments: number | null;
  loansApplicationOfFunds: number | null;
  fixedAssets: number | null;
  cashAndBankBalances: number | null;
  advancesAndOtherAssets: number | null;
  currentLiabilities: number | null;
  provisions: number | null;
  totalApplicationOfFunds: number | null;
  totalAssets: number | null;

  // Ratios
  combinedRatio: number | null;
  incurredClaimRatio: number | null;
  expensesOfManagementRatio: number | null;
  netRetentionRatio: number | null;
  solvencyRatio: number | null;

  // Per Share
  basicEps: number | null;
  dilutedEps: number | null;
  faceValueShare: number | null;
  paidUpEquityCapital: number | null;
}

function extractGiRatios(xml: string, ctx: string) {
  return {
    combinedRatio: extractNumber(xml, "CombinedRatio", ctx),
    incurredClaimRatio:
      extractNumber(xml, "IncurredClaimRatio", ctx) ??
      extractNumber(xml, "ClaimsRatio", ctx),
    expensesOfManagementRatio: extractNumber(
      xml,
      "ExpensesOfManagementRatio",
      ctx,
    ),
    netRetentionRatio: extractNumber(xml, "NetRetentionRatio", ctx),
    solvencyRatio:
      extractNumber(xml, "SolvencyRatio", ctx) ??
      extractNumber(xml, "SolvencyMargin", ctx),
  };
}

export function parseGeneralInsuranceQuarterly(
  xml: string,
  ctx: ParseContext,
): ParsedGeneralInsuranceQuarterly {
  const meta = extractCommonMetadata(xml, "quarterly");
  if (
    !meta.reportPeriodEnd ||
    !meta.fyStart ||
    !meta.fyEnd ||
    !meta.filingDate
  ) {
    throw new Error(
      `Missing required dates in GI quarterly XBRL for ${ctx.symbol}`,
    );
  }
  const { quarter, fiscalYear } = deriveFiscalPeriod(
    meta.reportPeriodEnd,
    meta.fyStart,
    meta.fyEnd,
    "quarterly",
  );

  const PNL = QUARTERLY_PNL_CONTEXT;
  const ratios = extractGiRatios(xml, PNL);

  return {
    symbol: ctx.symbol,
    quarter,
    fiscalYear,
    reportDate: meta.reportPeriodEnd,
    filingDate: meta.filingDate,
    resultType:
      ctx.consolidated === "Consolidated" ? "consolidated" : "standalone",
    xbrlUrl: ctx.xbrl,

    grossPremiumsWritten:
      extractNumber(xml, "GrossPremiumsWritten", PNL) ??
      extractNumber(xml, "GrossWrittenPremium", PNL),
    netPremiumWritten: extractNumber(xml, "NetPremiumWritten", PNL),
    netPremium:
      extractNumber(xml, "NetPremiumWritten", PNL) ?? // segment-only in plain ctx; use NPW
      extractNumber(xml, "NetPremium", PNL),
    premiumEarned:
      extractNumber(xml, "PremiumEarnedNet", PNL) ??
      extractNumber(xml, "PremiumEarned", PNL),

    incomeFromInvestments:
      extractNumber(xml, "IncomeFromInvestmentsNet", PNL) ??
      extractNumber(xml, "IncomeFormInvestments", PNL) ?? // SEBI typo, segment-only
      extractNumber(xml, "InvestmentIncome", PNL) ??
      extractNumber(xml, "IncomeFromInvestments", PNL),
    otherIncome: extractNumber(xml, "OtherIncome", PNL),
    totalRevenue:
      extractNumber(xml, "OperatingIncome", PNL) ??
      extractNumber(xml, "TotalRevenue", PNL),

    claimsPaid: extractNumber(xml, "ClaimsPaid", PNL),
    incurredClaims:
      extractNumber(xml, "ClaimsIncurredNet", PNL) ??
      extractNumber(xml, "IncurredClaims", PNL),
    netCommission:
      extractNumber(xml, "NetCommission", PNL) ??
      extractNumber(xml, "Commission", PNL),
    totalOperatingExpensesRelatedToInsurance:
      extractNumber(xml, "OperatingExpensesRelatedToInsuranceBusiness", PNL) ??
      extractNumber(
        xml,
        "TotalOperatingExpensesRelatedToInsuranceBusiness",
        PNL,
      ),

    underwritingProfitOrLoss:
      extractNumber(xml, "UnderwritingProfitOrLoss", PNL) ??
      extractNumber(xml, "OperatingProfitOrLoss", PNL),

    profitBeforeTax:
      extractNumber(xml, "ProfitOrLossBeforeTax", PNL) ??
      extractNumber(xml, "ProfitOrLossBeforeExtraordinaryItems", PNL) ??
      extractNumber(xml, "ProfitBeforeTax", PNL),
    tax:
      extractNumber(xml, "ProvisionForTax", PNL) ??
      extractNumber(xml, "TaxExpense", PNL) ??
      extractNumber(xml, "TotalTaxExpense", PNL),
    netProfit:
      extractNumber(xml, "ProfitLossAfterTax", PNL) ??
      extractNumber(xml, "ProfitLossForPeriod", PNL) ??
      extractNumber(xml, "ProfitLossForThePeriod", PNL),

    ...ratios,
  };
}

export function parseGeneralInsuranceAnnual(
  xml: string,
  ctx: ParseContext,
): ParsedGeneralInsuranceAnnual {
  const meta = extractCommonMetadata(xml, "annual");
  if (
    !meta.reportPeriodEnd ||
    !meta.fyStart ||
    !meta.fyEnd ||
    !meta.filingDate
  ) {
    throw new Error(
      `Missing required dates in GI annual XBRL for ${ctx.symbol}`,
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
  const ratios = extractGiRatios(xml, PNL);

  // GI uses a combined Basic+Diluted EPS tag, not separate Basic/Diluted tags.
  // Try the GI-specific combined tag first; fall back to the standard separate
  // tags in case some insurer files them differently.
  const giCombinedEps =
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
  const giBasicEps =
    extractNumber(
      xml,
      "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
      PNL,
    ) ??
    extractNumber(xml, "BasicEarningsPerShareAfterExtraordinaryItems", PNL) ??
    extractNumber(xml, "BasicEarningsLossPerShare", PNL) ??
    giCombinedEps;
  const giDilutedEps =
    extractNumber(
      xml,
      "DilutedEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
      PNL,
    ) ??
    extractNumber(xml, "DilutedEarningsPerShareAfterExtraordinaryItems", PNL) ??
    extractNumber(xml, "DilutedEarningsLossPerShare", PNL) ??
    giCombinedEps;
  const giFaceValue =
    extractNumber(xml, "FaceValueOfEquityShareCapital", BS) ??
    extractNumber(xml, "FaceValueOfEquityShareCapital", PNL);
  const giPaidUp =
    extractNumber(xml, "PaidUpEquityCapital", BS) ??
    extractNumber(xml, "PaidUpValueOfEquityShareCapital", BS) ??
    extractNumber(xml, "PaidUpEquityCapital", PNL) ??
    extractNumber(xml, "PaidUpValueOfEquityShareCapital", PNL);

  return {
    symbol: ctx.symbol,
    fiscalYear,
    reportDate: meta.reportPeriodEnd,
    filingDate: meta.filingDate,
    resultType:
      ctx.consolidated === "Consolidated" ? "consolidated" : "standalone",
    xbrlUrl: ctx.xbrl,

    // Revenue Account
    grossPremiumsWritten:
      extractNumber(xml, "GrossPremiumsWritten", PNL) ??
      extractNumber(xml, "GrossWrittenPremium", PNL),
    netPremiumWritten: extractNumber(xml, "NetPremiumWritten", PNL),
    netPremium:
      extractNumber(xml, "NetPremiumWritten", PNL) ?? // segment-only in plain ctx; use NPW
      extractNumber(xml, "NetPremium", PNL),
    premiumEarned:
      extractNumber(xml, "PremiumEarnedNet", PNL) ??
      extractNumber(xml, "PremiumEarned", PNL),
    reinsuranceCeded:
      extractNumber(xml, "PremiumCededOnReinsurance", PNL) ??
      extractNumber(xml, "ReinsuranceCeded", PNL),
    reinsuranceAccepted: extractNumber(xml, "ReinsuranceAccepted", PNL),
    changeInUnexpiredRiskReserve: extractNumber(
      xml,
      "ChangeInUnexpiredRiskReserve",
      PNL,
    ),

    // Investment income
    incomeFromInvestments:
      extractNumber(xml, "IncomeFromInvestmentsNet", PNL) ??
      extractNumber(xml, "IncomeFormInvestments", PNL) ?? // SEBI typo, often segment-only
      extractNumber(xml, "InvestmentIncome", PNL) ??
      extractNumber(xml, "IncomeFromInvestments", PNL),
    otherIncome: extractNumber(xml, "OtherIncome", PNL),
    totalRevenue:
      extractNumber(xml, "OperatingIncome", PNL) ??
      extractNumber(xml, "TotalRevenue", PNL),

    // Claims
    claimsPaid: extractNumber(xml, "ClaimsPaid", PNL),
    changeInOutstandingClaims: extractNumber(
      xml,
      "ChangeInOutstandingClaims",
      PNL,
    ),
    incurredClaims:
      extractNumber(xml, "ClaimsIncurredNet", PNL) ??
      extractNumber(xml, "IncurredClaims", PNL),
    reinsuranceRecoveriesOnClaims: extractNumber(
      xml,
      "ReinsuranceRecoveriesOnClaims",
      PNL,
    ),

    // Commission
    commissionPaid: extractNumber(xml, "CommissionPaid", PNL),
    commissionReceivedFromReinsurance: extractNumber(
      xml,
      "CommissionReceivedFromReinsurance",
      PNL,
    ),
    netCommission:
      extractNumber(xml, "NetCommission", PNL) ??
      extractNumber(xml, "Commission", PNL),

    // Operating expenses
    employeesRemuneration:
      extractNumber(xml, "EmployeesRemunerationAndWelfareExpenses", PNL) ??
      extractNumber(xml, "EmployeesRemunerationAndWelfareBenefits", PNL),
    rentRatesAndTaxes: extractNumber(xml, "RentRatesAndTaxes", PNL),
    legalAndProfessionalCharges: extractNumber(
      xml,
      "LegalAndProfessionalCharges",
      PNL,
    ),
    advertisementAndPublicity: extractNumber(
      xml,
      "AdvertisementAndPublicity",
      PNL,
    ),
    totalOperatingExpensesRelatedToInsurance:
      extractNumber(xml, "OperatingExpensesRelatedToInsuranceBusiness", PNL) ??
      extractNumber(
        xml,
        "TotalOperatingExpensesRelatedToInsuranceBusiness",
        PNL,
      ),

    // Underwriting result
    premiumDeficiency: extractNumber(xml, "PremiumDeficiency", PNL),
    underwritingProfitOrLoss:
      extractNumber(xml, "UnderwritingProfitOrLoss", PNL) ??
      extractNumber(xml, "OperatingProfitOrLoss", PNL),

    // P&L (Shareholders)
    profitBeforeTax:
      extractNumber(xml, "ProfitOrLossBeforeTax", PNL) ??
      extractNumber(xml, "ProfitOrLossBeforeExtraordinaryItems", PNL) ??
      extractNumber(xml, "ProfitBeforeTax", PNL),
    tax:
      extractNumber(xml, "ProvisionForTax", PNL) ??
      extractNumber(xml, "TaxExpense", PNL) ??
      extractNumber(xml, "TotalTaxExpense", PNL),
    netProfit:
      extractNumber(xml, "ProfitLossAfterTax", PNL) ??
      extractNumber(xml, "ProfitLossForPeriod", PNL) ??
      extractNumber(xml, "ProfitLossForThePeriod", PNL),

    // BS
    shareCapital: extractNumber(xml, "ShareCapital", BS),
    reservesAndSurplus: extractNumber(xml, "ReservesAndSurplus", BS),
    fairValueChangeAccount:
      extractNumber(xml, "FairValueChangeAccountAndRevaluationReserve", BS) ??
      extractNumber(xml, "FairValueChangeAccount", BS),
    borrowings: extractNumber(xml, "Borrowings", BS),
    totalSourcesOfFunds:
      extractNumber(xml, "TotalSourcesOfFunds", BS) ??
      extractNumber(xml, "SourcesOfFunds", BS),

    investments: extractNumber(xml, "Investments", BS),
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
    totalApplicationOfFunds:
      extractNumber(xml, "TotalApplicationOfFunds", BS) ??
      extractNumber(xml, "ApplicationOfFunds", BS),
    totalAssets:
      extractNumber(xml, "Assets", BS) ??
      extractNumber(xml, "TotalApplicationOfFunds", BS) ??
      extractNumber(xml, "ApplicationOfFunds", BS),

    basicEps: giBasicEps,
    dilutedEps: giDilutedEps,
    faceValueShare: giFaceValue,
    paidUpEquityCapital: giPaidUp,

    ...ratios,
  };
}
