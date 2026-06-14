-- R1 pledge red-flag FIRING RECORD on score_ownership.
-- The score_red_flags ROW stays deferred (needs a ScoreSnapshot → out-of-scope
-- pillars); R1's firing is recorded here so that row is reconstructable from
-- stored facts later. Non-destructive: nullable JSON + boolean default false.
--
-- STAGED, NOT YET APPLIED to the (cloud/prod) DB — consistent with the standing
-- dry-run gate (no committed writes until a complete four-pillar snapshot). Apply
-- with `prisma migrate deploy` when the first real Ownership write lands.
ALTER TABLE "score_ownership" ADD COLUMN "r1_fired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "score_ownership" ADD COLUMN "r1_triggering_values" JSONB;
