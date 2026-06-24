import { prisma } from "../db/prisma.js";

async function main() {
  // Are there scored stocks with no peer group?
  const scoredNoPg = await prisma.$queryRawUnsafe(`
    SELECT s.symbol, ss.period_key
    FROM stocks s
    JOIN score_snapshots ss ON ss.stock_id = s.id
    WHERE s.is_active = true
      AND NOT EXISTS (SELECT 1 FROM stock_peer_groups spg WHERE spg.stock_id = s.id)
    LIMIT 10
  `);
  console.log("\n=== Scored stocks with no PG (any period) ===");
  console.log(JSON.stringify(scoredNoPg, null, 2));

  // What tables exist that relate to peer stats?
  const peerTables = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE '%peer%'
    ORDER BY table_name
  `);
  console.log("\n=== All peer-related tables ===");
  console.log(JSON.stringify(peerTables, null, 2));

  // Check MetricScore columns to find peerStats relation
  const metricScoreCols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'metric_scores'
    ORDER BY ordinal_position
  `);
  console.log("\n=== metric_scores columns ===");
  console.log(JSON.stringify(metricScoreCols, null, 2));

  // Check for stocks where scored but in a solo PG (only member)
  const soloScored = await prisma.$queryRawUnsafe(`
    SELECT s.symbol, pg.display_name, pg.stock_count
    FROM stocks s
    JOIN stock_peer_groups spg ON spg.stock_id = s.id
    JOIN peer_groups pg ON pg.id = spg.peer_group_id
    WHERE pg.stock_count = 1
      AND EXISTS (SELECT 1 FROM score_snapshots ss WHERE ss.stock_id = s.id)
    LIMIT 10
  `);
  console.log("\n=== Scored stocks in solo PG (stock_count=1) ===");
  console.log(JSON.stringify(soloScored, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
