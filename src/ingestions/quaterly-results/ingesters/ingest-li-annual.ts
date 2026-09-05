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
import { plausibleFaceValue, boundDisclosed } from "../derive/derive-indas-annual.js";
import { guardedWrite, FILL_NULL_ONLY, type WriteDirective } from "./guarded-write.js";

export async function ingestLifeInsuranceAnnual(
  input: { stockId: string; parsed: ParsedLifeInsuranceAnnual; source: string },
  decision: "ingest" | "refresh",
  directive: WriteDirective = FILL_NULL_ONLY,
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

  // ── Sanitise faceValueShare BEFORE it reaches either the stored column or the
  // derivation — a corrupt source tag must not poison bookValuePerShare or get
  // persisted as if it were a real face value. See derive-li-annual.ts's header
  // note for the ??10 decision and derive-indas-annual.ts for the shared gate. ──
  const faceValueSane = plausibleFaceValue(p.faceValueShare);
  if (faceValueSane === null && p.faceValueShare !== null) {
    console.warn(`[ingest-li-annual] ${entity}: implausible faceValueShare=${p.faceValueShare} → treated as null.`);
  }

  // ── Derive 7 stored columns — SINGLE PATH (ingestion ≡ fill). ──
  const derived = deriveLiAnnual(
    {
      shareCapital: p.shareCapital,
      reservesAndSurplus: p.reservesAndSurplus,
      fairValueChangeAccount: p.fairValueChangeAccount,
      paidUpEquityCapital: p.paidUpEquityCapital,
      faceValueShareSane: faceValueSane,
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
    entity,
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
      yoyBase: priorRow?.grossPremiumIncome?.toNumber() ?? null,
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

    // S8.1g — not a ratio, but the same shape on the same table: Decimal(10,4),
    //   ceiling 1,000,000, written straight from the filing with no bound. A
    //   mis-tagged EPS would throw the whole upsert exactly as an overflowing
    //   ratio does. ingest-indas-annual.ts already bounds these two; this matches
    //   it, using the DISCLOSED sibling because the value is filed, not computed.
    basicEps: boundDisclosed(decimalPerShare(p.basicEps), 6, "basicEps", entity),
    dilutedEps: boundDisclosed(decimalPerShare(p.dilutedEps), 6, "dilutedEps", entity),
    // Sanitised, not raw — an implausible source value must not be persisted as
    // if it were a real face value (see the note above and derive-li-annual.ts).
    faceValueShare: decimalPerShare(faceValueSane),
    paidUpEquityCapital: safeNumber(p.paidUpEquityCapital),

    // Derived — netWorth, bvps, roe, newBusinessPremiumPct, expenseRatio,
    // premium/patGrowthYoy — from the single deriveLiAnnual path (ingestion ≡ fill).
    ...derived.columns,
  };

  const written = await guardedWrite({
    delegate: prisma.lifeInsuranceFundamental,
    modelName: "LifeInsuranceFundamental",
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
