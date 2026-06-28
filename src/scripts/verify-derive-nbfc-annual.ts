// ─────────────────────────────────────────────────────────────
// DENOM-AWARE GATE — Stage 1d (NbfcFundamental deriveNbfcAnnual). READ-ONLY.
//   NON-prior (5): costToIncomeRatio, capitalToAssetsRatio, borrowingsToEquity,
//     netWorth, bookValuePerShare → tolerance gate.
//   PRIOR-dependent (7): nim, creditCostPct, spread, roe, aum/revenue/patGrowthYoy
//     → exempt + determinism-checked + staleness reported.
// Run:  npx tsx src/scripts/verify-derive-nbfc-annual.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { decrementFY } from "../ingestions/quaterly-results/ingester-utils.js";
import {
  deriveNbfcAnnual,
  type NbfcAnnualRaw,
  type NbfcAnnualPrior,
} from "../ingestions/quaterly-results/derive/derive-nbfc-annual.js";

const num = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());
const NON_PRIOR = ["costToIncomeRatio", "capitalToAssetsRatio", "borrowingsToEquity", "netWorth", "bookValuePerShare"] as const;
const PRIOR_DEP = ["nim", "creditCostPct", "spread", "roe", "aumGrowthYoy", "revenueGrowthYoy", "patGrowthYoy"] as const;

let pass = 0, fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}
function withinTol(a: Prisma.Decimal, b: Prisma.Decimal): boolean {
  const abs = a.minus(b).abs();
  if (abs.lessThanOrEqualTo(0.01)) return true;
  if (a.abs().greaterThan(0)) return abs.div(a.abs()).lessThanOrEqualTo(0.005);
  return false;
}

function unitChecks() {
  console.log("\n[A] Synthetic formula unit-checks");
  const raw: NbfcAnnualRaw = {
    interestIncome: 300, financeCosts: 120, loans: 2000, totalIncome: 400,
    feeAndCommissionIncome: null, netGainOnFairValueChanges: null, otherIncome: null,
    employeeBenefitExpense: 40, depreciation: 10, otherExpenses: 20, feeAndCommissionExpense: 10,
    impairmentOnFinancialInstruments: 20, debtSecurities: 500, borrowings: 800,
    subordinatedLiabilities: 200, depositsLiabilities: 0, totalEquity: 1000,
    equityShareCapital: null, otherEquity: null, totalAssets: 2500,
    paidUpEquityCapital: 100, faceValueShare: 10, netProfit: 150, revenue: 500,
  };
  const prior: NbfcAnnualPrior = {
    revenue: 400, netProfit: 120, loans: 1800, totalEquity: 900,
    equityShareCapital: null, otherEquity: null, debtSecurities: 400, borrowings: 700,
    subordinatedLiabilities: 200, depositsLiabilities: 0,
  };
  const d = deriveNbfcAnnual(raw, prior).columns;
  check("netWorth = totalEquity 1000", num(d.netWorth) === 1000);
  check("costToIncomeRatio = 80/(400-120) = 0.285714", num(d.costToIncomeRatio) === 0.285714);
  check("capitalToAssetsRatio = 1000/2500 = 0.4", num(d.capitalToAssetsRatio) === 0.4);
  check("borrowingsToEquity = 1500/1000 = 1.5", num(d.borrowingsToEquity) === 1.5);
  check("bookValuePerShare = 1000/(100/10) = 100", num(d.bookValuePerShare) === 100);
  check("nim = (300-120)/avg(2000,1800)=180/1900 = 0.094737", num(d.nim) === 0.094737);
  check("creditCostPct = 20/1900 = 0.010526", num(d.creditCostPct) === 0.010526);
  check("spread = 300/1900 - 120/avg(1500,1300)=...-120/1400 = 0.072180", num(d.spread) === 0.07218);
  check("roe = 150/avg(1000,900)=150/950 = 0.157895", num(d.roe) === 0.157895);
  check("aumGrowthYoy = (2000-1800)/1800*100 = 11.1111", num(d.aumGrowthYoy) === 11.1111);
  check("revenueGrowthYoy = (500-400)/400*100 = 25", num(d.revenueGrowthYoy) === 25);
  check("patGrowthYoy = (150-120)/120*100 = 25", num(d.patGrowthYoy) === 25);

  // netWorth fallback to esc+oe when totalEquity null
  const fb = deriveNbfcAnnual({ ...raw, totalEquity: null, equityShareCapital: 100, otherEquity: 850 }, prior).columns;
  check("netWorth fallback = esc+oe = 950", num(fb.netWorth) === 950);
  // costToIncome null-gated on nii (interestIncome null → nii null → costToIncome null)
  const noNii = deriveNbfcAnnual({ ...raw, interestIncome: null }, prior).columns;
  check("costToIncomeRatio null when nii null (preserved quirk)", noNii.costToIncomeRatio === null);
  // no prior → avg denominators fall back to current (avgNonNull)
  const noP = deriveNbfcAnnual(raw, null).columns;
  check("no prior: nim = 180/2000 = 0.09", num(noP.nim) === 0.09);
  check("no prior: roe = 150/1000 = 0.15", num(noP.roe) === 0.15);
  check("no prior: revenueGrowthYoy null", noP.revenueGrowthYoy === null);
  // determinism
  const a = deriveNbfcAnnual(raw, prior).columns, b2 = deriveNbfcAnnual(raw, prior).columns;
  check("determinism (prior-dependent)", PRIOR_DEP.every((c) => String(a[c]) === String(b2[c])));
}

const SELECT = {
  id: true, stockId: true, fiscalYear: true, resultType: true,
  interestIncome: true, financeCosts: true, loans: true, totalIncome: true,
  feeAndCommissionIncome: true, netGainOnFairValueChanges: true, otherIncome: true,
  employeeBenefitExpense: true, depreciation: true, otherExpenses: true, feeAndCommissionExpense: true,
  impairmentOnFinancialInstruments: true, debtSecurities: true, borrowings: true,
  subordinatedLiabilities: true, depositsLiabilities: true, totalEquity: true,
  equityShareCapital: true, otherEquity: true, totalAssets: true, paidUpEquityCapital: true,
  faceValueShare: true, netProfit: true, revenue: true,
  nim: true, costToIncomeRatio: true, creditCostPct: true, spread: true, capitalToAssetsRatio: true,
  borrowingsToEquity: true, netWorth: true, bookValuePerShare: true, roe: true,
  aumGrowthYoy: true, revenueGrowthYoy: true, patGrowthYoy: true,
} as const;
type Row = Prisma.NbfcFundamentalGetPayload<{ select: typeof SELECT }>;

function rawOf(r: Row): NbfcAnnualRaw {
  return {
    interestIncome: num(r.interestIncome), financeCosts: num(r.financeCosts), loans: num(r.loans),
    totalIncome: num(r.totalIncome), feeAndCommissionIncome: num(r.feeAndCommissionIncome),
    netGainOnFairValueChanges: num(r.netGainOnFairValueChanges), otherIncome: num(r.otherIncome),
    employeeBenefitExpense: num(r.employeeBenefitExpense), depreciation: num(r.depreciation),
    otherExpenses: num(r.otherExpenses), feeAndCommissionExpense: num(r.feeAndCommissionExpense),
    impairmentOnFinancialInstruments: num(r.impairmentOnFinancialInstruments), debtSecurities: num(r.debtSecurities),
    borrowings: num(r.borrowings), subordinatedLiabilities: num(r.subordinatedLiabilities),
    depositsLiabilities: num(r.depositsLiabilities), totalEquity: num(r.totalEquity),
    equityShareCapital: num(r.equityShareCapital), otherEquity: num(r.otherEquity), totalAssets: num(r.totalAssets),
    paidUpEquityCapital: num(r.paidUpEquityCapital), faceValueShare: num(r.faceValueShare),
    netProfit: num(r.netProfit), revenue: num(r.revenue),
  };
}
function priorOf(r: Row): NbfcAnnualPrior {
  return {
    revenue: num(r.revenue), netProfit: num(r.netProfit), loans: num(r.loans), totalEquity: num(r.totalEquity),
    equityShareCapital: num(r.equityShareCapital), otherEquity: num(r.otherEquity), debtSecurities: num(r.debtSecurities),
    borrowings: num(r.borrowings), subordinatedLiabilities: num(r.subordinatedLiabilities), depositsLiabilities: num(r.depositsLiabilities),
  };
}

async function bulkDiff() {
  console.log("\n[B] Full re-derive vs stored (every nbfc_fundamentals row)");
  const rows = (await prisma.nbfcFundamental.findMany({ select: SELECT })) as Row[];
  const byKey = new Map<string, Row>();
  for (const r of rows) byKey.set(`${r.stockId}|${r.fiscalYear}|${r.resultType}`, r);

  const tol: Record<string, { exact: number; withinTol: number; bothNull: number; breach: number; maxAbs: Prisma.Decimal }> =
    Object.fromEntries(NON_PRIOR.map((c) => [c, { exact: 0, withinTol: 0, bothNull: 0, breach: 0, maxAbs: new Prisma.Decimal(0) }])) as never;
  const stale: Record<string, { exact: number; bothNull: number; nullMismatch: number; drift: number; maxRelPct: number }> =
    Object.fromEntries(PRIOR_DEP.map((c) => [c, { exact: 0, bothNull: 0, nullMismatch: 0, drift: 0, maxRelPct: 0 }])) as never;
  let breaches = 0;

  for (const r of rows) {
    const priorRow = byKey.get(`${r.stockId}|${decrementFY(r.fiscalYear)}|${r.resultType}`) ?? null;
    const d = deriveNbfcAnnual(rawOf(r), priorRow ? priorOf(priorRow) : null).columns;
    for (const c of NON_PRIOR) {
      const stored = (r as unknown as Record<string, Prisma.Decimal | null>)[c];
      const got = d[c]; const t = tol[c];
      if (stored == null && got == null) { t.bothNull++; continue; }
      if (stored != null && got != null && stored.equals(got)) { t.exact++; continue; }
      if (stored != null && got != null && withinTol(stored, got)) { t.withinTol++; const ad = stored.minus(got).abs(); if (ad.greaterThan(t.maxAbs)) t.maxAbs = ad; continue; }
      t.breach++; breaches++;
      console.log(`     [breach:${c}] ${r.stockId.slice(0,6)}|${r.fiscalYear}|${r.resultType} stored=${stored} derived=${got}`);
    }
    for (const c of PRIOR_DEP) {
      const stored = (r as unknown as Record<string, Prisma.Decimal | null>)[c];
      const got = d[c]; const s = stale[c];
      if (stored == null && got == null) { s.bothNull++; continue; }
      if (stored == null || got == null) { s.nullMismatch++; continue; }
      if (stored.equals(got)) { s.exact++; continue; }
      s.drift++;
      const rel = stored.abs().greaterThan(0) ? stored.minus(got).abs().div(stored.abs()).toNumber() * 100 : 0;
      if (rel > s.maxRelPct) s.maxRelPct = rel;
    }
  }

  console.log(`   rows=${rows.length}`);
  console.log("\n   NON-PRIOR (exact / withinTol / bothNull / BREACH | maxAbsΔ):");
  for (const c of NON_PRIOR) { const t = tol[c]; console.log(`   ${c.padEnd(20)} ${String(t.exact).padStart(5)} / ${String(t.withinTol).padStart(4)} / ${String(t.bothNull).padStart(4)} / ${String(t.breach).padStart(3)} | ${t.maxAbs.toString()}`); }
  check("NON-PRIOR columns: 0 tolerance breaches (gate)", breaches === 0, breaches);
  console.log("\n   PRIOR-DEPENDENT (exempt — exact / bothNull / nullMismatch / drift | maxRel%):");
  for (const c of PRIOR_DEP) { const s = stale[c]; console.log(`   ${c.padEnd(20)} ${String(s.exact).padStart(5)} / ${String(s.bothNull).padStart(4)} / ${String(s.nullMismatch).padStart(4)} / ${String(s.drift).padStart(4)} | ${s.maxRelPct.toFixed(2)}`); }
  const totalStale = PRIOR_DEP.reduce((a, c) => a + stale[c].nullMismatch + stale[c].drift, 0);
  console.log(`   → prior-dependent stale values: ${totalStale}`);
  return { rows: rows.length, breaches, totalStale };
}

async function main() {
  unitChecks();
  const b = await bulkDiff();
  console.log(`\n=== unit-checks ${pass}/${pass + fail} | non-prior breaches ${b.breaches} | prior-dep stale ${b.totalStale} (exempt) ===`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
