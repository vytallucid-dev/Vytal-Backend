// File: src/ingestions/quaterly-results/ingesters/ingest-banking-quarterly.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedBankingQuarterly } from "../xbrl/parser-banking.js";
import {
  safeNumber,
  decimalPct,
  decimalRatio,
  decrementFY,
  pctChange,
  getPriorQuarter,
} from "../ingester-utils.js";

export async function ingestBankingQuarterly(
  input: { stockId: string; parsed: ParsedBankingQuarterly; source: string },
  decision: "ingest" | "upgrade" | "refresh",
): Promise<{ status: "success" | "upgraded" | "refreshed"; rowId: string }> {
  const { stockId, parsed: p, source } = input;

  // ── Derived ──
  const nii =
    p.interestEarned !== null && p.interestExpended !== null
      ? p.interestEarned - p.interestExpended
      : null;
  const totalIncome =
    p.interestEarned !== null && p.otherIncome !== null
      ? p.interestEarned + p.otherIncome
      : null;
  const costToIncomeRatio =
    p.expenditureExclProvisions !== null &&
    totalIncome !== null &&
    totalIncome !== 0
      ? p.expenditureExclProvisions / totalIncome
      : null;
  const netMargin =
    p.netProfit !== null && totalIncome !== null && totalIncome !== 0
      ? (p.netProfit / totalIncome) * 100
      : null;

  // PCR (Provision Coverage Ratio) = 1 - (NNPA / GNPA)
  const pcr =
    !p.auditPending &&
    p.gnpaAbsolute !== null &&
    p.gnpaAbsolute !== 0 &&
    p.nnpaAbsolute !== null
      ? 1 - p.nnpaAbsolute / p.gnpaAbsolute
      : null;

  // Tier1 Ratio = CET1 + AT1
  const tier1Ratio =
    !p.auditPending && p.cet1Ratio !== null && p.additionalTier1Ratio !== null
      ? p.cet1Ratio + p.additionalTier1Ratio
      : null;

  // QoQ / YoY for NII and PAT
  const priorQ = getPriorQuarter(p.quarter, p.fiscalYear);
  const priorRow = priorQ
    ? await prisma.bankingQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear: {
            stockId,
            quarter: priorQ.quarter,
            fiscalYear: priorQ.fiscalYear,
          },
        },
        select: { nii: true, netProfit: true },
      })
    : null;

  const yearAgoFY = decrementFY(p.fiscalYear);
  const yearAgoRow = await prisma.bankingQuarterlyResult.findUnique({
    where: {
      stockId_quarter_fiscalYear: {
        stockId,
        quarter: p.quarter,
        fiscalYear: yearAgoFY,
      },
    },
    select: { nii: true, netProfit: true },
  });

  const niiQoq = pctChange(nii, priorRow?.nii?.toNumber() ?? null);
  const niiYoy = pctChange(nii, yearAgoRow?.nii?.toNumber() ?? null);
  const patQoq = pctChange(
    p.netProfit,
    priorRow?.netProfit?.toNumber() ?? null,
  );
  const patYoy = pctChange(
    p.netProfit,
    yearAgoRow?.netProfit?.toNumber() ?? null,
  );

  const data: Prisma.BankingQuarterlyResultUpsertArgs["create"] = {
    stockId,
    quarter: p.quarter,
    fiscalYear: p.fiscalYear,
    reportDate: p.reportDate,
    filingDate: p.filingDate,
    xbrlUrl: p.xbrlUrl,
    resultType: p.resultType,
    source,
    xbrlTaxonomy: "in_capmkt",

    interestEarned: safeNumber(p.interestEarned),
    interestExpended: safeNumber(p.interestExpended),
    otherIncome: safeNumber(p.otherIncome),
    employeesCost: safeNumber(p.employeesCost),
    operatingExpenses: safeNumber(p.operatingExpenses),
    expenditureExclProvisions: safeNumber(p.expenditureExclProvisions),
    ppop: safeNumber(p.ppop),
    provisions: safeNumber(p.provisions),
    exceptionalItems: safeNumber(p.exceptionalItems),
    profitBeforeTax: safeNumber(p.profitBeforeTax),
    tax: safeNumber(p.tax),
    profitAfterTax: safeNumber(p.profitAfterTax),
    netProfit: safeNumber(p.netProfit),

    gnpaAbsolute: safeNumber(p.gnpaAbsolute),
    nnpaAbsolute: safeNumber(p.nnpaAbsolute),
    gnpaPct: decimalRatio(p.gnpaPct),
    nnpaPct: decimalRatio(p.nnpaPct),
    pcr: decimalRatio(pcr),
    cet1Ratio: decimalRatio(p.cet1Ratio),
    additionalTier1Ratio: decimalRatio(p.additionalTier1Ratio),
    tier1Ratio: decimalRatio(tier1Ratio),
    roaQuarterly: decimalRatio(p.roaQuarterly),
    auditPending: p.auditPending,

    nii: safeNumber(nii),
    totalIncome: safeNumber(totalIncome),
    costToIncomeRatio: decimalRatio(costToIncomeRatio),
    netMargin: decimalPct(netMargin),

    niiQoq: decimalPct(niiQoq),
    niiYoy: decimalPct(niiYoy),
    patQoq: decimalPct(patQoq),
    patYoy: decimalPct(patYoy),
  };

  const row = await prisma.bankingQuarterlyResult.upsert({
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
