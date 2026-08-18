-- ═══════════════════════════════════════════════════════════════
-- RETENTION FLOORS — re-derived from the LENS-3 ARITHMETIC, not from window sizes.
-- DATA-ONLY: six UPDATEs on `retention_policy`. Four change `floor` + `floor_reason`;
-- two change `floor_reason` ONLY. No DDL, no schema.prisma change, no data table
-- touched. `keep`, `days`, `armed`, `enabled`, `mode`, `key_cols`, `order_col` are
-- NOT changed anywhere in this migration.
--
-- ⚠ THIS IS THE ONLY MECHANISM. The audited admin route can edit
--   keep|days|supersededDays|armed|enabled and NOTHING ELSE
--   (controllers/admin/retention-controller.ts:20-24, where the editable list is defined
--   and `floor` is called a correctness constraint). A floor can therefore only ever be
--   set — or repaired — by a migration, and `floor_reason` is the only durable record of
--   the read site the number came from. Every reason below names its consumer with
--   file:line for exactly that reason.
--
-- ⚠ STANDING PRINCIPLE (ODL): floor at the MEASURED consumer requirement, keep at the
--   desired ceiling. NEVER the same number — floor == keep freezes a policy
--   immutable-downward. Stage 1 (2026-08-16, audited route, changedBy "Arman") raised
--   keep on 13 policies, which is what created the headroom these floors now sit inside.
--
-- ── THE ARITHMETIC THAT PRODUCED EVERY NUMBER ─────────────────────────────────────────
-- A floor is NOT a metric window size. Lens-3 own-history is rebuilt by RE-DISPATCHING
-- the metric over each row prefix — `seriesForKey` at composite/score-pass.ts:113-123
-- walks rows.slice(0, i+1) and keeps the values that come out available. So a metric
-- needing K periods per value, with Lens-3 requiring l3MinN values, consumes:
--
--        K + l3MinN - 1   ROWS
--
-- The two wiring configs are chosen BY PILLAR, not by industry
-- (composite/score-pass.ts:86-87, applied at :522-523):
--        F_CFG = { peerMinN: 5, l3MinN: 5, l3Window: 10 }   (foundation)
--        M_CFG = { peerMinN: 5, l3MinN: 6, l3Window: 12 }   (momentum)
-- Banking inherits both, because the config is per-pillar and bankingSeriesForKey
-- (metrics/banking.ts:355-368) re-dispatches over prefixes the same way.
--
--   quarterly_results          K=8 (M3/M4, metrics/momentum.ts:125,144)  + 6 - 1 = 13
--   fundamentals               K=5 (F8 4y window + FY-1, metrics/foundation.ts:263,275)
--                                                                       + 5 - 1 =  9
--   banking_quarterly_results  K=4 (NIM, metrics/banking.ts:258)         + 6 - 1 =  9
--   banking_fundamentals       K=2 (annual YoY, metrics/banking.ts:281)  + 5 - 1 =  6
--
-- Every one of the four is an INCREASE, so each strictly ADDS protection, and every new
-- floor sits well below its current keep (32/14/32/14) — no clamp can fire.
--
-- ── TWO PROPOSED DECREASES WERE REJECTED. DO NOT RE-PROPOSE THEM. ─────────────────────
-- · index_prices 1250 -> 127 — REJECTED. 127 is the REGIME read
--   (REGIME_LOOKBACK_ROWS + 1, scoring/regime/regime.ts:68), which is the SHALLOWEST
--   consumer of this table, not the deepest. The binding consumer is MF analytics, which
--   loads benchmark series over LOOKBACK_DAYS = H.y5 + 30 = 1856 CALENDAR days
--   (amfi/mf-accumulator.ts:24, amfi/mf-analytics.ts:48) via loadBenchmarkSeries
--   (amfi/mf-benchmark.ts:464) and feeds beta_5y / alpha_5y / tracking_error_5y /
--   sharpe_5y (amfi/mf-analytics.ts:841-859,985-991). At the measured 246 trading
--   days/yr that window is ~1251 bars, so the existing 1250 IS the 5-year requirement,
--   essentially to the bar. Dropping to 127 would let a future admin set keep=127 through
--   the audited route and silently destroy every 5-year MF metric. The floor==keep
--   hazard that made 1250 look wrong was already removed in Stage 1 by raising keep to
--   1900 — there are now 650 bars of gap. Only the reason text changes here.
-- · daily_prices 760 -> 757 — REJECTED. 757 is correct as the bare requirement
--   (WIN.A2 = 756 trading days plus the anchor bar, market/universal-subcomponents.ts:26,73)
--   and the old reason under-stated it by one. But 760 already covers 757 with three bars
--   of slack, keep is 1900, and no admin will ever set keep into the 757-760 gap. The
--   change would remove protection and buy nothing. Only the reason text changes here.
--
-- ── SIX FINANCIAL TABLES DELIBERATELY EXCLUDED ───────────────────────────────────────
-- nbfc_quarterly_results, nbfc_fundamentals, life_insurance_quarterly_results,
-- life_insurance_fundamentals, general_insurance_quarterly_results,
-- general_insurance_fundamentals are NOT touched. They have NO live consumer:
--   · they are not on the scoring path — only non_financial and banking are dispatched
--     (composite/score-pass.ts:399-442);
--   · every findings rule that reads filed rows bails on
--     isFinancialIndustry = (industry) => industry !== "non_financial"
--     (findings/types.ts:183) — N1:55, N2:65, N3:41, N4:58, P7:42, P8:35, P13:54,
--     R3:34, R4:38, R5:61 in findings/rules/;
--   · P11 and P12 carry no explicit guard but read ctx.quarterlyOpm, which
--     composite/score-pass.ts:602 sets to null for every financial industry.
-- They are written by ingestion and read by nothing. There is no measured requirement to
-- derive a floor from, and inventing one from a hypothetical future scoring path is
-- exactly the freeze hazard this migration exists to avoid. Migrate them ALONGSIDE the
-- code that reads them, never before it.
--
-- ── shareholding_patterns DELIBERATELY NOT TOUCHED ───────────────────────────────────
-- Its floor stays 8. The consumer, countConsecutiveTrailingQuarters
-- (ownership/baseline.ts:44-55), counts ROWS and breaks only on a gap larger than
-- GAP_MONTHS_THRESHOLD = 4 months (ownership/dilution.ts:65,216-221), so an interim
-- filing counts as a quarter. Floor and consumer therefore agree with each other, and
-- raising the floor would over-constrain without fixing anything. Both diverge from the
-- documented intent instead: MEASURED 2026-08-16, 472 stocks hold >= 8 rows but only 460
-- hold >= 8 genuine quarter-ends, so 12 stocks read established_75 off fewer than 8 real
-- quarters. That is a scoring defect, not a retention one.
-- ⚠ FORWARD DEPENDENCY: if that counter is ever corrected to count quarter-ends, this
--   floor MUST rise in the SAME change, to 8 + worst-case interims (measured worst:
--   IDFCFIRSTB, 5 interims against 8 quarter-ends, so 13). Correcting the counter alone
--   silently under-serves the baseline it was meant to fix.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260816120000_retention_floors_l3_derived`, then
-- `prisma generate`, then `prisma migrate status` clean. NEVER `migrate dev`.
-- ═══════════════════════════════════════════════════════════════

-- ── 1/6 · quarterly_results — floor 8 -> 13 ──────────────────────────────────────────
UPDATE "retention_policy"
   SET "floor" = 13,
       "floor_reason" =
         'Momentum L3 own-history. M3/M4 need 8 consecutive quarters '
         '(scoring/metrics/momentum.ts:125,144); Lens-3 re-dispatches the metric over each row '
         'prefix (scoring/composite/score-pass.ts:113-123) and requires l3MinN=6 values '
         '(M_CFG, scoring/composite/score-pass.ts:87), so prefixes 8..13 = 13 rows.'
 WHERE "table_name" = 'quarterly_results';

-- ── 2/6 · fundamentals — floor 5 -> 9 ────────────────────────────────────────────────
UPDATE "retention_policy"
   SET "floor" = 9,
       "floor_reason" =
         'Foundation L3 own-history. F8 reads a 4-year window plus FY-1 for the capex proxy '
         '(scoring/metrics/foundation.ts:263,275) = 5 rows per value, and F9 spans 5 '
         '(scoring/metrics/foundation.ts:317); Lens-3 re-dispatches per prefix '
         '(scoring/composite/score-pass.ts:113-123) requiring l3MinN=5 values '
         '(F_CFG, scoring/composite/score-pass.ts:86), so prefixes 5..9 = 9 rows.'
 WHERE "table_name" = 'fundamentals';

-- ── 3/6 · banking_quarterly_results — floor 4 -> 9 ───────────────────────────────────
UPDATE "retention_policy"
   SET "floor" = 9,
       "floor_reason" =
         'Banking momentum L3 own-history. NIM needs 4 consecutive quarters '
         '(scoring/metrics/banking.ts:258); bankingSeriesForKey re-dispatches per prefix '
         '(scoring/metrics/banking.ts:355-368) into the same Lens-3 gate at l3MinN=6 '
         '(M_CFG, scoring/composite/score-pass.ts:87,523), so prefixes 4..9 = 9 rows.'
 WHERE "table_name" = 'banking_quarterly_results';

-- ── 4/6 · banking_fundamentals — floor 2 -> 6 ────────────────────────────────────────
UPDATE "retention_policy"
   SET "floor" = 6,
       "floor_reason" =
         'Banking foundation L3 own-history. The annual metrics need 2 consecutive fiscal years '
         '(scoring/metrics/banking.ts:281); bankingSeriesForKey re-dispatches per prefix '
         '(scoring/metrics/banking.ts:355-368) into the Lens-3 gate at l3MinN=5 '
         '(F_CFG, scoring/composite/score-pass.ts:86,522), so prefixes 2..6 = 6 rows.'
 WHERE "table_name" = 'banking_fundamentals';

-- ── 5/6 · daily_prices — floor UNCHANGED at 760, reason corrected ────────────────────
UPDATE "retention_policy"
   SET "floor_reason" =
         'Market A2 range position reads WIN.A2=756 trading days plus the anchor bar = 757 rows '
         '(scoring/market/universal-subcomponents.ts:26,73). Floor held at 760 for 3 bars of slack. '
         'The price-view r3y window (1095 calendar days, about 738 bars at the measured 246/yr rate, '
         'scoring/read/price-view.service.ts:58) is shallower and not binding.'
 WHERE "table_name" = 'daily_prices';

-- ── 6/6 · index_prices — floor UNCHANGED at 1250, reason names the binding consumer ──
UPDATE "retention_policy"
   SET "floor_reason" =
         'MF analytics loads benchmark series over LOOKBACK_DAYS = H.y5 + 30 = 1856 calendar days '
         '(ingestions/amfi/mf-accumulator.ts:24; ingestions/amfi/mf-analytics.ts:48) via '
         'loadBenchmarkSeries (ingestions/amfi/mf-benchmark.ts:464), feeding beta_5y / alpha_5y / '
         'tracking_error_5y / sharpe_5y (ingestions/amfi/mf-analytics.ts:841-859,985-991) — 1251 '
         'trading bars at the measured 246/yr rate. The regime read needs only 127 '
         '(scoring/regime/regime.ts:68) and is NOT the binding consumer.'
 WHERE "table_name" = 'index_prices';
