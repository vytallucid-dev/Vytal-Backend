// READ-ONLY recon: current universe snapshot for the Nifty-500 expansion viability check.
// No writes. npx tsx src/scripts/recon-nifty500-universe.ts
import { prisma } from "../db/prisma.js";

async function main() {
  const totalStocks = await prisma.stock.count();
  const activeStocks = await prisma.stock.count({ where: { isActive: true } });
  const withPg = await prisma.stock.count({ where: { peerGroups: { some: {} } } });
  const noPg = await prisma.stock.count({ where: { peerGroups: { none: {} } } });
  const scoredStocks = await prisma.stock.count({ where: { scoreSnapshots: { some: {} } } });

  console.log("=== Universe counts ===");
  console.log("total stocks           :", totalStocks);
  console.log("active stocks          :", activeStocks);
  console.log("with peer group        :", withPg);
  console.log("no peer group (null-PG):", noPg);
  console.log("stocks w/ >=1 snapshot  :", scoredStocks);

  const noPgSymbols = await prisma.stock.findMany({
    where: { peerGroups: { none: {} } },
    select: { symbol: true, isActive: true, marketCapCategory: true, sectorId: true },
    orderBy: { symbol: "asc" },
  });
  console.log("\n=== null-PG stocks (display-only today) ===");
  console.log(JSON.stringify(noPgSymbols, null, 2));

  const missingSector = await prisma.stock.count({ where: { sectorId: null } });
  const missingCapCat = await prisma.stock.count({ where: { marketCapCategory: null } });
  console.log("\nstocks missing sectorId        :", missingSector);
  console.log("stocks missing marketCapCategory:", missingCapCat);

  const allSymbols = await prisma.stock.findMany({ select: { symbol: true }, orderBy: { symbol: "asc" } });
  console.log("\n=== ALL current symbols (n=" + allSymbols.length + ") ===");
  console.log(allSymbols.map((s) => s.symbol).join(","));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
