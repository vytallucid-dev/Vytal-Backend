// File: src/scoring/metrics/banking-load.ts
//
// STANDALONE loader for the BANKING metric raw-value layer. The banking analogue of
// metrics/load.ts: SELECTs resultType="standalone" banking rows + the bank's
// BankSupplementary (CASA/Tier-1) and normalizes Decimal→number into the pure
// BankingCtx. NEVER reads consolidated. A missing standalone period is simply fewer
// rows (the pure fns surface UNAVAILABLE). PURE shapes out; DB in.

import { prisma } from "../../db/prisma.js";
import { fyOrdinal, quarterOrdinal } from "./types.js";
import type { BankingAnnual, BankingQuarter, BankingCtx, SupplementaryPoint } from "./banking-types.js";

const n = (d: { toNumber: () => number } | null): number | null => (d === null ? null : d.toNumber());

export async function loadBankingAnnualStandalone(stockId: string): Promise<BankingAnnual[]> {
  const rows = await prisma.bankingFundamental.findMany({
    where: { stockId, resultType: "standalone" },
    orderBy: { fiscalYear: "asc" },
  });
  return rows.map((r) => ({
    fiscalYear: r.fiscalYear,
    fyOrdinal: fyOrdinal(r.fiscalYear),
    interestEarned: n(r.interestEarned),
    interestExpended: n(r.interestExpended),
    otherIncome: n(r.otherIncome),
    operatingExpenses: n(r.operatingExpenses),
    ppop: n(r.ppop),
    profitBeforeTax: n(r.profitBeforeTax),
    netProfit: n(r.netProfit),
    advances: n(r.advances),
    investments: n(r.investments),
    cashAndBalancesWithRbi: n(r.cashAndBalancesWithRbi),
    balancesWithBanks: n(r.balancesWithBanks),
    totalAssets: n(r.totalAssets),
    deposits: n(r.deposits),
    gnpaAbsolute: n(r.gnpaAbsolute),
    nnpaAbsolute: n(r.nnpaAbsolute),
    gnpaPct: n(r.gnpaPct),
    nnpaPct: n(r.nnpaPct),
    cet1Ratio: n(r.cet1Ratio),
    additionalTier1Ratio: n(r.additionalTier1Ratio),
    tier1Ratio: n(r.tier1Ratio),
    roaDisclosed: n(r.roaDisclosed),
    stored: {
      pcr: n(r.pcr),
      costToIncomeRatio: n(r.costToIncomeRatio),
      netInterestMargin: n(r.netInterestMargin),
      nii: n(r.nii),
    },
  }));
}

export async function loadBankingQuarterlyStandalone(stockId: string): Promise<BankingQuarter[]> {
  const rows = await prisma.bankingQuarterlyResult.findMany({
    where: { stockId, resultType: "standalone" },
    orderBy: [{ fiscalYear: "asc" }, { quarter: "asc" }],
  });
  return rows.map((r) => ({
    fiscalYear: r.fiscalYear,
    quarter: r.quarter,
    qOrdinal: quarterOrdinal(r.fiscalYear, r.quarter),
    interestEarned: n(r.interestEarned),
    interestExpended: n(r.interestExpended),
    otherIncome: n(r.otherIncome),
    operatingExpenses: n(r.operatingExpenses),
    ppop: n(r.ppop),
    netProfit: n(r.netProfit),
    gnpaAbsolute: n(r.gnpaAbsolute),
    nnpaAbsolute: n(r.nnpaAbsolute),
    gnpaPct: n(r.gnpaPct),
    nnpaPct: n(r.nnpaPct),
    cet1Ratio: n(r.cet1Ratio),
    additionalTier1Ratio: n(r.additionalTier1Ratio),
    roaQuarterly: n(r.roaQuarterly),
  }));
}

/** Load a bank's BankSupplementary (latest version per cell) into CASA + Tier-1 maps. */
export async function loadSupplementary(symbol: string): Promise<{ casa: Map<string, SupplementaryPoint>; tier1: Map<string, SupplementaryPoint> }> {
  const rows = await prisma.bankSupplementary.findMany({
    where: { symbol, metric: { in: ["casa_pct", "tier1_pct"] } },
    orderBy: { version: "desc" }, // newest version first → first-seen wins per cell
    select: { metric: true, fiscalYear: true, value: true, status: true, confidence: true },
  });
  const casa = new Map<string, SupplementaryPoint>();
  const tier1 = new Map<string, SupplementaryPoint>();
  for (const r of rows) {
    const target = r.metric === "casa_pct" ? casa : tier1;
    if (target.has(r.fiscalYear)) continue; // first (newest version) wins
    target.set(r.fiscalYear, { fiscalYear: r.fiscalYear, value: n(r.value), status: r.status, confidence: r.confidence });
  }
  return { casa, tier1 };
}

/** Build the full banking compute context for a stock. */
export async function loadBankingCtx(symbol: string, stockId: string): Promise<BankingCtx> {
  const [annual, quarterly, supp] = await Promise.all([
    loadBankingAnnualStandalone(stockId),
    loadBankingQuarterlyStandalone(stockId),
    loadSupplementary(symbol),
  ]);
  return { symbol, annual, quarterly, casa: supp.casa, tier1: supp.tier1 };
}
