// File: src/ingestions/quaterly-results/ingesters/ingest-li-quarterly.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { IngestOutcome } from "./dispatch.js";
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
import { boundDisclosed } from "../derive/derive-indas-annual.js";
import { guardedWrite, FILL_NULL_ONLY, type WriteDirective } from "./guarded-write.js";

export async function ingestLifeInsuranceQuarterly(
  input: {
    stockId: string;
    parsed: ParsedLifeInsuranceQuarterly;
    source: string;
  },
  decision: "ingest" | "refresh",
  directive: WriteDirective = FILL_NULL_ONLY,
): Promise<IngestOutcome> {
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
    // REJECTED = the upsert never ran, so nothing was written and nothing could have
    // changed. This is the one honest `false` in this file. The caller maps "rejected"
    // to "skipped" anyway, so it never reached changedSymbols before this change either.
    return { status: "rejected", rowId: "", scoreRelevantChanged: false };
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

    // S8.1c — DISCLOSED ratios: taken from the document, not from our arithmetic.
    //   Bounded to their own columns all the same, because an overflow throws the
    //   WHOLE upsert and takes the raw absolute lines with it. solvencyRatio is
    //   Decimal(8,4) → maxIntDigits 4; the five persistency ratios are
    //   Decimal(8,6) → 2. Unrepresentable → null, never clamped, never fatal.
    solvencyRatio: boundDisclosed(safeNumber(p.solvencyRatio, 4), 4, "solvencyRatio", entity),
    persistencyRatio13Month: boundDisclosed(decimalRatio(p.persistencyRatio13Month), 2, "persistencyRatio13Month", entity),
    persistencyRatio25Month: boundDisclosed(decimalRatio(p.persistencyRatio25Month), 2, "persistencyRatio25Month", entity),
    persistencyRatio37Month: boundDisclosed(decimalRatio(p.persistencyRatio37Month), 2, "persistencyRatio37Month", entity),
    persistencyRatio49Month: boundDisclosed(decimalRatio(p.persistencyRatio49Month), 2, "persistencyRatio49Month", entity),
    persistencyRatio61Month: boundDisclosed(decimalRatio(p.persistencyRatio61Month), 2, "persistencyRatio61Month", entity),

    // Derived (newBusinessPremiumPct, expenseRatio, netMargin, premium QoQ/YoY,
    // pat QoQ/YoY) from the single deriveLiQuarterly path (ingestion ≡ fill).
    ...derived.columns,
  };

  const written = await guardedWrite({
    delegate: prisma.lifeInsuranceQuarterlyResult,
    modelName: "LifeInsuranceQuarterlyResult",
    where: {
      stockId_quarter_fiscalYear_resultType: {
        stockId,
        quarter: p.quarter,
        fiscalYear: p.fiscalYear,
        resultType: p.resultType,
      },
    },
    data,
    directive,
    label: entity,
  });
  const row = written.row;

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
