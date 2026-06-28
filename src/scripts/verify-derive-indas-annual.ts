// ─────────────────────────────────────────────────────────────
// BYTE-IDENTICAL GATE — Stage 1a (Fundamental Ind-AS deriveIndAsAnnual).
// READ-ONLY: SELECTs only, writes nothing.
//
// (A) Synthetic formula unit-checks — prove the EXTRACTED math equals the
//     intended formulas (faithfulness to spec, independent of stored data).
// (B) Full re-derive-vs-stored diff — for EVERY fundamentals row, rebuild the
//     raw bag from stored columns + the prior stored row, run deriveIndAsAnnual,
//     and diff each of the 17 derived columns against the stored value.
//     Classifies drift: exact / null-mismatch / numeric-drift (with magnitude
//     + size correlation) so precision-loss is told apart from a logic break.
//
// Run:  npx tsx src/scripts/verify-derive-indas-annual.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { decrementFY } from "../ingestions/quaterly-results/ingester-utils.js";
import {
  deriveIndAsAnnual,
  plausibleFaceValue,
  type IndAsAnnualRaw,
  type IndAsAnnualPrior,
} from "../ingestions/quaterly-results/derive/derive-indas-annual.js";

const D = (s: string | number) => new Prisma.Decimal(s);
const num = (d: Prisma.Decimal | null) => (d == null ? null : d.toNumber());

const DERIVED_COLS = [
  "totalDebt", "fcf", "ebitda", "netMargin", "operatingMargin", "netWorth",
  "bookValuePerShare", "debtToEquity", "roe", "roce", "interestCoverage",
  "receivablesDays", "inventoryTurnover", "assetTurnover",
  "revenueGrowthYoy", "profitGrowthYoy", "epsGrowthYoy",
] as const;
type DerivedCol = (typeof DERIVED_COLS)[number];

let pass = 0, fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}

// ── (A) Synthetic formula unit-checks ──
function unitChecks() {
  console.log("\n[A] Synthetic formula unit-checks (extracted math vs hand-computed)");

  // A clean 2-decimal row so round2/round4 are exact — isolates the formulas.
  const raw: IndAsAnnualRaw = {
    revenue: 1000, netProfit: 120, financeCosts: 30, depreciation: 50,
    profitBeforeTax: 160, equityShareCapital: 100, otherEquity: 500,
    totalEquity: 600, equityAttributableToOwners: null,
    borrowingsCurrent: 100, borrowingsNoncurrent: 300,
    cashFromOperating: 200, capex: 60, paidUpEquityCapital: 100,
    faceValueShareSane: 10, tradeReceivablesCurrent: 80, tradeReceivablesNoncurrent: 20,
    inventories: 200, totalAssets: 2000, basicEps: 12,
  };
  const prior: IndAsAnnualPrior = {
    revenue: 800, netProfit: 100, basicEps: 10, totalEquity: 500,
    equityAttributableToOwners: null, equityShareCapital: 100, otherEquity: 400,
  };
  const d = deriveIndAsAnnual(raw, prior, "unit").columns;

  check("totalDebt = 100+300 = 400", num(d.totalDebt) === 400);
  check("fcf = 200-60 = 140", num(d.fcf) === 140);
  check("ebitda = 160+30+50 = 240", num(d.ebitda) === 240);
  check("netMargin = 120/1000*100 = 12", num(d.netMargin) === 12);
  check("operatingMargin = 240/1000*100 = 24", num(d.operatingMargin) === 24);
  check("netWorth = totalEquity 600 (EATO null)", num(d.netWorth) === 600);
  // shares = paidUp/face = 100/10 = 10 Cr-shares; bvps = 600/10 = 60
  check("bookValuePerShare = 600/(100/10) = 60", num(d.bookValuePerShare) === 60);
  // D/E stored as percent: (400/600)*100 = 66.6667
  check("debtToEquity = (400/600)*100 = 66.6667", num(d.debtToEquity) === 66.6667);
  // avgEquity = (600 + priorNW 500)/2 = 550; roe = 120/550*100 = 21.8182
  check("roe = 120/avg(600,500)*100 = 21.8182", num(d.roe) === 21.8182);
  // ebit = 160+30 = 190; capEmployed = 600+400 = 1000; roce = 19
  check("roce = 190/1000*100 = 19", num(d.roce) === 19);
  check("interestCoverage = 190/30 = 6.3333", num(d.interestCoverage) === 6.3333);
  // receivables = 100; days = 100/1000*365 = 36.5
  check("receivablesDays = 100/1000*365 = 36.5", num(d.receivablesDays) === 36.5);
  check("inventoryTurnover = 1000/200 = 5", num(d.inventoryTurnover) === 5);
  check("assetTurnover = 1000/2000 = 0.5", num(d.assetTurnover) === 0.5);
  check("revenueGrowthYoy = (1000-800)/800*100 = 25", num(d.revenueGrowthYoy) === 25);
  check("profitGrowthYoy = (120-100)/100*100 = 20", num(d.profitGrowthYoy) === 20);
  check("epsGrowthYoy = (12-10)/10*100 = 20", num(d.epsGrowthYoy) === 20);

  // Null-propagation + prior-absent cases
  const noPrior = deriveIndAsAnnual(raw, null, "unit").columns;
  check("roe with no prior → netProfit/netWorth (avg of one) = 120/600*100 = 20", num(noPrior.roe) === 20);
  check("revenueGrowthYoy null when no prior", noPrior.revenueGrowthYoy === null);
  const sparse = deriveIndAsAnnual(
    { ...raw, revenue: null, inventories: 0, totalAssets: null }, prior, "unit",
  ).columns;
  check("netMargin null when revenue null", sparse.netMargin === null);
  check("inventoryTurnover null when inventories 0", sparse.inventoryTurnover === null);
  check("assetTurnover null when totalAssets null", sparse.assetTurnover === null);
}

// ── (B) Full re-derive vs stored ──
const SELECT = {
  id: true, stockId: true, fiscalYear: true, resultType: true,
  // raw inputs
  revenue: true, netProfit: true, financeCosts: true, depreciation: true,
  profitBeforeTax: true, equityShareCapital: true, otherEquity: true,
  totalEquity: true, equityAttributableToOwners: true, borrowingsCurrent: true,
  borrowingsNoncurrent: true, cashFromOperating: true, capex: true,
  paidUpEquityCapital: true, faceValueShare: true, tradeReceivablesCurrent: true,
  tradeReceivablesNoncurrent: true, inventories: true, totalAssets: true, basicEps: true,
  // stored derived
  totalDebt: true, fcf: true, ebitda: true, netMargin: true, operatingMargin: true,
  netWorth: true, bookValuePerShare: true, debtToEquity: true, roe: true, roce: true,
  interestCoverage: true, receivablesDays: true, inventoryTurnover: true,
  assetTurnover: true, revenueGrowthYoy: true, profitGrowthYoy: true, epsGrowthYoy: true,
} as const;

type Row = Prisma.FundamentalGetPayload<{ select: typeof SELECT }>;

function rawOf(r: Row): IndAsAnnualRaw {
  return {
    revenue: num(r.revenue), netProfit: num(r.netProfit), financeCosts: num(r.financeCosts),
    depreciation: num(r.depreciation), profitBeforeTax: num(r.profitBeforeTax),
    equityShareCapital: num(r.equityShareCapital), otherEquity: num(r.otherEquity),
    totalEquity: num(r.totalEquity), equityAttributableToOwners: num(r.equityAttributableToOwners),
    borrowingsCurrent: num(r.borrowingsCurrent), borrowingsNoncurrent: num(r.borrowingsNoncurrent),
    cashFromOperating: num(r.cashFromOperating), capex: num(r.capex),
    paidUpEquityCapital: num(r.paidUpEquityCapital),
    faceValueShareSane: plausibleFaceValue(num(r.faceValueShare)),
    tradeReceivablesCurrent: num(r.tradeReceivablesCurrent),
    tradeReceivablesNoncurrent: num(r.tradeReceivablesNoncurrent),
    inventories: num(r.inventories), totalAssets: num(r.totalAssets), basicEps: num(r.basicEps),
  };
}
function priorOf(r: Row): IndAsAnnualPrior {
  return {
    revenue: num(r.revenue), netProfit: num(r.netProfit), basicEps: num(r.basicEps),
    totalEquity: num(r.totalEquity), equityAttributableToOwners: num(r.equityAttributableToOwners),
    equityShareCapital: num(r.equityShareCapital), otherEquity: num(r.otherEquity),
  };
}

async function bulkDiff() {
  console.log("\n[B] Full re-derive vs stored (every fundamentals row)");
  const rows = (await prisma.fundamental.findMany({ select: SELECT })) as Row[];
  const byKey = new Map<string, Row>();
  for (const r of rows) byKey.set(`${r.stockId}|${r.fiscalYear}|${r.resultType}`, r);

  // per-column tallies
  const tally: Record<DerivedCol, { exact: number; bothNull: number; nullMismatch: number; drift: number; maxAbs: Prisma.Decimal; maxRel: number }> =
    Object.fromEntries(DERIVED_COLS.map((c) => [c, { exact: 0, bothNull: 0, nullMismatch: 0, drift: 0, maxAbs: D(0), maxRel: 0 }])) as never;
  const driftExamples: { col: string; key: string; stored: string; derived: string; absΔ: string; relPct: string; revenue: number | null }[] = [];
  let clampWarns = 0;
  const origWarn = console.warn;
  console.warn = () => { clampWarns++; };

  let rowsWithAnyDrift = 0, rowsWithAnyNullMismatch = 0;
  for (const r of rows) {
    const priorKey = `${r.stockId}|${decrementFY(r.fiscalYear)}|${r.resultType}`;
    const priorRow = byKey.get(priorKey) ?? null;
    const d = deriveIndAsAnnual(rawOf(r), priorRow ? priorOf(priorRow) : null, "verify").columns;
    let rowDrift = false, rowNullMismatch = false;
    for (const col of DERIVED_COLS) {
      const stored = (r as unknown as Record<string, Prisma.Decimal | null>)[col];
      const got = d[col];
      const t = tally[col];
      if (stored == null && got == null) { t.bothNull++; continue; }
      if (stored == null || got == null) { t.nullMismatch++; rowNullMismatch = true;
        if (driftExamples.length < 4000) driftExamples.push({ col, key: `${r.stockId.slice(0,6)}|${r.fiscalYear}|${r.resultType}`, stored: String(stored), derived: String(got), absΔ: "null↔value", relPct: "—", revenue: num(r.revenue) });
        continue; }
      if (stored.equals(got)) { t.exact++; continue; }
      t.drift++; rowDrift = true;
      const absΔ = stored.minus(got).abs();
      if (absΔ.greaterThan(t.maxAbs)) t.maxAbs = absΔ;
      const rel = stored.abs().greaterThan(0) ? absΔ.div(stored.abs()).toNumber() : absΔ.toNumber();
      if (rel > t.maxRel) t.maxRel = rel;
      driftExamples.push({ col, key: `${r.stockId.slice(0,6)}|${r.fiscalYear}|${r.resultType}`, stored: stored.toString(), derived: got.toString(), absΔ: absΔ.toString(), relPct: (rel * 100).toFixed(4), revenue: num(r.revenue) });
    }
    if (rowDrift) rowsWithAnyDrift++;
    if (rowNullMismatch) rowsWithAnyNullMismatch++;
  }
  console.warn = origWarn;

  console.log(`   rows=${rows.length} | boundDerived clamps during re-derive=${clampWarns}`);
  console.log(`   rows with ANY numeric drift: ${rowsWithAnyDrift} | rows with ANY null-mismatch: ${rowsWithAnyNullMismatch}`);
  console.log("\n   per-column: exact / bothNull / nullMismatch / drift | maxAbsΔ | maxRel%");
  for (const col of DERIVED_COLS) {
    const t = tally[col];
    console.log(`   ${col.padEnd(18)} ${String(t.exact).padStart(5)} / ${String(t.bothNull).padStart(4)} / ${String(t.nullMismatch).padStart(3)} / ${String(t.drift).padStart(4)} | ${t.maxAbs.toString().padStart(12)} | ${(t.maxRel * 100).toFixed(4)}`);
  }

  // null-mismatches are STRUCTURAL (not precision) — surface them loudly.
  const nm = driftExamples.filter((e) => e.absΔ === "null↔value");
  if (nm.length) {
    console.log(`\n   ⚠ NULL-MISMATCHES (${nm.length}) — structural, NOT precision (investigate):`);
    for (const e of nm.slice(0, 20)) console.log(`     ${e.col.padEnd(16)} ${e.key}  stored=${e.stored} derived=${e.derived}`);
  }

  // worst numeric drifts by relative magnitude + size correlation
  const numeric = driftExamples.filter((e) => e.absΔ !== "null↔value").sort((a, b) => parseFloat(b.relPct) - parseFloat(a.relPct));
  if (numeric.length) {
    console.log(`\n   worst numeric drifts by relative % (top 15):`);
    for (const e of numeric.slice(0, 15)) console.log(`     ${e.col.padEnd(16)} ${e.key}  stored=${e.stored} derived=${e.derived} |Δ|=${e.absΔ} rel=${e.relPct}% rev=${e.revenue}`);
    // size correlation: drifting rows by revenue bucket
    const buckets = { "<50Cr": 0, "50-500Cr": 0, "500-5000Cr": 0, ">5000Cr": 0, "null-rev": 0 };
    for (const e of numeric) {
      const rev = e.revenue;
      if (rev == null) buckets["null-rev"]++;
      else if (Math.abs(rev) < 50) buckets["<50Cr"]++;
      else if (Math.abs(rev) < 500) buckets["50-500Cr"]++;
      else if (Math.abs(rev) < 5000) buckets["500-5000Cr"]++;
      else buckets[">5000Cr"]++;
    }
    console.log(`   drift count by revenue size: ${JSON.stringify(buckets)}  (precision-loss hypothesis → concentrated in small-cap)`);
  }

  return { rows: rows.length, rowsWithAnyDrift, rowsWithAnyNullMismatch, tally, nm: nm.length };
}

async function main() {
  unitChecks();
  const b = await bulkDiff();
  console.log(`\n=== unit-checks: ${pass}/${pass + fail} passed | bulk: ${b.rows} rows, ${b.rowsWithAnyDrift} drift, ${b.nm} null-mismatch ===`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
