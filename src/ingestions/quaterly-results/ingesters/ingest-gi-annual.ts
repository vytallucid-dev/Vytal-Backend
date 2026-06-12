// File: src/ingestions/quaterly-results/ingesters/ingest-gi-annual.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedGeneralInsuranceAnnual } from "../xbrl/parser-gi.js";
import {
  safeNumber,
  decimalPct,
  decimalRatio,
  decimalPerShare,
  decrementFY,
  pctChange,
  sumNonNull,
  avgNonNull,
} from "../ingester-utils.js";

export async function ingestGeneralInsuranceAnnual(
  input: {
    stockId: string;
    parsed: ParsedGeneralInsuranceAnnual;
    source: string;
  },
  decision: "ingest" | "upgrade" | "refresh",
): Promise<{ status: "success" | "upgraded" | "refreshed"; rowId: string }> {
  const { stockId, parsed: p, source } = input;

  const netWorth = sumNonNull(
    p.shareCapital,
    p.reservesAndSurplus,
    p.fairValueChangeAccount,
  );

  // BVPS for GI. Most GI XBRL files don't emit FaceValueOfEquityShareCapital.
  // Fallback strategy:
  //   1. If paidUpEquityCapital AND faceValueShare both present, use them
  //      (this works for the rare insurer that emits face value).
  //   2. If only paidUpEquityCapital present, assume ₹10 face (the IRDAI norm
  //      for Indian general insurance equity; verify per insurer in extraMetrics
  //      if their AR disagrees).
  //   3. If only shareCapital present (rare; ShareCapital ≈ PaidUpEquityCapital
  //      for most insurers), use that with ₹10 face.
  //   4. Otherwise null.
  let bookValuePerShare: number | null = null;
  if (netWorth !== null) {
    const equityCapital = p.paidUpEquityCapital ?? p.shareCapital;
    const faceValue = p.faceValueShare ?? 10; // ₹10 IRDAI norm for GI

    if (equityCapital !== null && equityCapital > 0 && faceValue > 0) {
      const sharesCr = equityCapital / faceValue;
      if (sharesCr > 0) {
        bookValuePerShare = netWorth / sharesCr;
      }
    }
  }

  const netUnderwritingMargin =
    p.combinedRatio !== null ? 1 - p.combinedRatio : null;

  const priorFY = decrementFY(p.fiscalYear);
  const priorRow = await prisma.generalInsuranceFundamental.findUnique({
    where: { stockId_fiscalYear: { stockId, fiscalYear: priorFY } },
    select: {
      shareCapital: true,
      reservesAndSurplus: true,
      fairValueChangeAccount: true,
      grossPremiumsWritten: true,
      netProfit: true,
    },
  });
  const priorNetWorth = priorRow
    ? sumNonNull(
        priorRow.shareCapital?.toNumber() ?? null,
        priorRow.reservesAndSurplus?.toNumber() ?? null,
        priorRow.fairValueChangeAccount?.toNumber() ?? null,
      )
    : null;
  const avgEquity = avgNonNull(netWorth, priorNetWorth);
  const roe =
    p.netProfit !== null && avgEquity !== null && avgEquity !== 0
      ? p.netProfit / avgEquity
      : null;

  const gpwGrowthYoy = pctChange(
    p.grossPremiumsWritten,
    priorRow?.grossPremiumsWritten?.toNumber() ?? null,
  );
  const patGrowthYoy = pctChange(
    p.netProfit,
    priorRow?.netProfit?.toNumber() ?? null,
  );

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

    netWorth: safeNumber(netWorth),
    bookValuePerShare: decimalPerShare(bookValuePerShare),
    roe: decimalRatio(roe),
    netUnderwritingMargin: decimalRatio(netUnderwritingMargin),

    gpwGrowthYoy: decimalPct(gpwGrowthYoy),
    patGrowthYoy: decimalPct(patGrowthYoy),
  };

  const row = await prisma.generalInsuranceFundamental.upsert({
    where: { stockId_fiscalYear: { stockId, fiscalYear: p.fiscalYear } },
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
