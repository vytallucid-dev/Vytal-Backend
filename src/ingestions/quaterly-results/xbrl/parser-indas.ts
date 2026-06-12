// File: src/ingestions/quaterly-results/xbrl/parser-indas.ts (NEW)

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

export interface ParsedIndAsQuarterly {
  symbol: string;
  quarter: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: "standalone" | "consolidated";
  xbrlUrl: string;

  revenue: number | null;
  otherIncome: number | null;
  expenses: number | null;
  depreciation: number | null;
  interest: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;
  operatingProfit: number | null;
}

export interface ParsedIndAsAnnual {
  symbol: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: "standalone" | "consolidated";
  xbrlUrl: string;

  // P&L
  revenue: number | null;
  otherIncome: number | null;
  expenses: number | null;
  employeeBenefitExpense: number | null;
  financeCosts: number | null;
  depreciation: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;

  // BS — Equity
  equityShareCapital: number | null;
  otherEquity: number | null;
  totalEquity: number | null;
  equityAttributableToOwners: number | null;

  // BS — Liabilities
  borrowingsCurrent: number | null;
  borrowingsNoncurrent: number | null;
  tradePayablesCurrent: number | null;
  tradePayablesNoncurrent: number | null;
  otherCurrentLiabilities: number | null;
  otherNoncurrentLiabilities: number | null;
  otherCurrentFinancialLiabilities: number | null;
  otherNoncurrentFinancialLiabilities: number | null;
  provisionsCurrent: number | null;
  provisionsNoncurrent: number | null;
  currentTaxLiabilities: number | null;
  deferredTaxLiabilitiesNet: number | null;
  currentLiabilities: number | null;
  noncurrentLiabilities: number | null;

  // BS — Non-current Assets
  propertyPlantAndEquipment: number | null;
  capitalWorkInProgress: number | null;
  goodwill: number | null;
  otherIntangibleAssets: number | null;
  intangibleAssetsUnderDevelopment: number | null;
  noncurrentInvestments: number | null;
  loansNoncurrent: number | null;
  otherNoncurrentFinancialAssets: number | null;
  otherNoncurrentAssets: number | null;
  deferredTaxAssetsNet: number | null;
  investmentProperty: number | null;
  investmentsEquityMethod: number | null;
  noncurrentAssets: number | null;

  // BS — Current Assets
  inventories: number | null;
  currentInvestments: number | null;
  tradeReceivablesCurrent: number | null;
  tradeReceivablesNoncurrent: number | null;
  cashAndCashEquivalents: number | null;
  bankBalanceOther: number | null;
  loansCurrent: number | null;
  otherCurrentFinancialAssets: number | null;
  otherCurrentAssets: number | null;
  currentTaxAssets: number | null;
  noncurrentAssetsHeldForSale: number | null;
  currentAssets: number | null;

  totalAssets: number | null;

  // Cash Flow
  cashFromOperating: number | null;
  cashFromInvesting: number | null;
  cashFromFinancing: number | null;
  netCashFlow: number | null;
  capex: number | null;
  proceedsFromBorrowings: number | null;
  repaymentsOfBorrowings: number | null;
  dividendsPaid: number | null;
  interestPaid: number | null;

  // Per Share
  basicEps: number | null;
  dilutedEps: number | null;
  faceValueShare: number | null;
  paidUpEquityCapital: number | null;
}

export interface ParseContext {
  symbol: string;
  xbrl: string;
  consolidated: "Standalone" | "Consolidated" | null;
}

export function parseIndAsQuarterly(
  xml: string,
  ctx: ParseContext,
): ParsedIndAsQuarterly {
  const meta = extractCommonMetadata(xml, "quarterly");
  if (
    !meta.reportPeriodEnd ||
    !meta.fyStart ||
    !meta.fyEnd ||
    !meta.filingDate
  ) {
    throw new Error(
      `Missing required dates in Ind-AS quarterly XBRL for ${ctx.symbol}`,
    );
  }
  const { quarter, fiscalYear } = deriveFiscalPeriod(
    meta.reportPeriodEnd,
    meta.fyStart,
    meta.fyEnd,
    "quarterly",
  );

  const PNL = QUARTERLY_PNL_CONTEXT;

  const revenue = extractNumber(xml, "RevenueFromOperations", PNL);
  const otherIncome = extractNumber(xml, "OtherIncome", PNL);
  const totalExpenses =
    extractNumber(xml, "Expenses", PNL) ??
    extractNumber(xml, "TotalExpenses", PNL);
  const depreciation =
    extractNumber(xml, "DepreciationDepletionAndAmortisationExpense", PNL) ??
    extractNumber(xml, "Depreciation", PNL);
  const interest = extractNumber(xml, "FinanceCosts", PNL);
  const pbt = extractNumber(xml, "ProfitBeforeTax", PNL);
  const tax =
    extractNumber(xml, "IncomeTaxExpenseContinuingOperations", PNL) ??
    extractNumber(xml, "TotalIncomeTaxExpense", PNL) ??
    extractNumber(xml, "IncomeTaxExpense", PNL) ??
    extractNumber(xml, "TaxExpense", PNL) ??
    extractNumber(xml, "TotalTaxExpense", PNL) ??
    extractNumber(xml, "Tax", PNL);
  const np =
    extractNumber(xml, "ProfitLossForPeriod", PNL) ??
    extractNumber(xml, "ProfitLossForPeriodFromContinuingOperations", PNL);

  // Operating profit: PBT + finance costs - other income (exclude non-op items)
  const operatingProfit =
    pbt !== null && interest !== null
      ? pbt + interest - (otherIncome ?? 0)
      : null;

  return {
    symbol: ctx.symbol,
    quarter,
    fiscalYear,
    reportDate: meta.reportPeriodEnd,
    filingDate: meta.filingDate,
    resultType:
      ctx.consolidated === "Consolidated" ? "consolidated" : "standalone",
    xbrlUrl: ctx.xbrl,
    revenue,
    otherIncome,
    expenses: totalExpenses,
    depreciation,
    interest,
    profitBeforeTax: pbt,
    tax,
    netProfit: np,
    operatingProfit,
  };
}

export function parseIndAsAnnual(
  xml: string,
  ctx: ParseContext,
): ParsedIndAsAnnual {
  const meta = extractCommonMetadata(xml, "annual");
  if (
    !meta.reportPeriodEnd ||
    !meta.fyStart ||
    !meta.fyEnd ||
    !meta.filingDate
  ) {
    throw new Error(
      `Missing required dates in Ind-AS annual XBRL for ${ctx.symbol}`,
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

  const totalCapex =
    extractNumber(
      xml,
      "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
      PNL,
    ) ?? null;

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
    otherIncome: extractNumber(xml, "OtherIncome", PNL),
    expenses:
      extractNumber(xml, "Expenses", PNL) ??
      extractNumber(xml, "TotalExpenses", PNL),
    employeeBenefitExpense: extractNumber(xml, "EmployeeBenefitExpense", PNL),
    financeCosts: extractNumber(xml, "FinanceCosts", PNL),
    depreciation: extractNumber(
      xml,
      "DepreciationDepletionAndAmortisationExpense",
      PNL,
    ),
    profitBeforeTax: extractNumber(xml, "ProfitBeforeTax", PNL),
    tax:
      extractNumber(xml, "IncomeTaxExpenseContinuingOperations", PNL) ??
      extractNumber(xml, "TotalIncomeTaxExpense", PNL) ??
      extractNumber(xml, "IncomeTaxExpense", PNL) ??
      extractNumber(xml, "TaxExpense", PNL) ??
      extractNumber(xml, "TotalTaxExpense", PNL) ??
      extractNumber(xml, "Tax", PNL),
    netProfit:
      extractNumber(xml, "ProfitLossForPeriod", PNL) ??
      extractNumber(xml, "ProfitLossForPeriodFromContinuingOperations", PNL),

    // BS — Equity
    equityShareCapital: extractNumber(xml, "EquityShareCapital", BS),
    otherEquity: extractNumber(xml, "OtherEquity", BS),
    totalEquity: extractNumber(xml, "Equity", BS),
    equityAttributableToOwners: extractNumber(
      xml,
      "EquityAttributableToOwnersOfParent",
      BS,
    ),

    // BS — Liabilities
    borrowingsCurrent: extractNumber(xml, "BorrowingsCurrent", BS),
    borrowingsNoncurrent: extractNumber(xml, "BorrowingsNoncurrent", BS),
    tradePayablesCurrent: extractNumber(xml, "TradePayablesCurrent", BS),
    tradePayablesNoncurrent: extractNumber(xml, "TradePayablesNoncurrent", BS),
    otherCurrentLiabilities: extractNumber(xml, "OtherCurrentLiabilities", BS),
    otherNoncurrentLiabilities: extractNumber(
      xml,
      "OtherNoncurrentLiabilities",
      BS,
    ),
    otherCurrentFinancialLiabilities: extractNumber(
      xml,
      "OtherCurrentFinancialLiabilities",
      BS,
    ),
    otherNoncurrentFinancialLiabilities: extractNumber(
      xml,
      "OtherNoncurrentFinancialLiabilities",
      BS,
    ),
    provisionsCurrent: extractNumber(xml, "ProvisionsCurrent", BS),
    provisionsNoncurrent: extractNumber(xml, "ProvisionsNoncurrent", BS),
    currentTaxLiabilities: extractNumber(xml, "CurrentTaxLiabilities", BS),
    deferredTaxLiabilitiesNet: extractNumber(
      xml,
      "DeferredTaxLiabilitiesNet",
      BS,
    ),
    currentLiabilities: extractNumber(xml, "CurrentLiabilities", BS),
    noncurrentLiabilities: extractNumber(xml, "NoncurrentLiabilities", BS),

    // BS — Non-current Assets
    propertyPlantAndEquipment: extractNumber(
      xml,
      "PropertyPlantAndEquipment",
      BS,
    ),
    capitalWorkInProgress: extractNumber(xml, "CapitalWorkInProgress", BS),
    goodwill: extractNumber(xml, "Goodwill", BS),
    otherIntangibleAssets: extractNumber(xml, "OtherIntangibleAssets", BS),
    intangibleAssetsUnderDevelopment: extractNumber(
      xml,
      "IntangibleAssetsUnderDevelopment",
      BS,
    ),
    noncurrentInvestments: extractNumber(xml, "NoncurrentInvestments", BS),
    loansNoncurrent: extractNumber(xml, "LoansNoncurrent", BS),
    otherNoncurrentFinancialAssets: extractNumber(
      xml,
      "OtherNoncurrentFinancialAssets",
      BS,
    ),
    otherNoncurrentAssets: extractNumber(xml, "OtherNoncurrentAssets", BS),
    deferredTaxAssetsNet: extractNumber(xml, "DeferredTaxAssetsNet", BS),
    investmentProperty: extractNumber(xml, "InvestmentProperty", BS),
    investmentsEquityMethod: extractNumber(
      xml,
      "InvestmentsAccountedForUsingEquityMethod",
      BS,
    ),
    noncurrentAssets: extractNumber(xml, "NoncurrentAssets", BS),

    // BS — Current Assets
    inventories: extractNumber(xml, "Inventories", BS),
    currentInvestments: extractNumber(xml, "CurrentInvestments", BS),
    tradeReceivablesCurrent: extractNumber(xml, "TradeReceivablesCurrent", BS),
    tradeReceivablesNoncurrent: extractNumber(
      xml,
      "TradeReceivablesNoncurrent",
      BS,
    ),
    cashAndCashEquivalents: extractNumber(xml, "CashAndCashEquivalents", BS),
    bankBalanceOther: extractNumber(
      xml,
      "BankBalanceOtherThanCashAndCashEquivalents",
      BS,
    ),
    loansCurrent: extractNumber(xml, "LoansCurrent", BS),
    otherCurrentFinancialAssets: extractNumber(
      xml,
      "OtherCurrentFinancialAssets",
      BS,
    ),
    otherCurrentAssets: extractNumber(xml, "OtherCurrentAssets", BS),
    currentTaxAssets: extractNumber(xml, "CurrentTaxAssets", BS),
    noncurrentAssetsHeldForSale: extractNumber(
      xml,
      "NoncurrentAssetsClassifiedAsHeldForSale",
      BS,
    ),
    currentAssets: extractNumber(xml, "CurrentAssets", BS),

    totalAssets: extractNumber(xml, "Assets", BS),

    // Cash Flow
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
    capex: totalCapex,
    proceedsFromBorrowings: extractNumber(
      xml,
      "ProceedsFromBorrowingsClassifiedAsFinancingActivities",
      PNL,
    ),
    repaymentsOfBorrowings: extractNumber(
      xml,
      "RepaymentsOfBorrowingsClassifiedAsFinancingActivities",
      PNL,
    ),
    dividendsPaid: extractNumber(
      xml,
      "DividendsPaidClassifiedAsFinancingActivities",
      PNL,
    ),
    interestPaid:
      extractNumber(xml, "InterestPaidClassifiedAsFinancingActivities", PNL) ??
      extractNumber(xml, "InterestPaidClassifiedAsOperatingActivities", PNL),

    ...ps,
  };
}
