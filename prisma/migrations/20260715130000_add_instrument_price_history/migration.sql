-- ═══════════════════════════════════════════════════════════════
-- INSTRUMENT PRICE HISTORY (Step 21) — the WEEKLY, 4-YEAR, ROLLING series that lets a HELD
-- non-stock instrument draw a line on the portfolio Value/Returns/vs-Nifty charts and its own
-- detail page. There is no NAV-history table by design (Step 10–11: a persistent daily one
-- measured ~26 M rows / ~2.5 GB against a 500 MB ceiling). This stores the MINIMUM needed to
-- chart, and no more.
--
-- WHY A NEW TABLE, NOT AN EXTEND OF `instrument_prices` — TWO reasons, both load-bearing:
--   1. DIFFERENT GRAIN. `instrument_prices` is the DAILY, RAW OHLCV close spine (nse-udiff). This
--      is a WEEKLY, single-`value` sample. Bolting a "is_weekly" flag onto the daily spine would
--      need a partial unique index (Postgres treats NULLs as DISTINCT — the Step-19 lesson) and
--      would bloat the daily spine's indexes for a different-shaped read.
--   2. IT CANNOT HOLD WHAT THIS NEEDS. Half of this table is CORRECTED fund NAV — split-rescaled,
--      and for IDCW plans sampled from the Growth twin. `instrument_prices` is raw exchange
--      closes; funds are not on NSE at all. Same "two spines, two tables" call Step 14 made.
--
-- ONE COLUMN, ONE MEANING: `value` = "what one unit was worth that week". For a fund it is the
--   fold's CORRECTED NAV (post split-rescale; Growth-twin series for IDCW plans). For a listed
--   non-stock it is the udiff CLOSE. `source` records which, so a corrected-NAV leg and a
--   market-close leg are never confused, and the disclosure/audit can tell them apart. NOT OHLCV:
--   a chart needs one number per week; storing four would quadruple the store for no chart benefit.
--
-- CORRECTED-ONLY IS THE POINT (Step 19): a raw store would draw the NIFTYBEES 1:10 cliff and the
--   IDCW payout sawtooth — reintroducing, visibly, the exact corruption Step 19 fixed. The chart
--   and the metrics come off the SAME corrected series and cannot contradict.
--
-- ── PRECISION ── `value` is DECIMAL(18,6). Wide enough for the largest AMFI NAV (~2.5 M) and fine
--   for a chart line. (`instruments.current_nav` is (18,8) — the authoritative NAV; this is a chart
--   sample, and the LIVE final point is read from that column at request time, never from here.)
--
-- ── THE ROLLING WINDOW, ENFORCED AT THE DB (Ruling R2) ──
--   Storage is CONSTANT BY CONSTRUCTION, not by a periodic prune that lets the table creep between
--   runs. An AFTER INSERT trigger trims each instrument to its newest 4 years on every append, so
--   "rows per instrument ≤ ~209 (⌈4y/7⌉)" is a DB-LEVEL invariant no write path can bypass — the
--   same reason the key is a composite PK and not a convention. A DELETE never fires an INSERT
--   trigger, so there is no recursion.
--
-- ── BYTE-IDENTICAL ── This migration is purely ADDITIVE: one new table, one function, one trigger.
--   It ALTERs no existing table, touches no existing row. `instruments`, `instrument_prices`,
--   `daily_prices`, `mf_analytics`, PHS and the 504-stock fingerprint are all untouched. (The
--   `Instrument.priceHistory` back-relation added to schema.prisma is a Prisma-virtual field — no
--   column, no SQL, no fingerprint move.)
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260715130000_add_instrument_price_history`, then
-- `prisma migrate status` clean.
-- ═══════════════════════════════════════════════════════════════

-- ── The weekly, 4-year, held-only series. Composite PK on (instrument_id, date), BOTH NOT NULL. ──
CREATE TABLE "instrument_price_history" (
    "instrument_id" TEXT          NOT NULL,
    "date"          DATE          NOT NULL,                 -- the weekly SAMPLE day (last trading day of the ISO week)
    "value"         DECIMAL(18,6) NOT NULL,                 -- corrected NAV (funds) | udiff close (listed): "one unit, that week"
    "source"        TEXT          NOT NULL,                 -- 'nav_corrected' | 'market_close'
    "created_at"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Composite PK: both columns NOT NULL, so ON CONFLICT (instrument_id, date) is a real
    -- idempotency key (unlike a nullable unique, which Postgres treats as DISTINCT — Step 19).
    CONSTRAINT "instrument_price_history_pkey" PRIMARY KEY ("instrument_id", "date"),

    -- `value` is a per-unit worth — never negative, never zero (a 0 would draw a cliff to the axis).
    CONSTRAINT "instrument_price_history_value_positive" CHECK ("value" > 0),

    -- Provenance is a closed set; a typo'd source is a fault, not a row.
    CONSTRAINT "instrument_price_history_source_check"
        CHECK ("source" IN ('nav_corrected', 'market_close'))
);

-- The per-day sweep (e.g. "which instruments got this week's point"). The (instrument_id, date)
-- read is already served by the PK's leading column + a backward btree scan, so NO extra index.
CREATE INDEX "instrument_price_history_date_idx" ON "instrument_price_history"("date");

-- FK to the catalogue spine. CASCADE so a deleted instrument takes its series with it.
ALTER TABLE "instrument_price_history"
    ADD CONSTRAINT "instrument_price_history_instrument_id_fkey"
    FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ROLLING-WINDOW TRIM (Ruling R2) — constant-by-construction, not a prune job. ──
-- Anchored on the instrument's MAX(date), which INCLUDES the just-inserted row (this is AFTER
-- INSERT). Fully schema-qualified with an empty search_path, matching the on_auth_user_created
-- precedent (20260703120000_add_user_layer). Not SECURITY DEFINER: same table, same owner role.
CREATE OR REPLACE FUNCTION public.trim_instrument_price_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    DELETE FROM public.instrument_price_history h
    WHERE h.instrument_id = NEW.instrument_id
      AND h.date < (
          SELECT MAX(h2.date)
          FROM public.instrument_price_history h2
          WHERE h2.instrument_id = NEW.instrument_id
      ) - INTERVAL '4 years';
    RETURN NULL; -- AFTER trigger: return value is ignored
END;
$$;

CREATE TRIGGER "instrument_price_history_trim"
    AFTER INSERT ON "instrument_price_history"
    FOR EACH ROW EXECUTE FUNCTION public.trim_instrument_price_history();
