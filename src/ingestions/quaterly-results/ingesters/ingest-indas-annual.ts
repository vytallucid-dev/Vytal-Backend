// File: src/ingestions/quaterly-results/ingesters/ingest-indas-annual.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedIndAsAnnual } from "../xbrl/parser-indas.js";
import {
  safeNumber,
  decimalPerShare,
  decrementFY,
} from "../ingester-utils.js";
import { reportIngestionError } from "../../shared/ingestion-error.js";
import {
  RESULTS_CRON,
  RESULTS_SOURCE,
  SCALE_CEIL_CR,
  BS_IMBALANCE_MAX,
  REVENUE_YOY_MAX_PCT,
  checkPlContentless,
  checkScale,
  checkRevenueNonPositive,
  checkBsImbalance,
  checkRevenueYoyAnomaly,
  resultsRunRef,
} from "../fundamentals-guards.js";
import {
  deriveIndAsAnnual,
  plausibleFaceValue,
  boundDerived,
} from "../derive/derive-indas-annual.js";

export interface IngestIndAsAnnualInput {
  stockId: string;
  parsed: ParsedIndAsAnnual;
  source: string;
}

export async function ingestIndAsAnnual(
  input: IngestIndAsAnnualInput,
  decision: "ingest" | "refresh",
): Promise<{ status: "success" | "refreshed" | "rejected"; rowId: string }> {
  const { stockId, parsed, source } = input;
  const p = parsed;
  const tag = `${p.fiscalYear}/${p.resultType} stock=${stockId.slice(0, 8)}`;
  const entity = `${stockId}@${p.fiscalYear}@${p.resultType}`;
  const runRef = resultsRunRef(`Y-${p.fiscalYear}`);

  // ── GUARD 1: SHAPE / P&L content (critical · source_code · REJECT) ──
  // Runs on EVERY upsert (ingest + refresh) to protect existing rows from
  // being overwritten by a contentless parse.
  if (checkPlContentless(p.revenue, p.netProfit)) {
    await reportIngestionError({
      source: RESULTS_SOURCE,
      cron: RESULTS_CRON,
      guardType: "shape",
      targetTable: "Fundamental",
      targetEntity: entity,
      severity: "critical",
      resolutionPath: "source_code",
      expected: "revenue or netProfit present",
      observed: "both null (no P&L content)",
      detail:
        "Annual P&L tags did not resolve (likely an XBRL tag rename) — rejecting the upsert to preserve any existing row.",
      runRef,
    });
    return { status: "rejected", rowId: "" };
  }
  // Sanitised face value — corrupt source (e.g. 44539 where the real value is 10)
  // would otherwise compute a nonsensical bookValuePerShare and reject the row.
  const faceValueSane = plausibleFaceValue(p.faceValueShare);
  if (faceValueSane === null && p.faceValueShare !== null) {
    console.warn(`[ingest-indas-annual] ${tag}: implausible faceValueShare=${p.faceValueShare} → treated as null.`);
  }

  // ── Prior-year row (for ROE averaging + YoY growth) ──
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
    },
  });

  // ── Derive every stored ratio column — SINGLE PATH (ingestion ≡ fill).
  // deriveIndAsAnnual is a verbatim extraction of the former inline block;
  // the raw-field fill calls the exact same function on the stored row. ──
  const derived = deriveIndAsAnnual(
    {
      revenue: p.revenue,
      netProfit: p.netProfit,
      financeCosts: p.financeCosts,
      depreciation: p.depreciation,
      profitBeforeTax: p.profitBeforeTax,
      equityShareCapital: p.equityShareCapital,
      otherEquity: p.otherEquity,
      totalEquity: p.totalEquity,
      equityAttributableToOwners: p.equityAttributableToOwners,
      borrowingsCurrent: p.borrowingsCurrent,
      borrowingsNoncurrent: p.borrowingsNoncurrent,
      cashFromOperating: p.cashFromOperating,
      capex: p.capex,
      paidUpEquityCapital: p.paidUpEquityCapital,
      faceValueShareSane: faceValueSane,
      tradeReceivablesCurrent: p.tradeReceivablesCurrent,
      tradeReceivablesNoncurrent: p.tradeReceivablesNoncurrent,
      inventories: p.inventories,
      totalAssets: p.totalAssets,
      basicEps: p.basicEps,
    },
    priorRow
      ? {
          revenue: priorRow.revenue?.toNumber() ?? null,
          netProfit: priorRow.netProfit?.toNumber() ?? null,
          basicEps: priorRow.basicEps?.toNumber() ?? null,
          totalEquity: priorRow.totalEquity?.toNumber() ?? null,
          equityAttributableToOwners:
            priorRow.equityAttributableToOwners?.toNumber() ?? null,
          equityShareCapital: priorRow.equityShareCapital?.toNumber() ?? null,
          otherEquity: priorRow.otherEquity?.toNumber() ?? null,
        }
      : null,
    tag,
  );
  // The CONTINUITY guard reads the pre-Decimal revenue-YoY number.
  const revenueGrowthYoy = derived.numbers.revenueGrowthYoy;

  // ── Per-record FLAG guards — only on genuinely-NEW periods (ingest),
  // not refreshes, so re-scanning a season never re-flags history. ──
  if (decision === "ingest") {
    // GUARD 4: RANGE / scale (the ÷1e7 unit break) on the big line items.
    const scaleHits = (
      [
        ["revenue", p.revenue],
        ["netProfit", p.netProfit],
        ["totalAssets", p.totalAssets],
      ] as const
    ).filter(([, v]) => checkScale(v));
    if (scaleHits.length > 0) {
      await reportIngestionError({
        source: RESULTS_SOURCE,
        cron: RESULTS_CRON,
        guardType: "range",
        targetTable: "Fundamental",
        targetField: "scale",
        targetEntity: entity,
        severity: "medium",
        resolutionPath: "source_code",
        expected: `|line item| ≤ ${SCALE_CEIL_CR} ₹Cr`,
        observed: scaleHits.map(([k, v]) => `${k}=${v}`).join(", "),
        detail: "Line item far beyond plausible ₹Cr — likely a unit-scale (÷1e7) parse break.",
        runRef,
      });
    }
    if (checkRevenueNonPositive(p.revenue)) {
      await reportIngestionError({
        source: RESULTS_SOURCE,
        cron: RESULTS_CRON,
        guardType: "range",
        targetTable: "Fundamental",
        targetField: "revenue",
        targetEntity: entity,
        severity: "medium",
        resolutionPath: "admin_fill",
        expected: "revenue > 0",
        observed: `revenue=${p.revenue}`,
        detail: "Non-positive revenue — verify against source.",
        runRef,
      });
    }
    // GUARD 4: BALANCE-SHEET identity — CONDITIONAL. Only fires when all
    // four lines are present; a NULL balance sheet (24.4% of rows) is
    // normal and never flagged here.
    const bsImbalance = checkBsImbalance({
      totalAssets: p.totalAssets,
      totalEquity: p.totalEquity,
      currentLiabilities: p.currentLiabilities,
      noncurrentLiabilities: p.noncurrentLiabilities,
    });
    if (bsImbalance != null) {
      await reportIngestionError({
        source: RESULTS_SOURCE,
        cron: RESULTS_CRON,
        guardType: "range",
        targetTable: "Fundamental",
        targetField: "balanceSheet",
        targetEntity: entity,
        severity: "medium",
        resolutionPath: "source_code",
        expected: `|assets − (equity+curLiab+noncurLiab)| / assets ≤ ${(BS_IMBALANCE_MAX * 100).toFixed(0)}%`,
        observed: `${(bsImbalance * 100).toFixed(1)}% off (assets=${p.totalAssets}, equity=${p.totalEquity}, curLiab=${p.currentLiabilities}, noncurLiab=${p.noncurrentLiabilities})`,
        detail: "Balance sheet doesn't balance — a major BS line was mis-parsed.",
        runRef,
      });
    }
    // GUARD 5: CONTINUITY — revenue YoY anomaly (NOT profit YoY).
    if (checkRevenueYoyAnomaly(revenueGrowthYoy)) {
      await reportIngestionError({
        source: RESULTS_SOURCE,
        cron: RESULTS_CRON,
        guardType: "continuity",
        targetTable: "Fundamental",
        targetField: "revenueGrowthYoy",
        targetEntity: entity,
        severity: "low",
        resolutionPath: "source_code",
        expected: `|revenue YoY| ≤ ${REVENUE_YOY_MAX_PCT}% (max real 238%)`,
        observed: `revenueGrowthYoy=${revenueGrowthYoy?.toFixed(0)}%`,
        detail: "Revenue YoY beyond the sticky band — per-period scale break or real anomaly; eyeball.",
        runRef,
      });
    }
  }

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

    // Per Share — bounded to Decimal(10,4) (6 int digits); faceValue sanitised
    basicEps: boundDerived(decimalPerShare(p.basicEps), 6, "basicEps", tag),
    dilutedEps: boundDerived(decimalPerShare(p.dilutedEps), 6, "dilutedEps", tag),
    faceValueShare: decimalPerShare(faceValueSane),
    paidUpEquityCapital: safeNumber(p.paidUpEquityCapital),

    // Derived — the 17 computed ratio/total columns (totalDebt, fcf, ebitda,
    // netWorth, margins, bvps, D/E, roe, roce, coverage, turnover, YoY) all come
    // from the single deriveIndAsAnnual path so ingestion ≡ fill, byte-for-byte.
    ...derived.columns,
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
