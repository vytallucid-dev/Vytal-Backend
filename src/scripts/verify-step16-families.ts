// ═══════════════════════════════════════════════════════════════
// STEP 16 — GATE 3 VERIFICATION. Families are derived. Prove they are RIGHT, and prove they
// COST NOTHING — a family is a display label over rows, not a rewrite of them.
//
// The two un-waivable checks:
//   1. BYTE-IDENTICAL  — the catalogue's own data and the analytics did not move. At all.
//   3. NO OVER-MERGE   — a wrong merge would show one fund's plans under another fund's name.
//                        This is worse than no grouping at all, so it is checked hardest.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { deriveFamilies } from "../ingestions/amfi/derive-families.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));
let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? "✓" : "✗ FAIL"}  ${m}`); if (!c) fail++; };

// The fingerprints captured at GATE 0, BEFORE the migration and BEFORE any family existed.
const BASE_MF = "9a573df845df745ffe74277aff455734";

// ── BASE_AN IS A CURRENT-STATE TRIPWIRE, AND IT HAS BEEN RE-BASELINED (Step 18). ──
//
// It hashes md5(scheme_code || ret_1y) — the fold's OUTPUT VALUES. Those move whenever the fold
// re-runs against newer AMFI data, because every return is measured to a new as-of date. That is
// the SOURCE MOVING, not a regression, and verify-step13-etf's header already spells this out at
// length for the identical hash.
//
// It is NOT a byte-identical proof of anything, and it must not be mistaken for one. The honest
// proof that Step 18 (Group-3: beta/alpha/tracking-error) did not perturb a single prior metric is
// an A/B on IDENTICAL INPUTS — fold twice, same AMFI file, same catalogue, one variable — which is
// verify-step18-ab.ts. Both arms produced 0e1782464ebe7c087d54f24cc8234d9a over a 26-column
// fingerprint that INCLUDES ret_1y, the one column this line hashes.
//
// What this tripwire still earns its keep for: catching the table moving when NOTHING should have
// moved it. Re-baselined after the Step-18 fold (2026-07-12 as-of), which was proven non-perturbing
// by that A/B. See verify-step18-preexisting.ts for the full measurement.
const BASE_AN = "f4dfb1f02c2142c3e50b1ba3b0ee5770";

// ═══ 1. BYTE-IDENTICAL — un-waivable ═════════════════════════════════════
rule("1. BYTE-IDENTICAL — the 17,567 MF rows and the analytics must not have moved");
const [mf] = await q(`
  SELECT COUNT(*) AS rows, COUNT(DISTINCT amfi_scheme_code) AS codes,
    md5(string_agg(isin||'|'||COALESCE(amfi_scheme_code,'')||'|'||COALESCE(scheme_name,'')||'|'||
        COALESCE(current_nav::text,'')||'|'||COALESCE(nav_date::text,''),'~' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class='mutual_fund'`);
const [an] = await q(`SELECT COUNT(*) AS rows,
  md5(string_agg(scheme_code||'|'||COALESCE(ret_1y::text,''),'~' ORDER BY scheme_code)) AS fp FROM mf_analytics`);
ok(Number(mf.rows) === 17567, `instruments MF rows = ${Number(mf.rows)} (expect 17,567)`);
ok(Number(mf.codes) === 13704, `distinct scheme codes = ${Number(mf.codes)} (expect 13,704)`);
ok(mf.fp === BASE_MF, `instruments/MF fingerprint ${mf.fp} === Gate-0 baseline`);
ok(Number(an.rows) === 14041, `mf_analytics rows = ${Number(an.rows)} (expect 14,041)`);
ok(an.fp === BASE_AN, `mf_analytics fingerprint ${an.fp} === Gate-0 baseline`);
const [nofam] = await q(`SELECT COUNT(*) AS n FROM information_schema.columns
  WHERE table_name='instruments' AND column_name ILIKE '%famil%'`);
ok(Number(nofam.n) === 0, `instruments carries NO family column — the grouping never touches it`);

// ═══ 2. KNOWN FUNDS GROUP CORRECTLY ══════════════════════════════════════
rule("2. SPOT-CHECK — India's biggest funds group their known plan variants under ONE family");
for (const name of ["HDFC Large Cap Fund", "SBI Large Cap Fund", "Axis Large Cap Fund",
                    "HDFC Flexi Cap Fund", "SBI Small Cap Fund", "Parag Parikh Flexi Cap Fund",
                    "HDFC Balanced Advantage Fund", "UTI Flexi Cap Fund"]) {
  const rows = await q(`
    SELECT f.canonical_name AS cn, f.scheme_count AS n, m.scheme_code AS code, m.scheme_name AS sn, m.plan_option AS po
    FROM mf_families f JOIN mf_family_members m ON m.family_id = f.id
    WHERE lower(f.canonical_name) = lower($1) ORDER BY m.scheme_code`, name);
  ok(rows.length === 4, `"${name}" → ${rows.length} scheme codes in ONE family (expect 4)`);
  for (const r of rows) console.log(`        ${r.code}  ${r.sn}\n                variant: ${r.po}`);
}

// ═══ 3. NO OVER-MERGE — un-waivable ══════════════════════════════════════
rule("3. NO OVER-MERGE — clearly-different funds MUST be in different families");
const pairs: [string, string][] = [
  ["ICICI Prudential Savings Fund", "ICICI Prudential Regular Savings Fund"],
  ["DSP Savings Fund", "DSP Regular Savings Fund"],
  ["Aditya Birla Sun Life Low Duration Fund", "Aditya Birla Sun Life Long Duration Fund"],
  ["Mirae Asset Large Cap Fund", "Mirae Asset Large & Midcap Fund"],
  ["ICICI Prudential Nifty 50 Index Fund", "ICICI Prudential Nifty 500 Index Fund"],
];
for (const [a, b] of pairs) {
  const [r] = await q(`
    SELECT (SELECT id FROM mf_families WHERE lower(canonical_name)=lower($1)) AS ida,
           (SELECT id FROM mf_families WHERE lower(canonical_name)=lower($2)) AS idb`, a, b);
  ok(!!r.ida && !!r.idb && r.ida !== r.idb, `"${a}"  ≠  "${b}"  (distinct families)`);
}
// Retirement 30s/40s/50s — three DIFFERENT funds whose keys are one character apart.
const [ret] = await q(`SELECT COUNT(DISTINCT id) AS n FROM mf_families
  WHERE canonical_name ILIKE 'Aditya Birla Sun Life Retirement Fund%'`);
ok(Number(ret.n) >= 3, `ABSL Retirement Fund The 30s/40s/50s → ${Number(ret.n)} distinct families (expect ≥3)`);

// FMP / series: no family may span two series numbers.
const [fmp] = await q(`
  SELECT COUNT(*) AS n FROM mf_families
  WHERE (family_key ~ 'fmp|fixed maturity|fixed term|series|interval') AND scheme_count > 20`);
ok(Number(fmp.n) === 0, `series/FMP families with >20 codes (a cross-series merge): ${Number(fmp.n)} (expect 0)`);
const [dsp] = await q(`
  SELECT COUNT(DISTINCT family_id) AS n FROM mf_family_members WHERE scheme_name ILIKE 'DSP FMP Series%'`);
const [dspF] = await q(`SELECT COUNT(*) AS n FROM mf_family_members WHERE scheme_name ILIKE 'DSP FMP Series%'`);
ok(Number(dsp.n) === Number(dspF.n) / 4, `DSP FMP: ${Number(dspF.n)} codes → ${Number(dsp.n)} families (4 variants each — series preserved)`);

// THE CEILING — a fund has at most (Growth + Bonus + ~8 IDCW cadences) × (Direct + Regular) = 20.
const [ceil] = await q(`SELECT COALESCE(MAX(scheme_count),0) AS mx, COUNT(*) FILTER (WHERE scheme_count > 20) AS over FROM mf_families`);
ok(Number(ceil.over) === 0, `families above the 20-variant ceiling: ${Number(ceil.over)} (max observed = ${Number(ceil.mx)})`);

// COLLISIONS — two codes claiming ONE plan+option slot. 15 known AMFI duplicates; a RISE = merge.
const coll = await q(`
  SELECT family_id, plan_option, COUNT(*) AS n FROM mf_family_members
  GROUP BY family_id, plan_option HAVING COUNT(*) > 1`);
ok(coll.length === 15, `colliding plan+option slots = ${coll.length} (expect 15 — all known AMFI duplicates)`);

// ONE SCHEME, ONE FAMILY — structurally enforced by the PK, asserted anyway.
const [dup] = await q(`SELECT COUNT(*) AS n FROM (SELECT scheme_code FROM mf_family_members GROUP BY 1 HAVING COUNT(*)>1) x`);
ok(Number(dup.n) === 0, `scheme codes appearing in >1 family: ${Number(dup.n)} (expect 0)`);
// NO family mixes asset classes.
const [mix] = await q(`
  SELECT COUNT(*) AS n FROM (
    SELECT m.family_id FROM mf_family_members m
    JOIN instruments i ON i.amfi_scheme_code = m.scheme_code
    GROUP BY m.family_id HAVING COUNT(DISTINCT i.asset_class) > 1) x`);
ok(Number(mix.n) === 0, `families mixing mutual_fund and etf: ${Number(mix.n)} (expect 0)`);
// NO family spans two fund houses (the house scopes the key — this proves it).
const [hx] = await q(`
  SELECT COUNT(*) AS n FROM (
    SELECT m.family_id FROM mf_family_members m
    JOIN instruments i ON i.amfi_scheme_code = m.scheme_code
    GROUP BY m.family_id HAVING COUNT(DISTINCT i.fund_house) > 1) x`);
ok(Number(hx.n) === 0, `families spanning >1 fund house: ${Number(hx.n)} (expect 0)`);

// ═══ 4. SINGLETONS HONEST ════════════════════════════════════════════════
rule("4. SINGLETONS ARE HONEST — refused schemes say WHY; nothing is force-merged");
const reasons = await q(`SELECT ungrouped_reason AS r, COUNT(*) AS n FROM mf_families
  WHERE ungrouped_reason IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`);
const [sing] = await q(`SELECT COUNT(*) FILTER (WHERE is_singleton) AS s,
  COUNT(*) FILTER (WHERE is_singleton AND ungrouped_reason IS NULL) AS genuine,
  COUNT(*) FILTER (WHERE ungrouped_reason IS NOT NULL) AS refused FROM mf_families`);
console.log(`  singleton families : ${Number(sing.s)}`);
console.log(`   ├─ genuinely 1 variant : ${Number(sing.genuine)}`);
console.log(`   └─ REFUSED (with reason): ${Number(sing.refused)}`);
for (const r of reasons) console.log(`        ${String(Number(r.n)).padStart(4)}  ${r.r}`);
ok(reasons.length > 0 && Number(sing.refused) === 29, `29 refused schemes each carry a stated reason`);
const [orph] = await q(`SELECT COUNT(*) AS n FROM mf_families WHERE ungrouped_reason IS NOT NULL AND NOT is_singleton`);
ok(Number(orph.n) === 0, `no refused scheme was quietly folded into a real family: ${Number(orph.n)}`);
for (const r of await q(`SELECT canonical_name AS cn FROM mf_families WHERE ungrouped_reason IS NOT NULL ORDER BY 1 LIMIT 4`))
  console.log(`        e.g. ${r.cn}`);

// THE ACCEPTED LIMITATION — an AMFI typo splits one fund. Asserted, so it can never be forgotten.
const gov = await q(`SELECT canonical_name AS cn, scheme_count AS n FROM mf_families
  WHERE family_key LIKE '%ernment securities fund' OR family_key LIKE '%enment securities fund' ORDER BY 1`);
console.log(`\n  ── ACCEPTED: an AMFI typo splits ABSL's G-Sec fund into 2 families (we do NOT fuzzy-merge) ──`);
for (const g of gov) console.log(`        [${Number(g.n)}]  ${g.cn}`);

// ═══ 5. RE-RUNNABLE ══════════════════════════════════════════════════════
rule("5. RE-RUNNABLE — a second derive reproduces the SAME grouping and touches no catalogue row");
const gfp = () => q(`SELECT COUNT(*) AS n, md5(string_agg(
    f.fund_house||'|'||f.family_key||'|'||f.canonical_name||'|'||m.scheme_code||'|'||COALESCE(m.plan_option,''),
    '~' ORDER BY m.scheme_code)) AS fp
  FROM mf_family_members m JOIN mf_families f ON f.id = m.family_id`);
const [g1] = await gfp();
await deriveFamilies(() => {});                       // ← re-derive
const [g2] = await gfp();
const [mf2] = await q(`
  SELECT md5(string_agg(isin||'|'||COALESCE(amfi_scheme_code,'')||'|'||COALESCE(scheme_name,'')||'|'||
        COALESCE(current_nav::text,'')||'|'||COALESCE(nav_date::text,''),'~' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class='mutual_fund'`);
ok(g1.fp === g2.fp, `grouping fingerprint identical across re-derive (${g2.fp})`);
ok(Number(g1.n) === Number(g2.n), `membership count identical: ${Number(g2.n)}`);
ok(mf2.fp === BASE_MF, `instruments/MF fingerprint STILL ${BASE_MF} after a second derive`);

// ═══ 6. ETFs ═════════════════════════════════════════════════════════════
rule("6. ETFs — same normalizer, uniformly. 337 rows; the 3 real Growth/IDCW pairs ARE grouped");
const [etf] = await q(`SELECT COUNT(*) AS fams, SUM(scheme_count) AS codes,
  COUNT(*) FILTER (WHERE scheme_count > 1) AS multi FROM mf_families WHERE asset_class='etf'`);
ok(Number(etf.codes) === 337, `ETF scheme codes covered = ${Number(etf.codes)} (expect 337)`);
ok(Number(etf.fams) === 334, `ETF families = ${Number(etf.fams)} (expect 334)`);
ok(Number(etf.multi) === 3, `ETF families with >1 member = ${Number(etf.multi)} (the liquid-rate Growth/IDCW pairs)`);
for (const r of await q(`SELECT f.canonical_name AS cn, m.scheme_code AS c, m.plan_option AS po
  FROM mf_families f JOIN mf_family_members m ON m.family_id=f.id
  WHERE f.asset_class='etf' AND f.scheme_count>1 ORDER BY f.canonical_name, m.scheme_code`))
  console.log(`        ${r.cn}  ·  ${r.c}  [${r.po}]`);

// ═══ 7. COVERAGE ═════════════════════════════════════════════════════════
rule("7. COVERAGE — every scheme code in the catalogue has exactly one family");
const [cov] = await q(`
  SELECT (SELECT COUNT(DISTINCT amfi_scheme_code) FROM instruments
          WHERE amfi_scheme_code IS NOT NULL AND asset_class IN ('mutual_fund','etf')) AS catalogue,
         (SELECT COUNT(*) FROM mf_family_members) AS members`);
ok(Number(cov.catalogue) === Number(cov.members),
   `catalogue scheme codes ${Number(cov.catalogue)} === family members ${Number(cov.members)} (no scheme left behind)`);
const [mfOnly] = await q(`SELECT SUM(scheme_count) AS codes,
  SUM(scheme_count) FILTER (WHERE scheme_count>1) AS grouped FROM mf_families WHERE asset_class='mutual_fund'`);
console.log(`\n  MF grouping rate: ${Number(mfOnly.grouped)} / ${Number(mfOnly.codes)} = ` +
            `${((Number(mfOnly.grouped) / Number(mfOnly.codes)) * 100).toFixed(1)}% of MF scheme codes sit in a multi-variant family`);

rule(fail === 0 ? "✅ GATE 3 GREEN — all checks passed" : `❌ ${fail} CHECK(S) FAILED`);
console.log(J({ mf_fingerprint: mf.fp, analytics_fingerprint: an.fp, grouping_fingerprint: g2.fp }));
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
