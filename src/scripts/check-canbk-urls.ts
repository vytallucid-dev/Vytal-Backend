import { prisma } from "../db/prisma.js";
import { fetchXbrlXml } from "../ingestions/shareholdings/shareholding-fetch.js";
import { parseXbrlShareholding } from "../ingestions/shareholdings/xbrl-parser.js";

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{
    as_on_date: Date;
    source_date: Date;
    fii_pct: number | null;
    xbrl_url: string | null;
  }>>(
    `SELECT as_on_date, source_date, fii_pct, xbrl_url
     FROM shareholding_patterns
     WHERE symbol = 'CANBK'
     ORDER BY as_on_date DESC
     LIMIT 6`,
  );

  console.log("CANBK rows with URLs:");
  for (const r of rows) {
    console.log(`  ${r.as_on_date.toISOString().slice(0,10)}  fii=${r.fii_pct}  src=${r.source_date.toISOString().slice(0,10)}`);
    console.log(`    url=${r.xbrl_url}`);
  }

  // Parse the null-fii row directly
  const nullRow = rows.find(r => r.fii_pct === null && r.xbrl_url);
  if (!nullRow?.xbrl_url) { console.log("\nNo null-fii row with URL found"); process.exit(0); }

  console.log(`\nParsing null-fii row: ${nullRow.as_on_date.toISOString().slice(0,10)}`);
  console.log(`URL: ${nullRow.xbrl_url}`);
  const xml = await fetchXbrlXml(nullRow.xbrl_url);
  const result = parseXbrlShareholding(xml);
  console.log(`\nParser output:`);
  console.log(`  promoterPct=${result.promoterPct}  publicPct=${result.publicPct}`);
  console.log(`  fiiPct=${result.fiiPct}  diiPct=${result.diiPct}`);
  console.log(`  mutualFundPct=${result.mutualFundPct}  insurancePct=${result.insurancePct}`);

  await prisma.$disconnect();
}
main().catch(console.error);
