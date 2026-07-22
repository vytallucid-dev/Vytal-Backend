// File: src/ingestions/quaterly-results/ingesters/ingest-nbfc-quarterly.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { IngestOutcome } from "./dispatch.js";
import type { ParsedNbfcQuarterly } from "../xbrl/parser-nbfc.js";
import {
  safeNumber,
  decrementFY,
  getPriorQuarter,
} from "../ingester-utils.js";
import {
  financialShapeReject,
  financialRecordGuards,
  resultsRunRef,
} from "../financial-guards.js";
import { deriveNbfcQuarterly } from "../derive/derive-financial-quarterly.js";

export async function ingestNbfcQuarterly(
  input: { stockId: string; parsed: ParsedNbfcQuarterly; source: string },
  decision: "ingest" | "refresh",
): Promise<IngestOutcome> {
  const { stockId, parsed: p, source } = input;
  const entity = `${stockId}@${p.quarter}-${p.fiscalYear}@${p.resultType}`;
  const runRef = resultsRunRef(`${p.quarter}-${p.fiscalYear}`);
  if (
    await financialShapeReject({
      table: "NbfcQuarterlyResult",
      entity,
      runRef,
      coreA: p.revenue,
      coreB: p.netProfit,
      coreLabel: "revenue or netProfit",
    })
  ) {
    // REJECTED = the upsert never ran, so nothing was written and nothing could have
    // changed. This is the one honest `false` in this file. The caller maps "rejected"
    // to "skipped" anyway, so it never reached changedSymbols before this change either.
    return { status: "rejected", rowId: "", scoreRelevantChanged: false };
  }

  // ── Prior-quarter (QoQ) + year-ago-quarter (YoY) rows ──
  const priorQ = getPriorQuarter(p.quarter, p.fiscalYear);
  const priorRow = priorQ
    ? await prisma.nbfcQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear_resultType: {
            stockId,
            quarter: priorQ.quarter,
            fiscalYear: priorQ.fiscalYear,
            resultType: p.resultType, // compare same basis
          },
        },
        select: { revenue: true, netProfit: true },
      })
    : null;
  const yearAgoFY = decrementFY(p.fiscalYear);
  const yearAgoRow = await prisma.nbfcQuarterlyResult.findUnique({
    where: {
      stockId_quarter_fiscalYear_resultType: {
        stockId,
        quarter: p.quarter,
        fiscalYear: yearAgoFY,
        resultType: p.resultType, // compare same basis
      },
    },
    select: { revenue: true, netProfit: true },
  });

  // ── Derive 6 stored columns — SINGLE PATH (ingestion ≡ fill). ──
  const derived = deriveNbfcQuarterly(
    {
      interestIncome: p.interestIncome,
      financeCosts: p.financeCosts,
      netProfit: p.netProfit,
      totalIncome: p.totalIncome,
      revenue: p.revenue,
    },
    priorRow ? { revenue: priorRow.revenue?.toNumber() ?? null, netProfit: priorRow.netProfit?.toNumber() ?? null } : null,
    yearAgoRow ? { revenue: yearAgoRow.revenue?.toNumber() ?? null, netProfit: yearAgoRow.netProfit?.toNumber() ?? null } : null,
  );
  const revenueYoy = derived.numbers.revenueYoy;

  if (decision === "ingest") {
    await financialRecordGuards({
      table: "NbfcQuarterlyResult",
      entity,
      runRef,
      scale: [["revenue", p.revenue]],
      yoy: revenueYoy,
      yoyLabel: "revenueYoy",
    });
  }

  const data: Prisma.NbfcQuarterlyResultUpsertArgs["create"] = {
    stockId,
    quarter: p.quarter,
    fiscalYear: p.fiscalYear,
    reportDate: p.reportDate,
    filingDate: p.filingDate,
    xbrlUrl: p.xbrlUrl,
    resultType: p.resultType,
    source,
    xbrlTaxonomy: "in_capmkt",

    revenue: safeNumber(p.revenue),
    interestIncome: safeNumber(p.interestIncome),
    feeAndCommissionIncome: safeNumber(p.feeAndCommissionIncome),
    netGainOnFairValueChanges: safeNumber(p.netGainOnFairValueChanges),
    otherIncome: safeNumber(p.otherIncome),
    totalIncome: safeNumber(p.totalIncome),
    financeCosts: safeNumber(p.financeCosts),
    impairmentOnFinancialInstruments: safeNumber(
      p.impairmentOnFinancialInstruments,
    ),
    employeeBenefitExpense: safeNumber(p.employeeBenefitExpense),
    depreciation: safeNumber(p.depreciation),
    otherExpenses: safeNumber(p.otherExpenses),
    totalExpenses: safeNumber(p.totalExpenses),
    profitBeforeTax: safeNumber(p.profitBeforeTax),
    tax: safeNumber(p.tax),
    netProfit: safeNumber(p.netProfit),

    // Derived (nii, netMargin, revenue QoQ/YoY, pat QoQ/YoY) from the single
    // deriveNbfcQuarterly path (ingestion ≡ fill).
    ...derived.columns,
  };

  const row = await prisma.nbfcQuarterlyResult.upsert({
    where: {
      stockId_quarter_fiscalYear_resultType: {
        stockId,
        quarter: p.quarter,
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
    // CONSERVATIVE: no SCORED peer group reads this taxonomy (PG7 NBFC is gated out of
    // SCORED_PGS; there is no insurance PG), so pgRefsForSymbols drops these symbols anyway.
    // Reporting true costs nothing and can never withhold a real change. If this taxonomy is
    // ever scored, give it a real diff here — do not leave a hardcoded false.
    scoreRelevantChanged: true,
  };
}
