// ═══════════════════════════════════════════════════════════════
// FENCE BREACH ASSESSMENT — READ-ONLY. Repairs NOTHING.
//   npx tsx src/scripts/_s4b-breach.ts
//
// Two SIEMENS v3 rows (FY25Q1 standalone + consolidated) flipped source from
// nse_xbrl_quarterly → nse_xbrl_quarterly_legacy during T3. Establish:
//   1. what those rows hold NOW vs what the baseline says they held
//   2. whether the v3 period (2025-06-30) still exists anywhere
//   3. WHY — the S4.3 deriver now produces a key the OLD deriver had mislabelled
//   4. the full blast radius across every stock T3 touched
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { deriveFiscalPeriod } from "../ingestions/quaterly-results/xbrl/parser-common.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const T3 = ["SIEMENS", "GILLETTE", "ENRIN", "POWERINDIA", "DELHIVERY", "CEMPRO", "CANBK"];

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ FENCE BREACH ASSESSMENT — read-only, repairs nothing                       ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  const base = JSON.parse(readFileSync(`${DIR}/_r1d-v3-before.json`, "utf8"));
  const byId = new Map((base.rows as any[]).map((r) => [r.id, r]));

  // ── 1. FULL blast radius across all four tables, whole DB ──
  console.log(`\n  ── 1. DB-WIDE: any row at/after the v3 floor now carrying a *_legacy source? ──`);
  let total = 0;
  const hits: any[] = [];
  for (const t of ["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"]) {
    const rows = await raw<any>(
      `SELECT x."id", st."symbol" sym, x."fiscal_year" fy, ${t.includes("quarterly") ? `x."quarter" q` : `''::text q`},
              x."result_type" rt, x."report_date"::text rd, x."source" src, x."updated_at"::text ua, '${t}' tbl
         FROM "${t}" x JOIN stocks st ON st."id"=x."stock_id"
        WHERE x."report_date" >= DATE '2025-03-31' AND x."source" LIKE '%_legacy' ORDER BY 2,3`);
    total += rows.length; hits.push(...rows);
    console.log(`     ${pad(t, 28)}${rows.length === 0 ? "✓ 0" : "⚠ " + rows.length}`);
  }
  console.log(`     TOTAL breached rows: ${total === 0 ? "✓ 0" : "⚠ " + total}`);
  for (const h of hits) {
    const b: any = byId.get(h.id);
    console.log(`\n     ⚠ ${h.sym} ${h.tbl} ${h.fy}${h.q} ${h.rt}`);
    console.log(`        baseline : report_date ${b ? String(b.rd).slice(0, 10) : "?"} · source ${b ? b.src : "?"} · updated_at ${b ? b.ua : "?"}`);
    console.log(`        now      : report_date ${String(h.rd).slice(0, 10)} · source ${h.src} · updated_at ${h.ua}`);
    console.log(`        ⇒ report_date ${b && String(b.rd).slice(0, 10) !== String(h.rd).slice(0, 10) ? "⚠ MOVED — the row now describes a DIFFERENT PERIOD" : "unchanged"}`);
  }

  // ── 2. does the displaced v3 period still exist anywhere? ──
  console.log(`\n  ── 2. is the displaced v3 DATA still present? ──`);
  for (const h of hits) {
    const b: any = byId.get(h.id);
    if (!b) continue;
    const origRd = String(b.rd).slice(0, 10);
    const [still] = await raw<any>(
      `SELECT count(*)::int n FROM "${h.tbl}" x JOIN stocks st ON st."id"=x."stock_id"
        WHERE st."symbol"=$1 AND x."report_date"=DATE '${origRd}' AND x."result_type"=$2`, h.sym, h.rt);
    console.log(`     ${pad(h.sym + " " + h.rt, 26)} original period ${origRd}: ${still.n === 0 ? "⚠ NO ROW — the v3 data for that quarter is GONE" : `✓ ${still.n} row(s) still present`}`);
  }

  // ── 3. WHY: the corrected deriver collides with the old mislabel ──
  console.log(`\n  ── 3. THE MECHANISM ──`);
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const old = deriveFiscalPeriod(d("2024-12-31"), d("2024-10-01"), d("2025-09-30"), "quarterly");
  console.log(`     SIEMENS legacy filing, period-end 2024-12-31, declared FY 2024-10-01..2025-09-30`);
  console.log(`        OLD deriver (month switch, "March" branch): month 12 → Q3, fyEnd year 2025 → FY25Q3`);
  console.log(`        NEW deriver (S4.3, from the declared window): 2 months in → Q1 → ${old.fiscalYear}${old.quarter}`);
  console.log(`     The v3 row for period-end 2025-06-30 was ALSO keyed FY25Q1 — by the OLD deriver,`);
  console.log(`     which mislabelled it. So the CORRECTED legacy key collides with the OLD WRONG v3 key.`);
  console.log(`     ⇒ ⚠ FIXING THE DERIVER MADE NEW LABELS COLLIDE WITH OLD WRONG ONES ALREADY STORED.`);
  console.log(`       The unique key is (stockId, fiscalYear, quarter, resultType), so the upsert`);
  console.log(`       MATCHED the v3 row and overwrote it — including its report_date and source.`);

  // ── 4. per-stock row counts, to see if others silently collided too ──
  console.log(`\n  ── 4. every T3 stock: rows vs distinct period-ends (a collision LOSES a period) ──`);
  console.log(`  ${pad("symbol", 13)}${lp("SA rows", 9)}${lp("distinct rd", 13)}${lp("v3 rows left", 14)}  status`);
  for (const sym of T3) {
    const [st] = await raw<any>(`SELECT "id","industryType"::text it FROM stocks WHERE "symbol"=$1`, sym);
    const tbl = st.it === "banking" ? "banking_quarterly_results" : "quarterly_results";
    const rows = await raw<any>(
      `SELECT "report_date"::text rd,"source" src FROM "${tbl}" WHERE "stock_id"=$1 AND "result_type"='standalone'`, st.id);
    const distinct = new Set(rows.map((r: any) => String(r.rd).slice(0, 10))).size;
    const v3left = rows.filter((r: any) => String(r.rd).slice(0, 10) >= "2025-03-31" && !String(r.src).includes("legacy")).length;
    const v3legacy = rows.filter((r: any) => String(r.rd).slice(0, 10) >= "2025-03-31" && String(r.src).includes("legacy")).length;
    console.log(`  ${pad(sym, 13)}${lp(rows.length, 9)}${lp(distinct, 13)}${lp(v3left, 14)}  ${v3legacy ? `⚠ ${v3legacy} v3-era row(s) now legacy-sourced` : "✓ clean"}`);
  }
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
