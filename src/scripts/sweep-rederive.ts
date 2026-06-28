// ─────────────────────────────────────────────────────────────
// FINDING #5 — PROACTIVE deriveFromRow SWEEP over the 10 scored tables.
//
// Re-derives every stored display ratio from its raw columns + prior row, so the
// read/view layer serves CORRECT values (not the DB-state-at-original-ingest stale
// ones — YoY/QoQ/roe were null-or-wrong at ingest because the prior period row did
// not exist yet). Calls the SAME pure derive* functions ingestion + the fill bridge
// use (single derivation path → byte-faithful; boundDerived nulls its own
// precision-overflow outliers inside that path).
//
// BULK in-memory: read each table once (+ build prior-row maps in memory), derive,
// diff vs stored. Avoids the per-row cross-region round-trips that make the txn
// path unusably slow. DRY-RUN writes nothing; --apply writes only changed cells
// with a concurrency-limited batch (idempotent — a second run = 0 changes).
//
// Score-safety: annual Fundamental.operatingMargin is a SCORE-TIME input (F1_OPM
// PG8 + B-1/B-2 guardrail gating P7/P12). It is NOT prior-dependent → a healthy row
// re-derives it byte-identically (zero change). The sweep REPORTS any opm change
// and, in --apply, REFUSES to write it unless --allow-opm (so it cannot move a score).
//
// Run:  npx tsx src/scripts/sweep-rederive.ts                 (dry-run, all tables)
//       npx tsx src/scripts/sweep-rederive.ts --table=Fundamental
//       npx tsx src/scripts/sweep-rederive.ts --apply         (after confirm)
// ─────────────────────────────────────────────────────────────

import { writeFileSync } from "node:fs";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { decrementFY, getPriorQuarter, toNumber } from "../ingestions/quaterly-results/ingester-utils.js";
import { deriveIndAsAnnual, plausibleFaceValue } from "../ingestions/quaterly-results/derive/derive-indas-annual.js";
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

const N = (d: unknown) => toNumber((d as Prisma.Decimal | null) ?? null);
type Row = Record<string, unknown> & { id: string; stockId: string; resultType: string; stock: { symbol: string } };
type Cols = Record<string, Prisma.Decimal | null>;

// ── boundDerived warn capture: count the derive path's OWN outlier-nulls ──
let boundNulls = 0;
const boundNullByCol: Record<string, number> = {};
const origWarn = console.warn.bind(console);
console.warn = (...a: unknown[]) => {
  const s = String(a[0] ?? "");
  const m = s.match(/derived (\w+)=.*out of column range/);
  if (m) {
    boundNulls++;
    boundNullByCol[m[1]] = (boundNullByCol[m[1]] ?? 0) + 1;
    return;
  }
  origWarn(...a);
};

// ── Per-table config: COLS (the diffed/written derived columns), kind, fetch, derive ──
interface TableCfg {
  name: string;
  kind: "annual" | "quarterly";
  cols: readonly string[];
  fetch: () => Promise<Row[]>;
  derive: (row: Row, prior: Row | null, ya: Row | null) => Cols;
  update: (id: string, data: Cols) => Promise<void>;
}

const annualKey = (stockId: string, fy: string, rt: string) => `${stockId}|${fy}|${rt}`;
const qKey = (stockId: string, q: string, fy: string, rt: string) => `${stockId}|${q}|${fy}|${rt}`;

const CFG: TableCfg[] = [
  {
    name: "Fundamental",
    kind: "annual",
    cols: ["totalDebt", "fcf", "ebitda", "netMargin", "operatingMargin", "netWorth", "bookValuePerShare", "debtToEquity", "roe", "roce", "interestCoverage", "receivablesDays", "inventoryTurnover", "assetTurnover", "revenueGrowthYoy", "profitGrowthYoy", "epsGrowthYoy"],
    fetch: () => prisma.fundamental.findMany({ include: { stock: { select: { symbol: true } } } }) as unknown as Promise<Row[]>,
    derive: (r, prior) =>
      deriveIndAsAnnual(
        { revenue: N(r.revenue), netProfit: N(r.netProfit), financeCosts: N(r.financeCosts), depreciation: N(r.depreciation), profitBeforeTax: N(r.profitBeforeTax), equityShareCapital: N(r.equityShareCapital), otherEquity: N(r.otherEquity), totalEquity: N(r.totalEquity), equityAttributableToOwners: N(r.equityAttributableToOwners), borrowingsCurrent: N(r.borrowingsCurrent), borrowingsNoncurrent: N(r.borrowingsNoncurrent), cashFromOperating: N(r.cashFromOperating), capex: N(r.capex), paidUpEquityCapital: N(r.paidUpEquityCapital), faceValueShareSane: plausibleFaceValue(N(r.faceValueShare)), tradeReceivablesCurrent: N(r.tradeReceivablesCurrent), tradeReceivablesNoncurrent: N(r.tradeReceivablesNoncurrent), inventories: N(r.inventories), totalAssets: N(r.totalAssets), basicEps: N(r.basicEps) },
        prior ? { revenue: N(prior.revenue), netProfit: N(prior.netProfit), basicEps: N(prior.basicEps), totalEquity: N(prior.totalEquity), equityAttributableToOwners: N(prior.equityAttributableToOwners), equityShareCapital: N(prior.equityShareCapital), otherEquity: N(prior.otherEquity) } : null,
        `sweep ${String(r.fiscalYear)}/${r.resultType}`,
      ).columns as unknown as Cols,
    update: (id, data) => prisma.fundamental.update({ where: { id }, data }).then(() => undefined),
  },
  {
    name: "QuarterlyResult",
    kind: "quarterly",
    cols: ["operatingMargin", "netMargin", "revenueQoq", "revenueYoy", "profitQoq", "profitYoy"],
    fetch: () => prisma.quarterlyResult.findMany({ include: { stock: { select: { symbol: true } } } }) as unknown as Promise<Row[]>,
    derive: (r, pr, ya) =>
      deriveIndAsQuarterly(
        { revenue: N(r.revenue), netProfit: N(r.netProfit), operatingProfit: N(r.operatingProfit) },
        pr ? { revenue: N(pr.revenue), netProfit: N(pr.netProfit) } : null,
        ya ? { revenue: N(ya.revenue), netProfit: N(ya.netProfit) } : null,
      ).columns as unknown as Cols,
    update: (id, data) => prisma.quarterlyResult.update({ where: { id }, data }).then(() => undefined),
  },
  {
    name: "BankingFundamental",
    kind: "annual",
    cols: ["nii", "totalIncome", "netInterestMargin", "costToIncomeRatio", "creditCostPct", "roe", "creditDepositRatio", "netWorth", "bookValuePerShare", "pcr", "tier1Ratio", "niiGrowthYoy", "patGrowthYoy", "depositGrowthYoy", "advanceGrowthYoy", "assetGrowthYoy"],
    fetch: () => prisma.bankingFundamental.findMany({ include: { stock: { select: { symbol: true } } } }) as unknown as Promise<Row[]>,
    derive: (r, prior) =>
      deriveBankingAnnual(
        { interestEarned: N(r.interestEarned), interestExpended: N(r.interestExpended), otherIncome: N(r.otherIncome), expenditureExclProvisions: N(r.expenditureExclProvisions), capital: N(r.capital), reservesAndSurplus: N(r.reservesAndSurplus), paidUpEquityCapital: N(r.paidUpEquityCapital), faceValueShare: N(r.faceValueShare), gnpaAbsolute: N(r.gnpaAbsolute), nnpaAbsolute: N(r.nnpaAbsolute), cet1Ratio: N(r.cet1Ratio), additionalTier1Ratio: N(r.additionalTier1Ratio), provisions: N(r.provisions), advances: N(r.advances), investments: N(r.investments), deposits: N(r.deposits), netProfit: N(r.netProfit), totalAssets: N(r.totalAssets) },
        prior ? { capital: N(prior.capital), reservesAndSurplus: N(prior.reservesAndSurplus), advances: N(prior.advances), investments: N(prior.investments), nii: N(prior.nii), netProfit: N(prior.netProfit), deposits: N(prior.deposits), totalAssets: N(prior.totalAssets) } : null,
      ).columns as unknown as Cols,
    update: (id, data) => prisma.bankingFundamental.update({ where: { id }, data }).then(() => undefined),
  },
  {
    name: "BankingQuarterlyResult",
    kind: "quarterly",
    cols: ["nii", "totalIncome", "costToIncomeRatio", "netMargin", "pcr", "tier1Ratio", "niiQoq", "niiYoy", "patQoq", "patYoy"],
    fetch: () => prisma.bankingQuarterlyResult.findMany({ include: { stock: { select: { symbol: true } } } }) as unknown as Promise<Row[]>,
    derive: (r, pr, ya) =>
      deriveBankingQuarterly(
        { interestEarned: N(r.interestEarned), interestExpended: N(r.interestExpended), otherIncome: N(r.otherIncome), expenditureExclProvisions: N(r.expenditureExclProvisions), netProfit: N(r.netProfit), gnpaAbsolute: N(r.gnpaAbsolute), nnpaAbsolute: N(r.nnpaAbsolute), cet1Ratio: N(r.cet1Ratio), additionalTier1Ratio: N(r.additionalTier1Ratio), auditPending: r.auditPending as boolean },
        pr ? { nii: N(pr.nii), netProfit: N(pr.netProfit) } : null,
        ya ? { nii: N(ya.nii), netProfit: N(ya.netProfit) } : null,
      ).columns as unknown as Cols,
    update: (id, data) => prisma.bankingQuarterlyResult.update({ where: { id }, data }).then(() => undefined),
  },
  {
    name: "NbfcFundamental",
    kind: "annual",
    cols: ["nim", "costToIncomeRatio", "creditCostPct", "spread", "capitalToAssetsRatio", "borrowingsToEquity", "netWorth", "bookValuePerShare", "roe", "aumGrowthYoy", "revenueGrowthYoy", "patGrowthYoy"],
    fetch: () => prisma.nbfcFundamental.findMany({ include: { stock: { select: { symbol: true } } } }) as unknown as Promise<Row[]>,
    derive: (r, prior) =>
      deriveNbfcAnnual(
        { interestIncome: N(r.interestIncome), financeCosts: N(r.financeCosts), loans: N(r.loans), totalIncome: N(r.totalIncome), feeAndCommissionIncome: N(r.feeAndCommissionIncome), netGainOnFairValueChanges: N(r.netGainOnFairValueChanges), otherIncome: N(r.otherIncome), employeeBenefitExpense: N(r.employeeBenefitExpense), depreciation: N(r.depreciation), otherExpenses: N(r.otherExpenses), feeAndCommissionExpense: N(r.feeAndCommissionExpense), impairmentOnFinancialInstruments: N(r.impairmentOnFinancialInstruments), debtSecurities: N(r.debtSecurities), borrowings: N(r.borrowings), subordinatedLiabilities: N(r.subordinatedLiabilities), depositsLiabilities: N(r.depositsLiabilities), totalEquity: N(r.totalEquity), equityShareCapital: N(r.equityShareCapital), otherEquity: N(r.otherEquity), totalAssets: N(r.totalAssets), paidUpEquityCapital: N(r.paidUpEquityCapital), faceValueShare: N(r.faceValueShare), netProfit: N(r.netProfit), revenue: N(r.revenue) },
        prior ? { revenue: N(prior.revenue), netProfit: N(prior.netProfit), loans: N(prior.loans), totalEquity: N(prior.totalEquity), equityShareCapital: N(prior.equityShareCapital), otherEquity: N(prior.otherEquity), debtSecurities: N(prior.debtSecurities), borrowings: N(prior.borrowings), subordinatedLiabilities: N(prior.subordinatedLiabilities), depositsLiabilities: N(prior.depositsLiabilities) } : null,
      ).columns as unknown as Cols,
    update: (id, data) => prisma.nbfcFundamental.update({ where: { id }, data }).then(() => undefined),
  },
  {
    name: "NbfcQuarterlyResult",
    kind: "quarterly",
    cols: ["nii", "netMargin", "revenueQoq", "revenueYoy", "patQoq", "patYoy"],
    fetch: () => prisma.nbfcQuarterlyResult.findMany({ include: { stock: { select: { symbol: true } } } }) as unknown as Promise<Row[]>,
    derive: (r, pr, ya) =>
      deriveNbfcQuarterly(
        { interestIncome: N(r.interestIncome), financeCosts: N(r.financeCosts), netProfit: N(r.netProfit), totalIncome: N(r.totalIncome), revenue: N(r.revenue) },
        pr ? { revenue: N(pr.revenue), netProfit: N(pr.netProfit) } : null,
        ya ? { revenue: N(ya.revenue), netProfit: N(ya.netProfit) } : null,
      ).columns as unknown as Cols,
    update: (id, data) => prisma.nbfcQuarterlyResult.update({ where: { id }, data }).then(() => undefined),
  },
  {
    name: "LifeInsuranceFundamental",
    kind: "annual",
    cols: ["netWorth", "bookValuePerShare", "roe", "newBusinessPremiumPct", "expenseRatioPolicyholders", "premiumGrowthYoy", "patGrowthYoy"],
    fetch: () => prisma.lifeInsuranceFundamental.findMany({ include: { stock: { select: { symbol: true } } } }) as unknown as Promise<Row[]>,
    derive: (r, prior) =>
      deriveLiAnnual(
        { shareCapital: N(r.shareCapital), reservesAndSurplus: N(r.reservesAndSurplus), fairValueChangeAccount: N(r.fairValueChangeAccount), paidUpEquityCapital: N(r.paidUpEquityCapital), faceValueShare: N(r.faceValueShare), incomeFirstYearPremium: N(r.incomeFirstYearPremium), grossPremiumIncome: N(r.grossPremiumIncome), totalOperatingExpenses: N(r.totalOperatingExpenses), netProfit: N(r.netProfit) },
        prior ? { shareCapital: N(prior.shareCapital), reservesAndSurplus: N(prior.reservesAndSurplus), fairValueChangeAccount: N(prior.fairValueChangeAccount), grossPremiumIncome: N(prior.grossPremiumIncome), netProfit: N(prior.netProfit) } : null,
      ).columns as unknown as Cols,
    update: (id, data) => prisma.lifeInsuranceFundamental.update({ where: { id }, data }).then(() => undefined),
  },
  {
    name: "LifeInsuranceQuarterlyResult",
    kind: "quarterly",
    cols: ["newBusinessPremiumPct", "expenseRatioPolicyholders", "netMargin", "premiumQoq", "premiumYoy", "patQoq", "patYoy"],
    fetch: () => prisma.lifeInsuranceQuarterlyResult.findMany({ include: { stock: { select: { symbol: true } } } }) as unknown as Promise<Row[]>,
    derive: (r, pr, ya) =>
      deriveLiQuarterly(
        { incomeFirstYearPremium: N(r.incomeFirstYearPremium), grossPremiumIncome: N(r.grossPremiumIncome), totalOperatingExpenses: N(r.totalOperatingExpenses), netProfit: N(r.netProfit), totalRevenuePolicyholders: N(r.totalRevenuePolicyholders) },
        pr ? { grossPremiumIncome: N(pr.grossPremiumIncome), netProfit: N(pr.netProfit) } : null,
        ya ? { grossPremiumIncome: N(ya.grossPremiumIncome), netProfit: N(ya.netProfit) } : null,
      ).columns as unknown as Cols,
    update: (id, data) => prisma.lifeInsuranceQuarterlyResult.update({ where: { id }, data }).then(() => undefined),
  },
  {
    name: "GeneralInsuranceFundamental",
    kind: "annual",
    cols: ["netWorth", "bookValuePerShare", "roe", "netUnderwritingMargin", "gpwGrowthYoy", "patGrowthYoy"],
    fetch: () => prisma.generalInsuranceFundamental.findMany({ include: { stock: { select: { symbol: true } } } }) as unknown as Promise<Row[]>,
    derive: (r, prior) =>
      deriveGiAnnual(
        { shareCapital: N(r.shareCapital), reservesAndSurplus: N(r.reservesAndSurplus), fairValueChangeAccount: N(r.fairValueChangeAccount), paidUpEquityCapital: N(r.paidUpEquityCapital), faceValueShare: N(r.faceValueShare), combinedRatio: N(r.combinedRatio), netProfit: N(r.netProfit), grossPremiumsWritten: N(r.grossPremiumsWritten) },
        prior ? { shareCapital: N(prior.shareCapital), reservesAndSurplus: N(prior.reservesAndSurplus), fairValueChangeAccount: N(prior.fairValueChangeAccount), grossPremiumsWritten: N(prior.grossPremiumsWritten), netProfit: N(prior.netProfit) } : null,
      ).columns as unknown as Cols,
    update: (id, data) => prisma.generalInsuranceFundamental.update({ where: { id }, data }).then(() => undefined),
  },
  {
    name: "GeneralInsuranceQuarterlyResult",
    kind: "quarterly",
    cols: ["netUnderwritingMargin", "netMargin", "gpwQoq", "gpwYoy", "patQoq", "patYoy"],
    fetch: () => prisma.generalInsuranceQuarterlyResult.findMany({ include: { stock: { select: { symbol: true } } } }) as unknown as Promise<Row[]>,
    derive: (r, pr, ya) =>
      deriveGiQuarterly(
        { combinedRatio: N(r.combinedRatio), netProfit: N(r.netProfit), totalRevenue: N(r.totalRevenue), grossPremiumsWritten: N(r.grossPremiumsWritten) },
        pr ? { grossPremiumsWritten: N(pr.grossPremiumsWritten), netProfit: N(pr.netProfit) } : null,
        ya ? { grossPremiumsWritten: N(ya.grossPremiumsWritten), netProfit: N(ya.netProfit) } : null,
      ).columns as unknown as Cols,
    update: (id, data) => prisma.generalInsuranceQuarterlyResult.update({ where: { id }, data }).then(() => undefined),
  },
];

// magnitude-outlier ceiling per column class (first-cut flag; denom≈0 confirmed below)
const outlierCeiling = (col: string) => (/(Yoy|Qoq|Growth|growth)/.test(col) ? 300 : col === "roe" ? 100 : 1000);

// Columns whose large magnitude is a REAL absolute ₹Cr figure (no denominator) — never
// a denom≈0 artifact, always kept. (ebitda=sum, fcf=difference, totalDebt=sum, nii, totalIncome.)
const ABSOLUTE_COLS = new Set(["ebitda", "fcf", "totalDebt", "nii", "totalIncome", "netWorth"]);

// Growth column → the raw field + which prior row supplies its DENOMINATOR.
// (annual *GrowthYoy + quarterly *Qoq use the immediately-prior row; quarterly *Yoy uses year-ago.)
const GROWTH_DENOM: Record<string, { field: string; ref: "prior" | "ya" }> = {
  revenueQoq: { field: "revenue", ref: "prior" }, revenueYoy: { field: "revenue", ref: "ya" }, revenueGrowthYoy: { field: "revenue", ref: "prior" },
  profitQoq: { field: "netProfit", ref: "prior" }, profitYoy: { field: "netProfit", ref: "ya" }, profitGrowthYoy: { field: "netProfit", ref: "prior" },
  patQoq: { field: "netProfit", ref: "prior" }, patYoy: { field: "netProfit", ref: "ya" }, patGrowthYoy: { field: "netProfit", ref: "prior" },
  niiQoq: { field: "nii", ref: "prior" }, niiYoy: { field: "nii", ref: "ya" }, niiGrowthYoy: { field: "nii", ref: "prior" },
  premiumQoq: { field: "grossPremiumIncome", ref: "prior" }, premiumYoy: { field: "grossPremiumIncome", ref: "ya" }, premiumGrowthYoy: { field: "grossPremiumIncome", ref: "prior" },
  gpwQoq: { field: "grossPremiumsWritten", ref: "prior" }, gpwYoy: { field: "grossPremiumsWritten", ref: "ya" }, gpwGrowthYoy: { field: "grossPremiumsWritten", ref: "prior" },
  aumGrowthYoy: { field: "loans", ref: "prior" }, depositGrowthYoy: { field: "deposits", ref: "prior" },
  advanceGrowthYoy: { field: "advances", ref: "prior" }, assetGrowthYoy: { field: "totalAssets", ref: "prior" },
  epsGrowthYoy: { field: "basicEps", ref: "prior" },
};

// ── OUTLIER RULE (ratified): magnitude cap >1000% on PERCENTAGE columns; shares-floor
//    on bookValuePerShare (a per-share ₹ value — magnitude is the wrong test, a real
//    high-priced stock has bvps in the thousands; the artifacts are shares≈0). Applied
//    BEFORE the diff so the sweep is a true fixpoint (a held-null outlier shows no change
//    on re-run). Absolute ₹Cr columns (ebitda/fcf/…) are never capped. ──
const PERCENT_CAP = 1000;
const PERCENT_COLS = new Set([
  "netMargin", "operatingMargin", "netUnderwritingMargin", "newBusinessPremiumPct", "expenseRatioPolicyholders", "creditCostPct",
  "roe", "roce", "debtToEquity", "costToIncomeRatio", "creditDepositRatio", "pcr", "tier1Ratio", "capitalToAssetsRatio",
  "netRetentionRatio", "combinedRatio", "nim", "netInterestMargin", "spread", "borrowingsToEquity",
]);
const isPercentCol = (col: string) => /(Yoy|Qoq|Growth)/.test(col) || PERCENT_COLS.has(col);
const BVPS_SHARES_FLOOR = 0.05; // ₹Cr-denominated shares outstanding (0.05Cr = 500k shares); below → artifact

/** Apply the outlier rule → returns the TARGET value (null if the rule suppresses it). */
function applyOutlierRule(col: string, val: Prisma.Decimal | null, r: Row, prior: Row | null, ya: Row | null): { target: Prisma.Decimal | null; ruleNulled: boolean } {
  if (val === null) return { target: null, ruleNulled: false };
  if (isPercentCol(col) && Math.abs(Number(val.toString())) > PERCENT_CAP) return { target: null, ruleNulled: true };
  if (col === "bookValuePerShare") {
    const shares = denomOf("bookValuePerShare", r, prior, ya);
    if (shares !== null && Math.abs(shares) < BVPS_SHARES_FLOOR) return { target: null, ruleNulled: true };
  }
  return { target: val, ruleNulled: false };
}

/** The governing denominator for a ratio cell (null when not a denom-bearing ratio). */
function denomOf(col: string, r: Row, prior: Row | null, ya: Row | null): number | null {
  const g = GROWTH_DENOM[col];
  if (g) {
    const src = g.ref === "prior" ? prior : ya;
    return src ? N(src[g.field]) : null;
  }
  if (col === "bookValuePerShare") {
    const face = N(r.faceValueShare);
    const paid = N(r.paidUpEquityCapital);
    return face !== null && paid !== null && face > 0 ? paid / face : null; // shares outstanding
  }
  return null; // roe (avgEquity) etc. — not auto-resolved; few cells, inspected by hand
}

interface ChangedCell {
  table: string;
  rowId: string;
  symbol: string;
  periodKey: string;
  column: string;
  before: string | null;
  after: string | null;
  bucket: "null_to_value" | "value_to_null" | "value_to_value";
  deltaAbs: number | null;
  magnitudeOutlier: boolean;
  ruleNulled: boolean; // the outlier rule suppressed a non-null re-derive → null target
  denom: number | null; // governing denominator (for the denom≈0 test); null if N/A
}

function buildPriorMaps(rows: Row[], kind: "annual" | "quarterly") {
  const byKey = new Map<string, Row>();
  for (const r of rows) {
    if (kind === "annual") byKey.set(annualKey(r.stockId, String(r.fiscalYear), r.resultType), r);
    else byKey.set(qKey(r.stockId, String(r.quarter), String(r.fiscalYear), r.resultType), r);
  }
  return byKey;
}

function periodKeyOf(r: Row, kind: "annual" | "quarterly") {
  return kind === "annual" ? String(r.fiscalYear) : `${String(r.fiscalYear)}${String(r.quarter)}`;
}

/** Returns {cells, targets}: the diff vs the OUTLIER-RULE-ADJUSTED target, plus the
 *  target column map (for the apply write). before==stored, after==target. */
function diffRow(cfg: TableCfg, r: Row, derived: Cols, prior: Row | null, ya: Row | null): { cells: ChangedCell[]; targets: Cols } {
  const out: ChangedCell[] = [];
  const targets: Cols = {};
  const cur = r as unknown as Cols;
  for (const c of cfg.cols) {
    const before = cur[c] ?? null;
    const rawDerived = derived[c] ?? null;
    const { target, ruleNulled } = applyOutlierRule(c, rawDerived, r, prior, ya);
    targets[c] = target;
    const same = (before == null && target == null) || (before != null && target != null && before.equals(target));
    if (same) continue;
    const b = before === null ? null : Number(before.toString());
    const a = target === null ? null : Number(target.toString());
    const bucket = b === null ? "null_to_value" : a === null ? "value_to_null" : "value_to_value";
    out.push({
      table: cfg.name, rowId: r.id, symbol: r.stock.symbol, periodKey: periodKeyOf(r, cfg.kind), column: c,
      before: before?.toString() ?? null, after: target?.toString() ?? null, bucket,
      deltaAbs: b !== null && a !== null ? Math.abs(a - b) : null,
      magnitudeOutlier: rawDerived !== null && !ABSOLUTE_COLS.has(c) && Math.abs(Number(rawDerived.toString())) > outlierCeiling(c),
      ruleNulled,
      denom: denomOf(c, r, prior, ya),
    });
  }
  return { cells: out, targets };
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const allowOpm = args.includes("--allow-opm");
  const tableArg = args.find((a) => a.startsWith("--table="))?.split("=")[1];
  const cfgs = tableArg ? CFG.filter((c) => c.name === tableArg) : CFG;

  console.log(`\n=== deriveFromRow sweep — ${apply ? "APPLY (writing)" : "DRY-RUN (no writes)"} ===`);
  console.log(`Tables: ${cfgs.map((c) => c.name).join(", ")}\n`);

  const all: ChangedCell[] = [];
  const writes: { cfg: TableCfg; id: string; data: Cols }[] = [];

  for (const cfg of cfgs) {
    const rows = await cfg.fetch();
    const map = buildPriorMaps(rows, cfg.kind);
    let rowsTouched = 0;
    for (const r of rows) {
      let prior: Row | null = null;
      let ya: Row | null = null;
      if (cfg.kind === "annual") {
        prior = map.get(annualKey(r.stockId, decrementFY(String(r.fiscalYear)), r.resultType)) ?? null;
      } else {
        const pq = getPriorQuarter(String(r.quarter), String(r.fiscalYear));
        prior = pq ? map.get(qKey(r.stockId, pq.quarter, pq.fiscalYear, r.resultType)) ?? null : null;
        ya = map.get(qKey(r.stockId, String(r.quarter), decrementFY(String(r.fiscalYear)), r.resultType)) ?? null;
      }
      const derived = cfg.derive(r, prior, ya);
      const { cells, targets } = diffRow(cfg, r, derived, prior, ya);
      if (cells.length === 0) continue;
      rowsTouched++;
      all.push(...cells);
      if (apply) {
        // Build the write data: only changed columns → TARGET value (outlier-rule applied),
        // with the operatingMargin score-safety gate (skip annual Fundamental.operatingMargin).
        const data: Cols = {};
        for (const cell of cells) {
          if (cfg.name === "Fundamental" && cell.column === "operatingMargin" && !allowOpm) continue;
          data[cell.column] = targets[cell.column] ?? null;
        }
        if (Object.keys(data).length > 0) writes.push({ cfg, id: r.id, data });
      }
    }
    console.log(`  ${cfg.name}: ${rows.length} rows scanned, ${rowsTouched} would change`);
  }

  // ── Distribution ──
  console.log(`\n── DISTRIBUTION (${all.length} changed cells total) ──`);
  const byBucket = { null_to_value: 0, value_to_null: 0, value_to_value: 0 };
  for (const c of all) byBucket[c.bucket]++;
  console.log(`  null→value (stale-null backfill):    ${byBucket.null_to_value}`);
  console.log(`  value→null (cleared, incl. outlier rule): ${byBucket.value_to_null}`);
  console.log(`  value→value (precision/re-baseline): ${byBucket.value_to_value}`);
  const ruleNulledCount = all.filter((c) => c.ruleNulled).length;
  console.log(`\n  outlier-rule nulls (|%|>${PERCENT_CAP} or bvps shares<${BVPS_SHARES_FLOOR}Cr): ${ruleNulledCount} (held null — value→null in buckets; null→value outliers stay null → not counted)`);
  console.log(`  boundDerived precision-cap nulls (derive path's OWN outlier handling): ${boundNulls}`);
  for (const [c, n] of Object.entries(boundNullByCol).sort((a, b) => b[1] - a[1])) console.log(`     ${c}: ${n}`);

  console.log(`\n── per-table cells ──`);
  const perTable: Record<string, number> = {};
  for (const c of all) perTable[c.table] = (perTable[c.table] ?? 0) + 1;
  for (const [t, n] of Object.entries(perTable).sort((a, b) => b[1] - a[1])) console.log(`  ${t}: ${n}`);

  console.log(`\n── per-column cells (table.column) ──`);
  const perCol: Record<string, { n: number; nv: number; vv: number; vn: number; out: number }> = {};
  for (const c of all) {
    const k = `${c.table}.${c.column}`;
    perCol[k] ??= { n: 0, nv: 0, vv: 0, vn: 0, out: 0 };
    perCol[k].n++;
    if (c.bucket === "null_to_value") perCol[k].nv++;
    else if (c.bucket === "value_to_value") perCol[k].vv++;
    else perCol[k].vn++;
    if (c.magnitudeOutlier) perCol[k].out++;
  }
  for (const [k, v] of Object.entries(perCol).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${k}: ${v.n}  (null→val ${v.nv}, val→val ${v.vv}, val→null ${v.vn}${v.out ? `, OUTLIERS ${v.out}` : ""})`);
  }

  const outliers = all.filter((c) => c.magnitudeOutlier);
  console.log(`\n── MAGNITUDE OUTLIERS (ratio cells |after| beyond ceiling, absolute ₹Cr cols excluded): ${outliers.length} ──`);
  for (const c of outliers.sort((a, b) => Math.abs(Number(b.after)) - Math.abs(Number(a.after))).slice(0, 40)) {
    console.log(`  ${c.table}.${c.column} ${c.symbol} ${c.periodKey}: ${c.before} → ${c.after}  [denom=${c.denom === null ? "?" : c.denom.toFixed(4)}] (${c.bucket})`);
  }
  if (outliers.length > 40) console.log(`  … +${outliers.length - 40} more (in JSON)`);

  // ── DENOMINATOR-BASED outlier classification (the Step-2 rule) ──
  // A ratio cell is a denom≈0 artifact when |denom| < floor (absolute ₹Cr for growth;
  // shares-outstanding for bvps). This KEEPS big-but-real growth off a normal base
  // (denom not tiny) and nulls only the mathematical artifacts off a ~0 base.
  console.log(`\n── DENOM≈0 ARTIFACT COUNT at candidate floors (ratio outliers only) ──`);
  const ratioOutliers = outliers.filter((c) => c.denom !== null);
  const unresolved = outliers.filter((c) => c.denom === null);
  for (const floor of [0.1, 0.25, 0.5, 1.0]) {
    const nulled = ratioOutliers.filter((c) => Math.abs(c.denom!) < floor);
    const kept = ratioOutliers.filter((c) => Math.abs(c.denom!) >= floor);
    console.log(`  floor ₹${floor}Cr: NULL ${nulled.length} (denom<floor), KEEP ${kept.length} (denom≥floor, real)`);
  }
  console.log(`  (ratio outliers with resolvable denom: ${ratioOutliers.length}; unresolved (roe avgEquity etc.): ${unresolved.length} — inspect by hand)`);
  if (unresolved.length > 0) for (const c of unresolved) console.log(`     UNRESOLVED ${c.table}.${c.column} ${c.symbol} ${c.periodKey}: → ${c.after}`);

  // Show the kept-vs-nulled boundary cases at the ₹0.5Cr floor (the natural pick)
  console.log(`\n── BOUNDARY @ ₹0.5Cr floor — KEPT real large-growth (denom≥0.5, sanity-check these are real) ──`);
  for (const c of ratioOutliers.filter((c) => Math.abs(c.denom!) >= 0.5).sort((a, b) => Math.abs(Number(b.after)) - Math.abs(Number(a.after))).slice(0, 20)) {
    console.log(`  ${c.table}.${c.column} ${c.symbol} ${c.periodKey}: ${c.after}%  [denom=₹${c.denom!.toFixed(3)}Cr] KEEP`);
  }

  const opm = all.filter((c) => c.table === "Fundamental" && c.column === "operatingMargin");
  console.log(`\n── SCORE-INPUT WATCH: Fundamental.operatingMargin changes: ${opm.length} ──`);
  if (opm.length > 0) {
    console.log(`  ⚠ operatingMargin feeds F1_OPM (PG8) + B-1/B-2 guardrail (P7/P12). These would move scores:`);
    for (const c of opm.slice(0, 40)) console.log(`    ${c.symbol} ${c.periodKey}: ${c.before} → ${c.after} (${c.bucket}${c.deltaAbs !== null ? `, |Δ|=${c.deltaAbs}` : ""})`);
  } else {
    console.log(`  ✓ none — re-derives byte-identical on every annual Fundamental row (score-safe).`);
  }

  const outPath = "C:/Users/PUNCTU~1/AppData/Local/Temp/claude/c--Users-Punctuations-Downloads-personal-personal/60ab8c83-614b-4a66-8406-c1c7c4e9b9a0/scratchpad/sweep-dryrun.json";
  writeFileSync(outPath, JSON.stringify(all, null, 2));
  console.log(`\nFull per-cell detail → ${outPath}`);

  if (apply) {
    console.log(`\n── APPLYING ${writes.length} row-writes (concurrency 20) ──`);
    let done = 0;
    await mapLimit(writes, 20, async (w) => {
      await w.cfg.update(w.id, w.data);
      if (++done % 500 === 0) console.log(`  …${done}/${writes.length}`);
    });
    console.log(`  ✓ applied ${writes.length} row-writes`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
