-- ═══════════════════════════════════════════════════════════════
-- MULTI-ACCOUNT BROKER KEY (Step 2a) — land the CORRECT connection key before any
-- connection is ever persisted under the old one-per-broker assumption.
--
-- A user may hold two demat accounts at the SAME broker. The old unique (user_id, broker)
-- made that unrepresentable. The new key adds the broker's own per-account identifier
-- (Kite `user_id` / client code; `clientcode` on Angel; the same concept at every Indian
-- broker), so two demats = two connections = (Step 2b) two linkable accounts.
--
-- broker_account_ref is NOT NULL BY DESIGN. Postgres UNIQUE treats NULLs as DISTINCT, so a
-- nullable ref would SILENTLY permit unlimited duplicate connections per (user, broker) —
-- the exact failure this key exists to prevent. No ref ⇒ fail loud at persist, never a row.
--
-- Free to assert: broker_connections has 0 rows.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "broker_connections" ADD COLUMN "broker_account_ref" TEXT NOT NULL;

DROP INDEX "broker_connections_user_id_broker_key";

CREATE UNIQUE INDEX "broker_connections_user_id_broker_broker_account_ref_key"
    ON "broker_connections"("user_id", "broker", "broker_account_ref");

-- §2.3 — one account per CONNECTION. Unchanged by the multi-account decision: multiple
-- accounts per broker come from multiple CONNECTIONS, not from relaxing this lock.
-- Partial (WHERE NOT NULL) so unlimited *unlinked* (manual) accounts remain allowed.
CREATE UNIQUE INDEX "portfolio_accounts_broker_connection_id_key"
    ON "portfolio_accounts"("broker_connection_id")
    WHERE "broker_connection_id" IS NOT NULL;
