// ═══════════════════════════════════════════════════════════════
// T4c — THE PILOT RE-INGEST. ⚠ THIS WRITES DATA (approved pilot, 27 stocks).
//   npx tsx src/scripts/_t4-run.ts
//
// Mirrors production pacing exactly: BATCH_SIZE=3, session reset every 3 batches,
// 1500ms inter-batch (backfill-legacy.ts:25-26,133-135).
// Gates before starting: zero running/pending jobs, and outside the forbidden
// windows (13:00-14:10 UTC, and the 21:30 UTC nightly prune).
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { nseClient } from "../lib/client.js";
import { backfillLegacySymbol } from "../ingestions/quaterly-results/legacy/backfill-legacy.js";
import { COHORT as FULL_COHORT, FROM_DATE, TO_DATE } from "./_t4-cohort-def.js";
// Resume support: T4_ONLY="SYM1,SYM2" restricts the run. The pass is idempotent
// (upserts on the basis-inclusive key), so a re-run of an already-done symbol is safe.
const ONLY = (process.env.T4_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const COHORT = ONLY.length ? FULL_COHORT.filter((c) => ONLY.includes(c.symbol)) : FULL_COHORT;

const OUT = `${process.env.T4_DIR ?? "."}/_t4-run.json`;
const BATCH_SIZE = 3;
const SESSION_RESET_EVERY_N = 3;
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

async function main() {
  // ── GATE 1: jobs quiesced, measured on the DB clock ──
  const [clock] = await raw<{ db_now: string; h: number; m: number }>(
    `SELECT now()::text AS db_now,
            date_part('hour', now() AT TIME ZONE 'UTC')::int AS h,
            date_part('minute', now() AT TIME ZONE 'UTC')::int AS m`);
  const live = await raw(
    `SELECT "id","type","status" FROM background_jobs WHERE "status" IN ('pending','running')`);
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4c — PILOT RE-INGEST · ${COHORT.length} stocks · ⚠ WRITES DATA                    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  DB clock: ${clock.db_now}   running/pending jobs: ${live.length}`);
  if (live.length > 0) {
    for (const j of live) console.log(`    ⚠ ${j.id} ${j.type} ${j.status}`);
    console.log(`  ✗ HOLD — jobs in flight. Not running.`);
    await prisma.$disconnect(); process.exit(2);
  }
  // ── GATE 2: forbidden windows ──
  const mins = Number(clock.h) * 60 + Number(clock.m);
  const inBlackout = mins >= 13 * 60 && mins <= 14 * 60 + 10;
  const nearNightly = mins >= 21 * 60 && mins <= 22 * 60;
  console.log(`  UTC ${lp(clock.h, 2)}:${String(clock.m).padStart(2, "0")} · blackout 13:00-14:10 → ${inBlackout ? "INSIDE ✗" : "outside ✓"} · nightly 21:30 → ${nearNightly ? "NEAR ✗" : "clear ✓"}`);
  if (inBlackout || nearNightly) { console.log(`  ✗ HOLD — forbidden window.`); await prisma.$disconnect(); process.exit(2); }
  console.log(`  ✓ gates clear`);
  console.log(`  window: fromDate=${FROM_DATE}  toDate=${TO_DATE}  ← toDate is the ONLY v3 protection (T3d)`);

  // ── RUN ──
  const t0 = Date.now();
  const batches: typeof COHORT[] = [];
  for (let i = 0; i < COHORT.length; i += BATCH_SIZE) batches.push(COHORT.slice(i, i + BATCH_SIZE));
  console.log(`  ${COHORT.length} symbols in ${batches.length} batches of ${BATCH_SIZE}\n`);

  nseClient.resetSession();
  const results: Record<string, unknown> = {};
  let totalFilings = 0, ingested = 0, refreshed = 0, skipped = 0, failed = 0;
  const allErrors: unknown[] = [];

  for (let b = 0; b < batches.length; b++) {
    if (b > 0 && b % SESSION_RESET_EVERY_N === 0) {
      console.log(`  [session reset after batch ${b}]`);
      nseClient.resetSession();
    }
    for (const entry of batches[b]) {
      const st = Date.now();
      try {
        const r = await backfillLegacySymbol(entry.symbol, { fromDate: FROM_DATE, toDate: TO_DATE });
        const ms = Date.now() - st;
        results[entry.symbol] = { ...r, ms };
        totalFilings += r.totalFilings; ingested += r.ingested; refreshed += r.refreshed;
        skipped += r.skipped; failed += r.failed; allErrors.push(...r.errors);
        console.log(`  ${pad(entry.symbol, 13)} filings=${lp(r.totalFilings, 4)} ingested=${lp(r.ingested, 4)} refreshed=${lp(r.refreshed, 4)} failed=${lp(r.failed, 3)} ${lp((ms / 1000).toFixed(1), 6)}s`);
      } catch (e) {
        failed++;
        results[entry.symbol] = { fatal: (e as Error).message };
        console.log(`  ${pad(entry.symbol, 13)} ✗ FATAL ${(e as Error).message}`);
      }
    }
    if (b + 1 < batches.length) await new Promise((r) => setTimeout(r, 1500));
  }

  const wall = (Date.now() - t0) / 1000;
  writeFileSync(OUT, JSON.stringify({ startedAt: new Date(t0).toISOString(), wallSeconds: wall, fromDate: FROM_DATE, toDate: TO_DATE, results, errors: allErrors }, null, 2));

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ RUN COMPLETE                                                              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  wall-clock: ${(wall / 60).toFixed(1)} min (${wall.toFixed(0)}s) · ${(wall / COHORT.length).toFixed(1)}s/stock`);
  console.log(`  filings processed: ${totalFilings}   ingested=${ingested} refreshed=${refreshed} skipped=${skipped} failed=${failed}`);
  console.log(`  listing calls: ${COHORT.length * 2} (2 legs x ${COHORT.length} stocks) · XBRL fetches ≈ ${totalFilings}`);
  if (allErrors.length) {
    console.log(`\n  ERRORS (${allErrors.length}):`);
    for (const e of allErrors.slice(0, 25)) console.log(`    ${JSON.stringify(e)}`);
    if (allErrors.length > 25) console.log(`    … ${allErrors.length - 25} more (see ${OUT})`);
  }
  console.log(`\n  → ${OUT}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
