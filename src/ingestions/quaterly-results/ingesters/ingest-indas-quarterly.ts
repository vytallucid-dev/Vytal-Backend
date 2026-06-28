// File: src/ingestions/quaterly-results/ingesters/ingest-indas-quarterly.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedIndAsQuarterly } from "../xbrl/parser-indas.js";
import { safeNumber, getPriorQuarter } from "../ingester-utils.js";
import { deriveIndAsQuarterly } from "../derive/derive-indas-quarterly.js";
import { reportIngestionError } from "../../shared/ingestion-error.js";
import {
  RESULTS_CRON,
  RESULTS_SOURCE,
  SCALE_CEIL_CR,
  REVENUE_YOY_MAX_PCT,
  checkPlContentless,
  checkScale,
  checkRevenueNonPositive,
  checkRevenueYoyAnomaly,
  resultsRunRef,
} from "../fundamentals-guards.js";

export interface IngestIndAsQuarterlyInput {
  stockId: string;
  parsed: ParsedIndAsQuarterly;
  source: string; // "nse_xbrl_quarterly" | "nse_xbrl_quarterly_legacy"
}

export interface IngestIndAsQuarterlyResult {
  status: "success" | "refreshed" | "rejected";
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
  const entity = `${stockId}@${parsed.quarter}-${parsed.fiscalYear}@${parsed.resultType}`;
  const runRef = resultsRunRef(`${parsed.quarter}-${parsed.fiscalYear}`);

  // ── GUARD 1: SHAPE / P&L content (critical · source_code · REJECT) ──
  // Runs on EVERY upsert (ingest + refresh): a contentless parse must not
  // overwrite a good existing row. Both core P&L lines null ⇒ the tags
  // didn't resolve (rename) — reject, don't store.
  if (checkPlContentless(parsed.revenue, parsed.netProfit)) {
    await reportIngestionError({
      source: RESULTS_SOURCE,
      cron: RESULTS_CRON,
      guardType: "shape",
      targetTable: "QuarterlyResult",
      targetEntity: entity,
      severity: "critical",
      resolutionPath: "source_code",
      expected: "revenue or netProfit present",
      observed: "both null (no P&L content)",
      detail:
        "Quarterly P&L tags did not resolve (likely an XBRL tag rename) — rejecting the upsert to preserve any existing row.",
      runRef,
    });
    return { status: "rejected", rowId: "" };
  }

  // ── Prior-period rows (QoQ = prior quarter; YoY = year-ago quarter) ──
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

  // ── Derive all 6 stored columns — SINGLE PATH (ingestion ≡ fill).
  // deriveIndAsQuarterly is a verbatim extraction; the raw-field fill calls
  // the exact same function on the stored row. ──
  const derived = deriveIndAsQuarterly(
    {
      revenue: parsed.revenue,
      netProfit: parsed.netProfit,
      operatingProfit: parsed.operatingProfit,
    },
    priorRow
      ? {
          revenue: priorRow.revenue?.toNumber() ?? null,
          netProfit: priorRow.netProfit?.toNumber() ?? null,
        }
      : null,
    yearAgoRow
      ? {
          revenue: yearAgoRow.revenue?.toNumber() ?? null,
          netProfit: yearAgoRow.netProfit?.toNumber() ?? null,
        }
      : null,
  );
  // The CONTINUITY guard reads the pre-Decimal revenue-YoY number.
  const revenueYoy = derived.numbers.revenueYoy;

  // ── Per-record FLAG guards — only on genuinely-NEW periods (not a
  // refresh of existing), so re-scanning a season never re-flags history. ──
  if (decision === "ingest") {
    // GUARD 4: RANGE / scale (the ÷1e7 unit break) + validity.
    const scaleHits = (
      [
        ["revenue", parsed.revenue],
        ["netProfit", parsed.netProfit],
      ] as const
    ).filter(([, v]) => checkScale(v));
    if (scaleHits.length > 0) {
      await reportIngestionError({
        source: RESULTS_SOURCE,
        cron: RESULTS_CRON,
        guardType: "range",
        targetTable: "QuarterlyResult",
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
    if (checkRevenueNonPositive(parsed.revenue)) {
      await reportIngestionError({
        source: RESULTS_SOURCE,
        cron: RESULTS_CRON,
        guardType: "range",
        targetTable: "QuarterlyResult",
        targetField: "revenue",
        targetEntity: entity,
        severity: "medium",
        resolutionPath: "admin_fill",
        expected: "revenue > 0",
        observed: `revenue=${parsed.revenue}`,
        detail: "Non-positive revenue — verify against source.",
        runRef,
      });
    }
    // GUARD 5: CONTINUITY — revenue YoY anomaly (NOT profit YoY).
    if (checkRevenueYoyAnomaly(revenueYoy)) {
      await reportIngestionError({
        source: RESULTS_SOURCE,
        cron: RESULTS_CRON,
        guardType: "continuity",
        targetTable: "QuarterlyResult",
        targetField: "revenueYoy",
        targetEntity: entity,
        severity: "low",
        resolutionPath: "source_code",
        expected: `|revenue YoY| ≤ ${REVENUE_YOY_MAX_PCT}% (max real 238%)`,
        observed: `revenueYoy=${revenueYoy?.toFixed(0)}%`,
        detail: "Revenue YoY beyond the sticky band — per-period scale break or real anomaly; eyeball.",
        runRef,
      });
    }
  }

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

    // Derived — the 6 computed columns (margins + QoQ/YoY) all come from the
    // single deriveIndAsQuarterly path so ingestion ≡ fill.
    ...derived.columns,
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
