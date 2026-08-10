// READ-ONLY recon: every ResultFetchLog row ever written with an "Industry
// mismatch" error, across the WHOLE universe (not the hardcoded 13) — to
// check whether the 13 is the complete set or whether more stocks are
// silently disagreeing with their own filed XBRL.
import { prisma } from "../db/prisma.js";

async function main() {
  const rows = await prisma.resultFetchLog.findMany({
    where: { error: { contains: "Industry mismatch" } },
    select: { stockId: true, symbol: true, error: true, fetchedAt: true, fiscalYear: true, quarter: true },
    orderBy: { fetchedAt: "desc" },
  });
  console.log(`Total mismatch log rows: ${rows.length}`);
  const bySymbol = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = bySymbol.get(r.symbol) ?? [];
    arr.push(r);
    bySymbol.set(r.symbol, arr);
  }
  console.log(`Distinct symbols with a mismatch row: ${bySymbol.size}`);
  for (const [symbol, arr] of [...bySymbol.entries()].sort()) {
    const stock = await prisma.stock.findUnique({ where: { symbol }, select: { industryType: true } });
    console.log(`\n${symbol}  (current industryType=${stock?.industryType})  ${arr.length} row(s)`);
    for (const r of arr.slice(0, 3)) {
      console.log(`   [${r.fetchedAt.toISOString().slice(0,10)}] ${r.error}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
