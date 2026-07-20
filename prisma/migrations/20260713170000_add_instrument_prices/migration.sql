-- ═══════════════════════════════════════════════════════════════
-- INSTRUMENT PRICES (Step 14) — the price spine finally reaches a NON-STOCK instrument.
--
-- THE PROBLEM THIS FIXES (Gate-0 recon, measured live):
--   `daily_prices.stock_id` is NOT NULL → FK `stocks`. `stock_prices` is UNIQUE(stock_id).
--   `ingest-prices.loadUniverse()` reads `stocks`, and any bhavcopy row whose SYMBOL is not in
--   that map is SKIPPED. So a catalogue row with `stock_id` NULL can NEVER receive a price.
--   Proof: of the 337 ETFs loaded in Step 13, the number appearing in `daily_prices` is ZERO.
--   Step 13 did NOT make prices reach instrument rows — ETFs are held-not-VALUED today, and a
--   REIT loaded the same way would be a name and a quantity with no ₹ next to it. Useless.
--
-- THE FIX, AND ITS DELIBERATE BOUNDARY:
--   A SECOND, PARALLEL price sink keyed on `instrument_id`. It is a MIRROR of `daily_prices`
--   (same columns, same precision, same append-only unique key) — not a generalisation of it.
--   `daily_prices` / `stock_prices` are NOT TOUCHED: not one column, not one row, not one index.
--   That is the whole point. The equity path feeds scoring, NAV/TWR/XIRR, market-cap and the
--   504-stock fingerprint; widening it to nullable-stock_id would put every one of those on the
--   table for a 17-row feature. The unification (one spine for all classes) is a real and
--   correct future step — it is just not THIS step, and it must not be smuggled in as one.
--
--   Precision mirrors `daily_prices` EXACTLY — DECIMAL(12,2) for OHLC. NSE's udiff BhavCopy
--   publishes ClsPric to 2dp, so (12,2) is not a house convention here, it is the source's own
--   resolution. (Contrast `instruments.current_nav` (18,8): AMFI genuinely publishes 8dp, so a
--   (12,2) there would have silently truncated 12,000+ NAVs. Match the SOURCE, not a habit.)
--
-- INDEXES — learning from 20260713150000_drop_redundant_indexes (which reclaimed ~70 MB):
--   NO standalone index on `instrument_id`. It is fully covered by the UNIQUE's LEADING column,
--   and Postgres reads a btree BACKWARDS for free, so (instrument_id, date DESC) is redundant
--   too. Only `date` gets its own index (the per-day sweep). Do not add more without EXPLAIN.
--
-- THE SNAPSHOT COLUMNS on `instruments` (`last_price`, `last_price_date`) are the analogue of
--   `stock_prices` — the ONE current close a holdings read needs, without a per-row
--   ORDER BY date DESC LIMIT 1. `last_price_date` is load-bearing and NOT decoration: a price
--   must never render without the day it belongs to (the same rule `nav_date` enforces for
--   funds — a thinly-traded InvIT can be days stale, and a stale price shown as live is a lie).
--   Both NULLABLE: an instrument we cannot price keeps an HONEST NULL. Never 0, never carried.
--
-- ZERO CHANGE to existing rows: the table is new; both `instruments` columns are NULLABLE, so
-- all 504 stock + 17,567 MF + 337 ETF rows leave them NULL and their fingerprints do not move.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL, then `migrate resolve --applied`.
-- ═══════════════════════════════════════════════════════════════

-- ── The per-day price history for a non-stock instrument (append-only). ──
CREATE TABLE "instrument_prices" (
    "id"            TEXT           NOT NULL,
    "instrument_id" TEXT           NOT NULL,
    "isin"          TEXT,                                          -- carried for audit/provenance, as daily_prices does
    "date"          DATE           NOT NULL,                       -- trading date, UTC midnight
    "open"          DECIMAL(12,2)  NOT NULL,
    "high"          DECIMAL(12,2)  NOT NULL,
    "low"           DECIMAL(12,2)  NOT NULL,
    "close"         DECIMAL(12,2)  NOT NULL,
    "prev_close"    DECIMAL(12,2),                                 -- nullable: absent on a listing day
    "volume"        BIGINT         NOT NULL,
    "traded_value"  DECIMAL(16,4),                                 -- ₹ Cr; nullable (no trades → no turnover)
    "provider"      TEXT           NOT NULL DEFAULT 'nse-udiff-bhavcopy',
    "created_at"    TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instrument_prices_pkey" PRIMARY KEY ("id")
);

-- The append-only spine: one close per (instrument, day). Makes the ingest idempotent
-- (ON CONFLICT DO NOTHING) and is the LEADING-COLUMN index for every per-instrument read.
CREATE UNIQUE INDEX "instrument_prices_instrument_id_date_key"
    ON "instrument_prices"("instrument_id", "date");

-- The per-day sweep (guards count a day's coverage).
CREATE INDEX "instrument_prices_date_idx" ON "instrument_prices"("date");

ALTER TABLE "instrument_prices"
    ADD CONSTRAINT "instrument_prices_instrument_id_fkey"
    FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── The current-close snapshot (the `stock_prices` analogue, folded onto the catalogue row). ──
-- NULLABLE: an unpriceable instrument keeps an honest NULL rather than a fabricated zero.
ALTER TABLE "instruments"
    ADD COLUMN "last_price"      DECIMAL(12,2),  -- latest close; matches the source's 2dp
    ADD COLUMN "last_price_date" DATE;           -- the day that close belongs to — never render one without the other
