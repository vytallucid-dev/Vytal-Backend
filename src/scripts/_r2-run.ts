// ═══════════════════════════════════════════════════════════════
// R2 — THE 442 RUN. ⚠ WRITES DATA (fundamentals, quarterly_results,
//      banking_fundamentals, banking_quarterly_results — and nothing else).
//   npx tsx src/scripts/_r2-run.ts [--chunk 8] [--reset] [--dry] [--max-chunks N]
//
// R2a  Chunks of 8, ledger-backed, resumable. A symbol enters the ledger ONLY
//      after backfillLegacySymbol returns, so an interrupted symbol is retried
//      whole rather than silently skipped.
// R2b  One progress line per chunk: chunk n/56, symbols done, elapsed, filings
//      processed / ingested / failed, cumulative failures.
// R2c  RETRY POLICY (stated, then enforced):
//        · a chunk that DIES → retried ONCE immediately, then recorded for a
//          second pass and the run moves on. Never retried indefinitely, never
//          abandons the run.
//        · an NSE 404 on a document → expected (12-22 per pilot run); logged,
//          counted, and the run continues.
//        · ⚠ SUSTAINED FAILURE ≠ scattered 404s. The run STOPS if
//            - failures exceed 25% of attempted filings within a chunk, or
//            - three consecutive chunks fail.
//          That is the signature of NSE throttling or a dead session.
// R2d  Spacing constants are the PRODUCTION ones, unchanged: BATCH_SIZE=3,
//      SESSION_RESET_EVERY_N=3, 1500 ms between batches. Concurrency is NOT
//      raised to save time.
// R2e  HOLD WINDOWS — the run pauses at a CHUNK BOUNDARY and waits:
//        · 13:00-14:10 UTC  the stated blackout (weekday EOD block)
//        · 15:50-16:40 UTC  ⚠ the 16:00 results-scan tick. results_scan is a
//          RESCORE TRIGGER SOURCE (a case arm in maybeEnqueueRescoresForJob) and
//          it also crawls NSE. Running through it risks both an enqueued rescore
//          and mutual rate-limiting.
//        · 17:55-22:15 UTC  the nightly chain (18:00 sweep … 21:30 prune … 22:00
//          health check).
//
// ⚠ FENCE CHECK AFTER EVERY CHUNK. The upsert key is
//   (stockId, fiscalYear, quarter, resultType) — report_date is NOT in it — so
//   toDate protects v3 rows only if no legacy filing derives an occupied key.
//   R1h/R1j argue it cannot and the pilot measured it holding, but the cost of
//   being wrong is the whole v3 era. So every chunk re-checks its own symbols'
//   v3 rows against the R1d baseline and HALTS on the first byte of movement.
//   This bounds worst-case damage to one chunk instead of 442 stocks.
//
// ⚠ NO SCORING. This script calls backfillLegacySymbol directly. It never goes
//   through jobs/worker.ts, so maybeEnqueueRescoresForJob is never reached; and
//   LEGACY_BACKFILL is not one of its case arms anyway. Nothing here enqueues.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { nseClient } from "../lib/client.js";
import { backfillLegacySymbol } from "../ingestions/quaterly-results/legacy/backfill-legacy.js";
import { loadCohort, FROM_DATE, TO_DATE } from "./_r1-cohort-def.js";

const DIR = process.env.R1_DIR ?? ".";
const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };

// ── F1 (Stage 4f) — OPTIONAL SCOPING, ADDITIVE. Defaults are byte-identical to R2. ──
//   --only <path|SYM,SYM>  restrict the run to a named subset (F1's 49 C1 stocks).
//   --ledger <name>        use a separate ledger/log, so a scoped run cannot write
//                          into the 442-run's ledger and make it look partly done.
// Both absent ⇒ the whole cohort and the original _r2-ledger.json, unchanged.
const ONLY = arg("--only");
const TAG = arg("--ledger") ?? "_r2";
const LEDGER = `${DIR}/${TAG}-ledger.json`;
const LOG = `${DIR}/${TAG}-progress.log`;
const V3_BASE = `${DIR}/_r1d-v3-before.json`;

const CHUNK = Number(arg("--chunk") ?? 8);
const MAX_CHUNKS = Number(arg("--max-chunks") ?? Infinity);
const RESET = process.argv.includes("--reset");
const DRY = process.argv.includes("--dry");

// ⚠ PRODUCTION SPACING — do not raise (R2d).
const BATCH_SIZE = 3, SESSION_RESET_EVERY_N = 3, BATCH_PAUSE_MS = 1500;
// R2c thresholds
const CHUNK_FAIL_RATE = 0.25, MAX_CONSECUTIVE_FAILED_CHUNKS = 3;

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

// ── ⚠ THE FAILURE MIX. The protection that was dropped was exactly the
//    anti-throttle one, so WHAT the failures are now matters more than how many.
//    A 5% rate that is all timeouts is worse news than 15% that is all 404s:
//    a 404 is NSE declining to serve one document; a timeout / 403 / 429 /
//    session-reset is NSE declining to serve US.
type FailKind = "404" | "timeout" | "403/429" | "session" | "overflow" | "parser" | "other";
function classify(msg: string): FailKind {
  const m = String(msg);
  if (/\b404\b|not found/i.test(m)) return "404";
  if (/\b(403|429)\b|forbidden|too many requests|rate.?limit/i.test(m)) return "403/429";
  if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|EAI_AGAIN|network/i.test(m)) return "timeout";
  if (/\b401\b|unauthor|cookie|session|captcha|akamai|access denied/i.test(m)) return "session";
  if (/numeric field overflow|out of range for the type/i.test(m)) return "overflow";
  if (/Missing required date tags|Failed to extract|Invalid period|parse/i.test(m)) return "parser";
  return "other";
}
/** timeouts, 403/429s and session resets are the throttle shape; 404s and
 *  parser/overflow errors are normal attrition and say nothing about NSE's mood. */
const THROTTLE_KINDS = new Set<FailKind>(["timeout", "403/429", "session"]);
const mixLine = (counts: Map<FailKind, number>) => {
  const parts = [...counts.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`);
  return parts.length ? parts.join(" ") : "none";
};
// STOP thresholds for the throttle signature (distinct from the 25% volume rule)
const THROTTLE_CHUNK_STOP = 5;      // >=5 throttle-shaped failures in ONE chunk
const THROTTLE_STREAK_STOP = 3;     // >=3 in each of two consecutive chunks

function say(line: string) {
  console.log(line);
  try { appendFileSync(LOG, line + "\n"); } catch { /* logging must never kill the run */ }
}

// ── ⚠ AMAN'S RULING — PRIORITY INVERTED. The 442 backfill no longer yields to
//    crons. The 13:00-14:10 blackout, the 15:50-16:40 results-scan hold and the
//    14:30 filing_rolling_daily gate are ALL DROPPED. The run goes straight
//    through whatever fires. Accepted consequence: it competes with the 16:00
//    results-scan for NSE, and on-demand jobs can appear at any time.
const HOLDS: Array<[number, number, string]> = [];
const holdFor = (mins: number) => HOLDS.find(([a, b]) => mins >= a && mins <= b);

// ── THE ONE EXCEPTION THAT STANDS. RETENTION_PRUNE fires at 21:30 UTC and is
//    DESTRUCTIVE; a bulk backfill running concurrently with a nightly delete pass
//    is the single overlap not worth taking. At a chunk boundary at or past this
//    minute the run exits CLEANLY, ledger intact. A chunk takes ~5 min, so 21:10
//    guarantees the last one lands well before the prune.
const STOP_FOR_DAY_UTC = 21 * 60 + 10; // 21:10 UTC — 20 min of headroom before the prune

interface Ledger {
  done: string[];
  /** chunks that needed a retry — reported at R5b. */
  retried: number[];
  /** symbols a chunk-level retry still could not complete — the second-pass list. */
  secondPass: string[];
  startedAt: string;
  runs: number;
  /** cumulative counters, so a resumed run reports totals for the WHOLE run. */
  filings: number; ingested: number; failed: number;
  errors: Array<{ symbol: string; filing: string; error: string }>;
  /** ⚠ Any scoring job observed while this run was in flight. My run cannot create
   *  one (proved four ways at R1) — so anything here is the 16:00 results-scan
   *  cron, and R5d must report it SEPARATELY from the run. */
  rescoreWatch: Array<{ at: string; id: string; type: string; status: string; triggeredBy: string; createdAt: string }>;
  /** the run's own start instant, so the watch window has a floor. */
  watchFrom: string;
}
const blank = (): Ledger => ({ done: [], retried: [], secondPass: [], startedAt: new Date().toISOString(), runs: 0, filings: 0, ingested: 0, failed: 0, errors: [], rescoreWatch: [], watchFrom: new Date().toISOString() });
const loadLedger = (): Ledger => (!RESET && existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : blank());
const saveLedger = (l: Ledger) => writeFileSync(LEDGER, JSON.stringify(l, null, 2));

// ── the fence baseline, keyed by symbol ──
interface V3Row { t: string; sym: string; period: string; basis: string; rd: string; src: string; ua: string; id: string }
function loadFence(): Map<string, V3Row[]> {
  if (!existsSync(V3_BASE)) throw new Error(`fence baseline missing: ${V3_BASE} — run _r1cd-snapshot.ts before first`);
  const j = JSON.parse(readFileSync(V3_BASE, "utf8"));
  const m = new Map<string, V3Row[]>();
  for (const r of j.rows as V3Row[]) { if (!m.has(r.sym)) m.set(r.sym, []); m.get(r.sym)!.push(r); }
  return m;
}

/** Re-read the v3 rows for these symbols and compare against the baseline.
 *
 *  ⚠ THE CRITERION, REFINED — and refined for a stated reason. The first cut
 *  treated ANY updated_at movement as a breach. That was right while the run was
 *  expected to hold for every cron. Aman INVERTED THE PRIORITY: the backfill now
 *  runs through whatever fires, so results_scan keeps refreshing current-quarter
 *  v3 rows while we work. Measured: it moved 85 rows at 16:00-16:01 UTC, every one
 *  keeping its v3 source. Under the old criterion that is a "breach" caused by a
 *  cron the operator explicitly authorised — a false halt.
 *
 *  What still isolates THE BACKFILL exactly is the SOURCE: the legacy path stamps
 *  nse_xbrl_*_legacy on every row it writes, unconditionally. So:
 *    BREACH      — row vanished · source changed · report_date changed
 *    OBSERVATION — updated_at moved with the v3 source intact (the pipeline)
 */
async function fenceCheck(symbols: string[], fence: Map<string, V3Row[]>): Promise<{ breaches: string[]; observed: number }> {
  const want = symbols.flatMap((s) => fence.get(s) ?? []);
  if (!want.length) return { breaches: [], observed: 0 };
  const ids = [...new Set(want.map((r) => r.id))];
  const breaches: string[] = [];
  let observed = 0;
  const now = new Map<string, { src: string; ua: string; rd: string }>();
  for (const t of ["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"]) {
    const rows = await raw<any>(
      `SELECT "id","source" src,"updated_at"::text ua,"report_date"::text rd FROM "${t}" WHERE "id" = ANY($1::text[])`, ids);
    for (const r of rows) now.set(r.id, { src: r.src, ua: r.ua, rd: r.rd });
  }
  for (const b of want) {
    const cur = now.get(b.id);
    const label = `${b.sym} ${b.t} ${b.period} ${b.basis}`;
    if (!cur) { breaches.push(`${label} — ROW VANISHED`); continue; }
    if (cur.src !== b.src) { breaches.push(`${label} — SOURCE ${b.src} → ${cur.src}`); continue; }
    if (String(cur.rd).slice(0, 10) !== String(b.rd).slice(0, 10)) { breaches.push(`${label} — REPORT_DATE ${b.rd} → ${cur.rd}`); continue; }
    if (cur.ua !== b.ua) observed++;   // pipeline refresh, not us — counted, not fatal
  }
  return { breaches, observed };
}

async function dbMins(): Promise<number> {
  const [c] = await raw<any>(`SELECT date_part('hour', now() AT TIME ZONE 'UTC')::int h, date_part('minute', now() AT TIME ZONE 'UTC')::int m`);
  return Number(c.h) * 60 + Number(c.m);
}
async function liveJobs(): Promise<any[]> {
  return raw<any>(`SELECT "id","type","status" FROM background_jobs WHERE "status" IN ('pending','running')`);
}

/** ⚠ Did ANY scoring job appear since this run began? My run structurally cannot
 *  create one, so a hit here is the cron — recorded, reported, never attributed
 *  to the backfill. Cheap enough to run at every chunk boundary. */
async function watchRescores(ledger: Ledger): Promise<number> {
  // ⚠ The watcher is OBSERVABILITY, not the job. A failure here must never kill a
  //   multi-hour data run — it is reported and the run continues.
  let rows: any[];
  try {
    rows = await raw<any>(
      `SELECT "id","type","status","triggeredBy" tb, "created_at"::text ca
         FROM background_jobs
        WHERE "created_at" >= $1::timestamptz
          AND ("type" ILIKE '%rescore%' OR "type" ILIKE '%scor%')
        ORDER BY "created_at"`, ledger.watchFrom);
  } catch (e) {
    say(`  ⚠ rescore-watch query failed (${(e as Error).message.slice(0, 90)}) — run continues, watch degraded`);
    return 0;
  }
  let added = 0;
  for (const r of rows) {
    if (ledger.rescoreWatch.some((w) => w.id === r.id)) continue;
    ledger.rescoreWatch.push({ at: new Date().toISOString(), id: r.id, type: r.type, status: r.status, triggeredBy: r.tb, createdAt: r.ca });
    added++;
    say(`  ⚠⚠ SCORING JOB OBSERVED — id=${r.id} type=${r.type} status=${r.status} triggeredBy=${r.tb} createdAt=${r.ca}`);
    say(`      This run cannot enqueue one (R1, four independent proofs). Attributing to the cron.`);
  }
  return added;
}

async function main() {
  const ledger = loadLedger();
  ledger.runs++;
  const cohort = await loadCohort();
  let all = cohort.map((c) => c.symbol);
  if (ONLY) {
    // A subset must be a SUBSET — a name that is not in the cohort is a typo or a
    // stale list, and silently dropping it would under-run without saying so.
    const wanted = ONLY.includes(",") || !existsSync(ONLY)
      ? ONLY.split(",").map((s) => s.trim()).filter(Boolean)
      : (JSON.parse(readFileSync(ONLY, "utf8")) as any).clean?.map((c: any) => c.sym)
        ?? (JSON.parse(readFileSync(ONLY, "utf8")) as string[]);
    const inCohort = new Set(all);
    const missing = wanted.filter((s: string) => !inCohort.has(s));
    if (missing.length) throw new Error(`--only names ${missing.length} symbol(s) not in the cohort: ${missing.join(", ")}`);
    all = all.filter((s) => wanted.includes(s));
    console.log(`  ⚠ --only: run SCOPED to ${all.length} of ${cohort.length} cohort symbols (ledger ${LEDGER})`);
  }
  const fence = loadFence();

  const t0 = Date.now();
  say(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  say(`║ R2 — THE 442 RUN · ⚠ WRITES DATA · run #${pad(ledger.runs, 3)}                             ║`);
  say(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  say(`  started (local) ${new Date().toISOString()}`);
  say(`  window: fromDate=${FROM_DATE}  toDate=${TO_DATE}   ⚠ toDate is the only v3 protection`);
  say(`  spacing: BATCH_SIZE=${BATCH_SIZE} · SESSION_RESET_EVERY_N=${SESSION_RESET_EVERY_N} · ${BATCH_PAUSE_MS}ms between batches (production values, unchanged)`);
  say(`  fence baseline: ${fence.size} symbols carry v3-era rows · ${[...fence.values()].reduce((a, b) => a + b.length, 0)} rows watched`);
  if (DRY) say(`  ⚠ --dry: gates and chunk plan only, NO WRITES`);

  const todo = all.filter((s) => !ledger.done.includes(s));
  const chunks: string[][] = [];
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));
  const totalChunks = Math.ceil(all.length / CHUNK);
  say(`  cohort ${all.length} · already done ${ledger.done.length} · to do ${todo.length} in ${chunks.length} chunk(s) of ${CHUNK} (of ${totalChunks} for the full cohort)`);

  // ── initial gate ──
  // ⚠ startup gate is OBSERVE-ONLY now (priority inverted): a live job is logged,
  //   not treated as a reason to hold.
  const jobs0 = await liveJobs();
  if (jobs0.length) { say(`  ◇ jobs running alongside at start (NOT blocking):`); for (const j of jobs0) say(`      ${j.id} ${j.type} ${j.status}`); }
  else say(`  ✓ background_jobs running/pending = 0 at start`);
  say(`  ⚠ holds DROPPED (13:00-14:10 · 15:50-16:40 · job gate). Only stop-for-day at ${hhmm(STOP_FOR_DAY_UTC)} UTC stands (RETENTION_PRUNE 21:30 is destructive).`);
  say(`  ⚠ throttle watch ARMED: stop at >=${THROTTLE_CHUNK_STOP} throttle-shaped failures in one chunk, or >=${THROTTLE_STREAK_STOP} in two consecutive.`);
  if (!todo.length) { say(`  nothing to do — every symbol is in the ledger.\n`); await prisma.$disconnect(); return; }
  if (DRY) { say(`\n  chunk plan (first 3): ${chunks.slice(0, 3).map((c, i) => `[${i + 1}] ${c.join(" ")}`).join("  ")}\n`); await prisma.$disconnect(); return; }

  let consecutiveFailedChunks = 0;
  let processedChunks = 0;
  let prevThrottle = 0;
  let fenceSeen = 0;   // pipeline refreshes of v3 rows observed during the run (NOT breaches)

  for (const [ci, chunk] of chunks.entries()) {
    if (processedChunks >= MAX_CHUNKS) { say(`\n  --max-chunks ${MAX_CHUNKS} reached — stopping cleanly. Ledger holds ${ledger.done.length}.`); break; }

    // ── R2e — hold at the CHUNK BOUNDARY, never mid-symbol ──
    let stopForDay = false;
    for (;;) {
      const mins = await dbMins();
      // ruling 4 — the nightly chain is a STOP, not a pause
      if (mins >= STOP_FOR_DAY_UTC && mins < 23 * 60 + 30) {
        say(`\n  ⏹ STOP FOR THE DAY — now ${hhmm(mins)} UTC is at/past the ${hhmm(STOP_FOR_DAY_UTC)} nightly boundary.`);
        say(`    The 18:00 sweep → 21:30 prune → 22:00 health chain must not run concurrently with this.`);
        say(`    Stopping at a clean chunk boundary. Ledger holds ${ledger.done.length}/${all.length}; resume in a later session.`);
        stopForDay = true; break;
      }
      const h = holdFor(mins);
      if (!h) break;
      const waitMin = h[1] - mins + 1;
      say(`  ⏸ HOLD at chunk boundary — now ${hhmm(mins)} UTC is inside ${h[2]}. Sleeping ${waitMin} min, resuming after.`);
      // poll in 5-min slices so a scoring job that appears DURING the hold is
      // seen and logged at the time it happens, not retro-fitted afterwards
      for (let left = waitMin; left > 0; left -= 5) {
        await new Promise((r) => setTimeout(r, Math.min(5, left) * 60_000));
        await watchRescores(ledger); saveLedger(ledger);
      }
    }
    if (stopForDay) { saveLedger(ledger); break; }
    // ── ⚠ JOB GATE DROPPED (Aman's ruling). Concurrent jobs no longer block the
    //    run. They are still OBSERVED and logged, because R5d must be able to say
    //    what was running alongside the backfill — but nothing waits on them.
    {
      const live = await liveJobs();
      if (live.length) say(`  ◇ running alongside (NOT blocking): ${live.map((j: any) => `${j.type}/${j.status}`).join(", ")}`);
    }

    const attempt = async (syms: string[]) => {
      let filings = 0, ingested = 0, failed = 0; const errs: any[] = [];
      nseClient.resetSession();
      let b = 0;
      for (let i = 0; i < syms.length; i += BATCH_SIZE) {
        if (b > 0 && b % SESSION_RESET_EVERY_N === 0) nseClient.resetSession();
        for (const sym of syms.slice(i, i + BATCH_SIZE)) {
          if (ledger.done.includes(sym)) continue;
          const st = Date.now();
          try {
            const r = await backfillLegacySymbol(sym, { fromDate: FROM_DATE, toDate: TO_DATE });
            filings += r.totalFilings; ingested += r.ingested; failed += r.failed; errs.push(...r.errors);
            // ⚠ recorded ONLY after the whole symbol returns (R2a)
            ledger.done.push(sym);
            ledger.filings += r.totalFilings; ledger.ingested += r.ingested; ledger.failed += r.failed;
            ledger.errors.push(...r.errors);
            saveLedger(ledger);
            say(`     ${pad(sym, 14)} filings=${lp(r.totalFilings, 4)} ingested=${lp(r.ingested, 4)} failed=${lp(r.failed, 3)} ${lp(((Date.now() - st) / 1000).toFixed(1), 6)}s`);
          } catch (e) {
            failed++; ledger.failed++;
            errs.push({ symbol: sym, filing: "SYMBOL_FATAL", error: (e as Error).message });
            say(`     ${pad(sym, 14)} ✗ FATAL ${(e as Error).message} — NOT ledgered, will retry`);
          }
        }
        b++;
        if (i + BATCH_SIZE < syms.length) await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
      }
      return { filings, ingested, failed, errs };
    };

    const ct = Date.now();
    say(`\n  ── chunk ${ci + 1}/${chunks.length}: ${chunk.join(" ")}`);
    let res = await attempt(chunk);
    let attempted = res.ingested + res.failed;
    let rate = attempted ? res.failed / attempted : 0;
    let chunkFailed = rate > CHUNK_FAIL_RATE || chunk.some((s) => !ledger.done.includes(s));

    // ── R2c — retry the chunk ONCE, then move on ──
    if (chunkFailed) {
      say(`     ⚠ chunk ${ci + 1} FAILED (failure rate ${(rate * 100).toFixed(0)}%, ${chunk.filter((s) => !ledger.done.includes(s)).length} symbol(s) incomplete) — retrying ONCE`);
      ledger.retried.push(ci + 1); saveLedger(ledger);
      await new Promise((r) => setTimeout(r, 5000));
      const res2 = await attempt(chunk.filter((s) => !ledger.done.includes(s)));
      res = { filings: res.filings + res2.filings, ingested: res.ingested + res2.ingested, failed: res.failed + res2.failed, errs: [...res.errs, ...res2.errs] };
      attempted = res.ingested + res.failed;
      rate = attempted ? res.failed / attempted : 0;
      const stillMissing = chunk.filter((s) => !ledger.done.includes(s));
      chunkFailed = rate > CHUNK_FAIL_RATE || stillMissing.length > 0;
      if (stillMissing.length) {
        for (const s of stillMissing) if (!ledger.secondPass.includes(s)) ledger.secondPass.push(s);
        saveLedger(ledger);
        say(`     ⚠ after retry, ${stillMissing.length} symbol(s) still incomplete → second-pass list: ${stillMissing.join(" ")}`);
      }
    }

    // ── FENCE CHECK — every chunk, no exceptions ──
    const { breaches, observed: fenceObserved } = await fenceCheck(chunk, fence);
    if (fenceObserved) fenceSeen += fenceObserved;
    if (breaches.length) {
      say(`\n  ✗✗✗ FENCE BREACH — HALTING THE RUN IMMEDIATELY ✗✗✗`);
      for (const b of breaches.slice(0, 40)) say(`      ${b}`);
      say(`      ${breaches.length} breach(es) after chunk ${ci + 1}. Ledger holds ${ledger.done.length} symbols.`);
      saveLedger(ledger);
      await prisma.$disconnect(); process.exit(9);
    }

    // ── scoring watch, every chunk ──
    await watchRescores(ledger);

    // ── R2b — the progress line, WITH THE FAILURE MIX ──
    processedChunks++;
    const el = (Date.now() - t0) / 1000;
    const chunkMin = (Date.now() - ct) / 1000 / 60;
    const nowMins = await dbMins();
    const counts = new Map<FailKind, number>();
    for (const e of res.errs as any[]) { const k = classify(e.error); counts.set(k, (counts.get(k) ?? 0) + 1); }
    const throttle = [...counts.entries()].filter(([k]) => THROTTLE_KINDS.has(k)).reduce((s, [, n]) => s + n, 0);
    say(`     chunk ${lp(ci + 1, 2)}/${chunks.length} · done ${lp(ledger.done.length, 3)}/${all.length} · chunk ${chunkMin.toFixed(1)}min · elapsed ${(el / 60).toFixed(1)}min · ` +
        `filings ${lp(res.filings, 4)} ingested ${lp(res.ingested, 4)} failed ${lp(res.failed, 3)} (${(rate * 100).toFixed(0)}%) · cumulative ${ledger.failed} · fence ✓${fenceSeen ? ` (${fenceSeen} pipeline refresh${fenceSeen===1?"":"es"} observed)` : ""} · ${hhmm(nowMins)} UTC`);
    say(`       MIX: ${mixLine(counts)}${throttle > 0 ? `   ⚠ throttle-shaped: ${throttle}` : "   (no throttle signature)"}`);

    // ── ⚠ THROTTLE-SIGNATURE STOP — separate from the 25% volume rule ──
    if (throttle >= THROTTLE_CHUNK_STOP) {
      say(`\n  ✗ STOP — ${throttle} throttle-shaped failure(s) in one chunk (>= ${THROTTLE_CHUNK_STOP}).`);
      say(`    timeouts / 403 / 429 / session resets are NSE declining to serve US, not declining one document.`);
      say(`    Ledger holds ${ledger.done.length}/${all.length}. Re-run to resume after backing off.`);
      saveLedger(ledger); await prisma.$disconnect(); process.exit(7);
    }
    if (throttle >= THROTTLE_STREAK_STOP && prevThrottle >= THROTTLE_STREAK_STOP) {
      say(`\n  ✗ STOP — throttle-shaped failures >= ${THROTTLE_STREAK_STOP} in two consecutive chunks (${prevThrottle} then ${throttle}).`);
      say(`    Ledger holds ${ledger.done.length}/${all.length}. Re-run to resume after backing off.`);
      saveLedger(ledger); await prisma.$disconnect(); process.exit(7);
    }
    prevThrottle = throttle;

    // ── R2c — abort on a SUSTAINED pattern ──
    if (chunkFailed) {
      consecutiveFailedChunks++;
      if (consecutiveFailedChunks >= MAX_CONSECUTIVE_FAILED_CHUNKS) {
        say(`\n  ✗ STOP — ${consecutiveFailedChunks} consecutive chunks failed. That is the signature of NSE`);
        say(`    throttling or a session problem, not scattered 404s. Ledger holds ${ledger.done.length}/${all.length}.`);
        saveLedger(ledger); await prisma.$disconnect(); process.exit(8);
      }
    } else consecutiveFailedChunks = 0;

    if (rate > CHUNK_FAIL_RATE) {
      say(`\n  ✗ STOP — chunk failure rate ${(rate * 100).toFixed(0)}% exceeds the ${CHUNK_FAIL_RATE * 100}% ceiling even after retry.`);
      saveLedger(ledger); await prisma.$disconnect(); process.exit(8);
    }
  }

  const wall = (Date.now() - t0) / 1000;
  say(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  say(`║ RUN SEGMENT COMPLETE                                                      ║`);
  say(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  say(`  wall ${(wall / 60).toFixed(1)} min · ledger ${ledger.done.length}/${all.length}`);
  say(`  cumulative: filings ${ledger.filings} · ingested ${ledger.ingested} · failed ${ledger.failed}`);
  say(`  chunks retried: ${ledger.retried.length ? ledger.retried.join(", ") : "none"}`);
  say(`  second-pass list: ${ledger.secondPass.length ? ledger.secondPass.join(" ") : "empty"}`);
  await watchRescores(ledger);
  say(`  ⚠ scoring jobs observed while this run was in flight: ${ledger.rescoreWatch.length === 0 ? "✓ NONE" : "⚠ " + ledger.rescoreWatch.length + " (cron-attributed — see R5d)"}`);
  for (const w of ledger.rescoreWatch) say(`      ${w.id} ${w.type} ${w.status} by=${w.triggeredBy} at=${w.createdAt}`);
  if (ledger.errors.length) {
    const byKind = new Map<FailKind, number>();
    for (const e of ledger.errors) { const k = classify(e.error); byKind.set(k, (byKind.get(k) ?? 0) + 1); }
    say(`  CUMULATIVE FAILURE MIX: ${mixLine(byKind)}`);
    const thr = [...byKind.entries()].filter(([k]) => THROTTLE_KINDS.has(k)).reduce((s, [, n]) => s + n, 0);
    say(`  throttle-shaped total: ${thr} of ${ledger.errors.length} (${((100 * thr) / Math.max(1, ledger.errors.length)).toFixed(1)}%)` +
        `${thr === 0 ? "   ✓ no throttle signature across the whole run" : ""}`);
  }
  saveLedger(ledger);
  say(`  → ${LEDGER}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { say(`FATAL ${(e as Error).message}`); console.error(e); await prisma.$disconnect(); process.exit(1); });
