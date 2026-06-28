// ─────────────────────────────────────────────────────────────
// PURE derivation for LifeInsuranceFundamental (annual) — deriveFromRow bridge.
// VERBATIM EXTRACTION of the inline block in ingest-li-annual.ts (CN-8).
//
// 7 derived columns:
//   • NON-prior: netWorth, bookValuePerShare, newBusinessPremiumPct,
//     expenseRatioPolicyholders.
//   • PRIOR-dependent (exempt): roe (avg equity), premiumGrowthYoy, patGrowthYoy.
// Disclosed-raw (solvencyRatio, persistency13/25/37/49/61) stay in the ingester.
// ─────────────────────────────────────────────────────────────

import { Prisma } from "../../../generated/prisma/client.js";
import {
  safeNumber, decimalPct, decimalRatio, decimalPerShare, pctChange, sumNonNull, avgNonNull,
} from "../ingester-utils.js";

export interface LiAnnualRaw {
  shareCapital: number | null;
  reservesAndSurplus: number | null;
  fairValueChangeAccount: number | null;
  paidUpEquityCapital: number | null;
  faceValueShare: number | null;
  incomeFirstYearPremium: number | null;
  grossPremiumIncome: number | null;
  totalOperatingExpenses: number | null;
  netProfit: number | null;
}
export interface LiAnnualPrior {
  shareCapital: number | null;
  reservesAndSurplus: number | null;
  fairValueChangeAccount: number | null;
  grossPremiumIncome: number | null;
  netProfit: number | null;
}
export interface LiAnnualDerivedColumns {
  netWorth: Prisma.Decimal | null;
  bookValuePerShare: Prisma.Decimal | null;
  roe: Prisma.Decimal | null;
  newBusinessPremiumPct: Prisma.Decimal | null;
  expenseRatioPolicyholders: Prisma.Decimal | null;
  premiumGrowthYoy: Prisma.Decimal | null;
  patGrowthYoy: Prisma.Decimal | null;
}
export interface LiAnnualDerived {
  columns: LiAnnualDerivedColumns;
  numbers: { premiumGrowthYoy: number | null };
}

export function deriveLiAnnual(raw: LiAnnualRaw, prior: LiAnnualPrior | null): LiAnnualDerived {
  const netWorth = sumNonNull(raw.shareCapital, raw.reservesAndSurplus, raw.fairValueChangeAccount);

  let bookValuePerShare: number | null = null;
  if (netWorth !== null) {
    const equityCapital = raw.paidUpEquityCapital ?? raw.shareCapital;
    const faceValue = raw.faceValueShare ?? 10; // IRDAI norm for LI
    if (equityCapital !== null && equityCapital > 0 && faceValue > 0) {
      const sharesCr = equityCapital / faceValue;
      if (sharesCr > 0) bookValuePerShare = netWorth / sharesCr;
    }
  }

  const newBusinessPremiumPct =
    raw.incomeFirstYearPremium !== null && raw.grossPremiumIncome !== null && raw.grossPremiumIncome !== 0
      ? raw.incomeFirstYearPremium / raw.grossPremiumIncome
      : null;

  const expenseRatio =
    raw.totalOperatingExpenses !== null && raw.grossPremiumIncome !== null && raw.grossPremiumIncome !== 0
      ? raw.totalOperatingExpenses / raw.grossPremiumIncome
      : null;

  const priorNetWorth = prior
    ? sumNonNull(prior.shareCapital, prior.reservesAndSurplus, prior.fairValueChangeAccount)
    : null;
  const avgEquity = avgNonNull(netWorth, priorNetWorth);
  const roe =
    raw.netProfit !== null && avgEquity !== null && avgEquity !== 0 ? raw.netProfit / avgEquity : null;

  const premiumGrowthYoy = pctChange(raw.grossPremiumIncome, prior?.grossPremiumIncome ?? null);
  const patGrowthYoy = pctChange(raw.netProfit, prior?.netProfit ?? null);

  return {
    columns: {
      netWorth: safeNumber(netWorth),
      bookValuePerShare: decimalPerShare(bookValuePerShare),
      roe: decimalRatio(roe),
      newBusinessPremiumPct: decimalRatio(newBusinessPremiumPct),
      expenseRatioPolicyholders: decimalRatio(expenseRatio),
      premiumGrowthYoy: decimalPct(premiumGrowthYoy),
      patGrowthYoy: decimalPct(patGrowthYoy),
    },
    numbers: { premiumGrowthYoy },
  };
}
