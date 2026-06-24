import { prisma } from "../db/prisma.js";

async function main() {
  // Find actual metric_scores table name
  const scoreTables = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE '%metric%' OR table_name LIKE '%score%'
    ORDER BY table_name
  `);
  console.log("\n=== Tables with 'metric' or 'score' in name ===");
  console.log(JSON.stringify(scoreTables, null, 2));

  // score_peer_stats sampleN distribution
  const sampleNDist = await prisma.$queryRawUnsafe(`
    SELECT sample_n::int, COUNT(*)::int as cnt,
           SUM(CASE WHEN std_dev > 0 THEN 1 ELSE 0 END)::int as with_spread
    FROM score_peer_stats
    GROUP BY sample_n ORDER BY sample_n
  `);
  console.log("\n=== score_peer_stats sampleN distribution ===");
  console.log(JSON.stringify(sampleNDist, null, 2));

  // Any sampleN=4 entries?
  const sn4 = await prisma.$queryRawUnsafe(`
    SELECT metric_key, sample_n::int, mean::float, std_dev::float,
           (sample_n >= 5 AND std_dev > 0) as "usable_at_5_threshold",
           (sample_n >= 4) as "chip_floor_at_4"
    FROM score_peer_stats WHERE sample_n = 4 LIMIT 5
  `);
  console.log("\n=== score_peer_stats with sampleN=4 ===");
  console.log(JSON.stringify(sn4, null, 2));

  // Check l2Score nullness (are l2Scores actually populated?)
  const l2Check = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND (table_name LIKE '%foundation%' OR table_name LIKE '%momentum%')
    ORDER BY table_name
  `);
  console.log("\n=== Foundation/Momentum pillar tables ===");
  console.log(JSON.stringify(l2Check, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
