// ═══════════════════════════════════════════════════════════════
// STEP 18 — GATE 0b. THE MAP, AND WHAT IT CANNOT REACH.
//
// Gate 0a established two things that reshape this step:
//
//   1. STORAGE IS A NON-ISSUE. All 18 standard benchmarks are ALREADY in index_prices at 5.0y depth
//      (the risk-free days=1825 backfill deepened 94 indices). Nothing needs ingesting. The bloat
//      the prompt feared has ALREADY HAPPENED (167 indices, 51.6MB) and cannot be re-caused by a
//      step that pulls nothing.
//
//   2. THE CATEGORY MAP HAS A HOLE, and it is the biggest part of the universe. The three largest
//      leaves are NOT resolvable from the category:
//          Index Funds          1,706 funds   ← benchmark is the index it TRACKS, named in the fund's name
//          Sectoral/ Thematic   1,449 funds   ← ONE leaf covering banking, pharma, IT, infra, …
//          ETFs                   337         ← same as Index Funds
//      The build prompt assumed "banking→Nifty Bank, pharma→Nifty Pharma". Those are NOT leaf
//      categories. AMFI ships one "Sectoral/ Thematic" leaf. The assumption cannot be implemented.
//
// So this script tests the ONLY thing that can close the hole: a NAME→INDEX matcher. It measures,
// on real scheme names, how many Index Funds / ETFs / Thematic funds resolve to an index we ACTUALLY
// HAVE — and, just as importantly, how many DO NOT (which become honest-null, not a forced guess).
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { normaliseCategory } from "../ingestions/amfi/mf-category.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const rule = (s: string) => console.log("\n" + "═".repeat(94) + "\n" + s + "\n" + "═".repeat(94));

// ── The index inventory, with depth. Only indices that can actually serve a horizon matter. ──
const idx = await q(`
  SELECT index_name, count(*)::int n, (max(date) - min(date))::int span_days
    FROM index_prices GROUP BY 1`);
const INDEX_DEPTH = new Map<string, { n: number; years: number }>(
  idx.map((r: any) => [String(r.index_name), { n: r.n, years: r.span_days / 365.25 }]),
);

// Normalise for matching: uppercase, strip everything but alphanumerics.
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// LONGEST FIRST — this is not a nicety. "NIFTY50" is a SUBSTRING of "NIFTY500": matching short-first
// would tag every Nifty 500 index fund as tracking the Nifty 50, and every one of those betas would
// be wrong in a way that looks perfectly plausible.
const INDEX_BY_LEN = [...INDEX_DEPTH.keys()]
  .map((name) => ({ name, key: norm(name) }))
  .filter((x) => x.key.length >= 6) // "NIFTY50" is the shortest thing worth matching
  .sort((a, b) => b.key.length - a.key.length);

function matchIndexInName(schemeName: string): string | null {
  const k = norm(schemeName);
  for (const { name, key } of INDEX_BY_LEN) if (k.includes(key)) return name;
  return null;
}

// ═══════════════════════════════════════════════════════════════
rule("1 · THE NAME→INDEX MATCHER — can it resolve Index Funds and ETFs?");
// ═══════════════════════════════════════════════════════════════
const funds = await q(`
  SELECT amfi_scheme_code code, scheme_name, category, asset_class::text ac, is_active
    FROM instruments
   WHERE asset_class IN ('mutual_fund','etf') AND amfi_scheme_code IS NOT NULL AND scheme_name IS NOT NULL`);

const groups = new Map<string, { total: number; matched: number; unmatched: string[]; hits: Map<string, number> }>();
for (const f of funds) {
  const leaf = normaliseCategory(f.category) ?? "(no category)";
  const g = /index|etf/i.test(leaf) ? "PASSIVE (Index Funds + ETFs)" : /sector|thematic/i.test(leaf) ? "SECTORAL / THEMATIC" : "everything else";
  if (!groups.has(g)) groups.set(g, { total: 0, matched: 0, unmatched: [], hits: new Map() });
  const e = groups.get(g)!;
  e.total++;
  const hit = matchIndexInName(String(f.scheme_name));
  if (hit) {
    e.matched++;
    e.hits.set(hit, (e.hits.get(hit) ?? 0) + 1);
  } else if (e.unmatched.length < 10) {
    e.unmatched.push(String(f.scheme_name).slice(0, 72));
  }
}

for (const [g, e] of groups) {
  const pct = ((e.matched / e.total) * 100).toFixed(1);
  console.log(`\n── ${g} ──  ${e.matched}/${e.total} matched a REAL index in index_prices (${pct}%)`);
  const top = [...e.hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [name, n] of top) {
    const d = INDEX_DEPTH.get(name)!;
    console.log(`      ${String(n).padStart(5)} → ${name.padEnd(40)} (${d.years.toFixed(1)}y, ${d.n} pts)`);
  }
  if (e.unmatched.length) {
    console.log(`   UNMATCHED examples (→ honest-null, never forced onto a wrong index):`);
    for (const u of e.unmatched.slice(0, 5)) console.log(`      · ${u}`);
  }
}

// ═══════════════════════════════════════════════════════════════
rule("2 · THE CATEGORY→BENCHMARK MAP — for the leaves it CAN resolve");
// ═══════════════════════════════════════════════════════════════
// EQUITY: the AMC-factsheet standard, and every one of these indices is present at 5.0y.
// DEBT: this is where honesty bites. Indian debt funds are benchmarked against CRISIL indices
// (CRISIL Liquid Debt, CRISIL Short Duration Debt, CRISIL Corporate Bond, …). NSE does not publish
// them, they are NOT in index_prices, and they are not obtainable from our source. What NSE DOES
// publish is the G-Sec curve — which is a defensible benchmark for GILT funds (pure sovereign,
// no credit risk) and for the OVERNIGHT/rate end. It is NOT a defensible benchmark for a fund that
// takes CREDIT risk: a Corporate Bond fund's excess return over a G-Sec index is mostly its credit
// spread, and calling that "alpha" would dress up a risk premium as manager skill.
const CATEGORY_MAP: Record<string, string | null> = {
  // ── EQUITY — clean, standard, all present at 5.0y ──
  "Large Cap Fund": "Nifty 100",
  "Large & Mid Cap Fund": "NIFTY LargeMidcap 250",
  "Mid Cap Fund": "Nifty Midcap 150",
  "Small Cap Fund": "Nifty Smallcap 250",
  "Multi Cap Fund": "Nifty500 Multicap 50:25:25",
  "Flexi Cap Fund": "Nifty 500",
  "ELSS": "Nifty 500",
  "Focused Fund": "Nifty 500",
  "Value Fund": "Nifty 500",
  "Contra Fund": "Nifty 500",
  "Dividend Yield Fund": "Nifty Dividend Opportunities 50",
  // ── HYBRID — the equity leg dominates the beta; Nifty 50 is the honest broad proxy ──
  "Aggressive Hybrid Fund": "Nifty 50",
  "Dynamic Asset Allocation or Balanced Advantage": "Nifty 50",
  "Balanced Advantage Fund/ Dynamic Asset Allocation Fund": "Nifty 50",
  "Balanced Hybrid Fund": "Nifty 50",
  "Equity Savings": "Nifty 50",
  "Multi Asset Allocation": "Nifty 50",
  "Arbitrage Fund": "Nifty 50 Arbitrage",
  // ── DEBT — ONLY where the NSE index is a defensible benchmark ──
  "Overnight Fund": "Nifty 1D Rate Index",
  "Gilt Fund": "Nifty Composite G-sec Index",
  "Gilt Fund with 10 year constant duration": "Nifty 10 yr Benchmark G-Sec",
  "Long Duration Fund": "Nifty 15 yr and above G-Sec Index",
  "Medium to Long Duration Fund": "Nifty 8-13 yr G-Sec",
  // ── DEBT — DELIBERATELY UNMAPPED. The real benchmark is a CRISIL CREDIT index we do not have.
  //    Benchmarking these against a G-Sec index would report the CREDIT SPREAD as ALPHA. ──
  "Liquid Fund": null,
  "Money Market Fund": null,
  "Ultra Short Duration Fund": null,
  "Low Duration Fund": null,
  "Short Duration Fund": null,
  "Medium Duration Fund": null,
  "Corporate Bond Fund": null,
  "Credit Risk Fund": null,
  "Banking and PSU Fund": null,
  "Dynamic Bond": null,
  "Floater Fund": null,
  // ── STRUCTURALLY UNBENCHMARKABLE from a category ──
  "Sectoral/ Thematic": null, // one leaf, every sector — resolvable only by NAME
  "Index Funds": null, //        resolvable only by NAME (the index it tracks)
  "FoF Domestic": null, //       a fund of funds' benchmark is its underlying's
  "FoF Overseas": null, //       overseas indices are not in index_prices at all
  "Retirement Fund": null, //    goal-based, bespoke benchmarks
  "Children’s Fund": null, //    same
  "Gold ETF": null, //           benchmarked to the domestic gold PRICE, not an equity index
};

const mapped = Object.entries(CATEGORY_MAP).filter(([, v]) => v !== null);
const unmapped = Object.entries(CATEGORY_MAP).filter(([, v]) => v === null);
const distinct = new Set(mapped.map(([, v]) => v!));
console.log(`   leaves MAPPED to a benchmark : ${mapped.length}`);
console.log(`   leaves DELIBERATELY UNMAPPED : ${unmapped.length}  (honest-null, not a forced guess)`);
console.log(`   ★ DISTINCT benchmark indices required: ${distinct.size}`);
console.log(`\n   every required index, and whether we HAVE it:`);
let missing = 0;
for (const name of [...distinct].sort()) {
  const d = INDEX_DEPTH.get(name);
  if (!d) { missing++; console.log(`     ✗✗ MISSING  ${name}`); }
  else console.log(`     ✓ ${name.padEnd(42)} ${d.years.toFixed(1)}y (${d.n} pts)${d.years < 5 ? "  ⚠ <5y — 5Y beta honest-null" : ""}`);
}
console.log(`\n   ★ MISSING BENCHMARKS: ${missing}  →  ${missing === 0 ? "ZERO INGESTION NEEDED. No bulk pull. No new storage. The storage ruling is moot." : "needs targeted ingestion"}`);

// ═══════════════════════════════════════════════════════════════
rule("3 · TOTAL COVERAGE — category map + name matcher, over the ACTIVE universe");
// ═══════════════════════════════════════════════════════════════
let viaCategory = 0, viaName = 0, honestNull = 0, inactive = 0;
const nullReasons = new Map<string, number>();
for (const f of funds) {
  if (!f.is_active) { inactive++; continue; }
  const leaf = normaliseCategory(f.category) ?? "(no category)";
  const cat = CATEGORY_MAP[leaf];
  if (cat) { viaCategory++; continue; }
  const byName = matchIndexInName(String(f.scheme_name));
  if (byName) { viaName++; continue; }
  honestNull++;
  const reason = leaf in CATEGORY_MAP ? `no_benchmark_for_category: ${leaf}` : `unmapped_category: ${leaf}`;
  nullReasons.set(reason, (nullReasons.get(reason) ?? 0) + 1);
}
const active = viaCategory + viaName + honestNull;
console.log(`   ACTIVE schemes: ${active}   (${inactive} dormant — excluded)\n`);
console.log(`   ✓ benchmark via CATEGORY map : ${String(viaCategory).padStart(5)}  (${((viaCategory / active) * 100).toFixed(1)}%)`);
console.log(`   ✓ benchmark via NAME matcher : ${String(viaName).padStart(5)}  (${((viaName / active) * 100).toFixed(1)}%)   ← the Index Funds / ETFs / some Thematic`);
console.log(`   ─────────────────────────────────────────────`);
console.log(`   ★ TOTAL WITH A BENCHMARK      : ${String(viaCategory + viaName).padStart(5)}  (${(((viaCategory + viaName) / active) * 100).toFixed(1)}%)`);
console.log(`   ○ HONEST-NULL (no benchmark)  : ${String(honestNull).padStart(5)}  (${((honestNull / active) * 100).toFixed(1)}%)`);
console.log(`\n   why the honest-nulls are null (top reasons):`);
for (const [r, n] of [...nullReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`     ${String(n).padStart(5)}  ${r}`);
}

// ═══════════════════════════════════════════════════════════════
rule("4 · THE FOLD — is beta/alpha/TE really foldable, with no new raw storage?");
// ═══════════════════════════════════════════════════════════════
console.log(`
   beta  = cov(rF, rB) / var(rB)
   alpha = fundRet − (rf + beta × (benchRet − rf))          ← reuses the EXISTING risk-free leg
   TE    = stdev(rF − rB), annualised

   All three are functions of RUNNING SUMS over paired daily returns:
       n, Σ rF, Σ rB, Σ rF², Σ rB², Σ rF·rB,  and for TE: Σ(rF−rB), Σ(rF−rB)²
   → O(1) per NAV observation, O(schemes) memory. Exactly the shape vol/Sharpe already are.

   THE ALIGNMENT SUBTLETY, and it is the one thing that could make this wrong:
   a fund's NAV does NOT print every day the benchmark does. Its log return spans (prevDay → day),
   which may be 1 day or 5. The benchmark's return MUST be measured over THE SAME SPAN — not its
   single-day return, or the covariance pairs a 3-day fund move against a 1-day index move and the
   beta is quietly garbage.
   → so: benchRet = log(bClose(day) / bClose(prevDay)), via a last-close-on-or-before lookup.
     If either endpoint is absent from the benchmark series, the pair is SKIPPED and counted —
     never folded with a stale or interpolated close.

   MEMORY: the benchmark series are tiny. ${distinct.size} indices × ~1,232 points × 16B ≈ ${((distinct.size * 1232 * 16) / 1024).toFixed(0)}KB, held
   for the run and DISCARDED. Same as the risk-free series already is. Compute-and-discard HOLDS —
   no raw series is persisted, and index_prices is READ, never written.`);

await prisma.$disconnect();
console.log("\n═══ GATE 0b COMPLETE — nothing was written. ═══");
