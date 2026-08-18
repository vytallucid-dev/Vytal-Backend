// ═══════════════════════════════════════════════════════════════
// T3 STATE — row counts + consecutiveTail per stock, before/after the re-ingest.
// READ-ONLY.
//   npx tsx src/scripts/_s4b-t3state.ts before|after
//
// ⚠ THE CHECK THAT MATTERS: a corrected label is a NEW unique key
// (stockId, fiscalYear, quarter, resultType). So the re-ingest may write the
// corrected row ALONGSIDE the wrong-key one instead of replacing it. If the row
// count roughly DOUBLES, the series is worse than before, not better.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { consecutiveTail } from "../scoring/metrics/momentum.js";
import type { MomentumQuarter } from "../scoring/metrics/types.js";

const label = process.argv[2];
if (label !== "before" && label !== "after") { console.error("usage: before|after"); process.exit(1); }
const DIR = process.env.R1_DIR ?? ".";
const OUT = `${DIR}/_s4b-t3-${label}.json`;
const PREV = `${DIR}/_s4b-t3-before.json`;
const STOCKS = ["SIEMENS", "GILLETTE", "ENRIN", "POWERINDIA", "DELHIVERY", "CEMPRO", "CANBK"];

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const qOrd = (fy: string, q: string) => parseInt(fy.slice(2), 10) * 4 + (Number(q.slice(1)) - 1);
const cq = (rd: string) => { const y = +rd.slice(0, 4), m = +rd.slice(5, 7); return y * 4 + Math.floor((m - 1) / 3); };

async function main() {
  const state: Record<string, any> = {};
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T3 ${pad(label.toUpperCase(), 6)} — rows held and what the engine can walk                  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("symbol", 13)}${lp("qtr rows", 10)}${lp("SA rows", 9)}${lp("distinct rd", 12)}${lp("engine tail", 13)}${lp("true tail", 11)}  newest by label / by date`);

  for (const sym of STOCKS) {
    const [st] = await raw<any>(`SELECT "id","industryType"::text it FROM stocks WHERE "symbol"=$1`, sym);
    const tbl = st.it === "banking" ? "banking_quarterly_results" : "quarterly_results";
    const rows = await raw<any>(
      `SELECT "fiscal_year" fy,"quarter" q,"result_type" rt,"report_date"::text rd,"source" src
         FROM "${tbl}" WHERE "stock_id"=$1 ORDER BY "report_date"`, st.id);
    const sa = rows.filter((r: any) => r.rt === "standalone");
    const distinctRd = new Set(sa.map((r: any) => String(r.rd).slice(0, 10))).size;

    const qs: MomentumQuarter[] = sa.map((r: any) => ({
      fiscalYear: r.fy, quarter: r.q, qOrdinal: qOrd(r.fy, r.q),
      revenue: 1, otherIncome: 0, interest: 0, depreciation: 0, profitBeforeTax: 1, netProfit: 1, operatingProfitStored: 1,
    }));
    const tail = consecutiveTail(qs);
    const idx = [...new Set(sa.map((r: any) => cq(String(r.rd).slice(0, 10))))].sort((a, b) => a - b);
    let trueTail = idx.length ? 1 : 0;
    for (let i = idx.length - 1; i > 0; i--) { if (idx[i] - idx[i - 1] === 1) trueTail++; else break; }
    const newestByLabel = qs.length ? [...qs].sort((a, b) => a.qOrdinal - b.qOrdinal).at(-1)! : null;
    const newestByDate = sa.length ? sa.slice().sort((a: any, b: any) => String(a.rd).localeCompare(String(b.rd))).at(-1) : null;

    state[sym] = {
      qtrRows: rows.length, saRows: sa.length, distinctRd,
      engineTail: tail.length, trueTail,
      newestLabel: newestByLabel ? newestByLabel.fiscalYear + newestByLabel.quarter : null,
      newestDate: newestByDate ? String(newestByDate.rd).slice(0, 10) + " " + newestByDate.fy + newestByDate.q : null,
      keys: sa.map((r: any) => `${r.fy}${r.q}|${String(r.rd).slice(0, 10)}`),
    };
    console.log(`  ${pad(sym, 13)}${lp(rows.length, 10)}${lp(sa.length, 9)}${lp(distinctRd, 12)}${lp(tail.length, 13)}${lp(trueTail, 11)}  ${state[sym].newestLabel} / ${state[sym].newestDate}`);
    // ⚠ duplicate detector: more standalone rows than distinct period-ends means two
    //    labels point at the same real quarter
    if (sa.length > distinctRd) console.log(`     ⚠ ${sa.length - distinctRd} DUPLICATE period-end(s) — two labels for one real quarter`);
  }

  writeFileSync(OUT, JSON.stringify(state, null, 1));
  if (label === "after" && existsSync(PREV)) {
    const before = JSON.parse(readFileSync(PREV, "utf8"));
    console.log(`\n  ── BEFORE → AFTER ──`);
    console.log(`  ${pad("symbol", 13)}${lp("rows", 12)}${lp("SA rows", 14)}${lp("distinct rd", 15)}${lp("engine tail", 15)}  verdict`);
    let dupes = 0;
    for (const sym of STOCKS) {
      const b = before[sym], a = state[sym];
      if (!b) continue;
      const dup = a.saRows > a.distinctRd;
      if (dup) dupes++;
      const grew = a.saRows - b.saRows;
      console.log(`  ${pad(sym, 13)}${lp(`${b.qtrRows}→${a.qtrRows}`, 12)}${lp(`${b.saRows}→${a.saRows}`, 14)}${lp(`${b.distinctRd}→${a.distinctRd}`, 15)}${lp(`${b.engineTail}→${a.engineTail}`, 15)}  ${dup ? "⚠ DUPLICATES" : grew > 0 ? "grew (new periods)" : a.engineTail > b.engineTail ? "✓ tail improved" : "unchanged"}`);
    }
    console.log(`\n  ⚠ stocks with duplicate period-ends after re-ingest: ${dupes === 0 ? "✓ 0 — labels were REPLACED, not added alongside" : "⚠ " + dupes + " — STOP"}`);
  }
  console.log(`\n  → ${OUT}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
