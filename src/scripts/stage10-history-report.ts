// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 10b — HOW MUCH SCORING HISTORY DOES EACH STOCK HAVE? Read-only.
//
//   npx tsx src/scripts/stage10-history-report.ts [--md]
//
// ── WHAT "HAS HISTORY FROM" MEANS HERE ───────────────────────────────────────────────────────────
// The earliest QUARTERLY PERIOD a stock has a snapshot for — not the earliest as_of_date, and not the
// row count. Those differ sharply: the live period is re-snapshotted daily, so FY27Q1 alone carries
// thousands of rows and would swamp any count-based view of "depth".
//
// ⚠ A GAP IN THE MIDDLE IS NOT THE SAME AS A SHALLOW START, so both are reported. A stock with
//   FY23Q4 and FY27Q1 and nothing between has "history from FY23Q4" on a naive reading while being
//   almost entirely empty. `periods` vs `expected` is what separates them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";

const MD = process.argv.includes("--md");
const raw = async <T = any>(s: string): Promise<T[]> => (await prisma.$queryRawUnsafe(s)) as T[];

/** FY23Q4 → 94 (ordinal for range arithmetic). */
const ord = (pk: string): number => { const m = /^FY(\d{2})Q([1-4])$/.exec(pk)!; return Number(m[1]) * 4 + Number(m[2]); };
const label = (o: number): string => `FY${String(Math.floor((o - 1) / 4)).padStart(2, "0")}Q${((o - 1) % 4) + 1}`;

async function main(): Promise<void> {
  const rows = await raw<{
    symbol: string; pg: string; periods: number; earliest: string; latest: string; snapshots: number;
  }>(`
    SELECT s.symbol,
           COALESCE(pg.name, '(none)') pg,
           count(DISTINCT ss.period_key)::int periods,
           min(ss.period_key) earliest_lex,
           max(ss.period_key) latest_lex,
           count(*)::int snapshots
      FROM score_snapshots ss
      JOIN stocks s ON s.id = ss.stock_id
      LEFT JOIN stock_peer_groups sp ON sp.stock_id = s.id
      LEFT JOIN peer_groups pg ON pg.id = sp.peer_group_id
     GROUP BY 1,2 ORDER BY 2,1`);

  // min/max on the period_key TEXT is lexical, which happens to be correct for FYxxQy — but the
  // ordinal is what the span arithmetic needs, so recompute both properly per stock.
  const perStock = await raw<{ symbol: string; pk: string }>(
    `SELECT s.symbol, ss.period_key pk FROM score_snapshots ss JOIN stocks s ON s.id = ss.stock_id GROUP BY 1,2`);
  const byStock = new Map<string, string[]>();
  for (const r of perStock) {
    if (!byStock.has(r.symbol)) byStock.set(r.symbol, []);
    byStock.get(r.symbol)!.push(r.pk);
  }

  const out: Array<{ symbol: string; pg: string; from: string; to: string; periods: number; expected: number; gaps: number; snapshots: number }> = [];
  for (const r of rows) {
    const pks = (byStock.get(r.symbol) ?? []).filter((p) => /^FY\d{2}Q[1-4]$/.test(p));
    if (!pks.length) continue;
    const os = pks.map(ord).sort((a, b) => a - b);
    const from = label(os[0]), to = label(os[os.length - 1]);
    const expected = os[os.length - 1] - os[0] + 1;
    out.push({ symbol: r.symbol, pg: r.pg, from, to, periods: os.length, expected, gaps: expected - os.length, snapshots: r.snapshots });
  }
  out.sort((a, b) => ord(a.from) - ord(b.from) || a.symbol.localeCompare(b.symbol));

  // ── the headline table: how many stocks have history from how far back ──────────────────────
  const byStart = new Map<string, { stocks: number; complete: number }>();
  for (const s of out) {
    const e = byStart.get(s.from) ?? { stocks: 0, complete: 0 };
    e.stocks++; if (s.gaps === 0) e.complete++;
    byStart.set(s.from, e);
  }

  const L: string[] = [];
  const P = (line: string): void => { console.log(line); L.push(line); };

  P(`\n${"=".repeat(84)}`);
  P(`SCORING HISTORY — how far back does each stock go?`);
  P("=".repeat(84));
  P(``);
  P(`  stocks with any scoring history : ${out.length}`);
  P(`  total snapshot rows             : ${out.reduce((n, s) => n + s.snapshots, 0)}`);
  P(``);
  P(`  ── HISTORY DEPTH ──`);
  P(`  ${"history starts".padEnd(16)} ${"stocks".padStart(7)} ${"unbroken".padStart(9)}  ${"quarters covered".padStart(17)}`);
  P(`  ${"-".repeat(16)} ${"-".repeat(7)} ${"-".repeat(9)}  ${"-".repeat(17)}`);
  const latestOrd = Math.max(...out.map((s) => ord(s.to)));
  for (const [from, e] of [...byStart].sort((a, b) => ord(a[0]) - ord(b[0])))
    P(`  ${from.padEnd(16)} ${String(e.stocks).padStart(7)} ${String(e.complete).padStart(9)}  ${String(latestOrd - ord(from) + 1).padStart(17)}`);
  P(``);

  // ── by peer group ────────────────────────────────────────────────────────────────────────────
  P(`  ── BY PEER GROUP ──`);
  P(`  ${"peer group".padEnd(44)} ${"stocks".padStart(6)} ${"from".padStart(7)} ${"to".padStart(7)} ${"avg periods".padStart(11)} ${"gaps".padStart(5)}`);
  P(`  ${"-".repeat(44)} ${"-".repeat(6)} ${"-".repeat(7)} ${"-".repeat(7)} ${"-".repeat(11)} ${"-".repeat(5)}`);
  const byPg = new Map<string, typeof out>();
  for (const s of out) { if (!byPg.has(s.pg)) byPg.set(s.pg, []); byPg.get(s.pg)!.push(s); }
  for (const [pg, ss] of [...byPg].sort()) {
    const from = label(Math.min(...ss.map((s) => ord(s.from))));
    const to = label(Math.max(...ss.map((s) => ord(s.to))));
    const avg = (ss.reduce((n, s) => n + s.periods, 0) / ss.length).toFixed(1);
    const gaps = ss.reduce((n, s) => n + s.gaps, 0);
    P(`  ${pg.slice(0, 44).padEnd(44)} ${String(ss.length).padStart(6)} ${from.padStart(7)} ${to.padStart(7)} ${avg.padStart(11)} ${String(gaps).padStart(5)}`);
  }
  P(``);

  // ── anything with a hole in the middle ───────────────────────────────────────────────────────
  const holed = out.filter((s) => s.gaps > 0);
  P(`  ── STOCKS WITH A GAP INSIDE THEIR RANGE (${holed.length}) ──`);
  if (!holed.length) P(`     none — every stock's history is unbroken from its first period to its last.`);
  for (const s of holed.sort((a, b) => b.gaps - a.gaps).slice(0, 20))
    P(`     ${s.symbol.padEnd(13)} ${s.from}..${s.to}  has ${s.periods}/${s.expected}  missing ${s.gaps}`);
  P(``);

  if (MD) {
    fs.writeFileSync("_SCORING_HISTORY_REPORT.txt", L.join("\n"));
    console.log(`  -> _SCORING_HISTORY_REPORT.txt`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
