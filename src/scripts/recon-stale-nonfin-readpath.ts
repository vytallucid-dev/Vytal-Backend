// READ-ONLY: for each of the 5 (+HDFCAMC) candidate stocks, which PeerGroup(s) is it
// actually a member of (StockPeerGroup), and is that PG among the peer groups that
// actually get computePgScores() called on them by the live/cron scoring path?
import { prisma } from "../db/prisma.js";

const SYMBOLS = ["ANGELONE", "BAJAJHLDNG", "NAM-INDIA", "NUVAMA", "UTIAMC", "HDFCAMC"];

async function main() {
  for (const symbol of SYMBOLS) {
    const stock = await prisma.stock.findUnique({ where: { symbol }, select: { id: true, industryType: true } });
    if (!stock) { console.log(`${symbol}: NOT FOUND`); continue; }
    const spg = await prisma.stockPeerGroup.findMany({
      where: { stockId: stock.id },
      include: { peerGroup: { select: { id: true, name: true } } },
    });
    console.log(`\n${symbol}  industryType=${stock.industryType}`);
    if (!spg.length) { console.log("   (no StockPeerGroup rows — not a member of any peer group)"); continue; }
    for (const row of spg) {
      console.log(`   PG: ${row.peerGroup.name} (id=${row.peerGroup.id})`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
