// File: src/ingestions/quaterly-results/ingesters/ingest-banking-quarterly.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedBankingQuarterly } from "../xbrl/parser-banking.js";
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
import { deriveBankingQuarterly } from "../derive/derive-financial-quarterly.js";

export async function ingestBankingQuarterly(
  input: { stockId: string; parsed: ParsedBankingQuarterly; source: string },
  decision: "ingest" | "refresh",
): Promise<{ status: "success" | "refreshed" | "rejected"; rowId: string }> {
  const { stockId, parsed: p, source } = input;
  const entity = `${stockId}@${p.quarter}-${p.fiscalYear}@${p.resultType}`;
  const runRef = resultsRunRef(`${p.quarter}-${p.fiscalYear}`);
  if (
    await financialShapeReject({
      table: "BankingQuarterlyResult",
      entity,
      runRef,
      coreA: p.interestEarned,
      coreB: p.netProfit,
      coreLabel: "interestEarned or netProfit",
    })
  ) {
    return { status: "rejected", rowId: "" };
  }

  // ── Prior-quarter (QoQ) + year-ago-quarter (YoY) rows ──
  const priorQ = getPriorQuarter(p.quarter, p.fiscalYear);
  const priorRow = priorQ
    ? await prisma.bankingQuarterlyResult.findUnique({
        where: {
          stockId_quarter_fiscalYear_resultType: {
            stockId,
            quarter: priorQ.quarter,
            fiscalYear: priorQ.fiscalYear,
            resultType: p.resultType, // compare same basis
          },
        },
        select: { nii: true, netProfit: true },
      })
    : null;
  const yearAgoFY = decrementFY(p.fiscalYear);
  const yearAgoRow = await prisma.bankingQuarterlyResult.findUnique({
    where: {
      stockId_quarter_fiscalYear_resultType: {
        stockId,
        quarter: p.quarter,
        fiscalYear: yearAgoFY,
        resultType: p.resultType, // compare same basis
      },
    },
    select: { nii: true, netProfit: true },
  });

  // ── Derive 10 stored columns — SINGLE PATH (ingestion ≡ fill). ──
  const derived = deriveBankingQuarterly(
    {
      interestEarned: p.interestEarned,
      interestExpended: p.interestExpended,
      otherIncome: p.otherIncome,
      expenditureExclProvisions: p.expenditureExclProvisions,
      netProfit: p.netProfit,
      gnpaAbsolute: p.gnpaAbsolute,
      nnpaAbsolute: p.nnpaAbsolute,
      cet1Ratio: p.cet1Ratio,
      additionalTier1Ratio: p.additionalTier1Ratio,
      auditPending: p.auditPending,
    },
    priorRow ? { nii: priorRow.nii?.toNumber() ?? null, netProfit: priorRow.netProfit?.toNumber() ?? null } : null,
    yearAgoRow ? { nii: yearAgoRow.nii?.toNumber() ?? null, netProfit: yearAgoRow.netProfit?.toNumber() ?? null } : null,
  );
  const niiYoy = derived.numbers.niiYoy;

  if (decision === "ingest") {
    await financialRecordGuards({
      table: "BankingQuarterlyResult",
      entity,
      runRef,
      scale: [["interestEarned", p.interestEarned]],
      yoy: niiYoy,
      yoyLabel: "niiYoy",
      npa: { nnpa: p.nnpaAbsolute, gnpa: p.gnpaAbsolute },
    });
  }

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
    // Disclosed-raw (parsed-direct, not derived):
    gnpaPct: decimalRatio(p.gnpaPct),
    nnpaPct: decimalRatio(p.nnpaPct),
    cet1Ratio: decimalRatio(p.cet1Ratio),
    additionalTier1Ratio: decimalRatio(p.additionalTier1Ratio),
    roaQuarterly: decimalRatio(p.roaQuarterly),
    auditPending: p.auditPending,

    // Derived (nii, totalIncome, costToIncome, netMargin, pcr, tier1, QoQ/YoY)
    // from the single deriveBankingQuarterly path (ingestion ≡ fill).
    ...derived.columns,
  };

  const row = await prisma.bankingQuarterlyResult.upsert({
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
