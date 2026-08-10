// READ-ONLY: results-feed.cache.ts's fetchNonFinancial() filters ONLY on stock.isActive,
// not on stock.industryType — so for a stock with BOTH stale Fundamental/QuarterlyResult
// rows (old non_financial-era filings) AND live nbfc rows, it pulls BOTH into
// latestPerStock()'s per-stock reduction, which then keeps whichever has the newest
// reportDate. Check: for each of the 5 (+HDFCAMC) stocks, is the nbfc side's max
// reportDate >= the stale non-financial side's max reportDate? If yes, the feed has
// (so far, accidentally) been showing the correct row. If no, it's currently showing
// STALE data to users, mislabeled industryType="non_financial".
import { prisma } from "../db/prisma.js";

const SYMBOLS = ["ANGELONE", "BAJAJHLDNG", "NAM-INDIA", "NUVAMA", "UTIAMC", "HDFCAMC"];

async function main() {
  for (const symbol of SYMBOLS) {
    const stock = await prisma.stock.findUnique({ where: { symbol }, select: { id: true, industryType: true, isActive: true } });
    if (!stock) continue;
    const [staleQ, staleF, nbfcQ, nbfcF] = await Promise.all([
      prisma.quarterlyResult.findFirst({ where: { stockId: stock.id }, orderBy: { reportDate: "desc" }, select: { reportDate: true, fiscalYear: true, quarter: true } }),
      prisma.fundamental.findFirst({ where: { stockId: stock.id }, orderBy: { reportDate: "desc" }, select: { reportDate: true, fiscalYear: true } }),
      prisma.nbfcQuarterlyResult.findFirst({ where: { stockId: stock.id }, orderBy: { reportDate: "desc" }, select: { reportDate: true, fiscalYear: true, quarter: true } }),
      prisma.nbfcFundamental.findFirst({ where: { stockId: stock.id }, orderBy: { reportDate: "desc" }, select: { reportDate: true, fiscalYear: true } }),
    ]);
    console.log(`\n${symbol}  industryType=${stock.industryType} isActive=${stock.isActive}`);
    console.log(`  stale QuarterlyResult max reportDate: ${staleQ ? `${staleQ.reportDate?.toISOString().slice(0,10)} (${staleQ.fiscalYear}${staleQ.quarter})` : "(none)"}`);
    console.log(`  nbfc  QuarterlyResult max reportDate: ${nbfcQ ? `${nbfcQ.reportDate?.toISOString().slice(0,10)} (${nbfcQ.fiscalYear}${nbfcQ.quarter})` : "(none)"}`);
    console.log(`  stale Fundamental      max reportDate: ${staleF ? staleF.reportDate?.toISOString().slice(0,10) : "(none)"}`);
    console.log(`  nbfc  Fundamental      max reportDate: ${nbfcF ? nbfcF.reportDate?.toISOString().slice(0,10) : "(none)"}`);
    if (staleQ && nbfcQ) {
      const staleWins = staleQ.reportDate!.getTime() > nbfcQ.reportDate!.getTime();
      console.log(`  ${staleWins ? "⚠️  STALE ROW WOULD WIN latestPerStock() — LIVE BUG" : "✅ nbfc row is newer or equal — stale row loses the recency reduction"}`);
    } else if (staleQ && !nbfcQ) {
      console.log(`  ⚠️  ONLY the stale row exists in either table — it WOULD be shown (mislabeled non_financial)`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
