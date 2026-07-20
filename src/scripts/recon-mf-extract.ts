// READ-ONLY extraction for the fund-chart/detail recon. SELECT-only. No writes.
import { prisma } from "../db/prisma.js";
const q = <T = any>(s: string) => prisma.$queryRawUnsafe<T[]>(s);
const j = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2);

async function main() {
  // ── §3 IDCW twin availability ──
  console.log("\n### §3 IDCW");
  console.log("[3a] mf_analytics rows honest-nulled idcw_nav_not_total_return:\n" + j(await q(
    `SELECT count(*)::int AS n FROM mf_analytics WHERE omissions::text LIKE '%idcw_nav_not_total_return%'`)));
  console.log("[3b] IDCW classified from plan_option/scheme_name, twin-slot present vs absent:\n" + j(await q(`
    WITH c AS (
      SELECT mm.scheme_code, mm.family_id,
             lower(coalesce(mm.plan_option, mm.scheme_name)) AS src
      FROM mf_family_members mm JOIN mf_families f ON f.id=mm.family_id
      WHERE f.asset_class='mutual_fund'),
    x AS (SELECT scheme_code, family_id,
                 CASE WHEN src LIKE '%direct%' THEN 'direct' WHEN src LIKE '%regular%' THEN 'regular' ELSE 'none' END AS tier,
                 (src LIKE '%growth%' AND src NOT LIKE '%bonus%') AS is_growth FROM c),
    gslots AS (SELECT DISTINCT family_id, tier FROM x WHERE is_growth)
    SELECT
      (SELECT count(*) FROM x)::int AS mf_members,
      (SELECT count(*) FROM x WHERE is_growth)::int AS growth,
      (SELECT count(*) FROM x WHERE NOT is_growth)::int AS idcw_total,
      (SELECT count(*) FROM x WHERE NOT is_growth AND (family_id,tier) IN (SELECT * FROM gslots))::int AS idcw_growth_slot_present,
      (SELECT count(*) FROM x WHERE NOT is_growth AND (family_id,tier) NOT IN (SELECT * FROM gslots))::int AS idcw_no_growth_slot`)));

  // ── §4 families ──
  console.log("\n### §4 FAMILIES (mutual_fund)");
  console.log("[4a] schemeCount distribution:\n" + j(await q(`
    SELECT scheme_count, count(*)::int AS families
    FROM mf_families WHERE asset_class='mutual_fund'
    GROUP BY scheme_count ORDER BY scheme_count`)));
  console.log("[4b] families with >=1 member non-null ret1y  vs  0 members with ANY analytics row:\n" + j(await q(`
    SELECT
      count(*) FILTER (WHERE has_ret1y)::int AS fams_with_a_ret1y,
      count(*) FILTER (WHERE NOT has_any_row)::int AS fams_zero_analytics_rows,
      count(*)::int AS total_families
    FROM (
      SELECT f.id,
             bool_or(a.ret_1y IS NOT NULL) AS has_ret1y,
             bool_or(a.scheme_code IS NOT NULL) AS has_any_row
      FROM mf_families f
      JOIN mf_family_members m ON m.family_id=f.id
      LEFT JOIN mf_analytics a ON a.scheme_code=m.scheme_code
      WHERE f.asset_class='mutual_fund'
      GROUP BY f.id) t`)));

  // ── §5 category / house ──
  console.log("\n### §5 CATEGORY / HOUSE");
  console.log("[5a] instruments.category distinct count (mutual_fund+etf):\n" + j(await q(
    `SELECT count(DISTINCT category)::int AS distinct_categories FROM instruments WHERE asset_class IN ('mutual_fund','etf')`)));
  console.log("[5b] top 40 categories:\n" + j(await q(`
    SELECT category, count(*)::int AS n FROM instruments
    WHERE asset_class IN ('mutual_fund','etf') GROUP BY category ORDER BY n DESC LIMIT 40`)));
  console.log("[5c] rank_bucket distinct count + filled:\n" + j(await q(`
    SELECT count(*)::int AS rows, count(rank_bucket)::int AS rank_bucket_filled,
           count(DISTINCT rank_bucket)::int AS distinct_rank_buckets FROM mf_analytics`)));
  console.log("[5d] fundHouse distinct + top 25:\n" + j(await q(
    `SELECT count(DISTINCT fund_house)::int AS distinct_houses FROM instruments WHERE asset_class IN ('mutual_fund','etf')`)));
  console.log(j(await q(`
    SELECT fund_house, count(*)::int AS n FROM instruments
    WHERE asset_class IN ('mutual_fund','etf') GROUP BY fund_house ORDER BY n DESC LIMIT 25`)));
  console.log("[5e] category population (null check):\n" + j(await q(`
    SELECT asset_class::text, count(*)::int AS n, count(category)::int AS category_filled, count(plan_type)::int AS plan_type_filled
    FROM instruments WHERE asset_class IN ('mutual_fund','etf') GROUP BY asset_class`)));

  // ── §6 rank ──
  console.log("\n### §6 RANK");
  console.log("[6a] rank_bucket_size distribution (bands):\n" + j(await q(`
    SELECT
      count(*) FILTER (WHERE rank_bucket_size < 5)::int AS lt5,
      count(*) FILTER (WHERE rank_bucket_size BETWEEN 5 AND 20)::int AS b5_20,
      count(*) FILTER (WHERE rank_bucket_size BETWEEN 21 AND 50)::int AS b21_50,
      count(*) FILTER (WHERE rank_bucket_size > 50)::int AS gt50,
      count(rank_bucket_size)::int AS with_size,
      count(rank_1y)::int AS with_rank1y, count(pct_1y)::int AS with_pct1y
    FROM mf_analytics`)));

  // ── §7 rolling ──
  console.log("\n### §7 ROLLING");
  console.log("[7a] roll_1y_n distribution:\n" + j(await q(`
    SELECT count(roll_1y_n)::int AS filled,
           min(roll_1y_n)::int AS min_n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY roll_1y_n)::int AS median_n,
           max(roll_1y_n)::int AS max_n
    FROM mf_analytics WHERE roll_1y_n IS NOT NULL`)));
}
main().catch((e) => { console.error("ERR:", e.message); process.exit(1); }).finally(() => prisma.$disconnect());
