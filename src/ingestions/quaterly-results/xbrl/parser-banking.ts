// File: src/ingestions/quaterly-results/xbrl/parser-banking.ts (NEW)

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

export interface ParsedBankingQuarterly {
  symbol: string;
  quarter: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: "standalone" | "consolidated";
  xbrlUrl: string;

  // P&L
  interestEarned: number | null;
  interestExpended: number | null;
  otherIncome: number | null;
  employeesCost: number | null;
  operatingExpenses: number | null;
  expenditureExclProvisions: number | null;
  ppop: number | null;
  provisions: number | null;
  exceptionalItems: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  profitAfterTax: number | null;
  netProfit: number | null;

  // Asset Quality (NULL if audit-pending — see Decision #12)
  gnpaAbsolute: number | null;
  nnpaAbsolute: number | null;
  gnpaPct: number | null;
  nnpaPct: number | null;

  // Capital Adequacy (NULL if audit-pending)
  cet1Ratio: number | null;
  additionalTier1Ratio: number | null;

  // Profitability
  roaQuarterly: number | null;

  // Audit-gating flag
  auditPending: boolean;
}

export interface ParsedBankingAnnual {
  symbol: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: "standalone" | "consolidated";
  xbrlUrl: string;

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

  // Asset Quality
  gnpaAbsolute: number | null;
  nnpaAbsolute: number | null;
  gnpaPct: number | null;
  nnpaPct: number | null;

  // Capital Adequacy
  cet1Ratio: number | null;
  additionalTier1Ratio: number | null;

  // Profitability
  roaDisclosed: number | null;

  // Per Share
  basicEps: number | null;
  dilutedEps: number | null;
  faceValueShare: number | null;
  paidUpEquityCapital: number | null;
}

/**
 * Q4 audit-gating detector.
 * Decision #12: when GNPA, NNPA, CET1, and ROA are ALL zero in a Q4 filing,
 * treat the asset-quality + capital + profitability disclosures as
 * not-yet-audited and write nulls rather than zeros.
 *
 * Returns true if this quarterly should be treated as audit-pending.
 */
function isQ4AuditPending(
  quarter: string,
  gnpaAbs: number | null,
  nnpaAbs: number | null,
  cet1: number | null,
  roa: number | null,
): boolean {
  if (quarter !== "Q4") return false;
  return (
    (gnpaAbs === 0 || gnpaAbs === null) &&
    (nnpaAbs === 0 || nnpaAbs === null) &&
    (cet1 === 0 || cet1 === null) &&
    (roa === 0 || roa === null)
  );
}

export function parseBankingQuarterly(
  xml: string,
  ctx: ParseContext,
): ParsedBankingQuarterly {
  const meta = extractCommonMetadata(xml, "quarterly");
  if (
    !meta.reportPeriodEnd ||
    !meta.fyStart ||
    !meta.fyEnd ||
    !meta.filingDate
  ) {
    throw new Error(
      `Missing required dates in banking quarterly XBRL for ${ctx.symbol}`,
    );
  }
  const { quarter, fiscalYear } = deriveFiscalPeriod(
    meta.reportPeriodEnd,
    meta.fyStart,
    meta.fyEnd,
    "quarterly",
  );

  const PNL = QUARTERLY_PNL_CONTEXT;

  // Raw values (read from XBRL)
  const rawGnpaAbs = extractNumber(xml, "GrossNonPerformingAssets", PNL);
  const rawNnpaAbs = extractNumber(xml, "NonPerformingAssets", PNL);
  const rawGnpaPct = extractNumber(xml, "PercentageOfGrossNpa", PNL);
  const rawNnpaPct = extractNumber(xml, "PercentageOfNpa", PNL);
  const rawCet1 = extractNumber(xml, "CET1Ratio", PNL);
  const rawAt1 = extractNumber(xml, "AdditionalTier1Ratio", PNL);
  const rawRoa = extractNumber(xml, "ReturnOnAssets", PNL);

  const auditPending = isQ4AuditPending(
    quarter,
    rawGnpaAbs,
    rawNnpaAbs,
    rawCet1,
    rawRoa,
  );

  // If audit-pending, null out the gated fields. Decision #12.
  const gnpaAbs = auditPending ? null : rawGnpaAbs;
  const nnpaAbs = auditPending ? null : rawNnpaAbs;
  const gnpaPct = auditPending ? null : rawGnpaPct;
  const nnpaPct = auditPending ? null : rawNnpaPct;
  const cet1 = auditPending ? null : rawCet1;
  const at1 = auditPending ? null : rawAt1;
  const roa = auditPending ? null : rawRoa;

  return {
    symbol: ctx.symbol,
    quarter,
    fiscalYear,
    reportDate: meta.reportPeriodEnd,
    filingDate: meta.filingDate,
    resultType:
      ctx.consolidated === "Consolidated" ? "consolidated" : "standalone",
    xbrlUrl: ctx.xbrl,

    interestEarned: extractNumber(xml, "InterestEarned", PNL),
    interestExpended: extractNumber(xml, "InterestExpended", PNL),
    otherIncome: extractNumber(xml, "OtherIncome", PNL),
    employeesCost: extractNumber(xml, "EmployeesCost", PNL),
    operatingExpenses: extractNumber(xml, "OperatingExpenses", PNL),
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
    provisions:
      extractNumber(xml, "ProvisionsOtherThanTaxAndContingencies", PNL) ??
      extractNumber(xml, "ProvisionsAndContingencies", PNL),
    exceptionalItems: extractNumber(xml, "ExceptionalItems", PNL),
    profitBeforeTax:
      extractNumber(xml, "ProfitLossFromOrdinaryActivitiesBeforeTax", PNL) ??
      extractNumber(xml, "ProfitBeforeExtraordinaryItemsAndTax", PNL) ??
      extractNumber(xml, "ProfitBeforeTax", PNL),
    tax:
      extractNumber(xml, "TaxExpense", PNL) ??
      extractNumber(xml, "TotalTaxExpense", PNL),
    profitAfterTax:
      extractNumber(xml, "ProfitLossFromOrdinaryActivitiesAfterTax", PNL) ??
      extractNumber(xml, "ProfitLossForThePeriod", PNL),
    netProfit:
      extractNumber(xml, "ProfitLossForThePeriod", PNL) ??
      extractNumber(xml, "ProfitAfterTax", PNL),

    gnpaAbsolute: gnpaAbs,
    nnpaAbsolute: nnpaAbs,
    gnpaPct,
    nnpaPct,
    cet1Ratio: cet1,
    additionalTier1Ratio: at1,
    roaQuarterly: roa,
    auditPending,
  };
}

export function parseBankingAnnual(
  xml: string,
  ctx: ParseContext,
): ParsedBankingAnnual {
  const meta = extractCommonMetadata(xml, "annual");
  if (
    !meta.reportPeriodEnd ||
    !meta.fyStart ||
    !meta.fyEnd ||
    !meta.filingDate
  ) {
    throw new Error(
      `Missing required dates in banking annual XBRL for ${ctx.symbol}`,
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
    interestEarned: extractNumber(xml, "InterestEarned", PNL),
    interestExpended: extractNumber(xml, "InterestExpended", PNL),
    interestOnAdvances:
      extractNumber(xml, "InterestOrDiscountOnAdvancesOrBills", PNL) ??
      extractNumber(xml, "InterestDiscountOnAdvancesBills", PNL),
    revenueOnInvestments:
      extractNumber(xml, "IncomeOnInvestments", PNL) ??
      extractNumber(xml, "InterestIncomeOnInvestments", PNL),
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
    provisions:
      extractNumber(xml, "ProvisionsOtherThanTaxAndContingencies", PNL) ??
      extractNumber(xml, "ProvisionsAndContingencies", PNL),
    exceptionalItems: extractNumber(xml, "ExceptionalItems", PNL),
    extraordinaryItems:
      extractNumber(xml, "ExtraordinaryItems", PNL) ??
      extractNumber(xml, "ExtraordinaryItemsBeforeTax", PNL),
    profitBeforeTax:
      extractNumber(xml, "ProfitLossFromOrdinaryActivitiesBeforeTax", PNL) ??
      extractNumber(xml, "ProfitBeforeExtraordinaryItemsAndTax", PNL) ??
      extractNumber(xml, "ProfitBeforeTax", PNL),
    tax:
      extractNumber(xml, "TaxExpense", PNL) ??
      extractNumber(xml, "TotalTaxExpense", PNL),
    profitAfterTax:
      extractNumber(xml, "ProfitLossFromOrdinaryActivitiesAfterTax", PNL) ??
      extractNumber(xml, "ProfitLossForThePeriod", PNL),
    netProfit:
      extractNumber(xml, "ProfitLossForThePeriod", PNL) ??
      extractNumber(xml, "ProfitAfterTax", PNL),

    // BS
    capital: extractNumber(xml, "Capital", BS),
    reservesAndSurplus: extractNumber(xml, "ReservesAndSurplus", BS),
    reserveExclRevaluation: extractNumber(
      xml,
      "ReserveExcludingRevaluationReserves",
      BS,
    ), // ← was PNL, must be BS
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

    // Asset Quality (annual is always audited; no gating)
    gnpaAbsolute: extractNumber(xml, "GrossNonPerformingAssets", PNL),
    nnpaAbsolute: extractNumber(xml, "NonPerformingAssets", PNL),
    gnpaPct: extractNumber(xml, "PercentageOfGrossNpa", PNL),
    nnpaPct: extractNumber(xml, "PercentageOfNpa", PNL),

    // Capital Adequacy
    cet1Ratio: extractNumber(xml, "CET1Ratio", PNL),
    additionalTier1Ratio: extractNumber(xml, "AdditionalTier1Ratio", PNL),

    // Profitability
    roaDisclosed: extractNumber(xml, "ReturnOnAssets", PNL),

    ...ps,
  };
}
