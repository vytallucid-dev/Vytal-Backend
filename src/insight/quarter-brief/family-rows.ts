// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PER-FAMILY QUARTER FETCH — the replacement for fact-block.ts's fifteen-field `QRow`.
//
// ── WHAT CHANGED, AND WHY IT IS THE STRUCTURAL FIX ────────────────────────────────────────────────
// `fetchQuarters` mapped all five family tables onto ONE shape with fifteen slots. Every column outside
// those slots was dropped at the fetch — before any decision was made about whether a reader wanted it.
// Banking lost twenty-two metrics that way; life insurance lost twenty-one, including solvency and all
// five persistency ratios.
//
// Here each family has its OWN fetcher returning `FamilyQuarter<F>`, whose `values` is a
// Record over that family's manifest keys. Omit one and this file does not compile. Add a metric to a
// manifest and this file stops compiling until it is supplied. The flattening cannot silently return.
//
// ── ⚠ WHAT THIS FILE DOES NOT DO ─────────────────────────────────────────────────────────────────
// No scale conversion, no bounds check, no formatting, no comparison. It reads columns into their
// manifest keys in their NATIVE stored units and stops. Every judgement about what a number MEANS
// lives in manifest.ts and every rendering lives in format.ts — one seam each, so a unit is converted
// exactly once and a bound is applied exactly once.
//
// ── TWO DERIVED VALUES, AND THEY ARE DERIVED HERE ON PURPOSE ─────────────────────────────────────
//   · non_financial.otherOperatingCosts = expenses − depreciation − interest
//   · banking.operatingExpenses         = expenditure_excl_provisions − interest_expended  (C19)
// Both are subtractions the manifest declares in `source`, and both are done at the fetch so that
// everything downstream sees one uniform map of metric → number. Neither has a stored column to read.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import type { AnyFamilyQuarter, Basis, Family, FamilyQuarter } from "./manifest.js";

// ⚠ TOP_LINE_KEY lives in manifest.ts, NOT here. This module imports the DB client, and
// verify-build-gate-hygiene.ts fails the build if a build gate so much as reaches one — correctly, since
// a gate that needs a database is neither deterministic nor deployable. The top line is manifest data;
// putting it beside the fetchers put a prisma import in the gate's graph. Re-export nothing from here.

/** Decimal | null | undefined → number | null. A non-finite value is an absent value, never a zero. */
const n = (x: unknown): number | null => {
  if (x === null || x === undefined) return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
};

/** Subtraction that PROPAGATES absence. `a − b` where either side is unknown is unknown, never `a`. */
const sub = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);

/** Three-way subtraction, same rule. */
const sub2 = (a: number | null, b: number | null, c: number | null): number | null =>
  a === null || b === null || c === null ? null : a - b - c;

interface FilingBase {
  quarter: string;
  fiscalYear: string;
  resultType: string;
  reportDate: Date;
  filingDate: Date;
}

const meta = (r: FilingBase) => ({
  periodKey: `${r.fiscalYear}${r.quarter}`,
  quarter: r.quarter,
  fiscalYear: r.fiscalYear,
  resultType: r.resultType as Basis,
  reportDate: r.reportDate,
  filingDate: r.filingDate,
});

/** The basis each family files its primary numbers on. Unchanged from fact-block.ts — a brief that
 *  switched basis would change what "revenue" means between two quarters of the same card. */
export const PREFERRED_BASIS: Record<Family, Basis> = {
  non_financial: "consolidated",
  banking: "standalone",
  nbfc: "consolidated",
  life_insurance: "standalone",
  general_insurance: "standalone",
};

// ── The five fetchers. Oldest → newest. ────────────────────────────────────────────────────────────

async function fetchNonFinancial(stockId: string, basis: Basis): Promise<FamilyQuarter<"non_financial">[]> {
  const rows = await prisma.quarterlyResult.findMany({
    where: { stockId, resultType: basis },
    orderBy: { reportDate: "asc" },
  });
  return rows.map((r) => {
    const expenses = n(r.expenses);
    const depreciation = n(r.depreciation);
    const financeCosts = n(r.interest);
    return {
      family: "non_financial" as const,
      ...meta(r),
      auditPending: false,
      values: {
        revenue: n(r.revenue),
        otherIncome: n(r.otherIncome),
        expenses,
        depreciation,
        financeCosts,
        otherOperatingCosts: sub2(expenses, depreciation, financeCosts),
        operatingProfit: n(r.operatingProfit),
        profitBeforeTax: n(r.profitBeforeTax),
        tax: n(r.tax),
        netProfit: n(r.netProfit),
        operatingMargin: n(r.operatingMargin),
        netMargin: n(r.netMargin),
      },
    };
  });
}

async function fetchBanking(stockId: string, basis: Basis): Promise<FamilyQuarter<"banking">[]> {
  const rows = await prisma.bankingQuarterlyResult.findMany({
    where: { stockId, resultType: basis },
    orderBy: { reportDate: "asc" },
  });
  return rows.map((r) => ({
    family: "banking" as const,
    ...meta(r),
    auditPending: r.auditPending,
    values: {
      interestEarned: n(r.interestEarned),
      interestExpended: n(r.interestExpended),
      netInterestIncome: n(r.nii),
      otherIncome: n(r.otherIncome),
      totalIncome: n(r.totalIncome),
      staffCost: n(r.employeesCost),
      // ⚠ C19 — the subtraction form, never employees_cost + operating_expenses. See the manifest note.
      operatingExpenses: sub(n(r.expenditureExclProvisions), n(r.interestExpended)),
      provisions: n(r.provisions),
      exceptionalItems: n(r.exceptionalItems),
      preProvisionOperatingProfit: n(r.ppop),
      profitBeforeTax: n(r.profitBeforeTax),
      tax: n(r.tax),
      netProfit: n(r.netProfit),
      grossNpaAmount: n(r.gnpaAbsolute),
      netNpaAmount: n(r.nnpaAbsolute),
      grossNpaRatio: n(r.gnpaPct),
      netNpaRatio: n(r.nnpaPct),
      provisionCoverageRatio: n(r.pcr),
      cet1Ratio: n(r.cet1Ratio),
      returnOnAssetsQuarterly: n(r.roaQuarterly),
      costToIncomeRatio: n(r.costToIncomeRatio),
      netMargin: n(r.netMargin),
    },
  }));
}

async function fetchNbfc(stockId: string, basis: Basis): Promise<FamilyQuarter<"nbfc">[]> {
  const rows = await prisma.nbfcQuarterlyResult.findMany({
    where: { stockId, resultType: basis },
    orderBy: { reportDate: "asc" },
  });
  return rows.map((r) => ({
    family: "nbfc" as const,
    ...meta(r),
    auditPending: false,
    values: {
      revenue: n(r.revenue),
      interestIncome: n(r.interestIncome),
      feeAndCommissionIncome: n(r.feeAndCommissionIncome),
      netGainOnFairValueChanges: n(r.netGainOnFairValueChanges),
      otherIncome: n(r.otherIncome),
      totalIncome: n(r.totalIncome),
      netInterestIncome: n(r.nii),
      financeCosts: n(r.financeCosts),
      impairmentOnFinancialInstruments: n(r.impairmentOnFinancialInstruments),
      staffCost: n(r.employeeBenefitExpense),
      depreciation: n(r.depreciation),
      otherExpenses: n(r.otherExpenses),
      totalExpenses: n(r.totalExpenses),
      profitBeforeTax: n(r.profitBeforeTax),
      tax: n(r.tax),
      netProfit: n(r.netProfit),
      netMargin: n(r.netMargin),
    },
  }));
}

async function fetchLifeInsurance(stockId: string, basis: Basis): Promise<FamilyQuarter<"life_insurance">[]> {
  const rows = await prisma.lifeInsuranceQuarterlyResult.findMany({
    where: { stockId, resultType: basis },
    orderBy: { reportDate: "asc" },
  });
  return rows.map((r) => ({
    family: "life_insurance" as const,
    ...meta(r),
    auditPending: false,
    values: {
      grossPremiumIncome: n(r.grossPremiumIncome),
      netPremiumIncome: n(r.netPremiumIncome),
      incomeFirstYearPremium: n(r.incomeFirstYearPremium),
      incomeRenewalPremium: n(r.incomeRenewalPremium),
      incomeSinglePremium: n(r.incomeSinglePremium),
      reinsuranceCeded: n(r.reinsuranceCeded),
      incomeFromInvestments: n(r.incomeFromInvestments),
      totalRevenuePolicyholders: n(r.totalRevenuePolicyholders),
      totalCommission: n(r.totalCommission),
      insuranceRunningCosts: n(r.totalOperatingExpenses),
      benefitsPaidNet: n(r.benefitsPaidNet),
      changeInValuationOfLiabilities: n(r.changeInValuationOfLiabilities),
      profitBeforeTax: n(r.profitBeforeTax),
      tax: n(r.tax),
      netProfit: n(r.netProfit),
      solvencyRatio: n(r.solvencyRatio),
      persistencyRatio13Month: n(r.persistencyRatio13Month),
      persistencyRatio25Month: n(r.persistencyRatio25Month),
      persistencyRatio37Month: n(r.persistencyRatio37Month),
      persistencyRatio49Month: n(r.persistencyRatio49Month),
      persistencyRatio61Month: n(r.persistencyRatio61Month),
      newBusinessPremiumPct: n(r.newBusinessPremiumPct),
      expenseRatioPolicyholders: n(r.expenseRatioPolicyholders),
      netMargin: n(r.netMargin),
    },
  }));
}

async function fetchGeneralInsurance(stockId: string, basis: Basis): Promise<FamilyQuarter<"general_insurance">[]> {
  const rows = await prisma.generalInsuranceQuarterlyResult.findMany({
    where: { stockId, resultType: basis },
    orderBy: { reportDate: "asc" },
  });
  return rows.map((r) => ({
    family: "general_insurance" as const,
    ...meta(r),
    auditPending: false,
    values: {
      grossPremiumsWritten: n(r.grossPremiumsWritten),
      netPremiumWritten: n(r.netPremiumWritten),
      premiumEarned: n(r.premiumEarned),
      incomeFromInvestments: n(r.incomeFromInvestments),
      otherIncome: n(r.otherIncome),
      totalIncome: n(r.totalRevenue),
      claimsPaid: n(r.claimsPaid),
      incurredClaims: n(r.incurredClaims),
      netCommission: n(r.netCommission),
      insuranceRunningCosts: n(r.totalOperatingExpensesRelatedToInsurance),
      underwritingProfitOrLoss: n(r.underwritingProfitOrLoss),
      profitBeforeTax: n(r.profitBeforeTax),
      tax: n(r.tax),
      netProfit: n(r.netProfit),
      combinedRatio: n(r.combinedRatio),
      incurredClaimRatio: n(r.incurredClaimRatio),
      expensesOfManagementRatio: n(r.expensesOfManagementRatio),
      netRetentionRatio: n(r.netRetentionRatio),
      solvencyRatio: n(r.solvencyRatio),
      netMargin: n(r.netMargin),
    },
  }));
}

/** Every quarter on file for one stock, in one family, on one basis. Oldest → newest. */
export async function fetchFamilyQuarters(
  family: Family,
  stockId: string,
  basis: Basis,
): Promise<AnyFamilyQuarter[]> {
  switch (family) {
    case "non_financial":
      return fetchNonFinancial(stockId, basis);
    case "banking":
      return fetchBanking(stockId, basis);
    case "nbfc":
      return fetchNbfc(stockId, basis);
    case "life_insurance":
      return fetchLifeInsurance(stockId, basis);
    case "general_insurance":
      return fetchGeneralInsurance(stockId, basis);
  }
}

/** Preferred basis if the stock has ANY row there, else the other, else null.
 *  Same rule fact-block.ts's `resolveBasis` uses — kept identical so the new path cannot silently
 *  describe a different set of numbers than the one already published. */
export async function resolveFamilyBasis(family: Family, stockId: string): Promise<Basis | null> {
  const preferred = PREFERRED_BASIS[family];
  if ((await fetchFamilyQuarters(family, stockId, preferred)).length > 0) return preferred;
  const other: Basis = preferred === "consolidated" ? "standalone" : "consolidated";
  return (await fetchFamilyQuarters(family, stockId, other)).length > 0 ? other : null;
}
