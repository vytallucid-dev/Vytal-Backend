// ═══════════════════════════════════════════════════════════════
// T2 (corrected) — stocks.fiscalYearEnd must reflect the CURRENT year-end, not
// the historical mode. READ-ONLY. WRITES NOTHING.
//   npx tsx src/scripts/_s4b-t2b.ts
//
// ⚠ WHY THE FIRST CUT WAS WRONG. I ranked each stock's annual rows by month and
//   took the most common. That is the HISTORICAL mode. But the column feeds
//   discovery.ts inferFilingType, which classifies FUTURE filings — so it must
//   hold the year-end the filer uses NOW. Several of these stocks moved their
//   year-end (LINDEINDIA Dec→Mar in FY24, IGIL Dec→Mar, SIEMENS Sep→Mar in FY25),
//   and for those the historical mode is the WRONG answer.
//
// The current year-end is read from the most RECENT annual row, preferring a
// v3-sourced one (nse_xbrl_annual) because that is the era the column governs.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CANDIDATES = ["NESTLEIND", "CASTROLIND", "CIEINDIA", "CRISIL", "HEXT", "IGIL", "LINDEINDIA", "SCHAEFFLER", "GILLETTE", "SIEMENS"];

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T2 CORRECTED — current year-end vs historical mode · ⚠ NOTHING WRITTEN     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("symbol", 13)}${pad("column", 10)}${pad("hist mode", 11)}${pad("CURRENT", 9)}${pad("latest annual", 15)}${pad("v3 era", 8)}verdict`);

  const change: Array<{ sym: string; to: string }> = [];
  const leave: string[] = [];
  const migrate: Array<{ sym: string; cur: string }> = [];

  for (const sym of CANDIDATES) {
    const [st] = await raw<any>(`SELECT "id","fiscalYearEnd"::text fye FROM stocks WHERE "symbol"=$1`, sym);
    const rows = await raw<any>(
      `SELECT date_part('month',"report_date")::int m, "report_date"::text rd, "source" src
         FROM fundamentals WHERE "stock_id"=$1 ORDER BY "report_date" DESC`, st.id);
    if (!rows.length) { console.log(`  ${pad(sym, 13)}${pad(st.fye, 10)} (no annual rows)`); continue; }
    // historical mode
    const cnt = new Map<number, number>();
    for (const r of rows) cnt.set(r.m, (cnt.get(r.m) ?? 0) + 1);
    const mode = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // CURRENT: newest row, preferring v3
    const v3 = rows.filter((r: any) => !String(r.src).includes("_legacy"));
    const cur = (v3[0] ?? rows[0]);
    const curMonth = cur.m;
    const curName = curMonth === 3 ? "march" : curMonth === 12 ? "december" : MON[curMonth].toLowerCase();
    const representable = curMonth === 3 || curMonth === 12;
    const needsChange = representable && curName !== st.fye;
    let verdict: string;
    if (!representable) { verdict = `⚠ MIGRATION — '${curName}' not in the enum`; migrate.push({ sym, cur: curName }); }
    else if (needsChange) { verdict = `✓ CHANGE to ${curName}`; change.push({ sym, to: curName }); }
    else { verdict = `— already correct, LEAVE`; leave.push(sym); }
    const moved = mode !== curMonth ? "  ⚠ year-end MOVED" : "";
    console.log(`  ${pad(sym, 13)}${pad(st.fye, 10)}${pad(MON[mode], 11)}${pad(MON[curMonth], 9)}${pad(String(cur.rd).slice(0, 10), 15)}${pad(v3.length ? "yes" : "legacy", 8)}${verdict}${moved}`);
  }

  console.log(`\n  ── REVISED RECOMMENDATION ──`);
  console.log(`  CHANGE (${change.length}): ${change.map((c) => `${c.sym}→${c.to}`).join(", ") || "none"}`);
  console.log(`  LEAVE  (${leave.length}): ${leave.join(", ") || "none"}  — the column already matches the CURRENT year-end`);
  console.log(`  MIGRATE(${migrate.length}): ${migrate.map((m) => `${m.sym} (${m.cur})`).join(", ") || "none"}`);

  if (change.length) {
    const toMar = change.filter((c) => c.to === "march").map((c) => c.sym);
    const toDec = change.filter((c) => c.to === "december").map((c) => c.sym);
    console.log(`\n  ── THE EXACT STATEMENT ──`);
    console.log(`    BEGIN;`);
    if (toMar.length) console.log(`    UPDATE stocks SET "fiscalYearEnd"='march'::"FiscalYearEnd", "updated_at"=now()\n     WHERE "symbol" IN (${toMar.map((s) => `'${s}'`).join(",")});   -- ${toMar.length} row(s)`);
    if (toDec.length) console.log(`    UPDATE stocks SET "fiscalYearEnd"='december'::"FiscalYearEnd", "updated_at"=now()\n     WHERE "symbol" IN (${toDec.map((s) => `'${s}'`).join(",")});   -- ${toDec.length} row(s)`);
    console.log(`    COMMIT;`);
  }
  console.log(`\n  ⚠ NOTHING WAS WRITTEN. Awaiting approval.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
