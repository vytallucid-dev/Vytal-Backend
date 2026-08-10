// Re-run ingestion (scanSymbol — live NSE XBRL, financials only) for the 13
// stocks whose industryType was corrected 2026-08-10. Each was previously
// blocked at the taxonomy gate in scan.ts (Industry mismatch: stock was
// non_financial, filed XBRL was nbfc/life_insurance/general_insurance).
//
//   npx tsx src/scripts/ingest-industry-mismatch-13.ts

import { prisma } from "../db/prisma.js";
import { scanSymbol } from "../ingestions/quaterly-results/scan.js";
import { nseClient } from "../lib/client.js";

const SYMBOLS = [
  "360ONE", "ANGELONE", "BAJAJHLDNG", "CANHLIFE", "ABSLAMC", "GODIGIT",
  "ICICIAMC", "JMFINANCIL", "NAM-INDIA", "NIVABUPA", "NUVAMA", "TATAINVEST",
  "UTIAMC",
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  nseClient.resetSession();
  const results: { symbol: string; industryType: string; ingested: number; refreshed: number; skipped: number; failed: number; errors: string[] }[] = [];

  for (let i = 0; i < SYMBOLS.length; i++) {
    const symbol = SYMBOLS[i];
    const stock = await prisma.stock.findUnique({ where: { symbol }, select: { industryType: true } });
    console.log(`\n[${i + 1}/${SYMBOLS.length}] scanSymbol(${symbol})  industryType=${stock?.industryType}`);
    try {
      const r = await scanSymbol(symbol);
      console.log(`   filings=${r.totalFilings} groups=${r.totalGroups} ingested=${r.ingested} refreshed=${r.refreshed} skipped=${r.skipped} failed=${r.failed}`);
      if (r.errors.length) r.errors.forEach((e) => console.log(`     err ${e.qeDate}/${e.filingType}: ${e.error.slice(0, 160)}`));
      results.push({
        symbol,
        industryType: stock?.industryType ?? "?",
        ingested: r.ingested,
        refreshed: r.refreshed,
        skipped: r.skipped,
        failed: r.failed,
        errors: r.errors.map((e) => e.error),
      });
    } catch (err) {
      console.error(`   THREW: ${String(err)}`);
      results.push({ symbol, industryType: stock?.industryType ?? "?", ingested: 0, refreshed: 0, skipped: 0, failed: 1, errors: [String(err)] });
    }
    if (i < SYMBOLS.length - 1) await sleep(1500);
  }

  console.log("\n" + "=".repeat(90));
  console.log("SUMMARY");
  console.log("=".repeat(90));
  for (const r of results) {
    console.log(`  ${r.symbol.padEnd(12)} ${r.industryType.padEnd(18)} ingested=${r.ingested} refreshed=${r.refreshed} skipped=${r.skipped} failed=${r.failed}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
