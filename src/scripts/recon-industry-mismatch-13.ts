// Recon: the 13 stocks flagged industryType=non_financial while filing
// financial-format XBRL. Ground-truth from result_fetch_logs (recorded at
// actual fetch time — the detected taxonomy from the real filed XBRL, not
// inference) plus current Stock.industryType/sector.

import { prisma } from "../db/prisma.js";

const SYMBOLS = [
  "360ONE",
  "ANGELONE",
  "BAJAJHLDNG",
  "CANHLIFE",
  "ABSLAMC",
  "GODIGIT",
  "ICICIAMC",
  "JMFINANCIL",
  "NAM-INDIA",
  "NIVABUPA",
  "NUVAMA",
  "TATAINVEST",
  "UTIAMC",
];

async function main() {
  for (const symbol of SYMBOLS) {
    const stock = await prisma.stock.findUnique({
      where: { symbol },
      select: {
        id: true,
        symbol: true,
        industryType: true,
        sector: { select: { name: true } },
      },
    });
    if (!stock) {
      console.log(`\n=== ${symbol} — NOT FOUND ===`);
      continue;
    }

    const logs = await prisma.resultFetchLog.findMany({
      where: { stockId: stock.id, error: { contains: "Industry mismatch" } },
      select: {
        quarter: true,
        fiscalYear: true,
        resultType: true,
        status: true,
        error: true,
        fetchedAt: true,
        xbrlUrl: true,
      },
      orderBy: { fetchedAt: "desc" },
    });

    console.log(`\n=== ${symbol} ===`);
    console.log(
      `  stock.industryType=${stock.industryType}  sector=${stock.sector?.name ?? "(none)"}`,
    );
    console.log(`  mismatch log rows: ${logs.length}`);
    const seen = new Set<string>();
    for (const l of logs) {
      const key = `${l.error}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`   - [${l.fiscalYear} ${l.quarter} ${l.resultType}] ${l.error}`);
    }
    if (logs[0]) {
      console.log(`   sample xbrlUrl: ${logs[0].xbrlUrl ?? "(none)"}`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
