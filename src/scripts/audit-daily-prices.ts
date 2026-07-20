// DAILY_PRICES DEPTH AUDIT — READ-ONLY. Nothing is dropped, nothing is written.
// npx tsx src/scripts/audit-daily-prices.ts
//
// Confirm WHAT THE TABLE HOLDS before touching its indexes. An index drop is only safe if we
// understand the access shape it serves.
import { prisma } from "../db/prisma.js";

const hdr = (s: string) => console.log(`\n${"═".repeat(76)}\n${s}\n${"═".repeat(76)}`);

// ── 1. TOTAL SPAN ────────────────────────────────────────────
hdr("1. TOTAL SPAN");
const span = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) rows, count(DISTINCT stock_id) stocks, count(DISTINCT date) dates,
         min(date) mn, max(date) mx
  FROM daily_prices`);
const s = span[0];
const years = (new Date(s.mx).getTime() - new Date(s.mn).getTime()) / (365.25 * 86400000);
console.log(`  rows            : ${Number(s.rows).toLocaleString()}`);
console.log(`  distinct stocks : ${s.stocks}`);
console.log(`  distinct dates  : ${s.dates}   (trading days present in the table)`);
console.log(`  span            : ${String(s.mn).slice(4, 15)} → ${String(s.mx).slice(4, 15)}  (${years.toFixed(2)} y)`);
console.log(`  expected trading days for a fully-covered stock ≈ ${Math.round(years * 250)}`);
console.log(`  actual distinct dates                            = ${s.dates}`);
const ratio = Number(s.dates) / (years * 250);
console.log(`  ⇒ coverage of the trading calendar: ${(ratio * 100).toFixed(0)}%  ${ratio > 0.95 ? "✅ complete" : ratio > 0.8 ? "⚠️ some days missing" : "❌ sparse"}`);
console.log(`\n  if every stock had every date: ${s.stocks} × ${s.dates} = ${(Number(s.stocks) * Number(s.dates)).toLocaleString()} rows`);
console.log(`  actual rows                  : ${Number(s.rows).toLocaleString()}  (${((Number(s.rows) / (Number(s.stocks) * Number(s.dates))) * 100).toFixed(0)}% dense)`);

// ── 2. PER-STOCK DEPTH ───────────────────────────────────────
hdr("2. PER-STOCK DEPTH — uniform or ragged?");
const depth = await prisma.$queryRawUnsafe<any[]>(`
  WITH d AS (
    SELECT stock_id, count(*) n, min(date) mn, max(date) mx FROM daily_prices GROUP BY 1
  )
  SELECT min(n) mn, max(n) mx, round(avg(n)) avg,
         percentile_cont(0.05) WITHIN GROUP (ORDER BY n) p05,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY n) p25,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY n) p50,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY n) p75,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY n) p95,
         count(*) stocks
  FROM d`);
const d = depth[0];
console.log(`  stocks with any price row: ${d.stocks}`);
console.log(`  rows per stock:`);
console.log(`    min  ${String(d.mn).padStart(5)}`);
console.log(`    p05  ${String(Math.round(d.p05)).padStart(5)}`);
console.log(`    p25  ${String(Math.round(d.p25)).padStart(5)}`);
console.log(`    p50  ${String(Math.round(d.p50)).padStart(5)}   ← median`);
console.log(`    p75  ${String(Math.round(d.p75)).padStart(5)}`);
console.log(`    p95  ${String(Math.round(d.p95)).padStart(5)}`);
console.log(`    max  ${String(d.mx).padStart(5)}`);
console.log(`    avg  ${String(d.avg).padStart(5)}`);
const spread = Number(d.mx) / Math.max(1, Number(d.mn));
console.log(`\n  ⇒ ${Number(d.p05) / Number(d.p95) > 0.8 ? "UNIFORM — every stock carries roughly the same depth" : "RAGGED — depth varies materially across stocks"}`);
console.log(`    (max/min = ${spread.toFixed(1)}×)`);

// ── 3. HISTOGRAM ─────────────────────────────────────────────
hdr("3. HISTOGRAM — how many stocks have how much history?");
const hist = await prisma.$queryRawUnsafe<any[]>(`
  WITH d AS (SELECT stock_id, count(*) n FROM daily_prices GROUP BY 1)
  SELECT CASE
    WHEN n < 250  THEN 'a. < 1 yr    (<250 rows)'
    WHEN n < 750  THEN 'b. 1–3 yr    (250–749)'
    WHEN n < 1250 THEN 'c. 3–5 yr    (750–1249)'
    WHEN n < 2500 THEN 'd. 5–10 yr   (1250–2499)'
    ELSE               'e. 10 yr+    (2500+)'
  END bucket, count(*) stocks, min(n) mn, max(n) mx
  FROM d GROUP BY 1 ORDER BY 1`);
for (const h of hist) {
  const bar = "█".repeat(Math.max(1, Math.round(Number(h.stocks) / 8)));
  console.log(`  ${String(h.bucket).padEnd(26)} ${String(h.stocks).padStart(4)} stocks  (${h.mn}–${h.mx} rows)  ${bar}`);
}

// Stocks in the universe with ZERO price rows.
const zero = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n FROM stocks st
  WHERE NOT EXISTS (SELECT 1 FROM daily_prices dp WHERE dp.stock_id = st.id)`);
const totalStocks = await prisma.stock.count();
console.log(`\n  stocks table       : ${totalStocks}`);
console.log(`  with price history : ${d.stocks}`);
console.log(`  with ZERO rows     : ${zero[0].n}  ${Number(zero[0].n) === 0 ? "✅" : "⚠️ these stocks have no prices at all"}`);

// ── 4. ANOMALIES ─────────────────────────────────────────────
hdr("4. ANOMALIES");
const dup = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n FROM (
    SELECT stock_id, date FROM daily_prices GROUP BY 1,2 HAVING count(*) > 1
  ) x`);
console.log(`  duplicate (stock_id, date): ${dup[0].n}  ${Number(dup[0].n) === 0 ? "✅ the unique index holds" : "❌ IMPOSSIBLE — investigate"}`);

// Mid-history gaps: a stock whose row count is far below the dates available in ITS OWN span.
const gaps = await prisma.$queryRawUnsafe<any[]>(`
  WITH d AS (SELECT stock_id, count(*) n, min(date) mn, max(date) mx FROM daily_prices GROUP BY 1),
  cal AS (SELECT DISTINCT date FROM daily_prices)
  SELECT d.stock_id, d.n, d.mn, d.mx,
         (SELECT count(*) FROM cal WHERE cal.date BETWEEN d.mn AND d.mx) expected,
         round(100.0 * d.n / NULLIF((SELECT count(*) FROM cal WHERE cal.date BETWEEN d.mn AND d.mx),0), 1) pct
  FROM d
  ORDER BY pct ASC NULLS LAST LIMIT 8`);
console.log(`\n  worst intra-span coverage (rows present vs trading days INSIDE the stock's own span):`);
for (const g of gaps) {
  const st = await prisma.stock.findUnique({ where: { id: g.stock_id }, select: { symbol: true } });
  console.log(
    `    ${String(st?.symbol ?? "?").padEnd(14)} ${String(g.n).padStart(5)}/${String(g.expected).padStart(5)} = ${String(g.pct).padStart(5)}%  ` +
      `${String(g.mn).slice(4, 15)} → ${String(g.mx).slice(4, 15)}`,
  );
}
const holey = await prisma.$queryRawUnsafe<any[]>(`
  WITH d AS (SELECT stock_id, count(*) n, min(date) mn, max(date) mx FROM daily_prices GROUP BY 1),
  cal AS (SELECT DISTINCT date FROM daily_prices)
  SELECT count(*) n FROM d
  WHERE d.n < 0.9 * (SELECT count(*) FROM cal WHERE cal.date BETWEEN d.mn AND d.mx)`);
console.log(`\n  stocks missing >10% of the trading days inside their own span: ${holey[0].n}`);

// ── 5. STORAGE + THE DROP TARGETS ────────────────────────────
hdr("5. STORAGE — and the 4 drop targets, RE-CONFIRMED from live pg_stat");
const size = await prisma.$queryRawUnsafe<any[]>(`
  SELECT pg_size_pretty(pg_total_relation_size('daily_prices')) tot,
         pg_size_pretty(pg_relation_size('daily_prices')) heap,
         pg_size_pretty(pg_indexes_size('daily_prices')) idx,
         pg_total_relation_size('daily_prices') b`);
console.log(`  daily_prices: ${size[0].tot}  (heap ${size[0].heap} + indexes ${size[0].idx})`);
const db = await prisma.$queryRawUnsafe<any[]>(
  `SELECT pg_size_pretty(pg_database_size(current_database())) s, pg_database_size(current_database()) b`);
console.log(`  database    : ${db[0].s}`);

const DROP = new Set([
  "daily_prices_stock_id_date_idx",
  "daily_prices_stock_id_idx",
  "index_prices_index_name_date_idx",
  "index_prices_index_name_idx",
]);
const idx = await prisma.$queryRawUnsafe<any[]>(`
  SELECT relname tbl, indexrelname ix, idx_scan, idx_tup_read,
         pg_relation_size(indexrelid) b, pg_size_pretty(pg_relation_size(indexrelid)) sz
  FROM pg_stat_user_indexes
  WHERE relname IN ('daily_prices','index_prices')
  ORDER BY relname, idx_scan DESC`);
console.log(`\n  ${"table".padEnd(13)} ${"index".padEnd(34)} ${"size".padStart(8)} ${"scans".padStart(9)}  verdict`);
let reclaim = 0;
for (const x of idx) {
  const drop = DROP.has(x.ix);
  if (drop) reclaim += Number(x.b);
  console.log(
    `  ${String(x.tbl).padEnd(13)} ${String(x.ix).padEnd(34)} ${String(x.sz).padStart(8)} ${String(x.idx_scan).padStart(9)}  ` +
      (drop ? "🔻 DROP" : "✅ KEEP"),
  );
}
console.log(`\n  RECLAIM if the 4 are dropped: ${(reclaim / 1e6).toFixed(1)} MB`);
console.log(`  DB ${db[0].s} → ~${((Number(db[0].b) - reclaim) / 1048576).toFixed(0)} MB`);

// ── 6. THE PLANNER — is the DESC index still bypassed? ───────
hdr("6. THE PLANNER — re-confirm the drop is safe");
const one = await prisma.$queryRawUnsafe<any[]>(`SELECT stock_id FROM daily_prices LIMIT 1`);
const sid = one[0].stock_id;
const plan = await prisma.$queryRawUnsafe<any[]>(
  `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM daily_prices WHERE stock_id = $1 ORDER BY date DESC LIMIT 250`,
  sid,
);
console.log(`  hot path: WHERE stock_id=? ORDER BY date DESC LIMIT 250`);
for (const p of plan) console.log(`    ${Object.values(p)[0]}`);
const usesUnique = plan.some((p) => String(Object.values(p)[0]).includes("daily_prices_stock_id_date_key"));
const usesDesc = plan.some((p) => String(Object.values(p)[0]).includes("daily_prices_stock_id_date_idx"));
console.log(`\n  ${usesUnique ? "✅" : "❌"} planner uses the UNIQUE index (backward scan)`);
console.log(`  ${!usesDesc ? "✅" : "❌"} planner does NOT touch the DESC index  ⇒ dropping it is safe`);

// The index_prices hot path too (the risk-free read).
const plan2 = await prisma.$queryRawUnsafe<any[]>(
  `EXPLAIN (ANALYZE) SELECT * FROM index_prices WHERE index_name = 'Nifty 1D Rate Index' ORDER BY date ASC`,
);
console.log(`\n  index_prices hot path: WHERE index_name=? ORDER BY date ASC   (the risk-free read)`);
for (const p of plan2.slice(0, 3)) console.log(`    ${Object.values(p)[0]}`);

await prisma.$disconnect();
