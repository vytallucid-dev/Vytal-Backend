// STEP 8 GATE 0 (cont.) — READ-ONLY. PG version (constrains the enum migration pattern)
// + is the ETF/REIT admit-collision live today?   npx tsx src/scripts/recon-step8-gate0b.ts
import { prisma } from "../db/prisma.js";

const v = await prisma.$queryRawUnsafe<any[]>(`SHOW server_version`);
console.log(`PostgreSQL server_version = ${v[0].server_version}`);

// Every broker holding + whether it resolved. An ETF/REIT symbol sitting here today would
// mean the mislabel-as-stock bug has already fired.
const bh = await prisma.brokerHolding.findMany({
  select: { symbol: true, stockId: true, instrumentId: true, quantity: true },
  orderBy: { symbol: "asc" },
});
console.log(`\nbroker_holdings rows: ${bh.length}`);
const unmapped = bh.filter((b) => b.stockId === null || b.instrumentId === null);
console.log(`  unmapped (held-not-scored): ${unmapped.length}`);
for (const b of unmapped) console.log(`    ⚠️  ${b.symbol} qty=${b.quantity}`);
console.log(`  symbols: ${bh.map((b) => b.symbol).join(", ") || "(none)"}`);

// Bare-admitted stocks (name === symbol, no sector) — the Step 7 admit signature.
const bare = await prisma.stock.findMany({
  where: { sectorId: null },
  select: { symbol: true, name: true, isin: true },
});
console.log(`\nbare/sectorless stocks (Step-7 admit signature): ${bare.length}`);
for (const s of bare.slice(0, 15)) console.log(`    ${s.symbol.padEnd(12)} ${s.isin}  ${s.name}`);

await prisma.$disconnect();
