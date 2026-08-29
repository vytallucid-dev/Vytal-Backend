// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 17 — QUARTERLY + ANNUAL RESULTS BACKFILL FOR THE NEWLY-SEEDED UNIVERSE.  ⚠ WRITES.
//
//   npx tsx src/scripts/stage17-results-backfill-new-universe.ts --dry-run
//   npx tsx src/scripts/stage17-results-backfill-new-universe.ts --limit 50
//   npx tsx src/scripts/stage17-results-backfill-new-universe.ts               # everything left
//   npx tsx src/scripts/stage17-results-backfill-new-universe.ts --retry-failed
//
// ── WHY PER-SYMBOL AND NOT THE RANGED PATH ───────────────────────────────────────────────────────
// The nightly cron uses ranged discovery, which filters on BROADCAST date — so an old filing only
// appears in the window it was originally broadcast in. A window can never serve history. Backfill
// is per-symbol by necessity, not by preference (scan.ts / results-scan.handler.ts say the same).
//
// ── RESUMABILITY IS A LEDGER ON DISK, NOT AN INFERENCE ───────────────────────────────────────────
// "Which stocks are done" cannot be read from the data: a company that filed nothing in the window
// is indistinguishable from one never attempted, and inferring from row-presence would retry the
// silent ones forever while a real campaign never converged. So every attempt is recorded in
// _s17-ledger.json with its outcome, written after EVERY symbol. Kill this at any point and re-run:
// it picks up exactly where it stopped, and a symbol is never fetched twice.
//
// ── industryType MISMATCHES ARE THE POINT, NOT A FAILURE ─────────────────────────────────────────
// Every new stock is seeded `non_financial`. A bank's filing therefore hits the taxonomy gate in
// scan.ts, gets SKIPPED, and logs `Industry mismatch (basis): stock=non_financial, xbrl=banking` to
// result_fetch_logs.error. That is exactly the harvest this campaign is meant to produce — the
// correction pass reads those rows, fixes industryType, and re-scans just those symbols. A mismatch
// here costs a deferred filing, never a wrong number in the wrong table.
//
// ── PACING ───────────────────────────────────────────────────────────────────────────────────────
// NSE is rate-limited and session-bound. The session is reset every SESSION_RESET_EVERY_N symbols,
// the same cadence results-scan.handler.ts uses for its per-symbol path, and there is a deliberate
// pause between symbols. This is a long campaign; it is meant to be survivable, not fast.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { scanSymbol } from "../ingestions/quaterly-results/scan.js";
import { nseClient } from "../lib/client.js";

const argv = process.argv;
const DRY = argv.includes("--dry-run");
const RETRY_FAILED = argv.includes("--retry-failed");
const num = (f: string, d: number): number => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d;
};
const LIMIT = num("--limit", 0);
const arg = (f: string, d: string): string => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
/** The agreed depth for the new universe: two years, from Jan 2024. */
const FROM_QE = new Date(`${arg("--from", "2024-01-01")}T00:00:00.000Z`);

/** ⚠ ONE LEDGER FILE PER WORKER, AND EVERY WORKER READS THEM ALL.
 *  Parallel workers sharing a single ledger would race on read-modify-write and silently drop
 *  entries — last writer wins, and the lost symbols look un-attempted forever. So each worker OWNS
 *  its own file and never writes another's, while the done-set is the UNION of every _s17-ledger*
 *  file on disk. That makes the split re-partitionable: change --slice counts between runs and no
 *  symbol is refetched, because "done" was never tied to which worker did it. */
const SLICE = arg("--slice", "");           // "i/n", e.g. "0/2"
const [SLICE_I, SLICE_N] = SLICE ? SLICE.split("/").map(Number) : [0, 1];
const LEDGER = arg("--ledger", SLICE ? `_s17-ledger.w${SLICE_I}.json` : "_s17-ledger.json");
const SESSION_RESET_EVERY_N = num("--reset", 3);
const PAUSE_MS = num("--pause", 400);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * ⚠ `rows` IS COUNTED FROM THE DATABASE, NOT FROM scanSymbol's RETURN. MEASURED on the first live
 * slice: `r.ingested` came back 0 for all 7 successful symbols while 14 quarterly + 4 annual rows
 * had genuinely landed for 20MICRONS, 63MOONS, A2ZINFRA and the rest — the counter does not see
 * writes that arrive via the BSE fallback lane, and `skipped` is inconsistent alongside it. A
 * progress ledger that under-reports to zero is worse than none: it would have read as a 24-hour
 * campaign achieving nothing, and the obvious response to that is to stop it.
 */
interface Entry { status: "ok" | "empty" | "failed"; at: string; rows: number; groups: number; error?: string }
type Ledger = Record<string, Entry>;

/** This worker's own entries — the only file it will write. */
const readLedger = (): Ledger => (fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) as Ledger : {});
/** Every worker's entries, for the done-set. */
function readAllLedgers(): Ledger {
  const merged: Ledger = {};
  for (const f of fs.readdirSync(".").filter((x) => /^_s17-ledger.*\.json$/.test(x)))
    Object.assign(merged, JSON.parse(fs.readFileSync(f, "utf8")) as Ledger);
  return merged;
}
const writeLedger = (l: Ledger): void => fs.writeFileSync(LEDGER, JSON.stringify(l, null, 1));

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`STAGE 17 — results backfill for the new universe  ${DRY ? "(dry-run)" : "*** LIVE ***"}`);
  console.log(`  from quarter-end >= ${FROM_QE.toISOString().slice(0, 10)}   ledger ${LEDGER}`);
  console.log("=".repeat(104));

  // The new cohort: seeded stocks, which are exactly the ones with no peer group AND no results yet.
  // Identified by created_at rather than by a list, so it stays true if the seed is ever extended.
  const cohort = await prisma.$queryRawUnsafe<Array<{ symbol: string }>>(
    `SELECT s.symbol FROM stocks s
      WHERE s.is_active = true AND s.created_at::date >= '2026-08-26'
      ORDER BY s.symbol`);

  const ledger = readLedger();
  const done = new Set(Object.entries(readAllLedgers())
    .filter(([, e]) => e.status !== "failed" || !RETRY_FAILED)
    .map(([k]) => k));

  // Deterministic round-robin partition: worker i takes every nth symbol. Interleaving beats
  // alphabetical ranges because filing-heavy names cluster by letter, so ranges finish unevenly.
  let todo = cohort.map((c) => c.symbol).filter((s) => !done.has(s))
    .filter((_, idx) => SLICE_N <= 1 || idx % SLICE_N === SLICE_I);
  if (LIMIT > 0) todo = todo.slice(0, Math.floor(LIMIT));

  const attempted = Object.keys(ledger).length;
  const failedSoFar = Object.values(ledger).filter((e) => e.status === "failed").length;
  console.log(`\n  cohort            ${String(cohort.length).padStart(5)}`);
  console.log(`  already attempted ${String(attempted).padStart(5)}   (failed ${failedSoFar}${RETRY_FAILED ? " — will retry" : ""})`);
  console.log(`  this run          ${String(todo.length).padStart(5)}${SLICE ? `   (worker ${SLICE_I + 1} of ${SLICE_N}, ledger ${LEDGER})` : ""}`);
  if (!todo.length) { console.log(`\n  nothing left to do.\n`); await prisma.$disconnect(); return; }
  console.log(`  pacing            session reset every ${SESSION_RESET_EVERY_N} symbols, ${PAUSE_MS}ms between\n`);

  if (DRY) {
    console.log(`  first 10: ${todo.slice(0, 10).join(", ")}`);
    console.log(`\n  dry-run — re-run without --dry-run to write.\n`);
    await prisma.$disconnect();
    return;
  }

  const t0 = Date.now();
  let ok = 0, empty = 0, failed = 0, ingested = 0;
  // one indexed count per symbol across the five quarterly + five annual tables
  const rowsFor = async (symbol: string): Promise<number> => (await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT (SELECT count(*) FROM quarterly_results q WHERE q.stock_id=s.id)
          + (SELECT count(*) FROM banking_quarterly_results q WHERE q.stock_id=s.id)
          + (SELECT count(*) FROM nbfc_quarterly_results q WHERE q.stock_id=s.id)
          + (SELECT count(*) FROM life_insurance_quarterly_results q WHERE q.stock_id=s.id)
          + (SELECT count(*) FROM general_insurance_quarterly_results q WHERE q.stock_id=s.id)
          + (SELECT count(*) FROM fundamentals f WHERE f.stock_id=s.id)
          + (SELECT count(*) FROM banking_fundamentals f WHERE f.stock_id=s.id)
          + (SELECT count(*) FROM nbfc_fundamentals f WHERE f.stock_id=s.id)
          + (SELECT count(*) FROM life_insurance_fundamentals f WHERE f.stock_id=s.id)
          + (SELECT count(*) FROM general_insurance_fundamentals f WHERE f.stock_id=s.id) AS n
       FROM stocks s WHERE s.symbol=$1`, symbol))[0]?.n ?? 0;
  for (let i = 0; i < todo.length; i++) {
    const symbol = todo[i];
    if (i % SESSION_RESET_EVERY_N === 0) nseClient.resetSession();
    let e: Entry;
    try {
      const r = await scanSymbol(symbol, { fromQeDate: FROM_QE });
      const rows = Number(await rowsFor(symbol));
      e = { status: rows > 0 ? "ok" : "empty", at: new Date().toISOString(), rows, groups: r.totalGroups };
      if (e.status === "ok") ok++; else empty++;
      ingested += rows;
    } catch (err) {
      e = { status: "failed", at: new Date().toISOString(), rows: 0, groups: 0, error: String(err).slice(0, 200) };
      failed++;
    }
    // Written after EVERY symbol — a kill between symbols must never cost more than the one in flight.
    ledger[symbol] = e;
    writeLedger(ledger);

    const n = i + 1;
    const elapsed = (Date.now() - t0) / 1000;
    const eta = Math.round((elapsed / n) * (todo.length - n) / 60);
    process.stdout.write(
      `\r  ${n}/${todo.length}  ok ${ok} · empty ${empty} · failed ${failed} · rows ${ingested}  ` +
      `${(elapsed / n).toFixed(1)}s/sym  ~${eta}min left      `);
    if (i < todo.length - 1) await sleep(PAUSE_MS);
  }

  console.log(`\n\n  ── DONE ──`);
  console.log(`  ok ${ok} · nothing-filed ${empty} · failed ${failed} · result rows now held by this cohort ${ingested}`);
  console.log(`  elapsed ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  const left = cohort.length - Object.keys(ledger).length;
  console.log(`\n  cohort remaining: ${left}  (re-run to continue)`);
  console.log(`  next: harvest "Industry mismatch" from result_fetch_logs to set industryType, then re-scan those.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
