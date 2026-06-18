// File: src/scoring/metrics/load.ts
//
// STANDALONE loader for the metric raw-value layer. This is the ONLY DB-touching
// file here: it SELECTs resultType="standalone" rows and normalizes Decimal→number
// into the pure-compute input shapes. It NEVER reads consolidated — a missing
// standalone period simply means fewer rows, which the pure functions surface as
// UNAVAILABLE (standalone_absent / insufficient_history). Decimals are converted
// with `.toNumber()`; nulls preserved.

import { prisma } from "../../db/prisma.js";
import {
  fyOrdinal,
  quarterOrdinal,
  type FoundationAnnual,
  type MomentumQuarter,
} from "./types.js";

const n = (d: { toNumber: () => number } | null): number | null => (d === null ? null : d.toNumber());

/** Resolve a symbol → stockId (null if unknown). */
export async function resolveStockId(symbol: string): Promise<string | null> {
  const s = await prisma.stock.findFirst({ where: { symbol }, select: { id: true } });
  return s?.id ?? null;
}

/** Load all STANDALONE annual fundamentals for a stock, normalized + sorted asc. */
export async function loadFoundationStandalone(stockId: string): Promise<FoundationAnnual[]> {
  const rows = await prisma.fundamental.findMany({
    where: { stockId, resultType: "standalone" },
    orderBy: { fiscalYear: "asc" },
  });
  return rows.map((r) => ({
    fiscalYear: r.fiscalYear,
    fyOrdinal: fyOrdinal(r.fiscalYear),
    revenue: n(r.revenue),
    otherIncome: n(r.otherIncome),
    financeCosts: n(r.financeCosts),
    depreciation: n(r.depreciation),
    profitBeforeTax: n(r.profitBeforeTax),
    netProfit: n(r.netProfit),
    equityShareCapital: n(r.equityShareCapital),
    otherEquity: n(r.otherEquity),
    totalEquity: n(r.totalEquity),
    borrowingsCurrent: n(r.borrowingsCurrent),
    borrowingsNoncurrent: n(r.borrowingsNoncurrent),
    totalDebtStored: n(r.totalDebt),
    totalAssets: n(r.totalAssets),
    currentLiabilities: n(r.currentLiabilities),
    tradeReceivablesCurrent: n(r.tradeReceivablesCurrent),
    tradeReceivablesNoncurrent: n(r.tradeReceivablesNoncurrent),
    propertyPlantAndEquipment: n(r.propertyPlantAndEquipment),
    capitalWorkInProgress: n(r.capitalWorkInProgress),
    cashFromOperating: n(r.cashFromOperating),
    capex: n(r.capex),
    cashFromFinancing: n(r.cashFromFinancing),
    faceValueShare: n(r.faceValueShare),
    stored: {
      roce: n(r.roce),
      roe: n(r.roe),
      debtToEquity: n(r.debtToEquity),
      interestCoverage: n(r.interestCoverage),
      receivablesDays: n(r.receivablesDays),
      assetTurnover: n(r.assetTurnover),
      netWorth: n(r.netWorth),
      operatingMargin: n(r.operatingMargin),
      ebitda: n(r.ebitda),
    },
  }));
}

/** Load all STANDALONE quarterly results for a stock, normalized + sorted asc. */
export async function loadMomentumStandalone(stockId: string): Promise<MomentumQuarter[]> {
  const rows = await prisma.quarterlyResult.findMany({
    where: { stockId, resultType: "standalone" },
    orderBy: [{ fiscalYear: "asc" }, { quarter: "asc" }],
  });
  return rows.map((r) => ({
    fiscalYear: r.fiscalYear,
    quarter: r.quarter,
    qOrdinal: quarterOrdinal(r.fiscalYear, r.quarter),
    revenue: n(r.revenue),
    otherIncome: n(r.otherIncome),
    interest: n(r.interest),
    depreciation: n(r.depreciation),
    profitBeforeTax: n(r.profitBeforeTax),
    netProfit: n(r.netProfit),
    operatingProfitStored: n(r.operatingProfit),
  }));
}

/** Diagnostic: count rows per basis (to show standalone gaps in the harness). */
export async function basisCounts(stockId: string): Promise<{
  fundamentals: Record<string, number>;
  quarterly: Record<string, number>;
}> {
  const [f, q] = await Promise.all([
    prisma.fundamental.groupBy({ by: ["resultType"], where: { stockId }, _count: { _all: true } }),
    prisma.quarterlyResult.groupBy({ by: ["resultType"], where: { stockId }, _count: { _all: true } }),
  ]);
  const toMap = (g: { resultType: string; _count: { _all: number } }[]) =>
    Object.fromEntries(g.map((x) => [x.resultType, x._count._all]));
  return { fundamentals: toMap(f), quarterly: toMap(q) };
}
