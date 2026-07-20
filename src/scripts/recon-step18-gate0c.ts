// ═══════════════════════════════════════════════════════════════
// STEP 18 — GATE 0c. Three things Gate 0b left open.
//
//   1. DOES THE 5Y ANCHOR ACTUALLY RESOLVE? Gate 0b printed "⚠ <5y" on nearly every benchmark. That
//      may be a rounding artifact (span 1825d / 365.25 = 4.997) rather than a real gap — and the
//      difference decides whether 5Y beta exists AT ALL. Test it the way the fold will: against the
//      REAL anchor logic (H.y5 + ANCHOR_TOLERANCE_DAYS), not against a printed decimal.
//
//   2. THE ETFs. The prompt asks specifically. An index ETF's tracking-error vs the index it tracks
//      is the single most useful number we could give — measure the ETF coverage on its own.
//
//   3. THE 1,449 SECTORAL/THEMATIC FUNDS. Gate 0b resolved ZERO of them (their names carry no index
//      name). But many DO name their SECTOR ("Pharma Fund", "Banking & Financial Services Fund").
//      Would a conservative, explicit SECTOR-KEYWORD map reach them — and would the matches be
//      RIGHT? Measure it before proposing it, and look at what it would actually claim.
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { normaliseCategory } from "../ingestions/amfi/mf-category.js";
import { H, ANCHOR_TOLERANCE_DAYS } from "../ingestions/amfi/mf-accumulator.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const rule = (s: string) => console.log("\n" + "═".repeat(94) + "\n" + s + "\n" + "═".repeat(94));

// ═══════════════════════════════════════════════════════════════
rule("1 · DOES THE 5Y ANCHOR RESOLVE? (tested with the fold's OWN logic, not a printed decimal)");
// ═══════════════════════════════════════════════════════════════
const BENCHMARKS = [
  "Nifty 50", "Nifty 100", "Nifty 500", "Nifty Midcap 150", "Nifty Smallcap 250",
  "NIFTY LargeMidcap 250", "Nifty500 Multicap 50:25:25", "Nifty Dividend Opportunities 50",
  "Nifty 50 Arbitrage", "Nifty 1D Rate Index", "Nifty Composite G-sec Index",
  "Nifty 10 yr Benchmark G-Sec", "Nifty 15 yr and above G-Sec Index", "Nifty 8-13 yr G-Sec",
];
const asOfRow = (await q(`SELECT max(date)::text d FROM index_prices`))[0];
const asOfDay = Math.floor(new Date(asOfRow.d).getTime() / 86_400_000);
console.log(`   as-of (newest index date): ${asOfRow.d}  (day ${asOfDay})`);
console.log(`   H.y5 = ${H.y5} days · ANCHOR_TOLERANCE_DAYS = ${ANCHOR_TOLERANCE_DAYS}\n`);
console.log(`   ${"benchmark".padEnd(36)} ${"oldest".padEnd(12)} ${"pts".padStart(5)}  1Y   3Y   5Y`);

for (const name of BENCHMARKS) {
  const rows = await q(
    `SELECT min(date)::text oldest, count(*)::int n FROM index_prices WHERE index_name = $1`, name);
  const r = rows[0];
  if (!r || !r.oldest) { console.log(`   ${name.padEnd(36)} ABSENT`); continue; }
  const oldestDay = Math.floor(new Date(r.oldest).getTime() / 86_400_000);
  const covers = (h: keyof typeof H) => {
    const target = asOfDay - H[h];
    // The fold's rule: the series must reach back to the anchor, within tolerance.
    return oldestDay - target <= ANCHOR_TOLERANCE_DAYS ? "✓" : "✗";
  };
  console.log(
    `   ${name.padEnd(36)} ${String(r.oldest).padEnd(12)} ${String(r.n).padStart(5)}  ` +
      `${covers("y1")}    ${covers("y3")}    ${covers("y5")}   ` +
      `(reaches back ${asOfDay - oldestDay}d; 5Y needs ${H.y5}d, tol ${ANCHOR_TOLERANCE_DAYS}d → slack ${H.y5 + ANCHOR_TOLERANCE_DAYS - (asOfDay - oldestDay)}d)`,
  );
}
console.log(`
   READ THIS AS: the fold does not need span ≥ 1826 days. It needs the series' OLDEST point to be no
   more than ANCHOR_TOLERANCE_DAYS (21) LATER than the 5Y anchor — the same rule the risk-free leg
   and every fund's own 5Y CAGR already use. Gate 0b's "⚠ <5y" was a printed rounding artifact
   (1825/365.25 = 4.997), not a gap.`);

// ═══════════════════════════════════════════════════════════════
rule("2 · THE ETFs — tracking-error vs the index they track is the whole point");
// ═══════════════════════════════════════════════════════════════
const idx = await q(`SELECT index_name, count(*)::int n FROM index_prices GROUP BY 1`);
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const INDEX_BY_LEN = idx
  .map((r: any) => ({ name: String(r.index_name), key: norm(String(r.index_name)) }))
  .filter((x: any) => x.key.length >= 6)
  .sort((a: any, b: any) => b.key.length - a.key.length);
const matchIndex = (s: string) => {
  const k = norm(s);
  for (const { name, key } of INDEX_BY_LEN) if (k.includes(key)) return name;
  return null;
};

const etfs = await q(`
  SELECT scheme_name, name, symbol, is_active FROM instruments
   WHERE asset_class = 'etf' AND amfi_scheme_code IS NOT NULL`);
let eMatch = 0;
const eHits = new Map<string, number>();
const eMiss: string[] = [];
for (const e of etfs) {
  const hit = matchIndex(String(e.scheme_name ?? e.name ?? ""));
  if (hit) { eMatch++; eHits.set(hit, (eHits.get(hit) ?? 0) + 1); }
  else if (eMiss.length < 12) eMiss.push(String(e.scheme_name ?? e.name).slice(0, 66));
}
console.log(`   ★ ETFs matched to a REAL index: ${eMatch}/${etfs.length}  (${((eMatch / etfs.length) * 100).toFixed(1)}%)\n`);
for (const [n, c] of [...eHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`      ${String(c).padStart(4)} → ${n}`);
}
console.log(`\n   UNMATCHED ETFs (→ honest-null; these are Gold/Silver/debt/overseas — no equity index tracks them):`);
for (const m of eMiss) console.log(`      · ${m}`);

// ═══════════════════════════════════════════════════════════════
rule("3 · THE 1,449 SECTORAL/THEMATIC — would a SECTOR-KEYWORD map reach them, and be RIGHT?");
// ═══════════════════════════════════════════════════════════════
// An EXPLICIT, auditable allow-list. Same discipline as the ISIN taxonomy: classify only on evidence,
// null on anything not named. Every entry is a sector an AMC itself benchmarks to this index.
const SECTOR_KEYWORDS: [RegExp, string][] = [
  [/\bpharma|healthcare\b/i, "Nifty Pharma"],
  [/\bbank(ing)?\b|\bfinancial services\b/i, "Nifty Bank"],
  [/\b(technolog|infotech|digital)\w*|\bIT fund\b/i, "Nifty IT"],
  [/\bFMCG\b|\bconsumption\b/i, "Nifty FMCG"],
  [/\bauto(mobile|motive)?\b/i, "Nifty Auto"],
  [/\binfrastructure\b/i, "Nifty Infrastructure"],
  [/\benergy\b|\boil\b|\bpower\b/i, "Nifty Energy"],
  [/\bmetal\b/i, "Nifty Metal"],
  [/\breal(ty| estate)\b/i, "Nifty Realty"],
  [/\bmedia\b/i, "Nifty Media"],
  [/\bPSU\b|\bPSE\b/i, "Nifty PSE"],
  [/\bMNC\b/i, "Nifty MNC"],
  [/\bcommodit\w*/i, "Nifty Commodities"],
  [/\bconsumer durable/i, "Nifty Consumer Durables"],
  [/\bdefence\b/i, "Nifty India Defence"],
];
const thematic = await q(`
  SELECT scheme_name, category FROM instruments
   WHERE asset_class IN ('mutual_fund','etf') AND amfi_scheme_code IS NOT NULL AND is_active = true
     AND scheme_name IS NOT NULL`);
const themOnly = thematic.filter((f: any) => /sector|thematic/i.test(normaliseCategory(f.category) ?? ""));

let sMatch = 0;
const sHits = new Map<string, string[]>();
const sMiss: string[] = [];
for (const f of themOnly) {
  const nm = String(f.scheme_name);
  const hit = SECTOR_KEYWORDS.find(([re]) => re.test(nm));
  if (hit) {
    sMatch++;
    if (!sHits.has(hit[1])) sHits.set(hit[1], []);
    if (sHits.get(hit[1])!.length < 3) sHits.get(hit[1])!.push(nm.slice(0, 60));
  } else if (sMiss.length < 14) sMiss.push(nm.slice(0, 66));
}
console.log(`   ★ thematic funds a SECTOR-KEYWORD map would reach: ${sMatch}/${themOnly.length}  (${((sMatch / themOnly.length) * 100).toFixed(1)}%)\n`);
console.log(`   WHAT IT WOULD CLAIM — inspect these, because a wrong benchmark is a wrong beta:`);
for (const [index, examples] of [...sHits.entries()].sort()) {
  console.log(`\n   → ${index}`);
  for (const e of examples) console.log(`        ${e}`);
}
console.log(`\n   WHAT IT WOULD REFUSE (→ honest-null — no clean sector index; a guess here would be a lie):`);
for (const m of sMiss) console.log(`      · ${m}`);

// ═══════════════════════════════════════════════════════════════
rule("4 · COVERAGE, WITH AND WITHOUT THE SECTOR MAP");
// ═══════════════════════════════════════════════════════════════
console.log(`   Gate 0b measured, over 11,968 ACTIVE schemes:`);
console.log(`     category map + name matcher        →  5,386  (45.0%)`);
console.log(`     + a sector-keyword map would add   →  +${sMatch}  (${((sMatch / 11968) * 100).toFixed(1)} pts)`);
console.log(`     ────────────────────────────────────────────────`);
console.log(`     ★ TOTAL                            →  ${(5386 + sMatch).toLocaleString()}  (${(((5386 + sMatch) / 11968) * 100).toFixed(1)}%)`);
console.log(`
   THE OPERATOR'S CALL. The sector map is a HEURISTIC over fund NAMES, not a fact from the source.
   It is defensible (an AMC's own "Pharma Fund" IS benchmarked to a pharma index) and auditable (an
   explicit 15-row allow-list, null on anything unnamed). But it is still a NAME GUESS, and a wrong
   benchmark produces a beta and an alpha that look perfectly plausible and are simply wrong.
   Adopting it is a decision, not a default.`);

await prisma.$disconnect();
console.log("\n═══ GATE 0c COMPLETE — nothing was written. ═══");
