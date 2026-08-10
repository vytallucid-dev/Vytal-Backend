import { prisma } from "../db/prisma.js";
async function main() {
  const stock = await prisma.stock.findUnique({ where: { symbol: "360ONE" }, select: { id: true } });
  if (!stock) return;
  const r = await prisma.stockFinding.findFirst({ where: { stockId: stock.id, ruleKey: "ownership_R1_pledge" } });
  console.log(JSON.stringify(r, null, 2));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
