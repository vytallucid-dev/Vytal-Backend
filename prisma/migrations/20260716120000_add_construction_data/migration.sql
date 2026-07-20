-- ═══════════════════════════════════════════════════════════════
-- Construction v2 Stage 6 — the Construction decomposition for the display read. One nullable JSONB on
-- portfolio_health_snapshot:
--   construction_data { gross, net, archetype, exposures{nameRisk,basket,debt,commodity},
--                       rules[C1…C6: {rule, evaluable, points, subjectShare, firedSubject, detail}] }
-- firedSubject/subjectShare are STRUCTURED — the FE renders from fields, never by parsing `detail` prose
-- (rebuilding that trap is exactly what broke the old Construction read). ADDITIVE + NULLABLE: pre-2.0
-- rows + no-holding users keep NULL and the FE degrades to value+band. NOT in fingerprintOf (§12
-- fingerprint inclusion stays Stage 7). APPLIED via the drift-safe db-execute + migrate-resolve path
-- ([[invest-iq-migration-drift]]).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "portfolio_health_snapshot" ADD COLUMN "construction_data" JSONB;
