-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 20 — MANUAL MULTI-ASSET HOLDINGS: relax the write spine.
--
-- THE PROBLEM. `transactions` had NO instrument column at all — only a NOT-NULL stock_id — so a
-- transaction could only ever be OF A STOCK. `holdings` carried BOTH a NOT-NULL instrument_id AND a
-- NOT-NULL stock_id, and every one of the 18,492 non-stock instruments has stock_id NULL. So a manual
-- holding of an ETF, a fund, a REIT or a bond was not merely unimplemented — it was UNCONSTRUCTABLE.
-- The catalogue could hold them, the FIFO engine could replay them, the read path could price them.
-- The write spine refused them.
--
-- THE FIX IS ONE SENTENCE: the INSTRUMENT is the spine; the stock is a shortcut for the 504 equities.
--
--   · transactions gains instrument_id, NOT NULL — every txn is OF an instrument.
--   · transactions.stock_id becomes NULLABLE — a bond has no row in `stocks`.
--   · holdings.stock_id becomes NULLABLE — same reason. (instrument_id was ALREADY the FIFO key.)
--
-- ⚠️  THE UNIQUE KEY DOES NOT MOVE, AND THAT IS THE WHOLE POINT.
--
--     holdings' unique key stays `(account_id, instrument_id)` — two NOT-NULL columns. It is tempting
--     to think a nullable stock_id is harmless here. It is not, if anything unique ever keys on it:
--     Postgres treats NULLs as DISTINCT in a unique index, so a UNIQUE over a nullable stock_id would
--     enforce NOTHING for non-stock rows, and every re-entry of the same bond would insert a fresh
--     duplicate holding — silently, forever. Step 19 hit exactly this trap on
--     instrument_corporate_events (a nullable stock_id there meant ON CONFLICT never matched and each
--     backfill duplicated every row). The escape is the same: key on the NOT-NULL column.
--
-- THE BACKFILL IS TOTAL, NOT BEST-EFFORT. All 21 existing transactions resolve to an instrument via
-- their stock (every one of the 504 stocks has exactly one instrument row — verified, 0 orphans), so
-- instrument_id can be filled and then made NOT NULL without a single unresolved row. If that were
-- not true, SET NOT NULL would fail loudly here rather than leave a half-keyed ledger behind.
--
-- BYTE-IDENTICAL FOR EQUITY: no existing value changes. The 21 transactions keep their stock_id and
-- gain the instrument that stock already pointed at; the 19 holdings are untouched. The FIFO engine is
-- not modified at all — this migration moves the KEY, never the cost-basis math.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. THE NEW SPINE ON THE LEDGER ──
ALTER TABLE "transactions" ADD COLUMN "instrument_id" TEXT;

-- Backfill from the stock each transaction already points at (1:1 — instruments.stock_id is @unique).
UPDATE "transactions" t
   SET "instrument_id" = i."id"
  FROM "instruments" i
 WHERE i."stock_id" = t."stock_id";

-- If ANY row failed to resolve, this fails the migration rather than shipping a half-keyed ledger.
ALTER TABLE "transactions" ALTER COLUMN "instrument_id" SET NOT NULL;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_instrument_id_fkey"
  FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. RELAX THE STOCK POINTER (both tables) ──
-- A non-stock instrument has no row in `stocks`. Nothing unique keys on either column.
ALTER TABLE "transactions" ALTER COLUMN "stock_id" DROP NOT NULL;
ALTER TABLE "holdings"     ALTER COLUMN "stock_id" DROP NOT NULL;

-- ── 3. THE REPLAY'S NEW READ PATH ──
-- replayAndMaterialize now reads the ledger by (account, INSTRUMENT) in trade-date order. Without
-- these it would sequential-scan the ledger on every write. The stock-keyed indexes are RETAINED:
-- equity-scoped reads (the rescore trigger, NAV/TWR/XIRR) still address by stock.
CREATE INDEX "transactions_account_id_instrument_id_trade_date_created_at_idx"
  ON "transactions"("account_id", "instrument_id", "trade_date", "created_at");
CREATE INDEX "transactions_user_id_instrument_id_trade_date_created_at_idx"
  ON "transactions"("user_id", "instrument_id", "trade_date", "created_at");
