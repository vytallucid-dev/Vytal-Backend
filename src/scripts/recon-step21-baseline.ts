// STEP 21 GATE 0 item 7 — READ-ONLY baselines + byte-identical fingerprints. No writes.
// Order-independent row fingerprint: SUM of per-row 32-bit md5 hashes over the whole row text.
// Re-run at Gate 3; any change to a "must be byte-identical" table moves its (count, fp) pair.
import { prisma } from "../db/prisma.js";
const q = <T = any>(sql: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...p);
const j = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2);

async function fp(table: string) {
  const r = await q(
    `SELECT COUNT(*)::bigint AS rows,
            COALESCE(SUM(('x'||substr(md5(t::text),1,8))::bit(32)::bigint),0)::bigint AS fingerprint
     FROM ${table} t`,
  );
  return { table, ...r[0] };
}

async function main() {
  const size = await q(`SELECT pg_size_pretty(pg_database_size(current_database())) AS db,
                               pg_database_size(current_database())::bigint AS bytes`);
  console.log("=== DB SIZE ===\n" + j(size));

  // ── BYTE-IDENTICAL FINGERPRINTS (the tables this feature must NOT touch) ──
  const fps = [];
  for (const t of ["mf_analytics", "daily_prices", "stock_prices", "score_snapshots",
                   "market_cap_tier_snapshot", "instruments", "instrument_corporate_events",
                   "instrument_prices", "index_prices"]) {
    fps.push(await fp(t));
  }
  console.log("\n=== FINGERPRINTS ===\n" + j(fps));

  // ── 504 SCORED STOCKS fingerprint (latest score per stock) ──
  const scored = await q(`
    SELECT COUNT(*)::int AS scored_stocks,
           COALESCE(SUM(('x'||substr(md5(composite::text||label_band),1,8))::bit(32)::bigint),0)::bigint AS fp
    FROM (SELECT DISTINCT ON (stock_id) stock_id, composite, label_band
          FROM score_snapshots ORDER BY stock_id, as_of_date DESC, version DESC) s`);
  console.log("\n=== SCORED-STOCK FINGERPRINT ===\n" + j(scored));

  // ── TEST USERS: whoever has transactions — + latest PHS (phs, total_value, fingerprint) + broker rows ──
  const users = await q(`
    WITH u AS (SELECT DISTINCT user_id FROM transactions),
    tx AS (SELECT user_id, COUNT(*)::int AS txns, COUNT(DISTINCT instrument_id)::int AS instruments
           FROM transactions GROUP BY user_id),
    phs AS (SELECT DISTINCT ON (user_id) user_id, phs, band, total_value, scored_value,
                   coverage, fingerprint, created_at
            FROM portfolio_health_snapshot ORDER BY user_id, created_at DESC),
    bh AS (SELECT user_id, COUNT(*)::int AS broker_rows FROM broker_holdings GROUP BY user_id)
    SELECT u.user_id, tx.txns, tx.instruments,
           phs.phs, phs.band, phs.total_value::text AS phs_total_value,
           phs.coverage::text AS coverage, phs.fingerprint AS phs_fp,
           COALESCE(bh.broker_rows,0) AS broker_rows
    FROM u
    LEFT JOIN tx ON tx.user_id=u.user_id
    LEFT JOIN phs ON phs.user_id=u.user_id
    LEFT JOIN bh ON bh.user_id=u.user_id
    ORDER BY tx.txns DESC NULLS LAST`);
  console.log("\n=== TEST USERS (txns + latest PHS + broker rows) ===\n" + j(users));

  // ── LEDGER-BOOK VALUE per user (manual/ledger only, resolvePrice precedence in SQL) ──
  // This is what the chart's live-pinned final point must equal on a manual book.
  // stock → latest stock_prices.price ; non-stock → last_price(>0) else current_nav(if active).
  const ledgerVal = await q(`
    WITH pos AS (
      SELECT t.user_id, t.instrument_id, t.stock_id,
             SUM(CASE WHEN t.type='buy' THEN COALESCE(t.quantity,0)
                      WHEN t.type='sell' THEN -COALESCE(t.quantity,0)
                      WHEN t.type IN ('split','bonus') THEN 0 ELSE 0 END) AS net_qty
      FROM transactions t GROUP BY t.user_id, t.instrument_id, t.stock_id),
    sp AS (SELECT DISTINCT ON (stock_id) stock_id, price FROM stock_prices ORDER BY stock_id, price_date DESC)
    SELECT p.user_id,
           COUNT(*) FILTER (WHERE p.net_qty>0)::int AS open_positions,
           ROUND(SUM(
             p.net_qty * COALESCE(
               sp.price,
               NULLIF(i.last_price,0),
               CASE WHEN i.is_active THEN i.current_nav END
             )
           ) FILTER (WHERE p.net_qty>0), 2)::text AS ledger_book_value,
           COUNT(*) FILTER (WHERE p.net_qty>0 AND sp.price IS NULL
                            AND COALESCE(NULLIF(i.last_price,0),
                                CASE WHEN i.is_active THEN i.current_nav END) IS NULL)::int AS unpriced_positions
    FROM pos p
    LEFT JOIN sp ON sp.stock_id=p.stock_id
    LEFT JOIN instruments i ON i.id=p.instrument_id
    GROUP BY p.user_id ORDER BY ledger_book_value DESC NULLS LAST`);
  console.log("\n=== LEDGER-BOOK VALUE per user (manual book, resolvePrice precedence) ===\n" + j(ledgerVal));
}

main().catch((e) => { console.error("RECON ERROR:", e.message); process.exit(1); })
     .finally(() => prisma.$disconnect());
