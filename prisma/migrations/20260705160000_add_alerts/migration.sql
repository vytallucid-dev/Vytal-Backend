-- ═══════════════════════════════════════════════════════════════
-- Alerts — user-created rules (price / health_band / finding) + the fired-events log
-- that email drains LATER. This build stops at RECORDING fires; it sends nothing.
-- ADDITIVE ONLY — no existing table is touched beyond FKs to users(id)/stocks(id).
-- Two CHECKs Prisma can't model enforce type/operator/target coherence at the DB (the
-- controller validates first → 400; the CHECK is the backstop, never a raw 500).
-- APPLIED via the drift-safe db-execute + migrate-resolve path
-- (see [[invest-iq-migration-drift]]).
-- ═══════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "AlertType"       AS ENUM ('price', 'health_band', 'finding');
CREATE TYPE "AlertOperator"   AS ENUM ('above', 'below', 'fires');
CREATE TYPE "AlertRepeatMode" AS ENUM ('one_shot', 'repeating');

-- CreateTable: alerts (the user's rules)
CREATE TABLE "alerts" (
    "id"                TEXT              NOT NULL,
    "user_id"           TEXT              NOT NULL,
    "stock_id"          TEXT              NOT NULL,
    "type"              "AlertType"       NOT NULL,
    "operator"          "AlertOperator"   NOT NULL,
    "threshold_price"   DECIMAL(14,4),
    "threshold_band"    "LabelBand",
    "finding_key"       TEXT,
    "repeat_mode"       "AlertRepeatMode" NOT NULL DEFAULT 'one_shot',
    "active"            BOOLEAN           NOT NULL DEFAULT true,
    "armed"             BOOLEAN           NOT NULL DEFAULT true,
    "last_triggered_at" TIMESTAMP(3),
    "created_at"        TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3)      NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id"),

    -- operator ⇔ type coherence: 'fires' iff finding; above/below iff price|health_band
    CONSTRAINT "alerts_operator_type_ck" CHECK (
        (type = 'finding' AND operator = 'fires') OR
        (type IN ('price','health_band') AND operator IN ('above','below'))
    ),
    -- target ⇔ type coherence: exactly the right column populated for the type
    CONSTRAINT "alerts_threshold_type_ck" CHECK (
        (type = 'price'       AND threshold_price IS NOT NULL AND threshold_band IS NULL  AND finding_key IS NULL) OR
        (type = 'health_band' AND threshold_band  IS NOT NULL AND threshold_price IS NULL AND finding_key IS NULL) OR
        (type = 'finding'     AND threshold_price IS NULL     AND threshold_band IS NULL)
    )
);

-- CreateIndex
CREATE INDEX "alerts_user_id_created_at_idx" ON "alerts"("user_id", "created_at" DESC);
CREATE INDEX "alerts_active_idx"             ON "alerts"("active");
CREATE INDEX "alerts_stock_id_idx"           ON "alerts"("stock_id");

-- CreateTable: alert_events (the fired log — email drains this later)
CREATE TABLE "alert_events" (
    "id"         TEXT         NOT NULL,
    "alert_id"   TEXT         NOT NULL,
    "user_id"    TEXT         NOT NULL,
    "stock_id"   TEXT         NOT NULL,
    "fired_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot"   TEXT         NOT NULL,
    "delivered"  BOOLEAN      NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_events_user_id_fired_at_idx" ON "alert_events"("user_id", "fired_at" DESC);
CREATE INDEX "alert_events_alert_id_idx"         ON "alert_events"("alert_id");
CREATE INDEX "alert_events_delivered_idx"        ON "alert_events"("delivered");

-- AddForeignKey
ALTER TABLE "alerts"
    ADD CONSTRAINT "alerts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "alerts"
    ADD CONSTRAINT "alerts_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "alert_events"
    ADD CONSTRAINT "alert_events_alert_id_fkey"
    FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "alert_events"
    ADD CONSTRAINT "alert_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "alert_events"
    ADD CONSTRAINT "alert_events_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
