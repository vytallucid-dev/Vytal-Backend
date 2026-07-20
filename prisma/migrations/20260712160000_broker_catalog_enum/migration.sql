-- ═══════════════════════════════════════════════════════════════
-- BROKER CATALOG (Step 5.5) — widen BrokerId from an ADAPTER KEY to the
-- IDENTITY CATALOG every portfolio_account is tagged with.
--
-- TWO LISTS, ONE ENUM (the registry already models this split):
--   CATALOG  — what an account can BE (every member below). Tagged at CREATION.
--   LINKABLE — what has a working adapter (IMPLEMENTED_BROKERS: zerodha today).
-- A catalog-only broker is CREATE-NOW-LINK-LATER: a user hand-tracks an Angel One
-- account today and links it the day the Angel adapter ships — no data moves, the
-- account's identity was already right.
--
-- Deliberately NO 'other': the catalog is comprehensive, so catalog completeness is
-- LOAD-BEARING (a broker missing here = a user with no home). Adding one later is a
-- one-line enum add.
--
-- `mock` stays in the enum (harnesses create mock accounts) but is HIDDEN from the
-- picker list — creatable via API, never offered in the UI.
--
-- Additive: no table, no row, no index touched. An unused enum label is inert.
-- Apply via the drift-safe db-execute + migrate-resolve path.
-- ═══════════════════════════════════════════════════════════════
ALTER TYPE "BrokerId" ADD VALUE IF NOT EXISTS 'angelone';
ALTER TYPE "BrokerId" ADD VALUE IF NOT EXISTS 'dhan';
ALTER TYPE "BrokerId" ADD VALUE IF NOT EXISTS 'fyers';
ALTER TYPE "BrokerId" ADD VALUE IF NOT EXISTS 'icicidirect';
ALTER TYPE "BrokerId" ADD VALUE IF NOT EXISTS 'hdfcsecurities';
ALTER TYPE "BrokerId" ADD VALUE IF NOT EXISTS 'kotak';
ALTER TYPE "BrokerId" ADD VALUE IF NOT EXISTS 'sharekhan';
ALTER TYPE "BrokerId" ADD VALUE IF NOT EXISTS 'fivepaisa';
ALTER TYPE "BrokerId" ADD VALUE IF NOT EXISTS 'motilaloswal';
ALTER TYPE "BrokerId" ADD VALUE IF NOT EXISTS 'iifl';
ALTER TYPE "BrokerId" ADD VALUE IF NOT EXISTS 'sbisecurities';
ALTER TYPE "BrokerId" ADD VALUE IF NOT EXISTS 'paytmmoney';
ALTER TYPE "BrokerId" ADD VALUE IF NOT EXISTS 'axisdirect';
