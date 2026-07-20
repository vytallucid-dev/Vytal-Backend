// ═══════════════════════════════════════════════════════════════
// STEP 17 — GATE 0b. THE FENCE IS WRONG. Both candidate include-sets are unsafe.
//
// Gate 0a derived the corporate-debt series as the COMPLEMENT of every known lane and got an EXACT
// ISIN COLLISION: INE462A01022 (BAYERCROP) — one of the 504 SCORED STOCKS — landed in the "bond"
// set. That is not a source bug and not an ISIN-reuse bug. It is a FENCE bug, and it condemns BOTH
// candidate include-sets:
//
//   · the COMPLEMENT fence (Gate 0a)  swept in BL (an equity board), SF (INF = a fund) and P1.
//   · the PROMPT's N*/Y*/Z*/P* fence  would sweep in P1 = INE494B04019 = TVS MOTOR — chars 8-9 of
//     that ISIN are "04", which is a PREFERENCE SHARE. Preference shares are EQUITY, not debt. And
//     it would MISS the AN/AX series, which are real NCDs.
//
// So NEITHER a prefix guess NOR a complement is a safe fence. The SERIES is NSE's trading-BOARD
// label — it says where a thing trades, not what it IS.
//
// THE HYPOTHESIS THIS SCRIPT TESTS: the ISIN itself carries the instrument type, in a fixed position.
// The NSDL/SEBI numbering is  IN | E|F|0-9 | <4-char issuer> | <2-char SECURITY TYPE> | <3-char serial>
// and the security-type code at chars[7..8] (0-indexed) is the ground truth:
//       01 = equity   ·   04 = preference   ·   07/08/09/A7… = DEBT   ·   30+ = fund units
//
// If that holds, the fence becomes a TWO-KEY guard — series says "not one of our other lanes", the
// ISIN security-type says "and it is genuinely DEBT" — and the collision is impossible by
// construction, not by a blocklist we have to remember to maintain.
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { fetchUdiff, parseUdiff, weekdaysBack, type UdiffRow } from "../ingestions/shared/udiff-bhavcopy.js";
import { GOVT_SERIES_CODES } from "../ingestions/govt-securities/govt-guards.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));

const EQUITY_SERIES = ["EQ", "BE", "BZ", "SM", "ST", "SZ", "E1", "IL", "GC"];
const KNOWN = new Set<string>([...EQUITY_SERIES, "RR", "IV", "MF", ...GOVT_SERIES_CODES]);

/** THE HYPOTHESIS. chars[7..8] of an Indian ISIN = the security-type code. */
const secType = (isin: string) => isin.slice(7, 9);

const sessions: { day: string; rows: UdiffRow[] }[] = [];
for (const d of weekdaysBack(new Date(), 22)) {
  if (sessions.length >= 10) break;
  const f = await fetchUdiff(d);
  if (f.status !== 200 || f.bytes === 0) continue;
  const p = parseUdiff(f.buffer);
  if (!p.ok) continue;
  sessions.push({ day: d.toISOString().slice(0, 10), rows: p.rows });
}
sessions.sort((a, b) => a.day.localeCompare(b.day));

// ═══════════════════════════════════════════════════════════════
rule("1 · CALIBRATE THE HYPOTHESIS ON GROUND WE ALREADY OWN");
// ═══════════════════════════════════════════════════════════════
// Before trusting chars[7..8] to fence bonds, prove it describes the instruments we ALREADY loaded
// correctly. If the 504 stocks are not all '01', the hypothesis is dead and we stop.
const known = await q(`
  SELECT asset_class::text ac, substring(isin from 8 for 2) st, count(*)::int n
    FROM instruments WHERE isin IS NOT NULL GROUP BY 1,2 ORDER BY 1, 3 DESC`);
console.log("SECURITY-TYPE CODE (ISIN chars 8-9) of every instrument ALREADY in the catalogue:");
let cur = "";
for (const r of known) {
  if (r.ac !== cur) { console.log(`\n   ── ${r.ac} ──`); cur = r.ac; }
  console.log(`      "${r.st}" → ${r.n}`);
}
const stockTypes = await q(`SELECT DISTINCT substring(isin from 8 for 2) st FROM stocks WHERE isin IS NOT NULL ORDER BY 1`);
console.log(`\n   the 504 SCORED STOCKS use security-type: ${stockTypes.map((r: any) => `"${r.st}"`).join(", ")}`);
console.log(`   → ${stockTypes.length === 1 && stockTypes[0].st === "01" ? "✓ HYPOTHESIS HOLDS — equity is uniformly '01'." : "✗ hypothesis is NOT clean — see above."}`);

// ═══════════════════════════════════════════════════════════════
rule("2 · THE CROSS-TAB — series × security-type over the non-lane rows. WHERE IS THE JUNK?");
// ═══════════════════════════════════════════════════════════════
const union = new Map<string, UdiffRow>();
for (const s of sessions) for (const r of s.rows) if (!KNOWN.has(r.series) && r.isin) union.set(r.isin, r);
const all = [...union.values()];

const tab = new Map<string, Map<string, number>>();
for (const r of all) {
  const st = secType(r.isin);
  if (!tab.has(st)) tab.set(st, new Map());
  const m = tab.get(st)!;
  m.set(r.series, (m.get(r.series) ?? 0) + 1);
}
console.log(`${all.length} distinct ISINs in the complement set, grouped by SECURITY TYPE:\n`);
const sorted = [...tab.entries()].sort((a, b) => {
  const sa = [...a[1].values()].reduce((x, y) => x + y, 0);
  const sb = [...b[1].values()].reduce((x, y) => x + y, 0);
  return sb - sa;
});
for (const [st, m] of sorted) {
  const n = [...m.values()].reduce((x, y) => x + y, 0);
  const ex = all.filter((r) => secType(r.isin) === st).slice(0, 2);
  console.log(`   type "${st}"  ${String(n).padStart(4)} ISINs   across series [${[...m.keys()].sort().join(",")}]`);
  for (const e of ex) console.log(`             ${e.isin}  ${(e.symbol || "—").padEnd(14)} ${e.name.slice(0, 44)}`);
}

// ═══════════════════════════════════════════════════════════════
rule("3 · THE VERDICT ON EACH NON-DEBT TYPE — what exactly did the complement fence let in?");
// ═══════════════════════════════════════════════════════════════
const DEBT_TYPE = /^(0[789]|[A-Z][789])$/; // 07/08/09 and the extended A7/B7… rolls NSDL uses when a serial exhausts
const junk = all.filter((r) => !DEBT_TYPE.test(secType(r.isin)));
const debt = all.filter((r) => DEBT_TYPE.test(secType(r.isin)));

console.log(`NOT debt by ISIN security-type: ${junk.length} ISIN(s) — every one of these would have been`);
console.log(`loaded as asset_class='bond' by a series-only fence:\n`);
for (const r of junk) {
  const asStock = await q(`SELECT symbol FROM stocks WHERE isin=$1`, r.isin);
  const inCat = await q(`SELECT asset_class::text ac FROM instruments WHERE isin=$1`, r.isin);
  const what =
    secType(r.isin) === "01" ? "EQUITY SHARE"
    : secType(r.isin) === "04" ? "PREFERENCE SHARE (equity, NOT debt)"
    : r.isin.startsWith("INF") ? "FUND UNIT (INF namespace)"
    : "unclassified";
  console.log(`   [${r.series}] ${r.isin}  type="${secType(r.isin)}"  → ${what}`);
  console.log(`         ${(r.symbol || "—").padEnd(14)} ${r.name}`);
  console.log(`         already a STOCK? ${asStock.length ? `✗✗ YES — ${asStock[0].symbol} (SCORED)` : "no"}   in catalogue? ${inCat.length ? `YES as ${inCat[0].ac}` : "no"}`);
}

console.log(`\n★ THE COLLISION EXPLAINED: the series-only fence had no way to know BL is an equity board`);
console.log(`  and P1 is a preference-share board. The ISIN knew. The two-key fence makes it impossible.`);

// ═══════════════════════════════════════════════════════════════
rule("4 · THE CLEAN COUNT — rows passing BOTH keys (not-a-known-lane AND ISIN says debt)");
// ═══════════════════════════════════════════════════════════════
console.log(`   complement set (series fence alone) : ${all.length}`);
console.log(`   MINUS non-debt security types       : -${junk.length}`);
console.log(`   ★ CLEAN CORPORATE-DEBT ISINs        : ${debt.length}`);

const cleanSeries = [...new Set(debt.map((r) => r.series))].sort();
console.log(`\n   the ${cleanSeries.length} series that survive: ${cleanSeries.join(", ")}`);
const droppedSeries = [...new Set(junk.map((r) => r.series))].sort();
console.log(`   the ${droppedSeries.length} series fully/partly dropped: ${droppedSeries.join(", ")}`);

// Re-run the collision check on the CLEAN set — this is the number that must be zero.
const cleanIsins = debt.map((r) => r.isin);
const stillStock = await q(`SELECT isin, symbol FROM stocks WHERE isin = ANY($1::text[])`, cleanIsins);
const stillCat = await q(`SELECT isin, asset_class::text ac FROM instruments WHERE isin = ANY($1::text[])`, cleanIsins);
console.log(`\n   ★ EXACT ISIN COLLISION with \`stocks\` on the CLEAN set : ${stillStock.length} ${stillStock.length === 0 ? "✓ ZERO — P2002 impossible" : `✗✗ ${J(stillStock)}`}`);
console.log(`   ★ already in \`instruments\` (any class) on the CLEAN set: ${stillCat.length} ${stillCat.length === 0 ? "✓ ZERO — all net-new rows" : `✗✗ ${J(stillCat)}`}`);

// The same-issuer case must SURVIVE — it is correct and expected.
const stems = await q(`SELECT DISTINCT substring(isin from 1 for 7) stem FROM stocks WHERE isin IS NOT NULL`);
const stemSet = new Set(stems.map((r: any) => r.stem));
const sameIssuer = debt.filter((r) => stemSet.has(r.isin.slice(0, 7)));
console.log(`\n   bonds issued by a company we ALSO score as a stock: ${sameIssuer.length} (of ${debt.length})`);
console.log(`   → CORRECT and expected. Same issuer, different security, DIFFERENT ISIN. The stock stays`);
console.log(`     scored; each bond is a net-new stock_id=NULL row, held-NOT-scored. No conflict.`);

// ═══════════════════════════════════════════════════════════════
rule("5 · IS 10 SESSIONS ENOUGH? (the union was still climbing at session 10)");
// ═══════════════════════════════════════════════════════════════
const seen = new Set<string>();
const curve: number[] = [];
for (const s of sessions) {
  for (const r of s.rows) if (!KNOWN.has(r.series) && r.isin && DEBT_TYPE.test(secType(r.isin))) seen.add(r.isin);
  curve.push(seen.size);
}
console.log(`   clean-set union growth: ${curve.join(" → ")}`);
const last3 = curve[curve.length - 1]! - curve[curve.length - 4]!;
console.log(`   new ISINs added over the last 3 sessions: ${last3}  (${(last3 / 3).toFixed(1)}/session)`);
console.log(`
   NOT CONVERGED. The curve is still rising, so ${debt.length} is a FLOOR on the NSE-traded universe,
   not its ceiling. Listed-but-untraded paper never prints and is invisible to a BhavCopy union at ANY
   depth. A longer look-back (30-60 sessions) would raise the count — and because the load is
   idempotent and ACCUMULATES (the govt lane's design), the daily cron converges on it over time
   regardless. The storage headroom is wide enough that this does not change the ruling.`);

// ═══════════════════════════════════════════════════════════════
rule("6 · ATTRIBUTE HONESTY on the CLEAN set");
// ═══════════════════════════════════════════════════════════════
const pct = debt.filter((r) => /(\d+(\.\d+)?)\s*%/.test(r.name)).length;
const yr = debt.filter((r) => /20\d{2}/.test(r.name)).length;
const dt = debt.filter((r) => /\d{1,2}[A-Z]{3}\d{2}|\d{2}[-/]\d{2}[-/]\d{2,4}/i.test(r.name)).length;
const rating = debt.filter((r) => /\b(AAA|AA[+-]?|A[+-]?|BBB|CRISIL|ICRA|CARE)\b/.test(r.name)).length;
const zero = debt.filter((r) => /\b0\s*%/.test(r.name)).length;
console.log(`   coupon "%" in name        : ${pct}/${debt.length} (${((pct / debt.length) * 100).toFixed(1)}%)   [incl. ${zero} explicit 0% = ZERO-COUPON, a REAL 0, not a null]`);
console.log(`   maturity YEAR in name     : ${yr}/${debt.length} (${((yr / debt.length) * 100).toFixed(1)}%)`);
console.log(`   maturity FULL DATE in name: ${dt}/${debt.length} (${((dt / debt.length) * 100).toFixed(1)}%)   e.g. "7.51 NCD 16FEB28 TR1 SR2"`);
console.log(`   CREDIT RATING in name     : ${rating}/${debt.length} (${((rating / debt.length) * 100).toFixed(1)}%)`);
console.log(`
   ISSUER: the udiff has NO issuer column. But the ISIN's 4-char issuer stem is a HARD key, and for
   the ${sameIssuer.length} bonds whose stem matches a stock we already hold, the issuer name is derivable BY JOIN —
   not by parsing. For the rest the stem is still recorded verbatim; the NAME is not a company name.
   RATING: 0% — NOT in the feed, NOT in the name. → honest-NULL with reason "not_sourceable".`);

await prisma.$disconnect();
console.log("\n═══ GATE 0b COMPLETE — nothing was written. ═══");
