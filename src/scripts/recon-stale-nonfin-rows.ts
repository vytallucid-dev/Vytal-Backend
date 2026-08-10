import { prisma } from "../db/prisma.js";

const SYMBOLS = ["ANGELONE", "BAJAJHLDNG", "NAM-INDIA", "NUVAMA", "UTIAMC"];

async function main() {
  for (const symbol of SYMBOLS) {
    const stock = await prisma.stock.findUnique({ where: { symbol }, select: { id: true } });
    if (!stock) continue;
    const fund = await prisma.fundamental.findMany({
      where: { stockId: stock.id },
      select: { fiscalYear: true, resultType: true, reportDate: true, revenue: true, netProfit: true, createdAt: true },
      orderBy: { fiscalYear: "asc" },
    });
    const qr = await prisma.quarterlyResult.findMany({
      where: { stockId: stock.id },
      select: { fiscalYear: true, quarter: true, resultType: true, reportDate: true, revenue: true, netProfit: true, createdAt: true },
      orderBy: [{ fiscalYear: "asc" }, { quarter: "asc" }],
    });
    console.log(`\n=== ${symbol} ===`);
    console.log(" Fundamental (annual) rows:");
    fund.forEach((f) =>
      console.log(`   ${f.fiscalYear} ${f.resultType.padEnd(13)} reportDate=${f.reportDate?.toISOString().slice(0,10)} revenue=${f.revenue} netProfit=${f.netProfit} createdAt=${f.createdAt.toISOString().slice(0,10)}`),
    );
    console.log(" QuarterlyResult rows:");
    qr.forEach((q) =>
      console.log(`   ${q.fiscalYear}${q.quarter} ${q.resultType.padEnd(13)} reportDate=${q.reportDate?.toISOString().slice(0,10)} revenue=${q.revenue} netProfit=${q.netProfit} createdAt=${q.createdAt.toISOString().slice(0,10)}`),
    );
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
