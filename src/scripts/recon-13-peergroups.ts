import { prisma } from "../db/prisma.js";

const SYMBOLS = ["ANGELONE", "NAM-INDIA", "UTIAMC"];

async function main() {
  for (const symbol of SYMBOLS) {
    const stock = await prisma.stock.findUnique({ where: { symbol }, select: { id: true } });
    if (!stock) continue;
    const rows = await prisma.stockPeerGroup.findMany({
      where: { stockId: stock.id },
      include: { peerGroup: { select: { displayName: true } } },
    });
    console.log(symbol, JSON.stringify(rows.map((r) => ({ peerGroup: r.peerGroup })), null, 2));
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
