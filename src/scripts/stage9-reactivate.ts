// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 9 — REACTIVATE THE THREE.  ⚠ WRITES with --apply.  Reversible with --revert.
//
//   npx tsx src/scripts/stage9-reactivate.ts            # check the preconditions, write nothing
//   npx tsx src/scripts/stage9-reactivate.ts --apply
//   npx tsx src/scripts/stage9-reactivate.ts --revert   # put them back
//
// ── WHY THEY WERE OFF, AND WHAT CHANGED ──────────────────────────────────────────────────────────
// ABBOTINDIA, BAYERCROP and MCX were deactivated together on 2026-08-17 08:03:24 — only those three
// share that timestamp. Their result_fetch_logs say `success — "0 filings discovered"`, and the
// reason was real: NSE serves them NOTHING. Verified with TCS as the control on every lane —
// results v2 (TCS 52 / them 0), results v3 (TCS 12 / them 0), shareholding (TCS 20 quarters / them 0).
//
// Two things changed, and only together do they justify turning these back on:
//   1. BSE's inline-XBRL migration is now readable (bse-ixbrl.ts), so the filings BSE HAS — 138 /
//      141 / 85 respectively — can actually be parsed. Their results are now complete and current.
//   2. BSE is now a FALLBACK in the daily scan (bse-fallback.ts), so a period NSE misses is asked of
//      the other exchange. Shareholding already had this (fillShareholdingGapsFromBse, scheduled in
//      daily-ingest-ops) — it was simply skipping them, because it filters on is_active.
//
// ⚠ THE PRECONDITIONS ARE CHECKED, NOT ASSUMED. Reactivating a stock the pipelines cannot feed puts
//   stale data into scoring, which is worse than leaving it out. This refuses unless each stock is
//   actually current on results, and it says exactly which check failed.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const SYMBOLS = ["ABBOTINDIA", "BAYERCROP", "MCX"];
const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(92)}`);
  console.log(`STAGE 9 — reactivate  ${REVERT ? "*** REVERT ***" : APPLY ? "*** LIVE ***" : "(check only)"}`);
  console.log("=".repeat(92));

  if (REVERT) {
    const n = await prisma.$executeRawUnsafe(
      `UPDATE stocks SET is_active = false, updated_at = now() WHERE symbol = ANY($1::text[])`, SYMBOLS);
    console.log(`\n  reverted ${n} stock(s) to is_active = false\n`);
    await prisma.$disconnect();
    return;
  }

  // the newest period the universe holds — the honest definition of "current"
  const horizon = (await raw<{ d: string }>(
    `SELECT max(report_date)::date::text d FROM quarterly_results`))[0].d;
  console.log(`\n  universe horizon (newest quarterly period held anywhere): ${horizon}\n`);

  let allOk = true;
  for (const sym of SYMBOLS) {
    const st = await raw<{ id: string; is_active: boolean }>(
      `SELECT id, is_active FROM stocks WHERE symbol = $1`, sym);
    if (!st.length) { console.log(`  ${sym}: NOT IN THE UNIVERSE`); allOk = false; continue; }

    const q = await raw<{ n: number; hi: string | null }>(
      `SELECT count(DISTINCT report_date)::int n, max(report_date)::date::text hi
         FROM quarterly_results WHERE stock_id = $1`, st[0].id);
    const a = await raw<{ n: number; hi: string | null }>(
      `SELECT count(DISTINCT report_date)::int n, max(report_date)::date::text hi
         FROM fundamentals WHERE stock_id = $1`, st[0].id);
    const px = await raw<{ n: number; hi: string | null }>(
      `SELECT count(*)::int n, max(date)::date::text hi FROM daily_prices WHERE stock_id = $1`, st[0].id);
    const sh = await raw<{ n: number; hi: string | null }>(
      `SELECT count(*)::int n, max(as_on_date)::date::text hi FROM shareholding_patterns WHERE stock_id = $1`, st[0].id);

    const currentResults = q[0].hi === horizon;
    const hasPrices = (px[0].n ?? 0) > 0;
    const ok = currentResults && hasPrices;
    if (!ok) allOk = false;

    console.log(`  ${ok ? "OK  " : "BLOCK"} ${sym.padEnd(12)} is_active=${st[0].is_active}`);
    console.log(`         quarterly ${String(q[0].n).padStart(2)} periods, latest ${q[0].hi}  ${currentResults ? "= horizon ✓" : "⚠ BEHIND the horizon"}`);
    console.log(`         annual    ${String(a[0].n).padStart(2)} periods, latest ${a[0].hi}`);
    console.log(`         prices    ${String(px[0].n).padStart(5)} rows, latest ${px[0].hi}`);
    console.log(`         sharehold ${String(sh[0].n).padStart(5)} rows, latest ${sh[0].hi}` +
      `   ${sh[0].hi && sh[0].hi >= "2025-01-01" ? "" : "← stale; the scheduled BSE gapfill covers this ONCE ACTIVE"}`);
  }

  if (!allOk) {
    console.log(`\n  ⚠ REFUSING — at least one stock is not current on results. Reactivating it would`);
    console.log(`    put stale data into scoring, which is worse than leaving it out.\n`);
    await prisma.$disconnect();
    return;
  }
  console.log(`\n  all preconditions met: results current to the universe horizon, prices live.`);

  if (!APPLY) {
    console.log(`  check only — re-run with --apply to reactivate.\n`);
    await prisma.$disconnect();
    return;
  }
  const n = await prisma.$executeRawUnsafe(
    `UPDATE stocks SET is_active = true, updated_at = now() WHERE symbol = ANY($1::text[])`, SYMBOLS);
  console.log(`\n  reactivated ${n} stock(s).`);
  console.log(`  they now enter: results_scan (NSE, will find nothing) -> BSE fallback (will serve them),`);
  console.log(`  shareholding_smart_refresh -> fillShareholdingGapsFromBse, and every other gated lane.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
