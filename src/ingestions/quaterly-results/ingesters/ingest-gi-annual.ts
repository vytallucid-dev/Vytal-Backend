// File: src/ingestions/quaterly-results/ingesters/ingest-gi-annual.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
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

export async function ingestGeneralInsuranceAnnual(
  input: {
    stockId: string;
    parsed: ParsedGeneralInsuranceAnnual;
    source: string;
  },
  decision: "ingest" | "refresh",
): Promise<{ status: "success" | "refreshed" | "rejected"; rowId: string }> {
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
    return { status: "rejected", rowId: "" };
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

  // ── Derive 6 stored columns — SINGLE PATH (ingestion ≡ fill). The BVPS
  // ₹10-face fallback + netUnderwritingMargin (= 1 − combinedRatio) live in
  // deriveGiAnnual. ──
  const derived = deriveGiAnnual(
    {
      shareCapital: p.shareCapital,
      reservesAndSurplus: p.reservesAndSurplus,
      fairValueChangeAccount: p.fairValueChangeAccount,
      paidUpEquityCapital: p.paidUpEquityCapital,
      faceValueShare: p.faceValueShare,
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

    combinedRatio: decimalRatio(p.combinedRatio),
    incurredClaimRatio: decimalRatio(p.incurredClaimRatio),
    expensesOfManagementRatio: decimalRatio(p.expensesOfManagementRatio),
    netRetentionRatio: decimalRatio(p.netRetentionRatio),
    solvencyRatio: safeNumber(p.solvencyRatio, 4),

    basicEps: decimalPerShare(p.basicEps),
    dilutedEps: decimalPerShare(p.dilutedEps),
    faceValueShare: decimalPerShare(p.faceValueShare),
    paidUpEquityCapital: safeNumber(p.paidUpEquityCapital),

    // Derived — netWorth, bvps, roe, netUnderwritingMargin, gpw/patGrowthYoy —
    // from the single deriveGiAnnual path (ingestion ≡ fill).
    ...derived.columns,
  };

  const row = await prisma.generalInsuranceFundamental.upsert({
    where: {
      stockId_fiscalYear_resultType: {
        stockId,
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
