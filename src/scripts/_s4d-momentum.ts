// ═══════════════════════════════════════════════════════════════
// R7 — RE-MEASURE consecutiveTail and the Momentum metrics after the repairs.
// READ-ONLY. Computes in memory; writes NOTHING, enqueues NOTHING.
//   npx tsx src/scripts/_s4d-momentum.ts [SYM,SYM,...]
//
// ⚠ THIS IS NOT A SCORING PASS. No score row is written, no rescore is enqueued.
//   It calls the same loader and metric functions the engine calls, so the
//   numbers are the engine's numbers — but purely as measurement.
//
// WHY IT MOVES. loadMomentumStandalone orders by (fiscalYear, quarter), NOT by
// report_date. A mislabelled quarter therefore lands in the wrong position and
// consecutiveTail — which walks backwards while each step is exactly one quarter
// earlier — stops at the discontinuity. Correcting the labels lengthens the run,
// and metrics needing 4 (M1..M4) or 8 (M5) quarters start computing.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { loadMomentumStandalone } from "../scoring/metrics/load.js";
import { consecutiveTail, m1TtmOpm, m2TtmNpm, m3RevenueYoyTtm, m4NetProfitYoyTtm, m5TtmInterestCoverage } from "../scoring/metrics/momentum.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const SYMS = (process.argv[2] ?? "SIEMENS,ENRIN,GILLETTE,DELHIVERY").split(",").map((s) => s.trim()).filter(Boolean);
const fmt = (m: any) => m?.value === null || m?.value === undefined
  ? `— (${m?.reason ?? m?.unavailableReason ?? "unavailable"})` : String(Number(m.value).toFixed(2));

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R7 — consecutiveTail & Momentum after the repairs (read-only)              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  for (const sym of SYMS) {
    const [st] = await raw(`SELECT "id","industryType"::text it FROM stocks WHERE "symbol"=$1`, sym);
    if (!st) { console.log(`\n  ── ${sym}: not in stocks`); continue; }
    console.log(`\n  ── ${sym} (${st.it}) ──`);
    if (st.it === "banking") { console.log(`     banking path — loadMomentumStandalone does not apply`); continue; }
    let qs: any[] = [];
    try { qs = await loadMomentumStandalone(st.id); }
    catch (e) { console.log(`     loader threw: ${(e as Error).message}`); continue; }
    const run = consecutiveTail(qs);
    console.log(`     quarters loaded     : ${qs.length}`);
    console.log(`     consecutiveTail     : ${run.length}${run.length >= 8 ? "  ✓ M1..M5 all satisfiable" : run.length >= 4 ? "  ✓ M1..M4 satisfiable, M5 needs 8" : "  ⚠ under 4 — M1..M4 blocked"}`);
    if (run.length) {
      const f = run[0], l = run[run.length - 1];
      console.log(`     run spans           : ${f.fiscalYear}${f.quarter} .. ${l.fiscalYear}${l.quarter}`);
    }
    console.log(`     the tail as ordered : ${qs.slice(-12).map((q: any) => `${q.fiscalYear}${q.quarter}`).join(" ")}`);
    console.log(`     M1 TTM OPM %        : ${fmt(m1TtmOpm(run))}`);
    console.log(`     M2 TTM NPM %        : ${fmt(m2TtmNpm(run))}`);
    console.log(`     M3 Revenue YoY TTM %: ${fmt(m3RevenueYoyTtm(run))}`);
    console.log(`     M4 NetProfit YoY %  : ${fmt(m4NetProfitYoyTtm(run))}`);
    console.log(`     M5 TTM Int. Cover   : ${fmt(m5TtmInterestCoverage(run))}`);
  }
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
