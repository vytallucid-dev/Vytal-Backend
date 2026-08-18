// ─────────────────────────────────────────────────────────────
// LEGACY V2 XBRL PARSER (in-bse-fin namespace)
//
// Handles the OLD pre-Integrated-Filing taxonomy used before April 2025.
//
// Used ONLY by: legacy/backfill-legacy.ts (historical backfill)
// ─────────────────────────────────────────────────────────────

import { deriveFiscalPeriod } from "../xbrl/parser-common.js";
import type {
  FilingTaxonomy,
  NseFilingEntry,
  ParsedQuarterlyResult,
  ResultType,
} from "../xbrl/types.js";

const RUPEES_PER_CRORE = 1e7;

const QUARTERLY_PNL_CONTEXT = "OneD";
const ANNUAL_PNL_CONTEXT = "FourD";
const BALANCE_SHEET_CONTEXT = "OneI";

// ─────────────────────────────────────────────────────────────
// Generic extractors
// ─────────────────────────────────────────────────────────────

export function extractNumber(
  xml: string,
  tag: string,
  contextRef: string,
): number | null {
  const re = new RegExp(
    `<in-bse-fin:${tag}\\b[^>]*?contextRef="${contextRef}"[^>]*?>([\\-\\d.eE+]+)</in-bse-fin:${tag}>`,
    "i",
  );
  const m = xml.match(re);
  if (!m) return null;

  const raw = parseFloat(m[1]);
  if (!Number.isFinite(raw)) return null;

  const unitRe = new RegExp(
    `<in-bse-fin:${tag}\\b[^>]*?contextRef="${contextRef}"[^>]*?unitRef="([^"]+)"`,
    "i",
  );
  const unitFromCtx = xml.match(unitRe)?.[1];

  const unitRe2 = new RegExp(
    `<in-bse-fin:${tag}\\b[^>]*?unitRef="([^"]+)"[^>]*?contextRef="${contextRef}"`,
    "i",
  );
  const unitFromCtx2 = xml.match(unitRe2)?.[1];

  const unit = unitFromCtx ?? unitFromCtx2 ?? "INR";

  if (unit === "INR") return raw / RUPEES_PER_CRORE;
  return raw;
}

// ─────────────────────────────────────────────────────────────
// ANNUAL CASH-FLOW EXTRACTION — FourD first, OneD only as a fallback.
//
// ⚠ THIS IS DELIBERATELY NOT A GENERAL FALLBACK. Read this before widening it.
//
// MEASURED 2026-08-16 across FY19–FY23 documents, the two duration contexts mean
// the same thing in EVERY vintage (they are dangling refs in FY19/FY21 — used but
// never defined by an <xbrli:context> — so the meaning was established from the
// values themselves):
//     OneD  = ONE quarter (Q4)          FourD = FOUR quarters (the full year)
//   ULTRACEMCO FY21 revenue  OneD 13,965.51 Cr vs FourD 43,188.34 Cr  (0.32)
//   ULTRACEMCO FY23 revenue  OneD 18,121.02 Cr vs FourD 61,326.50 Cr  (0.30)
//   ABB        FY20 revenue  OneD  1,700.76 Cr vs FourD  5,820.95 Cr  (0.29)
//   BHARTIARTL FY21 revenue  OneD 16,329.50 Cr vs FourD 64,325.90 Cr  (0.25)
// So reading OneD as an annual figure would import ONE QUARTER AS A YEAR. That is
// why P&L and balance-sheet fields keep their strict context and must keep it.
//
// The CASH-FLOW STATEMENT is the exception, and only because the FY21-vintage
// filers tagged a FULL-YEAR figure with the quarter context. The values prove it —
// each OneD-tagged cash flow is a year-sized number, not a quarter-sized one:
//   ULTRACEMCO  CF FY21 OneD 11,551.00 Cr  vs its own FourD CF FY22 8,669.66 / FY23 9,348.18
//   BHARTIARTL  CF FY21 OneD 34,392.30 Cr  vs its own FourD CF FY23 43,582.60
//   PIDILITIND  CF FY21 OneD  1,264.19 Cr  vs its own FourD CF FY23  1,432.36
// A quarter would be ~1/4 of those; ×4 would be wildly out of line with the same
// company's neighbouring annual figures.
//
// THREE PROPERTIES MAKE THIS SAFE:
//   1. SCOPE — applied ONLY to cash-flow-statement tags in the ANNUAL parser.
//      Revenue / PAT / PBT / expenses / every balance-sheet field are untouched,
//      so the "OneD is a quarter" hazard cannot reach them.
//   2. ORDER — FourD is always preferred. When a filer tags correctly (FY22+),
//      FourD wins and OneD is never consulted.
//   3. NO AMBIGUITY — MEASURED: in every document where a cash-flow tag appears
//      under OneD, it appears there ONLY. There is never a competing FourD value
//      for the same tag, so the fallback never has to choose between two.
function extractAnnualCashFlow(xml: string, tag: string): number | null {
  const primary = extractNumber(xml, tag, ANNUAL_PNL_CONTEXT);
  if (primary !== null) return primary;
  return extractNumber(xml, tag, QUARTERLY_PNL_CONTEXT);
}

export function extractText(
  xml: string,
  tag: string,
  contextRef: string,
): string | null {
  const re = new RegExp(
    `<in-bse-fin:${tag}\\b[^>]*?contextRef="${contextRef}"[^>]*?>([^<]+)</in-bse-fin:${tag}>`,
    "i",
  );
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

export function extractDate(
  xml: string,
  tag: string,
  contextRef: string,
): Date | null {
  const txt = extractText(xml, tag, contextRef);
  if (!txt) return null;
  const m = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));
}

export function detectTaxonomy(xml: string, xbrlUrl?: string): FilingTaxonomy {
  const hasInterestEarned = /<in-bse-fin:InterestEarned[\s>]/.test(xml);
  const hasRevenueFromOperations =
    /<in-bse-fin:RevenueFromOperations[\s>]/.test(xml);

  if (hasInterestEarned && !hasRevenueFromOperations) return "banking";
  if (hasRevenueFromOperations && !hasInterestEarned) return "ind_as";

  if (xbrlUrl) {
    if (xbrlUrl.includes("/BANKING_")) return "banking";
    if (xbrlUrl.includes("/INDAS_")) return "ind_as";
  }
  return "ind_as";
}

// ─────────────────────────────────────────────────────────────
// QUARTERLY parsers — preserved from before, with context renamed for clarity
// ─────────────────────────────────────────────────────────────

function parseQuarterlyIndAsPnL(xml: string, resultType: ResultType) {
  const PNL = QUARTERLY_PNL_CONTEXT;
  const revenue = extractNumber(xml, "RevenueFromOperations", PNL);
  const otherIncome = extractNumber(xml, "OtherIncome", PNL);
  const expenses = extractNumber(xml, "Expenses", PNL);
  const depreciation = extractNumber(
    xml,
    "DepreciationDepletionAndAmortisationExpense",
    PNL,
  );
  const interest = extractNumber(xml, "FinanceCosts", PNL);
  const profitBeforeTax = extractNumber(xml, "ProfitBeforeTax", PNL);
  const tax = extractNumber(xml, "TaxExpense", PNL);
  const netProfit =
    (resultType === "consolidated"
      ? extractNumber(xml, "ProfitOrLossAttributableToOwnersOfParent", PNL)
      : null) ?? extractNumber(xml, "ProfitLossForPeriod", PNL);
  const operatingProfit =
    profitBeforeTax !== null && interest !== null && depreciation !== null
      ? round2(profitBeforeTax + interest + depreciation)
      : null;
  return {
    revenue,
    otherIncome,
    expenses,
    operatingProfit,
    depreciation,
    interest,
    profitBeforeTax,
    tax,
    netProfit,
  };
}

function parseQuarterlyBankingPnL(xml: string, resultType: ResultType) {
  const PNL = QUARTERLY_PNL_CONTEXT;
  const revenue = extractNumber(xml, "InterestEarned", PNL);
  const otherIncome = extractNumber(xml, "OtherIncome", PNL);
  const expenses = extractNumber(
    xml,
    "ExpenditureExcludingProvisionsAndContingencies",
    PNL,
  );
  const operatingProfit = extractNumber(
    xml,
    "OperatingProfitBeforeProvisionAndContingencies",
    PNL,
  );
  const profitBeforeTax = extractNumber(
    xml,
    "ProfitLossFromOrdinaryActivitiesBeforeTax",
    PNL,
  );
  const tax = extractNumber(xml, "TaxExpense", PNL);
  const netProfit =
    (resultType === "consolidated"
      ? extractNumber(
          xml,
          "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates",
          PNL,
        )
      : null) ?? extractNumber(xml, "ProfitLossForThePeriod", PNL);
  return {
    revenue,
    otherIncome,
    expenses,
    operatingProfit,
    depreciation: null,
    interest: null,
    profitBeforeTax,
    tax,
    netProfit,
  };
}

export function parseQuarterlyResultXbrl(
  xml: string,
  filing: Pick<NseFilingEntry, "symbol" | "xbrl" | "consolidated">,
): ParsedQuarterlyResult {
  const taxonomy = detectTaxonomy(xml, filing.xbrl);
  const resultType: ResultType =
    filing.consolidated === "Consolidated" ? "consolidated" : "standalone";
  const PNL = QUARTERLY_PNL_CONTEXT;

  const reportDate = extractDate(xml, "DateOfEndOfReportingPeriod", PNL);
  const filingDate =
    extractDate(
      xml,
      "DateOfBoardMeetingWhenFinancialResultsWereApproved",
      PNL,
    ) ??
    extractDate(xml, "DateOfStartOfReportingPeriod", PNL) ??
    reportDate!;
  const fyStart = extractDate(xml, "DateOfStartOfFinancialYear", PNL);
  const fyEnd = extractDate(xml, "DateOfEndOfFinancialYear", PNL);

  if (!reportDate || !fyStart || !fyEnd) {
    throw new Error(
      `Missing required date tags in v2 quarterly XBRL for ${filing.symbol}: ` +
        `reportDate=${reportDate} fyStart=${fyStart} fyEnd=${fyEnd}`,
    );
  }

  const { quarter, fiscalYear } = deriveFiscalPeriod(
    reportDate,
    fyStart,
    fyEnd,
    "quarterly",
  );

  const pnl =
    taxonomy === "banking"
      ? parseQuarterlyBankingPnL(xml, resultType)
      : parseQuarterlyIndAsPnL(xml, resultType);

  if (pnl.netProfit === null) {
    throw new Error(
      `Failed to extract netProfit for ${filing.symbol} ${quarter} ${fiscalYear} (v2 quarterly)`,
    );
  }

  return {
    symbol: filing.symbol,
    quarter,
    fiscalYear,
    reportDate,
    filingDate,
    resultType,
    taxonomy,
    xbrlUrl: filing.xbrl,
    ...pnl,
  };
}

// ─────────────────────────────────────────────────────────────
// ANNUAL parsers — NEW
// ─────────────────────────────────────────────────────────────

/**
 * Annual parsed result for Ind-AS — full P&L, BS, CFS, per-share.
 * Field names match ParsedIndAsAnnual in v3 so the adapter is a no-op rename pass.
 */
export interface ParsedV2AnnualIndAs {
  symbol: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: ResultType;
  xbrlUrl: string;
  taxonomy: "ind_as";

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

  // CFS
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

export interface ParsedV2AnnualBanking {
  symbol: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: ResultType;
  xbrlUrl: string;
  taxonomy: "banking";

  // P&L
  interestEarned: number | null;
  interestExpended: number | null;
  interestOnAdvances: number | null;
  revenueOnInvestments: number | null;
  interestOnRbiBalances: number | null;
  otherInterest: number | null;
  otherIncome: number | null;
  employeesCost: number | null;
  operatingExpenses: number | null;
  otherOperatingExpenses: number | null;
  expenditureExclProvisions: number | null;
  ppop: number | null;
  provisions: number | null;
  exceptionalItems: number | null;
  extraordinaryItems: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  profitAfterTax: number | null;
  netProfit: number | null;

  // BS
  capital: number | null;
  reservesAndSurplus: number | null;
  reserveExclRevaluation: number | null;
  deposits: number | null;
  borrowings: number | null;
  otherLiabilities: number | null;
  capitalAndLiabilities: number | null;
  cashAndBalancesWithRbi: number | null;
  balancesWithBanks: number | null;
  investments: number | null;
  advances: number | null;
  fixedAssets: number | null;
  otherAssets: number | null;
  totalAssets: number | null;

  // CFS
  cashFromOperating: number | null;
  cashFromInvesting: number | null;
  cashFromFinancing: number | null;
  netCashFlow: number | null;

  // Asset Quality (absolute only in v2; ratios came later)
  gnpaAbsolute: number | null;
  nnpaAbsolute: number | null;
  gnpaPct: number | null;
  nnpaPct: number | null;

  // Capital Adequacy (not in v2)
  cet1Ratio: number | null;
  additionalTier1Ratio: number | null;

  // Profitability (ReturnOnAssets in v2 annual)
  roaDisclosed: number | null;

  // Per Share
  basicEps: number | null;
  dilutedEps: number | null;
  faceValueShare: number | null;
  paidUpEquityCapital: number | null;
}

export type ParsedV2Annual = ParsedV2AnnualIndAs | ParsedV2AnnualBanking;

/**
 * Parse a v2 ANNUAL XBRL file (in-bse-fin namespace, FourD/OneI contexts).
 */
export function parseAnnualResultXbrl(
  xml: string,
  filing: Pick<NseFilingEntry, "symbol" | "xbrl" | "consolidated">,
): ParsedV2Annual {
  const taxonomy = detectTaxonomy(xml, filing.xbrl);
  const resultType: ResultType =
    filing.consolidated === "Consolidated" ? "consolidated" : "standalone";
  const PNL = ANNUAL_PNL_CONTEXT;
  const BS = BALANCE_SHEET_CONTEXT;

  const reportDate = extractDate(xml, "DateOfEndOfReportingPeriod", PNL);
  const filingDate =
    extractDate(
      xml,
      "DateOfBoardMeetingWhenFinancialResultsWereApproved",
      "OneD",
    ) ??
    extractDate(
      xml,
      "DateOfBoardMeetingWhenFinancialResultsWereApproved",
      PNL,
    ) ??
    reportDate!;
  const fyStart =
    extractDate(xml, "DateOfStartOfFinancialYear", "OneD") ??
    extractDate(xml, "DateOfStartOfFinancialYear", PNL);
  const fyEnd =
    extractDate(xml, "DateOfEndOfFinancialYear", "OneD") ??
    extractDate(xml, "DateOfEndOfFinancialYear", PNL);

  if (!reportDate || !fyStart || !fyEnd) {
    throw new Error(
      `Missing required date tags in v2 annual XBRL for ${filing.symbol}: ` +
        `reportDate=${reportDate} fyStart=${fyStart} fyEnd=${fyEnd}`,
    );
  }

  const { fiscalYear } = deriveFiscalPeriod(
    reportDate,
    fyStart,
    fyEnd,
    "annual",
  );

  const basePerShare = {
    basicEps:
      extractNumber(
        xml,
        "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
        PNL,
      ) ??
      extractNumber(xml, "BasicEarningsPerShareAfterExtraordinaryItems", PNL),
    dilutedEps:
      extractNumber(
        xml,
        "DilutedEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
        PNL,
      ) ??
      extractNumber(xml, "DilutedEarningsPerShareAfterExtraordinaryItems", PNL),
    faceValueShare:
      extractNumber(xml, "FaceValueOfEquityShareCapital", BS) ??
      extractNumber(xml, "FaceValueOfEquityShareCapital", PNL),
    paidUpEquityCapital:
      extractNumber(xml, "PaidUpValueOfEquityShareCapital", BS) ??
      extractNumber(xml, "PaidUpValueOfEquityShareCapital", PNL),
  };

  if (taxonomy === "banking") {
    return {
      symbol: filing.symbol,
      fiscalYear,
      reportDate,
      filingDate,
      resultType,
      xbrlUrl: filing.xbrl,
      taxonomy: "banking",

      interestEarned: extractNumber(xml, "InterestEarned", PNL),
      interestExpended: extractNumber(xml, "InterestExpended", PNL),
      interestOnAdvances: extractNumber(
        xml,
        "InterestOrDiscountOnAdvancesOrBills",
        PNL,
      ),
      revenueOnInvestments: extractNumber(xml, "RevenueOnInvestments", PNL),
      interestOnRbiBalances: extractNumber(
        xml,
        "InterestOnBalancesWithReserveBankOfIndiaAndOtherInterBankFunds",
        PNL,
      ),
      otherInterest: extractNumber(xml, "OtherInterest", PNL),
      otherIncome: extractNumber(xml, "OtherIncome", PNL),
      employeesCost: extractNumber(xml, "EmployeesCost", PNL),
      operatingExpenses: extractNumber(xml, "OperatingExpenses", PNL),
      otherOperatingExpenses: extractNumber(xml, "OtherOperatingExpenses", PNL),
      expenditureExclProvisions: extractNumber(
        xml,
        "ExpenditureExcludingProvisionsAndContingencies",
        PNL,
      ),
      ppop: extractNumber(
        xml,
        "OperatingProfitBeforeProvisionAndContingencies",
        PNL,
      ),
      provisions: extractNumber(
        xml,
        "ProvisionsOtherThanTaxAndContingencies",
        PNL,
      ),
      exceptionalItems: extractNumber(xml, "ExceptionalItems", PNL),
      extraordinaryItems: extractNumber(xml, "ExtraordinaryItems", PNL),
      profitBeforeTax: extractNumber(
        xml,
        "ProfitLossFromOrdinaryActivitiesBeforeTax",
        PNL,
      ),
      tax: extractNumber(xml, "TaxExpense", PNL),
      profitAfterTax: extractNumber(
        xml,
        "ProfitLossFromOrdinaryActivitiesAfterTax",
        PNL,
      ),
      netProfit:
        (resultType === "consolidated"
          ? extractNumber(
              xml,
              "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates",
              PNL,
            )
          : null) ?? extractNumber(xml, "ProfitLossForThePeriod", PNL),

      capital: extractNumber(xml, "Capital", BS),
      reservesAndSurplus: extractNumber(xml, "ReservesAndSurplus", BS),
      reserveExclRevaluation: extractNumber(
        xml,
        "ReserveExcludingRevaluationReserves",
        BS,
      ),
      deposits: extractNumber(xml, "Deposits", BS),
      borrowings: extractNumber(xml, "Borrowings", BS),
      otherLiabilities: extractNumber(xml, "OtherLiabilitiesAndProvisions", BS),
      capitalAndLiabilities: extractNumber(xml, "CapitalAndLiabilities", BS),
      cashAndBalancesWithRbi: extractNumber(
        xml,
        "CashAndBalancesWithReserveBankOfIndia",
        BS,
      ),
      balancesWithBanks: extractNumber(
        xml,
        "BalancesWithBanksAndMoneyAtCallAndShortNotice",
        BS,
      ),
      investments: extractNumber(xml, "Investments", BS),
      advances: extractNumber(xml, "Advances", BS),
      fixedAssets: extractNumber(xml, "FixedAssets", BS),
      otherAssets: extractNumber(xml, "OtherAssets", BS),
      totalAssets: extractNumber(xml, "Assets", BS),

      cashFromOperating: extractAnnualCashFlow(xml, "CashFlowsFromUsedInOperatingActivities"),
      cashFromInvesting: extractAnnualCashFlow(xml, "CashFlowsFromUsedInInvestingActivities"),
      cashFromFinancing: extractAnnualCashFlow(xml, "CashFlowsFromUsedInFinancingActivities"),
      netCashFlow: extractAnnualCashFlow(xml, "IncreaseDecreaseInCashAndCashEquivalents"),

      gnpaAbsolute: extractNumber(xml, "GrossNonPerformingAssets", PNL),
      nnpaAbsolute: extractNumber(xml, "NonPerformingAssets", PNL),
      gnpaPct: null, // not in v2
      nnpaPct: null, // not in v2
      cet1Ratio: null, // not in v2
      additionalTier1Ratio: null, // not in v2
      roaDisclosed: extractNumber(xml, "ReturnOnAssets", PNL),

      ...basePerShare,
    };
  }

  // Ind-AS
  return {
    symbol: filing.symbol,
    fiscalYear,
    reportDate,
    filingDate,
    resultType,
    xbrlUrl: filing.xbrl,
    taxonomy: "ind_as",

    revenue: extractNumber(xml, "RevenueFromOperations", PNL),
    otherIncome: extractNumber(xml, "OtherIncome", PNL),
    expenses: extractNumber(xml, "Expenses", PNL),
    employeeBenefitExpense: extractNumber(xml, "EmployeeBenefitExpense", PNL),
    financeCosts: extractNumber(xml, "FinanceCosts", PNL),
    depreciation: extractNumber(
      xml,
      "DepreciationDepletionAndAmortisationExpense",
      PNL,
    ),
    profitBeforeTax: extractNumber(xml, "ProfitBeforeTax", PNL),
    tax: extractNumber(xml, "TaxExpense", PNL),
    netProfit:
      (resultType === "consolidated"
        ? extractNumber(xml, "ProfitOrLossAttributableToOwnersOfParent", PNL)
        : null) ?? extractNumber(xml, "ProfitLossForPeriod", PNL),

    equityShareCapital: extractNumber(xml, "EquityShareCapital", BS),
    otherEquity: extractNumber(xml, "OtherEquity", BS),
    totalEquity: extractNumber(xml, "Equity", BS),
    equityAttributableToOwners: extractNumber(
      xml,
      "EquityAttributableToOwnersOfParent",
      BS,
    ),

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
    provisionsCurrent: null,
    provisionsNoncurrent: null,
    currentTaxLiabilities: extractNumber(xml, "CurrentTaxLiabilities", BS),
    deferredTaxLiabilitiesNet: extractNumber(
      xml,
      "DeferredTaxLiabilitiesNet",
      BS,
    ),
    currentLiabilities: extractNumber(xml, "CurrentLiabilities", BS),
    noncurrentLiabilities: extractNumber(xml, "NoncurrentLiabilities", BS),

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
    loansNoncurrent: null,
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
    loansCurrent: null,
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

    cashFromOperating: extractAnnualCashFlow(xml, "CashFlowsFromUsedInOperatingActivities"),
    cashFromInvesting: extractAnnualCashFlow(xml, "CashFlowsFromUsedInInvestingActivities"),
    cashFromFinancing: extractAnnualCashFlow(xml, "CashFlowsFromUsedInFinancingActivities"),
    netCashFlow: extractAnnualCashFlow(xml, "IncreaseDecreaseInCashAndCashEquivalents"),
    capex: extractAnnualCashFlow(xml, "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"),
    proceedsFromBorrowings: extractAnnualCashFlow(xml, "ProceedsFromBorrowingsClassifiedAsFinancingActivities"),
    repaymentsOfBorrowings: extractAnnualCashFlow(xml, "RepaymentsOfBorrowingsClassifiedAsFinancingActivities"),
    dividendsPaid: extractAnnualCashFlow(xml, "DividendsPaidClassifiedAsFinancingActivities"),
    interestPaid:
      extractAnnualCashFlow(xml, "InterestPaidClassifiedAsFinancingActivities") ??
      extractAnnualCashFlow(xml, "InterestPaidClassifiedAsOperatingActivities"),

    ...basePerShare,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
