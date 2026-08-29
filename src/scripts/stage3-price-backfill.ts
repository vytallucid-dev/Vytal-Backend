// ═══════════════════════════════════════════════════════════════
// STAGE 3 — daily_prices back to 2019-01-01.
//
//   PREVIEW:  npx tsx src/scripts/stage3-price-backfill.ts
//   EXECUTE:  npx tsx src/scripts/stage3-price-backfill.ts --confirm
//   OPTIONS:  --symbols A,B,C   --limit N   --concurrency N (default 4)
//
// ⚠️ THE PLAN'S PREMISE WAS WRONG, AND THE CORRECTED SIZE IS THE REASON THIS
//    SCRIPT EXISTS. It says "only 6 stocks have a price gap at 2019". Measured:
//    ZERO of 501 active stocks reach 2019-01-01, and 372 of them bottom out on
//    exactly 2019-08-01 with an identical 1,745 bars — a FETCH boundary from an
//    earlier `--years 7` run, not per-stock listing dates. The real gap is about
//    seven months (~145 sessions) across ~372 stocks.
//
// ⚠️ DELIBERATELY NOT backfillStock(). That helper calls updateSnapshot(), which
//    upserts the LIVE stock_price row — price, prevClose, dayChangePct, 52-week
//    range, 1m/3m/6m/1y returns, sparkline, and provider — from Yahoo. That is
//    right for a "refresh this stock" run and wrong for extending history
//    backwards: it would replace the live price surface (maintained by the
//    bhavcopy pipeline) for every stock touched. This script reuses only the
//    fetch and the insert.
//
// SAFETY
//   · createMany skipDuplicates — an existing bar is NEVER overwritten, so the
//     bhavcopy-sourced rows and the existing Yahoo rows are untouched.
//   · Only bars strictly OLDER than the stock's current earliest are inserted;
//     the recent history is left exactly as it is.
//   · Retention: at keep=2000 a full 2019-01-01 history is ~1,890 bars, so the
//     nightly prune will not eat the tail. Stage 0 raised keep for precisely this.
//     The projected post-backfill depth is asserted before any write.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { fetchYahooHistory, insertDailyPrices, toYahooTicker } from "./yahoo-price-backfill.js";

const TARGET = "2019-01-01";
/** Enough to clear 2019-01-01 from today with margin; Yahoo clamps to listing anyway. */
const YEARS_BACK = 8;
const LEDGER = "_s3-price-ledger.jsonl";
const LOCK = "_s3-price.lock";
const PER_STOCK_TIMEOUT_MS = 90_000; // the plan's guard
const REPORT_EVERY_MS = 5 * 60 * 1000;

const argVal = (f: string): string | null => {
  const i = process.argv.indexOf(f);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const CONFIRM = process.argv.includes("--confirm");
const SYMBOLS = argVal("--symbols")?.split(",").map((s) => s.trim().toUpperCase());
const LIMIT = Number(argVal("--limit") ?? 0);
const CONCURRENCY = Number(argVal("--concurrency") ?? 4);

interface Entry {
  symbol: string; status: "filled" | "nothing_older" | "no_data" | "failed" | "would_fill";
  fetched: number; older: number; inserted: number;
  earliestBefore: string | null; earliestAfter: string | null; error?: string;
}

const readLedger = (): Entry[] => {
  if (!existsSync(LEDGER)) return [];
  const out: Entry[] = [];
  for (const l of readFileSync(LEDGER, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l) as Entry); } catch { /* torn line */ }
  }
  return out;
};
const write = (e: Entry): void => { appendFileSync(LEDGER, `${JSON.stringify(e)}\n`); };

function acquireLock(): void {
  if (existsSync(LOCK)) {
    console.error(`\nREFUSING TO START — ${LOCK} exists (${readFileSync(LOCK, "utf8").trim()}).\n`);
    process.exit(1);
  }
  writeFileSync(LOCK, `pid=${process.pid} started=${new Date().toISOString()}\n`);
  const rel = (): void => { try { if (existsSync(LOCK)) unlinkSync(LOCK); } catch { /* best effort */ } };
  process.on("exit", rel);
  process.on("SIGINT", () => { rel(); process.exit(130); });
  process.on("SIGTERM", () => { rel(); process.exit(143); });
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms))]);

async function main(): Promise<void> {
  acquireLock();

  const [pol] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT keep, floor, armed FROM retention_policy WHERE table_name = 'daily_prices'`,
  );
  const keep = Number(pol?.keep ?? 0);

  const stocks = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.id, s.symbol, min(d.date)::text mn, count(d.*)::int bars
     FROM stocks s LEFT JOIN daily_prices d ON d.stock_id = s.id
     WHERE s.is_active = true GROUP BY s.id, s.symbol ORDER BY s.symbol`,
  );
  // A PREVIEW entry ("would_fill") is not a completed unit of work — treating it
  // as one would make --confirm skip everything the preview just planned. Only
  // genuinely terminal outcomes count as done.
  const done = new Set(
    readLedger().filter((e) => e.status !== "would_fill").map((e) => e.symbol),
  );
  let todo = stocks.filter((s) => String(s.mn ?? "9999") > TARGET && !done.has(String(s.symbol)));
  if (SYMBOLS) todo = todo.filter((s) => SYMBOLS.includes(String(s.symbol)));
  if (LIMIT > 0) todo = todo.slice(0, LIMIT);

  // ── RETENTION PRE-FLIGHT ──
  // The deepest stock after backfill must still sit under keep, or the nightly
  // prune eats exactly the bars we just fetched. This is the failure the plan
  // says "has bitten twice".
  const deepest = Math.max(...stocks.map((s) => Number(s.bars)));
  // Estimate only, for the banner. The BINDING check is per stock, inside one():
  // existing + new must not exceed keep.
  const sessionsToAdd = 145; // ~2019-01-01 .. 2019-08-01
  const projected = deepest + sessionsToAdd;
  console.log(`\n=== STAGE 3 — daily_prices back to ${TARGET} ===`);
  console.log(`  mode: ${CONFIRM ? "--confirm (LIVE WRITE)" : "PREVIEW"}`);
  console.log(`  retention keep=${keep} floor=${pol?.floor} armed=${pol?.armed}`);
  console.log(`  deepest stock now ${deepest} bars -> projected ~${projected} after backfill`);
  if (projected > keep) {
    console.error(`\n❌ RETENTION WOULD TRIM THE BACKFILL: projected ${projected} > keep ${keep}.` +
      `\n   Raise daily_prices.keep first (stage0-retention-raise-keep.ts). Nothing fetched.\n`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`  ✅ projected ${projected} <= keep ${keep} — the prune will not touch it`);
  console.log(`  stocks short of ${TARGET}: ${stocks.filter((s) => String(s.mn ?? "9999") > TARGET).length}`);
  console.log(`  already in ledger: ${done.size}   to fetch: ${todo.length}   concurrency ${CONCURRENCY}\n`);
  if (!todo.length) { console.log("  nothing to do\n"); await prisma.$disconnect(); return; }

  const tally = { filled: 0, nothing_older: 0, no_data: 0, failed: 0, would_fill: 0 };
  let totalInserted = 0, processed = 0;
  const started = Date.now();
  let lastReport = Date.now();

  async function one(s: Record<string, unknown>): Promise<void> {
    const symbol = String(s.symbol);
    const before = s.mn === null ? null : String(s.mn);
    let e: Entry;
    try {
      const rows = await withTimeout(fetchYahooHistory(symbol, YEARS_BACK), PER_STOCK_TIMEOUT_MS, symbol);
      if (!rows.length) {
        e = { symbol, status: "no_data", fetched: 0, older: 0, inserted: 0,
          earliestBefore: before, earliestAfter: before,
          error: `Yahoo returned 0 rows for ${toYahooTicker(symbol)}` };
      } else {
        // Bars strictly OLDER than what we hold (recent history untouched) AND
        // no older than the TARGET.
        //
        // ⚠️ THE CLAMP IS NOT COSMETIC. YEARS_BACK=8 makes Yahoo return from
        // ~2018-08-24, i.e. 228 bars/stock rather than the ~145 the target needs.
        // Unclamped, the deepest stock lands at 1,745 + 228 = 1,973 against
        // keep=2000 — 27 bars of headroom, about six weeks before the nightly
        // prune starts deleting exactly what we just fetched. The plan warns this
        // failure "has bitten twice". Clamping to the target leaves ~110 bars of
        // headroom instead.
        const cutoff = before ? new Date(`${before}T00:00:00Z`) : null;
        const targetMs = new Date(`${TARGET}T00:00:00Z`).getTime();
        const older = rows.filter(
          (r) => r.date.getTime() >= targetMs && (cutoff === null || r.date.getTime() < cutoff.getTime()),
        );
        if (!older.length) {
          e = { symbol, status: "nothing_older", fetched: rows.length, older: 0, inserted: 0,
            earliestBefore: before, earliestAfter: before };
        } else if (Number(s.bars) + older.length > keep) {
          // HARD per-stock guarantee, not an estimate: never write a stock past
          // the retention ceiling, because the prune would delete the oldest bars
          // — the very ones being added.
          e = { symbol, status: "failed", fetched: rows.length, older: older.length, inserted: 0,
            earliestBefore: before, earliestAfter: before,
            error: `would exceed retention: ${Number(s.bars)} existing + ${older.length} new > keep ${keep}` };
        } else if (!CONFIRM) {
          e = { symbol, status: "would_fill", fetched: rows.length, older: older.length, inserted: 0,
            earliestBefore: before, earliestAfter: older[0].date.toISOString().slice(0, 10) };
        } else {
          const n = await insertDailyPrices(prisma, String(s.id), older);
          e = { symbol, status: "filled", fetched: rows.length, older: older.length, inserted: n,
            earliestBefore: before, earliestAfter: older[0].date.toISOString().slice(0, 10) };
          totalInserted += n;
        }
      }
    } catch (err) {
      e = { symbol, status: "failed", fetched: 0, older: 0, inserted: 0,
        earliestBefore: before, earliestAfter: before, error: (err as Error).message };
    }
    tally[e.status]++;
    write(e);
    processed++;
    if (Date.now() - lastReport >= REPORT_EVERY_MS || processed === todo.length) {
      lastReport = Date.now();
      const rate = processed / ((Date.now() - started) / 1000);
      console.log(`  ${new Date().toISOString()} ${processed}/${todo.length} ` +
        `filled=${tally.filled} wouldFill=${tally.would_fill} nothingOlder=${tally.nothing_older} ` +
        `noData=${tally.no_data} failed=${tally.failed} bars=${totalInserted} ` +
        `eta=${rate > 0 ? Math.ceil((todo.length - processed) / rate / 60) : -1}min`);
    }
  }

  // Bounded concurrency — Yahoo tolerates a handful in flight, not 500.
  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
    for (;;) {
      const s = queue.shift();
      if (!s) break;
      await one(s);
    }
  }));

  console.log(`\n-- RESULT --`);
  console.log(`  ${CONFIRM ? "filled" : "would fill"}      ${CONFIRM ? tally.filled : tally.would_fill}`);
  console.log(`  nothing older     ${tally.nothing_older}   (Yahoo has no earlier data)`);
  console.log(`  no data           ${tally.no_data}`);
  console.log(`  failed            ${tally.failed}`);
  console.log(`  bars inserted     ${totalInserted}`);

  const led = readLedger();
  for (const st of ["failed", "no_data"] as const) {
    const rows = led.filter((e) => e.status === st);
    if (!rows.length) continue;
    console.log(`\n  -- ${st} (${rows.length}) --`);
    for (const r of rows.slice(0, 20)) console.log(`     ${r.symbol.padEnd(13)} ${r.error ?? ""}`);
    if (rows.length > 20) console.log(`     ... and ${rows.length - 20} more (see ${LEDGER})`);
  }

  if (CONFIRM) {
    const [after] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT count(*) n, min(date)::text mn, max(date)::text mx FROM daily_prices`);
    console.log(`\n-- POST-WRITE -- rows=${Number(after.n)} span ${after.mn} .. ${after.mx}`);
    const [depth] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `WITH pk AS (SELECT stock_id, count(*)::int c FROM daily_prices GROUP BY stock_id)
       SELECT max(c) mx, count(*) FILTER (WHERE c > $1) AS "overKeep" FROM pk`, keep);
    console.log(`  deepest stock now ${Number(depth.mx)} bars; stocks over keep=${keep}: ${Number(depth.overKeep)} (must be 0)`);
  } else {
    console.log(`\n  PREVIEW only — re-run with --confirm to write.\n`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
