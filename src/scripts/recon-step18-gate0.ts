// ═══════════════════════════════════════════════════════════════
// STEP 18 — GATE 0a. GROUND FIRST. What ARE the leaf categories, and what IS in index_prices?
//
// Before proposing a category→benchmark map, measure the two things the map must join:
//   A. the ACTUAL leaf categories the fold produces (Step 10's normaliseCategory), with fund counts
//   B. the ACTUAL index inventory in index_prices — every name, its depth, its span
//
// The build prompt assumes "banking→Nifty Bank, pharma→Nifty Pharma". That is only possible if
// "Banking Fund" and "Pharma Fund" ARE leaf categories. If AMFI ships ONE leaf called
// "Sectoral/Thematic Fund" covering all of them, a category→benchmark map CANNOT resolve them and
// the assumption collapses. Measure, do not assume.
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { normaliseCategory, isOpenEnded, isCloseEndedOrInterval } from "../ingestions/amfi/mf-category.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const rule = (s: string) => console.log("\n" + "═".repeat(94) + "\n" + s + "\n" + "═".repeat(94));

// ═══════════════════════════════════════════════════════════════
rule("A · THE LEAF CATEGORIES — what the fold ACTUALLY produces (not what we assume)");
// ═══════════════════════════════════════════════════════════════
const rows = await q(`
  SELECT category, plan_type, asset_class::text ac, is_active, count(*)::int n
    FROM instruments
   WHERE asset_class IN ('mutual_fund','etf') AND amfi_scheme_code IS NOT NULL
   GROUP BY 1,2,3,4`);

const leafAgg = new Map<string, { funds: number; etfs: number; active: number; open: number }>();
for (const r of rows) {
  const leaf = normaliseCategory(r.category) ?? "(no category)";
  if (!leafAgg.has(leaf)) leafAgg.set(leaf, { funds: 0, etfs: 0, active: 0, open: 0 });
  const e = leafAgg.get(leaf)!;
  if (r.ac === "etf") e.etfs += r.n;
  else e.funds += r.n;
  if (r.is_active) e.active += r.n;
  if (isOpenEnded(r.category)) e.open += r.n;
}

const leaves = [...leafAgg.entries()].sort((a, b) => b[1].funds + b[1].etfs - (a[1].funds + a[1].etfs));
console.log(`${leaves.length} DISTINCT LEAF CATEGORIES across the AMFI universe:\n`);
console.log(`   ${"leaf".padEnd(46)} ${"MF".padStart(6)} ${"ETF".padStart(5)} ${"active".padStart(7)} ${"open".padStart(6)}`);
for (const [leaf, e] of leaves) {
  console.log(`   ${leaf.slice(0, 45).padEnd(46)} ${String(e.funds).padStart(6)} ${String(e.etfs).padStart(5)} ${String(e.active).padStart(7)} ${String(e.open).padStart(6)}`);
}

console.log(`\n★ THE QUESTION THAT DECIDES THE MAP: is there a leaf called "Banking Fund" / "Pharma Fund",`);
console.log(`  or ONE leaf called "Sectoral/Thematic Fund" that covers every sector at once?`);
const sectoral = leaves.filter(([l]) => /sector|thematic/i.test(l));
for (const [l, e] of sectoral) console.log(`     → "${l}"  ${e.funds} MF + ${e.etfs} ETF`);
const namedSector = leaves.filter(([l]) => /bank|pharma|tech|infra|fmcg|auto|energy/i.test(l));
console.log(`  leaves naming a SPECIFIC sector: ${namedSector.length === 0 ? "NONE" : namedSector.map(([l]) => l).join(", ")}`);

// ═══════════════════════════════════════════════════════════════
rule("B · THE INDEX INVENTORY — every index in index_prices, its depth and its span");
// ═══════════════════════════════════════════════════════════════
const idx = await q(`
  SELECT index_name, count(*)::int n,
         min(date)::text first, max(date)::text last,
         (max(date) - min(date))::int span_days
    FROM index_prices GROUP BY 1 ORDER BY 2 DESC, 1`);
console.log(`${idx.length} DISTINCT INDICES in index_prices.\n`);
const deep = idx.filter((r: any) => r.span_days > 1600);
const mid = idx.filter((r: any) => r.span_days > 300 && r.span_days <= 1600);
const shallow = idx.filter((r: any) => r.span_days <= 300);
console.log(`   DEPTH SPLIT:  ≥5y-ish (>1600d): ${deep.length}   ·   1y-3y (300-1600d): ${mid.length}   ·   <1y (≤300d): ${shallow.length}`);

console.log(`\n   ── the DEEP ones (these can serve 5Y beta) ──`);
for (const r of deep.slice(0, 40)) {
  console.log(`   ${String(r.index_name).slice(0, 48).padEnd(50)} ${String(r.n).padStart(5)} pts  ${r.first} → ${r.last}  (${(r.span_days / 365.25).toFixed(1)}y)`);
}
if (deep.length > 40) console.log(`   … ${deep.length - 40} more`);

console.log(`\n   ── SHALLOW (<1y): cannot serve even a 1Y beta ──`);
for (const r of shallow.slice(0, 12)) {
  console.log(`   ${String(r.index_name).slice(0, 48).padEnd(50)} ${String(r.n).padStart(5)} pts  (${(r.span_days / 365.25).toFixed(1)}y)`);
}
if (shallow.length > 12) console.log(`   … ${shallow.length - 12} more`);

const tot = (await q(`SELECT count(*)::int n, pg_total_relation_size('index_prices') b FROM index_prices`))[0];
console.log(`\n   index_prices: ${tot.n.toLocaleString()} rows · ${(Number(tot.b) / 1_048_576).toFixed(1)}MB`);
console.log(`   → bytes/row: ${(Number(tot.b) / tot.n).toFixed(0)}B  (the number that sizes any new benchmark)`);

// ═══════════════════════════════════════════════════════════════
rule("C · DO THE STANDARD BENCHMARKS EXIST? (name-match against the inventory)");
// ═══════════════════════════════════════════════════════════════
// The benchmarks an Indian AMC factsheet actually uses, by category family. Checked by NAME against
// what is really in the table — no assumption that a "Nifty Midcap 150" row exists just because it
// ought to.
const WANTED = [
  ["Large Cap", "Nifty 100"],
  ["Large & Mid Cap", "Nifty LargeMidcap 250"],
  ["Mid Cap", "Nifty Midcap 150"],
  ["Small Cap", "Nifty Smallcap 250"],
  ["Multi Cap", "Nifty500 Multicap 50:25:25"],
  ["Flexi Cap / ELSS / Focused / Value / Contra", "Nifty 500"],
  ["Broad market (fallback)", "Nifty 50"],
  ["Arbitrage", "Nifty 50 Arbitrage"],
  ["Debt — overnight", "Nifty 1D Rate Index"],
  ["Debt — gilt / long", "Nifty 10 yr Benchmark G-Sec"],
  ["Dividend Yield", "Nifty Dividend Opportunities 50"],
  ["Sector — Bank", "Nifty Bank"],
  ["Sector — IT", "Nifty IT"],
  ["Sector — Pharma", "Nifty Pharma"],
  ["Sector — FMCG", "Nifty FMCG"],
  ["Sector — Auto", "Nifty Auto"],
  ["Sector — Infra", "Nifty Infrastructure"],
  ["Sector — Energy", "Nifty Energy"],
];
const names = idx.map((r: any) => String(r.index_name));
const byName = new Map(idx.map((r: any) => [String(r.index_name).toLowerCase(), r]));

console.log(`   ${"category family".padEnd(44)} ${"benchmark".padEnd(34)} present?  depth`);
for (const [fam, bm] of WANTED) {
  const hit = byName.get(bm.toLowerCase());
  const fuzzy = hit ? null : names.find((n) => n.toLowerCase().replace(/\s+/g, "") === bm.toLowerCase().replace(/\s+/g, ""));
  const row = hit ?? (fuzzy ? byName.get(fuzzy.toLowerCase()) : null);
  const status = row ? `✓` : `✗ MISSING`;
  const depth = row ? `${(row.span_days / 365.25).toFixed(1)}y (${row.n} pts)` : "—";
  console.log(`   ${fam.padEnd(44)} ${bm.padEnd(34)} ${status.padEnd(9)} ${depth}`);
}

console.log(`\n   ── any index whose name LOOKS like a debt/CRISIL benchmark? ──`);
const debtish = names.filter((n) => /crisil|debt|bond|gilt|g-sec|liquid|money|duration|rate/i.test(n));
console.log(`   ${debtish.length === 0 ? "NONE" : debtish.join("\n   ")}`);

// ═══════════════════════════════════════════════════════════════
rule("D · BASELINES");
// ═══════════════════════════════════════════════════════════════
const fp = (await q(`
  SELECT count(*)::int n,
         md5(string_agg(scheme_code || '|' || coalesce(ret_1y::text,'~') || '|' || coalesce(vol_1y::text,'~') || '|' ||
             coalesce(sharpe_1y::text,'~') || '|' || coalesce(rank_1y::text,'~'), ',' ORDER BY scheme_code)) fp
    FROM mf_analytics`))[0];
console.log(`   mf_analytics: ${fp.n} rows · md5 ${fp.fp}`);
const db = (await q(`SELECT pg_size_pretty(pg_database_size(current_database())) s`))[0];
console.log(`   DB: ${db.s}`);

await prisma.$disconnect();
console.log("\n═══ GATE 0a COMPLETE — nothing was written. ═══");
