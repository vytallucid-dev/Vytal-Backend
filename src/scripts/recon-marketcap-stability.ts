// READ-ONLY recon: market-cap computation completeness + rank-boundary tightness.
// No writes. npx tsx src/scripts/recon-marketcap-stability.ts
import { prisma } from "../db/prisma.js";

async function main() {
  const totalStocks = await prisma.stock.count();

  // ── Shareholding completeness (total_shares availability) ──
  const stocksWithShareholding = await prisma.stock.count({
    where: { shareholdingPatterns: { some: {} } },
  });
  const stocksWithNonNullShares = await prisma.$queryRawUnsafe<{ n: number }[]>(`
    SELECT COUNT(DISTINCT s.id)::int as n
    FROM stocks s
    JOIN shareholding_patterns sp ON sp.stock_id = s.id
    WHERE sp.total_shares IS NOT NULL AND sp.total_shares > 0
  `);
  console.log("total stocks                              :", totalStocks);
  console.log("stocks with >=1 shareholding filing        :", stocksWithShareholding);
  console.log("stocks with a non-null/positive total_shares:", stocksWithNonNullShares[0].n);

  // Stocks with NO shareholding filing at all (would have no market cap under this formula)
  const noShareholding = await prisma.stock.findMany({
    where: { shareholdingPatterns: { none: {} } },
    select: { symbol: true },
  });
  console.log("\nstocks with ZERO shareholding filings (n=" + noShareholding.length + "):");
  console.log(noShareholding.map((s) => s.symbol).join(","));

  // ── StockPrice.marketCap completeness (already computed/stored today) ──
  const priceRows = await prisma.stockPrice.count();
  const mcNonNull = await prisma.stockPrice.count({ where: { marketCap: { not: null } } });
  const mcNull = await prisma.stockPrice.count({ where: { marketCap: null } });
  console.log("\nStockPrice rows total                     :", priceRows);
  console.log("StockPrice.marketCap non-null              :", mcNonNull);
  console.log("StockPrice.marketCap null                  :", mcNull);

  const nullReasons = await prisma.$queryRawUnsafe<any[]>(`
    SELECT s.symbol, sp.price, sp.price_date, sp.shares_as_of_date
    FROM stock_prices sp
    JOIN stocks s ON s.id = sp.stock_id
    WHERE sp.market_cap IS NULL
    ORDER BY s.symbol
  `);
  console.log("\nstocks with NULL marketCap today (n=" + nullReasons.length + "):");
  console.log(JSON.stringify(nullReasons, null, 2));

  // ── Full ranked list of currently-computed market caps (proxy for boundary tightness) ──
  const ranked = await prisma.$queryRawUnsafe<any[]>(`
    SELECT s.symbol, sp.market_cap::float as mcap
    FROM stock_prices sp
    JOIN stocks s ON s.id = sp.stock_id
    WHERE sp.market_cap IS NOT NULL
    ORDER BY sp.market_cap DESC
  `);
  console.log("\n=== Ranked by current stored marketCap (n=" + ranked.length + ") ===");
  ranked.forEach((r, i) => {
    const prev = ranked[i - 1];
    const gapPct = prev ? (((prev.mcap - r.mcap) / prev.mcap) * 100).toFixed(2) : "-";
    console.log(`  ${String(i + 1).padStart(3)}  ${r.symbol.padEnd(14)} ₹${Math.round(r.mcap).toLocaleString("en-IN")} Cr   gap-vs-prev: ${gapPct}%`);
  });

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
