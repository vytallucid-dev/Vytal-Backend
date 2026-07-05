// READ-ONLY: derive the NSE-Industry -> our-sector map EMPIRICALLY from the 219
// Nifty500 stocks already in our DB (architect-assigned sectors). Prints, for each
// NSE Industry label, how the already-mapped overlap stocks distribute across our
// sectors. A label that lands on exactly ONE sector = clean auto-map; a label that
// splits = ambiguous -> gate.
// npx tsx src/scripts/recon-industry-sector-crosstab.ts <path-to-nifty500.csv>
import { prisma } from "../db/prisma.js";
import fs from "fs";

async function main() {
  const csvPath = process.argv[2];
  const csv = fs.readFileSync(csvPath, "utf8").trim().split(/\r?\n/).slice(1);
  const rows = csv.map((line) => {
    const parts = line.split(",");
    const isin = parts[parts.length - 1].trim();
    const series = parts[parts.length - 2].trim();
    const symbol = parts[parts.length - 3].trim();
    const industry = parts[parts.length - 4].trim();
    const name = parts.slice(0, parts.length - 4).join(",").trim();
    return { name, industry, symbol, series, isin };
  });
  const industryBySymbol = new Map(rows.map((r) => [r.symbol, r.industry]));

  const dbStocks = await prisma.stock.findMany({
    select: { symbol: true, sector: { select: { name: true } } },
  });
  const sectorBySymbol = new Map(dbStocks.map((s) => [s.symbol, s.sector?.name ?? "(NULL)"]));

  // Cross-tab: only symbols present in BOTH the CSV and the DB (the 219 overlap).
  const crosstab = new Map<string, Map<string, number>>();
  for (const [symbol, industry] of industryBySymbol) {
    if (!sectorBySymbol.has(symbol)) continue;
    const sec = sectorBySymbol.get(symbol)!;
    if (!crosstab.has(industry)) crosstab.set(industry, new Map());
    const m = crosstab.get(industry)!;
    m.set(sec, (m.get(sec) ?? 0) + 1);
  }

  const industries = [...crosstab.keys()].sort();
  console.log("=== NSE Industry -> our sector, empirical (overlap stocks only) ===\n");
  const cleanMap: Record<string, string> = {};
  const ambiguous: string[] = [];
  for (const ind of industries) {
    const m = crosstab.get(ind)!;
    const entries = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, e) => s + e[1], 0);
    const distinct = entries.length;
    const label = distinct === 1 ? "CLEAN" : "AMBIGUOUS";
    if (distinct === 1) cleanMap[ind] = entries[0][0];
    else ambiguous.push(ind);
    console.log(`  [${label}] "${ind}"  (n=${total})`);
    for (const [sec, n] of entries) console.log(`             ${String(n).padStart(3)}  ${sec}`);
  }

  console.log("\n=== DERIVED CLEAN MAP (NSE Industry -> our sector) ===");
  console.log(JSON.stringify(cleanMap, null, 2));
  console.log("\n=== AMBIGUOUS NSE Industries (must gate) ===");
  console.log(JSON.stringify(ambiguous, null, 2));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
