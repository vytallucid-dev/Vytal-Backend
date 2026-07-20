-- ═══════════════════════════════════════════════════════════════
-- GROUP-3 BENCHMARK ANALYTICS (Step 18) — beta, alpha, tracking error.
--
-- ADDITIVE ONLY. Twelve nullable columns on an existing table. No column is dropped, no default
-- moves, no existing value is touched. Every current row keeps its returns, its volatility, its
-- Sharpe and its rank byte-for-byte — which is the un-waivable Gate-3 claim, and it is guaranteed
-- HERE, structurally, not by testing afterwards: adding a nullable column cannot rewrite a row.
--
-- WHY THESE PRECISIONS, and they are not copied blindly from the neighbours:
--
--   beta            Decimal(10,6). A beta is a ratio around 1. Even a wildly levered fund sits
--                   inside ±10. (10,6) allows |β| < 10,000 — four orders of magnitude of headroom
--                   over anything real, and the fold's range guard withholds anything that does not
--                   fit rather than rounding an absurd number into a plausible one.
--
--   alpha           Decimal(12,6), NOT (10,6). Alpha is a RETURN (a fraction: 0.0234 = +2.34%/yr),
--                   so it takes the same width as ret_* — its neighbours in meaning, not in name.
--                   A (10,6) alpha would cap at ±10,000 which is fine, but the returns columns are
--                   (12,6) and alpha is arithmetically derived FROM them; giving it a narrower box
--                   than its own inputs is how a value that fits everywhere else fails to fit here.
--
--   tracking_error  Decimal(10,6). An annualised standard deviation of return differences — a
--                   small positive fraction (0.0042 = 42 bps). Same shape and same box as vol_*.
--
-- BENCHMARK PROVENANCE — two text columns, and they are load-bearing, not decoration:
--
--   benchmark_index  WHICH index this fund's beta/alpha/TE were measured against. A beta with no
--                    named benchmark is a number with no meaning: "beta = 1.2" is unreadable until
--                    you know 1.2 *to what*. The API must be structurally unable to render one
--                    without the other.
--
--   benchmark_via    HOW we chose it: 'category' (the AMFI leaf maps to a standard benchmark),
--                    'name' (the fund's own name states the index it tracks), or 'sector' (an
--                    audited sector allow-list). These have DIFFERENT confidence. A Nifty-100 index
--                    fund matched by NAME is near-certain; a thematic fund matched by SECTOR is a
--                    defensible editorial judgement. Collapsing them into one column would hide
--                    that difference forever, and the difference is exactly what a reader needs in
--                    order to trust — or discount — the alpha.
--
-- WHERE THE NULLS' REASONS LIVE: the existing `omissions` JSONB. No new column. ~49% of active
-- schemes will have NO benchmark at all (credit-bearing debt, whose real benchmark is a CRISIL
-- index NSE does not publish; fund-of-funds; ambiguous thematics), and each one records WHY.
--
-- NO INDEX_PRICES CHANGE. Group-3 only READS index_prices. All 14 required benchmarks are already
-- present at 5.0y depth (the risk-free days=1825 backfill deepened them). Zero ingestion, zero new
-- storage, and no way for this step to re-cause the index bloat.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL, then `migrate resolve --applied`.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "mf_analytics"
  -- Provenance: what we measured against, and how confidently we chose it.
  ADD COLUMN IF NOT EXISTS "benchmark_index" TEXT,
  ADD COLUMN IF NOT EXISTS "benchmark_via"   TEXT,

  -- β = cov(fund, benchmark) / var(benchmark)
  ADD COLUMN IF NOT EXISTS "beta_1y" DECIMAL(10,6),
  ADD COLUMN IF NOT EXISTS "beta_3y" DECIMAL(10,6),
  ADD COLUMN IF NOT EXISTS "beta_5y" DECIMAL(10,6),

  -- α = fundRet − (rf + β × (benchRet − rf))   — Jensen's alpha, annualised fraction
  ADD COLUMN IF NOT EXISTS "alpha_1y" DECIMAL(12,6),
  ADD COLUMN IF NOT EXISTS "alpha_3y" DECIMAL(12,6),
  ADD COLUMN IF NOT EXISTS "alpha_5y" DECIMAL(12,6),

  -- TE = annualised stdev(fundRet − benchRet)
  ADD COLUMN IF NOT EXISTS "tracking_error_1y" DECIMAL(10,6),
  ADD COLUMN IF NOT EXISTS "tracking_error_3y" DECIMAL(10,6),
  ADD COLUMN IF NOT EXISTS "tracking_error_5y" DECIMAL(10,6);

-- NO INDEX on benchmark_index. It would be a lookup nobody performs: the fold READS index_prices by
-- name and WRITES this column as an attribute of the row it already has by primary key. An index
-- here would cost storage on 14,041 rows to serve a query that does not exist — the exact reasoning
-- that dropped four redundant indexes in 20260713150000.
