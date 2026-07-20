-- ═══════════════════════════════════════════════════════════════
-- RETENTION POLICY AUDIT (Layer 3) — the compliance record of every ADMIN-INITIATED
-- change to a retention_policy row. This is the evidence for a "what happened to our
-- data" investigation: who changed a delete-controlling limit, when, and what the
-- system's dry-run warned it would delete at that moment.
--
-- TWO STRUCTURAL RULES (enforced in code, not here):
--   1. Audit rows are written ONLY by the admin UI write path. The retention ENGINE
--      (src/retention/engine.ts) has no reference to this table — it only DELETEs — so
--      a pruner-initiated delete (including pruning THIS table) CANNOT write an audit
--      row. Not "chooses not to" — cannot.
--   2. `projected_delta` is server-computed in the write flow from the real dry-run
--      against the proposed value — never client-passed.
--
-- SELF-CAPPED: registered below as the 32nd managed retention_policy row — time-based,
-- 365 days, floor 90. A GENEROUS window on purpose (a compliance record, not an
-- operational log): a data-loss investigation months later must still reach the change
-- that caused it. It self-prunes under its own policy, and by rule 1 that pruning
-- writes no audit row.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260718140000_add_retention_policy_audit`, then
-- `prisma migrate status` clean. NEVER `migrate dev`.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE "retention_policy_audit" (
    "id"              TEXT         NOT NULL,
    "policy_table"    TEXT         NOT NULL,                 -- which retention_policy row changed
    "field"           TEXT         NOT NULL,                 -- keep | days | supersededDays | armed | enabled
    "old_value"       TEXT,                                  -- serialized (fields differ in type); null if prior was null
    "new_value"       TEXT,
    "changed_by"      TEXT         NOT NULL,                 -- req.authUser.userId (the token, never a payload value)
    "changed_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projected_delta" TEXT,                                  -- server-computed dry-run projection AT SAVE

    CONSTRAINT "retention_policy_audit_pkey" PRIMARY KEY ("id")
);

-- Global changelog (newest first) + per-policy history — both index on changed_at DESC.
CREATE INDEX "retention_policy_audit_changed_at_idx" ON "retention_policy_audit"("changed_at" DESC);
CREATE INDEX "retention_policy_audit_policy_table_idx" ON "retention_policy_audit"("policy_table", "changed_at" DESC);

-- Register as the 32nd managed policy row — self-capped, time / 365d / floor 90.
INSERT INTO "retention_policy"
  ("id","table_name","mode","days","floor","floor_reason","ts_column","enabled","armed","updated_at")
VALUES
  (gen_random_uuid()::text, 'retention_policy_audit', 'time', 365, 90,
   'Compliance record of who changed a delete-controlling limit — a data-loss investigation months later must still reach the change that caused it',
   'changed_at', true, true, CURRENT_TIMESTAMP);
