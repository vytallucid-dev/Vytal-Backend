-- ═══════════════════════════════════════════════════════════════
-- Broker interactive-auth CSRF state store (Phase 2a). One short-lived, single-use,
-- unguessable state token per initiated OAuth flow, bound to (user, broker). The callback
-- atomically consumes it before completing a link. Also carries the disclaimer accepted at
-- initiate. PURELY ADDITIVE (FK to users(id)). Drift-safe db-execute + migrate-resolve path.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE "broker_auth_states" (
    "id"                     TEXT         NOT NULL,
    "user_id"                TEXT         NOT NULL,
    "broker"                 "BrokerId"   NOT NULL,
    "state"                  TEXT         NOT NULL,
    "disclaimer_version"     TEXT         NOT NULL,
    "disclaimer_accepted_at" TIMESTAMP(3) NOT NULL,
    "expires_at"             TIMESTAMP(3) NOT NULL,
    "consumed_at"            TIMESTAMP(3),
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_auth_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "broker_auth_states_state_key"      ON "broker_auth_states"("state");
CREATE INDEX        "broker_auth_states_user_id_idx"    ON "broker_auth_states"("user_id");
CREATE INDEX        "broker_auth_states_expires_at_idx" ON "broker_auth_states"("expires_at");

ALTER TABLE "broker_auth_states"
    ADD CONSTRAINT "broker_auth_states_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
