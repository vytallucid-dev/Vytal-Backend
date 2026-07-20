// ─────────────────────────────────────────────────────────────
// RE-DERIVE DISPATCHER — the keystone of the fill bridge (Part 1 → fill).
//
// Given a STORED row, re-run the exact deriveFromRow extracted in Stage 1 and
// write the derived columns back — NO fetch, NO re-parse. This is what closes
// the stale-stored-ratio gap when an admin corrects a raw field: ingestion and
// fill derive through the SAME function (single path), so the re-derived ratios
// are byte-faithful to what a fresh ingest would have produced from the (now
// corrected) raw columns.
//
// Implemented end-to-end + e2e-proven for the Ind-AS Fundamental (annual). The
// other seven tables reuse the IDENTICAL shape — load the row's raw columns +
// the prior row (decrementFY / prior-quarter), call the table's deriveFromRow,
// update the derived columns — and are registered here as they are wired.
// ─────────────────────────────────────────────────────────────

import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { decrementFY, getPriorQuarter, toNumber } from "../ingestions/quaterly-results/ingester-utils.js";
import {
  deriveIndAsAnnual,
  plausibleFaceValue,
} from "../ingestions/quaterly-results/derive/derive-indas-annual.js";
import { deriveIndAsQuarterly } from "../ingestions/quaterly-results/derive/derive-indas-quarterly.js";
import { deriveBankingAnnual } from "../ingestions/quaterly-results/derive/derive-banking-annual.js";
import { deriveNbfcAnnual } from "../ingestions/quaterly-results/derive/derive-nbfc-annual.js";
import { deriveLiAnnual } from "../ingestions/quaterly-results/derive/derive-li-annual.js";
import { deriveGiAnnual } from "../ingestions/quaterly-results/derive/derive-gi-annual.js";
import {
  deriveBankingQuarterly,
  deriveNbfcQuarterly,
  deriveLiQuarterly,
  deriveGiQuarterly,
} from "../ingestions/quaterly-results/derive/derive-financial-quarterly.js";
import { deriveOthersPct } from "../ingestions/shareholdings/shareholding-derive.js";

/** A Prisma client OR an interactive-transaction client (for rolled-back e2e). */
export type Db = typeof prisma | Prisma.TransactionClient;

export interface ReDeriveResult {
  table: string;
  rowId: string;
  /** Derived columns that actually changed value (name → {before, after}). */
  changed: Record<string, { before: string | null; after: string | null }>;
  /** Symbol of the owning stock (for the rescore trigger). */
  symbol: string;
  /** The period key (for a back-dated PIT cascade), e.g. "FY24". */
  periodKey: string;
  /** Edit shape for the cascade: annual rows map to a start-quarter via reportDate;
   *  quarterly rows carry their own FYxxQy period key directly. */
  edit: { kind: "annual"; reportDate: Date } | { kind: "quarter"; periodKey: string };
}

const FUNDAMENTAL_RAW = {
  id: true, stockId: true, fiscalYear: true, resultType: true, reportDate: true,
  revenue: true, netProfit: true, financeCosts: true, depreciation: true, profitBeforeTax: true,
  equityShareCapital: true, otherEquity: true, totalEquity: true, equityAttributableToOwners: true,
  borrowingsCurrent: true, borrowingsNoncurrent: true, cashFromOperating: true, capex: true,
  paidUpEquityCapital: true, faceValueShare: true, tradeReceivablesCurrent: true,
  tradeReceivablesNoncurrent: true, inventories: true, totalAssets: true, basicEps: true,
  // current derived (to diff what changed)
  totalDebt: true, fcf: true, ebitda: true, netMargin: true, operatingMargin: true, netWorth: true,
  bookValuePerShare: true, debtToEquity: true, roe: true, roce: true, interestCoverage: true,
  receivablesDays: true, inventoryTurnover: true, assetTurnover: true,
  revenueGrowthYoy: true, profitGrowthYoy: true, epsGrowthYoy: true,
} as const;

const FUNDAMENTAL_DERIVED_COLS = [
  "totalDebt", "fcf", "ebitda", "netMargin", "operatingMargin", "netWorth", "bookValuePerShare",
  "debtToEquity", "roe", "roce", "interestCoverage", "receivablesDays", "inventoryTurnover",
  "assetTurnover", "revenueGrowthYoy", "profitGrowthYoy", "epsGrowthYoy",
] as const;

/** Re-derive an Ind-AS Fundamental (annual) stored row from its raw columns. */
export async function reDeriveFundamentalAnnual(db: Db, rowId: string): Promise<ReDeriveResult> {
  const row = await db.fundamental.findUniqueOrThrow({ where: { id: rowId }, select: { ...FUNDAMENTAL_RAW, stock: { select: { symbol: true } } } });
  const prior = await db.fundamental.findUnique({
    where: { stockId_fiscalYear_resultType: { stockId: row.stockId, fiscalYear: decrementFY(row.fiscalYear), resultType: row.resultType } },
    select: { revenue: true, netProfit: true, basicEps: true, totalEquity: true, equityAttributableToOwners: true, equityShareCapital: true, otherEquity: true },
  });

  const tag = `fill ${row.fiscalYear}/${row.resultType}`;
  const derived = deriveIndAsAnnual(
    {
      revenue: toNumber(row.revenue), netProfit: toNumber(row.netProfit), financeCosts: toNumber(row.financeCosts),
      depreciation: toNumber(row.depreciation), profitBeforeTax: toNumber(row.profitBeforeTax),
      equityShareCapital: toNumber(row.equityShareCapital), otherEquity: toNumber(row.otherEquity),
      totalEquity: toNumber(row.totalEquity), equityAttributableToOwners: toNumber(row.equityAttributableToOwners),
      borrowingsCurrent: toNumber(row.borrowingsCurrent), borrowingsNoncurrent: toNumber(row.borrowingsNoncurrent),
      cashFromOperating: toNumber(row.cashFromOperating), capex: toNumber(row.capex),
      paidUpEquityCapital: toNumber(row.paidUpEquityCapital),
      faceValueShareSane: plausibleFaceValue(toNumber(row.faceValueShare)),
      tradeReceivablesCurrent: toNumber(row.tradeReceivablesCurrent), tradeReceivablesNoncurrent: toNumber(row.tradeReceivablesNoncurrent),
      inventories: toNumber(row.inventories), totalAssets: toNumber(row.totalAssets), basicEps: toNumber(row.basicEps),
    },
    prior
      ? {
          revenue: toNumber(prior.revenue), netProfit: toNumber(prior.netProfit), basicEps: toNumber(prior.basicEps),
          totalEquity: toNumber(prior.totalEquity), equityAttributableToOwners: toNumber(prior.equityAttributableToOwners),
          equityShareCapital: toNumber(prior.equityShareCapital), otherEquity: toNumber(prior.otherEquity),
        }
      : null,
    tag,
  );

  // Diff what changed (so a no-op fill writes nothing meaningful + reports cleanly).
  const changed: ReDeriveResult["changed"] = {};
  const cur = row as unknown as Record<string, Prisma.Decimal | null>;
  for (const c of FUNDAMENTAL_DERIVED_COLS) {
    const before = cur[c] ?? null;
    const after = (derived.columns as unknown as Record<string, Prisma.Decimal | null>)[c] ?? null;
    const same = (before == null && after == null) || (before != null && after != null && before.equals(after));
    if (!same) changed[c] = { before: before?.toString() ?? null, after: after?.toString() ?? null };
  }

  await db.fundamental.update({ where: { id: rowId }, data: derived.columns });
  return {
    table: "Fundamental", rowId, changed, symbol: row.stock.symbol, periodKey: row.fiscalYear,
    edit: { kind: "annual", reportDate: row.reportDate },
  };
}

// ── Shared diff (used by the sibling loaders) ─────────────────
const N = (d: Prisma.Decimal | null | undefined) => toNumber(d ?? null);
function computeChanged(
  row: Record<string, Prisma.Decimal | null>,
  columns: Record<string, Prisma.Decimal | null>,
  cols: readonly string[],
): ReDeriveResult["changed"] {
  const changed: ReDeriveResult["changed"] = {};
  for (const c of cols) {
    const before = row[c] ?? null;
    const after = columns[c] ?? null;
    const same = (before == null && after == null) || (before != null && after != null && before.equals(after));
    if (!same) changed[c] = { before: before?.toString() ?? null, after: after?.toString() ?? null };
  }
  return changed;
}
const asRec = (o: object) => o as unknown as Record<string, Prisma.Decimal | null>;
const annualEdit = (reportDate: Date): ReDeriveResult["edit"] => ({ kind: "annual", reportDate });
const quarterEdit = (fy: string, q: string): ReDeriveResult["edit"] => ({ kind: "quarter", periodKey: `${fy}${q}` });

// ── QuarterlyResult (Ind-AS) ──────────────────────────────────
const QRESULT_COLS = ["operatingMargin", "netMargin", "revenueQoq", "revenueYoy", "profitQoq", "profitYoy"] as const;
export async function reDeriveQuarterlyResult(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.quarterlyResult.findUniqueOrThrow({ where: { id: rowId }, include: { stock: { select: { symbol: true } } } });
  const priorQ = getPriorQuarter(r.quarter, r.fiscalYear);
  const pr = priorQ ? await db.quarterlyResult.findUnique({ where: { stockId_quarter_fiscalYear_resultType: { stockId: r.stockId, quarter: priorQ.quarter, fiscalYear: priorQ.fiscalYear, resultType: r.resultType } }, select: { revenue: true, netProfit: true } }) : null;
  const ya = await db.quarterlyResult.findUnique({ where: { stockId_quarter_fiscalYear_resultType: { stockId: r.stockId, quarter: r.quarter, fiscalYear: decrementFY(r.fiscalYear), resultType: r.resultType } }, select: { revenue: true, netProfit: true } });
  const d = deriveIndAsQuarterly(
    { revenue: N(r.revenue), netProfit: N(r.netProfit), operatingProfit: N(r.operatingProfit) },
    pr ? { revenue: N(pr.revenue), netProfit: N(pr.netProfit) } : null,
    ya ? { revenue: N(ya.revenue), netProfit: N(ya.netProfit) } : null,
  );
  const changed = computeChanged(asRec(r), asRec(d.columns), QRESULT_COLS);
  await db.quarterlyResult.update({ where: { id: rowId }, data: d.columns });
  return { table: "QuarterlyResult", rowId, changed, symbol: r.stock.symbol, periodKey: `${r.fiscalYear}${r.quarter}`, edit: quarterEdit(r.fiscalYear, r.quarter) };
}

// ── BankingFundamental (annual) ───────────────────────────────
const BANK_COLS = ["nii", "totalIncome", "netInterestMargin", "costToIncomeRatio", "creditCostPct", "roe", "creditDepositRatio", "netWorth", "bookValuePerShare", "pcr", "tier1Ratio", "niiGrowthYoy", "patGrowthYoy", "depositGrowthYoy", "advanceGrowthYoy", "assetGrowthYoy"] as const;
export async function reDeriveBankingAnnual(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.bankingFundamental.findUniqueOrThrow({ where: { id: rowId }, include: { stock: { select: { symbol: true } } } });
  const pr = await db.bankingFundamental.findUnique({ where: { stockId_fiscalYear_resultType: { stockId: r.stockId, fiscalYear: decrementFY(r.fiscalYear), resultType: r.resultType } }, select: { capital: true, reservesAndSurplus: true, advances: true, investments: true, nii: true, netProfit: true, deposits: true, totalAssets: true } });
  const d = deriveBankingAnnual(
    { interestEarned: N(r.interestEarned), interestExpended: N(r.interestExpended), otherIncome: N(r.otherIncome), expenditureExclProvisions: N(r.expenditureExclProvisions), capital: N(r.capital), reservesAndSurplus: N(r.reservesAndSurplus), paidUpEquityCapital: N(r.paidUpEquityCapital), faceValueShare: N(r.faceValueShare), gnpaAbsolute: N(r.gnpaAbsolute), nnpaAbsolute: N(r.nnpaAbsolute), cet1Ratio: N(r.cet1Ratio), additionalTier1Ratio: N(r.additionalTier1Ratio), provisions: N(r.provisions), advances: N(r.advances), investments: N(r.investments), deposits: N(r.deposits), netProfit: N(r.netProfit), totalAssets: N(r.totalAssets) },
    pr ? { capital: N(pr.capital), reservesAndSurplus: N(pr.reservesAndSurplus), advances: N(pr.advances), investments: N(pr.investments), nii: N(pr.nii), netProfit: N(pr.netProfit), deposits: N(pr.deposits), totalAssets: N(pr.totalAssets) } : null,
  );
  const changed = computeChanged(asRec(r), asRec(d.columns), BANK_COLS);
  await db.bankingFundamental.update({ where: { id: rowId }, data: d.columns });
  return { table: "BankingFundamental", rowId, changed, symbol: r.stock.symbol, periodKey: r.fiscalYear, edit: annualEdit(r.reportDate) };
}

// ── NbfcFundamental (annual) ──────────────────────────────────
const NBFC_COLS = ["nim", "costToIncomeRatio", "creditCostPct", "spread", "capitalToAssetsRatio", "borrowingsToEquity", "netWorth", "bookValuePerShare", "roe", "aumGrowthYoy", "revenueGrowthYoy", "patGrowthYoy"] as const;
export async function reDeriveNbfcAnnual(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.nbfcFundamental.findUniqueOrThrow({ where: { id: rowId }, include: { stock: { select: { symbol: true } } } });
  const pr = await db.nbfcFundamental.findUnique({ where: { stockId_fiscalYear_resultType: { stockId: r.stockId, fiscalYear: decrementFY(r.fiscalYear), resultType: r.resultType } }, select: { revenue: true, netProfit: true, loans: true, totalEquity: true, equityShareCapital: true, otherEquity: true, debtSecurities: true, borrowings: true, subordinatedLiabilities: true, depositsLiabilities: true } });
  const d = deriveNbfcAnnual(
    { interestIncome: N(r.interestIncome), financeCosts: N(r.financeCosts), loans: N(r.loans), totalIncome: N(r.totalIncome), feeAndCommissionIncome: N(r.feeAndCommissionIncome), netGainOnFairValueChanges: N(r.netGainOnFairValueChanges), otherIncome: N(r.otherIncome), employeeBenefitExpense: N(r.employeeBenefitExpense), depreciation: N(r.depreciation), otherExpenses: N(r.otherExpenses), feeAndCommissionExpense: N(r.feeAndCommissionExpense), impairmentOnFinancialInstruments: N(r.impairmentOnFinancialInstruments), debtSecurities: N(r.debtSecurities), borrowings: N(r.borrowings), subordinatedLiabilities: N(r.subordinatedLiabilities), depositsLiabilities: N(r.depositsLiabilities), totalEquity: N(r.totalEquity), equityShareCapital: N(r.equityShareCapital), otherEquity: N(r.otherEquity), totalAssets: N(r.totalAssets), paidUpEquityCapital: N(r.paidUpEquityCapital), faceValueShare: N(r.faceValueShare), netProfit: N(r.netProfit), revenue: N(r.revenue) },
    pr ? { revenue: N(pr.revenue), netProfit: N(pr.netProfit), loans: N(pr.loans), totalEquity: N(pr.totalEquity), equityShareCapital: N(pr.equityShareCapital), otherEquity: N(pr.otherEquity), debtSecurities: N(pr.debtSecurities), borrowings: N(pr.borrowings), subordinatedLiabilities: N(pr.subordinatedLiabilities), depositsLiabilities: N(pr.depositsLiabilities) } : null,
  );
  const changed = computeChanged(asRec(r), asRec(d.columns), NBFC_COLS);
  await db.nbfcFundamental.update({ where: { id: rowId }, data: d.columns });
  return { table: "NbfcFundamental", rowId, changed, symbol: r.stock.symbol, periodKey: r.fiscalYear, edit: annualEdit(r.reportDate) };
}

// ── LifeInsuranceFundamental (annual) ─────────────────────────
const LI_COLS = ["netWorth", "bookValuePerShare", "roe", "newBusinessPremiumPct", "expenseRatioPolicyholders", "premiumGrowthYoy", "patGrowthYoy"] as const;
export async function reDeriveLiAnnual(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.lifeInsuranceFundamental.findUniqueOrThrow({ where: { id: rowId }, include: { stock: { select: { symbol: true } } } });
  const pr = await db.lifeInsuranceFundamental.findUnique({ where: { stockId_fiscalYear_resultType: { stockId: r.stockId, fiscalYear: decrementFY(r.fiscalYear), resultType: r.resultType } }, select: { shareCapital: true, reservesAndSurplus: true, fairValueChangeAccount: true, grossPremiumIncome: true, netProfit: true } });
  const d = deriveLiAnnual(
    { shareCapital: N(r.shareCapital), reservesAndSurplus: N(r.reservesAndSurplus), fairValueChangeAccount: N(r.fairValueChangeAccount), paidUpEquityCapital: N(r.paidUpEquityCapital), faceValueShare: N(r.faceValueShare), incomeFirstYearPremium: N(r.incomeFirstYearPremium), grossPremiumIncome: N(r.grossPremiumIncome), totalOperatingExpenses: N(r.totalOperatingExpenses), netProfit: N(r.netProfit) },
    pr ? { shareCapital: N(pr.shareCapital), reservesAndSurplus: N(pr.reservesAndSurplus), fairValueChangeAccount: N(pr.fairValueChangeAccount), grossPremiumIncome: N(pr.grossPremiumIncome), netProfit: N(pr.netProfit) } : null,
  );
  const changed = computeChanged(asRec(r), asRec(d.columns), LI_COLS);
  await db.lifeInsuranceFundamental.update({ where: { id: rowId }, data: d.columns });
  return { table: "LifeInsuranceFundamental", rowId, changed, symbol: r.stock.symbol, periodKey: r.fiscalYear, edit: annualEdit(r.reportDate) };
}

// ── GeneralInsuranceFundamental (annual) ──────────────────────
const GI_COLS = ["netWorth", "bookValuePerShare", "roe", "netUnderwritingMargin", "gpwGrowthYoy", "patGrowthYoy"] as const;
export async function reDeriveGiAnnual(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.generalInsuranceFundamental.findUniqueOrThrow({ where: { id: rowId }, include: { stock: { select: { symbol: true } } } });
  const pr = await db.generalInsuranceFundamental.findUnique({ where: { stockId_fiscalYear_resultType: { stockId: r.stockId, fiscalYear: decrementFY(r.fiscalYear), resultType: r.resultType } }, select: { shareCapital: true, reservesAndSurplus: true, fairValueChangeAccount: true, grossPremiumsWritten: true, netProfit: true } });
  const d = deriveGiAnnual(
    { shareCapital: N(r.shareCapital), reservesAndSurplus: N(r.reservesAndSurplus), fairValueChangeAccount: N(r.fairValueChangeAccount), paidUpEquityCapital: N(r.paidUpEquityCapital), faceValueShare: N(r.faceValueShare), combinedRatio: N(r.combinedRatio), netProfit: N(r.netProfit), grossPremiumsWritten: N(r.grossPremiumsWritten) },
    pr ? { shareCapital: N(pr.shareCapital), reservesAndSurplus: N(pr.reservesAndSurplus), fairValueChangeAccount: N(pr.fairValueChangeAccount), grossPremiumsWritten: N(pr.grossPremiumsWritten), netProfit: N(pr.netProfit) } : null,
  );
  const changed = computeChanged(asRec(r), asRec(d.columns), GI_COLS);
  await db.generalInsuranceFundamental.update({ where: { id: rowId }, data: d.columns });
  return { table: "GeneralInsuranceFundamental", rowId, changed, symbol: r.stock.symbol, periodKey: r.fiscalYear, edit: annualEdit(r.reportDate) };
}

// ── Financial QUARTERLY siblings ──────────────────────────────
const BANKQ_COLS = ["nii", "totalIncome", "costToIncomeRatio", "netMargin", "pcr", "tier1Ratio", "niiQoq", "niiYoy", "patQoq", "patYoy"] as const;
export async function reDeriveBankingQuarterly(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.bankingQuarterlyResult.findUniqueOrThrow({ where: { id: rowId }, include: { stock: { select: { symbol: true } } } });
  const priorQ = getPriorQuarter(r.quarter, r.fiscalYear);
  const pr = priorQ ? await db.bankingQuarterlyResult.findUnique({ where: { stockId_quarter_fiscalYear_resultType: { stockId: r.stockId, quarter: priorQ.quarter, fiscalYear: priorQ.fiscalYear, resultType: r.resultType } }, select: { nii: true, netProfit: true } }) : null;
  const ya = await db.bankingQuarterlyResult.findUnique({ where: { stockId_quarter_fiscalYear_resultType: { stockId: r.stockId, quarter: r.quarter, fiscalYear: decrementFY(r.fiscalYear), resultType: r.resultType } }, select: { nii: true, netProfit: true } });
  const d = deriveBankingQuarterly(
    { interestEarned: N(r.interestEarned), interestExpended: N(r.interestExpended), otherIncome: N(r.otherIncome), expenditureExclProvisions: N(r.expenditureExclProvisions), netProfit: N(r.netProfit), gnpaAbsolute: N(r.gnpaAbsolute), nnpaAbsolute: N(r.nnpaAbsolute), cet1Ratio: N(r.cet1Ratio), additionalTier1Ratio: N(r.additionalTier1Ratio), auditPending: r.auditPending },
    pr ? { nii: N(pr.nii), netProfit: N(pr.netProfit) } : null,
    ya ? { nii: N(ya.nii), netProfit: N(ya.netProfit) } : null,
  );
  const changed = computeChanged(asRec(r), asRec(d.columns), BANKQ_COLS);
  await db.bankingQuarterlyResult.update({ where: { id: rowId }, data: d.columns });
  return { table: "BankingQuarterlyResult", rowId, changed, symbol: r.stock.symbol, periodKey: `${r.fiscalYear}${r.quarter}`, edit: quarterEdit(r.fiscalYear, r.quarter) };
}

const NBFCQ_COLS = ["nii", "netMargin", "revenueQoq", "revenueYoy", "patQoq", "patYoy"] as const;
export async function reDeriveNbfcQuarterly(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.nbfcQuarterlyResult.findUniqueOrThrow({ where: { id: rowId }, include: { stock: { select: { symbol: true } } } });
  const priorQ = getPriorQuarter(r.quarter, r.fiscalYear);
  const pr = priorQ ? await db.nbfcQuarterlyResult.findUnique({ where: { stockId_quarter_fiscalYear_resultType: { stockId: r.stockId, quarter: priorQ.quarter, fiscalYear: priorQ.fiscalYear, resultType: r.resultType } }, select: { revenue: true, netProfit: true } }) : null;
  const ya = await db.nbfcQuarterlyResult.findUnique({ where: { stockId_quarter_fiscalYear_resultType: { stockId: r.stockId, quarter: r.quarter, fiscalYear: decrementFY(r.fiscalYear), resultType: r.resultType } }, select: { revenue: true, netProfit: true } });
  const d = deriveNbfcQuarterly(
    { interestIncome: N(r.interestIncome), financeCosts: N(r.financeCosts), netProfit: N(r.netProfit), totalIncome: N(r.totalIncome), revenue: N(r.revenue) },
    pr ? { revenue: N(pr.revenue), netProfit: N(pr.netProfit) } : null,
    ya ? { revenue: N(ya.revenue), netProfit: N(ya.netProfit) } : null,
  );
  const changed = computeChanged(asRec(r), asRec(d.columns), NBFCQ_COLS);
  await db.nbfcQuarterlyResult.update({ where: { id: rowId }, data: d.columns });
  return { table: "NbfcQuarterlyResult", rowId, changed, symbol: r.stock.symbol, periodKey: `${r.fiscalYear}${r.quarter}`, edit: quarterEdit(r.fiscalYear, r.quarter) };
}

const LIQ_COLS = ["newBusinessPremiumPct", "expenseRatioPolicyholders", "netMargin", "premiumQoq", "premiumYoy", "patQoq", "patYoy"] as const;
export async function reDeriveLiQuarterly(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.lifeInsuranceQuarterlyResult.findUniqueOrThrow({ where: { id: rowId }, include: { stock: { select: { symbol: true } } } });
  const priorQ = getPriorQuarter(r.quarter, r.fiscalYear);
  const pr = priorQ ? await db.lifeInsuranceQuarterlyResult.findUnique({ where: { stockId_quarter_fiscalYear_resultType: { stockId: r.stockId, quarter: priorQ.quarter, fiscalYear: priorQ.fiscalYear, resultType: r.resultType } }, select: { grossPremiumIncome: true, netProfit: true } }) : null;
  const ya = await db.lifeInsuranceQuarterlyResult.findUnique({ where: { stockId_quarter_fiscalYear_resultType: { stockId: r.stockId, quarter: r.quarter, fiscalYear: decrementFY(r.fiscalYear), resultType: r.resultType } }, select: { grossPremiumIncome: true, netProfit: true } });
  const d = deriveLiQuarterly(
    { incomeFirstYearPremium: N(r.incomeFirstYearPremium), grossPremiumIncome: N(r.grossPremiumIncome), totalOperatingExpenses: N(r.totalOperatingExpenses), netProfit: N(r.netProfit), totalRevenuePolicyholders: N(r.totalRevenuePolicyholders) },
    pr ? { grossPremiumIncome: N(pr.grossPremiumIncome), netProfit: N(pr.netProfit) } : null,
    ya ? { grossPremiumIncome: N(ya.grossPremiumIncome), netProfit: N(ya.netProfit) } : null,
  );
  const changed = computeChanged(asRec(r), asRec(d.columns), LIQ_COLS);
  await db.lifeInsuranceQuarterlyResult.update({ where: { id: rowId }, data: d.columns });
  return { table: "LifeInsuranceQuarterlyResult", rowId, changed, symbol: r.stock.symbol, periodKey: `${r.fiscalYear}${r.quarter}`, edit: quarterEdit(r.fiscalYear, r.quarter) };
}

const GIQ_COLS = ["netUnderwritingMargin", "netMargin", "gpwQoq", "gpwYoy", "patQoq", "patYoy"] as const;
export async function reDeriveGiQuarterly(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.generalInsuranceQuarterlyResult.findUniqueOrThrow({ where: { id: rowId }, include: { stock: { select: { symbol: true } } } });
  const priorQ = getPriorQuarter(r.quarter, r.fiscalYear);
  const pr = priorQ ? await db.generalInsuranceQuarterlyResult.findUnique({ where: { stockId_quarter_fiscalYear_resultType: { stockId: r.stockId, quarter: priorQ.quarter, fiscalYear: priorQ.fiscalYear, resultType: r.resultType } }, select: { grossPremiumsWritten: true, netProfit: true } }) : null;
  const ya = await db.generalInsuranceQuarterlyResult.findUnique({ where: { stockId_quarter_fiscalYear_resultType: { stockId: r.stockId, quarter: r.quarter, fiscalYear: decrementFY(r.fiscalYear), resultType: r.resultType } }, select: { grossPremiumsWritten: true, netProfit: true } });
  const d = deriveGiQuarterly(
    { combinedRatio: N(r.combinedRatio), netProfit: N(r.netProfit), totalRevenue: N(r.totalRevenue), grossPremiumsWritten: N(r.grossPremiumsWritten) },
    pr ? { grossPremiumsWritten: N(pr.grossPremiumsWritten), netProfit: N(pr.netProfit) } : null,
    ya ? { grossPremiumsWritten: N(ya.grossPremiumsWritten), netProfit: N(ya.netProfit) } : null,
  );
  const changed = computeChanged(asRec(r), asRec(d.columns), GIQ_COLS);
  await db.generalInsuranceQuarterlyResult.update({ where: { id: rowId }, data: d.columns });
  return { table: "GeneralInsuranceQuarterlyResult", rowId, changed, symbol: r.stock.symbol, periodKey: `${r.fiscalYear}${r.quarter}`, edit: quarterEdit(r.fiscalYear, r.quarter) };
}

// ── ShareholdingPattern — residual othersPct/retailPct re-derive ──
export async function reDeriveShareholding(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.shareholdingPattern.findUniqueOrThrow({ where: { id: rowId }, include: { stock: { select: { symbol: true } } } });
  const others = deriveOthersPct(N(r.publicPct) ?? 0, N(r.fiiPct), N(r.diiPct));
  const od = others == null ? null : new Prisma.Decimal(others);
  const changed = computeChanged(asRec(r), { othersPct: od, retailPct: od }, ["othersPct", "retailPct"]);
  await db.shareholdingPattern.update({ where: { id: rowId }, data: { othersPct: od, retailPct: od } });
  return { table: "ShareholdingPattern", rowId, changed, symbol: r.symbol, periodKey: `${r.fiscalYear}${r.quarter}`, edit: { kind: "quarter", periodKey: `${r.fiscalYear}${r.quarter}` } };
}

// ── CorporateEvent — display-only: raw write, no derived re-store ──
export async function reDeriveEvent(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.corporateEvent.findUniqueOrThrow({ where: { id: rowId }, select: { id: true, symbol: true, eventDate: true } });
  // No intra-row derived column is recomputed (impactLevel is a display heuristic;
  // events feed no score → no cascade). The raw field is already written by the caller.
  return { table: "CorporateEvent", rowId, changed: {}, symbol: r.symbol, periodKey: r.eventDate.toISOString().slice(0, 10), edit: { kind: "annual", reportDate: r.eventDate } };
}

// ── DailyPrice — raw write; StockPrice snapshot derived is refreshed by the
//    next price ingest. Scoring reads raw cleaned prices, so a current-frame PG
//    rescore (routing) reflects the fill. No intra-row re-derive here. ──
export async function reDerivePrice(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.dailyPrice.findUniqueOrThrow({ where: { id: rowId }, select: { id: true, date: true, stock: { select: { symbol: true } } } });
  return { table: "DailyPrice", rowId, changed: {}, symbol: r.stock.symbol, periodKey: r.date.toISOString().slice(0, 10), edit: { kind: "annual", reportDate: r.date } };
}

// ── Instrument (Step 9 — AMFI catalogue row). currentNav is the ONLY fillable field.
//    NOTHING derives from a NAV yet (NAV history + analytics are Steps 10/11), so there is
//    no intra-row re-derive — the raw write IS the whole correction. And a mutual fund is
//    HELD-NOT-SCORED (no peer group, no Health Score), so this must NEVER trigger a rescore:
//    Instrument is in NO_RESCORE_TABLES below. symbol is NULL for a fund, so the audit row
//    carries the ISIN — the spine — as its identity.
export async function reDeriveInstrument(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.instrument.findUniqueOrThrow({
    where: { id: rowId },
    select: { id: true, isin: true, navDate: true },
  });
  const when = r.navDate ?? new Date();
  return {
    table: "Instrument",
    rowId,
    changed: {},
    symbol: r.isin, // a fund has no ticker — the ISIN IS its identity
    periodKey: when.toISOString().slice(0, 10),
    edit: { kind: "annual", reportDate: when },
  };
}

// ── InstrumentPrice (Steps 14/15/17) — a trust's / G-sec's / bond's exchange close. ──
//
// TWO THINGS HAPPEN HERE, and the second is the one that matters.
//
// (a) The raw close is already written by the caller. Nothing derives from it INSIDE the row.
//
// (b) THE SNAPSHOT MUST FOLLOW. `instruments.last_price` is what every portfolio surface actually
//     reads (portfolio/price-resolver.ts takes the exchange-close branch off it) — the
//     instrument_prices row is the HISTORY. Correcting the history and leaving the snapshot alone
//     would mean the operator fills a bad close, sees the fill succeed, and the user carries on
//     being shown the wrong number. So when the row being corrected IS the one the snapshot was
//     taken from (same instrument, same date), the snapshot moves with it.
//
//     The date check is not a nicety: filling an OLD row must NOT drag a stale price forward onto
//     a fresher snapshot. That is the exact lie `last_price_date` exists to prevent, and the
//     ingest's own upsert guards it the same way.
//
// NO RESCORE, EVER. Every instrument in this table is stock_id-NULL — an ETF, a trust, a G-sec, a
// bond. They are HELD-NOT-SCORED by construction, so InstrumentPrice joins NO_RESCORE_TABLES below.
// A corrected bond close must never enqueue an equity rescore.
export async function reDeriveInstrumentPrice(db: Db, rowId: string): Promise<ReDeriveResult> {
  const r = await db.instrumentPrice.findUniqueOrThrow({
    where: { id: rowId },
    select: {
      id: true, date: true, close: true, instrumentId: true,
      instrument: { select: { isin: true, lastPrice: true, lastPriceDate: true } },
    },
  });

  const changed: Record<string, { before: string | null; after: string | null }> = {};
  const snapDate = r.instrument.lastPriceDate;

  // Move the snapshot ONLY if this row is the one it was taken from. Filling an OLD row must never
  // drag a stale price forward onto a fresher snapshot — that is the exact lie `last_price_date`
  // exists to prevent, and the ingest's own upsert guards it the same way.
  if (snapDate && r.date.getTime() === snapDate.getTime()) {
    const before = r.instrument.lastPrice;
    await db.instrument.update({ where: { id: r.instrumentId }, data: { lastPrice: r.close } });
    changed.lastPrice = {
      before: before?.toString() ?? null,
      after: r.close.toString(),
    };
  }

  return {
    table: "InstrumentPrice",
    rowId,
    changed,
    symbol: r.instrument.isin, // a bond/trust may have no ticker — the ISIN IS its identity
    periodKey: r.date.toISOString().slice(0, 10),
    edit: { kind: "annual", reportDate: r.date },
  };
}

// ── Registry — ALL fillable tables wired ──────────────────────
export const RE_DERIVE: Record<string, (db: Db, rowId: string) => Promise<ReDeriveResult>> = {
  Fundamental: reDeriveFundamentalAnnual,
  QuarterlyResult: reDeriveQuarterlyResult,
  BankingFundamental: reDeriveBankingAnnual,
  NbfcFundamental: reDeriveNbfcAnnual,
  LifeInsuranceFundamental: reDeriveLiAnnual,
  GeneralInsuranceFundamental: reDeriveGiAnnual,
  BankingQuarterlyResult: reDeriveBankingQuarterly,
  NbfcQuarterlyResult: reDeriveNbfcQuarterly,
  LifeInsuranceQuarterlyResult: reDeriveLiQuarterly,
  GeneralInsuranceQuarterlyResult: reDeriveGiQuarterly,
  // Hand-fillable non-fundamentals (Flag A):
  ShareholdingPattern: reDeriveShareholding, // residual othersPct/retailPct + PG cascade
  CorporateEvent: reDeriveEvent, // raw write, no rescore (display-only)
  DailyPrice: reDerivePrice, // raw write + current-frame PG rescore
  Instrument: reDeriveInstrument, // raw write, NO rescore (a fund is held-not-scored)
  InstrumentPrice: reDeriveInstrumentPrice, // raw write + snapshot follow, NO rescore (held-not-scored)
};

/** Tables whose fill triggers NO rescore (display-only, or held-not-scored).
 *
 *  InstrumentPrice belongs here for the STRUCTURAL reason, not a policy one: every row in it hangs
 *  off a stock_id-NULL instrument (an ETF, a trust, a G-sec, a bond). The scoring universe is
 *  PeerGroup → StockPeerGroup → Stock and literally cannot reach one. A rescore would be a no-op at
 *  best and a category error at worst — a corrected bond close has nothing to do with an equity's
 *  Health Score. */
export const NO_RESCORE_TABLES = new Set<string>(["CorporateEvent", "Instrument", "InstrumentPrice"]);
/** Date-indexed tables → current-frame PG rescore (not the quarterly PIT cascade).
 *  InstrumentPrice is deliberately NOT here: it is date-indexed, but it never rescores. */
export const PRICE_TABLES = new Set<string>(["DailyPrice"]);

export async function reDeriveRow(db: Db, table: string, rowId: string): Promise<ReDeriveResult> {
  const fn = RE_DERIVE[table];
  if (!fn) throw new Error(`re-derive not wired for table "${table}"`);
  return fn(db, rowId);
}
