// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 26 — COMPLETE market_cap ACROSS THE UNIVERSE, THEN RE-RANK THE TIERS.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage26-market-cap-complete.ts            # dry
//   npx tsx src/scripts/stage26-market-cap-complete.ts --commit
//
// Three passes, in this order, because the third depends on the first two:
//
//  A. THE 233 HAND-SOURCED ROWS (docs/total_shares_market_cap_completed.csv).
//     These stocks have a price but NO shareholding filing, so `computeMarketCap` — which is
//     `close × latest-filing total_shares ÷ 1e7` — can never produce a number for them. The daily
//     price job will keep skipping them forever. A hand-sourced share count is the only thing that
//     can close this, which is why it was worth asking for.
//
//  B. EVERY OTHER STOCK WITH A PRICE AND A FILED SHARE COUNT.
//     MEASURED: `stock_prices.market_cap` is filled for only 504 of 2,291 rows. The 1,787 seeded
//     stocks got their prices from the Yahoo backfill, which writes daily_prices directly and never
//     goes through ingest-prices.ts — and computeMarketCap is called from THERE. So their market cap
//     was never computed. Tonight's EOD run would fix most of them; doing it here makes the universe
//     consistent today and uses the identical formula, so the cron overwrites with the same value.
//
//  C. RE-RANK market_cap_category OVER THE WHOLE UNIVERSE.
//     SEBI's rule is rank-based (top 100 large, 101–250 mid, rest small), so adding 233 stocks to
//     the population can push others across a boundary. Re-ranking everything is the only correct
//     response; patching only the new arrivals would leave the tiers quietly wrong.
//
// ⚠ THE FILE IS VALIDATED, NOT TRUSTED. Its own MARKET_CAP_CR is recomputed from its own
//   latest_close × TOTAL_SHARES and compared; a row that disagrees by more than 1% is REPORTED and
//   SKIPPED. A share count is a number someone typed, and a typo in it is invisible once it becomes
//   a market cap on a page.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";

const COMMIT = process.argv.includes("--commit");
const arg = (f: string, d: string): string => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const CSV = arg("--csv", "docs/total_shares_market_cap_completed.csv");
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

const LARGE_RANK = 100, MID_RANK = 250;

function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let f = "", row: string[] = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); f = ""; rows.push(row); row = []; }
    else if (c !== "\r") f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}
const n = (s: string): number | null => {
  const t = (s ?? "").replace(/[, ₹]/g, "").trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 26 — complete market cap + re-rank  ${COMMIT ? "*** COMMIT ***" : "(dry)"}`);
  console.log("=".repeat(100));

  // ── A. the hand-sourced 233 ────────────────────────────────────────────────────────────────
  if (!fs.existsSync(CSV)) { console.log(`\n  no file at ${CSV}\n`); await prisma.$disconnect(); return; }
  const rows = parseCsv(fs.readFileSync(CSV, "utf8"));
  const head = rows[0].map((h) => h.trim());
  const ix = (name: string): number => head.findIndex((h) => h.toUpperCase() === name.toUpperCase());
  const iSym = ix("symbol"), iShares = ix("TOTAL_SHARES"), iClose = ix("latest_close"), iMc = ix("MARKET_CAP_CR"), iAsOn = ix("as_on_date");
  if (iSym < 0 || iShares < 0) { console.log(`\n  header missing symbol / TOTAL_SHARES\n`); await prisma.$disconnect(); return; }

  const known = new Map((await raw<{ symbol: string; id: string }>(`SELECT symbol, id FROM stocks`)).map((s) => [s.symbol, s.id]));
  const good: Array<{ symbol: string; id: string; mcapCr: number; asOn: Date | null }> = [];
  const bad: string[] = [];
  for (const r of rows.slice(1)) {
    const sym = (r[iSym] ?? "").trim().toUpperCase();
    const id = known.get(sym);
    const shares = n(r[iShares] ?? ""), close = n(r[iClose] ?? ""), stated = iMc >= 0 ? n(r[iMc] ?? "") : null;
    if (!id) { bad.push(`${sym}: not in the universe`); continue; }
    if (!shares || shares <= 0) { bad.push(`${sym}: TOTAL_SHARES missing or not positive`); continue; }
    if (!close || close <= 0) { bad.push(`${sym}: no latest_close to value it with`); continue; }
    const computed = (close * shares) / 1e7;
    // ⚠ The file's own arithmetic must agree with itself. A share count off by a digit produces a
    //   market cap that is wrong by 10× and looks perfectly ordinary on a page.
    if (stated != null && Math.abs(computed - stated) / Math.max(stated, 1) > 0.01) {
      bad.push(`${sym}: stated ₹${stated.toFixed(0)} cr but close×shares = ₹${computed.toFixed(0)} cr`);
      continue;
    }
    const asOn = iAsOn >= 0 && (r[iAsOn] ?? "").trim() ? new Date(`${(r[iAsOn] ?? "").trim()}T00:00:00.000Z`) : null;
    good.push({ symbol: sym, id, mcapCr: computed, asOn: asOn && !Number.isNaN(asOn.getTime()) ? asOn : null });
  }
  console.log(`\n  A. hand-sourced file: ${rows.length - 1} row(s) → ${good.length} valid, ${bad.length} refused`);
  for (const b of bad.slice(0, 12)) console.log(`       ⚠ ${b}`);

  // ── B. everyone else with a price and a filed share count ──────────────────────────────────
  const derivable = await raw<{ id: string; symbol: string; mcap: string; ason: string }>(`
    WITH px AS (SELECT DISTINCT ON (stock_id) stock_id, close FROM daily_prices ORDER BY stock_id, date DESC),
         sh AS (SELECT DISTINCT ON (stock_id) stock_id, total_shares, as_on_date FROM shareholding_patterns
                 WHERE total_shares IS NOT NULL AND total_shares > 0 ORDER BY stock_id, as_on_date DESC)
    SELECT s.id, s.symbol, ((px.close * sh.total_shares) / 1e7)::text mcap, sh.as_on_date::text ason
      FROM stocks s JOIN px ON px.stock_id = s.id JOIN sh ON sh.stock_id = s.id
      JOIN stock_prices p ON p.stock_id = s.id
     WHERE s.is_active AND p.market_cap IS NULL`);
  console.log(`  B. computable from a filed share count, currently NULL: ${derivable.length}`);

  if (!COMMIT) {
    console.log(`\n  sample of A: ${good.slice(0, 4).map((g) => `${g.symbol} ₹${g.mcapCr.toFixed(0)}cr`).join(" · ")}`);
    console.log(`  C. would then re-rank the full universe into large/mid/small.`);
    console.log(`\n  dry — re-run with --commit.\n`);
    await prisma.$disconnect();
    return;
  }

  let wrote = 0;
  for (const g of good) {
    wrote += await prisma.$executeRawUnsafe(
      `UPDATE stock_prices SET market_cap = $2, shares_as_of_date = COALESCE($3::date, shares_as_of_date), updated_at = now()
        WHERE stock_id = $1`, g.id, g.mcapCr, g.asOn);
  }
  console.log(`\n  A. wrote market_cap on ${wrote} hand-sourced stock(s)`);

  let wrote2 = 0;
  for (let i = 0; i < derivable.length; i += 400) {
    for (const d of derivable.slice(i, i + 400)) {
      wrote2 += await prisma.$executeRawUnsafe(
        `UPDATE stock_prices SET market_cap = $2, shares_as_of_date = COALESCE($3::date, shares_as_of_date), updated_at = now()
          WHERE stock_id = $1 AND market_cap IS NULL`, d.id, Number(d.mcap), d.ason);
    }
    process.stdout.write(`\r  B. computed ${Math.min(i + 400, derivable.length)}/${derivable.length}`);
  }
  console.log(`\n  B. wrote market_cap on ${wrote2} stock(s) from filed share counts`);

  // ── C. re-rank ─────────────────────────────────────────────────────────────────────────────
  const ranked = await raw<{ symbol: string; mcap: string }>(`
    SELECT s.symbol, p.market_cap::text mcap FROM stocks s JOIN stock_prices p ON p.stock_id = s.id
     WHERE s.is_active AND p.market_cap IS NOT NULL ORDER BY p.market_cap DESC`);
  const bucket = (i: number): string => (i < LARGE_RANK ? "large_cap" : i < MID_RANK ? "mid_cap" : "small_cap");
  const byBucket: Record<string, string[]> = { large_cap: [], mid_cap: [], small_cap: [] };
  ranked.forEach((r, i) => byBucket[bucket(i)].push(r.symbol));
  let tiered = 0;
  for (const [b, syms] of Object.entries(byBucket))
    for (let i = 0; i < syms.length; i += 500)
      tiered += await prisma.$executeRawUnsafe(
        `UPDATE stocks SET market_cap_category = $1, updated_at = now()
          WHERE symbol = ANY($2::text[]) AND coalesce(market_cap_category,'') <> $1`, b, syms.slice(i, i + 500));

  console.log(`\n  C. ranked ${ranked.length} stock(s) — large ${byBucket.large_cap.length} · mid ${byBucket.mid_cap.length} · small ${byBucket.small_cap.length}`);
  console.log(`     tier changed on ${tiered} stock(s)`);
  for (const i of [0, LARGE_RANK - 1, LARGE_RANK, MID_RANK - 1, MID_RANK, ranked.length - 1]) {
    if (i >= ranked.length) continue;
    console.log(`       #${String(i + 1).padStart(4)}  ${ranked[i].symbol.padEnd(14)} ₹${Number(ranked[i].mcap).toLocaleString("en-IN", { maximumFractionDigits: 0 }).padStart(14)} cr  ${bucket(i)}`);
  }
  const left = await raw<{ n: number }>(`SELECT count(*)::int n FROM stocks WHERE is_active AND market_cap_category IS NULL`);
  console.log(`\n  stocks still without a tier: ${left[0].n}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
