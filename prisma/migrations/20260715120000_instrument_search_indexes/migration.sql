-- ═══════════════════════════════════════════════════════════════════════════
-- INSTRUMENT SEARCH INDEXES — make /api/v1/instruments/search index-backed, not a per-keystroke
-- sequential scan of the ~19,000-row catalogue.
--
-- THE READ THIS SERVES (all fully parameterized in instrument-search.ts):
--     WHERE isin = $q  OR  symbol = $q  OR  name ILIKE '%q%'
--   ranked by (exact-isin → exact-symbol → name-prefix → name-contains), then active-first, then
--   ticker-bearing-first, then (name, isin).
--
-- WHY THESE INDEXES. Measured live before this migration — instruments carries only isin(unique),
-- pkey, stock_id(unique), asset_class(btree), amfi_scheme_code(btree). So of the three WHERE arms:
--   · isin = $q          → served by instruments_isin_key (unique). Already fine.
--   · symbol = $q        → SEQ SCAN. No index on symbol.
--   · name ILIKE '%q%'   → SEQ SCAN. A leading-wildcard ILIKE cannot use a btree at all.
-- With any arm un-indexed, Postgres cannot BitmapOr and falls back to a full seq scan of ~19k rows
-- on EVERY keystroke. The two indexes below give all three arms an index path, so the planner can
-- BitmapOr them into a bitmap-heap scan of just the matches.
--
--   1. pg_trgm GIN on `name` — the only index type that accelerates a substring (leading-wildcard)
--      ILIKE. A trigram is 3 chars, which is exactly why the endpoint's minimum q length is 3: below
--      it the index cannot be selective and the scan would degrade to the seq scan this replaces.
--      gin_trgm_ops serves ILIKE case-insensitively, so no lower(name) functional index is needed.
--
--   2. btree on `symbol` — the exact-symbol arm (tier 1). Small: only the ~1,400 ticker-bearing rows
--      carry a symbol (every one of the 17,567 funds has NULL), and equality never matches a NULL.
--      Modeled in schema.prisma as @@index([symbol]) → this exact index; no drift.
--
-- ⚠️  THE TRIGRAM INDEX IS MIGRATION-ONLY. Prisma cannot express `gin_trgm_ops` without the
--     postgresqlExtensions preview feature (not enabled here — this repo hand-authors migrations and
--     `migrate resolve`s them). It is therefore NOT in schema.prisma. A future `prisma migrate dev`
--     would see it as drift and try to DROP it — DO NOT. It is load-bearing for the search.
--
-- ZERO DATA CHANGE: an index is a lookup structure, not the data. No row, value, or fingerprint moves.
-- LOCKING: plain (non-CONCURRENT) CREATE INDEX so the whole file stays inside the one BEGIN/COMMIT of
-- apply-migration-direct.ts (CONCURRENTLY cannot run in a transaction). It takes a brief SHARE lock —
-- a non-event pre-launch on ~19k rows, and reads are never blocked. Same call as
-- 20260713150000_drop_redundant_indexes made in the other direction.
--
-- REVERSIBLE: DROP INDEX "instruments_name_trgm_idx"; DROP INDEX "instruments_symbol_idx"; and the
-- extension may be left in place or `DROP EXTENSION pg_trgm;` if nothing else uses it.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL via apply-migration-direct.ts, then
-- `prisma migrate resolve --applied 20260715120000_instrument_search_indexes`.
-- ═══════════════════════════════════════════════════════════════════════════

-- Installed into public so gin_trgm_ops resolves on the default search_path (recon: not yet installed).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- (1) Substring search over the display name (funds, bonds, everything). Backs `name ILIKE '%q%'`.
CREATE INDEX "instruments_name_trgm_idx" ON "instruments" USING gin ("name" gin_trgm_ops);

-- (2) Exact-symbol lookup (tier 1). Matches schema.prisma @@index([symbol]).
CREATE INDEX "instruments_symbol_idx" ON "instruments" ("symbol");
