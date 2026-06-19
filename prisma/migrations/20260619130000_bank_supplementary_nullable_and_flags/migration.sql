-- BankSupplementary Phase-2 schema extension.
--
-- Motivation: the PG5/PG6 supplementary load contains 173 "missing" rows whose
-- value and sourceCitation are intentionally null (explicit gap semantics for
-- the scoring engine's §5.8 neutral-60 path). The original schema was designed
-- for hand-entered found values only, so value+sourceCitation were NOT NULL and
-- there were no confidence/status/notes columns.
--
-- Changes (all additive / backward-compatible):
--   1. value          NOT NULL → NULL   (missing rows land as null, not dropped)
--   2. source_citation NOT NULL → NULL  (missing rows have no citation)
--   3. confidence      new nullable TEXT (A/B/C quality flag; null for missing rows)
--   4. status          new TEXT NOT NULL DEFAULT 'found' (found|missing)
--   5. notes           new nullable TEXT (free-form per-row annotation)
--
-- Invariant (enforced by ingest, NOT by DB): status='found' ⟹ value IS NOT NULL
-- AND source_citation IS NOT NULL. The DB allows both to be null so that missing
-- rows can be stored explicitly as gaps.

-- 1. Make value nullable
ALTER TABLE "bank_supplementary" ALTER COLUMN "value" DROP NOT NULL;

-- 2. Make source_citation nullable
ALTER TABLE "bank_supplementary" ALTER COLUMN "source_citation" DROP NOT NULL;

-- 2b. Make source_date nullable (missing rows have no disclosure date)
ALTER TABLE "bank_supplementary" ALTER COLUMN "source_date" DROP NOT NULL;

-- 3. Add confidence flag (A/B/C quality tier; null for missing rows)
ALTER TABLE "bank_supplementary" ADD COLUMN "confidence" TEXT;

-- 4. Add status column (found|missing)
ALTER TABLE "bank_supplementary" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'found';

-- 5. Add notes column
ALTER TABLE "bank_supplementary" ADD COLUMN "notes" TEXT;
