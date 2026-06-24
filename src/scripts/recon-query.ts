import { prisma } from "../db/prisma.js";

async function main() {
  // 1. stock_overviews rows (real data)
  const overviews = await prisma.$queryRawUnsafe(`
    SELECT s.symbol, so.industry, so.listed_since,
           SUBSTRING(so.core_business, 1, 150) as core_biz,
           so.revenue_model,
           array_to_string(so.business_tags, ',') as tags,
           so.created_at
    FROM stock_overviews so
    JOIN stocks s ON s.id = so.stock_id
    LIMIT 5
  `);
  console.log("\n=== stock_overviews rows ===");
  console.log(JSON.stringify(overviews, null, 2));

  // 2. Count
  const cnt = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as row_count FROM stock_overviews`);
  console.log("\n=== stock_overviews row count ===");
  console.log(JSON.stringify(cnt, null, 2));

  // 3. Active stocks with no peer group assignment
  const noPg = await prisma.$queryRawUnsafe(`
    SELECT s.symbol,
           EXISTS(SELECT 1 FROM score_snapshots ss WHERE ss.stock_id = s.id) as has_snapshot
    FROM stocks s
    WHERE s.is_active = true
      AND NOT EXISTS (SELECT 1 FROM stock_peer_groups spg WHERE spg.stock_id = s.id)
    LIMIT 10
  `);
  console.log("\n=== Active stocks with no PG (first 10) ===");
  console.log(JSON.stringify(noPg, null, 2));

  // 4. Sector classes seeded
  const sectorClasses = await prisma.$queryRawUnsafe(`
    SELECT name, display_name, sector_class FROM sectors ORDER BY name
  `);
  console.log("\n=== Sector classes (all) ===");
  console.log(JSON.stringify(sectorClasses, null, 2));

  // 5. PeerStatsSnapshot sampleN distribution
  const peerStatsDist = await prisma.$queryRawUnsafe(`
    SELECT sample_n::int, COUNT(*)::int as cnt,
           SUM(CASE WHEN std_dev > 0 THEN 1 ELSE 0 END)::int as with_spread
    FROM peer_stats_snapshots
    GROUP BY sample_n
    ORDER BY sample_n
  `);
  console.log("\n=== PeerStatsSnapshot sampleN distribution ===");
  console.log(JSON.stringify(peerStatsDist, null, 2));

  // 6. Check: any sampleN=4 rows?
  const sn4 = await prisma.$queryRawUnsafe(`
    SELECT metric_key, sample_n, mean, std_dev,
           (sample_n >= 5 AND std_dev > 0) as usable_flag
    FROM peer_stats_snapshots
    WHERE sample_n = 4
    LIMIT 5
  `);
  console.log("\n=== PeerStatsSnapshot with sampleN=4 ===");
  console.log(JSON.stringify(sn4, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
