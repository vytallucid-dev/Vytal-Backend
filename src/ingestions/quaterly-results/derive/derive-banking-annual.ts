// ─────────────────────────────────────────────────────────────
// PURE derivation for BankingFundamental (annual) — deriveFromRow bridge.
//
// VERBATIM EXTRACTION of the inline block + the three prior-year helpers
// (fetchAvgAdvances / fetchAvgInterestEarningAssets / fetchPriorNii) in
// ingest-banking-annual.ts (CN-8: no math change). The I/O is hoisted to the
// ingester, which now does ONE prior-row fetch (the four original fetches all
// hit the same prior-FY/basis row) and passes the prior bundle in. This module
// reproduces the avg-denominator + prior-NII fallback semantics EXACTLY.
//
// 16 derived columns:
//   • NON-prior (denom-aware byte-identical-gated): nii, totalIncome,
//     costToIncomeRatio, netWorth, bookValuePerShare, pcr, tier1Ratio,
//     creditDepositRatio.
//   • PRIOR-dependent (exempt, determinism-checked): creditCostPct (avg
//     advances), netInterestMargin (avg IEA), roe (avg equity), niiGrowthYoy,
//     patGrowthYoy, depositGrowthYoy, advanceGrowthYoy, assetGrowthYoy.
//
// DISCLOSED-raw ratios (gnpaPct, nnpaPct, cet1Ratio, additionalTier1Ratio,
// roaDisclosed) are PARSED-DIRECT, fillable as-is → NOT here (the ingester
// stores them). Their derived consumers ARE here: pcr (from nnpa/gnpa absolute)
// and tier1Ratio (= cet1 + at1).
//
// FLAG (CN-8, not carried): the ingester had dead code `niiPrior` (always null,
// never used) — omitted, it has no effect on any output.
// ─────────────────────────────────────────────────────────────

import { Prisma } from "../../../generated/prisma/client.js";
import {
  safeNumber,
  decimalPct,
  decimalRatio,
  decimalPerShare,
  pctChange,
  sumNonNull,
  avgNonNull,
} from "../ingester-utils.js";

export interface BankingAnnualRaw {
  interestEarned: number | null;
  interestExpended: number | null;
  otherIncome: number | null;
  expenditureExclProvisions: number | null;
  capital: number | null;
  reservesAndSurplus: number | null;
  paidUpEquityCapital: number | null;
  faceValueShare: number | null;
  gnpaAbsolute: number | null;
  nnpaAbsolute: number | null;
  cet1Ratio: number | null;
  additionalTier1Ratio: number | null;
  provisions: number | null;
  advances: number | null;
  investments: number | null;
  deposits: number | null;
  netProfit: number | null;
  totalAssets: number | null;
}

// Prior-year stored row (the four original fetches collapsed into one bundle).
export interface BankingAnnualPrior {
  capital: number | null;
  reservesAndSurplus: number | null;
  advances: number | null;
  investments: number | null;
  nii: number | null;
  netProfit: number | null;
  deposits: number | null;
  totalAssets: number | null;
}

export interface BankingAnnualDerivedColumns {
  nii: Prisma.Decimal | null;
  totalIncome: Prisma.Decimal | null;
  netInterestMargin: Prisma.Decimal | null;
  costToIncomeRatio: Prisma.Decimal | null;
  creditCostPct: Prisma.Decimal | null;
  roe: Prisma.Decimal | null;
  creditDepositRatio: Prisma.Decimal | null;
  netWorth: Prisma.Decimal | null;
  bookValuePerShare: Prisma.Decimal | null;
  pcr: Prisma.Decimal | null;
  tier1Ratio: Prisma.Decimal | null;
  niiGrowthYoy: Prisma.Decimal | null;
  patGrowthYoy: Prisma.Decimal | null;
  depositGrowthYoy: Prisma.Decimal | null;
  advanceGrowthYoy: Prisma.Decimal | null;
  assetGrowthYoy: Prisma.Decimal | null;
}

export interface BankingAnnualDerived {
  columns: BankingAnnualDerivedColumns;
  numbers: { niiGrowthYoy: number | null };
}

// ── prior-aware denominators — EXACT replicas of the former helper fns ──

/** fetchAvgAdvances: null if no current; current if no prior advances; else avg. */
function avgAdvances(currentAdvances: number | null, prior: BankingAnnualPrior | null): number | null {
  if (currentAdvances === null) return null;
  if (!prior || prior.advances === null) return currentAdvances;
  return (currentAdvances + prior.advances) / 2;
}

/** fetchAvgInterestEarningAssets: avg of (advances+investments) current & prior. */
function avgInterestEarningAssets(
  currentAdvances: number | null,
  currentInvestments: number | null,
  prior: BankingAnnualPrior | null,
): number | null {
  const currentIEA =
    currentAdvances !== null && currentInvestments !== null
      ? currentAdvances + currentInvestments
      : (currentAdvances ?? currentInvestments ?? null);
  if (currentIEA === null) return null;
  if (!prior) return currentIEA;
  const priorIEA =
    prior.advances !== null && prior.investments !== null
      ? prior.advances + prior.investments
      : (prior.advances ?? prior.investments ?? null);
  if (priorIEA === null) return currentIEA;
  return (currentIEA + priorIEA) / 2;
}

/**
 * Reproduce the 16 derived BankingFundamental columns from raw inputs + the
 * prior-year stored row. Byte-identical to the former inline block + helpers.
 */
export function deriveBankingAnnual(
  raw: BankingAnnualRaw,
  prior: BankingAnnualPrior | null,
): BankingAnnualDerived {
  const nii =
    raw.interestEarned !== null && raw.interestExpended !== null
      ? raw.interestEarned - raw.interestExpended
      : null;
  const totalIncome =
    raw.interestEarned !== null && raw.otherIncome !== null
      ? raw.interestEarned + raw.otherIncome
      : null;
  const costToIncomeRatio =
    raw.expenditureExclProvisions !== null && totalIncome !== null && totalIncome !== 0
      ? raw.expenditureExclProvisions / totalIncome
      : null;

  const netWorth = sumNonNull(raw.capital, raw.reservesAndSurplus);

  let bookValuePerShare: number | null = null;
  if (
    netWorth !== null &&
    raw.paidUpEquityCapital !== null &&
    raw.paidUpEquityCapital > 0 &&
    raw.faceValueShare !== null &&
    raw.faceValueShare > 0
  ) {
    const sharesCr = raw.paidUpEquityCapital / raw.faceValueShare;
    if (sharesCr > 0) bookValuePerShare = netWorth / sharesCr;
  }

  const pcr =
    raw.gnpaAbsolute !== null && raw.gnpaAbsolute !== 0 && raw.nnpaAbsolute !== null
      ? 1 - raw.nnpaAbsolute / raw.gnpaAbsolute
      : null;

  const tier1Ratio =
    raw.cet1Ratio !== null && raw.additionalTier1Ratio !== null
      ? raw.cet1Ratio + raw.additionalTier1Ratio
      : null;

  const avgAdv = avgAdvances(raw.advances, prior);
  const creditCostPct =
    raw.provisions !== null && avgAdv !== null && avgAdv !== 0
      ? raw.provisions / avgAdv
      : null;

  const avgIEA = avgInterestEarningAssets(raw.advances, raw.investments, prior);
  const netInterestMargin =
    nii !== null && avgIEA !== null && avgIEA !== 0 ? nii / avgIEA : null;

  const priorNetWorth = prior
    ? sumNonNull(prior.capital, prior.reservesAndSurplus)
    : null;
  const avgEquity = avgNonNull(netWorth, priorNetWorth);
  const roe =
    raw.netProfit !== null && avgEquity !== null && avgEquity !== 0
      ? (raw.netProfit / avgEquity) * 100
      : null;

  const creditDepositRatio =
    raw.advances !== null && raw.deposits !== null && raw.deposits !== 0
      ? raw.advances / raw.deposits
      : null;

  const niiGrowthYoy = pctChange(nii, prior?.nii ?? null);
  const patGrowthYoy = pctChange(raw.netProfit, prior?.netProfit ?? null);
  const depositGrowthYoy = pctChange(raw.deposits, prior?.deposits ?? null);
  const advanceGrowthYoy = pctChange(raw.advances, prior?.advances ?? null);
  const assetGrowthYoy = pctChange(raw.totalAssets, prior?.totalAssets ?? null);

  return {
    columns: {
      nii: safeNumber(nii),
      totalIncome: safeNumber(totalIncome),
      netInterestMargin: decimalRatio(netInterestMargin),
      costToIncomeRatio: decimalRatio(costToIncomeRatio),
      creditCostPct: decimalRatio(creditCostPct),
      roe: decimalRatio(roe !== null ? roe / 100 : null), // store as ratio
      creditDepositRatio: decimalRatio(creditDepositRatio),
      netWorth: safeNumber(netWorth),
      bookValuePerShare: decimalPerShare(bookValuePerShare),
      pcr: decimalRatio(pcr),
      tier1Ratio: decimalRatio(tier1Ratio),
      niiGrowthYoy: decimalPct(niiGrowthYoy),
      patGrowthYoy: decimalPct(patGrowthYoy),
      depositGrowthYoy: decimalPct(depositGrowthYoy),
      advanceGrowthYoy: decimalPct(advanceGrowthYoy),
      assetGrowthYoy: decimalPct(assetGrowthYoy),
    },
    numbers: { niiGrowthYoy },
  };
}
