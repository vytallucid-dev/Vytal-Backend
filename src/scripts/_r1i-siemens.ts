// ═══════════════════════════════════════════════════════════════
// R1i — THE COLLISION SUSPECTS, ROW BY ROW. READ-ONLY.
//   npx tsx src/scripts/_r1i-siemens.ts
// R1h flagged SIEMENS (margin -2), DELHIVERY, POWERINDIA (non-monotone) and
// ACC / AMBUJACEM (Q1 month moved). Print every quarterly row each holds, in
// report_date order, so the fiscal key each period-end maps to is VISIBLE and
// the collision question is answered from data rather than reasoning.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const SUSPECTS = ["SIEMENS", "DELHIVERY", "POWERINDIA", "ACC", "AMBUJACEM"];
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);

async function main() {
  for (const sym of SUSPECTS) {
    console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
    console.log(`║ ${pad(sym, 73)}║`);
    console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
    const [st] = await raw<any>(`SELECT "id","fiscalYearEnd"::text fye,"industryType"::text it FROM stocks WHERE "symbol"=$1`, sym);
    if (!st) { console.log(`  (not in universe)`); continue; }
    console.log(`  stocks.fiscalYearEnd = ${st.fye} · industryType = ${st.it}`);

    const q = await raw<any>(
      `SELECT "fiscal_year" fy,"quarter" q,"result_type" rt,"report_date"::text rd,"filing_date"::text fd,"source" src
         FROM quarterly_results WHERE "stock_id"=$1
        UNION ALL
       SELECT "fiscal_year","quarter","result_type","report_date"::text,"filing_date"::text,"source"
         FROM banking_quarterly_results WHERE "stock_id"=$1
        ORDER BY 4,3`, st.id);
    console.log(`\n  QUARTERLY (${q.length} rows) — period-end order:`);
    console.log(`    ${pad("report_date", 13)}${pad("key", 9)}${pad("basis", 14)}${pad("source", 26)}filing_date`);
    let prevOrd = -Infinity, prevKey = "";
    for (const r of q) {
      const ord = parseInt(r.fy.slice(2), 10) * 10 + Number(r.q.slice(1));
      const back = ord < prevOrd ? `  ⚠ KEY WENT BACKWARDS (after ${prevKey})` : "";
      const era = r.rd.slice(0, 10) >= "2025-03-31" ? "  [v3-era ⛔ protected]" : "";
      console.log(`    ${pad(r.rd.slice(0, 10), 13)}${pad(r.fy + r.q, 9)}${pad(r.rt, 14)}${pad(r.src, 26)}${String(r.fd).slice(0, 10)}${era}${back}`);
      prevOrd = ord; prevKey = r.fy + r.q;
    }

    // THE decisive question: is any v3-era key ALSO reachable from a legacy-era period-end?
    const v3keys = new Set(q.filter((r: any) => r.rd.slice(0, 10) >= "2025-03-31").map((r: any) => `${r.fy}${r.q}|${r.rt}`));
    const oldkeys = new Set(q.filter((r: any) => r.rd.slice(0, 10) <= "2024-12-31").map((r: any) => `${r.fy}${r.q}|${r.rt}`));
    const overlap = [...v3keys].filter((k) => oldkeys.has(k));
    console.log(`\n    distinct v3-era keys: ${v3keys.size} · distinct legacy-era keys: ${oldkeys.size}`);
    console.log(`    keys held in BOTH eras: ${overlap.length === 0 ? "✓ none (impossible — the key is unique, so this proves the eras are disjoint)" : "⚠ " + overlap.join(", ")}`);

    // What key WOULD a legacy filing for each pre-2025 period-end produce? We already
    // hold that answer for every period the legacy era covers: it is the key on the row.
    // The risk is only for period-ends the legacy path will fetch but we do NOT yet hold.
    const held = new Set(q.map((r: any) => r.rd.slice(0, 10)));
    const wanted: string[] = [];
    for (let y = 2018; y <= 2024; y++) for (const md of ["03-31", "06-30", "09-30", "12-31"]) {
      const d = `${y}-${md}`;
      if (d >= "2018-03-31" && d <= "2024-12-31" && !held.has(d)) wanted.push(d);
    }
    console.log(`    calendar quarter-ends in [2018-03-31..2024-12-31] we hold NO row for: ${wanted.length}`);
    console.log(`      ${wanted.join(" ") || "(none)"}`);
    const v3rds = [...new Set(q.filter((r: any) => r.rd.slice(0, 10) >= "2025-03-31").map((r: any) => r.rd.slice(0, 10)))].sort();
    console.log(`    v3-era period-ends held: ${v3rds.join(" ")}`);
  }
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
