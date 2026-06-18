// File: src/ingestions/quaterly-results/ingesters/ingest-indas-annual.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedIndAsAnnual } from "../xbrl/parser-indas.js";
import {
  safeNumber,
  decimalPct,
  decimalPerShare,
  decrementFY,
  pctChange,
  sumNonNull,
  avgNonNull,
} from "../ingester-utils.js";

export interface IngestIndAsAnnualInput {
  stockId: string;
  parsed: ParsedIndAsAnnual;
  source: string;
}

// A derived ratio / per-share column has limited precision; a corrupt SOURCE
// input (e.g. a mis-tagged face value in the XBRL) can push a derived value past
// the column range and reject the ENTIRE row — discarding real financials over a
// display field. A display-only ratio must never do that, so out-of-range → null
// + warn. The scoring engine recomputes its metrics from raw ₹Cr lines and does
// not read these stored ratio columns for any affected metric (CN-8: no score
// shift). maxIntDigits = (precision − scale): Decimal(8,4)→4, Decimal(10,4)→6,
// Decimal(10,2)→8.
function boundDerived(
  v: Prisma.Decimal | null,
  maxIntDigits: number,
  field: string,
  tag: string,
): Prisma.Decimal | null {
  if (v === null) return null;
  const max = new Prisma.Decimal(10).pow(maxIntDigits);
  if (v.abs().greaterThanOrEqualTo(max)) {
    console.warn(
      `[ingest-indas-annual] ${tag}: derived ${field}=${v.toString()} out of column range ` +
        `(|v|≥${max.toString()}) → stored null (display field; scoring reads raw lines, not this column).`,
    );
    return null;
  }
  return v;
}

// Indian equity face values are 1/2/5/10 (occasionally up to 100). A value far
// outside that range is corrupt source data (seen in integrated-filing XBRL where
// a price or other figure is mis-tagged as nominal value). Drop it so it can't
// poison its consumers: the derived bookValuePerShare, and the F3 ESC-buyback
// quantifier in scoring (which reads faceValueShare, gated on an ESC drop).
const PLAUSIBLE_FACE_VALUE_MAX = 1000;
function plausibleFaceValue(v: number | null): number | null {
  if (v === null) return null;
  if (v <= 0 || v > PLAUSIBLE_FACE_VALUE_MAX) return null;
  return v;
}

export async function ingestIndAsAnnual(
  input: IngestIndAsAnnualInput,
  decision: "ingest" | "refresh",
): Promise<{ status: "success" | "refreshed"; rowId: string }> {
  const { stockId, parsed, source } = input;
  const p = parsed;
  const tag = `${p.fiscalYear}/${p.resultType} stock=${stockId.slice(0, 8)}`;
  // Sanitised face value — corrupt source (e.g. 44539 where the real value is 10)
  // would otherwise compute a nonsensical bookValuePerShare and reject the row.
  const faceValueSane = plausibleFaceValue(p.faceValueShare);
  if (faceValueSane === null && p.faceValueShare !== null) {
    console.warn(`[ingest-indas-annual] ${tag}: implausible faceValueShare=${p.faceValueShare} → treated as null.`);
  }

  // ── Derived totals ──
  const totalDebt = sumNonNull(p.borrowingsCurrent, p.borrowingsNoncurrent);
  const fcf =
    p.cashFromOperating !== null && p.capex !== null
      ? p.cashFromOperating - p.capex
      : null;
  const ebitda =
    p.profitBeforeTax !== null &&
    p.financeCosts !== null &&
    p.depreciation !== null
      ? p.profitBeforeTax + p.financeCosts + p.depreciation
      : null;

  // ── Margins ──
  const netMargin =
    p.netProfit !== null && p.revenue !== null && p.revenue !== 0
      ? (p.netProfit / p.revenue) * 100
      : null;

  // Operating margin = EBITDA / Revenue
  const operatingMargin =
    ebitda !== null && p.revenue !== null && p.revenue !== 0
      ? (ebitda / p.revenue) * 100
      : null;

  // ── Net Worth = Equity ──
  // Prefer EquityAttributableToOwners (consolidated) > totalEquity > shareCapital + otherEquity
  const netWorth =
    p.equityAttributableToOwners ??
    p.totalEquity ??
    sumNonNull(p.equityShareCapital, p.otherEquity);

  // ── Book Value Per Share ──
  // Need shares outstanding = paidUpEquityCapital / faceValueShare (both in absolute, so ratio is share count)
  // paidUpEquityCapital is in ₹ Cr; faceValueShare is in ₹/share. shares = (paidUpEquityCapital * 1e7) / faceValueShare
  let bookValuePerShare: number | null = null;
  if (
    netWorth !== null &&
    p.paidUpEquityCapital !== null &&
    p.paidUpEquityCapital > 0 &&
    faceValueSane !== null &&
    faceValueSane > 0
  ) {
    const sharesOutstandingCr = p.paidUpEquityCapital / faceValueSane; // (₹Cr) / (₹/share) → Cr-shares
    if (sharesOutstandingCr > 0) {
      bookValuePerShare = netWorth / sharesOutstandingCr;
    }
  }

  // ── D/E ──
  const debtToEquity =
    totalDebt !== null && netWorth !== null && netWorth !== 0
      ? totalDebt / netWorth
      : null;

  // ── ROE & ROCE — need prior-year for averaging ──
  const priorFY = decrementFY(p.fiscalYear);
  const priorRow = await prisma.fundamental.findUnique({
    where: {
      stockId_fiscalYear_resultType: {
        stockId,
        fiscalYear: priorFY,
        resultType: p.resultType, // compare same basis
      },
    },
    select: {
      revenue: true,
      netProfit: true,
      basicEps: true,
      totalEquity: true,
      equityAttributableToOwners: true,
      equityShareCapital: true,
      otherEquity: true,
      borrowingsCurrent: true,
      borrowingsNoncurrent: true,
      totalAssets: true,
    },
  });

  const priorNetWorth = priorRow
    ? (priorRow.equityAttributableToOwners?.toNumber() ??
      priorRow.totalEquity?.toNumber() ??
      sumNonNull(
        priorRow.equityShareCapital?.toNumber() ?? null,
        priorRow.otherEquity?.toNumber() ?? null,
      ))
    : null;

  const avgEquity = avgNonNull(netWorth, priorNetWorth);
  const roe =
    p.netProfit !== null && avgEquity !== null && avgEquity !== 0
      ? (p.netProfit / avgEquity) * 100
      : null;

  // ROCE: EBIT / (Equity + Total Debt) using year-end as approximation
  const ebit =
    p.profitBeforeTax !== null && p.financeCosts !== null
      ? p.profitBeforeTax + p.financeCosts
      : null;
  const capitalEmployed = sumNonNull(netWorth, totalDebt);
  const roce =
    ebit !== null && capitalEmployed !== null && capitalEmployed !== 0
      ? (ebit / capitalEmployed) * 100
      : null;

  // ── Interest Coverage = EBIT / Interest ──
  const interestCoverage =
    ebit !== null && p.financeCosts !== null && p.financeCosts !== 0
      ? ebit / p.financeCosts
      : null;

  // ── Receivables Days ──
  const receivables = sumNonNull(
    p.tradeReceivablesCurrent,
    p.tradeReceivablesNoncurrent,
  );
  const receivablesDays =
    receivables !== null && p.revenue !== null && p.revenue !== 0
      ? (receivables / p.revenue) * 365
      : null;

  // ── Inventory Turnover ──
  const inventoryTurnover =
    p.inventories !== null && p.inventories !== 0 && p.revenue !== null
      ? p.revenue / p.inventories
      : null;

  // ── Asset Turnover ──
  const assetTurnover =
    p.totalAssets !== null && p.totalAssets !== 0 && p.revenue !== null
      ? p.revenue / p.totalAssets
      : null;

  // ── YoY Growth ──
  const revenueGrowthYoy = pctChange(
    p.revenue,
    priorRow?.revenue?.toNumber() ?? null,
  );
  const profitGrowthYoy = pctChange(
    p.netProfit,
    priorRow?.netProfit?.toNumber() ?? null,
  );
  const epsGrowthYoy = pctChange(
    p.basicEps,
    priorRow?.basicEps?.toNumber() ?? null,
  );

  const data: Prisma.FundamentalUpsertArgs["create"] = {
    stockId,
    fiscalYear: p.fiscalYear,
    reportDate: p.reportDate,
    filingDate: p.filingDate,
    xbrlUrl: p.xbrlUrl,
    resultType: p.resultType,
    source,
    xbrlTaxonomy: "in_capmkt",

    // P&L
    revenue: safeNumber(p.revenue),
    otherIncome: safeNumber(p.otherIncome),
    expenses: safeNumber(p.expenses),
    employeeBenefitExpense: safeNumber(p.employeeBenefitExpense),
    financeCosts: safeNumber(p.financeCosts),
    depreciation: safeNumber(p.depreciation),
    profitBeforeTax: safeNumber(p.profitBeforeTax),
    tax: safeNumber(p.tax),
    netProfit: safeNumber(p.netProfit),

    // BS — Equity
    equityShareCapital: safeNumber(p.equityShareCapital),
    otherEquity: safeNumber(p.otherEquity),
    totalEquity: safeNumber(p.totalEquity),
    equityAttributableToOwners: safeNumber(p.equityAttributableToOwners),

    // BS — Liabilities
    borrowingsCurrent: safeNumber(p.borrowingsCurrent),
    borrowingsNoncurrent: safeNumber(p.borrowingsNoncurrent),
    tradePayablesCurrent: safeNumber(p.tradePayablesCurrent),
    tradePayablesNoncurrent: safeNumber(p.tradePayablesNoncurrent),
    otherCurrentLiabilities: safeNumber(p.otherCurrentLiabilities),
    otherNoncurrentLiabilities: safeNumber(p.otherNoncurrentLiabilities),
    otherCurrentFinancialLiabilities: safeNumber(
      p.otherCurrentFinancialLiabilities,
    ),
    otherNoncurrentFinancialLiabilities: safeNumber(
      p.otherNoncurrentFinancialLiabilities,
    ),
    provisionsCurrent: safeNumber(p.provisionsCurrent),
    provisionsNoncurrent: safeNumber(p.provisionsNoncurrent),
    currentTaxLiabilities: safeNumber(p.currentTaxLiabilities),
    deferredTaxLiabilitiesNet: safeNumber(p.deferredTaxLiabilitiesNet),
    currentLiabilities: safeNumber(p.currentLiabilities),
    noncurrentLiabilities: safeNumber(p.noncurrentLiabilities),
    totalDebt: safeNumber(totalDebt),

    // BS — Non-current Assets
    propertyPlantAndEquipment: safeNumber(p.propertyPlantAndEquipment),
    capitalWorkInProgress: safeNumber(p.capitalWorkInProgress),
    goodwill: safeNumber(p.goodwill),
    otherIntangibleAssets: safeNumber(p.otherIntangibleAssets),
    intangibleAssetsUnderDevelopment: safeNumber(
      p.intangibleAssetsUnderDevelopment,
    ),
    noncurrentInvestments: safeNumber(p.noncurrentInvestments),
    loansNoncurrent: safeNumber(p.loansNoncurrent),
    otherNoncurrentFinancialAssets: safeNumber(
      p.otherNoncurrentFinancialAssets,
    ),
    otherNoncurrentAssets: safeNumber(p.otherNoncurrentAssets),
    deferredTaxAssetsNet: safeNumber(p.deferredTaxAssetsNet),
    investmentProperty: safeNumber(p.investmentProperty),
    investmentsEquityMethod: safeNumber(p.investmentsEquityMethod),
    noncurrentAssets: safeNumber(p.noncurrentAssets),

    // BS — Current Assets
    inventories: safeNumber(p.inventories),
    currentInvestments: safeNumber(p.currentInvestments),
    tradeReceivablesCurrent: safeNumber(p.tradeReceivablesCurrent),
    tradeReceivablesNoncurrent: safeNumber(p.tradeReceivablesNoncurrent),
    cashAndCashEquivalents: safeNumber(p.cashAndCashEquivalents),
    bankBalanceOther: safeNumber(p.bankBalanceOther),
    loansCurrent: safeNumber(p.loansCurrent),
    otherCurrentFinancialAssets: safeNumber(p.otherCurrentFinancialAssets),
    otherCurrentAssets: safeNumber(p.otherCurrentAssets),
    currentTaxAssets: safeNumber(p.currentTaxAssets),
    noncurrentAssetsHeldForSale: safeNumber(p.noncurrentAssetsHeldForSale),
    currentAssets: safeNumber(p.currentAssets),
    totalAssets: safeNumber(p.totalAssets),

    // CFS
    cashFromOperating: safeNumber(p.cashFromOperating),
    cashFromInvesting: safeNumber(p.cashFromInvesting),
    cashFromFinancing: safeNumber(p.cashFromFinancing),
    netCashFlow: safeNumber(p.netCashFlow),
    capex: safeNumber(p.capex),
    proceedsFromBorrowings: safeNumber(p.proceedsFromBorrowings),
    repaymentsOfBorrowings: safeNumber(p.repaymentsOfBorrowings),
    dividendsPaid: safeNumber(p.dividendsPaid),
    interestPaid: safeNumber(p.interestPaid),
    fcf: safeNumber(fcf),

    // Per Share — bounded to Decimal(10,4) (6 int digits); faceValue sanitised
    basicEps: boundDerived(decimalPerShare(p.basicEps), 6, "basicEps", tag),
    dilutedEps: boundDerived(decimalPerShare(p.dilutedEps), 6, "dilutedEps", tag),
    faceValueShare: decimalPerShare(faceValueSane),
    paidUpEquityCapital: safeNumber(p.paidUpEquityCapital),

    // Derived — ratio/pct columns are Decimal(8,4) (4 int digits); per-share &
    // turnover columns Decimal(10,4) (6); receivablesDays Decimal(10,2) (8).
    // bound* clamps a corrupt-input blowup to null rather than rejecting the row.
    ebitda: safeNumber(ebitda),
    netMargin: boundDerived(decimalPct(netMargin), 4, "netMargin", tag),
    operatingMargin: boundDerived(decimalPct(operatingMargin), 4, "operatingMargin", tag),
    netWorth: safeNumber(netWorth),
    bookValuePerShare: boundDerived(decimalPerShare(bookValuePerShare), 6, "bookValuePerShare", tag),
    debtToEquity: boundDerived(decimalPct(debtToEquity !== null ? debtToEquity * 100 : null), 4, "debtToEquity", tag), // store as percent
    roe: boundDerived(decimalPct(roe), 4, "roe", tag),
    roce: boundDerived(decimalPct(roce), 4, "roce", tag),
    interestCoverage: boundDerived(decimalPerShare(interestCoverage), 6, "interestCoverage", tag),
    receivablesDays: boundDerived(safeNumber(receivablesDays, 2), 8, "receivablesDays", tag),
    inventoryTurnover: boundDerived(decimalPerShare(inventoryTurnover), 6, "inventoryTurnover", tag),
    assetTurnover: boundDerived(decimalPerShare(assetTurnover), 6, "assetTurnover", tag),

    revenueGrowthYoy: boundDerived(decimalPct(revenueGrowthYoy), 4, "revenueGrowthYoy", tag),
    profitGrowthYoy: boundDerived(decimalPct(profitGrowthYoy), 4, "profitGrowthYoy", tag),
    epsGrowthYoy: boundDerived(decimalPct(epsGrowthYoy), 4, "epsGrowthYoy", tag),
  };

  const row = await prisma.fundamental.upsert({
    where: {
      stockId_fiscalYear_resultType: {
        stockId,
        fiscalYear: p.fiscalYear,
        resultType: p.resultType,
      },
    },
    create: data,
    update: data,
  });

  return {
    status: decision === "refresh" ? "refreshed" : "success",
    rowId: row.id,
  };
}
