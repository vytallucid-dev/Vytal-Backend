// ═══════════════════════════════════════════════════════════════
// T2 PREVIEW — the stocks.fiscalYearEnd correction. ⚠ READ-ONLY. WRITES NOTHING.
//   npx tsx src/scripts/_s4b-t2preview.ts
// Shows the exact UPDATE, the current value, the evidence (where the stock's
// annual rows actually land), and what inferFilingType does before vs after.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TO_MARCH = ["NESTLEIND"];
const TO_DECEMBER = ["CASTROLIND", "CIEINDIA", "CRISIL", "HEXT", "IGIL", "LINDEINDIA", "SCHAEFFLER"];
const NOT_REPRESENTABLE = [
  { sym: "GILLETTE", actual: "June" },
  { sym: "SIEMENS", actual: "September historically, March from FY25" },
];

/** discovery.ts inferFilingType, verbatim in shape */
const inferFilingType = (qeDate: string, fye: "march" | "december") =>
  qeDate.toUpperCase().includes(fye === "december" ? "-DEC-" : "-MAR-") ? "annual" : "quarterly";

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T2 PREVIEW — stocks.fiscalYearEnd · ⚠ NOTHING WRITTEN                      ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  const all = [...TO_MARCH.map((s) => ({ sym: s, to: "march" as const })), ...TO_DECEMBER.map((s) => ({ sym: s, to: "december" as const }))];
  console.log(`\n  ${pad("symbol", 14)}${pad("current", 11)}${pad("→ new", 11)}${pad("annual rows land on", 22)}rows  evidence`);
  for (const t of all) {
    const [st] = await raw<any>(`SELECT "id","fiscalYearEnd"::text fye FROM stocks WHERE "symbol"=$1`, t.sym);
    const months = await raw<any>(
      `SELECT date_part('month',"report_date")::int m, count(*)::int c, min("report_date")::text lo, max("report_date")::text hi
         FROM fundamentals WHERE "stock_id"=$1 GROUP BY 1 ORDER BY 2 DESC`, st.id);
    const top = months[0];
    const spread = months.map((x: any) => `${MON[x.m]}×${x.c}`).join(" ");
    console.log(`  ${pad(t.sym, 14)}${pad(st.fye, 11)}${pad("→ " + t.to, 11)}${pad(MON[top.m] + " (" + String(top.lo).slice(0, 10) + " … " + String(top.hi).slice(0, 10) + ")", 22)}${lp(top.c, 4)}  ${spread}`);
  }

  console.log(`\n  ── THE EXACT STATEMENT (one transaction, 8 rows) ──`);
  console.log(`    BEGIN;`);
  console.log(`    UPDATE stocks SET "fiscalYearEnd" = 'march'::"FiscalYearEnd", "updated_at" = now()`);
  console.log(`     WHERE "symbol" IN ('NESTLEIND');`);
  console.log(`    UPDATE stocks SET "fiscalYearEnd" = 'december'::"FiscalYearEnd", "updated_at" = now()`);
  console.log(`     WHERE "symbol" IN ('CASTROLIND','CIEINDIA','CRISIL','HEXT','IGIL','LINDEINDIA','SCHAEFFLER');`);
  console.log(`    COMMIT;   -- expected: 1 row, then 7 rows`);

  console.log(`\n  ── WHAT IT CHANGES: inferFilingType(qe_Date, fiscalYearEnd) ──`);
  console.log(`     discovery.ts classifies a v3 filing annual-vs-quarterly from this column alone.`);
  console.log(`  ${pad("symbol", 14)}${pad("qe_Date", 14)}${pad("BEFORE", 12)}${pad("AFTER", 12)}effect`);
  for (const t of all) {
    const [st] = await raw<any>(`SELECT "fiscalYearEnd"::text fye FROM stocks WHERE "symbol"=$1`, t.sym);
    const trueEnd = t.to === "december" ? "31-DEC-2024" : "31-MAR-2025";
    const b = inferFilingType(trueEnd, st.fye as any), a = inferFilingType(trueEnd, t.to);
    console.log(`  ${pad(t.sym, 14)}${pad(trueEnd, 14)}${pad(b, 12)}${pad(a, 12)}${b !== a ? "⚠ its real ANNUAL filing stops being mis-read as quarterly" : "no change"}`);
  }

  console.log(`\n  ── ⚠ NOT REPRESENTABLE IN THE ENUM — reported, NOT attempted ──`);
  console.log(`     enum FiscalYearEnd = { march, december }`);
  for (const n of NOT_REPRESENTABLE) console.log(`     ⚠ ${pad(n.sym, 12)} actual year-end: ${n.actual}`);
  console.log(`     Adding 'june'/'september' is a MIGRATION and is out of scope here.`);
  console.log(`     ⚠ SIEMENS is the deeper case: its year-end genuinely CHANGED (annual rows`);
  console.log(`       land Sep-2019…Sep-2024, then Mar-2025 and Mar-2026). A SINGLE-VALUED column`);
  console.log(`       cannot represent a filer that moved its year-end — so 'march' is right today`);
  console.log(`       and wrong for its history. That is the argument for the DOCUMENT staying`);
  console.log(`       authoritative (picker.ts already makes it), not for a better column value.`);

  console.log(`\n  ⚠ NOTHING WAS WRITTEN. Awaiting approval.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
