// ─────────────────────────────────────────────────────────────
// DENOM-AWARE GATE — Stages 1e+1f (Life + General Insurance annual). READ-ONLY.
// Run:  npx tsx src/scripts/verify-derive-insurance-annual.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { decrementFY } from "../ingestions/quaterly-results/ingester-utils.js";
import { deriveLiAnnual, type LiAnnualRaw, type LiAnnualPrior } from "../ingestions/quaterly-results/derive/derive-li-annual.js";
import { deriveGiAnnual, type GiAnnualRaw, type GiAnnualPrior } from "../ingestions/quaterly-results/derive/derive-gi-annual.js";

const num = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());
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

function liUnit() {
  console.log("\n[A] LI synthetic unit-checks");
  const raw: LiAnnualRaw = {
    shareCapital: 200, reservesAndSurplus: 700, fairValueChangeAccount: 100, paidUpEquityCapital: 200,
    faceValueShare: 10, incomeFirstYearPremium: 300, grossPremiumIncome: 1200, totalOperatingExpenses: 240, netProfit: 150,
  };
  const prior: LiAnnualPrior = { shareCapital: 200, reservesAndSurplus: 600, fairValueChangeAccount: 100, grossPremiumIncome: 1000, netProfit: 120 };
  const d = deriveLiAnnual(raw, prior).columns;
  check("LI netWorth = 200+700+100 = 1000", num(d.netWorth) === 1000);
  check("LI bvps = 1000/(200/10) = 50", num(d.bookValuePerShare) === 50);
  check("LI newBusinessPremiumPct = 300/1200 = 0.25", num(d.newBusinessPremiumPct) === 0.25);
  check("LI expenseRatio = 240/1200 = 0.2", num(d.expenseRatioPolicyholders) === 0.2);
  check("LI roe = 150/avg(1000,900)=150/950 = 0.157895", num(d.roe) === 0.157895);
  check("LI premiumGrowthYoy = (1200-1000)/1000*100 = 20", num(d.premiumGrowthYoy) === 20);
  check("LI patGrowthYoy = (150-120)/120*100 = 25", num(d.patGrowthYoy) === 25);
  const fb = deriveLiAnnual({ ...raw, paidUpEquityCapital: null, faceValueShare: null }, prior).columns;
  check("LI bvps face fallback ₹10 + shareCapital: 1000/(200/10)=50", num(fb.bookValuePerShare) === 50);
}
function giUnit() {
  console.log("\n[A] GI synthetic unit-checks");
  const raw: GiAnnualRaw = {
    shareCapital: 100, reservesAndSurplus: 800, fairValueChangeAccount: 100, paidUpEquityCapital: 100,
    faceValueShare: 10, combinedRatio: 0.95, netProfit: 150, grossPremiumsWritten: 2000,
  };
  const prior: GiAnnualPrior = { shareCapital: 100, reservesAndSurplus: 700, fairValueChangeAccount: 100, grossPremiumsWritten: 1600, netProfit: 120 };
  const d = deriveGiAnnual(raw, prior).columns;
  check("GI netWorth = 100+800+100 = 1000", num(d.netWorth) === 1000);
  check("GI bvps = 1000/(100/10) = 100", num(d.bookValuePerShare) === 100);
  check("GI netUnderwritingMargin = 1-0.95 = 0.05", num(d.netUnderwritingMargin) === 0.05);
  check("GI roe = 150/avg(1000,900)=150/950 = 0.157895", num(d.roe) === 0.157895);
  check("GI gpwGrowthYoy = (2000-1600)/1600*100 = 25", num(d.gpwGrowthYoy) === 25);
  check("GI patGrowthYoy = (150-120)/120*100 = 25", num(d.patGrowthYoy) === 25);
  check("GI netUWM null when combinedRatio null", deriveGiAnnual({ ...raw, combinedRatio: null }, prior).columns.netUnderwritingMargin === null);
}

async function bulk<R extends { id: string; stockId: string; fiscalYear: string; resultType: string }>(
  label: string, rows: R[], rawOf: (r: R) => unknown, priorOf: (r: R) => unknown,
  derive: (raw: unknown, prior: unknown) => { columns: Record<string, Prisma.Decimal | null> },
  nonPrior: readonly string[], priorDep: readonly string[],
) {
  const byKey = new Map<string, R>();
  for (const r of rows) byKey.set(`${r.stockId}|${r.fiscalYear}|${r.resultType}`, r);
  const tol: Record<string, { exact: number; withinTol: number; bothNull: number; breach: number; maxAbs: Prisma.Decimal }> =
    Object.fromEntries(nonPrior.map((c) => [c, { exact: 0, withinTol: 0, bothNull: 0, breach: 0, maxAbs: new Prisma.Decimal(0) }])) as never;
  const stale: Record<string, { nullMismatch: number; drift: number; maxRelPct: number }> =
    Object.fromEntries(priorDep.map((c) => [c, { nullMismatch: 0, drift: 0, maxRelPct: 0 }])) as never;
  let breaches = 0;
  for (const r of rows) {
    const priorRow = byKey.get(`${r.stockId}|${decrementFY(r.fiscalYear)}|${r.resultType}`) ?? null;
    const d = derive(rawOf(r), priorRow ? priorOf(priorRow) : null).columns;
    for (const c of nonPrior) {
      const stored = (r as unknown as Record<string, Prisma.Decimal | null>)[c]; const got = d[c]; const t = tol[c];
      if (stored == null && got == null) { t.bothNull++; continue; }
      if (stored != null && got != null && stored.equals(got)) { t.exact++; continue; }
      if (stored != null && got != null && withinTol(stored, got)) { t.withinTol++; const ad = stored.minus(got).abs(); if (ad.greaterThan(t.maxAbs)) t.maxAbs = ad; continue; }
      t.breach++; breaches++; console.log(`     [breach:${c}] ${r.stockId.slice(0,6)}|${r.fiscalYear}|${r.resultType} stored=${stored} derived=${got}`);
    }
    for (const c of priorDep) {
      const stored = (r as unknown as Record<string, Prisma.Decimal | null>)[c]; const got = d[c]; const s = stale[c];
      if (stored == null && got == null) continue;
      if (stored == null || got == null) { s.nullMismatch++; continue; }
      if (stored.equals(got)) continue;
      s.drift++; const rel = stored.abs().greaterThan(0) ? stored.minus(got).abs().div(stored.abs()).toNumber() * 100 : 0; if (rel > s.maxRelPct) s.maxRelPct = rel;
    }
  }
  console.log(`\n[B] ${label}: rows=${rows.length}`);
  console.log("   NON-PRIOR (exact / withinTol / bothNull / BREACH | maxAbsΔ):");
  for (const c of nonPrior) { const t = tol[c]; console.log(`   ${c.padEnd(24)} ${String(t.exact).padStart(4)} / ${String(t.withinTol).padStart(3)} / ${String(t.bothNull).padStart(3)} / ${String(t.breach).padStart(2)} | ${t.maxAbs.toString()}`); }
  const totalStale = priorDep.reduce((a, c) => a + stale[c].nullMismatch + stale[c].drift, 0);
  console.log(`   PRIOR-DEP stale values (exempt): ${totalStale}  ${priorDep.map((c) => `${c}=${stale[c].nullMismatch + stale[c].drift}`).join(" ")}`);
  check(`${label}: 0 non-prior breaches (gate)`, breaches === 0, breaches);
  return { breaches, totalStale };
}

const LI_SELECT = { id: true, stockId: true, fiscalYear: true, resultType: true, shareCapital: true, reservesAndSurplus: true, fairValueChangeAccount: true, paidUpEquityCapital: true, faceValueShare: true, incomeFirstYearPremium: true, grossPremiumIncome: true, totalOperatingExpenses: true, netProfit: true, netWorth: true, bookValuePerShare: true, roe: true, newBusinessPremiumPct: true, expenseRatioPolicyholders: true, premiumGrowthYoy: true, patGrowthYoy: true } as const;
const GI_SELECT = { id: true, stockId: true, fiscalYear: true, resultType: true, shareCapital: true, reservesAndSurplus: true, fairValueChangeAccount: true, paidUpEquityCapital: true, faceValueShare: true, combinedRatio: true, netProfit: true, grossPremiumsWritten: true, netWorth: true, bookValuePerShare: true, roe: true, netUnderwritingMargin: true, gpwGrowthYoy: true, patGrowthYoy: true } as const;
type LiRow = Prisma.LifeInsuranceFundamentalGetPayload<{ select: typeof LI_SELECT }>;
type GiRow = Prisma.GeneralInsuranceFundamentalGetPayload<{ select: typeof GI_SELECT }>;

async function main() {
  liUnit(); giUnit();
  const liRows = (await prisma.lifeInsuranceFundamental.findMany({ select: LI_SELECT })) as LiRow[];
  const giRows = (await prisma.generalInsuranceFundamental.findMany({ select: GI_SELECT })) as GiRow[];
  const li = await bulk("LifeInsurance", liRows,
    (r) => ({ shareCapital: num(r.shareCapital), reservesAndSurplus: num(r.reservesAndSurplus), fairValueChangeAccount: num(r.fairValueChangeAccount), paidUpEquityCapital: num(r.paidUpEquityCapital), faceValueShare: num(r.faceValueShare), incomeFirstYearPremium: num(r.incomeFirstYearPremium), grossPremiumIncome: num(r.grossPremiumIncome), totalOperatingExpenses: num(r.totalOperatingExpenses), netProfit: num(r.netProfit) }),
    (r) => ({ shareCapital: num(r.shareCapital), reservesAndSurplus: num(r.reservesAndSurplus), fairValueChangeAccount: num(r.fairValueChangeAccount), grossPremiumIncome: num(r.grossPremiumIncome), netProfit: num(r.netProfit) }),
    (raw, prior) => deriveLiAnnual(raw as LiAnnualRaw, prior as LiAnnualPrior | null) as unknown as { columns: Record<string, Prisma.Decimal | null> },
    ["netWorth", "bookValuePerShare", "newBusinessPremiumPct", "expenseRatioPolicyholders"], ["roe", "premiumGrowthYoy", "patGrowthYoy"]);
  const gi = await bulk("GeneralInsurance", giRows,
    (r) => ({ shareCapital: num(r.shareCapital), reservesAndSurplus: num(r.reservesAndSurplus), fairValueChangeAccount: num(r.fairValueChangeAccount), paidUpEquityCapital: num(r.paidUpEquityCapital), faceValueShare: num(r.faceValueShare), combinedRatio: num(r.combinedRatio), netProfit: num(r.netProfit), grossPremiumsWritten: num(r.grossPremiumsWritten) }),
    (r) => ({ shareCapital: num(r.shareCapital), reservesAndSurplus: num(r.reservesAndSurplus), fairValueChangeAccount: num(r.fairValueChangeAccount), grossPremiumsWritten: num(r.grossPremiumsWritten), netProfit: num(r.netProfit) }),
    (raw, prior) => deriveGiAnnual(raw as GiAnnualRaw, prior as GiAnnualPrior | null) as unknown as { columns: Record<string, Prisma.Decimal | null> },
    ["netWorth", "bookValuePerShare", "netUnderwritingMargin"], ["roe", "gpwGrowthYoy", "patGrowthYoy"]);
  console.log(`\n=== unit ${pass}/${pass + fail} | LI breaches ${li.breaches} stale ${li.totalStale} | GI breaches ${gi.breaches} stale ${gi.totalStale} ===`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
