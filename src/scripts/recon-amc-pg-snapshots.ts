import { prisma } from "../db/prisma.js";

async function main() {
  const pg = await prisma.peerGroup.findFirst({
    where: { name: "Large-Cap AMCs & Exchanges" },
    include: { stocks: { include: { stock: { select: { symbol: true, industryType: true } } } } },
  });
  console.log("PG:", pg?.id, pg?.name);
  console.log("Members:", pg?.stocks.map((s) => `${s.stock.symbol}(${s.stock.industryType})`));
  if (!pg) return;

  const memberIds = pg.stocks.map((s) => s.stockId);
  const snaps = await prisma.scoreSnapshot.findMany({
    where: { stockId: { in: memberIds } },
    select: { stockId: true, periodKey: true, createdAt: true },
  });
  console.log(`\nScoreSnapshot rows for this PG's members: ${snaps.length}`);
  snaps.forEach((s) => console.log(`  ${s.stockId} ${s.periodKey} ${s.createdAt.toISOString()}`));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
