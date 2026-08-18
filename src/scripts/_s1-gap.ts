// ═══════════════════════════════════════════════════════════════
// STAGE 1.4 — SCOPE THE REAL GAP. READ-ONLY (SELECTs only).
//   npx tsx src/scripts/_s1-gap.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { SECTOR_INDEX_MAP } from "../scoring/read/price-view.service.js";
import { REGIME_LOOKBACK_ROWS } from "../scoring/regime/regime.js";

const SNAP = "2022-01-31";
const NEED = REGIME_LOOKBACK_ROWS + 1; // 127
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lpad = (s: unknown, n: number) => String(s).padStart(n);

// The 9 indices backfill-index-yahoo.ts INDEX_MAP can actually reach (read from source).
const YAHOO_INDEX_MAP = new Set([
  "Nifty 50", "Sensex", "Nifty Auto", "Nifty Bank", "Nifty FMCG",
  "Nifty IT", "Nifty Metal", "Nifty Pharma", "Nifty Realty",
]);

async function main() {
  // ════════════════════════════════════════════════════════════
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ S1.4a — QUARTERLY DEPTH BY PEER GROUP (reach vs ${SNAP})              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  const [kl] = await raw(
    `WITH k AS (SELECT "stock_id","result_type",
                       count(*)::int c,
                       count(*) FILTER (WHERE "report_date" <= DATE '${SNAP}')::int pre
                  FROM quarterly_results GROUP BY 1,2)
     SELECT count(*)::int keys, count(*) FILTER (WHERE pre = 0)::int no_pre,
            count(DISTINCT "stock_id")::int stocks FROM k`);
  const [sl] = await raw(
    `WITH s AS (SELECT "stock_id",
                       count(*) FILTER (WHERE "report_date" <= DATE '${SNAP}')::int pre,
                       min("report_date")::date oldest, count(*)::int c
                  FROM quarterly_results GROUP BY 1)
     SELECT count(*)::int stocks, count(*) FILTER (WHERE pre = 0)::int no_pre FROM s`);
  const [univ] = await raw(`SELECT count(*)::int n FROM stocks`);
  console.log(`  key level:   ${kl.keys} (stock,result_type) keys · ${kl.no_pre} hold nothing on/before ${SNAP}`);
  console.log(`  stock level: ${sl.stocks} stocks with any quarterly row · ${sl.no_pre} reach nothing before ${SNAP}`);
  console.log(`  universe:    ${univ.n} stocks total · ${Number(univ.n) - Number(sl.stocks)} have NO quarterly rows at all\n`);

  const pgs = await raw(
    `WITH per_stock AS (
       SELECT st."id" sid, st."symbol",
              count(q."id")::int rows,
              count(q."id") FILTER (WHERE q."report_date" <= DATE '${SNAP}')::int pre,
              min(q."report_date")::date oldest
         FROM stocks st LEFT JOIN quarterly_results q ON q."stock_id" = st."id"
        GROUP BY st."id", st."symbol")
     SELECT pg."name" pg_name, sec."name" sector,
            count(*)::int stocks,
            count(*) FILTER (WHERE ps.rows = 0)::int no_data,
            count(*) FILTER (WHERE ps.pre > 0)::int reach_snap,
            count(*) FILTER (WHERE ps.rows > 0 AND ps.pre = 0)::int short,
            min(ps.oldest)::text deepest,
            max(ps.oldest)::text shallowest,
            percentile_disc(0.5) WITHIN GROUP (ORDER BY ps.oldest)::text median_oldest,
            round(avg(ps.rows),1)::text avg_rows
       FROM peer_groups pg
       JOIN sectors sec ON sec."id" = pg."sector_id"
       JOIN stock_peer_groups spg ON spg."peer_group_id" = pg."id"
       JOIN per_stock ps ON ps.sid = spg."stock_id"
      GROUP BY pg."name", sec."name"
      ORDER BY count(*) FILTER (WHERE ps.rows > 0 AND ps.pre = 0) DESC, count(*) DESC`);

  console.log(`  ${pad("peer group", 40)}${pad("sector", 26)}${lpad("stks", 5)}${lpad("reach", 6)}${lpad("short", 6)}${lpad("none", 5)}${lpad("avg rows", 9)}  median oldest`);
  let tStocks = 0, tReach = 0, tShort = 0, tNone = 0;
  for (const r of pgs) {
    tStocks += Number(r.stocks); tReach += Number(r.reach_snap); tShort += Number(r.short); tNone += Number(r.no_data);
    console.log(
      `  ${pad(r.pg_name, 40)}${pad(r.sector, 26)}${lpad(r.stocks, 5)}${lpad(r.reach_snap, 6)}${lpad(r.short, 6)}${lpad(r.no_data, 5)}${lpad(r.avg_rows, 9)}  ${r.median_oldest ?? "-"}`);
  }
  console.log(`  ${pad("── TOTAL (stock·PG memberships)", 66)}${lpad(tStocks, 5)}${lpad(tReach, 6)}${lpad(tShort, 6)}${lpad(tNone, 5)}`);
  console.log(`  reach = has ≥1 quarterly row on/before ${SNAP} · short = has rows but none that old · none = no quarterly rows at all`);

  // ════════════════════════════════════════════════════════════
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ S1.4b — DAILY_PRICES: what a ${SNAP} snapshot actually needs           ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const yrs = await raw(
    `SELECT EXTRACT(year FROM "date")::int y, count(DISTINCT "date")::int td FROM daily_prices GROUP BY 1 ORDER BY 1`);
  console.log(`  measured trading-day rate (distinct dates present per calendar year):`);
  for (const r of yrs) console.log(`    ${r.y}: ${lpad(r.td, 4)} trading days${Number(r.y) === 2022 ? "  (partial — series starts 2022-05-27)" : Number(r.y) === 2026 ? "  (partial — to date)" : ""}`);
  const full = yrs.filter((r) => [2023, 2024, 2025].includes(Number(r.y)));
  const rate = full.reduce((s, r) => s + Number(r.td), 0) / full.length;
  console.log(`  → full-year mean: ${rate.toFixed(1)} trading days/yr (2023–2025)`);

  const [since] = await raw(`SELECT count(DISTINCT "date")::int n FROM daily_prices WHERE "date" > DATE '${SNAP}'`);
  const A2 = 756;
  const targetRows = A2 + Number(since.n);
  const preStartYears = A2 / rate;
  const [dpNow] = await raw(
    `WITH k AS (SELECT "stock_id", count(*)::int c, min("date")::date o FROM daily_prices GROUP BY 1)
     SELECT count(*)::int stocks, sum(c)::bigint rows, min(o)::text earliest, max(o)::text latest_start,
            percentile_disc(0.5) WITHIN GROUP (ORDER BY c)::int p50, min(c)::int minc, max(c)::int maxc FROM k`);
  console.log(`\n  MEASURED today: ${dpNow.stocks} stocks · ${dpNow.rows} rows · p50 ${dpNow.p50}/stock (min ${dpNow.minc}, max ${dpNow.maxc})`);
  console.log(`                  earliest bar anywhere ${dpNow.earliest} · latest first-bar ${dpNow.latest_start}`);
  console.log(`\n  REQUIREMENT for a ${SNAP} snapshot, per stock:`);
  console.log(`    Market A2 range-position window          ${lpad(A2, 6)} trading days BEFORE the snapshot`);
  console.log(`    trading days already elapsed since       ${lpad(since.n, 6)} (measured, distinct dates > ${SNAP})`);
  console.log(`    ────────────────────────────────────────────────`);
  console.log(`    rows/stock needed                        ${lpad(targetRows, 6)}   (new cap 1900 covers it, old 1300 did not)`);
  console.log(`    pre-snapshot window start (inferred)     ${A2} ÷ ${rate.toFixed(1)} = ${preStartYears.toFixed(2)} yr before ${SNAP} ≈ 2019-01`);
  const gapPerStock = targetRows - Number(dpNow.p50);
  console.log(`\n  GAP: p50 stock holds ${dpNow.p50}; needs ${targetRows} → ${gapPerStock} rows/stock short`);
  console.log(`       universe total needed ≈ ${Number(dpNow.stocks) * targetRows} rows vs ${dpNow.rows} held → ≈ ${Number(dpNow.stocks) * targetRows - Number(dpNow.rows)} rows to fetch`);
  console.log(`  YAHOO must supply ≈2019-01 → ${dpNow.earliest} for every stock (yahoo-price-backfill.ts, PROVIDER "yahoo-finance",`);
  console.log(`  createMany skipDuplicates — it already accepts --years, so a 7yr run covers it). Kite is OUT (Aman's ruling).`);
  const [listing] = await raw(
    `SELECT count(*)::int n FROM stocks WHERE "id" NOT IN (SELECT DISTINCT "stock_id" FROM daily_prices)`);
  console.log(`  ⚠ ${listing.n} stocks hold no daily_prices row at all. Stocks listed after ≈2019 cannot reach the full window`);
  console.log(`    at any depth — that ceiling is the market's, not the cap's.`);

  // ════════════════════════════════════════════════════════════
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ S1.4c — SECTOR INDICES that cannot resolve a ${SNAP} regime read       ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("sector", 30)}${pad("index", 40)}${lpad("rows", 6)}${lpad("pre-snap", 9)}${lpad("short by", 9)}  oldest       yahoo route`);
  const fails: { sector: string; index: string; shortBy: number; rows: number; oldest: string | null; yahoo: boolean }[] = [];
  for (const [sector, idx] of Object.entries(SECTOR_INDEX_MAP)) {
    const [r] = await raw(
      `SELECT count(*)::int total,
              count(*) FILTER (WHERE "date" <= DATE '${SNAP}')::int pre,
              min("date")::text oldest FROM index_prices WHERE "index_name" = $1`, idx);
    const pre = Number(r.pre);
    const shortBy = Math.max(NEED - pre, 0);
    const has = YAHOO_INDEX_MAP.has(idx);
    if (shortBy > 0) fails.push({ sector, index: idx, shortBy, rows: Number(r.total), oldest: r.oldest as string | null, yahoo: has });
    console.log(
      `  ${pad(sector, 30)}${pad(idx, 40)}${lpad(r.total, 6)}${lpad(pre, 9)}${lpad(shortBy === 0 ? "ok" : shortBy, 9)}  ${pad(r.oldest ?? "—", 12)} ${has ? "YES" : "no"}`);
  }
  console.log(`\n  → ${fails.length} of ${Object.keys(SECTOR_INDEX_MAP).length} sector indices cannot resolve. Of those, ${fails.filter((f) => f.rows === 0).length} hold ZERO bars at all.`);
  console.log(`  → ${fails.filter((f) => f.yahoo).length} of the ${fails.length} have a Yahoo ticker in backfill-index-yahoo.ts INDEX_MAP.`);
  console.log(`\n  DEPTH EACH NEEDS (bars at/before ${SNAP}; ${NEED} required):`);
  for (const f of fails.sort((a, b) => b.shortBy - a.shortBy)) {
    const note = f.rows === 0 ? `no bars at all — needs full history back to ≈2021-07-29`
      : `has ${f.rows} bars from ${f.oldest} — needs ${f.shortBy} more, back to ≈2021-07-29`;
    console.log(`    ${pad(f.index, 40)} short ${lpad(f.shortBy, 4)}  ${note}`);
    console.log(`      ${pad("", 40)} route: ${f.yahoo ? "Yahoo INDEX_MAP" : "NO ROUTE — not in Yahoo INDEX_MAP, and NSE caps at 365d"}`);
  }

  console.log(`\n  PROVIDER SPLIT — where the existing depth came from:`);
  const prov = await raw(
    `SELECT "provider", count(*)::int rows, count(DISTINCT "index_name")::int indices,
            min("date")::text oldest, max("date")::text newest FROM index_prices GROUP BY 1 ORDER BY 2 DESC`);
  for (const p of prov) console.log(`    ${pad(p.provider, 20)} rows=${lpad(p.rows, 7)} indices=${lpad(p.indices, 4)} ${p.oldest} → ${p.newest}`);

  console.log(`\n  ⚠ THE 365-DAY CAP — CONFIRMED, NOT CHANGED:`);
  console.log(`     schema/schema.ts:75-77   IndexBackfillSchema = { days: z.number().int().min(1).max(365).default(365) }`);
  console.log(`     → POST /api/v1/admin/indices/backfill rejects days>365 with a 400 (indices-controllers.ts:171).`);
  console.log(`     ingest-indices.ts:325    runIndexBackfill(daysBack = 365, …) — a DEFAULT, not a hard cap;`);
  console.log(`     → the handler (index-ingest.handler.ts:48) passes payload.days straight through, so the`);
  console.log(`       only real fence is the zod max on the HTTP route.`);
  console.log(`     RAISING IT WOULD TOUCH: (1) schema/schema.ts IndexBackfillSchema max; (2) nothing else in code —`);
  console.log(`       but operationally each extra day is one NSE ind_close_all archive fetch with a 500 ms delay`);
  console.log(`       (ingest-indices.ts:355), so ~1300 weekdays back to 2021-07 ≈ 11 min of pure sleep plus fetch`);
  console.log(`       time, and NSE archive availability that far back is unverified. It writes ALL indices per`);
  console.log(`       date in one archive, so one deep run fixes all 11 at once — unlike Yahoo, which is per-ticker.`);
  console.log(`     NOT CHANGED — reported only.`);

  // ════════════════════════════════════════════════════════════
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ S1.4d — THE 44 STOCKS BELOW THE OWNERSHIP FLOOR OF 8 QUARTER-ENDS         ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const isQE = `(sp."as_on_date" = (date_trunc('quarter', sp."as_on_date") + interval '3 months - 1 day')::date)`;
  const below = await raw(
    `WITH per AS (
       SELECT st."symbol", st."name", sec."name" sector,
              count(sp."id")::int rows,
              count(sp."id") FILTER (WHERE ${isQE})::int qe,
              count(sp."id") FILTER (WHERE NOT ${isQE})::int interim,
              max(sp."as_on_date")::text newest, min(sp."as_on_date")::text oldest
         FROM stocks st
         LEFT JOIN shareholding_patterns sp ON sp."stock_id" = st."id"
         LEFT JOIN sectors sec ON sec."id" = st."sector_id"
        GROUP BY st."symbol", st."name", sec."name")
     SELECT * FROM per WHERE qe < 8 ORDER BY qe ASC, rows ASC, "symbol"`);
  console.log(`  ${pad("symbol", 16)}${lpad("QE", 4)}${lpad("intrm", 7)}${lpad("rows", 6)}  ${pad("sector", 28)}oldest       newest`);
  for (const r of below) {
    console.log(`  ${pad(r.symbol, 16)}${lpad(r.qe, 4)}${lpad(r.interim, 7)}${lpad(r.rows, 6)}  ${pad(r.sector ?? "—", 28)}${pad(r.oldest ?? "—", 13)}${r.newest ?? "—"}`);
  }
  console.log(`  → ${below.length} stocks. Ownership floor_reason: "Ownership baseline reads 8 consecutive trailing quarters".`);
  console.log(`    These are unscoreable on Ownership TODAY, not merely historically.`);

  // ════════════════════════════════════════════════════════════
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ S1.4e — RANKING: which single backfill unblocks the most                  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const [shReach] = await raw(
    `WITH per AS (SELECT "stock_id", count(*) FILTER (WHERE "as_on_date" <= DATE '2021-12-31')::int pre FROM shareholding_patterns GROUP BY 1)
     SELECT count(*)::int stocks, count(*) FILTER (WHERE pre = 0)::int no_pre FROM per`);
  const [qReach] = await raw(
    `WITH per AS (SELECT "stock_id", count(*) FILTER (WHERE "report_date" <= DATE '${SNAP}')::int pre FROM quarterly_results GROUP BY 1)
     SELECT count(*)::int stocks, count(*) FILTER (WHERE pre = 0)::int no_pre FROM per`);
  const [dpReach] = await raw(
    `WITH per AS (SELECT "stock_id", min("date")::date o FROM daily_prices GROUP BY 1)
     SELECT count(*)::int stocks, count(*) FILTER (WHERE o > DATE '${SNAP}')::int no_pre FROM per`);
  const rows = [
    { feed: "daily_prices (Yahoo, --years 7)", blocked: Number(dpReach.no_pre), of: Number(dpReach.stocks), route: "yahoo-price-backfill.ts — exists, parameterised", unblocks: "Market A1/A2/B1/B2/B3/C1/D1 + regime pool fallback" },
    { feed: "shareholding_patterns", blocked: Number(shReach.no_pre), of: Number(shReach.stocks), route: "no deep route in repo — source-dependent", unblocks: "Ownership baseline (8 trailing quarters)" },
    { feed: "quarterly_results", blocked: Number(qReach.no_pre), of: Number(qReach.stocks), route: "results ingest — per stock/quarter", unblocks: "Momentum M3/M4 L3 (13 quarters)" },
    { feed: `index_prices (${fails.length} sector indices)`, blocked: fails.length, of: Object.keys(SECTOR_INDEX_MAP).length, route: `Yahoo covers ${fails.filter((f) => f.yahoo).length}/${fails.length}; NSE capped at 365d`, unblocks: "regime stamp on findings (best-effort, try/catch)" },
  ];
  console.log(`  ${pad("feed", 40)}${lpad("blocked", 9)}${lpad("of", 6)}  ${pad("route", 46)}unblocks`);
  for (const r of rows.sort((a, b) => b.blocked / b.of - a.blocked / a.of)) {
    console.log(`  ${pad(r.feed, 40)}${lpad(r.blocked, 9)}${lpad(r.of, 6)}  ${pad(r.route, 46)}${r.unblocks}`);
  }
  console.log(`\n  (READ-ONLY: SELECTs only.)\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
