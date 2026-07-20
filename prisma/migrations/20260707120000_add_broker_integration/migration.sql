-- ═══════════════════════════════════════════════════════════════
-- Broker integration (Phase 1) — READ-ONLY holdings import. Broker-agnostic
-- lifecycle (integrate → active → sync → deactivate → clear); only session
-- establishment differs per broker (a thin adapter). PURELY ADDITIVE: two new
-- tables beyond FKs to users(id)/stocks(id). Retiring the dead `linked_accounts`
-- placeholder is a SEPARATE destructive step (see the sibling
-- 20260707120001_drop_linked_accounts migration) so the drop is reviewed on its own.
-- APPLIED via the drift-safe db-execute + migrate-resolve path
-- (see [[invest-iq-migration-drift]]).
-- ═══════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "BrokerId"           AS ENUM ('mock', 'zerodha', 'upstox', 'groww');
CREATE TYPE "BrokerSessionState" AS ENUM ('live', 'dead');

-- CreateTable: broker_connections (one row per (user, broker) — encrypted session + legal record)
CREATE TABLE "broker_connections" (
    "id"                     TEXT                 NOT NULL,
    "user_id"                TEXT                 NOT NULL,
    "broker"                 "BrokerId"           NOT NULL,
    "enabled"                BOOLEAN              NOT NULL DEFAULT true,
    "session_state"          "BrokerSessionState" NOT NULL DEFAULT 'live',
    "session_blob"           TEXT                 NOT NULL,
    "session_expires_at"     TIMESTAMP(3),
    "disclaimer_version"     TEXT                 NOT NULL,
    "disclaimer_accepted_at" TIMESTAMP(3)         NOT NULL,
    "last_synced_at"         TIMESTAMP(3),
    "created_at"             TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(3)         NOT NULL,

    CONSTRAINT "broker_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "broker_connections_user_id_broker_key" ON "broker_connections"("user_id", "broker");
CREATE INDEX        "broker_connections_user_id_idx"        ON "broker_connections"("user_id");

-- CreateTable: broker_holdings (the verified snapshot MIRROR — broker is truth; overwritten each sync)
CREATE TABLE "broker_holdings" (
    "id"                    TEXT          NOT NULL,
    "user_id"               TEXT          NOT NULL,
    "broker_connection_id"  TEXT          NOT NULL,
    "symbol"                TEXT          NOT NULL,
    "stock_id"              TEXT,
    "quantity"              DECIMAL(18,4) NOT NULL,
    "avg_cost"              DECIMAL(18,6) NOT NULL,
    "current_value"         DECIMAL(20,2),
    "source"                TEXT          NOT NULL DEFAULT 'broker',
    "synced_at"             TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "broker_holdings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "broker_holdings_source_ck"   CHECK ("source" = 'broker'),
    CONSTRAINT "broker_holdings_quantity_ck" CHECK ("quantity" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "broker_holdings_conn_symbol_key" ON "broker_holdings"("broker_connection_id", "symbol");
CREATE INDEX        "broker_holdings_user_id_idx"     ON "broker_holdings"("user_id");
CREATE INDEX        "broker_holdings_stock_id_idx"    ON "broker_holdings"("stock_id");

-- AddForeignKey
ALTER TABLE "broker_connections"
    ADD CONSTRAINT "broker_connections_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "broker_holdings"
    ADD CONSTRAINT "broker_holdings_broker_connection_id_fkey"
    FOREIGN KEY ("broker_connection_id") REFERENCES "broker_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "broker_holdings"
    ADD CONSTRAINT "broker_holdings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "broker_holdings"
    ADD CONSTRAINT "broker_holdings_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
