// ─────────────────────────────────────────────────────────────
// PURE derivation for GeneralInsuranceFundamental (annual) — deriveFromRow.
// VERBATIM EXTRACTION of the inline block in ingest-gi-annual.ts (CN-8).
//
// 6 derived columns:
//   • NON-prior: netWorth, bookValuePerShare, netUnderwritingMargin (= 1 −
//     combinedRatio; combinedRatio is a disclosed-raw input).
//   • PRIOR-dependent (exempt): roe (avg equity), gpwGrowthYoy, patGrowthYoy.
// Disclosed-raw (combinedRatio, incurredClaimRatio, expensesOfManagementRatio,
// netRetentionRatio, solvencyRatio) stay in the ingester.
// ─────────────────────────────────────────────────────────────

import { Prisma } from "../../../generated/prisma/client.js";
import {
  safeNumber, decimalPct, decimalRatio, decimalPerShare, pctChange, sumNonNull, avgNonNull,
} from "../ingester-utils.js";

export interface GiAnnualRaw {
  shareCapital: number | null;
  reservesAndSurplus: number | null;
  fairValueChangeAccount: number | null;
  paidUpEquityCapital: number | null;
  faceValueShare: number | null;
  combinedRatio: number | null;
  netProfit: number | null;
  grossPremiumsWritten: number | null;
}
export interface GiAnnualPrior {
  shareCapital: number | null;
  reservesAndSurplus: number | null;
  fairValueChangeAccount: number | null;
  grossPremiumsWritten: number | null;
  netProfit: number | null;
}
export interface GiAnnualDerivedColumns {
  netWorth: Prisma.Decimal | null;
  bookValuePerShare: Prisma.Decimal | null;
  roe: Prisma.Decimal | null;
  netUnderwritingMargin: Prisma.Decimal | null;
  gpwGrowthYoy: Prisma.Decimal | null;
  patGrowthYoy: Prisma.Decimal | null;
}
export interface GiAnnualDerived {
  columns: GiAnnualDerivedColumns;
  numbers: { gpwGrowthYoy: number | null };
}

export function deriveGiAnnual(raw: GiAnnualRaw, prior: GiAnnualPrior | null): GiAnnualDerived {
  const netWorth = sumNonNull(raw.shareCapital, raw.reservesAndSurplus, raw.fairValueChangeAccount);

  let bookValuePerShare: number | null = null;
  if (netWorth !== null) {
    const equityCapital = raw.paidUpEquityCapital ?? raw.shareCapital;
    const faceValue = raw.faceValueShare ?? 10; // ₹10 IRDAI norm for GI
    if (equityCapital !== null && equityCapital > 0 && faceValue > 0) {
      const sharesCr = equityCapital / faceValue;
      if (sharesCr > 0) bookValuePerShare = netWorth / sharesCr;
    }
  }

  const netUnderwritingMargin = raw.combinedRatio !== null ? 1 - raw.combinedRatio : null;

  const priorNetWorth = prior
    ? sumNonNull(prior.shareCapital, prior.reservesAndSurplus, prior.fairValueChangeAccount)
    : null;
  const avgEquity = avgNonNull(netWorth, priorNetWorth);
  const roe =
    raw.netProfit !== null && avgEquity !== null && avgEquity !== 0 ? raw.netProfit / avgEquity : null;

  const gpwGrowthYoy = pctChange(raw.grossPremiumsWritten, prior?.grossPremiumsWritten ?? null);
  const patGrowthYoy = pctChange(raw.netProfit, prior?.netProfit ?? null);

  return {
    columns: {
      netWorth: safeNumber(netWorth),
      bookValuePerShare: decimalPerShare(bookValuePerShare),
      roe: decimalRatio(roe),
      netUnderwritingMargin: decimalRatio(netUnderwritingMargin),
      gpwGrowthYoy: decimalPct(gpwGrowthYoy),
      patGrowthYoy: decimalPct(patGrowthYoy),
    },
    numbers: { gpwGrowthYoy },
  };
}
