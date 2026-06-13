// File: src/ingestions/quaterly-results/ingesters/ingest-banking-annual.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedBankingAnnual } from "../xbrl/parser-banking.js";
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

export async function ingestBankingAnnual(
  input: { stockId: string; parsed: ParsedBankingAnnual; source: string },
  decision: "ingest" | "refresh",
): Promise<{ status: "success" | "refreshed"; rowId: string }> {
  const { stockId, parsed: p, source } = input;

  // ── Derived ──
  const nii =
    p.interestEarned !== null && p.interestExpended !== null
      ? p.interestEarned - p.interestExpended
      : null;
  const totalIncome =
    p.interestEarned !== null && p.otherIncome !== null
      ? p.interestEarned + p.otherIncome
      : null;
  const costToIncomeRatio =
    p.expenditureExclProvisions !== null &&
    totalIncome !== null &&
    totalIncome !== 0
      ? p.expenditureExclProvisions / totalIncome
      : null;

  // Net Worth (banking) = Capital + ReservesAndSurplus
  const netWorth = sumNonNull(p.capital, p.reservesAndSurplus);

  // BVPS
  let bookValuePerShare: number | null = null;
  if (
    netWorth !== null &&
    p.paidUpEquityCapital !== null &&
    p.paidUpEquityCapital > 0 &&
    p.faceValueShare !== null &&
    p.faceValueShare > 0
  ) {
    const sharesCr = p.paidUpEquityCapital / p.faceValueShare;
    if (sharesCr > 0) bookValuePerShare = netWorth / sharesCr;
  }

  // PCR
  const pcr =
    p.gnpaAbsolute !== null && p.gnpaAbsolute !== 0 && p.nnpaAbsolute !== null
      ? 1 - p.nnpaAbsolute / p.gnpaAbsolute
      : null;

  // Tier1
  const tier1Ratio =
    p.cet1Ratio !== null && p.additionalTier1Ratio !== null
      ? p.cet1Ratio + p.additionalTier1Ratio
      : null;

  // Credit Cost
  const avgAdvances = await fetchAvgAdvances(
    stockId,
    p.fiscalYear,
    p.advances,
    p.resultType,
  );
  const creditCostPct =
    p.provisions !== null && avgAdvances !== null && avgAdvances !== 0
      ? p.provisions / avgAdvances
      : null;

  // NIM
  const avgInterestEarningAssets = await fetchAvgInterestEarningAssets(
    stockId,
    p.fiscalYear,
    p.advances,
    p.investments,
    p.resultType,
  );
  const netInterestMargin =
    nii !== null &&
    avgInterestEarningAssets !== null &&
    avgInterestEarningAssets !== 0
      ? nii / avgInterestEarningAssets
      : null;

  // ROE — use prior year for averaging
  const priorFY = decrementFY(p.fiscalYear);
  const priorRow = await prisma.bankingFundamental.findUnique({
    where: {
      stockId_fiscalYear_resultType: {
        stockId,
        fiscalYear: priorFY,
        resultType: p.resultType, // compare same basis
      },
    },
    select: {
      capital: true,
      reservesAndSurplus: true,
      interestEarned: true,
      netProfit: true,
      deposits: true,
      advances: true,
      totalAssets: true,
    },
  });
  const priorNetWorth = priorRow
    ? sumNonNull(
        priorRow.capital?.toNumber() ?? null,
        priorRow.reservesAndSurplus?.toNumber() ?? null,
      )
    : null;
  const avgEquity = avgNonNull(netWorth, priorNetWorth);
  const roe =
    p.netProfit !== null && avgEquity !== null && avgEquity !== 0
      ? (p.netProfit / avgEquity) * 100
      : null;

  // Credit-Deposit Ratio
  const creditDepositRatio =
    p.advances !== null && p.deposits !== null && p.deposits !== 0
      ? p.advances / p.deposits
      : null;

  // YoY growth
  const niiPrior =
    priorRow && priorRow.interestEarned !== null
      ? null // We don't have prior NII directly stored for this purpose in priorRow select; recompute
      : null;
  const niiGrowthYoy = pctChange(
    nii,
    await fetchPriorNii(stockId, priorFY, p.resultType),
  );
  const patGrowthYoy = pctChange(
    p.netProfit,
    priorRow?.netProfit?.toNumber() ?? null,
  );
  const depositGrowthYoy = pctChange(
    p.deposits,
    priorRow?.deposits?.toNumber() ?? null,
  );
  const advanceGrowthYoy = pctChange(
    p.advances,
    priorRow?.advances?.toNumber() ?? null,
  );
  const assetGrowthYoy = pctChange(
    p.totalAssets,
    priorRow?.totalAssets?.toNumber() ?? null,
  );

  const data: Prisma.BankingFundamentalUpsertArgs["create"] = {
    stockId,
    fiscalYear: p.fiscalYear,
    reportDate: p.reportDate,
    filingDate: p.filingDate,
    xbrlUrl: p.xbrlUrl,
    resultType: p.resultType,
    source,
    xbrlTaxonomy: "in_capmkt",

    interestEarned: safeNumber(p.interestEarned),
    interestExpended: safeNumber(p.interestExpended),
    interestOnAdvances: safeNumber(p.interestOnAdvances),
    revenueOnInvestments: safeNumber(p.revenueOnInvestments),
    interestOnRbiBalances: safeNumber(p.interestOnRbiBalances),
    otherInterest: safeNumber(p.otherInterest),
    otherIncome: safeNumber(p.otherIncome),
    employeesCost: safeNumber(p.employeesCost),
    operatingExpenses: safeNumber(p.operatingExpenses),
    otherOperatingExpenses: safeNumber(p.otherOperatingExpenses),
    expenditureExclProvisions: safeNumber(p.expenditureExclProvisions),
    ppop: safeNumber(p.ppop),
    provisions: safeNumber(p.provisions),
    exceptionalItems: safeNumber(p.exceptionalItems),
    extraordinaryItems: safeNumber(p.extraordinaryItems),
    profitBeforeTax: safeNumber(p.profitBeforeTax),
    tax: safeNumber(p.tax),
    profitAfterTax: safeNumber(p.profitAfterTax),
    netProfit: safeNumber(p.netProfit),

    capital: safeNumber(p.capital),
    reservesAndSurplus: safeNumber(p.reservesAndSurplus),
    reserveExclRevaluation: safeNumber(p.reserveExclRevaluation),
    deposits: safeNumber(p.deposits),
    borrowings: safeNumber(p.borrowings),
    otherLiabilities: safeNumber(p.otherLiabilities),
    capitalAndLiabilities: safeNumber(p.capitalAndLiabilities),
    cashAndBalancesWithRbi: safeNumber(p.cashAndBalancesWithRbi),
    balancesWithBanks: safeNumber(p.balancesWithBanks),
    investments: safeNumber(p.investments),
    advances: safeNumber(p.advances),
    fixedAssets: safeNumber(p.fixedAssets),
    otherAssets: safeNumber(p.otherAssets),
    totalAssets: safeNumber(p.totalAssets),

    cashFromOperating: safeNumber(p.cashFromOperating),
    cashFromInvesting: safeNumber(p.cashFromInvesting),
    cashFromFinancing: safeNumber(p.cashFromFinancing),
    netCashFlow: safeNumber(p.netCashFlow),

    gnpaAbsolute: safeNumber(p.gnpaAbsolute),
    nnpaAbsolute: safeNumber(p.nnpaAbsolute),
    gnpaPct: decimalRatio(p.gnpaPct),
    nnpaPct: decimalRatio(p.nnpaPct),
    pcr: decimalRatio(pcr),

    cet1Ratio: decimalRatio(p.cet1Ratio),
    additionalTier1Ratio: decimalRatio(p.additionalTier1Ratio),
    tier1Ratio: decimalRatio(tier1Ratio),
    roaDisclosed: decimalRatio(p.roaDisclosed),

    basicEps: decimalPerShare(p.basicEps),
    dilutedEps: decimalPerShare(p.dilutedEps),
    faceValueShare: decimalPerShare(p.faceValueShare),
    paidUpEquityCapital: safeNumber(p.paidUpEquityCapital),

    nii: safeNumber(nii),
    totalIncome: safeNumber(totalIncome),
    netInterestMargin: decimalRatio(netInterestMargin),
    costToIncomeRatio: decimalRatio(costToIncomeRatio),
    creditCostPct: decimalRatio(creditCostPct),
    roe: decimalRatio(roe !== null ? roe / 100 : null), // store as ratio
    creditDepositRatio: decimalRatio(creditDepositRatio),
    netWorth: safeNumber(netWorth),
    bookValuePerShare: decimalPerShare(bookValuePerShare),

    niiGrowthYoy: decimalPct(niiGrowthYoy),
    patGrowthYoy: decimalPct(patGrowthYoy),
    depositGrowthYoy: decimalPct(depositGrowthYoy),
    advanceGrowthYoy: decimalPct(advanceGrowthYoy),
    assetGrowthYoy: decimalPct(assetGrowthYoy),
  };

  const row = await prisma.bankingFundamental.upsert({
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

/**
 * Compute average of current and prior-year advances for credit cost denominator.
 */
async function fetchAvgAdvances(
  stockId: string,
  currentFY: string,
  currentAdvances: number | null,
  resultType: string,
): Promise<number | null> {
  if (currentAdvances === null) return null;
  const priorFY = decrementFY(currentFY);
  const prior = await prisma.bankingFundamental.findUnique({
    where: {
      stockId_fiscalYear_resultType: { stockId, fiscalYear: priorFY, resultType },
    },
    select: { advances: true },
  });
  if (!prior || prior.advances === null) return currentAdvances;
  return (currentAdvances + prior.advances.toNumber()) / 2;
}

/**
 * NIM denominator: average of (advances + investments) at current year-end and prior year-end.
 */
async function fetchAvgInterestEarningAssets(
  stockId: string,
  currentFY: string,
  currentAdvances: number | null,
  currentInvestments: number | null,
  resultType: string,
): Promise<number | null> {
  const currentIEA =
    currentAdvances !== null && currentInvestments !== null
      ? currentAdvances + currentInvestments
      : (currentAdvances ?? currentInvestments ?? null);
  if (currentIEA === null) return null;

  const priorFY = decrementFY(currentFY);
  const prior = await prisma.bankingFundamental.findUnique({
    where: {
      stockId_fiscalYear_resultType: { stockId, fiscalYear: priorFY, resultType },
    },
    select: { advances: true, investments: true },
  });
  if (!prior) return currentIEA;
  const priorIEA =
    prior.advances !== null && prior.investments !== null
      ? prior.advances.toNumber() + prior.investments.toNumber()
      : (prior.advances?.toNumber() ?? prior.investments?.toNumber() ?? null);
  if (priorIEA === null) return currentIEA;
  return (currentIEA + priorIEA) / 2;
}

async function fetchPriorNii(
  stockId: string,
  priorFY: string,
  resultType: string,
): Promise<number | null> {
  const prior = await prisma.bankingFundamental.findUnique({
    where: {
      stockId_fiscalYear_resultType: { stockId, fiscalYear: priorFY, resultType },
    },
    select: { nii: true },
  });
  return prior?.nii?.toNumber() ?? null;
}
