// ─────────────────────────────────────────────────────────────
// DENOM-AWARE GATE — Stage 1c (BankingFundamental deriveBankingAnnual). READ-ONLY.
//
// (A) Synthetic formula unit-checks (extracted math + helper fallbacks).
// (B) Full re-derive vs stored over every banking_fundamentals row:
//     • NON-prior (8): gate = |Δ| ≤ 0.01 absolute OR ≤0.5% relative; breaches
//       print raw inputs so any residual is confirmed as the precision floor
//       (small-denominator / sub-resolution) vs a logic break.
//     • PRIOR-dependent (8): EXEMPT (avg-denominator / prior-row) — determinism-
//       checked + staleness reported.
//
// Run:  npx tsx src/scripts/verify-derive-banking-annual.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { decrementFY } from "../ingestions/quaterly-results/ingester-utils.js";
import {
  deriveBankingAnnual,
  type BankingAnnualRaw,
  type BankingAnnualPrior,
} from "../ingestions/quaterly-results/derive/derive-banking-annual.js";

const num = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());
const NON_PRIOR = ["nii", "totalIncome", "costToIncomeRatio", "netWorth", "bookValuePerShare", "pcr", "tier1Ratio", "creditDepositRatio"] as const;
const PRIOR_DEP = ["creditCostPct", "netInterestMargin", "roe", "niiGrowthYoy", "patGrowthYoy", "depositGrowthYoy", "advanceGrowthYoy", "assetGrowthYoy"] as const;

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
  const raw: BankingAnnualRaw = {
    interestEarned: 1000, interestExpended: 600, otherIncome: 200, expenditureExclProvisions: 480,
    capital: 100, reservesAndSurplus: 900, paidUpEquityCapital: 100, faceValueShare: 10,
    gnpaAbsolute: 50, nnpaAbsolute: 20, cet1Ratio: 0.12, additionalTier1Ratio: 0.02,
    provisions: 30, advances: 2000, investments: 1000, deposits: 2500, netProfit: 150, totalAssets: 5000,
  };
  const prior: BankingAnnualPrior = {
    capital: 100, reservesAndSurplus: 800, advances: 1800, investments: 900,
    nii: 350, netProfit: 120, deposits: 2200, totalAssets: 4000,
  };
  const d = deriveBankingAnnual(raw, prior).columns;
  check("nii = 1000-600 = 400", num(d.nii) === 400);
  check("totalIncome = 1000+200 = 1200", num(d.totalIncome) === 1200);
  check("costToIncomeRatio = 480/1200 = 0.4", num(d.costToIncomeRatio) === 0.4);
  check("netWorth = 100+900 = 1000", num(d.netWorth) === 1000);
  check("bookValuePerShare = 1000/(100/10) = 100", num(d.bookValuePerShare) === 100);
  check("pcr = 1-20/50 = 0.6", num(d.pcr) === 0.6);
  check("tier1Ratio = 0.12+0.02 = 0.14", num(d.tier1Ratio) === 0.14);
  check("creditDepositRatio = 2000/2500 = 0.8", num(d.creditDepositRatio) === 0.8);
  // prior-dependent
  check("creditCostPct = 30/avg(2000,1800)=30/1900 = 0.015789", num(d.creditCostPct) === 0.015789);
  check("NIM = 400/avg(3000,2700)=400/2850 = 0.140351", num(d.netInterestMargin) === 0.140351);
  check("roe(ratio) = 150/avg(1000,900)/100 = 0.157895", num(d.roe) === 0.157895);
  check("niiGrowthYoy = (400-350)/350*100 = 14.2857", num(d.niiGrowthYoy) === 14.2857);
  check("patGrowthYoy = (150-120)/120*100 = 25", num(d.patGrowthYoy) === 25);
  check("depositGrowthYoy = (2500-2200)/2200*100 = 13.6364", num(d.depositGrowthYoy) === 13.6364);
  check("advanceGrowthYoy = (2000-1800)/1800*100 = 11.1111", num(d.advanceGrowthYoy) === 11.1111);
  check("assetGrowthYoy = (5000-4000)/4000*100 = 25", num(d.assetGrowthYoy) === 25);

  // helper fallbacks: no prior → avg denominators fall back to current
  const noP = deriveBankingAnnual(raw, null).columns;
  check("no prior: creditCostPct = 30/2000 = 0.015 (avgAdv→current)", num(noP.creditCostPct) === 0.015);
  check("no prior: NIM = 400/3000 = 0.133333 (avgIEA→current)", num(noP.netInterestMargin) === 0.133333);
  check("no prior: roe = 150/1000/100 = 0.15 (avgEquity→current)", num(noP.roe) === 0.15);
  check("no prior: niiGrowthYoy null", noP.niiGrowthYoy === null);
  // prior present but advances null → avgAdv falls back to current advances
  const pNullAdv = deriveBankingAnnual(raw, { ...prior, advances: null }).columns;
  check("prior advances null: creditCostPct = 30/2000 = 0.015", num(pNullAdv.creditCostPct) === 0.015);
  // determinism
  const a = deriveBankingAnnual(raw, prior).columns;
  const b = deriveBankingAnnual(raw, prior).columns;
  check("determinism: re-derive == re-derive (prior-dependent)", PRIOR_DEP.every((c) => String(a[c]) === String(b[c])));
}

const SELECT = {
  id: true, stockId: true, fiscalYear: true, resultType: true,
  interestEarned: true, interestExpended: true, otherIncome: true, expenditureExclProvisions: true,
  capital: true, reservesAndSurplus: true, paidUpEquityCapital: true, faceValueShare: true,
  gnpaAbsolute: true, nnpaAbsolute: true, cet1Ratio: true, additionalTier1Ratio: true,
  provisions: true, advances: true, investments: true, deposits: true, netProfit: true, totalAssets: true,
  nii: true, totalIncome: true, netInterestMargin: true, costToIncomeRatio: true, creditCostPct: true,
  roe: true, creditDepositRatio: true, netWorth: true, bookValuePerShare: true, pcr: true, tier1Ratio: true,
  niiGrowthYoy: true, patGrowthYoy: true, depositGrowthYoy: true, advanceGrowthYoy: true, assetGrowthYoy: true,
} as const;
type Row = Prisma.BankingFundamentalGetPayload<{ select: typeof SELECT }>;

function rawOf(r: Row): BankingAnnualRaw {
  return {
    interestEarned: num(r.interestEarned), interestExpended: num(r.interestExpended), otherIncome: num(r.otherIncome),
    expenditureExclProvisions: num(r.expenditureExclProvisions), capital: num(r.capital), reservesAndSurplus: num(r.reservesAndSurplus),
    paidUpEquityCapital: num(r.paidUpEquityCapital), faceValueShare: num(r.faceValueShare), gnpaAbsolute: num(r.gnpaAbsolute),
    nnpaAbsolute: num(r.nnpaAbsolute), cet1Ratio: num(r.cet1Ratio), additionalTier1Ratio: num(r.additionalTier1Ratio),
    provisions: num(r.provisions), advances: num(r.advances), investments: num(r.investments), deposits: num(r.deposits),
    netProfit: num(r.netProfit), totalAssets: num(r.totalAssets),
  };
}
function priorOf(r: Row): BankingAnnualPrior {
  return {
    capital: num(r.capital), reservesAndSurplus: num(r.reservesAndSurplus), advances: num(r.advances),
    investments: num(r.investments), nii: num(r.nii), netProfit: num(r.netProfit), deposits: num(r.deposits), totalAssets: num(r.totalAssets),
  };
}

async function bulkDiff() {
  console.log("\n[B] Full re-derive vs stored (every banking_fundamentals row)");
  const rows = (await prisma.bankingFundamental.findMany({ select: SELECT })) as Row[];
  const byKey = new Map<string, Row>();
  for (const r of rows) byKey.set(`${r.stockId}|${r.fiscalYear}|${r.resultType}`, r);

  const tol: Record<string, { exact: number; withinTol: number; bothNull: number; breach: number; maxAbs: Prisma.Decimal }> =
    Object.fromEntries(NON_PRIOR.map((c) => [c, { exact: 0, withinTol: 0, bothNull: 0, breach: 0, maxAbs: new Prisma.Decimal(0) }])) as never;
  const stale: Record<string, { exact: number; bothNull: number; nullMismatch: number; drift: number; maxRelPct: number }> =
    Object.fromEntries(PRIOR_DEP.map((c) => [c, { exact: 0, bothNull: 0, nullMismatch: 0, drift: 0, maxRelPct: 0 }])) as never;
  let breaches = 0;

  for (const r of rows) {
    const priorRow = byKey.get(`${r.stockId}|${decrementFY(r.fiscalYear)}|${r.resultType}`) ?? null;
    const d = deriveBankingAnnual(rawOf(r), priorRow ? priorOf(priorRow) : null).columns;
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
