// File: src/ingestions/quaterly-results/ingesters/ingest-gi-annual.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { IngestOutcome } from "./dispatch.js";
import type { ParsedGeneralInsuranceAnnual } from "../xbrl/parser-gi.js";
import {
  safeNumber,
  decimalRatio,
  decimalPerShare,
  decrementFY,
} from "../ingester-utils.js";
import {
  financialShapeReject,
  financialRecordGuards,
  resultsRunRef,
} from "../financial-guards.js";
import { deriveGiAnnual } from "../derive/derive-gi-annual.js";
import { plausibleFaceValue, boundDisclosed } from "../derive/derive-indas-annual.js";
import { guardedWrite, FILL_NULL_ONLY, type WriteDirective } from "./guarded-write.js";

export async function ingestGeneralInsuranceAnnual(
  input: {
    stockId: string;
    parsed: ParsedGeneralInsuranceAnnual;
    source: string;
  },
  decision: "ingest" | "refresh",
  directive: WriteDirective = FILL_NULL_ONLY,
): Promise<IngestOutcome> {
  const { stockId, parsed: p, source } = input;
  const entity = `${stockId}@${p.fiscalYear}@${p.resultType}`;
  const runRef = resultsRunRef(`Y-${p.fiscalYear}`);
  if (
    await financialShapeReject({
      table: "GeneralInsuranceFundamental",
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

  // ── Prior-year row (ROE avg equity + YoY) ──
  const priorFY = decrementFY(p.fiscalYear);
  const priorRow = await prisma.generalInsuranceFundamental.findUnique({
    where: {
      stockId_fiscalYear_resultType: {
        stockId,
        fiscalYear: priorFY,
        resultType: p.resultType, // compare same basis
      },
    },
    select: {
      shareCapital: true,
      reservesAndSurplus: true,
      fairValueChangeAccount: true,
      grossPremiumsWritten: true,
      netProfit: true,
    },
  });

  // ── Sanitise faceValueShare BEFORE it reaches either the stored column or the
  // derivation — a corrupt source tag must not poison bookValuePerShare or get
  // persisted as if it were a real face value. See derive-li-annual.ts's header
  // note for the ??10 decision and derive-indas-annual.ts for the shared gate. ──
  const faceValueSane = plausibleFaceValue(p.faceValueShare);
  if (faceValueSane === null && p.faceValueShare !== null) {
    console.warn(`[ingest-gi-annual] ${entity}: implausible faceValueShare=${p.faceValueShare} → treated as null.`);
  }

  // ── Derive 6 stored columns — SINGLE PATH (ingestion ≡ fill). The BVPS
  // ₹10-face fallback + netUnderwritingMargin (= 1 − combinedRatio) live in
  // deriveGiAnnual. ──
  const derived = deriveGiAnnual(
    {
      shareCapital: p.shareCapital,
      reservesAndSurplus: p.reservesAndSurplus,
      fairValueChangeAccount: p.fairValueChangeAccount,
      paidUpEquityCapital: p.paidUpEquityCapital,
      faceValueShareSane: faceValueSane,
      combinedRatio: p.combinedRatio,
      netProfit: p.netProfit,
      grossPremiumsWritten: p.grossPremiumsWritten,
    },
    priorRow
      ? {
          shareCapital: priorRow.shareCapital?.toNumber() ?? null,
          reservesAndSurplus: priorRow.reservesAndSurplus?.toNumber() ?? null,
          fairValueChangeAccount: priorRow.fairValueChangeAccount?.toNumber() ?? null,
          grossPremiumsWritten: priorRow.grossPremiumsWritten?.toNumber() ?? null,
          netProfit: priorRow.netProfit?.toNumber() ?? null,
        }
      : null,
    entity,
  );
  // The record guards read the pre-Decimal GPW-YoY number.
  const gpwGrowthYoy = derived.numbers.gpwGrowthYoy;

  if (decision === "ingest") {
    await financialRecordGuards({
      table: "GeneralInsuranceFundamental",
      entity,
      runRef,
      scale: [
        ["grossPremiumsWritten", p.grossPremiumsWritten],
        ["totalAssets", p.totalAssets],
      ],
      yoy: gpwGrowthYoy,
      yoyBase: priorRow?.grossPremiumsWritten?.toNumber() ?? null,
      yoyLabel: "gpwGrowthYoy",
      solvency: p.solvencyRatio,
    });
  }

  const data: Prisma.GeneralInsuranceFundamentalUpsertArgs["create"] = {
    stockId,
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
    reinsuranceCeded: safeNumber(p.reinsuranceCeded),
    reinsuranceAccepted: safeNumber(p.reinsuranceAccepted),
    changeInUnexpiredRiskReserve: safeNumber(p.changeInUnexpiredRiskReserve),

    incomeFromInvestments: safeNumber(p.incomeFromInvestments),
    otherIncome: safeNumber(p.otherIncome),
    totalRevenue: safeNumber(p.totalRevenue),

    claimsPaid: safeNumber(p.claimsPaid),
    changeInOutstandingClaims: safeNumber(p.changeInOutstandingClaims),
    incurredClaims: safeNumber(p.incurredClaims),
    reinsuranceRecoveriesOnClaims: safeNumber(p.reinsuranceRecoveriesOnClaims),

    commissionPaid: safeNumber(p.commissionPaid),
    commissionReceivedFromReinsurance: safeNumber(
      p.commissionReceivedFromReinsurance,
    ),
    netCommission: safeNumber(p.netCommission),

    employeesRemuneration: safeNumber(p.employeesRemuneration),
    rentRatesAndTaxes: safeNumber(p.rentRatesAndTaxes),
    legalAndProfessionalCharges: safeNumber(p.legalAndProfessionalCharges),
    advertisementAndPublicity: safeNumber(p.advertisementAndPublicity),
    totalOperatingExpensesRelatedToInsurance: safeNumber(
      p.totalOperatingExpensesRelatedToInsurance,
    ),

    premiumDeficiency: safeNumber(p.premiumDeficiency),
    underwritingProfitOrLoss: safeNumber(p.underwritingProfitOrLoss),

    profitBeforeTax: safeNumber(p.profitBeforeTax),
    tax: safeNumber(p.tax),
    netProfit: safeNumber(p.netProfit),

    shareCapital: safeNumber(p.shareCapital),
    reservesAndSurplus: safeNumber(p.reservesAndSurplus),
    fairValueChangeAccount: safeNumber(p.fairValueChangeAccount),
    borrowings: safeNumber(p.borrowings),
    totalSourcesOfFunds: safeNumber(p.totalSourcesOfFunds),

    investments: safeNumber(p.investments),
    loansApplicationOfFunds: safeNumber(p.loansApplicationOfFunds),
    fixedAssets: safeNumber(p.fixedAssets),
    cashAndBankBalances: safeNumber(p.cashAndBankBalances),
    advancesAndOtherAssets: safeNumber(p.advancesAndOtherAssets),
    currentLiabilities: safeNumber(p.currentLiabilities),
    provisions: safeNumber(p.provisions),
    totalApplicationOfFunds: safeNumber(p.totalApplicationOfFunds),
    totalAssets: safeNumber(p.totalAssets),

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

    // S8.1g — not a ratio, but the same shape on the same table: Decimal(10,4),
    //   ceiling 1,000,000, written straight from the filing with no bound. A
    //   mis-tagged EPS would throw the whole upsert exactly as an overflowing
    //   ratio does. ingest-indas-annual.ts already bounds these two; this matches
    //   it, using the DISCLOSED sibling because the value is filed, not computed.
    basicEps: boundDisclosed(decimalPerShare(p.basicEps), 6, "basicEps", entity),
    dilutedEps: boundDisclosed(decimalPerShare(p.dilutedEps), 6, "dilutedEps", entity),
    // Sanitised, not raw — an implausible source value must not be persisted as
    // if it were a real face value (see the note above and derive-gi-annual.ts).
    faceValueShare: decimalPerShare(faceValueSane),
    paidUpEquityCapital: safeNumber(p.paidUpEquityCapital),

    // Derived — netWorth, bvps, roe, netUnderwritingMargin, gpw/patGrowthYoy —
    // from the single deriveGiAnnual path (ingestion ≡ fill).
    ...derived.columns,
  };

  const written = await guardedWrite({
    delegate: prisma.generalInsuranceFundamental,
    modelName: "GeneralInsuranceFundamental",
    where: {
      stockId_fiscalYear_resultType: {
        stockId,
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
