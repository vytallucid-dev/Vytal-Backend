// ═══════════════════════════════════════════════════════════════
// T1b — DOES EVERY COMPANY FILE BOTH BASES? READ-ONLY.
// Hits the SAME legacy discovery endpoint the backfill uses
// (discovery-legacy.ts fetchFilingsList, period="Annual"), enumerates the
// listing per stock per year, and reports standalone / consolidated / both /
// neither. Fetches NOTHING else — no XBRL documents, no writes.
//   npx tsx src/scripts/_t1-nse.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchFilingsList, pickBestFilingForQuarter, groupFilingsByQuarter } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";

// Five stocks, five different peer groups. COLPAL is the CONTROL: it holds
// sa6/co0 in our DB, i.e. the legacy path kept its standalone rows — the
// hypothesis says that is because it files no consolidated at all.
const SAMPLE = [
  { symbol: "SIEMENS", pg: "Large-Cap Capital Goods & Industrial", held: "sa2/co7" },
  { symbol: "TCS", pg: "Large-Cap IT Services", held: "sa2/co6" },
  { symbol: "SUNPHARMA", pg: "Large-Cap Pharma", held: "sa3/co5" },
  { symbol: "DLF", pg: "Large-Cap Real Estate", held: "sa2/co6" },
  { symbol: "COLPAL", pg: "Large-Cap FMCG (control)", held: "sa6/co0" },
];
const SPACING_MS = 3000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lpad = (s: unknown, n: number) => String(s).padStart(n);

interface YearRow { year: string; sa: number; co: number; picked: string | null; pickedBasis: string | null }

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T1b — NSE ANNUAL LISTING, per stock per year (live, read-only)             ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  endpoint: /api/corporates-financial-results?period=Annual  (the backfill's own)`);
  console.log(`  ${SAMPLE.length} symbols · ${SPACING_MS}ms spacing · listing only, zero XBRL fetches\n`);

  const totals = { both: 0, saOnly: 0, coOnly: 0, neither: 0, periods: 0 };
  const perStock: { symbol: string; rows: YearRow[]; err?: string }[] = [];

  for (const [i, s] of SAMPLE.entries()) {
    if (i > 0) await sleep(SPACING_MS);
    let filings: any[];
    try {
      filings = await fetchFilingsList(s.symbol, "Annual");
    } catch (e) {
      console.log(`  ${pad(s.symbol, 12)} ✗ discovery failed: ${(e as Error).message}`);
      perStock.push({ symbol: s.symbol, rows: [], err: (e as Error).message });
      continue;
    }

    // Group exactly as the backfill does, then ask what it WOULD have picked.
    const byPeriod = groupFilingsByQuarter(filings);
    const rows: YearRow[] = [];
    for (const [key, group] of byPeriod) {
      const [from, to] = key.split("|");
      const sa = group.filter((f) => f.consolidated !== "Consolidated").length;
      const co = group.filter((f) => f.consolidated === "Consolidated").length;
      const best = pickBestFilingForQuarter(group, from, to);
      rows.push({
        year: to,
        sa, co,
        picked: best ? `${best.consolidated ?? "null"}` : null,
        pickedBasis: best ? (best.consolidated === "Consolidated" ? "consolidated" : "standalone") : null,
      });
    }
    rows.sort((a, b) => a.year.localeCompare(b.year));
    perStock.push({ symbol: s.symbol, rows });

    console.log(`  ── ${s.symbol}  (${s.pg})  DB holds ${s.held}  ·  ${filings.length} annual filings, ${byPeriod.size} periods`);
    console.log(`     ${pad("period end", 14)}${lpad("SA", 4)}${lpad("CO", 4)}  shape        legacy picker takes  → standalone LOST?`);
    for (const r of rows) {
      const shape = r.sa > 0 && r.co > 0 ? "both" : r.sa > 0 ? "standalone" : r.co > 0 ? "consolidated" : "neither";
      totals.periods++;
      if (shape === "both") totals.both++;
      else if (shape === "standalone") totals.saOnly++;
      else if (shape === "consolidated") totals.coOnly++;
      else totals.neither++;
      const lost = r.sa > 0 && r.pickedBasis === "consolidated";
      console.log(`     ${pad(r.year, 14)}${lpad(r.sa, 4)}${lpad(r.co, 4)}  ${pad(shape, 13)}${pad(r.pickedBasis ?? "-", 21)}${lost ? "★ YES — " + r.sa + " standalone discarded" : "no"}`);
    }
    const lostCount = rows.filter((r) => r.sa > 0 && r.pickedBasis === "consolidated").length;
    console.log(`     → ${lostCount} of ${rows.length} periods lose their standalone filing to the consolidated preference\n`);
  }

  console.log(`╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ SAMPLE TOTALS — ⚠ 5 STOCKS IS A SMALL SAMPLE                              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  stock-year periods enumerated: ${totals.periods}`);
  console.log(`    both bases filed:      ${lpad(totals.both, 4)}  (${((totals.both / totals.periods) * 100).toFixed(1)}%)`);
  console.log(`    standalone only:       ${lpad(totals.saOnly, 4)}  (${((totals.saOnly / totals.periods) * 100).toFixed(1)}%)  ← normal and correct; nothing to take`);
  console.log(`    consolidated only:     ${lpad(totals.coOnly, 4)}  (${((totals.coOnly / totals.periods) * 100).toFixed(1)}%)  ← no standalone exists to recover`);
  console.log(`    neither:               ${lpad(totals.neither, 4)}`);
  const recoverable = totals.both;
  console.log(`  → periods where a standalone filing EXISTS but the legacy picker discards it: ${recoverable}`);

  // DB cross-check: what the same stocks currently hold.
  console.log(`\n  DB cross-check (fundamentals rows held today):`);
  for (const s of SAMPLE) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT f."fiscal_year", f."result_type", f."source" FROM fundamentals f
         JOIN stocks st ON st."id" = f."stock_id" WHERE st."symbol" = $1
        ORDER BY f."fiscal_year", f."result_type"`, s.symbol) as { fiscal_year: string; result_type: string; source: string }[];
    const sa = rows.filter((r) => r.result_type === "standalone").map((r) => r.fiscal_year);
    const co = rows.filter((r) => r.result_type === "consolidated").map((r) => r.fiscal_year);
    console.log(`    ${pad(s.symbol, 12)} standalone: [${sa.join(",") || "—"}]   consolidated: [${co.join(",") || "—"}]`);
  }

  console.log(`\n  (READ-ONLY: listing fetches + SELECTs only. No XBRL fetched, nothing written.)\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
