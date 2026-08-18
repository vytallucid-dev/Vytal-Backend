// ═══════════════════════════════════════════════════════════════
// THE FINAL QUESTION — what stands between us and "all 442 complete from 2018 (or
// listing) apart from a named manual-entry list"? READ-ONLY.
//   npx tsx src/scripts/_s4-final.ts
// Splits every remaining incompleteness into:
//   (a) fixable by RE-RUNNING something we already have
//   (b) fixable only by MANUAL ENTRY (with a cell count)
//   (c) NOT FIXABLE — NSE serves no document (the honest ceiling)
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { prisma } from "../db/prisma.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const cqLabel = (i: number) => `${Math.floor(i / 4)}${["Mar", "Jun", "Sep", "Dec"][i % 4]}`;
const FY23Q1 = 2022 * 4 + 1; // 2022Jun

async function main() {
  const j = JSON.parse(readFileSync(`${DIR}/_r4a-exceptions.json`, "utf8"));
  const ex: any[] = j.exceptions;
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ THE FINAL QUESTION — anatomy of the ${lp(ex.length, 3)} incomplete stocks              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  complete today: ${j.complete.length}/442`);

  // ── how much of the incompleteness is the FY23Q1 gap alone? ──
  const onlyFy23q1 = ex.filter((e) =>
    !e.zero && !e.qTailMissing.length && !e.aMissRecov.length && !e.aMissSource.length &&
    [...e.missRecov, ...e.missSource].every((i: number) => i === FY23Q1) &&
    [...e.missRecov, ...e.missSource].length > 0);
  const touchesFy23q1 = ex.filter((e) => e.missRecov.includes(FY23Q1) || e.missSource.includes(FY23Q1));
  console.log(`\n  ── the FY23Q1 (2022Jun) source gap ──`);
  console.log(`  stocks missing 2022Jun at all                    : ${touchesFy23q1.length}`);
  console.log(`  stocks whose ONLY defect is 2022Jun              : ${onlyFy23q1.length}  ← would become COMPLETE if it existed`);

  // ── every missing quarter across every exception, by cause ──
  const recov = new Map<number, number>(), source = new Map<number, number>();
  for (const e of ex) {
    for (const i of e.missRecov) recov.set(i, (recov.get(i) ?? 0) + 1);
    for (const i of e.missSource) source.set(i, (source.get(i) ?? 0) + 1);
  }
  const totRecov = [...recov.values()].reduce((a, b) => a + b, 0);
  const totSource = [...source.values()].reduce((a, b) => a + b, 0);
  console.log(`\n  ── missing STANDALONE quarter-slots, by cause ──`);
  console.log(`  (a) consolidated held, standalone absent  : ${lp(totRecov, 5)} slot(s) across ${recov.size} distinct quarters`);
  console.log(`  (c) no row of EITHER basis (source gap)   : ${lp(totSource, 5)} slot(s) across ${source.size} distinct quarters`);
  console.log(`\n  the ten worst quarters by number of stocks missing BOTH bases:`);
  for (const [i, n] of [...source.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`     ${pad(cqLabel(i), 10)}${lp(n, 5)} stock(s)${i === FY23Q1 ? "   ← the known FY23Q1 gap" : ""}`);
  }

  // ── (a) the re-runnable set: overflow losses + mislabels ──
  console.log(`\n  ── (a) FIXABLE BY RE-RUNNING SOMETHING WE ALREADY HAVE ──`);
  let lostFilings = 0, lostStocks = new Set<string>();
  if (existsSync(`${DIR}/_r5a-lost.json`)) {
    const l = JSON.parse(readFileSync(`${DIR}/_r5a-lost.json`, "utf8"));
    const absent = (l.recs ?? []).filter((r: any) => r.outcome === "ABSENT");
    lostFilings = absent.length;
    for (const r of absent) lostStocks.add(r.symbol);
    console.log(`  A1 overflow-lost filings (S4.2 now bounded)   : ${lostFilings} filing(s) across ${lostStocks.size} stock(s)`);
    console.log(`     ${[...lostStocks].join(", ")}`);
  }
  const mis = existsSync(`${DIR}/_r5c-misordered.json`) ? JSON.parse(readFileSync(`${DIR}/_r5c-misordered.json`, "utf8")).bad : [];
  console.log(`  A2 mis-ordered label stocks (S4.3 now general): ${mis.length} stock(s) — ${mis.map((m: any) => m.sym).join(", ")}`);
  const [fyeWrong] = await raw<any>(`
    WITH a AS (SELECT f."stock_id" sid, date_part('month',f."report_date")::int m, count(*)::int c
               FROM fundamentals f GROUP BY 1,2),
    top AS (SELECT DISTINCT ON (sid) sid, m FROM a ORDER BY sid, c DESC)
    SELECT count(*)::int n FROM top JOIN stocks st ON st."id"=top.sid
     WHERE (st."fiscalYearEnd"::text='march' AND top.m<>3) OR (st."fiscalYearEnd"::text='december' AND top.m<>12)`);
  console.log(`  A3 stocks whose stocks.fiscalYearEnd is wrong : ${fyeWrong.n}`);

  // ── (b) manual entry ──
  console.log(`\n  ── (b) FIXABLE ONLY BY MANUAL ENTRY ──`);
  const [bill] = await raw<any>(`
    WITH k AS (SELECT "stock_id", "fiscal_year", bool_or("result_type"='standalone') sa
               FROM fundamentals GROUP BY 1,2),
         q AS (SELECT "stock_id", "fiscal_year", "quarter", bool_or("result_type"='standalone') sa
               FROM quarterly_results GROUP BY 1,2,3)
    SELECT (SELECT count(*) FILTER (WHERE NOT sa) FROM k)::int ann_nosa,
           (SELECT count(*) FILTER (WHERE NOT sa) FROM q)::int qtr_nosa`);
  console.log(`  B1 periods with a row but no STANDALONE basis  : annual ${bill.ann_nosa} × 31 cols + quarterly ${bill.qtr_nosa} × 7 cols`);
  console.log(`                                                 = ${bill.ann_nosa * 31 + bill.qtr_nosa * 7} cells`);
  console.log(`  B2 banking M1/M5 (D1)                          : 780 cells (26 banks × 13 qtrs × 2 fields + 26 × 4 BS)`);

  // ── (c) not fixable ──
  console.log(`\n  ── (c) NOT FIXABLE — NSE serves no document ──`);
  const zero = ex.filter((e) => e.zero);
  console.log(`  C1 stocks with ZERO rows anywhere             : ${zero.length} — ${zero.map((z: any) => z.sym).join(", ")}`);
  console.log(`  C2 stock-quarters absent on BOTH bases        : ${totSource} slot(s)`);
  console.log(`  C3 depth ceiling: a stock listed in 2024 cannot have 2018 data — that is`);
  console.log(`     "complete from listing", not incomplete. ${j.depth.filter((d: any) => d.oldestAfy !== "—" && parseInt(d.oldestAfy.slice(2), 10) >= 21).length} stocks start at FY21 or later.`);
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
