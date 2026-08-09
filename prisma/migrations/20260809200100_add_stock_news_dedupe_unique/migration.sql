-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The press dedupe constraint. RUN ONLY AFTER backfill-news-dedupe-key.ts has collapsed the 678
-- pre-existing duplicates — see 20260809200000_add_stock_news_dedupe_key for the required order.
--
-- NULL-EXEMPT BY DESIGN: Postgres treats NULLs as distinct in a unique index, so every
-- nse_announcement row (dedupe_key IS NULL, keyed by NSE's non-drifting seq_id) and any press row
-- with an unkeyable headline is unaffected. An unkeyable row is STORED, never silently dropped.
--
-- The ingest relies on this constraint rather than a read-then-write: insertGoogleNewsItem already
-- catches P2002 and returns "skipped", so the database is the arbiter and two concurrent ingest runs
-- cannot race past each other.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "stock_news_stock_id_dedupe_key_key"
  ON "stock_news" ("stock_id", "dedupe_key");
