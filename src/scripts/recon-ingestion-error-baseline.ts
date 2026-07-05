// READ-ONLY: snapshot IngestionError counts (baseline before/after a run).
import { prisma } from "../db/prisma.js";
async function main() {
  const open = await prisma.ingestionError.count({ where: { status: "open" } });
  const total = await prisma.ingestionError.count();
  const shp = await prisma.ingestionError.count({ where: { targetTable: "ShareholdingPattern" } });
  const openShp = await prisma.ingestionError.count({ where: { targetTable: "ShareholdingPattern", status: "open" } });
  console.log(JSON.stringify({ total, open, shareholdingPatternRows: shp, openShareholdingPattern: openShp }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
