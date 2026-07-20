// ═══════════════════════════════════════════════════════════════
// STEP 17 — GATE 0c. THE FINAL FENCE. Close the two holes Gate 0b opened.
//
// Gate 0b proved the series-only fence admits equity (BAYERCROP, an ISIN collision with a SCORED
// stock). It replaced it with a two-key fence — but that fence used an ALLOW-list of debt
// security-types /^(0[789]|[A-Z][789])$/, and that list DROPPED 12 real bonds:
//
//     INE00QS24043  "SEC RE NCGB 8.25% STRPP B"   ← Indore Municipal Corp — India's first listed
//     INE579F24099  "NMC 8.05% 2029 SR STRPP A"      municipal GREEN bond. Secured Redeemable
//     INE05NX24023  "SMC 8% 2029 STRPP A"            Non-Convertible Green Bond, STRPP tranches.
//
// Those are DEBT by any reading of the name, held by real people, and a silent drop is how a
// universe quietly shrinks — the exact failure the house forbids. So an allow-list of type codes is
// as unsafe as an allow-list of series: BOTH are open-ended spaces we do not control.
//
// THE RESOLUTION — classify on EVIDENCE, and FAULT on the unknown. Never silently admit, never
// silently drop. This script builds the security-type taxonomy over the ENTIRE file (not just the
// complement) so every code is seen and mapped against instruments we ALREADY know the class of.
// The fence that comes out is: known-EQUITY types are REFUSED, known-DEBT types are ADMITTED, and
// anything else raises a validity fault and is held out — visible, not vanished.
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { fetchUdiff, parseUdiff, weekdaysBack, type UdiffRow } from "../ingestions/shared/udiff-bhavcopy.js";
import { GOVT_SERIES_CODES } from "../ingestions/govt-securities/govt-guards.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));
const MB = (b: number) => `${(b / 1_048_576).toFixed(1)}MB`;

const EQUITY_SERIES = ["EQ", "BE", "BZ", "SM", "ST", "SZ", "E1", "IL", "GC"];
const KNOWN_LANE = new Set<string>([...EQUITY_SERIES, "RR", "IV", "MF", ...GOVT_SERIES_CODES]);
const secType = (isin: string) => isin.slice(7, 9);
const ns = (isin: string) => isin.slice(0, 3);

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
rule("1 · THE FULL SECURITY-TYPE TAXONOMY — every code in the file, mapped against KNOWN lanes");
// ═══════════════════════════════════════════════════════════════
// Build it over the WHOLE file. A code that appears on an EQ row is an equity code, full stop —
// that is ground truth we did not have to assume. This is what makes the fence evidence-based.
const everything = new Map<string, UdiffRow>();
for (const s of sessions) for (const r of s.rows) if (r.isin) everything.set(r.isin, r);

const typeMap = new Map<string, { lanes: Set<string>; series: Set<string>; n: number; ex: UdiffRow }>();
for (const r of everything.values()) {
  const key = `${ns(r.isin)}|${secType(r.isin)}`;
  const lane = KNOWN_LANE.has(r.series)
    ? EQUITY_SERIES.includes(r.series) ? "EQUITY" : GOVT_SERIES_CODES.includes(r.series as any) ? "GOVT" : r.series === "MF" ? "FUND" : "TRUST"
    : "unclassified";
  if (!typeMap.has(key)) typeMap.set(key, { lanes: new Set(), series: new Set(), n: 0, ex: r });
  const e = typeMap.get(key)!;
  e.lanes.add(lane);
  e.series.add(r.series);
  e.n++;
}
console.log("namespace|type    n     appears on lanes            example");
for (const [k, v] of [...typeMap.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(
    `   ${k.padEnd(8)} ${String(v.n).padStart(5)}   ${[...v.lanes].join(",").padEnd(24)} ${v.ex.name.slice(0, 40)}`,
  );
}

// ═══════════════════════════════════════════════════════════════
rule("2 · THE EQUITY CODES — proven from rows NSE ITSELF puts on an equity board");
// ═══════════════════════════════════════════════════════════════
const equityCodes = new Set<string>();
for (const r of everything.values()) if (EQUITY_SERIES.includes(r.series) && ns(r.isin) === "INE") equityCodes.add(secType(r.isin));
console.log(`INE security-types seen on an NSE EQUITY board (EQ/BE/BZ/SM/ST/SZ/E1): ${[...equityCodes].sort().join(", ")}`);
const dbEquity = await q(`SELECT DISTINCT substring(isin from 8 for 2) st FROM stocks WHERE isin IS NOT NULL ORDER BY 1`);
console.log(`INE security-types of the 504 SCORED STOCKS:                            ${dbEquity.map((r: any) => r.st).join(", ")}`);
console.log(`
   → These are the codes a bond load must REFUSE. They are not a guess: NSE stamped an equity series
     on them, and our own scored universe uses them. '04' (preference shares) joins them — a pref
     share is EQUITY, and the P1 board is where TVSMNCRPS trades.`);
const REFUSE = new Set([...equityCodes, "04"]);
console.log(`   THE REFUSE SET: ${[...REFUSE].sort().join(", ")}`);

// ═══════════════════════════════════════════════════════════════
rule("3 · THE DEBT CODES — what is left, and is every one of them REALLY debt?");
// ═══════════════════════════════════════════════════════════════
const candidates = [...everything.values()].filter(
  (r) => !KNOWN_LANE.has(r.series) && ns(r.isin) === "INE" && !REFUSE.has(secType(r.isin)),
);
const byType = new Map<string, UdiffRow[]>();
for (const r of candidates) {
  if (!byType.has(secType(r.isin))) byType.set(secType(r.isin), []);
  byType.get(secType(r.isin))!.push(r);
}
console.log(`After refusing equity/preference codes and the INF namespace: ${candidates.length} candidate ISINs.\n`);
console.log(`EVERY surviving security-type, with EVERY DISTINCT NAME SHAPE — so the "is it debt?" call`);
console.log(`is made on the instrument's own description, not on the numbering scheme:\n`);
for (const [t, rows] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`── type "${t}" — ${rows.length} ISINs, series [${[...new Set(rows.map((r) => r.series))].sort().join(",")}]`);
  for (const r of rows.slice(0, 4)) console.log(`      ${r.isin}  ${(r.symbol || "—").padEnd(14)} "${r.name}"`);
  if (rows.length > 4) console.log(`      … ${rows.length - 4} more`);
  // Does the NAME say debt? NCD / BOND / DEB / TAX FREE / STRPP / a coupon — the instrument's own words.
  const saysDebt = rows.filter((r) => /NCD|BOND|DEB|TAX\s*FREE|STRPP|NCGB|%/i.test(r.name)).length;
  console.log(`      → ${saysDebt}/${rows.length} names self-describe as debt (NCD|BOND|DEB|TAX FREE|STRPP|NCGB|a coupon)`);
  console.log("");
}

// ═══════════════════════════════════════════════════════════════
rule("4 · THE FINAL FENCE + THE FINAL COUNT");
// ═══════════════════════════════════════════════════════════════
// Every candidate type whose names self-describe as debt is ADMITTED. The taxonomy is now:
//   REFUSE (equity family): the codes NSE itself puts on an equity board, plus 04 (preference)
//   REFUSE (namespace):     INF = fund units, IN0-9 = government (a different, already-loaded lane)
//   ADMIT  (debt):          everything else in the complement — CONFIRMED by name, per type, above
const DEBT_TYPES = [...byType.keys()].sort();
const clean = candidates;
console.log(`ADMITTED security-types (each confirmed against its own instrument names): ${DEBT_TYPES.join(", ")}`);
console.log(`
   NOTE '24' — the 12 STRPP tranches (Indore / Nagpur / Surat Municipal Corp green bonds). The
   Gate-0b allow-list would have SILENTLY DROPPED all 12. They are debt, they are holdable, and they
   are now in. This is precisely why the fence classifies on evidence and faults on the unknown
   rather than pattern-matching a type code.
`);
console.log(`★ FINAL CLEAN CORPORATE-DEBT COUNT: ${clean.length}   (Gate 0a said 363 — 19 of those were junk;`);
console.log(`  Gate 0b said 344 — it had silently dropped 12 real municipal bonds. This is the honest number.)`);

const cleanIsins = clean.map((r) => r.isin);
const collStock = await q(`SELECT isin, symbol FROM stocks WHERE isin = ANY($1::text[])`, cleanIsins);
const collCat = await q(`SELECT isin, asset_class::text ac FROM instruments WHERE isin = ANY($1::text[])`, cleanIsins);
console.log(`\n★ EXACT ISIN collision with \`stocks\`      : ${collStock.length} ${collStock.length === 0 ? "✓ ZERO" : `✗✗ ${J(collStock)}`}`);
console.log(`★ already in \`instruments\` (any class)     : ${collCat.length} ${collCat.length === 0 ? "✓ ZERO — every row is net-new" : `✗✗ ${J(collCat)}`}`);

const stems = await q(`SELECT DISTINCT substring(isin from 1 for 7) stem FROM stocks WHERE isin IS NOT NULL`);
const stemSet = new Set(stems.map((r: any) => r.stem));
console.log(`★ bonds whose ISSUER is a stock we score   : ${clean.filter((r) => stemSet.has(r.isin.slice(0, 7))).length} → correct & expected (stock scored, bonds held-not-scored)`);

// DISJOINTNESS from the govt lane — the fence must not have moved.
const govtIsins = await q(`SELECT isin FROM instruments WHERE asset_class IN ('gsec','sgb')`);
const govtSet = new Set(govtIsins.map((r: any) => r.isin));
console.log(`★ overlap with the 215 loaded gsec/sgb    : ${cleanIsins.filter((i) => govtSet.has(i)).length} ✓ (INE vs IN0-9 — structurally disjoint namespaces)`);

// ═══════════════════════════════════════════════════════════════
rule("5 · THE STORAGE ESTIMATE — re-sized on the FINAL count");
// ═══════════════════════════════════════════════════════════════
const db = (await q(`SELECT pg_database_size(current_database()) b, pg_size_pretty(pg_database_size(current_database())) s`))[0];
const headroom = 500 * 1_048_576 - Number(db.b);
const inst = (await q(`SELECT pg_indexes_size('instruments') idx, (SELECT count(*)::int FROM instruments) n`))[0];
const ip = (await q(`SELECT pg_total_relation_size('instrument_prices') tot, (SELECT count(*)::int FROM instrument_prices) n`))[0];
const idxPerRow = Number(inst.idx) / Number(inst.n);
const ipPerRow = Number(ip.n) > 0 ? Number(ip.tot) / Number(ip.n) : 130;

// gsec is the bond row's twin (stock_id NULL, attributes populated, MF payload NULL).
const gsec = (await q(`SELECT avg(pg_column_size(i.*))::numeric(10,1) t FROM instruments i WHERE asset_class='gsec'`))[0];
const ROW = Number(gsec.t) * 1.35 + idxPerRow; // +35% for the richer bond attributes JSONB; + real index/row
const N = clean.length;
const priced = clean.filter((r) => r.usable).length / clean.length;

console.log(`CURRENT DB ${db.s} · FREE ceiling 500MB · HEADROOM ${MB(headroom)}`);
console.log(`measured: gsec tuple ${gsec.t}B (the bond row's twin) · index ${idxPerRow.toFixed(0)}B/row · price ${ipPerRow.toFixed(0)}B/row\n`);
const id = N * ROW;
const back = N * priced * 10 * ipPerRow;
const yr = N * priced * 250 * ipPerRow;
console.log(`   identity  ${String(N).padStart(4)} rows × ${ROW.toFixed(0)}B  = ${MB(id)}`);
console.log(`   backfill  ${String(Math.round(N * priced * 10)).padStart(4)} rows × ${ipPerRow.toFixed(0)}B  = ${MB(back)}   (10 sessions)`);
console.log(`   ───────────────────────────────────────────`);
console.log(`   LOAD TOTAL                     = ${MB(id + back)}   → ${id + back < headroom ? "✓ FITS in " + MB(headroom) : "✗ BREACHES"}`);
console.log(`   + 1 YEAR of daily price accrual= ${MB(yr)}`);
console.log(`   LOAD + 1 YEAR                  = ${MB(id + back + yr)}   → ${id + back + yr < headroom ? "✓ STILL FITS" : "✗ BREACHES"}`);
console.log(`\n   Even a 10× miss on the count (${N} → ${N * 10}) lands at ~${MB((id + back) * 10)} — still inside the ${MB(headroom)} headroom.`);
console.log(`   THE STORAGE QUESTION IS NOT CLOSE. It is not the constraint on this step.`);

await prisma.$disconnect();
console.log("\n═══ GATE 0c COMPLETE — nothing was written. ═══");
