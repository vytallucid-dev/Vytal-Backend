// ═══════════════════════════════════════════════════════════════
// R5c — WHY does NSE return "0 filings discovered" for these three?
// READ-ONLY. Network reads only; writes NOTHING to the database.
//   npx tsx src/scripts/_s4d-probe3.ts [SYM,SYM,...]
//
// ABBOTINDIA, BAYERCROP and MCX each hold zero rows in all four result tables.
// Each was scanned exactly ONCE and NSE's filings API returned nothing — logged
// as status:"success" with error:"0 filings discovered", so nothing ever retried.
//
// The question this answers: is the emptiness TRUE (NSE really has no XBRL for
// them) or is it a LOOKUP failure (wrong symbol, wrong index, pagination)? Those
// have opposite remedies, and the log cannot tell them apart.
//
// A control symbol is probed alongside so a zero result can be distinguished from
// a broken session.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchFilingsList } from "../ingestions/quaterly-results/results/discovery.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const SYMS = (process.argv[2] ?? "ABBOTINDIA,BAYERCROP,MCX,RELIANCE").split(",").map((s) => s.trim()).filter(Boolean);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R5c — probing NSE discovery for the empty stocks (RELIANCE = control)      ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  for (const sym of SYMS) {
    const [st] = await raw(`SELECT "fiscalYearEnd"::text fye FROM stocks WHERE "symbol"=$1`, sym);
    const fye = (st?.fye === "december" ? "december" : "march") as "march" | "december";
    process.stdout.write(`  ${pad(sym, 13)} fye=${pad(fye, 9)} … `);
    const t0 = Date.now();
    try {
      const rows = await fetchFilingsList(sym, fye);
      const ms = Date.now() - t0;
      console.log(`${rows.length} filing(s)  ${ms}ms`);
      const withXbrl = rows.filter((r: any) => r.xbrl);
      console.log(`     with an XBRL url : ${withXbrl.length}`);
      for (const r of rows.slice(0, 5) as any[]) {
        console.log(`       ${pad(r.qeDate ?? r.period ?? "?", 14)}${pad(r.filingType ?? "?", 12)}${pad(r.resultType ?? "?", 13)}${r.xbrl ? String(r.xbrl).slice(-42) : "(no xbrl)"}`);
      }
      if (rows.length > 5) console.log(`       … ${rows.length - 5} more`);
    } catch (e) {
      console.log(`THREW after ${Date.now() - t0}ms`);
      console.log(`     ${(e as Error).message.slice(0, 200)}`);
    }
    await sleep(1500);
  }
  console.log(`\n  ⇒ If the control returns filings and these three return zero, the emptiness`);
  console.log(`    is real at the symbol NSE was asked about — and the remedy is a symbol/`);
  console.log(`    identifier fix, not a retry. If they DO return filings now, the single`);
  console.log(`    "0 filings" result was transient and the defect is that nothing retried.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
