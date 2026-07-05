-- ═══════════════════════════════════════════════════════════════
-- Event reminders — the date-triggered SIBLING of alerts. A user asks to be reminded N
-- days before a stock's next event of a given type. Binds SEMANTICALLY by (stockId,
-- eventType) — never to a specific corporate_events row — so a rescheduled date (a new
-- corporate_events row) is followed automatically on the next eval.
-- Two tables mirror alerts/alert_events: event_reminders (the rules) + event_reminder_events
-- (the fired log the SAME alerts email drain sends). ADDITIVE ONLY — no existing table is
-- touched beyond FKs to users(id)/stocks(id).
-- APPLIED via the drift-safe db-execute + migrate-resolve path (see [[invest-iq-migration-drift]]).
-- ═══════════════════════════════════════════════════════════════

-- CreateTable: event_reminders (the user's rules)
CREATE TABLE "event_reminders" (
    "id"             TEXT         NOT NULL,
    "user_id"        TEXT         NOT NULL,
    "stock_id"       TEXT         NOT NULL,
    "event_type"     TEXT         NOT NULL,
    "days_before"    INTEGER      NOT NULL DEFAULT 1,
    "active"         BOOLEAN      NOT NULL DEFAULT true,
    "last_fired_at"  TIMESTAMP(3),
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_reminders_pkey" PRIMARY KEY ("id"),

    -- Lead time must be a genuine lead (>= 1) — we never remind ON the event day.
    CONSTRAINT "event_reminders_days_before_ck" CHECK ("days_before" >= 1)
);

-- One reminder per (user, stock, eventType) — the semantic bind is unique per user.
CREATE UNIQUE INDEX "event_reminders_user_id_stock_id_event_type_key"
    ON "event_reminders"("user_id", "stock_id", "event_type");
CREATE INDEX "event_reminders_user_id_created_at_idx" ON "event_reminders"("user_id", "created_at" DESC);
CREATE INDEX "event_reminders_active_idx"             ON "event_reminders"("active");
CREATE INDEX "event_reminders_stock_id_idx"           ON "event_reminders"("stock_id");

-- CreateTable: event_reminder_events (the fired log — the alerts email drain sends this)
CREATE TABLE "event_reminder_events" (
    "id"                  TEXT         NOT NULL,
    "reminder_id"         TEXT         NOT NULL,
    "user_id"             TEXT         NOT NULL,
    "stock_id"            TEXT         NOT NULL,
    "event_type"          TEXT         NOT NULL,
    "resolved_event_date" DATE         NOT NULL,
    "fired_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered"           BOOLEAN      NOT NULL DEFAULT false,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_reminder_events_pkey" PRIMARY KEY ("id")
);

-- Hard dedupe: one fired row per reminder per occurrence date (a race can't double-insert).
CREATE UNIQUE INDEX "event_reminder_events_reminder_id_resolved_event_date_key"
    ON "event_reminder_events"("reminder_id", "resolved_event_date");
CREATE INDEX "event_reminder_events_user_id_fired_at_idx" ON "event_reminder_events"("user_id", "fired_at" DESC);
CREATE INDEX "event_reminder_events_reminder_id_idx"      ON "event_reminder_events"("reminder_id");
CREATE INDEX "event_reminder_events_delivered_idx"        ON "event_reminder_events"("delivered");

-- AddForeignKey
ALTER TABLE "event_reminders"
    ADD CONSTRAINT "event_reminders_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_reminders"
    ADD CONSTRAINT "event_reminders_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_reminder_events"
    ADD CONSTRAINT "event_reminder_events_reminder_id_fkey"
    FOREIGN KEY ("reminder_id") REFERENCES "event_reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_reminder_events"
    ADD CONSTRAINT "event_reminder_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_reminder_events"
    ADD CONSTRAINT "event_reminder_events_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
