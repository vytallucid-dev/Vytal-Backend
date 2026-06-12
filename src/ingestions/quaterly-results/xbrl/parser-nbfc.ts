// File: src/ingestions/quaterly-results/xbrl/parser-nbfc.ts (NEW)

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
  sumNullableTags,
} from "./parser-common.js";
import type { ParseContext } from "./parser-indas.js";

export interface ParsedNbfcQuarterly {
  symbol: string;
  quarter: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: "standalone" | "consolidated";
  xbrlUrl: string;

  revenue: number | null;
  interestIncome: number | null;
  feeAndCommissionIncome: number | null;
  netGainOnFairValueChanges: number | null;
  otherIncome: number | null;
  totalIncome: number | null;
  financeCosts: number | null;
  impairmentOnFinancialInstruments: number | null;
  employeeBenefitExpense: number | null;
  depreciation: number | null;
  otherExpenses: number | null;
  totalExpenses: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;
}

export interface ParsedNbfcAnnual {
  symbol: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: "standalone" | "consolidated";
  xbrlUrl: string;

  // P&L
  revenue: number | null;
  interestIncome: number | null;
  feeAndCommissionIncome: number | null;
  netGainOnFairValueChanges: number | null;
  otherIncome: number | null;
  totalIncome: number | null;
  financeCosts: number | null;
  feeAndCommissionExpense: number | null;
  impairmentOnFinancialInstruments: number | null;
  employeeBenefitExpense: number | null;
  depreciation: number | null;
  otherExpenses: number | null;
  totalExpenses: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;

  // Equity
  equityShareCapital: number | null;
  otherEquity: number | null;
  totalEquity: number | null;

  // Financial Assets
  cashAndCashEquivalents: number | null;
  bankBalanceOther: number | null;
  loans: number | null; // = AUM
  investments: number | null;
  derivativeFinancialAssets: number | null;
  receivablesTrade: number | null;
  otherFinancialAssets: number | null;
  financialAssets: number | null;

  // Non-Financial Assets
  currentTaxAssetsNet: number | null;
  deferredTaxAssetsNet: number | null;
  propertyPlantAndEquipment: number | null;
  capitalWorkInProgress: number | null;
  intangibleAssetsUnderDevelopment: number | null;
  goodwill: number | null;
  otherIntangibleAssets: number | null;
  otherNonFinancialAssets: number | null;
  nonFinancialAssets: number | null;

  totalAssets: number | null;

  // Financial Liabilities
  derivativeFinancialLiabilities: number | null;
  payables: number | null;
  debtSecurities: number | null;
  borrowings: number | null;
  depositsLiabilities: number | null;
  subordinatedLiabilities: number | null;
  otherFinancialLiabilities: number | null;
  financialLiabilities: number | null;

  // Non-Financial Liabilities
  currentTaxLiabilitiesNet: number | null;
  provisions: number | null;
  deferredTaxLiabilitiesNet: number | null;
  otherNonFinancialLiabilities: number | null;
  nonFinancialLiabilities: number | null;

  totalLiabilities: number | null;

  // CFS
  cashFromOperating: number | null;
  cashFromInvesting: number | null;
  cashFromFinancing: number | null;
  netCashFlow: number | null;

  // Per Share
  basicEps: number | null;
  dilutedEps: number | null;
  faceValueShare: number | null;
  paidUpEquityCapital: number | null;
}

export function parseNbfcQuarterly(
  xml: string,
  ctx: ParseContext,
): ParsedNbfcQuarterly {
  const meta = extractCommonMetadata(xml, "quarterly");
  if (
    !meta.reportPeriodEnd ||
    !meta.fyStart ||
    !meta.fyEnd ||
    !meta.filingDate
  ) {
    throw new Error(
      `Missing required dates in NBFC quarterly XBRL for ${ctx.symbol}`,
    );
  }
  const { quarter, fiscalYear } = deriveFiscalPeriod(
    meta.reportPeriodEnd,
    meta.fyStart,
    meta.fyEnd,
    "quarterly",
  );

  const PNL = QUARTERLY_PNL_CONTEXT;

  return {
    symbol: ctx.symbol,
    quarter,
    fiscalYear,
    reportDate: meta.reportPeriodEnd,
    filingDate: meta.filingDate,
    resultType:
      ctx.consolidated === "Consolidated" ? "consolidated" : "standalone",
    xbrlUrl: ctx.xbrl,

    revenue: extractNumber(xml, "RevenueFromOperations", PNL),
    interestIncome:
      extractNumber(xml, "InterestEarned", PNL) ??
      extractNumber(xml, "InterestIncome", PNL),
    feeAndCommissionIncome:
      extractNumber(xml, "FeesAndCommissionIncome", PNL) ??
      extractNumber(xml, "FeeAndCommissionIncome", PNL),
    netGainOnFairValueChanges: extractNumber(
      xml,
      "NetGainOnFairValueChanges",
      PNL,
    ),
    otherIncome: extractNumber(xml, "OtherIncome", PNL),
    totalIncome:
      extractNumber(xml, "Income", PNL) ??
      extractNumber(xml, "TotalIncome", PNL),
    financeCosts: extractNumber(xml, "FinanceCosts", PNL),
    impairmentOnFinancialInstruments: extractNumber(
      xml,
      "ImpairmentOnFinancialInstruments",
      PNL,
    ),
    employeeBenefitExpense: extractNumber(xml, "EmployeeBenefitExpense", PNL),
    depreciation: extractNumber(
      xml,
      "DepreciationDepletionAndAmortisationExpense",
      PNL,
    ),
    otherExpenses: extractNumber(xml, "OtherExpenses", PNL),
    totalExpenses:
      extractNumber(xml, "Expenses", PNL) ??
      extractNumber(xml, "TotalExpenses", PNL),
    profitBeforeTax: extractNumber(xml, "ProfitBeforeTax", PNL),
    tax:
      extractNumber(xml, "TaxExpense", PNL) ??
      extractNumber(xml, "TotalTaxExpense", PNL),
    netProfit:
      extractNumber(xml, "ProfitLossForPeriod", PNL) ??
      extractNumber(xml, "ProfitLossForPeriodFromContinuingOperations", PNL),
  };
}

export function parseNbfcAnnual(
  xml: string,
  ctx: ParseContext,
): ParsedNbfcAnnual {
  const meta = extractCommonMetadata(xml, "annual");
  if (
    !meta.reportPeriodEnd ||
    !meta.fyStart ||
    !meta.fyEnd ||
    !meta.filingDate
  ) {
    throw new Error(
      `Missing required dates in NBFC annual XBRL for ${ctx.symbol}`,
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
  const ps = extractCommonPerShare(xml, PNL, BS);

  return {
    symbol: ctx.symbol,
    fiscalYear,
    reportDate: meta.reportPeriodEnd,
    filingDate: meta.filingDate,
    resultType:
      ctx.consolidated === "Consolidated" ? "consolidated" : "standalone",
    xbrlUrl: ctx.xbrl,

    // P&L
    revenue: extractNumber(xml, "RevenueFromOperations", PNL),
    interestIncome:
      extractNumber(xml, "InterestEarned", PNL) ??
      extractNumber(xml, "InterestIncome", PNL),
    feeAndCommissionIncome:
      extractNumber(xml, "FeesAndCommissionIncome", PNL) ??
      extractNumber(xml, "FeeAndCommissionIncome", PNL),
    netGainOnFairValueChanges: extractNumber(
      xml,
      "NetGainOnFairValueChanges",
      PNL,
    ),
    otherIncome: extractNumber(xml, "OtherIncome", PNL),
    totalIncome:
      extractNumber(xml, "Income", PNL) ??
      extractNumber(xml, "TotalIncome", PNL),
    financeCosts: extractNumber(xml, "FinanceCosts", PNL),
    // annual only
    feeAndCommissionExpense:
      extractNumber(xml, "FeesAndCommissionExpense", PNL) ??
      extractNumber(xml, "FeeAndCommissionExpense", PNL),
    impairmentOnFinancialInstruments: extractNumber(
      xml,
      "ImpairmentOnFinancialInstruments",
      PNL,
    ),
    employeeBenefitExpense: extractNumber(xml, "EmployeeBenefitExpense", PNL),
    depreciation: extractNumber(
      xml,
      "DepreciationDepletionAndAmortisationExpense",
      PNL,
    ),
    otherExpenses: extractNumber(xml, "OtherExpenses", PNL),
    totalExpenses:
      extractNumber(xml, "Expenses", PNL) ??
      extractNumber(xml, "TotalExpenses", PNL),
    profitBeforeTax: extractNumber(xml, "ProfitBeforeTax", PNL),
    tax:
      extractNumber(xml, "TaxExpense", PNL) ??
      extractNumber(xml, "TotalTaxExpense", PNL) ??
      extractNumber(xml, "Tax", PNL),
    netProfit:
      extractNumber(xml, "ProfitLossForPeriod", PNL) ??
      extractNumber(xml, "ProfitLossForPeriodFromContinuingOperations", PNL),

    // Equity
    equityShareCapital: extractNumber(xml, "EquityShareCapital", BS),
    otherEquity: extractNumber(xml, "OtherEquity", BS),
    totalEquity: extractNumber(xml, "Equity", BS),

    // Financial Assets
    cashAndCashEquivalents: extractNumber(xml, "CashAndCashEquivalents", BS),
    bankBalanceOther: extractNumber(
      xml,
      "BankBalanceOtherThanCashAndCashEquivalents",
      BS,
    ),
    loans: extractNumber(xml, "Loans", BS),
    investments: extractNumber(xml, "Investments", BS),
    derivativeFinancialAssets: extractNumber(
      xml,
      "DerivativeFinancialInstrumentsFinancialAssets",
      BS,
    ),
    receivablesTrade:
      extractNumber(xml, "TradeReceivables", BS) ??
      extractNumber(xml, "ReceivablesTrade", BS),
    otherFinancialAssets: extractNumber(xml, "OtherFinancialAssets", BS),
    financialAssets:
      extractNumber(xml, "FinanicalAssets", BS) ?? // SEBI taxonomy typo (sic)
      extractNumber(xml, "FinancialAssets", BS),

    // Non-Financial Assets
    currentTaxAssetsNet: extractNumber(xml, "CurrentTaxAssetsNet", BS),
    deferredTaxAssetsNet: extractNumber(xml, "DeferredTaxAssetsNet", BS),
    propertyPlantAndEquipment: extractNumber(
      xml,
      "PropertyPlantAndEquipment",
      BS,
    ),
    capitalWorkInProgress: extractNumber(xml, "CapitalWorkInProgress", BS),
    intangibleAssetsUnderDevelopment: extractNumber(
      xml,
      "IntangibleAssetsUnderDevelopment",
      BS,
    ),
    goodwill: extractNumber(xml, "Goodwill", BS),
    otherIntangibleAssets: extractNumber(xml, "OtherIntangibleAssets", BS),
    otherNonFinancialAssets: extractNumber(xml, "OtherNonFinancialAssets", BS),
    nonFinancialAssets: extractNumber(xml, "NonFinancialAssets", BS),

    totalAssets: extractNumber(xml, "Assets", BS),

    // Financial Liabilities
    derivativeFinancialLiabilities: extractNumber(
      xml,
      "DerivativeFinancialInstrumentsFinancialLiabilities",
      BS,
    ),
    payables:
      // NBFCs split payables into MSME and Others (Schedule III). Sum them.
      sumNullableTags(
        xml,
        [
          "TotalOutstandingDuesOfMicroEnterpriseAndSmallEnterpriseOtherPayables",
          "TotalOutstandingDuesOfCreditorsOtherThanMicroEnterpriseAndSmallEnterpriseOtherPayables",
        ],
        BS,
      ) ?? extractNumber(xml, "Payables", BS),
    debtSecurities: extractNumber(xml, "DebtSecurities", BS),
    borrowings:
      extractNumber(xml, "BorrowingsOtherThanDebtSecurities", BS) ??
      extractNumber(xml, "Borrowings", BS),
    depositsLiabilities:
      extractNumber(xml, "DepositsLiabilities", BS) ??
      extractNumber(xml, "Deposits", BS),
    subordinatedLiabilities: extractNumber(xml, "SubordinatedLiabilities", BS),
    otherFinancialLiabilities: extractNumber(
      xml,
      "OtherFinancialLiabilities",
      BS,
    ),
    financialLiabilities: extractNumber(xml, "FinancialLiabilities", BS),

    // Non-Financial Liabilities
    currentTaxLiabilitiesNet:
      extractNumber(xml, "CurrentTaxLiabilities", BS) ??
      extractNumber(xml, "CurrentTaxLiabilitiesNet", BS),
    provisions: extractNumber(xml, "Provisions", BS),
    deferredTaxLiabilitiesNet: extractNumber(
      xml,
      "DeferredTaxLiabilitiesNet",
      BS,
    ),
    otherNonFinancialLiabilities: extractNumber(
      xml,
      "OtherNonFinancialLiabilities",
      BS,
    ),
    nonFinancialLiabilities: extractNumber(xml, "NonFinancialLiabilities", BS),

    totalLiabilities: extractNumber(xml, "Liabilities", BS),

    // CFS
    cashFromOperating: extractNumber(
      xml,
      "CashFlowsFromUsedInOperatingActivities",
      PNL,
    ),
    cashFromInvesting: extractNumber(
      xml,
      "CashFlowsFromUsedInInvestingActivities",
      PNL,
    ),
    cashFromFinancing: extractNumber(
      xml,
      "CashFlowsFromUsedInFinancingActivities",
      PNL,
    ),
    netCashFlow: extractNumber(
      xml,
      "IncreaseDecreaseInCashAndCashEquivalents",
      PNL,
    ),

    ...ps,
  };
}
