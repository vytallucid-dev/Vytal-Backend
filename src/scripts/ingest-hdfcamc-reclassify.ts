// Re-run ingestion (scanSymbol — live NSE XBRL, financials only) for HDFCAMC, whose
// industryType was corrected non_financial → nbfc 2026-08-10 (14th case, caught by
// findIndustryTaxonomyDisagreements — see industry-type-utils.ts SYMBOL_OVERRIDES).
// Mirrors ingest-industry-mismatch-13.ts's treatment of the original 13.
//
//   npx tsx src/scripts/ingest-hdfcamc-reclassify.ts

import { prisma } from "../db/prisma.js";
import { scanSymbol } from "../ingestions/quaterly-results/scan.js";
import { nseClient } from "../lib/client.js";

async function main() {
  nseClient.resetSession();
  const stock = await prisma.stock.findUnique({ where: { symbol: "HDFCAMC" }, select: { industryType: true } });
  console.log(`scanSymbol(HDFCAMC)  industryType=${stock?.industryType}`);
  const r = await scanSymbol("HDFCAMC");
  console.log(`  filings=${r.totalFilings} groups=${r.totalGroups} ingested=${r.ingested} refreshed=${r.refreshed} skipped=${r.skipped} failed=${r.failed}`);
  if (r.errors.length) r.errors.forEach((e) => console.log(`    err ${e.qeDate}/${e.filingType}: ${e.error.slice(0, 200)}`));

  const [nbfcF, nbfcQ] = await Promise.all([
    prisma.nbfcFundamental.count({ where: { stock: { symbol: "HDFCAMC" } } }),
    prisma.nbfcQuarterlyResult.count({ where: { stock: { symbol: "HDFCAMC" } } }),
  ]);
  console.log(`\nnbfcFundamental rows now: ${nbfcF}, nbfcQuarterlyResult rows now: ${nbfcQ}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
