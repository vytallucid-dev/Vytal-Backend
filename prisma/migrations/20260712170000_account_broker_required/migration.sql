-- ═══════════════════════════════════════════════════════════════
-- BROKER-PARENT ACCOUNTS (Step 5.5) — every account BELONGS to a broker, from CREATION.
--
-- `broker` existed already, but was written ONLY by the link path — an account had no broker
-- identity until it was bound to a connection. The model inverts: a user picks a broker, creates
-- manual accounts UNDER it, and LINKING is the act of connecting an already-broker-tagged account
-- to that broker's real feed (so link now CHECKS account.broker == connection.broker rather than
-- assigning it).
--
-- BACKFILL: the only broker-less rows are the 2 pre-model test accounts (both 'My Holdings',
-- state=manual, unbound). They are stamped 'zerodha' per operator ruling — the value is immaterial
-- for these rows, it exists only to satisfy the incoming NOT NULL.
--
-- THIS IS A LABEL, NOT A NUMBER. `broker` is not an input to the FIFO engine, to PHS, or to any
-- price: the same share weighs the same wherever it is held (§2.4). So the backfill MUST NOT move
-- a single holding, avg, realized, or PHS fingerprint. If one moves, something reads this column
-- that has no business reading it — that is the un-waivable gate, not a formality.
--
-- Blast radius: 2 rows, one column. No index, no key, no other table.
-- Apply via the drift-safe db-execute + migrate-resolve path.
-- ═══════════════════════════════════════════════════════════════
UPDATE "portfolio_accounts" SET "broker" = 'zerodha' WHERE "broker" IS NULL;

ALTER TABLE "portfolio_accounts" ALTER COLUMN "broker" SET NOT NULL;
