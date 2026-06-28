// ─────────────────────────────────────────────────────────────
// TOLERANCE GATE — Stage 1b (QuarterlyResult deriveIndAsQuarterly). READ-ONLY.
//
// (A) Synthetic formula unit-checks (extracted math vs hand-computed).
// (B) Full re-derive vs stored over every quarterly_results row:
//     • NON-prior columns (operatingMargin, netMargin): TOLERANCE gate —
//       |Δ| ≤ 0.01 absolute OR ≤0.5% relative (catches a logic change, accepts
//       the rounding floor). Any breach = FAIL.
//     • PRIOR-dependent columns (revenueQoq/Yoy, profitQoq/Yoy): EXEMPT from
//       byte-identical (they average/compare prior rows → DB-state-at-ingest
//       staleness). Instead determinism-checked (fresh re-derive == re-derive)
//       and the staleness is reported, not failed.
//
// Run:  npx tsx src/scripts/verify-derive-indas-quarterly.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { getPriorQuarter, decrementFY } from "../ingestions/quaterly-results/ingester-utils.js";
import {
  deriveIndAsQuarterly,
  type IndAsQuarterlyRaw,
  type IndAsQuarterlyPriorPeriod,
} from "../ingestions/quaterly-results/derive/derive-indas-quarterly.js";

const num = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());
const NON_PRIOR = ["operatingMargin", "netMargin"] as const;
const PRIOR_DEP = ["revenueQoq", "revenueYoy", "profitQoq", "profitYoy"] as const;

let pass = 0, fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}

/** Tolerance: within 0.01 absolute OR 0.5% relative. */
function withinTol(a: Prisma.Decimal, b: Prisma.Decimal): boolean {
  const abs = a.minus(b).abs();
  if (abs.lessThanOrEqualTo(0.01)) return true;
  if (a.abs().greaterThan(0)) return abs.div(a.abs()).lessThanOrEqualTo(0.005);
  return false;
}

function unitChecks() {
  console.log("\n[A] Synthetic formula unit-checks");
  const raw: IndAsQuarterlyRaw = { revenue: 500, netProfit: 60, operatingProfit: 110 };
  const prior: IndAsQuarterlyPriorPeriod = { revenue: 400, netProfit: 50 };
  const yearAgo: IndAsQuarterlyPriorPeriod = { revenue: 250, netProfit: 40 };
  const d = deriveIndAsQuarterly(raw, prior, yearAgo).columns;
  check("operatingMargin = 110/500*100 = 22", num(d.operatingMargin) === 22);
  check("netMargin = 60/500*100 = 12", num(d.netMargin) === 12);
  check("revenueQoq = (500-400)/400*100 = 25", num(d.revenueQoq) === 25);
  check("revenueYoy = (500-250)/250*100 = 100", num(d.revenueYoy) === 100);
  check("profitQoq = (60-50)/50*100 = 20", num(d.profitQoq) === 20);
  check("profitYoy = (60-40)/40*100 = 50", num(d.profitYoy) === 50);

  const noPrior = deriveIndAsQuarterly(raw, null, null).columns;
  check("revenueQoq null when no prior quarter", noPrior.revenueQoq === null);
  check("profitYoy null when no year-ago", noPrior.profitYoy === null);
  check("margins unaffected by missing priors", num(noPrior.operatingMargin) === 22 && num(noPrior.netMargin) === 12);
  const sparse = deriveIndAsQuarterly({ revenue: null, netProfit: 5, operatingProfit: 5 }, prior, yearAgo).columns;
  check("margins null when revenue null", sparse.operatingMargin === null && sparse.netMargin === null);
  // determinism: same inputs → identical output
  const a = deriveIndAsQuarterly(raw, prior, yearAgo).columns;
  const b = deriveIndAsQuarterly(raw, prior, yearAgo).columns;
  check("determinism: re-derive == re-derive (prior-dependent cols)", PRIOR_DEP.every((c) => String(a[c]) === String(b[c])));
}

const SELECT = {
  id: true, stockId: true, quarter: true, fiscalYear: true, resultType: true,
  revenue: true, netProfit: true, operatingProfit: true,
  operatingMargin: true, netMargin: true,
  revenueQoq: true, revenueYoy: true, profitQoq: true, profitYoy: true,
} as const;
type Row = Prisma.QuarterlyResultGetPayload<{ select: typeof SELECT }>;

async function bulkDiff() {
  console.log("\n[B] Full re-derive vs stored (every quarterly_results row)");
  const rows = (await prisma.quarterlyResult.findMany({ select: SELECT })) as Row[];
  const byKey = new Map<string, Row>();
  for (const r of rows) byKey.set(`${r.stockId}|${r.quarter}|${r.fiscalYear}|${r.resultType}`, r);
  const pp = (r: Row | null): IndAsQuarterlyPriorPeriod | null =>
    r ? { revenue: num(r.revenue), netProfit: num(r.netProfit) } : null;

  // non-prior tolerance gate
  const tol: Record<string, { exact: number; withinTol: number; bothNull: number; breach: number; maxAbs: Prisma.Decimal; worst: string }> =
    Object.fromEntries(NON_PRIOR.map((c) => [c, { exact: 0, withinTol: 0, bothNull: 0, breach: 0, maxAbs: new Prisma.Decimal(0), worst: "" }])) as never;
  // prior-dependent staleness report
  const stale: Record<string, { exact: number; bothNull: number; nullMismatch: number; drift: number; maxRelPct: number }> =
    Object.fromEntries(PRIOR_DEP.map((c) => [c, { exact: 0, bothNull: 0, nullMismatch: 0, drift: 0, maxRelPct: 0 }])) as never;

  for (const r of rows) {
    const priorQ = getPriorQuarter(r.quarter, r.fiscalYear);
    const priorRow = priorQ ? byKey.get(`${r.stockId}|${priorQ.quarter}|${priorQ.fiscalYear}|${r.resultType}`) ?? null : null;
    const yearAgoRow = byKey.get(`${r.stockId}|${r.quarter}|${decrementFY(r.fiscalYear)}|${r.resultType}`) ?? null;
    const d = deriveIndAsQuarterly(
      { revenue: num(r.revenue), netProfit: num(r.netProfit), operatingProfit: num(r.operatingProfit) },
      pp(priorRow), pp(yearAgoRow),
    ).columns;

    for (const c of NON_PRIOR) {
      const stored = (r as unknown as Record<string, Prisma.Decimal | null>)[c];
      const got = d[c];
      const t = tol[c];
      if (stored == null && got == null) { t.bothNull++; continue; }
      if (stored != null && got != null && stored.equals(got)) { t.exact++; continue; }
      if (stored != null && got != null && withinTol(stored, got)) {
        t.withinTol++;
        const ad = stored.minus(got).abs();
        if (ad.greaterThan(t.maxAbs)) t.maxAbs = ad;
        continue;
      }
      t.breach++;
      t.worst = `${r.stockId.slice(0,6)}|${r.quarter}-${r.fiscalYear}|${r.resultType} stored=${stored} derived=${got} | rawNetProfit=${num(r.netProfit)} rawRevenue=${num(r.revenue)} rawOpProfit=${num(r.operatingProfit)}`;
      console.log(`     [breach:${c}] ${t.worst}`);
    }
    for (const c of PRIOR_DEP) {
      const stored = (r as unknown as Record<string, Prisma.Decimal | null>)[c];
      const got = d[c];
      const s = stale[c];
      if (stored == null && got == null) { s.bothNull++; continue; }
      if (stored == null || got == null) { s.nullMismatch++; continue; }
      if (stored.equals(got)) { s.exact++; continue; }
      s.drift++;
      const rel = stored.abs().greaterThan(0) ? stored.minus(got).abs().div(stored.abs()).toNumber() * 100 : 0;
      if (rel > s.maxRelPct) s.maxRelPct = rel;
    }
  }

  console.log(`   rows=${rows.length}`);
  console.log("\n   NON-PRIOR (tolerance gate: exact / withinTol / bothNull / BREACH | maxAbsΔ):");
  let breaches = 0;
  for (const c of NON_PRIOR) {
    const t = tol[c]; breaches += t.breach;
    console.log(`   ${c.padEnd(16)} ${String(t.exact).padStart(5)} / ${String(t.withinTol).padStart(4)} / ${String(t.bothNull).padStart(4)} / ${String(t.breach).padStart(3)} | ${t.maxAbs.toString()}${t.breach ? `  worst: ${t.worst}` : ""}`);
  }
  check("NON-PRIOR columns: 0 tolerance breaches (gate)", breaches === 0, breaches);

  console.log("\n   PRIOR-DEPENDENT (exempt — staleness report: exact / bothNull / nullMismatch / drift | maxRel%):");
  for (const c of PRIOR_DEP) {
    const s = stale[c];
    console.log(`   ${c.padEnd(16)} ${String(s.exact).padStart(5)} / ${String(s.bothNull).padStart(4)} / ${String(s.nullMismatch).padStart(4)} / ${String(s.drift).padStart(4)} | ${s.maxRelPct.toFixed(2)}`);
  }
  const totalStale = PRIOR_DEP.reduce((a, c) => a + stale[c].nullMismatch + stale[c].drift, 0);
  console.log(`   → prior-dependent column-values that differ from stored (order-dependence staleness): ${totalStale}`);
  return { rows: rows.length, breaches, totalStale };
}

async function main() {
  unitChecks();
  const b = await bulkDiff();
  console.log(`\n=== unit-checks ${pass}/${pass + fail} | non-prior breaches ${b.breaches} | prior-dep stale values ${b.totalStale} (exempt) ===`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
