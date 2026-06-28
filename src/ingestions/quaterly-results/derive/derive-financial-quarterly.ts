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
  return {
    columns: {
      nii: safeNumber(nii), totalIncome: safeNumber(totalIncome), costToIncomeRatio: decimalRatio(costToIncomeRatio),
      netMargin: decimalPct(netMargin), pcr: decimalRatio(pcr), tier1Ratio: decimalRatio(tier1Ratio),
      niiQoq: decimalPct(niiQoq), niiYoy: decimalPct(niiYoy), patQoq: decimalPct(patQoq), patYoy: decimalPct(patYoy),
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
  return {
    columns: { nii: safeNumber(nii), netMargin: decimalPct(netMargin), revenueQoq: decimalPct(revenueQoq), revenueYoy: decimalPct(revenueYoy), patQoq: decimalPct(patQoq), patYoy: decimalPct(patYoy) },
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
  return {
    columns: { newBusinessPremiumPct: decimalRatio(newBusinessPremiumPct), expenseRatioPolicyholders: decimalRatio(expenseRatio), netMargin: decimalPct(netMargin), premiumQoq: decimalPct(premiumQoq), premiumYoy: decimalPct(premiumYoy), patQoq: decimalPct(patQoq), patYoy: decimalPct(patYoy) },
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
  return {
    columns: { netUnderwritingMargin: decimalRatio(netUnderwritingMargin), netMargin: decimalPct(netMargin), gpwQoq: decimalPct(gpwQoq), gpwYoy: decimalPct(gpwYoy), patQoq: decimalPct(patQoq), patYoy: decimalPct(patYoy) },
    numbers: { gpwYoy },
  };
}
