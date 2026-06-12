// File: src/ingestions/quaterly-results/ingesters/ingest-nbfc-quarterly.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedNbfcQuarterly } from "../xbrl/parser-nbfc.js";
import {
  safeNumber,
  decimalPct,
  decrementFY,
  pctChange,
  getPriorQuarter,
} from "../ingester-utils.js";

export async function ingestNbfcQuarterly(
  input: { stockId: string; parsed: ParsedNbfcQuarterly; source: string },
  decision: "ingest" | "upgrade" | "refresh",
): Promise<{ status: "success" | "upgraded" | "refreshed"; rowId: string }> {
  const { stockId, parsed: p, source } = input;

  const nii =
    p.interestIncome !== null && p.financeCosts !== null
      ? p.interestIncome - p.financeCosts
      : null;
  const netMargin =
    p.netProfit !== null && p.totalIncome !== null && p.totalIncome !== 0
      ? (p.netProfit / p.totalIncome) * 100
      : null;

  const priorQ = getPriorQuarter(p.quarter, p.fiscalYear);
  const priorRow = priorQ
    ? await prisma.nbfcQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear: {
            stockId,
            quarter: priorQ.quarter,
            fiscalYear: priorQ.fiscalYear,
          },
        },
        select: { revenue: true, netProfit: true },
      })
    : null;

  const yearAgoFY = decrementFY(p.fiscalYear);
  const yearAgoRow = await prisma.nbfcQuarterlyResult.findUnique({
    where: {
      stockId_quarter_fiscalYear: {
        stockId,
        quarter: p.quarter,
        fiscalYear: yearAgoFY,
      },
    },
    select: { revenue: true, netProfit: true },
  });

  const revenueQoq = pctChange(
    p.revenue,
    priorRow?.revenue?.toNumber() ?? null,
  );
  const revenueYoy = pctChange(
    p.revenue,
    yearAgoRow?.revenue?.toNumber() ?? null,
  );
  const patQoq = pctChange(
    p.netProfit,
    priorRow?.netProfit?.toNumber() ?? null,
  );
  const patYoy = pctChange(
    p.netProfit,
    yearAgoRow?.netProfit?.toNumber() ?? null,
  );

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

    nii: safeNumber(nii),
    netMargin: decimalPct(netMargin),

    revenueQoq: decimalPct(revenueQoq),
    revenueYoy: decimalPct(revenueYoy),
    patQoq: decimalPct(patQoq),
    patYoy: decimalPct(patYoy),
  };

  const row = await prisma.nbfcQuarterlyResult.upsert({
    where: {
      stockId_quarter_fiscalYear: {
        stockId,
        quarter: p.quarter,
        fiscalYear: p.fiscalYear,
      },
    },
    create: data,
    update: data,
  });

  return {
    status:
      decision === "upgrade"
        ? "upgraded"
        : decision === "refresh"
          ? "refreshed"
          : "success",
    rowId: row.id,
  };
}
