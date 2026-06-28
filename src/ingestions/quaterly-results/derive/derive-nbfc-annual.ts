// ─────────────────────────────────────────────────────────────
// PURE derivation for NbfcFundamental (annual) — deriveFromRow bridge.
//
// VERBATIM EXTRACTION of the inline block in ingest-nbfc-annual.ts (CN-8: no
// math change). The single prior-row fetch stays in the ingester; this module
// is pure and takes the prior bundle.
//
// 12 derived columns:
//   • NON-prior (denom-aware gated): costToIncomeRatio, capitalToAssetsRatio,
//     borrowingsToEquity, netWorth, bookValuePerShare.
//   • PRIOR-dependent (exempt, determinism-checked): nim, creditCostPct, spread
//     (avg loans / avg borrowings), roe (avg equity), aumGrowthYoy,
//     revenueGrowthYoy, patGrowthYoy.
//
// FLAGS (CN-8, preserved unchanged, not fixed):
//   • costToIncomeRatio is null-gated on `nii !== null` even though nii is not
//     in its formula (opEx / (totalIncome − financeCosts)). Quirk preserved.
//   • The prior select fetched financeCosts + interestIncome but never used
//     them — dropped from the bundle (no output effect).
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

export interface NbfcAnnualRaw {
  interestIncome: number | null;
  financeCosts: number | null;
  loans: number | null;
  totalIncome: number | null;
  feeAndCommissionIncome: number | null;
  netGainOnFairValueChanges: number | null;
  otherIncome: number | null;
  employeeBenefitExpense: number | null;
  depreciation: number | null;
  otherExpenses: number | null;
  feeAndCommissionExpense: number | null;
  impairmentOnFinancialInstruments: number | null;
  debtSecurities: number | null;
  borrowings: number | null;
  subordinatedLiabilities: number | null;
  depositsLiabilities: number | null;
  totalEquity: number | null;
  equityShareCapital: number | null;
  otherEquity: number | null;
  totalAssets: number | null;
  paidUpEquityCapital: number | null;
  faceValueShare: number | null;
  netProfit: number | null;
  revenue: number | null;
}

export interface NbfcAnnualPrior {
  revenue: number | null;
  netProfit: number | null;
  loans: number | null;
  totalEquity: number | null;
  equityShareCapital: number | null;
  otherEquity: number | null;
  debtSecurities: number | null;
  borrowings: number | null;
  subordinatedLiabilities: number | null;
  depositsLiabilities: number | null;
}

export interface NbfcAnnualDerivedColumns {
  nim: Prisma.Decimal | null;
  costToIncomeRatio: Prisma.Decimal | null;
  creditCostPct: Prisma.Decimal | null;
  spread: Prisma.Decimal | null;
  capitalToAssetsRatio: Prisma.Decimal | null;
  borrowingsToEquity: Prisma.Decimal | null;
  netWorth: Prisma.Decimal | null;
  bookValuePerShare: Prisma.Decimal | null;
  roe: Prisma.Decimal | null;
  aumGrowthYoy: Prisma.Decimal | null;
  revenueGrowthYoy: Prisma.Decimal | null;
  patGrowthYoy: Prisma.Decimal | null;
}

export interface NbfcAnnualDerived {
  columns: NbfcAnnualDerivedColumns;
  numbers: { revenueGrowthYoy: number | null };
}

export function deriveNbfcAnnual(
  raw: NbfcAnnualRaw,
  prior: NbfcAnnualPrior | null,
): NbfcAnnualDerived {
  const totalBorrowings = sumNonNull(
    raw.debtSecurities,
    raw.borrowings,
    raw.subordinatedLiabilities,
    raw.depositsLiabilities,
  );

  const netWorth = raw.totalEquity ?? sumNonNull(raw.equityShareCapital, raw.otherEquity);

  const priorLoans = prior?.loans ?? null;
  const avgLoans = avgNonNull(raw.loans, priorLoans);

  const nii =
    raw.interestIncome !== null && raw.financeCosts !== null
      ? raw.interestIncome - raw.financeCosts
      : null;
  const nim = nii !== null && avgLoans !== null && avgLoans !== 0 ? nii / avgLoans : null;

  const totalIncomeForC2I =
    raw.totalIncome ??
    sumNonNull(
      raw.interestIncome,
      raw.feeAndCommissionIncome,
      raw.netGainOnFairValueChanges,
      raw.otherIncome,
    );
  const opEx = sumNonNull(
    raw.employeeBenefitExpense,
    raw.depreciation,
    raw.otherExpenses,
    raw.feeAndCommissionExpense,
  );
  const costToIncomeRatio =
    opEx !== null && nii !== null && totalIncomeForC2I !== null
      ? opEx / (totalIncomeForC2I - (raw.financeCosts ?? 0))
      : null;

  const creditCostPct =
    raw.impairmentOnFinancialInstruments !== null && avgLoans !== null && avgLoans !== 0
      ? raw.impairmentOnFinancialInstruments / avgLoans
      : null;

  const priorBorrowings = prior
    ? sumNonNull(
        prior.debtSecurities,
        prior.borrowings,
        prior.subordinatedLiabilities,
        prior.depositsLiabilities,
      )
    : null;
  const avgBorrowings = avgNonNull(totalBorrowings, priorBorrowings);
  const yieldOnAdvances =
    raw.interestIncome !== null && avgLoans !== null && avgLoans !== 0
      ? raw.interestIncome / avgLoans
      : null;
  const costOfFunds =
    raw.financeCosts !== null && avgBorrowings !== null && avgBorrowings !== 0
      ? raw.financeCosts / avgBorrowings
      : null;
  const spread =
    yieldOnAdvances !== null && costOfFunds !== null ? yieldOnAdvances - costOfFunds : null;

  const capitalToAssetsRatio =
    netWorth !== null && raw.totalAssets !== null && raw.totalAssets !== 0
      ? netWorth / raw.totalAssets
      : null;

  const borrowingsToEquity =
    totalBorrowings !== null && netWorth !== null && netWorth !== 0
      ? totalBorrowings / netWorth
      : null;

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

  const priorNetWorth = prior
    ? (prior.totalEquity ?? sumNonNull(prior.equityShareCapital, prior.otherEquity))
    : null;
  const avgEquity = avgNonNull(netWorth, priorNetWorth);
  const roe =
    raw.netProfit !== null && avgEquity !== null && avgEquity !== 0
      ? raw.netProfit / avgEquity
      : null;

  const aumGrowthYoy = pctChange(raw.loans, prior?.loans ?? null);
  const revenueGrowthYoy = pctChange(raw.revenue, prior?.revenue ?? null);
  const patGrowthYoy = pctChange(raw.netProfit, prior?.netProfit ?? null);

  return {
    columns: {
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
    },
    numbers: { revenueGrowthYoy },
  };
}
