// INDEX-PRICES AUDIT — READ-ONLY. Nothing is deleted. Nothing is written.
// npx tsx src/scripts/audit-index-prices.ts
//
// index_prices reached 63 MB / 144 K rows / ~160 indices after the 5-year risk-free backfill.
// This classifies every index as KEEP-USED / KEEP-FUTURE / PRUNE-UNUSED, from the CODE, not
// from a guess — and sizes what a prune would honestly reclaim.
import { prisma } from "../db/prisma.js";

const hdr = (s: string) => console.log(`\n${"═".repeat(78)}\n${s}\n${"═".repeat(78)}`);

// ─────────────────────────────────────────────────────────────
// THE USED SET — every index the codebase actually reads. Grep-derived, with the site.
//
// CRITICAL CORRECTION TO THE BRIEF: the SCORING ENGINE DOES NOT READ index_prices AT ALL.
// The Market pillar (src/scoring/market/*) reads prisma.peerGroup + prisma.dailyPrice — nothing
// else. There are exactly FIVE readers of index_prices in the whole backend, and none of them is
// a scoring path. So deleting an index CANNOT break a Health Score. The "non-negotiable, silently
// breaks scoring" premise does not hold. What it CAN break is display surfaces.
// ─────────────────────────────────────────────────────────────

const USED: Record<string, string[]> = {
  // controllers/ingestion/indices-controllers.ts:18-26 — CORE_INDICES, the dashboard market strip
  // (frontend: components/dashboard/market-pulse.tsx)
  "Nifty 50": ["dashboard strip", "portfolio benchmark (ALLOWED_INDICES)", "price-view BENCHMARK_INDEX"],
  "Nifty Bank": ["dashboard strip", "price-view sector map (banks)"],
  "Nifty IT": ["dashboard strip", "price-view sector map (it_technology)"],
  "Nifty Pharma": ["dashboard strip", "price-view sector map (pharma_healthcare)"],
  Sensex: ["dashboard strip"],
  "Nifty Auto": ["dashboard strip", "price-view sector map (automobile)"],
  "Nifty FMCG": ["dashboard strip", "price-view sector map (fmcg_consumer)"],
  "Nifty Metal": ["dashboard strip", "price-view sector map (metals_mining)"],
  "Nifty Realty": ["dashboard strip", "price-view sector map (real_estate)"],

  // scoring/read/price-view.service.ts:33-52 — SECTOR_INDEX_MAP (stock Overview tab)
  "Nifty Capital Goods": ["price-view sector map (capital_goods_engineering)"],
  "Nifty Capital Markets": ["price-view sector map (capital_markets)"],
  "Nifty Cement": ["price-view sector map (cement_construction)"],
  "Nifty Chemicals": ["price-view sector map (chemicals_agrochemicals)"],
  "Nifty Consumer Durables": ["price-view sector map (consumer_discretionary_retail)"],
  "Nifty Consumer Services": ["price-view sector map (hospitality_travel)"],
  "Nifty Insurance": ["price-view sector map (insurance)"],
  "Nifty India Infrastructure & Logistics": ["price-view sector map (logistics_infrastructure)"],
  "Nifty Financial Services Ex-Bank": ["price-view sector map (nbfc)"],
  "Nifty India Digital": ["price-view sector map (new_economy_internet)"],
  "Nifty Oil & Gas": ["price-view sector map (oil_gas_energy)"],
  "Nifty Power": ["price-view sector map (power)"],
  "Nifty Telecommunications": ["price-view sector map (telecom)"],

  // ingestions/amfi/risk-free.ts:30 — RF_INDICES (MF Sharpe/Sortino, just proven live)
  "Nifty 1D Rate Index": ["MF Sharpe/Sortino risk-free leg (PRIMARY)"],
  "Nifty 10 yr Benchmark G-Sec": ["MF Sharpe/Sortino risk-free leg (FALLBACK)"],
};

// ─────────────────────────────────────────────────────────────
// THE FUTURE SET — Group-3 fund analytics (beta / alpha) needs a benchmark PER FUND CATEGORY.
// mf_analytics currently ranks 40 leaf categories. Each needs a benchmark series to regress
// against. These indices are referenced NOWHERE today and would look "unused" to a naive prune —
// which is exactly the trap this audit exists to avoid.
// ─────────────────────────────────────────────────────────────

const FUTURE: Record<string, string> = {
  // ── Equity size buckets ──
  "Nifty 100": "Large Cap Fund (140 funds) — the standard large-cap benchmark",
  "NIFTY LargeMidcap 250": "Large & Mid Cap Fund (133)",
  "Nifty Midcap 150": "Mid Cap Fund (119)",
  "Nifty Smallcap 250": "Small Cap Fund (130)",
  "Nifty 500": "Flexi Cap (172), ELSS (175), Focused (103), Retirement (87), Children's (36)",
  "Nifty500 Multicap 50:25:25": "Multi Cap Fund (113) — SEBI's mandated multicap composition",
  "Nifty200 Value 30": "Value Fund (87), Contra Fund (16)",
  "Nifty Dividend Opportunities 50": "Dividend Yield Fund (37)",
  "Nifty Next 50": "Index Funds (1,157) — many track Next 50",
  "Nifty Total Market": "Index Funds / broad passive trackers",

  // ── Fixed income (the debt categories are 14 of the 40 leaves) ──
  "Nifty Composite G-sec Index": "Gilt Fund (115), Dynamic Bond (144)",
  "Nifty 4-8 yr G-Sec Index": "Medium Duration (88), Short Duration (150)",
  "Nifty 8-13 yr G-Sec": "Medium to Long Duration (84)",
  "Nifty 11-15 yr G-Sec Index": "Long Duration Fund (52)",
  "Nifty 15 yr and above G-Sec Index": "Long Duration Fund (52)",
  "Nifty 10 yr Benchmark G-Sec (Clean Price)": "Gilt Fund with 10y constant duration (34)",

  // ── Hybrid / arbitrage ──
  "Nifty 50 Arbitrage": "Arbitrage Fund (173) — the only honest arbitrage benchmark",
  "Nifty 50 Futures Index": "Arbitrage / Equity Savings (118)",

  // ── Sectoral / thematic funds (898 funds!) regress against sector indices ──
  // Most are ALREADY in the USED set via SECTOR_INDEX_MAP. These are the extra ones a
  // Sectoral/Thematic fund benchmark map would plausibly need.
  "Nifty Energy": "Sectoral/Thematic — energy funds",
  "Nifty Infrastructure": "Sectoral/Thematic — infra funds",
  "Nifty India Consumption": "Sectoral/Thematic — consumption funds",
  "Nifty India Defence": "Sectoral/Thematic — defence funds",
  "Nifty India Manufacturing": "Sectoral/Thematic — manufacturing funds",
  "Nifty Healthcare Index": "Sectoral/Thematic — healthcare funds",
  "Nifty Financial Services": "Sectoral/Thematic — financial services funds",
  "Nifty PSE": "Sectoral/Thematic — PSU funds",
  "Nifty CPSE": "Sectoral/Thematic — CPSE funds",
  "Nifty PSU Bank": "Sectoral/Thematic — PSU bank funds",
  "Nifty Private Bank": "Sectoral/Thematic — private bank funds",
  "Nifty Commodities": "Sectoral/Thematic — commodity funds",
  "Nifty MNC": "Sectoral/Thematic — MNC funds",
  "Nifty Transportation & Logistics": "Sectoral/Thematic — transport funds",
  "Nifty Media": "Sectoral/Thematic — media funds",

  // ── Smart-beta / factor (a growing slice of Index Funds, 1,157) ──
  "Nifty200 Momentum 30": "Index Funds — momentum factor trackers",
  "Nifty100 Low Volatility 30": "Index Funds — low-vol factor trackers",
  "NIFTY100 Quality 30": "Index Funds — quality factor trackers",
  "Nifty Alpha 50": "Index Funds — alpha factor trackers",
  "Nifty Midcap150 Momentum 50": "Index Funds — midcap momentum trackers",

  // ── Volatility (context, not a benchmark, but cheap and referenced by convention) ──
  "India VIX": "market-regime context for fund risk narratives",
};

// ─────────────────────────────────────────────────────────────
hdr("1. WHAT EXISTS — every index in index_prices");

const all = await prisma.$queryRawUnsafe<any[]>(`
  SELECT index_name, count(*) pts, min(date) mn, max(date) mx,
         count(*) * 100.0 / (SELECT count(*) FROM index_prices) AS pct
  FROM index_prices GROUP BY 1 ORDER BY 2 DESC`);

const total = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) rows, pg_total_relation_size('index_prices') b,
         pg_size_pretty(pg_total_relation_size('index_prices')) s FROM index_prices`);
const totalRows = Number(total[0].rows);
const totalBytes = Number(total[0].b);
const bytesPerRow = totalBytes / totalRows;

console.log(`  ${all.length} distinct indices · ${totalRows.toLocaleString()} rows · ${total[0].s}`);
console.log(`  ≈ ${Math.round(bytesPerRow)} bytes/row (heap + index)`);

// Classify.
type Cls = "KEEP-USED" | "KEEP-FUTURE" | "PRUNE-UNUSED";
interface Row { name: string; pts: number; mn: string; mx: string; cls: Cls; why: string; bytes: number }
const rows: Row[] = all.map((a) => {
  const name = a.index_name as string;
  const pts = Number(a.pts);
  const bytes = Math.round(pts * bytesPerRow);
  if (USED[name]) return { name, pts, mn: String(a.mn).slice(4, 15), mx: String(a.mx).slice(4, 15), cls: "KEEP-USED", why: USED[name]!.join(" · "), bytes };
  if (FUTURE[name]) return { name, pts, mn: String(a.mn).slice(4, 15), mx: String(a.mx).slice(4, 15), cls: "KEEP-FUTURE", why: FUTURE[name]!, bytes };
  return { name, pts, mn: String(a.mn).slice(4, 15), mx: String(a.mx).slice(4, 15), cls: "PRUNE-UNUSED", why: "referenced nowhere; no known benchmark role", bytes };
});

const used = rows.filter((r) => r.cls === "KEEP-USED");
const future = rows.filter((r) => r.cls === "KEEP-FUTURE");
const prune = rows.filter((r) => r.cls === "PRUNE-UNUSED");

// Any code-referenced index MISSING from the feed? (a silent 404 on a stock page)
const missing = [...Object.keys(USED), ...Object.keys(FUTURE)].filter(
  (n) => !all.some((a) => a.index_name === n),
);

hdr("2. KEEP-USED — referenced in code TODAY (deleting these breaks a live surface)");
console.log(`  ${used.length} indices · ${used.reduce((s, r) => s + r.pts, 0).toLocaleString()} rows · ${(used.reduce((s, r) => s + r.bytes, 0) / 1e6).toFixed(1)} MB\n`);
for (const r of used.sort((a, b) => b.pts - a.pts)) {
  console.log(`  ${String(r.pts).padStart(5)}p ${String((r.bytes / 1e6).toFixed(2) + "MB").padStart(8)}  ${r.name.padEnd(40)} ${r.why}`);
}

hdr("3. KEEP-FUTURE — Group-3 fund benchmarks (unused TODAY, needed NEXT)");
console.log(`  ${future.length} indices · ${future.reduce((s, r) => s + r.pts, 0).toLocaleString()} rows · ${(future.reduce((s, r) => s + r.bytes, 0) / 1e6).toFixed(1)} MB\n`);
for (const r of future.sort((a, b) => b.pts - a.pts)) {
  console.log(`  ${String(r.pts).padStart(5)}p ${String((r.bytes / 1e6).toFixed(2) + "MB").padStart(8)}  ${r.name.padEnd(42)} ${r.why.slice(0, 52)}`);
}

hdr("4. PRUNE-UNUSED — referenced nowhere, no known benchmark role");
console.log(`  ${prune.length} indices · ${prune.reduce((s, r) => s + r.pts, 0).toLocaleString()} rows · ${(prune.reduce((s, r) => s + r.bytes, 0) / 1e6).toFixed(1)} MB\n`);
for (const r of prune.sort((a, b) => b.pts - a.pts)) {
  console.log(`  ${String(r.pts).padStart(5)}p ${String((r.bytes / 1e6).toFixed(2) + "MB").padStart(8)}  ${r.name}`);
}

hdr("5. THE HONEST RECLAIM NUMBER");
const pruneBytes = prune.reduce((s, r) => s + r.bytes, 0);
const pruneRows = prune.reduce((s, r) => s + r.pts, 0);
console.log(`  index_prices today          : ${totalRows.toLocaleString()} rows · ${(totalBytes / 1e6).toFixed(1)} MB`);
console.log(`  prune candidates            : ${pruneRows.toLocaleString()} rows · ${(pruneBytes / 1e6).toFixed(1)} MB  (${((pruneRows / totalRows) * 100).toFixed(0)}% of rows)`);
console.log(`  index_prices after a prune  : ${(totalRows - pruneRows).toLocaleString()} rows · ~${((totalBytes - pruneBytes) / 1e6).toFixed(1)} MB`);
console.log(`\n  DB today                    : 440 MB`);
console.log(`  DB after a prune (+VACUUM)  : ~${(440 - pruneBytes / 1e6).toFixed(0)} MB`);
console.log(`  ⇒ RECLAIM ≈ ${(pruneBytes / 1e6).toFixed(0)} MB — NOT the 44 MB the backfill added.`);
console.log(`    Most of what the backfill imported is either used TODAY or needed for Group 3.`);

if (missing.length) {
  hdr("6. ⚠️  CODE REFERENCES AN INDEX THAT IS NOT IN THE FEED");
  for (const m of missing) console.log(`  ❌ "${m}" — referenced in code/plan but ABSENT from index_prices`);
  console.log(`\n  (For USED entries this is a live bug: the surface silently renders nothing.)`);
}

await prisma.$disconnect();
