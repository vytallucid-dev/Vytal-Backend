import { prisma } from "../db/prisma.js";

const SYMBOLS = ["ANGELONE", "BAJAJHLDNG", "NAM-INDIA", "NUVAMA", "UTIAMC", "HDFCAMC"];

async function main() {
  const stocks = await prisma.stock.findMany({ where: { symbol: { in: SYMBOLS } }, select: { id: true, symbol: true } });
  const idSet = new Set(stocks.map((s) => s.id));

  const pending = await prisma.backgroundJob.findMany({
    where: { status: { in: ["pending", "running"] } },
    select: { id: true, type: true, status: true, payload: true, createdAt: true },
  });
  console.log(`Total pending/running jobs: ${pending.length}`);
  let hits = 0;
  for (const j of pending) {
    const s = JSON.stringify(j.payload);
    const matchedSymbol = SYMBOLS.find((sym) => s.includes(sym));
    const matchedId = [...idSet].find((id) => s.includes(id));
    if (matchedSymbol || matchedId) {
      hits++;
      console.log(`  HIT job ${j.id} type=${j.type} status=${j.status} createdAt=${j.createdAt.toISOString()} payload=${s.slice(0, 300)}`);
    }
  }
  console.log(`Jobs referencing target stocks: ${hits}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
