// ═══════════════════════════════════════════════════════════════
// T1c — WHAT DO WE HOLD, PER BASIS. READ-ONLY (SELECTs only).
//   npx tsx src/scripts/_t1-hold.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lpad = (s: unknown, n: number) => String(s).padStart(n);

async function main() {
  // Which universe? "the 442" — establish it rather than assume.
  const [u] = await raw(
    `SELECT count(*)::int AS all_stocks,
            count(*) FILTER (WHERE "industryType" = 'non_financial')::int AS non_fin,
            count(*) FILTER (WHERE "industryType" <> 'non_financial')::int AS fin
       FROM stocks`);
  const byInd = await raw(`SELECT "industryType", count(*)::int AS n FROM stocks GROUP BY 1 ORDER BY 2 DESC`);
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ UNIVERSE                                                                  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  stocks total=${u.all_stocks} · non_financial=${u.non_fin} · financial=${u.fin}`);
  for (const r of byInd) console.log(`    ${pad(r.industry_type, 22)} ${lpad(r.n, 5)}`);
  console.log(`  (Foundation/fundamentals is the NON-FINANCIAL table — financials file into the`);
  console.log(`   banking_/nbfc_/life_/general_insurance_ tables, per metrics/filed-load.ts.)`);

  // ── FUNDAMENTALS (annual) by basis × fiscal year ────────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T1c — fundamentals ROWS by result_type by fiscal year                      ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const fy = await raw(
    `SELECT "fiscal_year",
            count(*) FILTER (WHERE "result_type" = 'standalone')::int   AS standalone,
            count(*) FILTER (WHERE "result_type" = 'consolidated')::int AS consolidated,
            count(DISTINCT "stock_id") FILTER (WHERE "result_type" = 'standalone')::int   AS sa_stocks,
            count(DISTINCT "stock_id") FILTER (WHERE "result_type" = 'consolidated')::int AS co_stocks,
            count(DISTINCT "stock_id")::int AS any_stocks
       FROM fundamentals GROUP BY 1 ORDER BY 1`);
  console.log(`  ${pad("fiscal_year", 14)}${lpad("standalone", 12)}${lpad("consolidated", 14)}${lpad("SA stocks", 11)}${lpad("CO stocks", 11)}${lpad("any", 6)}`);
  let saTot = 0, coTot = 0;
  for (const r of fy) {
    saTot += Number(r.standalone); coTot += Number(r.consolidated);
    console.log(`  ${pad(r.fiscal_year, 14)}${lpad(r.standalone, 12)}${lpad(r.consolidated, 14)}${lpad(r.sa_stocks, 11)}${lpad(r.co_stocks, 11)}${lpad(r.any_stocks, 6)}`);
  }
  console.log(`  ${pad("TOTAL", 14)}${lpad(saTot, 12)}${lpad(coTot, 14)}`);
  const [ratio] = await raw(
    `SELECT count(*) FILTER (WHERE "result_type"='standalone')::int sa,
            count(*) FILTER (WHERE "result_type"='consolidated')::int co, count(*)::int n FROM fundamentals`);
  console.log(`  → standalone is ${((Number(ratio.sa) / Number(ratio.n)) * 100).toFixed(1)}% of all fundamentals rows`);

  // Per-stock: does a stock have BOTH bases for the same FY?
  console.log(`\n  PER (stock, fiscal_year) — which bases are present:`);
  const [pair] = await raw(
    `WITH k AS (SELECT "stock_id","fiscal_year",
                       bool_or("result_type"='standalone')   AS has_sa,
                       bool_or("result_type"='consolidated') AS has_co
                  FROM fundamentals GROUP BY 1,2)
     SELECT count(*)::int periods,
            count(*) FILTER (WHERE has_sa AND has_co)::int both,
            count(*) FILTER (WHERE has_sa AND NOT has_co)::int sa_only,
            count(*) FILTER (WHERE has_co AND NOT has_sa)::int co_only FROM k`);
  console.log(`    (stock,FY) periods held: ${pair.periods}  ·  both bases: ${pair.both}  ·  standalone-only: ${pair.sa_only}  ·  CONSOLIDATED-ONLY: ${pair.co_only}`);
  console.log(`    → ${((Number(pair.co_only) / Number(pair.periods)) * 100).toFixed(1)}% of held periods have NO standalone row — Foundation cannot read them.`);

  // ── QUARTERLY by basis × fiscal year ────────────────────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T1d — quarterly_results ROWS by result_type by fiscal year                 ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const q = await raw(
    `SELECT "fiscal_year",
            count(*) FILTER (WHERE "result_type"='standalone')::int   AS standalone,
            count(*) FILTER (WHERE "result_type"='consolidated')::int AS consolidated,
            count(DISTINCT "stock_id")::int AS any_stocks
       FROM quarterly_results GROUP BY 1 ORDER BY 1`);
  console.log(`  ${pad("fiscal_year", 14)}${lpad("standalone", 12)}${lpad("consolidated", 14)}${lpad("stocks", 8)}`);
  for (const r of q) console.log(`  ${pad(r.fiscal_year, 14)}${lpad(r.standalone, 12)}${lpad(r.consolidated, 14)}${lpad(r.any_stocks, 8)}`);
  const [qp] = await raw(
    `WITH k AS (SELECT "stock_id","quarter","fiscal_year",
                       bool_or("result_type"='standalone')   AS has_sa,
                       bool_or("result_type"='consolidated') AS has_co
                  FROM quarterly_results GROUP BY 1,2,3)
     SELECT count(*)::int periods,
            count(*) FILTER (WHERE has_sa AND has_co)::int both,
            count(*) FILTER (WHERE has_sa AND NOT has_co)::int sa_only,
            count(*) FILTER (WHERE has_co AND NOT has_sa)::int co_only FROM k`);
  console.log(`  (stock,Q,FY) periods held: ${qp.periods}  ·  both: ${qp.both}  ·  standalone-only: ${qp.sa_only}  ·  CONSOLIDATED-ONLY: ${qp.co_only}`);
  console.log(`  → ${((Number(qp.co_only) / Number(qp.periods)) * 100).toFixed(1)}% of held quarterly periods have NO standalone row — Momentum cannot read them.`);

  // ── SOURCE split: which ingest path wrote each row? ─────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ WHICH PATH WROTE THE ROWS (legacy v2 vs live v3)                           ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  for (const t of ["fundamentals", "quarterly_results"]) {
    const rows = await raw(
      `SELECT "source",
              count(*) FILTER (WHERE "result_type"='standalone')::int sa,
              count(*) FILTER (WHERE "result_type"='consolidated')::int co,
              count(*)::int n, min("fiscal_year") AS min_fy, max("fiscal_year") AS max_fy
         FROM "${t}" GROUP BY 1 ORDER BY 4 DESC`);
    console.log(`  ${t}:`);
    console.log(`    ${pad("source", 30)}${lpad("standalone", 12)}${lpad("consolidated", 14)}${lpad("total", 8)}  fy range`);
    for (const r of rows) {
      const saPct = Number(r.n) > 0 ? ((Number(r.sa) / Number(r.n)) * 100).toFixed(0) : "0";
      console.log(`    ${pad(r.source, 30)}${lpad(r.sa, 12)}${lpad(r.co, 14)}${lpad(r.n, 8)}  ${r.min_fy}..${r.max_fy}  (SA ${saPct}%)`);
    }
  }

  // ── Foundation reach at the 2022-01-31 snapshot ─────────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ FOUNDATION REACH — standalone annual rows on/before 2022-01-31             ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const [reach] = await raw(
    `WITH s AS (SELECT st."id",
                       count(f."id") FILTER (WHERE f."result_type"='standalone')::int sa_all,
                       count(f."id") FILTER (WHERE f."result_type"='standalone' AND f."report_date" <= DATE '2022-01-31')::int sa_pre
                  FROM stocks st LEFT JOIN fundamentals f ON f."stock_id" = st."id"
                 WHERE st."industryType" = 'non_financial'
                 GROUP BY st."id")
     SELECT count(*)::int stocks,
            count(*) FILTER (WHERE sa_all = 0)::int no_sa,
            count(*) FILTER (WHERE sa_pre = 0)::int no_sa_pre,
            count(*) FILTER (WHERE sa_all >= 5)::int sa_ge5,
            count(*) FILTER (WHERE sa_all >= 9)::int sa_ge9 FROM s`);
  console.log(`  non-financial stocks: ${reach.stocks}`);
  console.log(`    with ZERO standalone annual rows at all:        ${reach.no_sa}`);
  console.log(`    with ZERO standalone rows on/before 2022-01-31: ${reach.no_sa_pre}`);
  console.log(`    with >=5 standalone rows (one F8 value):        ${reach.sa_ge5}`);
  console.log(`    with >=9 standalone rows (F8 + L3, new floor):  ${reach.sa_ge9}`);

  console.log(`\n  (READ-ONLY: SELECTs only.)\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
