-- ═══════════════════════════════════════════════════════════════
-- MF CATALOGUE FIELDS (Step 9) — the generic catalogue learns to hold a fund.
--
-- A mutual fund is a holdable instrument with NO TICKER. `symbol` has been NOT NULL
-- since the catalogue was born (every row was a stock, and a stock always has one).
-- ~17,567 MF ISINs have nothing honest to put there, so `symbol` becomes NULLABLE
-- rather than carry a fabricated ticker or an AMFI scheme code masquerading as one.
--
-- amfi_scheme_code is the Layer-C (NAV-history) join key. It is NOT a family key:
-- recon proved Direct and Regular are SEPARATE scheme codes (one fund → up to 24 of
-- them), so the code groups AT MOST the 2 ISINs of ONE plan+option (growth/payout +
-- div-reinvestment). scheme_name is captured RAW so a family key can be DERIVED in a
-- later step — this step deliberately does not group plans.
--
-- current_nav is DECIMAL(18,8), NOT the house (12,2): AMFI publishes up to 8 decimal
-- places (385 rows do) and NAVs as large as 2,510,326.4049 (7 integer digits). A
-- (12,2) column would silently truncate 12,000+ NAVs — a rounded NAV is a quiet lie.
--
-- nav_date is load-bearing: 44.8% of schemes carry a STALE NAV (matured funds still
-- listed, some from 2016). A NAV must never render without its date.
--
-- ZERO CHANGE to the 504 stock rows: every column added is NULLABLE (stocks leave
-- them all NULL) and `symbol` only LOOSENS — no existing value is rewritten.
-- No AssetClass change: `mutual_fund` already exists.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL, then `migrate resolve --applied`.
-- ═══════════════════════════════════════════════════════════════

-- ── symbol: NOT NULL → NULLABLE (a fund has no ticker) ──
ALTER TABLE "instruments" ALTER COLUMN "symbol" DROP NOT NULL;

-- ── MF identity + current-NAV payload (all NULLABLE) ──
ALTER TABLE "instruments"
    ADD COLUMN "amfi_scheme_code" TEXT,          -- Layer-C NAV-history join key (NOT a family key)
    ADD COLUMN "scheme_name"      TEXT,          -- raw AMFI name — material for LATER family derivation
    ADD COLUMN "fund_house"       TEXT,          -- AMC (from the AMFI AMC header line)
    ADD COLUMN "category"         TEXT,          -- AMFI scheme-type section header
    ADD COLUMN "plan_type"        TEXT,          -- direct | regular; NULL when underivable (never guessed)
    ADD COLUMN "current_nav"      DECIMAL(18,8), -- honest-null on blank/N.A.; NEVER coerced from missing
    ADD COLUMN "nav_date"         DATE;          -- staleness lives here, it is never invented

-- Many ISINs share one scheme code (growth + reinvestment) → deliberately NON-unique.
CREATE INDEX "instruments_amfi_scheme_code_idx" ON "instruments"("amfi_scheme_code");
