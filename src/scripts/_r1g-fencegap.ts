// ═══════════════════════════════════════════════════════════════
// R1g — PROVE THE FENCE GAP IS REAL. READ-ONLY.
//   npx tsx src/scripts/_r1g-fencegap.ts
//
// The whole run rests on one claim: a filing whose PERIOD-END is <= 2025-01-31
// can never write a row whose report_date is >= 2025-03-31. Two things must
// hold for that:
//   1. report_date IS the period end (the ingesters key it from the parsed
//      period, not from the broadcast date) — checked here against fiscal keys.
//   2. NOTHING sits in the open interval (2025-01-31, 2025-03-31) — so the
//      filter's ceiling and the fence's floor do not touch.
// Anything with report_date >= 2025-03-31 but an odd fiscal key is listed by
// name, because that is where a surprise would live.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { TABLES } from "./_r1-colmap.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R1g — THE FENCE GAP (2025-01-31 filter ceiling → 2025-03-31 v3 floor)      ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  console.log(`\n  ── 1. is the interval (2025-01-31 .. 2025-03-31) EXCLUSIVE empty? ──`);
  let gapTotal = 0;
  for (const t of TABLES) {
    const rows = await raw<any>(
      `SELECT st."symbol" s, x."fiscal_year" fy, x."report_date"::text rd, x."source", x."result_type" rt
         FROM "${t}" x JOIN stocks st ON st."id"=x."stock_id"
        WHERE x."report_date" > DATE '2025-01-31' AND x."report_date" < DATE '2025-03-31'
        ORDER BY 3 LIMIT 25`);
    gapTotal += rows.length;
    console.log(`    ${pad(t, 28)} ${rows.length === 0 ? "✓ empty" : "⚠ " + rows.length + " row(s) IN THE GAP"}`);
    for (const r of rows) console.log(`      ⚠ ${pad(r.s, 14)} ${r.fy} ${r.rt} ${r.rd} ${r.source}`);
  }
  console.log(`    ⇒ gap is ${gapTotal === 0 ? "CLEAN — the filter ceiling and the fence floor do not touch" : "OCCUPIED (" + gapTotal + " rows)"}`);

  console.log(`\n  ── 2. the boundary rows on each side ──`);
  for (const t of TABLES) {
    const [b] = await raw<any>(
      `SELECT max("report_date") FILTER (WHERE "report_date" <= DATE '2025-01-31')::text below,
              min("report_date") FILTER (WHERE "report_date" >= DATE '2025-03-31')::text above,
              max("report_date")::text overall FROM "${t}"`);
    console.log(`    ${pad(t, 28)} highest <= 2025-01-31: ${pad(b.below ?? "—", 12)} · lowest >= 2025-03-31: ${pad(b.above ?? "—", 12)} · max: ${b.overall}`);
  }

  console.log(`\n  ── 3. does report_date track the PERIOD END? (distinct report_date per fiscal key) ──`);
  for (const t of TABLES) {
    const hasQ = t.includes("quarterly");
    const rows = await raw<any>(
      `SELECT "fiscal_year" fy${hasQ ? `, "quarter" q` : `, ''::text q`}, count(DISTINCT "report_date")::int d,
              min("report_date")::text a, max("report_date")::text b, count(*)::int n
         FROM "${t}" WHERE "report_date" >= DATE '2025-03-31' GROUP BY 1,2 ORDER BY 1,2`);
    console.log(`    ${t}:`);
    for (const r of rows) {
      const flag = r.d > 3 ? "  ⚠ many distinct report_dates for one fiscal key" : "";
      console.log(`      ${pad(r.fy + r.q, 9)} rows ${lp(r.n, 5)} · distinct report_date ${lp(r.d, 3)} · ${r.a} .. ${r.b}${flag}`);
    }
  }

  console.log(`\n  ── 4. the ODD v3 keys — non-Q4 quarters sitting above the fence floor ──`);
  const odd = await raw<any>(
    `SELECT st."symbol" s, st."fiscalYearEnd"::text fye, st."industryType"::text it,
            x."fiscal_year" fy, x."quarter" q, x."result_type" rt, x."report_date"::text rd, x."source"
       FROM (SELECT "stock_id","fiscal_year","quarter","result_type","report_date","source" FROM quarterly_results
             UNION ALL SELECT "stock_id","fiscal_year","quarter","result_type","report_date","source" FROM banking_quarterly_results) x
       JOIN stocks st ON st."id"=x."stock_id"
      WHERE x."report_date" >= DATE '2025-03-31' AND x."fiscal_year" IN ('FY25') AND x."quarter" IN ('Q1','Q2','Q3')
      ORDER BY 1,4,5`);
  console.log(`    ${odd.length} row(s) keyed FY25 Q1/Q2/Q3 with report_date >= 2025-03-31:`);
  for (const o of odd) console.log(`      ${pad(o.s, 14)} fye=${pad(o.fye, 9)} ${pad(o.it, 14)} ${o.fy}${o.q} ${pad(o.rt, 13)} ${o.rd}  ${o.source}`);

  console.log(`\n  ── 5. WHAT THE toDate FILTER ACTUALLY CUTS (it filters NSE's period-end field) ──`);
  const [c] = await raw<any>(
    `SELECT count(*)::int n FROM (
        SELECT "report_date" FROM fundamentals UNION ALL SELECT "report_date" FROM quarterly_results
        UNION ALL SELECT "report_date" FROM banking_fundamentals UNION ALL SELECT "report_date" FROM banking_quarterly_results) t
      WHERE "report_date" <= DATE '2025-01-31'`);
  const [d] = await raw<any>(
    `SELECT count(*)::int n FROM (
        SELECT "report_date" FROM fundamentals UNION ALL SELECT "report_date" FROM quarterly_results
        UNION ALL SELECT "report_date" FROM banking_fundamentals UNION ALL SELECT "report_date" FROM banking_quarterly_results) t
      WHERE "report_date" >= DATE '2025-03-31'`);
  console.log(`    rows at or below the toDate ceiling (writable):  ${lp(c.n, 7)}`);
  console.log(`    rows at or above the v3 floor    (protected):   ${lp(d.n, 7)}`);
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
