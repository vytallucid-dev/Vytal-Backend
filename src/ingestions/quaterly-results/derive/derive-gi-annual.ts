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
//
// ── ★ PB-3 GATE ADDED — 2026-08-11, same shape as BankingFundamental/NbfcFundamental,
// same reasoning as derive-li-annual.ts (see its header note for the full writeup —
// this table is structurally identical, IRDAI-registered GI insurers share the same
// ₹10 face-value convention as LI). boundDerived()/meaningfulBookValue() imported from
// derive-indas-annual.ts, not reimplemented; plausibleFaceValue() is the CALLER's job.
// The ₹10 default is KEPT for the same two reasons: it's a real regulatory convention,
// not a guess, and face_value_share is 0% populated here too — going to null on the
// undisclosed case would silently delete GICRE/NIACL's currently-correct bvps values.
// ─────────────────────────────────────────────────────────────

import { Prisma } from "../../../generated/prisma/client.js";
import {
  safeNumber, decimalPct, decimalRatio, decimalPerShare, pctChange, sumNonNull, avgNonNull,
} from "../ingester-utils.js";
// plausibleFaceValue() is the CALLER's job (ingest-gi-annual.ts / fill/re-derive.ts —
// same contract as banking/NBFC/LI); only the two helpers this module calls directly
// are imported here.
import { boundDerived, meaningfulBookValue } from "./derive-indas-annual.js";

export interface GiAnnualRaw {
  shareCapital: number | null;
  reservesAndSurplus: number | null;
  fairValueChangeAccount: number | null;
  paidUpEquityCapital: number | null;
  /** Caller-sanitised via plausibleFaceValue() — see derive-li-annual.ts's header note. */
  faceValueShareSane: number | null;
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

export function deriveGiAnnual(
  raw: GiAnnualRaw,
  prior: GiAnnualPrior | null,
  tag: string,
): GiAnnualDerived {
  const netWorth = sumNonNull(raw.shareCapital, raw.reservesAndSurplus, raw.fairValueChangeAccount);

  let bookValuePerShare: number | null = null;
  if (netWorth !== null) {
    const equityCapital = raw.paidUpEquityCapital ?? raw.shareCapital;
    const faceValue = raw.faceValueShareSane ?? 10; // ₹10 IRDAI norm for GI — kept; see derive-li-annual.ts
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
      bookValuePerShare: boundDerived(decimalPerShare(meaningfulBookValue(bookValuePerShare)), 6, "bookValuePerShare", tag),
      roe: decimalRatio(roe),
      netUnderwritingMargin: decimalRatio(netUnderwritingMargin),
      gpwGrowthYoy: decimalPct(gpwGrowthYoy),
      patGrowthYoy: decimalPct(patGrowthYoy),
    },
    numbers: { gpwGrowthYoy },
  };
}
