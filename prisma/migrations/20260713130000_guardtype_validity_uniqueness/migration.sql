-- ═══════════════════════════════════════════════════════════════
-- GUARDTYPE: + validity, + uniqueness (Step 9 — AMFI needs guards that don't exist yet).
--
-- The five ingestion guards (shape/count/null_rate/range/continuity) all describe a value
-- that is PRESENT and well-formed but out of expectation. AMFI breaks in two ways none of
-- them name:
--
--   validity   — a value is present but is NOT THE KIND OF THING IT CLAIMS TO BE.
--                AMFI ships the literal strings "Redeemed" (×9) and "HDFCNIVODG" (×1) in
--                the ISIN column. That is not an out-of-range ISIN; it is not an ISIN.
--
--   uniqueness — a well-formed value COLLIDES A UNIQUE SPINE. Five valid ISINs each appear
--                under TWO different AMFI scheme codes (dead Nippon/Reliance FMPs — AMFI
--                data-entry errors). instruments.isin is UNIQUE, so the second one cannot
--                land: it must be reported and skipped, not silently lost.
--
-- Shoehorning these into `range` would mislabel them in the triage UI (which groups by
-- guardType) — a guard that lies about what tripped is worse than no guard.
--
-- SEPARATE FILE/TRANSACTION from any INSERT that uses these labels: PG17 permits
-- ALTER TYPE ... ADD VALUE inside a transaction, but the new label is NOT USABLE until
-- that transaction commits. The AMFI ingester (which writes them) runs later, separately.
--
-- Additive only. No existing row changes; every current guardType keeps its meaning.
-- ═══════════════════════════════════════════════════════════════

ALTER TYPE "GuardType" ADD VALUE IF NOT EXISTS 'validity';
ALTER TYPE "GuardType" ADD VALUE IF NOT EXISTS 'uniqueness';
