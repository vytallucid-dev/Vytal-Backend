-- Additive: audit trail for the admin raw-field fill bridge (CN-4 citation history).
-- APPLY VIA THE DRIFT-SAFE PATH (do NOT `prisma migrate dev` — it would reset the
-- live remote DB on the pre-existing drift):
--   1. npx prisma migrate status            (review)
--   2. npx prisma db execute --file prisma/migrations/20260628120000_add_raw_field_edits/migration.sql
--   3. npx prisma migrate resolve --applied 20260628120000_add_raw_field_edits
--   4. npx prisma generate                  (so prisma.rawFieldEdit is typed)

CREATE TABLE "raw_field_edits" (
  "id"            TEXT NOT NULL,
  "target_table"  TEXT NOT NULL,
  "target_row_id" TEXT NOT NULL,
  "field"         TEXT NOT NULL,
  "old_value"     TEXT,
  "new_value"     TEXT,
  "citation"      TEXT NOT NULL,
  "edited_by"     TEXT NOT NULL,
  "note"          TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "raw_field_edits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "raw_field_edits_target_table_target_row_id_idx" ON "raw_field_edits" ("target_table", "target_row_id");
CREATE INDEX "raw_field_edits_created_at_idx" ON "raw_field_edits" ("created_at");
