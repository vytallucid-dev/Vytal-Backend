// STEP 21 GATE 0 — READ-ONLY recon. No writes. Baselines + sizing for the weekly non-stock series store.
import { prisma } from "../db/prisma.js";

const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
const j = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2);

async function main() {
  // ── 1. DB SIZE + HEADROOM ──
  const dbSize = await q(`SELECT pg_database_size(current_database())::bigint AS bytes,
                                 pg_size_pretty(pg_database_size(current_database())) AS pretty`);
  console.log("\n=== 1. DB SIZE ===\n" + j(dbSize));

  // ── 2. TOP TABLE SIZES ──
  const tbls = await q(`
    SELECT relname AS table,
           pg_total_relation_size(c.oid)::bigint AS total_bytes,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS total_pretty,
           pg_size_pretty(pg_relation_size(c.oid)) AS heap_pretty,
           pg_size_pretty(pg_indexes_size(c.oid)) AS idx_pretty,
           c.reltuples::bigint AS est_rows
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
    ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 15`);
  console.log("\n=== 2. TOP 15 TABLES ===\n" + j(tbls));

  // ── 3. instrument_prices: depth per class ──
  const ipOverall = await q(`
    SELECT COUNT(*)::int AS rows, COUNT(DISTINCT instrument_id)::int AS instruments,
           MIN(date)::text AS min_date, MAX(date)::text AS max_date,
           COUNT(DISTINCT date)::int AS distinct_dates
    FROM instrument_prices`);
  console.log("\n=== 3a. instrument_prices OVERALL ===\n" + j(ipOverall));

  const ipByClass = await q(`
    SELECT i.asset_class,
           COUNT(*)::int AS price_rows,
           COUNT(DISTINCT ip.instrument_id)::int AS instruments_priced,
           MIN(ip.date)::text AS min_date, MAX(ip.date)::text AS max_date,
           COUNT(DISTINCT ip.date)::int AS distinct_dates
    FROM instrument_prices ip JOIN instruments i ON i.id=ip.instrument_id
    GROUP BY i.asset_class ORDER BY price_rows DESC`);
  console.log("\n=== 3b. instrument_prices BY CLASS ===\n" + j(ipByClass));

  // bytes/row reference for instrument_prices (heap+index)
  const ipSize = await q(`
    SELECT pg_total_relation_size('instrument_prices')::bigint AS total_bytes,
           (SELECT COUNT(*) FROM instrument_prices)::bigint AS rows`);
  console.log("\n=== 3c. instrument_prices bytes/row ref ===\n" + j(ipSize));

  // ── 4. daily_prices (stock side) for contrast ──
  const dp = await q(`
    SELECT COUNT(*)::int AS rows, COUNT(DISTINCT stock_id)::int AS stocks,
           MIN(date)::text AS min_date, MAX(date)::text AS max_date
    FROM daily_prices`);
  console.log("\n=== 4. daily_prices (stock side) ===\n" + j(dp));

  // ── 5. CATALOGUE by asset_class ──
  const cat = await q(`
    SELECT asset_class, COUNT(*)::int AS n,
           SUM(CASE WHEN amfi_scheme_code IS NOT NULL THEN 1 ELSE 0 END)::int AS with_amfi_code
    FROM instruments GROUP BY asset_class ORDER BY n DESC`);
  console.log("\n=== 5. CATALOGUE by class ===\n" + j(cat));

  // ── 6. HELD instruments (the thing that decides sizing) ──
  // 6a. distinct instruments EVER transacted, by class + stock/non-stock
  const txnAll = await q(`
    SELECT i.asset_class,
           COUNT(DISTINCT t.instrument_id)::int AS distinct_instruments,
           COUNT(*)::int AS txns,
           COUNT(DISTINCT t.user_id)::int AS users
    FROM transactions t JOIN instruments i ON i.id=t.instrument_id
    GROUP BY i.asset_class ORDER BY distinct_instruments DESC`);
  console.log("\n=== 6a. transacted instruments BY CLASS (ever) ===\n" + j(txnAll));

  // 6b. NET-HELD non-stock instruments (signed qty > 0), by class
  const held = await q(`
    WITH pos AS (
      SELECT t.instrument_id,
             SUM(CASE WHEN t.type='buy' THEN COALESCE(t.quantity,0)
                      WHEN t.type='sell' THEN -COALESCE(t.quantity,0) ELSE 0 END) AS net_qty
      FROM transactions t GROUP BY t.instrument_id)
    SELECT i.asset_class,
           COUNT(*) FILTER (WHERE pos.net_qty > 0)::int AS net_held_instruments
    FROM pos JOIN instruments i ON i.id=pos.instrument_id
    GROUP BY i.asset_class ORDER BY net_held_instruments DESC`);
  console.log("\n=== 6b. NET-HELD instruments BY CLASS ===\n" + j(held));

  // 6c. distinct NON-STOCK instruments transacted (the backfill demand set), total
  const nonStock = await q(`
    SELECT COUNT(DISTINCT t.instrument_id)::int AS distinct_nonstock_transacted
    FROM transactions t JOIN instruments i ON i.id=t.instrument_id
    WHERE i.asset_class <> 'stock'`);
  console.log("\n=== 6c. distinct NON-STOCK transacted (backfill demand) ===\n" + j(nonStock));

  // ── 7. mf_analytics context ──
  const mfa = await q(`SELECT COUNT(*)::int AS rows FROM mf_analytics`);
  console.log("\n=== 7. mf_analytics rows ===\n" + j(mfa));

  // ── 8. instrument_corporate_events (rescale source) coverage ──
  const ice = await q(`
    SELECT event_type, COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE applied_date IS NOT NULL)::int AS reconciled
    FROM instrument_corporate_events GROUP BY event_type ORDER BY n DESC`);
  console.log("\n=== 8. instrument_corporate_events ===\n" + j(ice));
}

main().catch((e) => { console.error("RECON ERROR:", e); process.exit(1); })
     .finally(() => prisma.$disconnect());
