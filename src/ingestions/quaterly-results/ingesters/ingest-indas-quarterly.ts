// File: src/ingestions/quaterly-results/ingesters/ingest-indas-quarterly.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedIndAsQuarterly } from "../xbrl/parser-indas.js";
import {
  safeNumber,
  decimalPct,
  getPriorQuarter,
  pctChange,
} from "../ingester-utils.js";

export interface IngestIndAsQuarterlyInput {
  stockId: string;
  parsed: ParsedIndAsQuarterly;
  source: string; // "nse_xbrl_quarterly" | "nse_xbrl_quarterly_legacy"
}

export interface IngestIndAsQuarterlyResult {
  status: "success" | "refreshed";
  rowId: string;
}

/**
 * Insert or upsert a quarterly_results row for a non-financial stock.
 * Computes derived metrics (margins, QoQ/YoY) using prior-period rows.
 */
export async function ingestIndAsQuarterly(
  input: IngestIndAsQuarterlyInput,
  decision: "ingest" | "refresh",
): Promise<IngestIndAsQuarterlyResult> {
  const { stockId, parsed, source } = input;

  // Derive operating margin and net margin
  const operatingMargin =
    parsed.operatingProfit !== null &&
    parsed.revenue !== null &&
    parsed.revenue !== 0
      ? (parsed.operatingProfit / parsed.revenue) * 100
      : null;
  const netMargin =
    parsed.netProfit !== null && parsed.revenue !== null && parsed.revenue !== 0
      ? (parsed.netProfit / parsed.revenue) * 100
      : null;

  // Look up prior quarter (QoQ) and year-ago quarter (YoY)
  const priorQ = getPriorQuarter(parsed.quarter, parsed.fiscalYear);
  const priorRow = priorQ
    ? await prisma.quarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear_resultType: {
            stockId,
            quarter: priorQ.quarter,
            fiscalYear: priorQ.fiscalYear,
            resultType: parsed.resultType, // compare same basis
          },
        },
        select: { revenue: true, netProfit: true },
      })
    : null;

  const yearAgoFY = decrementFiscalYear(parsed.fiscalYear);
  const yearAgoRow = await prisma.quarterlyResult.findUnique({
    where: {
      stockId_quarter_fiscalYear_resultType: {
        stockId,
        quarter: parsed.quarter,
        fiscalYear: yearAgoFY,
        resultType: parsed.resultType, // compare same basis
      },
    },
    select: { revenue: true, netProfit: true },
  });

  const revenueQoq = pctChange(
    parsed.revenue,
    priorRow?.revenue ? priorRow.revenue.toNumber() : null,
  );
  const revenueYoy = pctChange(
    parsed.revenue,
    yearAgoRow?.revenue ? yearAgoRow.revenue.toNumber() : null,
  );
  const profitQoq = pctChange(
    parsed.netProfit,
    priorRow?.netProfit ? priorRow.netProfit.toNumber() : null,
  );
  const profitYoy = pctChange(
    parsed.netProfit,
    yearAgoRow?.netProfit ? yearAgoRow.netProfit.toNumber() : null,
  );

  const data: Prisma.QuarterlyResultUpsertArgs["create"] = {
    stockId,
    quarter: parsed.quarter,
    fiscalYear: parsed.fiscalYear,
    reportDate: parsed.reportDate,
    filingDate: parsed.filingDate,
    xbrlUrl: parsed.xbrlUrl,
    resultType: parsed.resultType,
    source,
    xbrlTaxonomy: "in_capmkt",

    revenue: safeNumber(parsed.revenue),
    otherIncome: safeNumber(parsed.otherIncome),
    expenses: safeNumber(parsed.expenses),
    depreciation: safeNumber(parsed.depreciation),
    interest: safeNumber(parsed.interest),
    profitBeforeTax: safeNumber(parsed.profitBeforeTax),
    tax: safeNumber(parsed.tax),
    netProfit: safeNumber(parsed.netProfit),
    operatingProfit: safeNumber(parsed.operatingProfit),

    operatingMargin: decimalPct(operatingMargin),
    netMargin: decimalPct(netMargin),

    revenueQoq: decimalPct(revenueQoq),
    revenueYoy: decimalPct(revenueYoy),
    profitQoq: decimalPct(profitQoq),
    profitYoy: decimalPct(profitYoy),
  };

  const row = await prisma.quarterlyResult.upsert({
    where: {
      stockId_quarter_fiscalYear_resultType: {
        stockId,
        quarter: parsed.quarter,
        fiscalYear: parsed.fiscalYear,
        resultType: parsed.resultType,
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

function decrementFiscalYear(fy: string): string {
  const m = fy.match(/^FY(\d{2})$/);
  if (!m) throw new Error(`Invalid FY format: ${fy}`);
  const year = parseInt(m[1], 10);
  const prev = year === 0 ? 99 : year - 1;
  return `FY${String(prev).padStart(2, "0")}`;
}
