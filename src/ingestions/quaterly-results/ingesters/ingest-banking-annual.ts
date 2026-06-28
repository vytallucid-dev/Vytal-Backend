// File: src/ingestions/quaterly-results/ingesters/ingest-banking-annual.ts (NEW)

import { prisma } from "../../../db/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ParsedBankingAnnual } from "../xbrl/parser-banking.js";
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
import { deriveBankingAnnual } from "../derive/derive-banking-annual.js";

export async function ingestBankingAnnual(
  input: { stockId: string; parsed: ParsedBankingAnnual; source: string },
  decision: "ingest" | "refresh",
): Promise<{ status: "success" | "refreshed" | "rejected"; rowId: string }> {
  const { stockId, parsed: p, source } = input;
  const entity = `${stockId}@${p.fiscalYear}@${p.resultType}`;
  const runRef = resultsRunRef(`Y-${p.fiscalYear}`);
  if (
    await financialShapeReject({
      table: "BankingFundamental",
      entity,
      runRef,
      coreA: p.interestEarned,
      coreB: p.netProfit,
      coreLabel: "interestEarned or netProfit",
    })
  ) {
    return { status: "rejected", rowId: "" };
  }

  // ── Prior-year row (averaging denominators + YoY) — ONE fetch. The former
  // inline helpers' four lookups all hit this same prior-FY/basis row; the
  // avg-denominator + prior-NII fallback semantics live in deriveBankingAnnual. ──
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
      advances: true,
      investments: true,
      nii: true,
      netProfit: true,
      deposits: true,
      totalAssets: true,
    },
  });

  // ── Derive all 16 stored columns — SINGLE PATH (ingestion ≡ fill). ──
  const derived = deriveBankingAnnual(
    {
      interestEarned: p.interestEarned,
      interestExpended: p.interestExpended,
      otherIncome: p.otherIncome,
      expenditureExclProvisions: p.expenditureExclProvisions,
      capital: p.capital,
      reservesAndSurplus: p.reservesAndSurplus,
      paidUpEquityCapital: p.paidUpEquityCapital,
      faceValueShare: p.faceValueShare,
      gnpaAbsolute: p.gnpaAbsolute,
      nnpaAbsolute: p.nnpaAbsolute,
      cet1Ratio: p.cet1Ratio,
      additionalTier1Ratio: p.additionalTier1Ratio,
      provisions: p.provisions,
      advances: p.advances,
      investments: p.investments,
      deposits: p.deposits,
      netProfit: p.netProfit,
      totalAssets: p.totalAssets,
    },
    priorRow
      ? {
          capital: priorRow.capital?.toNumber() ?? null,
          reservesAndSurplus: priorRow.reservesAndSurplus?.toNumber() ?? null,
          advances: priorRow.advances?.toNumber() ?? null,
          investments: priorRow.investments?.toNumber() ?? null,
          nii: priorRow.nii?.toNumber() ?? null,
          netProfit: priorRow.netProfit?.toNumber() ?? null,
          deposits: priorRow.deposits?.toNumber() ?? null,
          totalAssets: priorRow.totalAssets?.toNumber() ?? null,
        }
      : null,
  );
  // The record guards read the pre-Decimal NII-YoY number.
  const niiGrowthYoy = derived.numbers.niiGrowthYoy;

  if (decision === "ingest") {
    await financialRecordGuards({
      table: "BankingFundamental",
      entity,
      runRef,
      scale: [
        ["interestEarned", p.interestEarned],
        ["totalAssets", p.totalAssets],
      ],
      yoy: niiGrowthYoy,
      yoyLabel: "niiGrowthYoy",
      npa: { nnpa: p.nnpaAbsolute, gnpa: p.gnpaAbsolute },
    });
  }

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
    // Disclosed-raw ratios (parsed-direct, fillable as-is — NOT derived):
    gnpaPct: decimalRatio(p.gnpaPct),
    nnpaPct: decimalRatio(p.nnpaPct),

    cet1Ratio: decimalRatio(p.cet1Ratio),
    additionalTier1Ratio: decimalRatio(p.additionalTier1Ratio),
    roaDisclosed: decimalRatio(p.roaDisclosed),

    basicEps: decimalPerShare(p.basicEps),
    dilutedEps: decimalPerShare(p.dilutedEps),
    faceValueShare: decimalPerShare(p.faceValueShare),
    paidUpEquityCapital: safeNumber(p.paidUpEquityCapital),

    // Derived — the 16 computed columns (nii, totalIncome, NIM, costToIncome,
    // creditCost, roe, CD-ratio, netWorth, bvps, pcr, tier1, *GrowthYoy) all
    // from the single deriveBankingAnnual path so ingestion ≡ fill.
    ...derived.columns,
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
