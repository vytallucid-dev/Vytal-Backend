// ═══════════════════════════════════════════════════════════════
// R5b — WHY are ABBOTINDIA / BAYERCROP / MCX completely empty? READ-ONLY.
//   npx tsx src/scripts/_s4d-empty.ts
// They hold zero rows in all four result tables — neither history nor current
// data. Establish whether the pipeline ever TRIED, and what it saw.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const SYMS = ["ABBOTINDIA", "BAYERCROP", "MCX"];

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R5b — the three empty stocks: did the pipeline ever try?                   ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  for (const sym of SYMS) {
    const [st] = await raw(`SELECT "id","symbol","name","industryType"::text ind,"fiscalYearEnd"::text fye
                              FROM stocks WHERE "symbol"=$1`, sym);
    console.log(`\n  ── ${sym} ──`);
    if (!st) { console.log(`     ⚠ NOT IN stocks AT ALL`); continue; }
    console.log(`     id ${st.id} · name ${st.name}`);
    console.log(`     industryType ${st.ind} · fiscalYearEnd ${st.fye}`);
    for (const t of ["quarterly_results", "fundamentals", "banking_quarterly_results", "banking_fundamentals"]) {
      const [c] = await raw(`SELECT count(*)::int n FROM "${t}" WHERE "stock_id"=$1`, st.id);
      console.log(`     ${pad(t, 28)}${c.n} row(s)`);
    }
    // did anything ever try to fetch?
    const logs = await raw(
      `SELECT "created_at"::text ts, "status", "message", "qe_date"::text qe
         FROM result_fetch_logs WHERE "stock_id"=$1 ORDER BY "created_at" DESC LIMIT 12`, st.id).catch(() => []);
    console.log(`     result_fetch_logs: ${logs.length} recent entr(ies)`);
    for (const l of logs) console.log(`        ${pad(String(l.ts).slice(0, 19), 21)}${pad(l.status, 14)}${l.qe ? String(l.qe).slice(0, 10) + "  " : ""}${String(l.message ?? "").slice(0, 90)}`);
  }

  // are they even in the scan universe?
  console.log(`\n  ── are they marked for scanning? ──`);
  const [cols] = await raw(`SELECT string_agg(column_name, ', ' ORDER BY column_name) c
                              FROM information_schema.columns WHERE table_name='stocks'`);
  console.log(`     stocks columns: ${String(cols.c).slice(0, 600)}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
