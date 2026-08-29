// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 20 — INSIDER TRADES + BLOCK DEALS HISTORY FOR THE EXPANDED UNIVERSE.  ⚠ WRITES.
//
//   npx tsx src/scripts/stage20-events-backfill.ts --dry-run
//   npx tsx src/scripts/stage20-events-backfill.ts --from 2024-01-01
//
// ── WHY THIS NEEDS NO WORKERS AND NO PER-STOCK LEDGER ────────────────────────────────────────────
// Unlike results and shareholding, these two are NOT per-stock crawls. Both fetch a MARKET-WIDE feed
// for a date range and then keep the rows whose symbol is in our universe:
//   · insider  — pit-source.ts:50 filters `inUniverse` against a stockMap built from is_active
//   · deals    — ingest-deals.ts:27 builds the same map the same way
// So they are O(1) in universe size. Seeding 1,787 stocks did not make them slower; it made them
// KEEP MORE of each feed. The daily crons already cover the new stocks going forward — only history
// is missing, and history is a date range, not a symbol list.
//
// ── CHUNKED BY MONTH, AND THAT IS THE RESUME STATE ───────────────────────────────────────────────
// A single 2-year fetch is one long request with nothing to show for a failure halfway. Monthly
// chunks make each unit small, and the ledger records which months are done — so a kill costs one
// month, not the campaign. Both ingesters are idempotent, so a repeated month duplicates nothing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { runManualFetch } from "../ingestions/insider-trades/pit-jobs.js";
import { runBackfillDealIngest } from "../ingestions/block-deals/ingest-deals.js";

const argv = process.argv;
const DRY = argv.includes("--dry-run");
const arg = (f: string, d: string): string => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
/**
 * ⚠ 365 DAYS, NOT THE TWO YEARS THE REST OF THIS EXPANSION USES — AND THAT IS DELIBERATE.
 *
 * MEASURED: both tables carry an ARMED `time` retention policy of **365 days**
 *   insider_trades  mode=time days=365 ts_column=trade_date  floor 200
 *   block_deals     mode=time days=365 ts_column=deal_date   floor 200
 * so anything fetched older than that is deleted by the next prune. Backfilling 2024 would have
 * been 32 months of requests for rows the database is designed to throw away — and NSE returned
 * "0 filings" for every week of April 2024 regardless, so the source does not serve it either.
 *
 * The default is therefore pinned to the retention window. Pass --from explicitly to override, but
 * know that the prune will win.
 */
const DEFAULT_FROM = new Date(Date.now() - 360 * 86_400_000).toISOString().slice(0, 10);
const FROM = new Date(`${arg("--from", DEFAULT_FROM)}T00:00:00.000Z`);
const LEDGER = "_s20-ledger.json";

type Ledger = Record<string, { at: string; ok: boolean; note: string }>;
const read = (): Ledger => (fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) as Ledger : {});
const write = (l: Ledger): void => fs.writeFileSync(LEDGER, JSON.stringify(l, null, 1));

/** Inclusive month starts from FROM to now. */
function months(from: Date): Array<{ key: string; a: Date; b: Date }> {
  const out: Array<{ key: string; a: Date; b: Date }> = [];
  const now = new Date();
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cur <= now) {
    const a = new Date(cur);
    const b = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    out.push({ key: `${a.toISOString().slice(0, 7)}`, a, b: b > now ? now : b });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

async function counts(): Promise<{ insider: number; deals: number }> {
  const r = await prisma.$queryRawUnsafe<Array<{ i: number; d: number }>>(
    `SELECT (SELECT count(*)::int FROM insider_trades) i, (SELECT count(*)::int FROM block_deals) d`);
  return { insider: r[0].i, deals: r[0].d };
}

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 20 — insider + block-deal history  ${DRY ? "(dry-run)" : "*** LIVE ***"}   from ${FROM.toISOString().slice(0, 10)}`);
  console.log("=".repeat(100));

  const chunks = months(FROM);
  const ledger = read();
  const todo = chunks.filter((c) => !ledger[`insider:${c.key}`]);
  const before = await counts();
  console.log(`\n  universe is 2,291 active stocks — these feeds are market-wide and filtered against it`);
  console.log(`  months ${chunks.length} · already done ${chunks.length - todo.length} · this run ${todo.length}`);
  console.log(`  before: insider_trades ${before.insider.toLocaleString()} · block_deals ${before.deals.toLocaleString()}\n`);
  if (DRY) { console.log(`  months: ${chunks.map((c) => c.key).join(", ")}\n`); await prisma.$disconnect(); return; }

  // ── insider trades, month by month ──────────────────────────────────────────────────────────
  for (let i = 0; i < todo.length; i++) {
    const c = todo[i];
    try {
      await runManualFetch(c.a, c.b);
      ledger[`insider:${c.key}`] = { at: new Date().toISOString(), ok: true, note: "" };
    } catch (e) {
      ledger[`insider:${c.key}`] = { at: new Date().toISOString(), ok: false, note: String(e).slice(0, 160) };
    }
    write(ledger);
    const now = await counts();
    process.stdout.write(`\r  insider ${i + 1}/${todo.length} (${c.key})  rows ${now.insider.toLocaleString()}      `);
  }

  // ── block deals: one call, `days` back — it is a single feed, not a per-month API ────────────
  if (!ledger["deals:all"]) {
    const days = Math.ceil((Date.now() - FROM.getTime()) / 86_400_000);
    console.log(`\n\n  block deals: ${days} days back…`);
    try {
      const r = await runBackfillDealIngest(days);
      ledger["deals:all"] = { at: new Date().toISOString(), ok: true, note: `inserted ${r.totalInserted}` };
      console.log(`  fetched ${r.totalFetched} · inserted ${r.totalInserted} · skipped ${r.totalSkipped}`);
    } catch (e) {
      ledger["deals:all"] = { at: new Date().toISOString(), ok: false, note: String(e).slice(0, 160) };
      console.log(`  ⚠ failed: ${String(e).slice(0, 200)}`);
    }
    write(ledger);
  }

  const after = await counts();
  const bad = Object.entries(ledger).filter(([, v]) => !v.ok);
  console.log(`\n\n  ── DONE ──`);
  console.log(`  insider_trades ${before.insider.toLocaleString()} -> ${after.insider.toLocaleString()}  (+${(after.insider - before.insider).toLocaleString()})`);
  console.log(`  block_deals    ${before.deals.toLocaleString()} -> ${after.deals.toLocaleString()}  (+${(after.deals - before.deals).toLocaleString()})`);
  if (bad.length) { console.log(`\n  ⚠ ${bad.length} chunk(s) failed — re-run to retry:`); for (const [k, v] of bad.slice(0, 10)) console.log(`     ${k}: ${v.note}`); }
  console.log("");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
