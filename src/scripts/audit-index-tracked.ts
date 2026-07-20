// INDEX-PRICES AUDIT, part 2 — READ-ONLY.
//
// THE TEST THAT DECIDES THE PRUNE: "Index Funds" is the LARGEST MF category (1,157 ranked funds),
// and an index fund's benchmark IS the index it tracks. So an index that looks "referenced
// nowhere in code" may still be the one thing 40 real funds are benchmarked against.
//
// For every PRUNE candidate, ask the catalogue: does any mutual fund's NAME name this index?
// If yes, it is NOT unused — it is a Group-3 benchmark we would have deleted blind.
// npx tsx src/scripts/audit-index-tracked.ts
import { prisma } from "../db/prisma.js";

const hdr = (s: string) => console.log(`\n${"═".repeat(78)}\n${s}\n${"═".repeat(78)}`);

// The 104 PRUNE candidates from part 1 (everything not in USED or FUTURE).
const all = await prisma.$queryRawUnsafe<any[]>(
  `SELECT index_name, count(*) pts FROM index_prices GROUP BY 1`,
);
const KEEP = new Set<string>([
  // USED (24)
  "Nifty 50","Nifty Bank","Nifty IT","Nifty Pharma","Sensex","Nifty Auto","Nifty FMCG","Nifty Metal",
  "Nifty Realty","Nifty Capital Goods","Nifty Capital Markets","Nifty Cement","Nifty Chemicals",
  "Nifty Consumer Durables","Nifty Consumer Services","Nifty Insurance",
  "Nifty India Infrastructure & Logistics","Nifty Financial Services Ex-Bank","Nifty India Digital",
  "Nifty Oil & Gas","Nifty Power","Nifty Telecommunications","Nifty 1D Rate Index",
  "Nifty 10 yr Benchmark G-Sec",
  // FUTURE (39)
  "Nifty 100","NIFTY LargeMidcap 250","Nifty Midcap 150","Nifty Smallcap 250","Nifty 500",
  "Nifty500 Multicap 50:25:25","Nifty200 Value 30","Nifty Dividend Opportunities 50","Nifty Next 50",
  "Nifty Total Market","Nifty Composite G-sec Index","Nifty 4-8 yr G-Sec Index","Nifty 8-13 yr G-Sec",
  "Nifty 11-15 yr G-Sec Index","Nifty 15 yr and above G-Sec Index",
  "Nifty 10 yr Benchmark G-Sec (Clean Price)","Nifty 50 Arbitrage","Nifty 50 Futures Index",
  "Nifty Energy","Nifty Infrastructure","Nifty India Consumption","Nifty India Defence",
  "Nifty India Manufacturing","Nifty Healthcare Index","Nifty Financial Services","Nifty PSE",
  "Nifty CPSE","Nifty PSU Bank","Nifty Private Bank","Nifty Commodities","Nifty MNC",
  "Nifty Transportation & Logistics","Nifty Media","Nifty200 Momentum 30","Nifty100 Low Volatility 30",
  "NIFTY100 Quality 30","Nifty Alpha 50","Nifty Midcap150 Momentum 50","India VIX",
]);

const candidates = all.filter((a) => !KEEP.has(a.index_name)).map((a) => ({
  name: a.index_name as string,
  pts: Number(a.pts),
}));

// Every MF scheme name in the catalogue (the funds that could be tracking these).
const funds = await prisma.$queryRawUnsafe<any[]>(`
  SELECT DISTINCT ON (amfi_scheme_code) amfi_scheme_code code, scheme_name, category, is_active
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL`);
console.log(`checking ${candidates.length} prune candidates against ${funds.length} MF scheme names…`);

/** Normalise an index name into the tokens a fund name would carry.
 *  "NIFTY Smallcap 100" → "smallcap 100" ; "Nifty50 Value 20" → "nifty50 value 20" */
function keyOf(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\bnifty\b/g, "nifty").trim();
}
/** A fund NAMES an index if the index's distinguishing token-run appears in the fund's name. */
function tracks(fundName: string, indexName: string): boolean {
  const f = keyOf(fundName);
  const i = keyOf(indexName);
  // Drop the leading "nifty" for matching (fund names say "Nifty Smallcap 250 Index Fund").
  const core = i.replace(/^nifty\s*/, "").trim();
  if (core.length < 4) return false;
  return f.includes(core);
}

interface Hit { name: string; pts: number; funds: number; active: number; examples: string[] }
const hits: Hit[] = [];
const clean: { name: string; pts: number }[] = [];

for (const c of candidates) {
  const matched = funds.filter((f) => f.scheme_name && tracks(f.scheme_name, c.name));
  if (matched.length) {
    hits.push({
      name: c.name,
      pts: c.pts,
      funds: matched.length,
      active: matched.filter((m) => m.is_active).length,
      examples: matched.slice(0, 2).map((m) => String(m.scheme_name).slice(0, 58)),
    });
  } else {
    clean.push({ name: c.name, pts: c.pts });
  }
}

const BPR = 459; // bytes/row measured in part 1

hdr("A. ⚠️  'UNUSED' INDICES THAT REAL FUNDS ACTUALLY TRACK — DO NOT PRUNE");
console.log(`  ${hits.length} of ${candidates.length} candidates are named by a fund in our own catalogue.`);
console.log(`  These are Group-3 benchmarks. A code-usage-only prune would have deleted them.\n`);
for (const h of hits.sort((a, b) => b.funds - a.funds)) {
  console.log(`  ${String(h.funds).padStart(3)} funds (${String(h.active).padStart(3)} active)  ${h.name}`);
  for (const e of h.examples) console.log(`        e.g. ${e}`);
}

hdr("B. GENUINELY UNUSED — no code reference, no fund tracks it, no benchmark role");
const cleanBytes = clean.reduce((s, c) => s + c.pts * BPR, 0);
const cleanRows = clean.reduce((s, c) => s + c.pts, 0);
console.log(`  ${clean.length} indices · ${cleanRows.toLocaleString()} rows · ${(cleanBytes / 1e6).toFixed(1)} MB\n`);
for (const c of clean.sort((a, b) => b.pts - a.pts)) {
  console.log(`  ${String(c.pts).padStart(5)}p  ${((c.pts * BPR) / 1e6).toFixed(2).padStart(5)} MB  ${c.name}`);
}

hdr("C. THE HONEST RECLAIM — after the fund-tracking test");
const total = await prisma.$queryRawUnsafe<any[]>(
  `SELECT count(*) rows, pg_total_relation_size('index_prices') b FROM index_prices`);
const tRows = Number(total[0].rows);
const tBytes = Number(total[0].b);
console.log(`  index_prices today           : ${tRows.toLocaleString()} rows · ${(tBytes / 1e6).toFixed(1)} MB`);
console.log(`  naive prune (code usage only): would drop ${candidates.length} indices / ~36 MB`);
console.log(`  …but ${hits.length} of those are TRACKED BY REAL FUNDS → keeping them.`);
console.log(`\n  TRUE prune set              : ${clean.length} indices · ${cleanRows.toLocaleString()} rows · ${(cleanBytes / 1e6).toFixed(1)} MB`);
console.log(`  index_prices after prune     : ${(tRows - cleanRows).toLocaleString()} rows · ~${((tBytes - cleanBytes) / 1e6).toFixed(1)} MB`);
console.log(`  DB 440 MB → ~${(440 - cleanBytes / 1e6).toFixed(0)} MB`);
console.log(`\n  ⇒ HONEST RECLAIM ≈ ${(cleanBytes / 1e6).toFixed(0)} MB.`);

await prisma.$disconnect();
