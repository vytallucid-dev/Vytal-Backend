// File: src/ingestions/quaterly-results/ingesters/ingest-gi-quarterly.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { IngestOutcome } from "./dispatch.js";
import type { ParsedGeneralInsuranceQuarterly } from "../xbrl/parser-gi.js";
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
import { deriveGiQuarterly } from "../derive/derive-financial-quarterly.js";
import { boundDisclosed } from "../derive/derive-indas-annual.js";
import { guardedWrite, FILL_NULL_ONLY, type WriteDirective } from "./guarded-write.js";

export async function ingestGeneralInsuranceQuarterly(
  input: {
    stockId: string;
    parsed: ParsedGeneralInsuranceQuarterly;
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
      table: "GeneralInsuranceQuarterlyResult",
      entity,
      runRef,
      coreA: p.grossPremiumsWritten,
      coreB: p.netProfit,
      coreLabel: "grossPremiumsWritten or netProfit",
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

  // ── Derive 6 stored columns — SINGLE PATH (ingestion ≡ fill). ──
  const derived = deriveGiQuarterly(
    {
      combinedRatio: p.combinedRatio,
      netProfit: p.netProfit,
      totalRevenue: p.totalRevenue,
      grossPremiumsWritten: p.grossPremiumsWritten,
    },
    priorRow ? { grossPremiumsWritten: priorRow.grossPremiumsWritten?.toNumber() ?? null, netProfit: priorRow.netProfit?.toNumber() ?? null } : null,
    yearAgoRow ? { grossPremiumsWritten: yearAgoRow.grossPremiumsWritten?.toNumber() ?? null, netProfit: yearAgoRow.netProfit?.toNumber() ?? null } : null,
  );
  const gpwYoy = derived.numbers.gpwYoy;

  if (decision === "ingest") {
    await financialRecordGuards({
      table: "GeneralInsuranceQuarterlyResult",
      entity,
      runRef,
      scale: [["grossPremiumsWritten", p.grossPremiumsWritten]],
      yoy: gpwYoy,
      yoyLabel: "gpwYoy",
      solvency: p.solvencyRatio,
    });
  }

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

    // S8.1c — DISCLOSED ratios: taken from the document, not from our arithmetic.
    //   Bounded to their own columns all the same, because an overflow throws the
    //   WHOLE upsert and takes the raw absolute lines with it. These four are
    //   Decimal(8,6) → maxIntDigits 2; solvencyRatio below is Decimal(8,4) → 4.
    //   Unrepresentable → null, never clamped, never fatal.
    combinedRatio: boundDisclosed(decimalRatio(p.combinedRatio), 2, "combinedRatio", entity),
    incurredClaimRatio: boundDisclosed(decimalRatio(p.incurredClaimRatio), 2, "incurredClaimRatio", entity),
    expensesOfManagementRatio: boundDisclosed(decimalRatio(p.expensesOfManagementRatio), 2, "expensesOfManagementRatio", entity),
    netRetentionRatio: boundDisclosed(decimalRatio(p.netRetentionRatio), 2, "netRetentionRatio", entity),
    solvencyRatio: boundDisclosed(safeNumber(p.solvencyRatio, 4), 4, "solvencyRatio", entity),

    // Derived (netUnderwritingMargin, netMargin, gpw QoQ/YoY, pat QoQ/YoY)
    // from the single deriveGiQuarterly path (ingestion ≡ fill).
    ...derived.columns,
  };

  const written = await guardedWrite({
    delegate: prisma.generalInsuranceQuarterlyResult,
    modelName: "GeneralInsuranceQuarterlyResult",
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
