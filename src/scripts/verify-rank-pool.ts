// STAGE 1 VERIFY — rank_pool_* is the correct, paired denominator. Run AFTER the fold.
import { prisma } from "../db/prisma.js";
const q = <T = any>(s: string) => prisma.$queryRawUnsafe<T[]>(s);
const j = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2);
let fails = 0;
const ok = (m: string) => console.log("  ✅ " + m);
const bad = (m: string) => { console.log("  ❌ " + m); fails++; };

async function main() {
  // ── INVARIANTS across the WHOLE table, per horizon ──
  for (const h of ["1y", "3y", "5y"]) {
    const inv = (await q(`
      SELECT
        count(*) FILTER (WHERE rank_${h} IS NOT NULL)::int AS ranked,
        count(*) FILTER (WHERE rank_${h} IS NOT NULL AND rank_pool_${h} IS NULL)::int AS ranked_but_no_pool,
        count(*) FILTER (WHERE rank_${h} IS NOT NULL AND rank_pool_${h} > rank_bucket_size)::int AS pool_gt_bucket,
        count(*) FILTER (WHERE rank_${h} IS NOT NULL AND rank_${h} > rank_pool_${h})::int AS rank_gt_pool,
        count(*) FILTER (WHERE rank_${h} IS NULL AND rank_pool_${h} IS NOT NULL)::int AS null_rank_but_pool
      FROM mf_analytics`))[0];
    const clean = inv.ranked_but_no_pool === 0 && inv.pool_gt_bucket === 0 && inv.rank_gt_pool === 0 && inv.null_rank_but_pool === 0;
    clean
      ? ok(`${h}: ${inv.ranked} ranked — pool present, rank ≤ pool ≤ bucketSize, null-rank⇒null-pool (all hold)`)
      : bad(`${h}: violations ${j(inv)}`);
  }

  // ── THE SIZE OF THE LIE — rows whose denominator would have been wrong ──
  const gap = (await q(`
    SELECT
      count(*) FILTER (WHERE rank_1y IS NOT NULL AND rank_pool_1y <> rank_bucket_size)::int AS rows_pool_ne_bucket_1y,
      max(rank_bucket_size - rank_pool_1y) FILTER (WHERE rank_1y IS NOT NULL)::int AS max_gap_1y,
      count(*) FILTER (WHERE (rank_1y IS NOT NULL AND rank_pool_1y <> rank_bucket_size)
                          OR (rank_3y IS NOT NULL AND rank_pool_3y <> rank_bucket_size)
                          OR (rank_5y IS NOT NULL AND rank_pool_5y <> rank_bucket_size))::int AS rows_any_horizon_gap
    FROM mf_analytics`))[0];
  console.log("\n[the size of the lie]\n" + j(gap));

  // ── A concrete example row: biggest 1y gap ──
  const ex = await q(`
    SELECT scheme_code, rank_1y, rank_pool_1y, rank_bucket_size, (rank_bucket_size - rank_pool_1y) AS gap, rank_bucket
    FROM mf_analytics WHERE rank_1y IS NOT NULL AND rank_pool_1y <> rank_bucket_size
    ORDER BY (rank_bucket_size - rank_pool_1y) DESC LIMIT 5`);
  console.log("\n[worst 1y gaps — 'rank_1y of rank_pool_1y' vs the old 'of rank_bucket_size']\n" + j(ex));

  console.log(fails === 0 ? "\n✅ STAGE 1 PASS" : `\n❌ ${fails} FAILED`);
  process.exitCode = fails === 0 ? 0 : 1;
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
