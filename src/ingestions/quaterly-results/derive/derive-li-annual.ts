// ─────────────────────────────────────────────────────────────
// PURE derivation for LifeInsuranceFundamental (annual) — deriveFromRow bridge.
// VERBATIM EXTRACTION of the inline block in ingest-li-annual.ts (CN-8).
//
// 7 derived columns:
//   • NON-prior: netWorth, bookValuePerShare, newBusinessPremiumPct,
//     expenseRatioPolicyholders.
//   • PRIOR-dependent (exempt): roe (avg equity), premiumGrowthYoy, patGrowthYoy.
// Disclosed-raw (solvencyRatio, persistency13/25/37/49/61) stay in the ingester.
//
// ── ★ PB-3 GATE ADDED — 2026-08-11, same shape as BankingFundamental/NbfcFundamental ──
// derive-banking-annual.ts and derive-nbfc-annual.ts both had a corrupt-source-fact
// exposure through bookValuePerShare (KOTAKBANK/MOTILALOFS/LTF/CANFINHOME — see
// parser-backlog.ts PB-3). This table had the SAME unguarded shape
// (`raw.faceValueShare ?? 10`, no plausibility check on a non-null value, no output
// bound) — zero live outliers only because face_value_share is 0% populated on this
// table today, not because anything would catch a bad one. Applying the SAME two
// helpers, IMPORTED from derive-indas-annual.ts (not reimplemented):
// boundDerived() and meaningfulBookValue(). plausibleFaceValue() is the CALLER's job
// (ingest-li-annual.ts / fill/re-derive.ts), exactly as for banking/NBFC.
//
// ── ★ THE ??10 DECISION ─────────────────────────────────────────────────────────
// KEPT — deliberately, not by default. `raw.faceValueShareSane ?? 10` now runs on the
// SANITISED value, so "never disclosed" and "disclosed but implausible" collapse to
// the SAME signal (we don't have a trustworthy face value for this row) and get the
// SAME treatment (assume the IRDAI norm). Two reasons this beats going to null:
//   1. face_value_share is 0% populated on this table — LICI/SBILIFE's bookValuePerShare
//      (₹279.66, ₹190.27, …) are ALL served via this fallback today. Switching the
//      undisclosed case to null would silently delete every currently-correct value
//      on the table, a far bigger change than "add a gate".
//   2. ₹10 is a genuine, well-documented regulatory convention (IRDAI-registered
//      insurers), not a guess invented for this fix — unlike NBFC/banking, which have
//      no comparably strong single-value prior across the whole industry, so they
//      have no fallback at all and simply decline instead.
// meaningfulBookValue() still wraps the OUTPUT regardless of which path produced the
// face value, because a corrupt paidUpEquityCapital (the CANFINHOME/ICICIBANK mirror
// shape) poisons bookValuePerShare even with a perfectly ordinary — or defaulted — face
// value; no input-side gate can cover that.
// ─────────────────────────────────────────────────────────────

import { Prisma } from "../../../generated/prisma/client.js";
import {
  safeNumber, decimalPct, decimalRatio, decimalPerShare, pctChange, sumNonNull, avgNonNull,
} from "../ingester-utils.js";
// plausibleFaceValue() is the CALLER's job (ingest-li-annual.ts / fill/re-derive.ts —
// same contract as banking/NBFC); only the two helpers this module calls directly are
// imported here. See the header note for why the ₹10 IRDAI-norm default is kept.
import { boundDerived, meaningfulBookValue } from "./derive-indas-annual.js";

export interface LiAnnualRaw {
  shareCapital: number | null;
  reservesAndSurplus: number | null;
  fairValueChangeAccount: number | null;
  paidUpEquityCapital: number | null;
  /** Caller-sanitised via plausibleFaceValue() — see the header note above. */
  faceValueShareSane: number | null;
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

export function deriveLiAnnual(
  raw: LiAnnualRaw,
  prior: LiAnnualPrior | null,
  tag: string,
): LiAnnualDerived {
  const netWorth = sumNonNull(raw.shareCapital, raw.reservesAndSurplus, raw.fairValueChangeAccount);

  let bookValuePerShare: number | null = null;
  if (netWorth !== null) {
    const equityCapital = raw.paidUpEquityCapital ?? raw.shareCapital;
    const faceValue = raw.faceValueShareSane ?? 10; // IRDAI norm for LI — kept; see header note
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
      bookValuePerShare: boundDerived(decimalPerShare(meaningfulBookValue(bookValuePerShare)), 6, "bookValuePerShare", tag),
      roe: decimalRatio(roe),
      newBusinessPremiumPct: decimalRatio(newBusinessPremiumPct),
      expenseRatioPolicyholders: decimalRatio(expenseRatio),
      premiumGrowthYoy: decimalPct(premiumGrowthYoy),
      patGrowthYoy: decimalPct(patGrowthYoy),
    },
    numbers: { premiumGrowthYoy },
  };
}
