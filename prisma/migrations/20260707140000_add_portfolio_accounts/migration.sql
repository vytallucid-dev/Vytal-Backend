-- ═══════════════════════════════════════════════════════════════
-- Portfolio Accounts, Step 1 — the ACCOUNT becomes the first-class unit. Adds
-- portfolio_accounts, re-homes transactions + materialized holdings onto account_id,
-- and BACKFILLS every existing user's ledger into one "My Holdings" account. The FIFO
-- engine now groups by (account, stock); with one account it is byte-identical to before.
-- Runs as ONE transaction (BEGIN/COMMIT via the applier). Drift-safe db-execute path.
-- ═══════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "PortfolioAccountState" AS ENUM ('manual', 'linked_live', 'linked_stale');

-- CreateTable: portfolio_accounts
CREATE TABLE "portfolio_accounts" (
    "id"                   TEXT                    NOT NULL,
    "user_id"              TEXT                    NOT NULL,
    "name"                 TEXT                    NOT NULL,
    "broker"               "BrokerId",
    "broker_connection_id" TEXT,
    "state"                "PortfolioAccountState" NOT NULL DEFAULT 'manual',
    "created_at"           TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3)            NOT NULL,

    CONSTRAINT "portfolio_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "portfolio_accounts_user_id_name_key" ON "portfolio_accounts"("user_id", "name");
CREATE INDEX        "portfolio_accounts_user_id_idx"      ON "portfolio_accounts"("user_id");
ALTER TABLE "portfolio_accounts"
    ADD CONSTRAINT "portfolio_accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_accounts"
    ADD CONSTRAINT "portfolio_accounts_broker_connection_id_fkey"
    FOREIGN KEY ("broker_connection_id") REFERENCES "broker_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 1) add account_id nullable
ALTER TABLE "transactions" ADD COLUMN "account_id" TEXT;
ALTER TABLE "holdings"     ADD COLUMN "account_id" TEXT;

-- 2) BACKFILL: one "My Holdings" per user who already has a ledger, then repoint every row.
INSERT INTO "portfolio_accounts" ("id", "user_id", "name", "state", "created_at", "updated_at")
SELECT gen_random_uuid()::text, u.uid, 'My Holdings', 'manual', now(), now()
FROM (
    SELECT DISTINCT "user_id" AS uid FROM "transactions"
    UNION
    SELECT DISTINCT "user_id" FROM "holdings"
) u
WHERE NOT EXISTS (
    SELECT 1 FROM "portfolio_accounts" pa WHERE pa."user_id" = u.uid AND pa."name" = 'My Holdings'
);

UPDATE "transactions" t SET "account_id" = pa."id"
FROM "portfolio_accounts" pa
WHERE pa."user_id" = t."user_id" AND pa."name" = 'My Holdings' AND t."account_id" IS NULL;

UPDATE "holdings" h SET "account_id" = pa."id"
FROM "portfolio_accounts" pa
WHERE pa."user_id" = h."user_id" AND pa."name" = 'My Holdings' AND h."account_id" IS NULL;

-- 3) enforce NOT NULL now that every existing row is backfilled
ALTER TABLE "transactions" ALTER COLUMN "account_id" SET NOT NULL;
ALTER TABLE "holdings"     ALTER COLUMN "account_id" SET NOT NULL;

-- 4) swap the holdings unique key (user,stock) → (account,stock)
DROP INDEX "holdings_user_id_stock_id_key";
CREATE UNIQUE INDEX "holdings_account_id_stock_id_key" ON "holdings"("account_id", "stock_id");

-- 5) FKs (cascade: an account is a container — deleting it removes its manual ledger) + replay index
ALTER TABLE "transactions"
    ADD CONSTRAINT "transactions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "portfolio_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "holdings"
    ADD CONSTRAINT "holdings_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "portfolio_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "transactions_account_id_stock_id_trade_date_created_at_idx"
    ON "transactions"("account_id", "stock_id", "trade_date", "created_at");
