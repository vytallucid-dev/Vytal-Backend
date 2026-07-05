// READ-ONLY: live sector table + current stock→sector/industryType distribution.
// npx tsx src/scripts/recon-sectors-live.ts
import { prisma } from "../db/prisma.js";

async function main() {
  const sectors = await prisma.sector.findMany({
    select: { id: true, name: true, displayName: true, sectorClass: true, stockCount: true },
    orderBy: { name: "asc" },
  });
  console.log("=== sectors (n=" + sectors.length + ") ===");
  for (const s of sectors) {
    console.log(`  ${s.name.padEnd(34)} | display="${s.displayName}" | class=${s.sectorClass ?? "-"} | stockCount=${s.stockCount}`);
  }

  // Existing stock → sector name distribution (what labels the current 224 actually use)
  const dist = await prisma.$queryRawUnsafe<any[]>(`
    SELECT sec.name as sector_name, COUNT(*)::int as n
    FROM stocks s LEFT JOIN sectors sec ON sec.id = s.sector_id
    GROUP BY sec.name ORDER BY n DESC
  `);
  console.log("\n=== current stock → sector.name distribution ===");
  for (const d of dist) console.log(`  ${String(d.n).padStart(3)}  ${d.sector_name ?? "(NULL)"}`);

  // industryType distribution (drives taxonomy/scoring path, NOT display sector)
  const ind = await prisma.$queryRawUnsafe<any[]>(`
    SELECT industry_type, COUNT(*)::int as n FROM stocks GROUP BY industry_type ORDER BY n DESC
  `);
  console.log("\n=== current stock industryType distribution ===");
  for (const d of ind) console.log(`  ${String(d.n).padStart(3)}  ${d.industry_type}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
