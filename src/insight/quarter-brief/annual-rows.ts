// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PER-FAMILY ANNUAL FETCH — the five *_fundamentals tables, one fetcher each.
//
// Same discipline as family-rows.ts, and for the same reason: each family returns `FamilyAnnual<F>`,
// whose `values` is a Record over that family's annual manifest keys. Omit one and this file does not
// compile; add a metric to a manifest and this file stops compiling until it is supplied.
//
// ── ⚠ WHAT THIS FILE DOES NOT DO ─────────────────────────────────────────────────────────────────
// No scale conversion, no bounds check, no cross-field guard, no formatting, no comparison. It reads
// columns into their manifest keys in their NATIVE stored units and stops.
//
// ── ★ THE BASIS IS NOT RESOLVED HERE, IT IS INHERITED ────────────────────────────────────────────
// family-rows.ts has `resolveFamilyBasis`, which falls back to the other basis when the preferred one
// has no rows. THERE IS DELIBERATELY NO ANNUAL EQUIVALENT. The annual section sits on a card whose
// identity already says "consolidated" or "standalone", and a balance sheet fetched on the OTHER basis
// would describe a different entity — the parent alone rather than the group — under the same heading.
// So the caller passes the basis the quarter already resolved, and a year filed only on the other basis
// is ABSENT rather than substituted. Measured: 99.6% of Q4 rows have an annual row on their own basis
// (1,225 of 1,230 non-financial; 100% of all four financial families), so the substitution would buy
// 0.4% of coverage at the cost of the card meaning two different things on different rows.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import type { AnyFamilyAnnual, Family, FamilyAnnual } from "./annual-manifest.js";
import type { Basis } from "./manifest.js";

// ⚠ Nothing is re-exported from here. This module imports the DB client and
// verify-build-gate-hygiene.ts fails the build if a build gate reaches one — the same rule
// family-rows.ts carries at the top, for the same reason.

/** Decimal | null | undefined → number | null. A non-finite value is an absent value, never a zero. */
const n = (x: unknown): number | null => {
  if (x === null || x === undefined) return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
};

interface AnnualBase {
  fiscalYear: string;
  resultType: string;
  reportDate: Date;
  filingDate: Date;
}

/** ★ `asOfDate` IS `report_date`, AND IT IS THE ANNUAL SECTION'S OWN CLOCK (4d). The year-end the
 *  balance sheet describes — which is NOT always the quarter's own last day. */
const meta = (r: AnnualBase) => ({
  fiscalYear: r.fiscalYear,
  resultType: r.resultType as Basis,
  asOfDate: r.reportDate,
  filingDate: r.filingDate,
});

async function fetchNonFinancialAnnual(
  stockId: string,
  fiscalYear: string,
  basis: Basis,
): Promise<FamilyAnnual<"non_financial"> | null> {
  const r = await prisma.fundamental.findFirst({ where: { stockId, fiscalYear, resultType: basis } });
  if (!r) return null;
  return {
    family: "non_financial",
    ...meta(r),
    values: {
      totalAssets: n(r.totalAssets),
      netWorth: n(r.netWorth),
      totalDebt: n(r.totalDebt),
      debtDueWithinAYear: n(r.borrowingsCurrent),
      cashAndCashEquivalents: n(r.cashAndCashEquivalents),
      inventories: n(r.inventories),
      tradeReceivables: n(r.tradeReceivablesCurrent),
      propertyPlantAndEquipment: n(r.propertyPlantAndEquipment),
      cashFromOperating: n(r.cashFromOperating),
      cashFromInvesting: n(r.cashFromInvesting),
      cashFromFinancing: n(r.cashFromFinancing),
      capitalExpenditure: n(r.capex),
      freeCashFlow: n(r.fcf),
      dividendsPaid: n(r.dividendsPaid),
      basicEps: n(r.basicEps),
      returnOnEquity: n(r.roe),
      debtToEquity: n(r.debtToEquity),
      interestCoverage: n(r.interestCoverage),
      receivablesDays: n(r.receivablesDays),
    },
  };
}

async function fetchBankingAnnual(
  stockId: string,
  fiscalYear: string,
  basis: Basis,
): Promise<FamilyAnnual<"banking"> | null> {
  const r = await prisma.bankingFundamental.findFirst({ where: { stockId, fiscalYear, resultType: basis } });
  if (!r) return null;
  return {
    family: "banking",
    ...meta(r),
    values: {
      deposits: n(r.deposits),
      advances: n(r.advances),
      totalAssets: n(r.totalAssets),
      netWorth: n(r.netWorth),
      bankBorrowings: n(r.borrowings),
      investmentBook: n(r.investments),
      cashFromOperating: n(r.cashFromOperating),
      cashFromInvesting: n(r.cashFromInvesting),
      cashFromFinancing: n(r.cashFromFinancing),
      netInterestMargin: n(r.netInterestMargin),
      creditCost: n(r.creditCostPct),
      creditDepositRatio: n(r.creditDepositRatio),
      returnOnEquity: n(r.roe),
      returnOnAssetsAnnual: n(r.roaDisclosed),
      basicEps: n(r.basicEps),
    },
  };
}

async function fetchNbfcAnnual(
  stockId: string,
  fiscalYear: string,
  basis: Basis,
): Promise<FamilyAnnual<"nbfc"> | null> {
  const r = await prisma.nbfcFundamental.findFirst({ where: { stockId, fiscalYear, resultType: basis } });
  if (!r) return null;
  return {
    family: "nbfc",
    ...meta(r),
    values: {
      loanBook: n(r.loans),
      totalAssets: n(r.totalAssets),
      totalLiabilities: n(r.totalLiabilities),
      netWorth: n(r.netWorth),
      cashAndCashEquivalents: n(r.cashAndCashEquivalents),
      cashFromOperating: n(r.cashFromOperating),
      cashFromInvesting: n(r.cashFromInvesting),
      cashFromFinancing: n(r.cashFromFinancing),
      netInterestMargin: n(r.nim),
      creditCost: n(r.creditCostPct),
      costToIncomeAnnual: n(r.costToIncomeRatio),
      borrowingsToEquity: n(r.borrowingsToEquity),
      returnOnEquity: n(r.roe),
      basicEps: n(r.basicEps),
    },
  };
}

async function fetchLifeInsuranceAnnual(
  stockId: string,
  fiscalYear: string,
  basis: Basis,
): Promise<FamilyAnnual<"life_insurance"> | null> {
  const r = await prisma.lifeInsuranceFundamental.findFirst({ where: { stockId, fiscalYear, resultType: basis } });
  if (!r) return null;
  return {
    family: "life_insurance",
    ...meta(r),
    values: {
      policyholdersFunds: n(r.policyholdersFunds),
      investmentsPolicyholders: n(r.investmentsPolicyholders),
      investmentsShareholders: n(r.investmentsShareholders),
      assetsHeldToCoverLinkedLiabilities: n(r.assetsHeldToCoverLinkedLiabilities),
      netWorth: n(r.netWorth),
      surplusFromRevenueAccount: n(r.surplusFromRevenueAccount),
      transferFromPolicyholders: n(r.transferFromPolicyholders),
      incomeFromInvestmentsShareholders: n(r.incomeFromInvestmentsShareholders),
      shareholdersExpenses: n(r.shareholdersExpenses),
      returnOnEquity: n(r.roe),
      basicEps: n(r.basicEps),
    },
  };
}

async function fetchGeneralInsuranceAnnual(
  stockId: string,
  fiscalYear: string,
  basis: Basis,
): Promise<FamilyAnnual<"general_insurance"> | null> {
  const r = await prisma.generalInsuranceFundamental.findFirst({ where: { stockId, fiscalYear, resultType: basis } });
  if (!r) return null;
  return {
    family: "general_insurance",
    ...meta(r),
    values: {
      insurerInvestments: n(r.investments),
      netWorth: n(r.netWorth),
      fairValueChangeAccount: n(r.fairValueChangeAccount),
      cashAndCashEquivalents: n(r.cashAndBankBalances),
      changeInOutstandingClaims: n(r.changeInOutstandingClaims),
      premiumDeficiency: n(r.premiumDeficiency),
      returnOnEquity: n(r.roe),
      basicEps: n(r.basicEps),
    },
  };
}

/** ONE full year for one stock, on the basis the quarter already resolved. Null ⇒ no annual row —
 *  which is an honest absence and renders as no section, never as an assumed one. */
export async function fetchFamilyAnnual(
  family: Family,
  stockId: string,
  fiscalYear: string,
  basis: Basis,
): Promise<AnyFamilyAnnual | null> {
  switch (family) {
    case "non_financial":
      return fetchNonFinancialAnnual(stockId, fiscalYear, basis);
    case "banking":
      return fetchBankingAnnual(stockId, fiscalYear, basis);
    case "nbfc":
      return fetchNbfcAnnual(stockId, fiscalYear, basis);
    case "life_insurance":
      return fetchLifeInsuranceAnnual(stockId, fiscalYear, basis);
    case "general_insurance":
      return fetchGeneralInsuranceAnnual(stockId, fiscalYear, basis);
  }
}
