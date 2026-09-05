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
import { pnlBlockRefused } from "./zero-block-guard.js";

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
  /** Set when RULE 4 refused a zero-filled quarterly column — the reason, for the ingest log.
   *  A silent refusal is as bad as a silent write (zero-block-guard.ts). */
  zeroedBlockNote?: string | null;
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
  /** The filing's OWN `Liabilities` subtotal — see checkBsImbalance. */
  totalLiabilities: number | null;

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

  // ── RULE 4 — THE ZEROED P&L BLOCK (zero-block-guard.ts). ──────────────────────────────────
  // A filer who reports only the FULL YEAR still ships the quarterly column, zero-filled. Read
  // literally that is ₹0 revenue and ₹0 profit for a quarter the company actually traded —
  // HEROMOTOCO Q4 FY19 consolidated is exactly this, 0.00 on every OneD line beside ₹33,972 Cr
  // in FourD. So the block is refused and every line goes NULL, which sends the row into the
  // shape guard (GUARD 1) and leaves any good stored row untouched.
  //
  // It is the CONJUNCTION that condemns, never the zero: a dormant company reporting no revenue
  // but real expenses is untouched, and 225 rows in this database are exactly that.
  const zeroed = pnlBlockRefused(
    (tag, ctx) => extractNumber(xml, tag, ctx),
    PNL,
    ANNUAL_PNL_CONTEXT, // the YTD/full-year column in the SAME instance — the live-period witness
    BALANCE_SHEET_CONTEXT, // …and the balance sheet, for an instance with no live period at all
  );
  if (zeroed.refused) {
    return {
      symbol: ctx.symbol,
      quarter,
      fiscalYear,
      reportDate: meta.reportPeriodEnd,
      filingDate: meta.filingDate,
      resultType: ctx.consolidated === "Consolidated" ? "consolidated" : "standalone",
      xbrlUrl: ctx.xbrl,
      revenue: null,
      otherIncome: null,
      expenses: null,
      depreciation: null,
      interest: null,
      profitBeforeTax: null,
      tax: null,
      netProfit: null,
      operatingProfit: null,
      zeroedBlockNote: zeroed.note,
    };
  }

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

  // ── RULE 4 — THE ZEROED P&L BLOCK (zero-block-guard.ts), the ANNUAL mirror. ───────────────
  // The quarterly case is a filer who reports only the year; this is a filer who reports only the
  // QUARTER and zero-fills the annual column. MEASURED on ADANIENSOL's FY19 standalone instance:
  // OneD carries ₹260.27 Cr of revenue and FourD carries 0.00 on every line — and FourD is the
  // column this function reads. MRF's and NTPC's FY18 consolidated instances are the harder shape
  // again: BOTH columns zero, with only a non-zero paid-up equity capital to prove the company
  // exists. All three landed as a ₹0 year.
  //
  // ⚠ ONLY THE P&L IS NULLED, NOT THE BALANCE SHEET. The refusal is a statement about the P&L
  //   block specifically; a balance sheet in the same instance may be perfectly good, and throwing
  //   it away would be its own silent loss. With revenue and netProfit null, GUARD 1
  //   (checkPlContentless) takes over and decides whether the row may be written at all.
  const zeroedPnl = pnlBlockRefused(
    (tag, ctx) => extractNumber(xml, tag, ctx),
    PNL,
    QUARTERLY_PNL_CONTEXT, // the Q4-only column in the SAME instance — the live-period witness
    BS,
  );
  /** NULL every P&L line when RULE 4 refused the block. "Unavailable", never "none". */
  const pl = (v: number | null): number | null => (zeroedPnl.refused ? null : v);
  /**
   * EPS out of a refused block — nulled ONLY when it reads exactly 0, and that asymmetry is an
   * IDENTITY, not a preference. EPS = PAT / shares, so a zero-filled P&L cannot produce a non-zero
   * EPS: a non-zero one is real information the filer supplied and must survive. A zero one is the
   * same non-disclosure as the block it came out of. MEASURED on the repaired rows: 8 of 9 carried
   * basic_eps exactly 0.0000 beside their zeroed P&L, and POLYMED FY18 carried a real 1.83 — which
   * this keeps. (The same shape as roaRefused, RULE 2.)
   */
  const perShare = (v: number | null): number | null =>
    zeroedPnl.refused && v === 0 ? null : v;

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

    // P&L — every line passed through `pl`, which nulls the block when RULE 4 refused it.
    revenue: pl(extractNumber(xml, "RevenueFromOperations", PNL)),
    otherIncome: pl(extractNumber(xml, "OtherIncome", PNL)),
    expenses: pl(
      extractNumber(xml, "Expenses", PNL) ??
        extractNumber(xml, "TotalExpenses", PNL),
    ),
    employeeBenefitExpense: pl(extractNumber(xml, "EmployeeBenefitExpense", PNL)),
    financeCosts: pl(extractNumber(xml, "FinanceCosts", PNL)),
    depreciation: pl(
      extractNumber(xml, "DepreciationDepletionAndAmortisationExpense", PNL),
    ),
    profitBeforeTax: pl(extractNumber(xml, "ProfitBeforeTax", PNL)),
    tax: pl(
      extractNumber(xml, "IncomeTaxExpenseContinuingOperations", PNL) ??
        extractNumber(xml, "TotalIncomeTaxExpense", PNL) ??
        extractNumber(xml, "IncomeTaxExpense", PNL) ??
        extractNumber(xml, "TaxExpense", PNL) ??
        extractNumber(xml, "TotalTaxExpense", PNL) ??
        extractNumber(xml, "Tax", PNL),
    ),
    netProfit: pl(
      extractNumber(xml, "ProfitLossForPeriod", PNL) ??
        extractNumber(xml, "ProfitLossForPeriodFromContinuingOperations", PNL),
    ),

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
    // The filing's OWN total. Read rather than reconstructed, because current + non-current is
    // NOT the whole of it whenever a disposal group (or a regulated utility's own bucket) exists.
    totalLiabilities: extractNumber(xml, "Liabilities", BS),

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
    basicEps: perShare(ps.basicEps),
    dilutedEps: perShare(ps.dilutedEps),
  };
}
