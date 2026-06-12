// File: src/ingestions/quaterly-results/ingesters/ingest-nbfc-annual.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedNbfcAnnual } from "../xbrl/parser-nbfc.js";
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

export async function ingestNbfcAnnual(
  input: { stockId: string; parsed: ParsedNbfcAnnual; source: string },
  decision: "ingest" | "upgrade" | "refresh",
): Promise<{ status: "success" | "upgraded" | "refreshed"; rowId: string }> {
  const { stockId, parsed: p, source } = input;

  // ── Derived NBFC ratios ──

  // Total borrowings = debtSecurities + borrowings + subordinatedLiabilities + depositsLiabilities
  const totalBorrowings = sumNonNull(
    p.debtSecurities,
    p.borrowings,
    p.subordinatedLiabilities,
    p.depositsLiabilities,
  );

  // Net Worth = totalEquity (preferred) || (equityShareCapital + otherEquity)
  const netWorth =
    p.totalEquity ?? sumNonNull(p.equityShareCapital, p.otherEquity);

  // Avg AUM (Loans) for ratios that require it
  const priorFY = decrementFY(p.fiscalYear);
  const priorRow = await prisma.nbfcFundamental.findUnique({
    where: { stockId_fiscalYear: { stockId, fiscalYear: priorFY } },
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
      financeCosts: true,
      interestIncome: true,
    },
  });
  const priorLoans = priorRow?.loans?.toNumber() ?? null;
  const avgLoans = avgNonNull(p.loans, priorLoans);

  // NIM (NBFC) ≈ (interestIncome - financeCosts) / avg(loans)
  const nii =
    p.interestIncome !== null && p.financeCosts !== null
      ? p.interestIncome - p.financeCosts
      : null;
  const nim =
    nii !== null && avgLoans !== null && avgLoans !== 0 ? nii / avgLoans : null;

  // Cost-to-Income
  const totalIncomeForC2I =
    p.totalIncome ??
    sumNonNull(
      p.interestIncome,
      p.feeAndCommissionIncome,
      p.netGainOnFairValueChanges,
      p.otherIncome,
    );
  const opEx = sumNonNull(
    p.employeeBenefitExpense,
    p.depreciation,
    p.otherExpenses,
    p.feeAndCommissionExpense,
  );
  const costToIncomeRatio =
    opEx !== null && nii !== null && totalIncomeForC2I !== null
      ? opEx / (totalIncomeForC2I - (p.financeCosts ?? 0))
      : null;

  // Credit Cost % = ECL / avg(loans)
  const creditCostPct =
    p.impairmentOnFinancialInstruments !== null &&
    avgLoans !== null &&
    avgLoans !== 0
      ? p.impairmentOnFinancialInstruments / avgLoans
      : null;

  // Spread = (interestIncome / avgLoans) - (financeCosts / avgBorrowings)
  const priorBorrowings = priorRow
    ? sumNonNull(
        priorRow.debtSecurities?.toNumber() ?? null,
        priorRow.borrowings?.toNumber() ?? null,
        priorRow.subordinatedLiabilities?.toNumber() ?? null,
        priorRow.depositsLiabilities?.toNumber() ?? null,
      )
    : null;
  const avgBorrowings = avgNonNull(totalBorrowings, priorBorrowings);
  const yieldOnAdvances =
    p.interestIncome !== null && avgLoans !== null && avgLoans !== 0
      ? p.interestIncome / avgLoans
      : null;
  const costOfFunds =
    p.financeCosts !== null && avgBorrowings !== null && avgBorrowings !== 0
      ? p.financeCosts / avgBorrowings
      : null;
  const spread =
    yieldOnAdvances !== null && costOfFunds !== null
      ? yieldOnAdvances - costOfFunds
      : null;

  // Capital-to-Assets (proxy for CRAR; actual CRAR requires RWA which isn't in XBRL)
  const capitalToAssetsRatio =
    netWorth !== null && p.totalAssets !== null && p.totalAssets !== 0
      ? netWorth / p.totalAssets
      : null;

  // Borrowings to Equity (leverage)
  const borrowingsToEquity =
    totalBorrowings !== null && netWorth !== null && netWorth !== 0
      ? totalBorrowings / netWorth
      : null;

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

  // ROE
  const priorNetWorth = priorRow
    ? (priorRow.totalEquity?.toNumber() ??
      sumNonNull(
        priorRow.equityShareCapital?.toNumber() ?? null,
        priorRow.otherEquity?.toNumber() ?? null,
      ))
    : null;
  const avgEquity = avgNonNull(netWorth, priorNetWorth);
  const roe =
    p.netProfit !== null && avgEquity !== null && avgEquity !== 0
      ? p.netProfit / avgEquity
      : null;

  // YoY growth
  const aumGrowthYoy = pctChange(p.loans, priorRow?.loans?.toNumber() ?? null);
  const revenueGrowthYoy = pctChange(
    p.revenue,
    priorRow?.revenue?.toNumber() ?? null,
  );
  const patGrowthYoy = pctChange(
    p.netProfit,
    priorRow?.netProfit?.toNumber() ?? null,
  );

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

    nim: decimalRatio(nim),
    costToIncomeRatio: decimalRatio(costToIncomeRatio),
    creditCostPct: decimalRatio(creditCostPct),
    spread: decimalRatio(spread),
    capitalToAssetsRatio: decimalRatio(capitalToAssetsRatio),
    borrowingsToEquity: decimalPct(borrowingsToEquity),
    netWorth: safeNumber(netWorth),
    bookValuePerShare: decimalPerShare(bookValuePerShare),
    roe: decimalRatio(roe),

    aumGrowthYoy: decimalPct(aumGrowthYoy),
    revenueGrowthYoy: decimalPct(revenueGrowthYoy),
    patGrowthYoy: decimalPct(patGrowthYoy),
  };

  const row = await prisma.nbfcFundamental.upsert({
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
