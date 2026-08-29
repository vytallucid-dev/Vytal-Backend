// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 16 — YAHOO PRICE BACKFILL FOR THE NEWLY-SEEDED UNIVERSE.  ⚠ WRITES unless --dry-run.
//
//   npx tsx src/scripts/stage16-price-backfill-new-universe.ts --dry-run
//   npx tsx src/scripts/stage16-price-backfill-new-universe.ts                 # all remaining
//   npx tsx src/scripts/stage16-price-backfill-new-universe.ts --limit 300     # one slice
//   npx tsx src/scripts/stage16-price-backfill-new-universe.ts --years 8
//
// ── WHAT IT TARGETS, AND WHY THAT PREDICATE ──────────────────────────────────────────────────────
// Active stocks with ZERO daily_prices rows. Not "created today", not a hardcoded list — the
// predicate IS the resume state. Re-run it as many times as you like: finished stocks fall out of
// the target set on their own, so an interrupted run costs nothing and needs no cursor to be
// persisted anywhere. `backfillStock` fetches then bulk-inserts per stock, so a stock is all-or-
// nothing; there is no half-done state for the predicate to mis-read.
//
// ── DEPTH: "THE SAME AS THE OTHER 504" ───────────────────────────────────────────────────────────
// MEASURED on the existing universe: avg 1,613 bars, max 1,890, avg span 6.5y, global floor
// 2019-01-01 (7.65y). So 8 years reproduces the deepest existing history, and every fetch is
// LISTING-DATE BOUNDED inside backfillStock — a 2024 listing gets its real life, not a fabricated
// eight years. The retention policy (depth_per_key, keep 2000, floor 760) never bites: 8y ≈ 1,975
// bars, just under the cap.
//
// ── PACING IS THE PROVEN ONE, NOT A FASTER GUESS ─────────────────────────────────────────────────
// BATCH 10 / DELAY 3000ms, sequential within a batch — lifted verbatim from
// backfill-nifty500-pass3-prices.ts, which ran this against Yahoo without trouble. Yahoo is a
// rate-limited third party we do not control; beating a known-good cadence to save twenty minutes
// risks a throttle that costs hours and corrupts nothing but wastes everything.
//
// ── A FAILURE IS NEVER SILENT ────────────────────────────────────────────────────────────────────
// Every total failure (no Yahoo coverage / 0 rows / hard error) calls reportIngestionError, so it
// lands in /settings/ingestion-errors rather than in a scrollback nobody reads. Expect a handful of
// genuine no-coverage names — Yahoo does not carry every thinly-traded NSE ticker.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { backfillStock, type StockResult } from "./yahoo-price-backfill.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";

const argv = process.argv;
const DRY = argv.includes("--dry-run");
const num = (f: string, d: number): number => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d;
};
const YEARS = num("--years", 8);
const LIMIT = num("--limit", 0);

const BATCH = 10, DELAY = 3000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const PRICE_CRON = "yahoo_price_backfill";

async function reportPriceFailure(symbol: string, observed: string): Promise<void> {
  await reportIngestionError({
    source: "yahoo_finance",
    cron: PRICE_CRON,
    guardType: "count",
    targetTable: "DailyPrice",
    targetEntity: symbol,
    severity: "high",
    resolutionPath: "source_code",
    expected: `>=1 daily price row from Yahoo (${YEARS}y, listing-bounded)`,
    observed,
  });
}

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`STAGE 16 — price backfill for the new universe  ${DRY ? "(dry-run)" : "*** LIVE ***"}  years=${YEARS}`);
  console.log("=".repeat(104));

  const target = await prisma.$queryRawUnsafe<Array<{ id: string; symbol: string }>>(
    `SELECT s.id, s.symbol FROM stocks s
      WHERE s.is_active = true
        AND NOT EXISTS (SELECT 1 FROM daily_prices p WHERE p.stock_id = s.id)
      ORDER BY s.symbol ${LIMIT > 0 ? `LIMIT ${Math.floor(LIMIT)}` : ""}`);

  const remaining = (await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int n FROM stocks s WHERE s.is_active = true
       AND NOT EXISTS (SELECT 1 FROM daily_prices p WHERE p.stock_id = s.id)`))[0].n;

  console.log(`\n  stocks with no price history : ${remaining}`);
  console.log(`  this run will attempt        : ${target.length}`);
  if (!target.length) { console.log(`\n  nothing to do.\n`); await prisma.$disconnect(); return; }
  console.log(`  pacing                       : ${BATCH} per batch, ${DELAY}ms between batches`);
  console.log(`  rough wall-clock             : ~${Math.round((target.length * 1.6 + (target.length / BATCH) * (DELAY / 1000)) / 60)} min\n`);

  if (DRY) {
    console.log(`  first 10: ${target.slice(0, 10).map((s) => s.symbol).join(", ")}`);
    console.log(`\n  dry-run — re-run without --dry-run to write.\n`);
    await prisma.$disconnect();
    return;
  }

  const results: StockResult[] = [];
  const t0 = Date.now();
  for (let i = 0; i < target.length; i += BATCH) {
    const batch = target.slice(i, i + BATCH);
    for (const s of batch) {
      let r: StockResult;
      try {
        r = await backfillStock(prisma as never, s.id, s.symbol, YEARS, true, false);
      } catch (e) {
        r = { symbol: s.symbol, status: "failed", rowsInserted: 0, durationMs: 0, error: String(e).slice(0, 200) } as StockResult;
      }
      results.push(r);
      if (r.status === "failed" || r.status === "no_data") await reportPriceFailure(r.symbol, r.error ?? "no data");
    }
    const done = Math.min(i + BATCH, target.length);
    const ok = results.filter((r) => r.status === "success").length;
    const bad = results.filter((r) => r.status === "failed" || r.status === "no_data").length;
    const rows = results.reduce((a, r) => a + r.rowsInserted, 0);
    const elapsed = (Date.now() - t0) / 1000;
    const eta = done ? Math.round((elapsed / done) * (target.length - done) / 60) : 0;
    process.stdout.write(`\r  ${done}/${target.length}  ok ${ok} · failed ${bad} · rows ${rows}  ~${eta}min left      `);
    if (i + BATCH < target.length) await sleep(DELAY);
  }

  const ok = results.filter((r) => r.status === "success");
  const bad = results.filter((r) => r.status === "failed" || r.status === "no_data");
  const rows = results.reduce((a, r) => a + r.rowsInserted, 0);
  console.log(`\n\n  ── DONE ──`);
  console.log(`  success ${ok.length} · no-data/failed ${bad.length} · rows inserted ${rows}`);
  if (bad.length) {
    console.log(`\n  ${bad.length} symbol(s) Yahoo could not serve (each reported to /settings/ingestion-errors):`);
    console.log(`     ${bad.slice(0, 40).map((r) => r.symbol).join(", ")}${bad.length > 40 ? ` … +${bad.length - 40}` : ""}`);
  }
  const left = (await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int n FROM stocks s WHERE s.is_active = true
       AND NOT EXISTS (SELECT 1 FROM daily_prices p WHERE p.stock_id = s.id)`))[0].n;
  console.log(`\n  stocks still without price history: ${left}  (re-run to continue)\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
