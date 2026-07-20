// ═══════════════════════════════════════════════════════════════
// INDEX-PRICES DROP-SET RECONCILE (READ-ONLY, deletes nothing).
// The audit's PRUNE set tested the fold's NAME route against mutual funds ONLY.
// The live fold now catalogues ETFs too, and an ETF's scheme name resolves against
// the WHOLE index_prices table (buildNameMatcher). So this runs the REAL, exported
// resolveBenchmark/buildNameMatcher over the mutual_fund + etf universe and unions
// the result with the static map + UI reader literals — producing the authoritative
// keep-list, and thus the genuinely-unused drop set. No guess about a name.
//
//   npx tsx src/scripts/retention-index-reconcile.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { buildNameMatcher, resolveBenchmark } from "../ingestions/amfi/mf-benchmark.js";

// STATIC keep-list — every index_name literal referenced in code (from the trace),
// so an empty-fund-category benchmark is still kept. The DYNAMIC name-route reads
// are added from the live fold below.
const STATIC_KEEP = new Set<string>([
  // mf-benchmark CATEGORY_BENCHMARK (14)
  "Nifty 100", "NIFTY LargeMidcap 250", "Nifty Midcap 150", "Nifty Smallcap 250", "Nifty500 Multicap 50:25:25",
  "Nifty 500", "Nifty Dividend Opportunities 50", "Nifty 50", "Nifty 50 Arbitrage", "Nifty 1D Rate Index",
  "Nifty Composite G-sec Index", "Nifty 10 yr Benchmark G-Sec", "Nifty 15 yr and above G-Sec Index", "Nifty 8-13 yr G-Sec",
  // mf-benchmark SECTOR_ALLOWLIST (15)
  "Nifty Consumer Durables", "Nifty India Consumption", "Nifty Pharma", "Nifty Financial Services", "Nifty IT",
  "Nifty Auto", "Nifty Infrastructure", "Nifty Energy", "Nifty Metal", "Nifty Realty", "Nifty Media",
  "Nifty India Defence", "Nifty PSE", "Nifty MNC", "Nifty Commodities",
  // price-view.service SECTOR_INDEX_MAP + BENCHMARK (21)
  "Nifty Bank", "Nifty Capital Goods", "Nifty Capital Markets", "Nifty Cement", "Nifty Chemicals",
  "Nifty Consumer Services", "Nifty FMCG", "Nifty Insurance", "Nifty India Infrastructure & Logistics",
  "Nifty Financial Services Ex-Bank", "Nifty India Digital", "Nifty Oil & Gas", "Nifty Power", "Nifty Telecommunications",
  // dashboard CORE_INDICES (adds Sensex) + portfolio (Nifty 50 already present)
  "Sensex",
]);

async function main() {
  const all = (await prisma.$queryRawUnsafe(
    `SELECT index_name, count(*)::int n FROM index_prices GROUP BY 1 ORDER BY 1`,
  )) as { index_name: string; n: number }[];
  const rowsOf = new Map(all.map((x) => [x.index_name, x.n]));
  const names = all.map((x) => x.index_name);
  const totalRows = all.reduce((s, x) => s + x.n, 0);

  // Build the matcher from EVERY index name — exactly as the fold does (mf-analytics.ts:268).
  const matchName = buildNameMatcher(names);

  // Run the REAL resolver over the mutual_fund + etf universe (the live fold's worklist).
  const insts = await prisma.instrument.findMany({
    where: { assetClass: { in: ["mutual_fund", "etf"] } },
    select: { category: true, schemeName: true, assetClass: true },
  });
  const foldReads = new Set<string>();
  const viaName = new Set<string>();
  const rescuedByEtfName = new Set<string>(); // name-route reads from an ETF (the audit's blind spot)
  let mf = 0, etf = 0;
  for (const it of insts) {
    if (it.assetClass === "etf") etf++; else mf++;
    const r = resolveBenchmark(it.category ?? null, it.schemeName ?? null, matchName);
    if (r.index) {
      foldReads.add(r.index);
      if (r.via === "name") {
        viaName.add(r.index);
        if (it.assetClass === "etf" && !STATIC_KEEP.has(r.index)) rescuedByEtfName.add(r.index);
      }
    }
  }

  const keep = new Set<string>([...STATIC_KEEP, ...foldReads]);
  const drop = names.filter((n) => !keep.has(n)).sort();
  const bytesPerRow = 52 * 1e6 / totalRows; // index_prices ≈ 52 MB
  const dropRows = drop.reduce((s, n) => s + (rowsOf.get(n) ?? 0), 0);

  console.log(`\n═══ index_prices DROP-SET RECONCILE (read-only) ═══`);
  console.log(`Universe scanned by the live fold: ${mf} mutual funds + ${etf} ETFs = ${insts.length}`);
  console.log(`Distinct index_names: ${names.length} · total rows: ${totalRows.toLocaleString()} (~52 MB)\n`);
  console.log(`KEEP: ${keep.size}  (static-map ${STATIC_KEEP.size} ∪ live-fold reads ${foldReads.size}; of which via NAME route ${viaName.size})`);
  console.log(`DROP (genuinely unused — read by NO live path): ${drop.length} indices · ${dropRows.toLocaleString()} rows · ~${(dropRows * bytesPerRow / 1e6).toFixed(1)} MB\n`);

  console.log(`── ⚠️ RESCUED — read via the NAME route by an ETF (a naive MF-only audit would have DROPPED these) ──`);
  if (rescuedByEtfName.size === 0) console.log("  (none — no ETF name resolves to an otherwise-unkept index)");
  else [...rescuedByEtfName].sort().forEach((n) => console.log(`  ${String(rowsOf.get(n)).padStart(5)}p  ${n}`));

  console.log(`\n── PROPOSED DROP SET (${drop.length} indices) ──`);
  for (const n of drop) console.log(`  ${String(rowsOf.get(n)).padStart(5)}p  ${n}`);

  console.log(`\nReclaim if dropped: ~${(dropRows * bytesPerRow / 1e6).toFixed(1)} MB (of ${totalRows.toLocaleString()} rows, ${((dropRows / totalRows) * 100).toFixed(0)}%).`);
  console.log(`(Naive MF-only audit proposed 105 indices / 78,895 rows — this reconciled set is the safe subset.)\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
