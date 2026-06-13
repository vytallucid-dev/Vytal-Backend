// File: src/ingestions/quaterly-results/ingesters/ingest-li-quarterly.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedLifeInsuranceQuarterly } from "../xbrl/parser-li.js";
import {
  safeNumber,
  decimalPct,
  decimalRatio,
  decrementFY,
  pctChange,
  getPriorQuarter,
} from "../ingester-utils.js";

export async function ingestLifeInsuranceQuarterly(
  input: {
    stockId: string;
    parsed: ParsedLifeInsuranceQuarterly;
    source: string;
  },
  decision: "ingest" | "refresh",
): Promise<{ status: "success" | "refreshed"; rowId: string }> {
  const { stockId, parsed: p, source } = input;

  // Derived
  const newBusinessPremiumPct =
    p.incomeFirstYearPremium !== null &&
    p.grossPremiumIncome !== null &&
    p.grossPremiumIncome !== 0
      ? p.incomeFirstYearPremium / p.grossPremiumIncome
      : null;

  const expenseRatio =
    p.totalOperatingExpenses !== null &&
    p.grossPremiumIncome !== null &&
    p.grossPremiumIncome !== 0
      ? p.totalOperatingExpenses / p.grossPremiumIncome
      : null;

  const netMargin =
    p.netProfit !== null &&
    p.totalRevenuePolicyholders !== null &&
    p.totalRevenuePolicyholders !== 0
      ? (p.netProfit / p.totalRevenuePolicyholders) * 100
      : null;

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

  const premiumQoq = pctChange(
    p.grossPremiumIncome,
    priorRow?.grossPremiumIncome?.toNumber() ?? null,
  );
  const premiumYoy = pctChange(
    p.grossPremiumIncome,
    yearAgoRow?.grossPremiumIncome?.toNumber() ?? null,
  );
  const patQoq = pctChange(
    p.netProfit,
    priorRow?.netProfit?.toNumber() ?? null,
  );
  const patYoy = pctChange(
    p.netProfit,
    yearAgoRow?.netProfit?.toNumber() ?? null,
  );

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

    newBusinessPremiumPct: decimalRatio(newBusinessPremiumPct),
    expenseRatioPolicyholders: decimalRatio(expenseRatio),
    netMargin: decimalPct(netMargin),

    premiumQoq: decimalPct(premiumQoq),
    premiumYoy: decimalPct(premiumYoy),
    patQoq: decimalPct(patQoq),
    patYoy: decimalPct(patYoy),
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
