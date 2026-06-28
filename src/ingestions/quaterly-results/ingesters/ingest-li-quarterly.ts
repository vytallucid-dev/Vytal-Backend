// File: src/ingestions/quaterly-results/ingesters/ingest-li-quarterly.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedLifeInsuranceQuarterly } from "../xbrl/parser-li.js";
import {
  safeNumber,
  decimalRatio,
  decrementFY,
  getPriorQuarter,
} from "../ingester-utils.js";
import {
  financialShapeReject,
  financialRecordGuards,
  resultsRunRef,
} from "../financial-guards.js";
import { deriveLiQuarterly } from "../derive/derive-financial-quarterly.js";

export async function ingestLifeInsuranceQuarterly(
  input: {
    stockId: string;
    parsed: ParsedLifeInsuranceQuarterly;
    source: string;
  },
  decision: "ingest" | "refresh",
): Promise<{ status: "success" | "refreshed" | "rejected"; rowId: string }> {
  const { stockId, parsed: p, source } = input;
  const entity = `${stockId}@${p.quarter}-${p.fiscalYear}@${p.resultType}`;
  const runRef = resultsRunRef(`${p.quarter}-${p.fiscalYear}`);
  if (
    await financialShapeReject({
      table: "LifeInsuranceQuarterlyResult",
      entity,
      runRef,
      coreA: p.grossPremiumIncome,
      coreB: p.netProfit,
      coreLabel: "grossPremiumIncome or netProfit",
    })
  ) {
    return { status: "rejected", rowId: "" };
  }

  // ── Prior-quarter (QoQ) + year-ago-quarter (YoY) rows ──
  const priorQ = getPriorQuarter(p.quarter, p.fiscalYear);
  const priorRow = priorQ
    ? await prisma.lifeInsuranceQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear_resultType: {
            stockId,
            quarter: priorQ.quarter,
            fiscalYear: priorQ.fiscalYear,
            resultType: p.resultType, // compare same basis
          },
        },
        select: { grossPremiumIncome: true, netProfit: true },
      })
    : null;
  const yearAgoFY = decrementFY(p.fiscalYear);
  const yearAgoRow = await prisma.lifeInsuranceQuarterlyResult.findUnique({
    where: {
      stockId_quarter_fiscalYear_resultType: {
        stockId,
        quarter: p.quarter,
        fiscalYear: yearAgoFY,
        resultType: p.resultType, // compare same basis
      },
    },
    select: { grossPremiumIncome: true, netProfit: true },
  });

  // ── Derive 7 stored columns — SINGLE PATH (ingestion ≡ fill). ──
  const derived = deriveLiQuarterly(
    {
      incomeFirstYearPremium: p.incomeFirstYearPremium,
      grossPremiumIncome: p.grossPremiumIncome,
      totalOperatingExpenses: p.totalOperatingExpenses,
      netProfit: p.netProfit,
      totalRevenuePolicyholders: p.totalRevenuePolicyholders,
    },
    priorRow ? { grossPremiumIncome: priorRow.grossPremiumIncome?.toNumber() ?? null, netProfit: priorRow.netProfit?.toNumber() ?? null } : null,
    yearAgoRow ? { grossPremiumIncome: yearAgoRow.grossPremiumIncome?.toNumber() ?? null, netProfit: yearAgoRow.netProfit?.toNumber() ?? null } : null,
  );
  const premiumYoy = derived.numbers.premiumYoy;

  if (decision === "ingest") {
    await financialRecordGuards({
      table: "LifeInsuranceQuarterlyResult",
      entity,
      runRef,
      scale: [["grossPremiumIncome", p.grossPremiumIncome]],
      yoy: premiumYoy,
      yoyLabel: "premiumYoy",
      solvency: p.solvencyRatio,
    });
  }

  const data: Prisma.LifeInsuranceQuarterlyResultUpsertArgs["create"] = {
    stockId,
    quarter: p.quarter,
    fiscalYear: p.fiscalYear,
    reportDate: p.reportDate,
    filingDate: p.filingDate,
    xbrlUrl: p.xbrlUrl,
    resultType: p.resultType,
    source,
    xbrlTaxonomy: "in_capmkt",

    grossPremiumIncome: safeNumber(p.grossPremiumIncome),
    netPremiumIncome: safeNumber(p.netPremiumIncome),
    incomeFirstYearPremium: safeNumber(p.incomeFirstYearPremium),
    incomeRenewalPremium: safeNumber(p.incomeRenewalPremium),
    incomeSinglePremium: safeNumber(p.incomeSinglePremium),
    reinsuranceCeded: safeNumber(p.reinsuranceCeded),
    incomeFromInvestments: safeNumber(p.incomeFromInvestments),
    totalRevenuePolicyholders: safeNumber(p.totalRevenuePolicyholders),

    totalCommission: safeNumber(p.totalCommission),
    totalOperatingExpenses: safeNumber(p.totalOperatingExpenses),

    benefitsPaidNet: safeNumber(p.benefitsPaidNet),
    changeInValuationOfLiabilities: safeNumber(
      p.changeInValuationOfLiabilities,
    ),

    profitBeforeTax: safeNumber(p.profitBeforeTax),
    tax: safeNumber(p.tax),
    netProfit: safeNumber(p.netProfit),

    solvencyRatio: safeNumber(p.solvencyRatio, 4),
    persistencyRatio13Month: decimalRatio(p.persistencyRatio13Month),
    persistencyRatio25Month: decimalRatio(p.persistencyRatio25Month),
    persistencyRatio37Month: decimalRatio(p.persistencyRatio37Month),
    persistencyRatio49Month: decimalRatio(p.persistencyRatio49Month),
    persistencyRatio61Month: decimalRatio(p.persistencyRatio61Month),

    // Derived (newBusinessPremiumPct, expenseRatio, netMargin, premium QoQ/YoY,
    // pat QoQ/YoY) from the single deriveLiQuarterly path (ingestion ≡ fill).
    ...derived.columns,
  };

  const row = await prisma.lifeInsuranceQuarterlyResult.upsert({
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
