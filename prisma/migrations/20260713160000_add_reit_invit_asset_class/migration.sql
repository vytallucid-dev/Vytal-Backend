-- ═══════════════════════════════════════════════════════════════
-- REIT / InvIT ASSET CLASSES (Step 14) — the enum learns two new kinds of holdable thing.
--
-- A listed REIT (NSE series RR) and a listed InvIT (NSE series IV) are TRUSTS, not equities:
-- they trade like a stock (order book, OHLCV, an exchange ticker) but they are not companies,
-- have no shareholding pattern, no quarterly P&L in the shape our fundamentals expect, and
-- therefore no peer group and NO SCORE. They are HELD-NOT-SCORED — exactly like an ETF, and
-- for the same structural reason: `stock_id` stays NULL, so the scoring universe
-- (PeerGroup → StockPeerGroup → Stock) can never see them.
--
-- Why TWO values and not one `trust`: the two are different instruments with different
-- underlyings (real estate vs infrastructure), different regulators' schedules, and — the
-- reason that actually forces it — the SOURCE distinguishes them (SctySrs RR vs IV). Folding
-- them into one class would DESTROY information the feed hands us for free, and we would have
-- to re-derive it later from the name, which is exactly the 50.5%-precision trap the ETF
-- section-header lesson taught us (see 20260713120000 / ingest-amfi's section filter).
--
-- THIS MIGRATION IS DELIBERATELY ALONE IN ITS TRANSACTION.
-- Postgres lets `ALTER TYPE … ADD VALUE` run inside a tx block (PG12+), but the new label
-- CANNOT BE USED until that tx COMMITS. Any INSERT/UPDATE casting to 'reit'/'invit' must
-- therefore happen in a LATER transaction — which it does: the catalogue load is a runtime
-- ingest, long after this has committed. Do not merge this file with a data migration.
--
-- IF NOT EXISTS makes the whole thing idempotent — a re-apply is a no-op, not an error.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL, then `migrate resolve --applied`.
-- ═══════════════════════════════════════════════════════════════

ALTER TYPE "AssetClass" ADD VALUE IF NOT EXISTS 'reit';
ALTER TYPE "AssetClass" ADD VALUE IF NOT EXISTS 'invit';
