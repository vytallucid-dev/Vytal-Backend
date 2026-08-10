import { prisma } from "../db/prisma.js";

async function main() {
  const stock = await prisma.stock.findUnique({
    where: { symbol: "HDFCAMC" },
    select: { id: true, symbol: true, industryType: true, sector: { select: { name: true } } },
  });
  console.log("Stock:", stock);
  if (!stock) return;

  const logs = await prisma.resultFetchLog.findMany({
    where: { stockId: stock.id },
    select: { quarter: true, fiscalYear: true, resultType: true, status: true, error: true, fetchedAt: true },
    orderBy: { fetchedAt: "desc" },
    take: 20,
  });
  console.log(`\nRecent result_fetch_logs (${logs.length}):`);
  for (const l of logs) {
    console.log(`  [${l.fetchedAt.toISOString().slice(0,10)}] ${l.fiscalYear} ${l.quarter} ${l.resultType} status=${l.status} error=${l.error ?? ""}`);
  }

  const fund = await prisma.fundamental.findMany({ where: { stockId: stock.id }, select: { fiscalYear: true, resultType: true, reportDate: true, createdAt: true } });
  const qr = await prisma.quarterlyResult.findMany({ where: { stockId: stock.id }, select: { fiscalYear: true, quarter: true, resultType: true, reportDate: true, createdAt: true } });
  console.log(`\nFundamental (non-financial) rows: ${fund.length}`);
  fund.forEach(f => console.log(`  ${f.fiscalYear} ${f.resultType} reportDate=${f.reportDate?.toISOString().slice(0,10)}`));
  console.log(`QuarterlyResult (non-financial) rows: ${qr.length}`);
  qr.forEach(q => console.log(`  ${q.fiscalYear}${q.quarter} ${q.resultType} reportDate=${q.reportDate?.toISOString().slice(0,10)}`));

  const nbfcF = await prisma.nbfcFundamental.count({ where: { stockId: stock.id } });
  const nbfcQ = await prisma.nbfcQuarterlyResult.count({ where: { stockId: stock.id } });
  console.log(`\nnbfcFundamental rows: ${nbfcF}, nbfcQuarterlyResult rows: ${nbfcQ}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
