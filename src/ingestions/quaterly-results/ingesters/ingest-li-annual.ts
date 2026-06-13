// File: src/ingestions/quaterly-results/ingesters/ingest-li-annual.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedLifeInsuranceAnnual } from "../xbrl/parser-li.js";
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

export async function ingestLifeInsuranceAnnual(
  input: { stockId: string; parsed: ParsedLifeInsuranceAnnual; source: string },
  decision: "ingest" | "refresh",
): Promise<{ status: "success" | "refreshed"; rowId: string }> {
  const { stockId, parsed: p, source } = input;

  // Derived
  const netWorth = sumNonNull(
    p.shareCapital,
    p.reservesAndSurplus,
    p.fairValueChangeAccount,
  );
  let bookValuePerShare: number | null = null;
  // BVPS for LI. Most LI XBRL files don't emit FaceValueOfEquityShareCapital.
  // Use paidUpEquityCapital with ₹10 face fallback (IRDAI norm for Indian life insurers).
  if (netWorth !== null) {
    const equityCapital = p.paidUpEquityCapital ?? p.shareCapital;
    const faceValue = p.faceValueShare ?? 10; // IRDAI norm for LI

    if (equityCapital !== null && equityCapital > 0 && faceValue > 0) {
      const sharesCr = equityCapital / faceValue;
      if (sharesCr > 0) {
        bookValuePerShare = netWorth / sharesCr;
      }
    }
  }

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

  // ROE
  const priorFY = decrementFY(p.fiscalYear);
  const priorRow = await prisma.lifeInsuranceFundamental.findUnique({
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
      grossPremiumIncome: true,
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

  // YoY
  const premiumGrowthYoy = pctChange(
    p.grossPremiumIncome,
    priorRow?.grossPremiumIncome?.toNumber() ?? null,
  );
  const patGrowthYoy = pctChange(
    p.netProfit,
    priorRow?.netProfit?.toNumber() ?? null,
  );

  const data: Prisma.LifeInsuranceFundamentalUpsertArgs["create"] = {
    stockId,
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
    otherIncomePolicyholders: safeNumber(p.otherIncomePolicyholders),
    totalRevenuePolicyholders: safeNumber(p.totalRevenuePolicyholders),

    commissionFirstYearPremium: safeNumber(p.commissionFirstYearPremium),
    commissionRenewalPremium: safeNumber(p.commissionRenewalPremium),
    commissionSinglePremium: safeNumber(p.commissionSinglePremium),
    totalCommission: safeNumber(p.totalCommission),

    employeesRemuneration: safeNumber(p.employeesRemuneration),
    administrationExpenses: safeNumber(p.administrationExpenses),
    advertisementAndPublicity: safeNumber(p.advertisementAndPublicity),
    totalOperatingExpenses: safeNumber(p.totalOperatingExpenses),

    benefitsPaidNet: safeNumber(p.benefitsPaidNet),
    changeInValuationOfLiabilities: safeNumber(
      p.changeInValuationOfLiabilities,
    ),
    allocationOfBonusToPolicyholders: safeNumber(
      p.allocationOfBonusToPolicyholders,
    ),

    surplusFromRevenueAccount: safeNumber(p.surplusFromRevenueAccount),

    transferFromPolicyholders: safeNumber(p.transferFromPolicyholders),
    incomeFromInvestmentsShareholders: safeNumber(
      p.incomeFromInvestmentsShareholders,
    ),
    otherIncomeShareholders: safeNumber(p.otherIncomeShareholders),
    shareholdersExpenses: safeNumber(p.shareholdersExpenses),
    profitBeforeTax: safeNumber(p.profitBeforeTax),
    tax: safeNumber(p.tax),
    netProfit: safeNumber(p.netProfit),

    shareCapital: safeNumber(p.shareCapital),
    reservesAndSurplus: safeNumber(p.reservesAndSurplus),
    fairValueChangeAccount: safeNumber(p.fairValueChangeAccount),
    borrowings: safeNumber(p.borrowings),
    policyholdersFunds: safeNumber(p.policyholdersFunds),
    fundsForFutureAppropriations: safeNumber(p.fundsForFutureAppropriations),
    totalSourcesOfFunds: safeNumber(p.totalSourcesOfFunds),

    investmentsShareholders: safeNumber(p.investmentsShareholders),
    investmentsPolicyholders: safeNumber(p.investmentsPolicyholders),
    assetsHeldToCoverLinkedLiabilities: safeNumber(
      p.assetsHeldToCoverLinkedLiabilities,
    ),
    loansApplicationOfFunds: safeNumber(p.loansApplicationOfFunds),
    fixedAssets: safeNumber(p.fixedAssets),
    cashAndBankBalances: safeNumber(p.cashAndBankBalances),
    advancesAndOtherAssets: safeNumber(p.advancesAndOtherAssets),
    currentLiabilities: safeNumber(p.currentLiabilities),
    provisions: safeNumber(p.provisions),
    miscellaneousExpenditure: safeNumber(p.miscellaneousExpenditure),
    debitBalanceProfitAndLoss: safeNumber(p.debitBalanceProfitAndLoss),
    totalApplicationOfFunds: safeNumber(p.totalApplicationOfFunds),
    totalAssets: safeNumber(p.totalAssets),

    solvencyRatio: safeNumber(p.solvencyRatio, 4),
    persistencyRatio13Month: decimalRatio(p.persistencyRatio13Month),
    persistencyRatio25Month: decimalRatio(p.persistencyRatio25Month),
    persistencyRatio37Month: decimalRatio(p.persistencyRatio37Month),
    persistencyRatio49Month: decimalRatio(p.persistencyRatio49Month),
    persistencyRatio61Month: decimalRatio(p.persistencyRatio61Month),

    basicEps: decimalPerShare(p.basicEps),
    dilutedEps: decimalPerShare(p.dilutedEps),
    faceValueShare: decimalPerShare(p.faceValueShare),
    paidUpEquityCapital: safeNumber(p.paidUpEquityCapital),

    netWorth: safeNumber(netWorth),
    bookValuePerShare: decimalPerShare(bookValuePerShare),
    roe: decimalRatio(roe),
    newBusinessPremiumPct: decimalRatio(newBusinessPremiumPct),
    expenseRatioPolicyholders: decimalRatio(expenseRatio),

    premiumGrowthYoy: decimalPct(premiumGrowthYoy),
    patGrowthYoy: decimalPct(patGrowthYoy),
  };

  const row = await prisma.lifeInsuranceFundamental.upsert({
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
