-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 19 — CORPORATE ACTIONS FOR FUNDS (the ETF split spine).
--
-- WHY: AMFI's NAV history is RAW — not split-adjusted. An ETF that sub-divides its units 1:10 has
-- its published NAV step down 90% overnight, and every metric folded from that series believes the
-- fund lost 90% in a day. Measured live before this migration:
--     max_drawdown_3y = -90.7%   ← that IS the split day
--     vol_3y          =  134%    ← impossible for an index ETF
--     alpha_3y        =  -60%
-- The fix rescales the NAV series by the REAL corporate action before any metric is computed. The
-- real corporate action therefore has to be stored. This table is where.
--
-- PURELY ADDITIVE. One CREATE TABLE, three indexes, one FK. It does NOT touch `corporate_events` —
-- so the 7,433 equity rows in that table are untouched STRUCTURALLY, not by assertion.
--
-- WHY NOT A NULLABLE instrument_id ON `corporate_events` (the obvious-looking move):
--   `corporate_events.stock_id` is a REQUIRED FK to `stocks`, and no fund has a `stocks` row — that
--   is Step 13's held-not-scored guarantee, not an oversight. Relaxing it to nullable would need
--   (a) a CHECK for exactly-one-spine and (b) PARTIAL unique indexes, because Postgres treats NULLs
--   as DISTINCT: `UNIQUE (stock_id, event_type, event_date)` enforces NOTHING once stock_id is NULL,
--   so ON CONFLICT would never match for an ETF and every backfill would silently duplicate every
--   split row. Prisma can express neither construct — both would be permanent drift, the repo's
--   first. Step 14 already settled this the other way: `instrument_prices` is its own table with a
--   REQUIRED instrument_id, not a nullable column bolted onto `daily_prices`. Two spines, two tables.
-- ═══════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "instrument_corporate_events" (
    "id" TEXT NOT NULL,
    "instrument_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_date" DATE NOT NULL,
    "ex_date" DATE,
    "record_date" DATE,
    -- The EXACT adjustment factor: oldFaceValue / newFaceValue, snapped to the nearest integer.
    -- A sub-division ratio IS an integer (you cannot issue 10.0043 units for one), so NSE's published
    -- 10.004314 is its own rounding of the new face value. NULL for any non-split event.
    "split_factor" DECIMAL(12,6),
    -- The raw NSE subject, verbatim — the falsifiable EVIDENCE for split_factor. A snapped number
    -- whose source you cannot read is indistinguishable from a guessed one.
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'nse',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instrument_corporate_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instrument_corporate_events_event_date_idx" ON "instrument_corporate_events"("event_date");

-- CreateIndex
CREATE INDEX "instrument_corporate_events_instrument_id_event_type_idx" ON "instrument_corporate_events"("instrument_id", "event_type");

-- CreateIndex
-- IDEMPOTENCY, and it actually ENFORCES — because instrument_id is NOT NULL. Same instrument + same
-- type + same date = the same event, so re-running the backfill or the nightly capture inserts nothing.
CREATE UNIQUE INDEX "instrument_corporate_events_instrument_id_event_type_event__key" ON "instrument_corporate_events"("instrument_id", "event_type", "event_date");

-- AddForeignKey
ALTER TABLE "instrument_corporate_events" ADD CONSTRAINT "instrument_corporate_events_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
