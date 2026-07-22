// File: src/ingestions/quaterly-results/ingesters/ingest-nbfc-annual.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { IngestOutcome } from "./dispatch.js";
import type { ParsedNbfcAnnual } from "../xbrl/parser-nbfc.js";
import {
  safeNumber,
  decimalPerShare,
  decrementFY,
} from "../ingester-utils.js";
import {
  financialShapeReject,
  financialRecordGuards,
  resultsRunRef,
} from "../financial-guards.js";
import { deriveNbfcAnnual } from "../derive/derive-nbfc-annual.js";

export async function ingestNbfcAnnual(
  input: { stockId: string; parsed: ParsedNbfcAnnual; source: string },
  decision: "ingest" | "refresh",
): Promise<IngestOutcome> {
  const { stockId, parsed: p, source } = input;
  const entity = `${stockId}@${p.fiscalYear}@${p.resultType}`;
  const runRef = resultsRunRef(`Y-${p.fiscalYear}`);
  if (
    await financialShapeReject({
      table: "NbfcFundamental",
      entity,
      runRef,
      coreA: p.revenue,
      coreB: p.netProfit,
      coreLabel: "revenue or netProfit",
    })
  ) {
    // REJECTED = the upsert never ran, so nothing was written and nothing could have
    // changed. This is the one honest `false` in this file. The caller maps "rejected"
    // to "skipped" anyway, so it never reached changedSymbols before this change either.
    return { status: "rejected", rowId: "", scoreRelevantChanged: false };
  }

  // ── Prior-year row (avg loans/borrowings/equity denominators + YoY) — one
  // fetch; the avg-denominator semantics live in deriveNbfcAnnual. ──
  const priorFY = decrementFY(p.fiscalYear);
  const priorRow = await prisma.nbfcFundamental.findUnique({
    where: {
      stockId_fiscalYear_resultType: {
        stockId,
        fiscalYear: priorFY,
        resultType: p.resultType, // compare same basis
      },
    },
    select: {
      revenue: true,
      netProfit: true,
      loans: true,
      totalEquity: true,
      equityShareCapital: true,
      otherEquity: true,
      debtSecurities: true,
      borrowings: true,
      subordinatedLiabilities: true,
      depositsLiabilities: true,
    },
  });

  // ── Derive all 12 stored columns — SINGLE PATH (ingestion ≡ fill). ──
  const derived = deriveNbfcAnnual(
    {
      interestIncome: p.interestIncome,
      financeCosts: p.financeCosts,
      loans: p.loans,
      totalIncome: p.totalIncome,
      feeAndCommissionIncome: p.feeAndCommissionIncome,
      netGainOnFairValueChanges: p.netGainOnFairValueChanges,
      otherIncome: p.otherIncome,
      employeeBenefitExpense: p.employeeBenefitExpense,
      depreciation: p.depreciation,
      otherExpenses: p.otherExpenses,
      feeAndCommissionExpense: p.feeAndCommissionExpense,
      impairmentOnFinancialInstruments: p.impairmentOnFinancialInstruments,
      debtSecurities: p.debtSecurities,
      borrowings: p.borrowings,
      subordinatedLiabilities: p.subordinatedLiabilities,
      depositsLiabilities: p.depositsLiabilities,
      totalEquity: p.totalEquity,
      equityShareCapital: p.equityShareCapital,
      otherEquity: p.otherEquity,
      totalAssets: p.totalAssets,
      paidUpEquityCapital: p.paidUpEquityCapital,
      faceValueShare: p.faceValueShare,
      netProfit: p.netProfit,
      revenue: p.revenue,
    },
    priorRow
      ? {
          revenue: priorRow.revenue?.toNumber() ?? null,
          netProfit: priorRow.netProfit?.toNumber() ?? null,
          loans: priorRow.loans?.toNumber() ?? null,
          totalEquity: priorRow.totalEquity?.toNumber() ?? null,
          equityShareCapital: priorRow.equityShareCapital?.toNumber() ?? null,
          otherEquity: priorRow.otherEquity?.toNumber() ?? null,
          debtSecurities: priorRow.debtSecurities?.toNumber() ?? null,
          borrowings: priorRow.borrowings?.toNumber() ?? null,
          subordinatedLiabilities:
            priorRow.subordinatedLiabilities?.toNumber() ?? null,
          depositsLiabilities: priorRow.depositsLiabilities?.toNumber() ?? null,
        }
      : null,
  );
  // The record guards read the pre-Decimal revenue-YoY number.
  const revenueGrowthYoy = derived.numbers.revenueGrowthYoy;

  if (decision === "ingest") {
    await financialRecordGuards({
      table: "NbfcFundamental",
      entity,
      runRef,
      scale: [
        ["revenue", p.revenue],
        ["totalAssets", p.totalAssets],
        ["loans", p.loans],
      ],
      yoy: revenueGrowthYoy,
      yoyLabel: "revenueGrowthYoy",
    });
  }

  const data: Prisma.NbfcFundamentalUpsertArgs["create"] = {
    stockId,
    fiscalYear: p.fiscalYear,
    reportDate: p.reportDate,
    filingDate: p.filingDate,
    xbrlUrl: p.xbrlUrl,
    resultType: p.resultType,
    source,
    xbrlTaxonomy: "in_capmkt",

    // P&L
    revenue: safeNumber(p.revenue),
    interestIncome: safeNumber(p.interestIncome),
    feeAndCommissionIncome: safeNumber(p.feeAndCommissionIncome),
    netGainOnFairValueChanges: safeNumber(p.netGainOnFairValueChanges),
    otherIncome: safeNumber(p.otherIncome),
    totalIncome: safeNumber(p.totalIncome),
    financeCosts: safeNumber(p.financeCosts),
    feeAndCommissionExpense: safeNumber(p.feeAndCommissionExpense),
    impairmentOnFinancialInstruments: safeNumber(
      p.impairmentOnFinancialInstruments,
    ),
    employeeBenefitExpense: safeNumber(p.employeeBenefitExpense),
    depreciation: safeNumber(p.depreciation),
    otherExpenses: safeNumber(p.otherExpenses),
    totalExpenses: safeNumber(p.totalExpenses),
    profitBeforeTax: safeNumber(p.profitBeforeTax),
    tax: safeNumber(p.tax),
    netProfit: safeNumber(p.netProfit),

    equityShareCapital: safeNumber(p.equityShareCapital),
    otherEquity: safeNumber(p.otherEquity),
    totalEquity: safeNumber(p.totalEquity),

    cashAndCashEquivalents: safeNumber(p.cashAndCashEquivalents),
    bankBalanceOther: safeNumber(p.bankBalanceOther),
    loans: safeNumber(p.loans),
    investments: safeNumber(p.investments),
    derivativeFinancialAssets: safeNumber(p.derivativeFinancialAssets),
    receivablesTrade: safeNumber(p.receivablesTrade),
    otherFinancialAssets: safeNumber(p.otherFinancialAssets),
    financialAssets: safeNumber(p.financialAssets),

    currentTaxAssetsNet: safeNumber(p.currentTaxAssetsNet),
    deferredTaxAssetsNet: safeNumber(p.deferredTaxAssetsNet),
    propertyPlantAndEquipment: safeNumber(p.propertyPlantAndEquipment),
    capitalWorkInProgress: safeNumber(p.capitalWorkInProgress),
    intangibleAssetsUnderDevelopment: safeNumber(
      p.intangibleAssetsUnderDevelopment,
    ),
    goodwill: safeNumber(p.goodwill),
    otherIntangibleAssets: safeNumber(p.otherIntangibleAssets),
    otherNonFinancialAssets: safeNumber(p.otherNonFinancialAssets),
    nonFinancialAssets: safeNumber(p.nonFinancialAssets),
    totalAssets: safeNumber(p.totalAssets),

    derivativeFinancialLiabilities: safeNumber(
      p.derivativeFinancialLiabilities,
    ),
    payables: safeNumber(p.payables),
    debtSecurities: safeNumber(p.debtSecurities),
    borrowings: safeNumber(p.borrowings),
    depositsLiabilities: safeNumber(p.depositsLiabilities),
    subordinatedLiabilities: safeNumber(p.subordinatedLiabilities),
    otherFinancialLiabilities: safeNumber(p.otherFinancialLiabilities),
    financialLiabilities: safeNumber(p.financialLiabilities),

    currentTaxLiabilitiesNet: safeNumber(p.currentTaxLiabilitiesNet),
    provisions: safeNumber(p.provisions),
    deferredTaxLiabilitiesNet: safeNumber(p.deferredTaxLiabilitiesNet),
    otherNonFinancialLiabilities: safeNumber(p.otherNonFinancialLiabilities),
    nonFinancialLiabilities: safeNumber(p.nonFinancialLiabilities),
    totalLiabilities: safeNumber(p.totalLiabilities),

    cashFromOperating: safeNumber(p.cashFromOperating),
    cashFromInvesting: safeNumber(p.cashFromInvesting),
    cashFromFinancing: safeNumber(p.cashFromFinancing),
    netCashFlow: safeNumber(p.netCashFlow),

    basicEps: decimalPerShare(p.basicEps),
    dilutedEps: decimalPerShare(p.dilutedEps),
    faceValueShare: decimalPerShare(p.faceValueShare),
    paidUpEquityCapital: safeNumber(p.paidUpEquityCapital),

    // Derived — the 12 computed columns (nim, costToIncome, creditCost, spread,
    // capitalToAssets, borrowingsToEquity, netWorth, bvps, roe, *GrowthYoy) all
    // from the single deriveNbfcAnnual path so ingestion ≡ fill.
    ...derived.columns,
  };

  const row = await prisma.nbfcFundamental.upsert({
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
