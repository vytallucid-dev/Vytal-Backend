// STAGE 2 RECON (read-only) — evidence for the IDCW-chart report. SELECT-only.
import { prisma } from "../db/prisma.js";
const q = <T = any>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);
const j = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2);

async function main() {
  // 109446 — the operator's IDCW example. Its own analytics + plan classification.
  console.log("[109446 mf_analytics + family/tier/plan]\n" + j(await q(`
    SELECT a.scheme_code, a.ret_1y, a.nav_points, a.omissions->>'ret_1y' AS ret1y_omission,
           mm.plan_option, mm.scheme_name, f.canonical_name, f.family_key
    FROM mf_family_members mm
    JOIN mf_families f ON f.id = mm.family_id
    LEFT JOIN mf_analytics a ON a.scheme_code = mm.scheme_code
    WHERE mm.scheme_code = '109446'`)));

  // Its tier-matched Growth siblings (same family_id, same tier) with their analytics.
  console.log("\n[109446's tier-matched Growth siblings + their ret_1y + nav_points]\n" + j(await q(`
    WITH me AS (
      SELECT mm.family_id, lower(coalesce(mm.plan_option, mm.scheme_name)) AS src
      FROM mf_family_members mm WHERE mm.scheme_code='109446')
    SELECT s.scheme_code, s.plan_option, a.ret_1y, a.nav_points
    FROM mf_family_members s
    JOIN me ON me.family_id = s.family_id
    LEFT JOIN mf_analytics a ON a.scheme_code = s.scheme_code
    WHERE lower(coalesce(s.plan_option, s.scheme_name)) ~ 'growth'
      AND lower(coalesce(s.plan_option, s.scheme_name)) !~ 'bonus'
      AND (CASE WHEN me.src LIKE '%direct%' THEN 'direct' WHEN me.src LIKE '%regular%' THEN 'regular' ELSE 'none' END)
        = (CASE WHEN lower(coalesce(s.plan_option,s.scheme_name)) LIKE '%direct%' THEN 'direct'
                WHEN lower(coalesce(s.plan_option,s.scheme_name)) LIKE '%regular%' THEN 'regular' ELSE 'none' END)
    ORDER BY a.nav_points DESC NULLS LAST`)));

  // The split table shape (Q2).
  console.log("\n[instrument_corporate_events splits]\n" + j(await q(`
    SELECT count(*)::int AS rows, count(DISTINCT instrument_id)::int AS instruments,
           count(*) FILTER (WHERE split_factor IS NOT NULL AND applied_date IS NOT NULL)::int AS usable
    FROM instrument_corporate_events WHERE event_type='split'`)));

  // How many of the 61 split instruments are ETF (listed → udiff path) vs fund (mfapi path)?
  console.log("\n[split instruments by asset_class]\n" + j(await q(`
    SELECT i.asset_class::text, count(*)::int AS n
    FROM instrument_corporate_events e JOIN instruments i ON i.id=e.instrument_id
    WHERE e.event_type='split' GROUP BY i.asset_class`)));

  // Feasibility of read-time twin resolution: does a scheme code join cheaply to family+tier?
  console.log("\n[indexes backing the read-time twin query]\n" + j(await q(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename IN ('mf_family_members','mf_families') ORDER BY tablename, indexname`)));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
