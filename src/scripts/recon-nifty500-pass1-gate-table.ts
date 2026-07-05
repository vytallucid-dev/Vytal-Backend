// READ-ONLY: build the Stage-1a GATE TABLE — every new stock whose NSE Industry
// did NOT cleanly auto-map (sectorId still NULL). Grouped by NSE Industry, each
// annotated with the EMPIRICAL modal sector (suggestion only, NOT applied) + the
// confidence (share of overlap stocks on that mode) + full distribution for the
// genuinely-split buckets. Emits a JSON template the architect annotates → Stage 1c.
//   npx tsx src/scripts/recon-nifty500-pass1-gate-table.ts <csv-path> <out-json>
import { prisma } from "../db/prisma.js";
import fs from "fs";

const CLEAN = new Set([
  "Automobile and Auto Components", "Construction Materials", "Consumer Durables",
  "Fast Moving Consumer Goods", "Healthcare", "Information Technology",
  "Metals & Mining", "Power", "Realty", "Telecommunication",
]);

async function main() {
  const csvPath = process.argv[2];
  const outJson = process.argv[3];
  const lines = fs.readFileSync(csvPath, "utf8").trim().split(/\r?\n/).slice(1);
  const rows = lines.map((l) => {
    const p = l.split(",");
    return { isin: p[p.length - 1].trim(), series: p[p.length - 2].trim(), symbol: p[p.length - 3].trim(),
             industry: p[p.length - 4].trim(), name: p.slice(0, p.length - 4).join(",").trim() };
  });

  // Empirical crosstab (overlap stocks) → modal sector + distribution per industry.
  const dbStocks = await prisma.stock.findMany({ select: { symbol: true, sector: { select: { name: true } } } });
  const sectorBySymbol = new Map(dbStocks.map((s) => [s.symbol, s.sector?.name ?? null]));
  const csvBySymbol = new Map(rows.map((r) => [r.symbol, r]));
  const crosstab = new Map<string, Map<string, number>>();
  for (const [symbol, r] of csvBySymbol) {
    const sec = sectorBySymbol.get(symbol);
    if (!sec) continue; // only overlap stocks that already have a sector
    if (!crosstab.has(r.industry)) crosstab.set(r.industry, new Map());
    const m = crosstab.get(r.industry)!;
    m.set(sec, (m.get(sec) ?? 0) + 1);
  }
  const distFor = (ind: string) => {
    const m = crosstab.get(ind);
    if (!m) return { mode: null as string | null, confidencePct: null as number | null, dist: {} as Record<string, number> };
    const entries = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, e) => s + e[1], 0);
    return { mode: entries[0][0], confidencePct: Math.round((entries[0][1] / total) * 100), dist: Object.fromEntries(entries) };
  };

  // Gated new stocks = in DB, null sector, and NSE industry not in CLEAN.
  const gatedDb = await prisma.stock.findMany({
    where: { symbol: { in: rows.map((r) => r.symbol) }, sectorId: null },
    select: { symbol: true, stockPrices: { select: { marketCap: true } } },
  });
  const mcapBySymbol = new Map(gatedDb.map((s) => [s.symbol, s.stockPrices[0]?.marketCap ?? null]));
  const gatedSymbols = new Set(gatedDb.map((s) => s.symbol));

  const byIndustry = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!gatedSymbols.has(r.symbol)) continue;
    if (CLEAN.has(r.industry)) continue; // safety: clean ones shouldn't be null anyway
    if (!byIndustry.has(r.industry)) byIndustry.set(r.industry, []);
    byIndustry.get(r.industry)!.push(r);
  }

  const industries = [...byIndustry.keys()].sort((a, b) => byIndustry.get(b)!.length - byIndustry.get(a)!.length);
  let grandTotal = 0;
  const template: any[] = [];
  console.log("╔═══════════════════════════════════════════════════════════════════════════╗");
  console.log("║  STAGE 1a GATE — new stocks with UNMAPPED sector (sectorId = NULL)          ║");
  console.log("║  'suggested' = empirical modal sector from YOUR existing mappings (overlap) ║");
  console.log("║  NOT applied. Architect confirms/overrides per stock → Stage 1c.           ║");
  console.log("╚═══════════════════════════════════════════════════════════════════════════╝");

  for (const ind of industries) {
    const stocks = byIndustry.get(ind)!.sort((a, b) => a.symbol.localeCompare(b.symbol));
    grandTotal += stocks.length;
    const d = distFor(ind);
    const conf = d.mode ? `${d.mode} (${d.confidencePct}% of overlap)` : "(NO existing sample — needs a fresh decision)";
    const split = Object.keys(d.dist).length > 1 ? `  split: ${JSON.stringify(d.dist)}` : "";
    console.log(`\n── NSE Industry: "${ind}"  ·  ${stocks.length} stocks ──`);
    console.log(`   suggested sector: ${conf}${split}`);
    for (const s of stocks) {
      const mc = mcapBySymbol.get(s.symbol);
      const mcStr = mc != null ? `₹${Math.round(Number(mc)).toLocaleString("en-IN")} Cr` : "n/a (price backfill = Pass 3)";
      console.log(`     ${s.symbol.padEnd(13)} ${s.name.slice(0, 44).padEnd(45)} mcap=${mcStr}`);
      template.push({ symbol: s.symbol, name: s.name, nseIndustry: ind, suggestedSector: d.mode, confidencePct: d.confidencePct, assignSector: d.mode /* architect edits this */ });
    }
  }

  console.log(`\n=== TOTAL gated (need sector): ${grandTotal} ===`);
  console.log(`Buckets: ${industries.map((i) => `${i}=${byIndustry.get(i)!.length}`).join(", ")}`);
  if (outJson) { fs.writeFileSync(outJson, JSON.stringify(template, null, 2)); console.log(`\nAnnotatable template written: ${outJson}`); console.log(`(edit each row's "assignSector"; Stage 1c reads this file and applies.)`); }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
