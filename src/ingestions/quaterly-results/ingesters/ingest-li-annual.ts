// File: src/ingestions/quaterly-results/ingesters/ingest-li-annual.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { IngestOutcome } from "./dispatch.js";
import type { ParsedLifeInsuranceAnnual } from "../xbrl/parser-li.js";
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
import { deriveLiAnnual } from "../derive/derive-li-annual.js";

export async function ingestLifeInsuranceAnnual(
  input: { stockId: string; parsed: ParsedLifeInsuranceAnnual; source: string },
  decision: "ingest" | "refresh",
): Promise<IngestOutcome> {
  const { stockId, parsed: p, source } = input;
  const entity = `${stockId}@${p.fiscalYear}@${p.resultType}`;
  const runRef = resultsRunRef(`Y-${p.fiscalYear}`);
  if (
    await financialShapeReject({
      table: "LifeInsuranceFundamental",
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

  // ── Prior-year row (ROE avg equity + YoY) ──
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

  // ── Derive 7 stored columns — SINGLE PATH (ingestion ≡ fill). ──
  const derived = deriveLiAnnual(
    {
      shareCapital: p.shareCapital,
      reservesAndSurplus: p.reservesAndSurplus,
      fairValueChangeAccount: p.fairValueChangeAccount,
      paidUpEquityCapital: p.paidUpEquityCapital,
      faceValueShare: p.faceValueShare,
      incomeFirstYearPremium: p.incomeFirstYearPremium,
      grossPremiumIncome: p.grossPremiumIncome,
      totalOperatingExpenses: p.totalOperatingExpenses,
      netProfit: p.netProfit,
    },
    priorRow
      ? {
          shareCapital: priorRow.shareCapital?.toNumber() ?? null,
          reservesAndSurplus: priorRow.reservesAndSurplus?.toNumber() ?? null,
          fairValueChangeAccount: priorRow.fairValueChangeAccount?.toNumber() ?? null,
          grossPremiumIncome: priorRow.grossPremiumIncome?.toNumber() ?? null,
          netProfit: priorRow.netProfit?.toNumber() ?? null,
        }
      : null,
  );
  // The record guards read the pre-Decimal premium-YoY number.
  const premiumGrowthYoy = derived.numbers.premiumGrowthYoy;

  if (decision === "ingest") {
    await financialRecordGuards({
      table: "LifeInsuranceFundamental",
      entity,
      runRef,
      scale: [
        ["grossPremiumIncome", p.grossPremiumIncome],
        ["totalAssets", p.totalAssets],
      ],
      yoy: premiumGrowthYoy,
      yoyLabel: "premiumGrowthYoy",
      solvency: p.solvencyRatio,
    });
  }

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

    // Derived — netWorth, bvps, roe, newBusinessPremiumPct, expenseRatio,
    // premium/patGrowthYoy — from the single deriveLiAnnual path (ingestion ≡ fill).
    ...derived.columns,
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
    // CONSERVATIVE: no SCORED peer group reads this taxonomy (PG7 NBFC is gated out of
    // SCORED_PGS; there is no insurance PG), so pgRefsForSymbols drops these symbols anyway.
    // Reporting true costs nothing and can never withhold a real change. If this taxonomy is
    // ever scored, give it a real diff here — do not leave a hardcoded false.
    scoreRelevantChanged: true,
  };
}
