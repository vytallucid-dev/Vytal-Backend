-- ═══════════════════════════════════════════════════════════════
-- ISIN spine (Step 1.4c) — tighten the constraint. The ALTER *is* the proof:
-- SET NOT NULL fails on any null row, the UNIQUE index fails on any duplicate pair,
-- and both run in one BEGIN/COMMIT so a failure rolls back with no half-applied state.
--
-- Preconditions established before this ran:
--   * 20260712120000_add_stocks_isin added the nullable column
--   * backfilled 500/504 from the official NSE ind_nifty500list.csv (symbol join)
--   * the 4 dropped-from-index legacy symbols were sourced outside that CSV
--   * the LTIM/LTM duplicate (one company, two rows, same ISIN INE214T01019 — a
--     Mar-2026 rename) was merged: LTIM's references re-pointed to LTM, shell deleted
--   * src/lib/seed.ts (legacy, could mint null-ISIN + phantom stocks) was deleted
-- Universe at apply time: 504 rows / 504 non-null / 504 distinct ISIN.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE "stocks" ALTER COLUMN "isin" SET NOT NULL;
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_isin_key" UNIQUE ("isin");
