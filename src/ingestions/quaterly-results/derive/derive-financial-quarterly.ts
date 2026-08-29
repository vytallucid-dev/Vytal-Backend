// ─────────────────────────────────────────────────────────────
// PURE derivations for the 4 financial QUARTERLY ingesters — deriveFromRow.
// VERBATIM EXTRACTIONS of the inline blocks in ingest-{banking,nbfc,li,gi}-
// quarterly.ts (CN-8: no math change). Each takes the current raw + the prior
// quarter (QoQ) + the year-ago quarter (YoY); the two fetches stay in the
// ingester. Disclosed-raw ratios (gnpa/nnpa/cet1/at1/roaQuarterly; solvency/
// persistency; combined/incurredClaim/...) stay in the ingesters — not here.
// ─────────────────────────────────────────────────────────────

import { Prisma } from "../../../generated/prisma/client.js";
import { safeNumber, decimalPct, decimalRatio, pctChange } from "../ingester-utils.js";
import { boundDerived } from "./derive-indas-annual.js";

type Dec = Prisma.Decimal | null;

// ── Banking quarterly ──
export interface BankingQRaw {
  interestEarned: number | null; interestExpended: number | null; otherIncome: number | null;
  expenditureExclProvisions: number | null; netProfit: number | null;
  gnpaAbsolute: number | null; nnpaAbsolute: number | null;
  cet1Ratio: number | null; additionalTier1Ratio: number | null; auditPending: boolean;
}
export interface BankingQPrior { nii: number | null; netProfit: number | null }
export interface BankingQDerived {
  columns: { nii: Dec; totalIncome: Dec; costToIncomeRatio: Dec; netMargin: Dec; pcr: Dec; tier1Ratio: Dec; niiQoq: Dec; niiYoy: Dec; patQoq: Dec; patYoy: Dec };
  numbers: { niiYoy: number | null };
}
export function deriveBankingQuarterly(raw: BankingQRaw, priorQ: BankingQPrior | null, yearAgoQ: BankingQPrior | null): BankingQDerived {
  const nii = raw.interestEarned !== null && raw.interestExpended !== null ? raw.interestEarned - raw.interestExpended : null;
  const totalIncome = raw.interestEarned !== null && raw.otherIncome !== null ? raw.interestEarned + raw.otherIncome : null;
  const costToIncomeRatio = raw.expenditureExclProvisions !== null && totalIncome !== null && totalIncome !== 0 ? raw.expenditureExclProvisions / totalIncome : null;
  const netMargin = raw.netProfit !== null && totalIncome !== null && totalIncome !== 0 ? (raw.netProfit / totalIncome) * 100 : null;
  const pcr = !raw.auditPending && raw.gnpaAbsolute !== null && raw.gnpaAbsolute !== 0 && raw.nnpaAbsolute !== null ? 1 - raw.nnpaAbsolute / raw.gnpaAbsolute : null;
  const tier1Ratio = !raw.auditPending && raw.cet1Ratio !== null && raw.additionalTier1Ratio !== null ? raw.cet1Ratio + raw.additionalTier1Ratio : null;
  const niiQoq = pctChange(nii, priorQ?.nii ?? null);
  const niiYoy = pctChange(nii, yearAgoQ?.nii ?? null);
  const patQoq = pctChange(raw.netProfit, priorQ?.netProfit ?? null);
  const patYoy = pctChange(raw.netProfit, yearAgoQ?.netProfit ?? null);
  // ⚠ S4.2 — banking_quarterly_results is one of the four tables the legacy
  //   backfill writes, so its narrow derived columns are bounded: RATIO columns
  //   Decimal(8,6) → ceiling 100, PERCENT columns Decimal(8,4) → ceiling 10,000.
  //   An unrepresentable display ratio becomes NULL; it never clamps and never
  //   fails an upsert carrying score-relevant columns.
  const tag = "banking-quarterly";
  return {
    columns: {
      nii: safeNumber(nii), totalIncome: safeNumber(totalIncome),
      costToIncomeRatio: boundDerived(decimalRatio(costToIncomeRatio), 2, "costToIncomeRatio", tag),
      netMargin: boundDerived(decimalPct(netMargin), 4, "netMargin", tag),
      pcr: boundDerived(decimalRatio(pcr), 2, "pcr", tag),
      tier1Ratio: boundDerived(decimalRatio(tier1Ratio), 2, "tier1Ratio", tag),
      niiQoq: boundDerived(decimalPct(niiQoq), 4, "niiQoq", tag),
      niiYoy: boundDerived(decimalPct(niiYoy), 4, "niiYoy", tag),
      patQoq: boundDerived(decimalPct(patQoq), 4, "patQoq", tag),
      patYoy: boundDerived(decimalPct(patYoy), 4, "patYoy", tag),
    },
    numbers: { niiYoy },
  };
}

// ── NBFC quarterly ──
export interface NbfcQRaw { interestIncome: number | null; financeCosts: number | null; netProfit: number | null; totalIncome: number | null; revenue: number | null }
export interface NbfcQPrior { revenue: number | null; netProfit: number | null }
export interface NbfcQDerived {
  columns: { nii: Dec; netMargin: Dec; revenueQoq: Dec; revenueYoy: Dec; patQoq: Dec; patYoy: Dec };
  numbers: { revenueYoy: number | null };
}
export function deriveNbfcQuarterly(raw: NbfcQRaw, priorQ: NbfcQPrior | null, yearAgoQ: NbfcQPrior | null): NbfcQDerived {
  const nii = raw.interestIncome !== null && raw.financeCosts !== null ? raw.interestIncome - raw.financeCosts : null;
  const netMargin = raw.netProfit !== null && raw.totalIncome !== null && raw.totalIncome !== 0 ? (raw.netProfit / raw.totalIncome) * 100 : null;
  const revenueQoq = pctChange(raw.revenue, priorQ?.revenue ?? null);
  const revenueYoy = pctChange(raw.revenue, yearAgoQ?.revenue ?? null);
  const patQoq = pctChange(raw.netProfit, priorQ?.netProfit ?? null);
  const patYoy = pctChange(raw.netProfit, yearAgoQ?.netProfit ?? null);
  // S8.1b — NbfcQuarterlyResult's five narrow columns are all Decimal(8,4) →
  //   maxIntDigits 4, ceiling 10,000. pat_qoq already stores 6880.6371
  //   (BAJAJFINSV Q1 FY27 standalone, 68.8% of ceiling) — the tightest of them.
  const tag = "nbfc-quarterly";
  return {
    columns: {
      nii: safeNumber(nii),
      netMargin: boundDerived(decimalPct(netMargin), 4, "netMargin", tag),
      revenueQoq: boundDerived(decimalPct(revenueQoq), 4, "revenueQoq", tag),
      revenueYoy: boundDerived(decimalPct(revenueYoy), 4, "revenueYoy", tag),
      patQoq: boundDerived(decimalPct(patQoq), 4, "patQoq", tag),
      patYoy: boundDerived(decimalPct(patYoy), 4, "patYoy", tag),
    },
    numbers: { revenueYoy },
  };
}

// ── Life-insurance quarterly ──
export interface LiQRaw { incomeFirstYearPremium: number | null; grossPremiumIncome: number | null; totalOperatingExpenses: number | null; netProfit: number | null; totalRevenuePolicyholders: number | null }
export interface LiQPrior { grossPremiumIncome: number | null; netProfit: number | null }
export interface LiQDerived {
  columns: { newBusinessPremiumPct: Dec; expenseRatioPolicyholders: Dec; netMargin: Dec; premiumQoq: Dec; premiumYoy: Dec; patQoq: Dec; patYoy: Dec };
  numbers: { premiumYoy: number | null };
}
export function deriveLiQuarterly(raw: LiQRaw, priorQ: LiQPrior | null, yearAgoQ: LiQPrior | null): LiQDerived {
  const newBusinessPremiumPct = raw.incomeFirstYearPremium !== null && raw.grossPremiumIncome !== null && raw.grossPremiumIncome !== 0 ? raw.incomeFirstYearPremium / raw.grossPremiumIncome : null;
  const expenseRatio = raw.totalOperatingExpenses !== null && raw.grossPremiumIncome !== null && raw.grossPremiumIncome !== 0 ? raw.totalOperatingExpenses / raw.grossPremiumIncome : null;
  const netMargin = raw.netProfit !== null && raw.totalRevenuePolicyholders !== null && raw.totalRevenuePolicyholders !== 0 ? (raw.netProfit / raw.totalRevenuePolicyholders) * 100 : null;
  const premiumQoq = pctChange(raw.grossPremiumIncome, priorQ?.grossPremiumIncome ?? null);
  const premiumYoy = pctChange(raw.grossPremiumIncome, yearAgoQ?.grossPremiumIncome ?? null);
  const patQoq = pctChange(raw.netProfit, priorQ?.netProfit ?? null);
  const patYoy = pctChange(raw.netProfit, yearAgoQ?.netProfit ?? null);
  // S8.1b — RATIO columns Decimal(8,6) → ceiling 100; PERCENT columns
  //   Decimal(8,4) → ceiling 10,000.
  const tag = "li-quarterly";
  return {
    columns: {
      newBusinessPremiumPct: boundDerived(decimalRatio(newBusinessPremiumPct), 2, "newBusinessPremiumPct", tag),
      expenseRatioPolicyholders: boundDerived(decimalRatio(expenseRatio), 2, "expenseRatioPolicyholders", tag),
      netMargin: boundDerived(decimalPct(netMargin), 4, "netMargin", tag),
      premiumQoq: boundDerived(decimalPct(premiumQoq), 4, "premiumQoq", tag),
      premiumYoy: boundDerived(decimalPct(premiumYoy), 4, "premiumYoy", tag),
      patQoq: boundDerived(decimalPct(patQoq), 4, "patQoq", tag),
      patYoy: boundDerived(decimalPct(patYoy), 4, "patYoy", tag),
    },
    numbers: { premiumYoy },
  };
}

// ── General-insurance quarterly ──
export interface GiQRaw { combinedRatio: number | null; netProfit: number | null; totalRevenue: number | null; grossPremiumsWritten: number | null }
export interface GiQPrior { grossPremiumsWritten: number | null; netProfit: number | null }
export interface GiQDerived {
  columns: { netUnderwritingMargin: Dec; netMargin: Dec; gpwQoq: Dec; gpwYoy: Dec; patQoq: Dec; patYoy: Dec };
  numbers: { gpwYoy: number | null };
}
export function deriveGiQuarterly(raw: GiQRaw, priorQ: GiQPrior | null, yearAgoQ: GiQPrior | null): GiQDerived {
  const netUnderwritingMargin = raw.combinedRatio !== null ? 1 - raw.combinedRatio : null;
  const netMargin = raw.netProfit !== null && raw.totalRevenue !== null && raw.totalRevenue !== 0 ? (raw.netProfit / raw.totalRevenue) * 100 : null;
  const gpwQoq = pctChange(raw.grossPremiumsWritten, priorQ?.grossPremiumsWritten ?? null);
  const gpwYoy = pctChange(raw.grossPremiumsWritten, yearAgoQ?.grossPremiumsWritten ?? null);
  const patQoq = pctChange(raw.netProfit, priorQ?.netProfit ?? null);
  const patYoy = pctChange(raw.netProfit, yearAgoQ?.netProfit ?? null);
  // S8.1b — RATIO column Decimal(8,6) → ceiling 100; PERCENT columns
  //   Decimal(8,4) → ceiling 10,000.
  const tag = "gi-quarterly";
  return {
    columns: {
      netUnderwritingMargin: boundDerived(decimalRatio(netUnderwritingMargin), 2, "netUnderwritingMargin", tag),
      netMargin: boundDerived(decimalPct(netMargin), 4, "netMargin", tag),
      gpwQoq: boundDerived(decimalPct(gpwQoq), 4, "gpwQoq", tag),
      gpwYoy: boundDerived(decimalPct(gpwYoy), 4, "gpwYoy", tag),
      patQoq: boundDerived(decimalPct(patQoq), 4, "patQoq", tag),
      patYoy: boundDerived(decimalPct(patYoy), 4, "patYoy", tag),
    },
    numbers: { gpwYoy },
  };
}
