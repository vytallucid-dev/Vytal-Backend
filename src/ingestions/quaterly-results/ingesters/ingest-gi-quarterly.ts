// File: src/ingestions/quaterly-results/ingesters/ingest-gi-quarterly.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedGeneralInsuranceQuarterly } from "../xbrl/parser-gi.js";
import {
  safeNumber,
  decimalPct,
  decimalRatio,
  decrementFY,
  pctChange,
  getPriorQuarter,
} from "../ingester-utils.js";

export async function ingestGeneralInsuranceQuarterly(
  input: {
    stockId: string;
    parsed: ParsedGeneralInsuranceQuarterly;
    source: string;
  },
  decision: "ingest" | "refresh",
): Promise<{ status: "success" | "refreshed"; rowId: string }> {
  const { stockId, parsed: p, source } = input;

  const netUnderwritingMargin =
    p.combinedRatio !== null ? 1 - p.combinedRatio : null;
  const netMargin =
    p.netProfit !== null && p.totalRevenue !== null && p.totalRevenue !== 0
      ? (p.netProfit / p.totalRevenue) * 100
      : null;

  const priorQ = getPriorQuarter(p.quarter, p.fiscalYear);
  const priorRow = priorQ
    ? await prisma.generalInsuranceQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear_resultType: {
            stockId,
            quarter: priorQ.quarter,
            fiscalYear: priorQ.fiscalYear,
            resultType: p.resultType, // compare same basis
          },
        },
        select: { grossPremiumsWritten: true, netProfit: true },
      })
    : null;
  const yearAgoFY = decrementFY(p.fiscalYear);
  const yearAgoRow = await prisma.generalInsuranceQuarterlyResult.findUnique({
    where: {
      stockId_quarter_fiscalYear_resultType: {
        stockId,
        quarter: p.quarter,
        fiscalYear: yearAgoFY,
        resultType: p.resultType, // compare same basis
      },
    },
    select: { grossPremiumsWritten: true, netProfit: true },
  });

  const gpwQoq = pctChange(
    p.grossPremiumsWritten,
    priorRow?.grossPremiumsWritten?.toNumber() ?? null,
  );
  const gpwYoy = pctChange(
    p.grossPremiumsWritten,
    yearAgoRow?.grossPremiumsWritten?.toNumber() ?? null,
  );
  const patQoq = pctChange(
    p.netProfit,
    priorRow?.netProfit?.toNumber() ?? null,
  );
  const patYoy = pctChange(
    p.netProfit,
    yearAgoRow?.netProfit?.toNumber() ?? null,
  );

  const data: Prisma.GeneralInsuranceQuarterlyResultUpsertArgs["create"] = {
    stockId,
    quarter: p.quarter,
    fiscalYear: p.fiscalYear,
    reportDate: p.reportDate,
    filingDate: p.filingDate,
    xbrlUrl: p.xbrlUrl,
    resultType: p.resultType,
    source,
    xbrlTaxonomy: "in_capmkt",

    grossPremiumsWritten: safeNumber(p.grossPremiumsWritten),
    netPremiumWritten: safeNumber(p.netPremiumWritten),
    netPremium: safeNumber(p.netPremium),
    premiumEarned: safeNumber(p.premiumEarned),

    incomeFromInvestments: safeNumber(p.incomeFromInvestments),
    otherIncome: safeNumber(p.otherIncome),
    totalRevenue: safeNumber(p.totalRevenue),

    claimsPaid: safeNumber(p.claimsPaid),
    incurredClaims: safeNumber(p.incurredClaims),
    netCommission: safeNumber(p.netCommission),
    totalOperatingExpensesRelatedToInsurance: safeNumber(
      p.totalOperatingExpensesRelatedToInsurance,
    ),

    underwritingProfitOrLoss: safeNumber(p.underwritingProfitOrLoss),

    profitBeforeTax: safeNumber(p.profitBeforeTax),
    tax: safeNumber(p.tax),
    netProfit: safeNumber(p.netProfit),

    combinedRatio: decimalRatio(p.combinedRatio),
    incurredClaimRatio: decimalRatio(p.incurredClaimRatio),
    expensesOfManagementRatio: decimalRatio(p.expensesOfManagementRatio),
    netRetentionRatio: decimalRatio(p.netRetentionRatio),
    solvencyRatio: safeNumber(p.solvencyRatio, 4),

    netUnderwritingMargin: decimalRatio(netUnderwritingMargin),
    netMargin: decimalPct(netMargin),

    gpwQoq: decimalPct(gpwQoq),
    gpwYoy: decimalPct(gpwYoy),
    patQoq: decimalPct(patQoq),
    patYoy: decimalPct(patYoy),
  };

  const row = await prisma.generalInsuranceQuarterlyResult.upsert({
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
  };
}
