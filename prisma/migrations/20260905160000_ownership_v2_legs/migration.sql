-- CHANGE 2.5 — the rebuilt Ownership pillar's own decomposition.
--
-- score_ownership is entirely v1-shaped: baseline, pledging_adjustment, penalty_r2,
-- penalty_r6, penalty_prolonged_fii, flow_adjustment_raw/clamped, final_ownership. Those
-- describe a baseline-of-75-minus-fixed-steps construction that v2 replaces with three
-- GRADED readings, so there is no existing column a v2 leg can honestly go in.
--
-- Writing the v2 subtotal onto a row whose stored decomposition still describes v1 would
-- make the row contradict itself: a reader reconstructing final_ownership from baseline and
-- the penalties would not get the number the composite used. So the legs get their own
-- columns and the v1 ones keep their meaning.
--
-- ALL NULLABLE, NO BACKFILL. A row written by a v1 pass carries NULL, which reads as "this
-- snapshot was not scored under v2" — the same honest-null discipline as not_evaluable and
-- guardrail_screened, and NOT the same as a zero. Nothing is altered, nothing is rewritten.
ALTER TABLE "score_ownership" ADD COLUMN "v2_subtotal"              DECIMAL(8,4);
ALTER TABLE "score_ownership" ADD COLUMN "v2_pledge_pct"            DECIMAL(8,4);
ALTER TABLE "score_ownership" ADD COLUMN "v2_pledge_score"          DECIMAL(8,4);
ALTER TABLE "score_ownership" ADD COLUMN "v2_pledge_adjustment"     DECIMAL(8,4);
ALTER TABLE "score_ownership" ADD COLUMN "v2_promoter_score"        DECIMAL(8,4);
ALTER TABLE "score_ownership" ADD COLUMN "v2_institutional_score"   DECIMAL(8,4);
ALTER TABLE "score_ownership" ADD COLUMN "v2_promoter_change"       DECIMAL(18,4);
ALTER TABLE "score_ownership" ADD COLUMN "v2_institutional_change"  DECIMAL(18,4);
