-- ═══════════════════════════════════════════════════════════════════════════
-- DROP THE SINCE-EARLIEST CAGR AND ITS ANCHORS.
--
-- WHY A METRIC IS BEING DELETED RATHER THAN FIXED.
--
-- `ret_since_earliest_cagr` was folded from AMFI's published NAV history. That history is RAW: it is
-- neither split-adjusted nor total-return. AMFI does not restate a NAV when a fund sub-divides its
-- units, and an IDCW plan's NAV falls by every distribution it pays.
--
-- That makes the since-earliest span the WORST case for both corruptions, not an edge case. The
-- further back the anchor sits, the MORE unit splits and payouts fall between it and today. Measured
-- live before this drop: NIFTYBEES reported -11.19% a year "since 2019". The fund did not lose money.
-- It did a 1:10 sub-division in December 2019, and the "return" was almost entirely the split.
--
-- Step 19 repairs the 1Y / 3Y / 5Y windows, and it can, because those are BOUNDED: every real NSE
-- corporate action inside a five-year window can be enumerated and the series rescaled by the ratio
-- the exchange actually published. A since-earliest span has no such bound. It reaches back to
-- wherever AMFI's history happens to floor (~2009), across corporate actions that no exchange lists
-- for an unlisted fund, and across payout histories that nobody publishes at all. There is no source
-- from which this number can be made correct.
--
-- So it was never "a metric awaiting a backfill". It was UNCOMPUTABLE from the only source we have,
-- and a column that can only ever hold a wrong number is worse than no column at all: it survives as
-- an invitation for someone to fill it in. ~1,029 live MF values were wrong on the day this was
-- written, and the ETF anchors had already been rolled back for exactly this reason.
--
-- `earliest_nav` / `earliest_nav_date` existed for the sole purpose of feeding it — nothing else in
-- the codebase reads them — so they go with it, along with the one-time inception walk that wrote
-- them. Honest-empty is a NULL with a reason. This is the other case: no column, because no number.
--
-- DESTRUCTIVE AND DELIBERATE. These three columns are dropped, not deprecated. Nothing else joins to
-- them, no API surface returns them after this change, and no rebuild path needs them.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "mf_analytics" DROP COLUMN IF EXISTS "ret_since_earliest_cagr";
ALTER TABLE "mf_analytics" DROP COLUMN IF EXISTS "earliest_nav";
ALTER TABLE "mf_analytics" DROP COLUMN IF EXISTS "earliest_nav_date";
