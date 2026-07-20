-- ═══════════════════════════════════════════════════════════════
-- INSTRUMENT CATALOG (Step 1.5) — the multi-asset spine.
--
-- Every holdable thing becomes a row in `instruments`, keyed on the ISIN spine
-- (established in Step 1.4). A stock instrument is a POINTER row: stock_id set,
-- attributes null. Later asset classes (bond/ETF/MF/GSec/SGB) attach to this same
-- table with stock_id NULL + class-specific `attributes` — so the portfolio reads one
-- uniform catalog instead of branching on "stock vs bond".
--
-- holdings      → instrument_id NOT NULL  (every manual holding resolves to a catalog row)
-- broker_holdings → instrument_id NULLABLE (an unmapped broker symbol has NO instrument;
--                   that is a valid held-not-scored state, NOT an error — mirrors stock_id)
--
-- stock_id is KEPT on both tables for now (dropped in a later cleanup migration once the
-- read path is proven off it) — safer rollback.
--
-- Drift-safe apply: hand-authored SQL, BEGIN/COMMIT over DIRECT_URL, then migrate resolve.
-- ═══════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "AssetClass" AS ENUM ('stock', 'etf', 'bond', 'gsec', 'sgb', 'mutual_fund');

-- CreateTable: instruments
-- NOTE: no DB-level default on "id" — matches the repo convention (stocks/portfolio_accounts
-- also have none; Prisma's @default(uuid()) fills it client-side). The backfill below supplies
-- gen_random_uuid()::text explicitly.
CREATE TABLE "instruments" (
    "id"          TEXT         NOT NULL,
    "isin"        TEXT         NOT NULL,           -- the dedup spine (inherited from stocks.isin)
    "symbol"      TEXT         NOT NULL,
    "name"        TEXT         NOT NULL,
    "asset_class" "AssetClass" NOT NULL,
    "stock_id"    TEXT,                            -- NULLABLE: set only for asset_class='stock'
    "attributes"  JSONB,                           -- class-specific ref data; NULL for stocks
    "is_active"   BOOLEAN      NOT NULL DEFAULT true,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "instruments_isin_key" ON "instruments"("isin");

-- One instrument per stock. Postgres UNIQUE is NULLS DISTINCT by default, so this permits
-- unlimited stock_id-NULL rows (the future non-stock instruments) while forbidding two
-- instruments pointing at the same stock — exactly the intended semantics, and it maps
-- cleanly onto Prisma's @@unique([stockId]) (a partial index would not).
CREATE UNIQUE INDEX "instruments_stock_id_key" ON "instruments"("stock_id");
CREATE INDEX        "instruments_asset_class_idx" ON "instruments"("asset_class");

-- CASCADE mirrors the OLD holdings→stocks cascade: deleting a stock removes its instrument,
-- which in turn cascades that instrument's holdings. Net delete behavior is unchanged.
ALTER TABLE "instruments"
    ADD CONSTRAINT "instruments_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── BACKFILL: every stock becomes a pointer-row (scored AND display-only alike;
--    scored-ness is a `stocks` concern (peer-group membership), never an instrument one) ──
INSERT INTO "instruments" ("id","isin","symbol","name","asset_class","stock_id","attributes","is_active","created_at","updated_at")
SELECT gen_random_uuid()::text, s."isin", s."symbol", s."name", 'stock', s."id", NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "stocks" s;

-- ═══ RE-HOME holdings (live rows → needs a backfill arm) ═══
ALTER TABLE "holdings" ADD COLUMN "instrument_id" TEXT;

UPDATE "holdings" h
   SET "instrument_id" = i."id"
  FROM "instruments" i
 WHERE i."stock_id" = h."stock_id";

-- GUARD: a holding that failed to resolve would mean the 504 backfill missed a stock.
-- Fail loudly INSIDE the transaction → full rollback, no half-applied state.
DO $$
DECLARE unresolved int;
BEGIN
  SELECT count(*) INTO unresolved FROM "holdings" WHERE "instrument_id" IS NULL;
  IF unresolved > 0 THEN
    RAISE EXCEPTION 'holdings re-home left % row(s) with a NULL instrument_id — catalog backfill is incomplete', unresolved;
  END IF;
END $$;

ALTER TABLE "holdings" ALTER COLUMN "instrument_id" SET NOT NULL;

-- Swap the FIFO materialization key: (account, stock) → (account, instrument)
DROP INDEX "holdings_account_id_stock_id_key";
CREATE UNIQUE INDEX "holdings_account_id_instrument_id_key" ON "holdings"("account_id", "instrument_id");
CREATE INDEX        "holdings_instrument_id_idx"            ON "holdings"("instrument_id");

ALTER TABLE "holdings"
    ADD CONSTRAINT "holdings_instrument_id_fkey"
    FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══ RE-HOME broker_holdings (0 rows → pure schema swap, no backfill arm) ═══
-- instrument_id stays NULLABLE FOREVER — deliberately the opposite of holdings. An unmapped
-- broker symbol (outside our universe) has no instrument; that is held-not-scored, not an error.
-- SET NULL mirrors the existing broker_holdings.stock_id FK behavior.
ALTER TABLE "broker_holdings" ADD COLUMN "instrument_id" TEXT;

ALTER TABLE "broker_holdings"
    ADD CONSTRAINT "broker_holdings_instrument_id_fkey"
    FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "broker_holdings_instrument_id_idx" ON "broker_holdings"("instrument_id");
