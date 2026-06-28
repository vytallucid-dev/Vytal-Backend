-- Reconcile: stock_overviews.business_tags already has DEFAULT ARRAY[]::TEXT[] in
-- the live DB (set during an earlier build). This migration records that fact so the
-- migration history matches the live schema. No-op on the live DB.
ALTER TABLE "public"."stock_overviews" ALTER COLUMN "business_tags" SET DEFAULT ARRAY[]::TEXT[];
