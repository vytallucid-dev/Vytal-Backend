// ═══════════════════════════════════════════════════════════════
// T5.2 / T5.3 — CHUNKED, RESUMABLE LEGACY BACKFILL RUNNER. ⚠ WRITES DATA.
//   npx tsx src/scripts/_t5-run.ts [--symbols A,B] [--chunk 8] [--reset]
//
// T5.2a CHUNK SIZE — 8 symbols. At the measured 44.7 s/stock that is ~6.0 min,
//   which sits inside the 10-minute foreground cap that killed the first pilot
//   invocation, and it is a whole multiple of the production BATCH_SIZE=3? No —
//   8 is deliberately NOT a multiple of 3; batching is internal to a chunk and a
//   chunk boundary is always a symbol boundary (see T5.2c), so the two need not
//   align. 8 keeps a lost chunk under 6 minutes of re-fetch.
//
// T5.2b RESUMABILITY — a completed-symbol ledger on disk (JSON). A symbol is
//   recorded ONLY after backfillLegacySymbol returns, so a symbol interrupted
//   mid-flight is retried in full on restart rather than skipped. Restart with the
//   same command; --reset clears the ledger deliberately.
//
// T5.2c NO SPLIT SYMBOL — chunks are slices of the SYMBOL list, and the unit of
//   work is one whole backfillLegacySymbol call (which itself runs the quarterly
//   and annual legs). A chunk boundary therefore cannot fall inside a symbol.
//   RELIANCE was left half-done by the T4 kill precisely because there was no
//   ledger; the ledger closes that.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { nseClient } from "../lib/client.js";
import { backfillLegacySymbol } from "../ingestions/quaterly-results/legacy/backfill-legacy.js";
import { COHORT, FROM_DATE, TO_DATE } from "./_t4-cohort-def.js";

const DIR = process.env.T4_DIR ?? ".";
const LEDGER = `${DIR}/_t5-ledger.json`;
const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const CHUNK = Number(arg("--chunk") ?? 8);
const ONLY = (arg("--symbols") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const RESET = process.argv.includes("--reset");
const BATCH_SIZE = 3, SESSION_RESET_EVERY_N = 3;

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

interface Ledger { done: string[]; startedAt: string; runs: number }
const loadLedger = (): Ledger =>
  !RESET && existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { done: [], startedAt: new Date().toISOString(), runs: 0 };

async function main() {
  const ledger = loadLedger();
  ledger.runs++;
  const wanted = (ONLY.length ? COHORT.filter((c) => ONLY.includes(c.symbol)) : COHORT).map((c) => c.symbol);
  const todo = wanted.filter((s) => !ledger.done.includes(s));

  // ── GATES ──
  const [clk] = await raw<any>(
    `SELECT now()::text db_now, date_part('hour', now() AT TIME ZONE 'UTC')::int h, date_part('minute', now() AT TIME ZONE 'UTC')::int m`);
  const live = await raw<any>(`SELECT "id","type","status" FROM background_jobs WHERE "status" IN ('pending','running')`);
  const mins = Number(clk.h) * 60 + Number(clk.m);
  const blackout = mins >= 13 * 60 && mins <= 14 * 60 + 10;
  const nightly = mins >= 21 * 60 && mins <= 22 * 60;
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T5.3 — CHUNKED PILOT RE-RUN · ⚠ WRITES DATA                               ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  DB clock ${clk.db_now} · jobs running/pending ${live.length}`);
  console.log(`  UTC ${lp(clk.h, 2)}:${String(clk.m).padStart(2, "0")} · 13:00-14:10 ${blackout ? "INSIDE ✗" : "outside ✓"} · nightly 21:30 ${nightly ? "NEAR ✗" : "clear ✓"}`);
  if (live.length) { for (const j of live) console.log(`    ⚠ ${j.id} ${j.type} ${j.status}`); console.log(`  ✗ HOLD.`); await prisma.$disconnect(); process.exit(2); }
  if (blackout || nightly) { console.log(`  ✗ HOLD — forbidden window.`); await prisma.$disconnect(); process.exit(2); }
  console.log(`  ✓ gates clear · fromDate=${FROM_DATE} toDate=${TO_DATE} (toDate is the only v3 protection)`);
  console.log(`  ledger: ${ledger.done.length} symbol(s) already done · ${todo.length} to do · chunk=${CHUNK} · run #${ledger.runs}`);
  if (!todo.length) { console.log(`  nothing to do — all symbols already in the ledger.\n`); await prisma.$disconnect(); return; }

  const chunks: string[][] = [];
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));
  console.log(`  ${todo.length} symbols in ${chunks.length} chunk(s)\n`);

  const t0 = Date.now();
  let filings = 0, ingested = 0, failed = 0;
  const errors: unknown[] = [];

  for (const [ci, chunk] of chunks.entries()) {
    const ct = Date.now();
    console.log(`  ── chunk ${ci + 1}/${chunks.length}: ${chunk.join(" ")}`);
    nseClient.resetSession();
    let b = 0;
    for (let i = 0; i < chunk.length; i += BATCH_SIZE) {
      if (b > 0 && b % SESSION_RESET_EVERY_N === 0) nseClient.resetSession();
      for (const sym of chunk.slice(i, i + BATCH_SIZE)) {
        const st = Date.now();
        try {
          const r = await backfillLegacySymbol(sym, { fromDate: FROM_DATE, toDate: TO_DATE });
          filings += r.totalFilings; ingested += r.ingested; failed += r.failed; errors.push(...r.errors);
          // ⚠ recorded ONLY after the whole symbol returns — a symbol killed
          //   mid-flight is retried in full, never silently skipped.
          ledger.done.push(sym);
          writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
          console.log(`     ${pad(sym, 13)} filings=${lp(r.totalFilings, 4)} ingested=${lp(r.ingested, 4)} failed=${lp(r.failed, 3)} ${lp(((Date.now() - st) / 1000).toFixed(1), 6)}s`);
        } catch (e) {
          failed++; console.log(`     ${pad(sym, 13)} ✗ FATAL ${(e as Error).message} — NOT added to the ledger, will retry`);
        }
      }
      b++;
      if (i + BATCH_SIZE < chunk.length) await new Promise((r) => setTimeout(r, 1500));
    }
    console.log(`     chunk ${ci + 1} done in ${((Date.now() - ct) / 1000 / 60).toFixed(1)} min · ledger now ${ledger.done.length}/${wanted.length}\n`);
  }

  const wall = (Date.now() - t0) / 1000;
  console.log(`╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ RUN COMPLETE                                                              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  wall ${(wall / 60).toFixed(1)} min · ${(wall / todo.length).toFixed(1)}s/stock · filings ${filings} ingested ${ingested} failed ${failed}`);
  console.log(`  ledger: ${ledger.done.length}/${wanted.length} complete → ${LEDGER}`);
  if (errors.length) {
    const byKind = new Map<string, number>();
    for (const e of errors as any[]) {
      const k = /404/.test(String(e.error)) ? "NSE 404" : String(e.error).slice(0, 40) || "(empty message)";
      byKind.set(k, (byKind.get(k) ?? 0) + 1);
    }
    console.log(`  errors by kind: ${[...byKind.entries()].map(([k, v]) => `${k}×${v}`).join(" · ")}`);
  }
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
