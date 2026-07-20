// ═══════════════════════════════════════════════════════════════
// STEP 16 — GATE 0 RECON (READ-ONLY). Family derivation: can plan/option variants be
// grouped into ONE fund, CONFIDENTLY?
//
// Probe 1 established the ground truth this is designed against:
//   · 17,567 MF ISIN rows → 13,704 distinct scheme codes → 13,704 distinct scheme_names (1:1).
//   · 51 fund houses. scheme_name is NEVER null. ETFs: 337 rows, ZERO contain direct/regular.
//   · The name shape is NOT "[AMC] [Fund] - [Plan] - [Option]". It is a SWAMP:
//       "CAPITALMIND FLEXI CAP FUND DIRECT GROWTH"                 (all-caps, no delimiters)
//       "Mirae Asset Large Cap Fund Direct IDCW"                   (no hyphen at all)
//       "quant ELSS Tax Saver Fund - IDCW Option - Regular Plan"   (option BEFORE plan)
//       "Kotak Gilt-Investment Regular-Payout of Income Distribution cum capital withdrawal option"
//       "Groww Liquid Fund (formerly known as Indiabulls Liquid Fund) - Regular Plan - Growth"
//                                     ^^^^^^ a DIFFERENT fund's name, embedded mid-string
//
// THE DESIGN UNDER TEST — TAIL-STRIPPING, STOP-AT-FIRST-UNKNOWN:
//   The fund identity is the HEAD of the name; plan/option tokens are the TAIL. So: repeatedly
//   strip KNOWN plan/option phrases from the END, and STOP the moment the tail is a word we do
//   not know. Whatever remains is the family key.
//
//   The guard is therefore STRUCTURAL, not a blocklist: any trailing text we do not recognise is
//   IDENTITY BY DEFAULT. FMP series numbers ("Series - 264 - 60M - 17D") survive not because we
//   wrote a rule for them, but because "264" is not in the strip vocabulary and stripping halts
//   there. That is what makes over-merge hard by construction rather than by vigilance.
//
// This script WRITES NOTHING. It applies the draft normalizer in memory and hunts for the places
// it would be WRONG.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));

// ═══════════════════════════════════════════════════════════════
// THE DRAFT NORMALIZER
// ═══════════════════════════════════════════════════════════════

// Parentheticals that are NOISE, not identity. "(formerly known as X)" embeds ANOTHER fund's
// name — leaving it in would split a family; a blind paren-strip would delete real identity
// like "(93 Days)". So we remove ONLY the ones that announce themselves as historical.
const NOISE_PAREN = /\((?:\s*(?:formerly|erstwhile|earlier)\b[^)]*)\)/gi;

// The TAIL vocabulary — every phrase measured out of the real 13,704 names, longest first so
// "growth option" is consumed before bare "growth", and the long IDCW legalese before "option".
const TAIL_PHRASES: string[] = [
  // ── the IDCW legalese, in full and in every partial form AMFI actually publishes ──
  "reinvestment of income distribution cum capital withdrawal option",
  "payout of income distribution cum capital withdrawal option",
  "income distribution cum capital withdrawal option",
  "reinvestment of income distribution cum capital withdrawal",
  "payout of income distribution cum capital withdrawal",
  "income distribution cum capital withdrawal",
  // ── option ──
  "idcw payout option", "idcw reinvestment option", "idcw payout", "idcw reinvestment",
  "idcw option", "idcw",
  "dividend payout option", "dividend reinvestment option", "dividend payout",
  "dividend reinvestment", "dividend option", "dividend",
  "growth option", "growth plan", "growth",
  "cumulative option", "cumulative",
  "payout option", "reinvestment option", "reinvest option",
  "payout", "reinvestment", "reinvest",
  // ── plan ──
  "direct plan", "regular plan", "direct", "regular",
  // ── frequency (an IDCW cadence, never an identity) ──
  "daily", "weekly", "fortnightly", "monthly", "quarterly", "half yearly", "halfyearly",
  "half-yearly", "annual", "annually", "yearly",
  // ── bare structural words left behind by the above ──
  "option", "plan",
];

// Words we will NEVER strip even though they sit in the tail — they CHANGE WHICH FUND this is.
// (Measured in section D below; listed here so the intent is auditable.)
const IDENTITY_TAIL = new Set([
  "segregated", "portfolio", "institutional", "retail", "unclaimed", "bonus", "series",
]);

const clean = (s: string) =>
  s.replace(NOISE_PAREN, " ")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")      // unicode dashes → ascii
    .replace(/[^a-z0-9&+.\-/ ]+/g, " ")    // drop (), commas, quotes; KEEP & + . - / (identity: "Large & Mid", "50/50")
    .replace(/\s*-\s*/g, " - ")            // isolate hyphens used as separators
    .replace(/\s+/g, " ")
    .trim();

/** Tail-strip. Returns the family key, plus WHY if we refuse to be confident. */
function familyKey(schemeName: string): { key: string; stripped: string[]; reason?: string } {
  let words = clean(schemeName).split(" ").filter(Boolean);
  const stripped: string[] = [];

  for (let guard = 0; guard < 40; guard++) {
    // drop a trailing bare separator
    if (words.length && words[words.length - 1] === "-") { words.pop(); continue; }
    const last = words[words.length - 1];
    if (last && IDENTITY_TAIL.has(last)) break;   // an identity word — STOP, never strip past it

    let hit = "";
    for (const p of TAIL_PHRASES) {               // longest-first: TAIL_PHRASES is authored that way
      const pw = p.split(" ");
      if (pw.length > words.length) continue;
      const tail = words.slice(words.length - pw.length).join(" ");
      if (tail === p) { hit = p; break; }
    }
    if (!hit) break;                              // STOP-AT-FIRST-UNKNOWN — the whole guard
    words = words.slice(0, words.length - hit.split(" ").length);
    stripped.push(hit);
  }
  while (words.length && (words[words.length - 1] === "-" || words[words.length - 1] === "&")) words.pop();

  const key = words.join(" ");
  // ── CONFIDENCE FLOOR — refuse to group a key that has been eaten down to nothing ──
  const meaningful = words.filter((w) => w !== "-" && w.length > 1);
  if (meaningful.length < 2) return { key, stripped, reason: "key too short after strip (<2 words)" };
  if (key.length < 6) return { key, stripped, reason: "key too short after strip (<6 chars)" };
  return { key, stripped };
}

// ═══════════════════════════════════════════════════════════════
// LOAD — the real rows (scheme-code grain: the NAV grain, per Step 9/10)
// ═══════════════════════════════════════════════════════════════
const rows = await q(`
  SELECT DISTINCT amfi_scheme_code AS code, scheme_name AS name, fund_house AS house, plan_type
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL
  ORDER BY amfi_scheme_code
`);
rule(`LOADED ${rows.length} distinct (scheme_code, scheme_name) pairs — the grain a family groups`);

// ── Derive ────────────────────────────────────────────────────────────────
type Fam = { key: string; house: string; codes: string[]; names: string[] };
const fams = new Map<string, Fam>();
const unconfident: { code: string; name: string; reason: string }[] = [];

for (const r of rows) {
  const { key, reason } = familyKey(r.name);
  // FAMILY KEY IS SCOPED BY FUND HOUSE. Two AMCs both have a "Large Cap Fund"; the house is the
  // one hard, non-derived discriminator we already trust (Step 9 ingested it from AMFI's header).
  const id = `${r.house}||${key}`;
  if (reason) { unconfident.push({ code: r.code, name: r.name, reason }); continue; }
  const f = fams.get(id) ?? { key, house: r.house, codes: [] as string[], names: [] as string[] };
  f.codes.push(r.code); f.names.push(r.name);
  fams.set(id, f);
}

// ═══════════════════════════════════════════════════════════════
rule("A. FAMILY-SIZE DISTRIBUTION — does this even group anything?");
const sizes = new Map<number, number>();
for (const f of fams.values()) sizes.set(f.codes.length, (sizes.get(f.codes.length) ?? 0) + 1);
const grouped = [...fams.values()].filter((f) => f.codes.length > 1);
const singles = [...fams.values()].filter((f) => f.codes.length === 1);
console.log(`  families total       : ${fams.size}`);
console.log(`  ├─ multi-scheme      : ${grouped.length}  (covering ${grouped.reduce((a, f) => a + f.codes.length, 0)} scheme codes)`);
console.log(`  └─ singleton         : ${singles.length}`);
console.log(`  unconfident (floor)  : ${unconfident.length}  → each stays its OWN singleton\n`);
console.log("  size → n families");
for (const s of [...sizes.keys()].sort((a, b) => a - b)) console.log(`   ${String(s).padStart(3)} → ${sizes.get(s)}`);

// ═══════════════════════════════════════════════════════════════
rule("B. THE OVER-MERGE SMELL TEST — the LARGEST families. A fund has ~8 plans, NOT 40.");
console.log("  If a family is huge, the normalizer ATE identity. These are the ones to distrust.\n");
for (const f of [...fams.values()].sort((a, b) => b.codes.length - a.codes.length).slice(0, 12)) {
  console.log(`  ── [${f.codes.length} codes] ${f.house} :: "${f.key}"`);
  for (const n of f.names.slice(0, 10)) console.log(`       ${n}`);
  if (f.names.length > 10) console.log(`       … +${f.names.length - 10} more`);
}

// ═══════════════════════════════════════════════════════════════
rule("C. THE NON-MERGE PROOF — funds that MUST stay apart. Different key ⇒ different family.");
const pairs: [string, string][] = [
  ["mirae asset large cap fund", "mirae asset large & midcap fund"],
  ["icici prudential nifty 50 index fund", "icici prudential nifty 500 index fund"],
  ["dsp fmp series - 264 - 60m - 17d", "dsp fmp series - 267 - 1172 days"],
];
for (const [a, b] of pairs) {
  const fa = [...fams.values()].find((f) => f.key === a);
  const fb = [...fams.values()].find((f) => f.key === b);
  const ok = fa && fb && fa.key !== fb.key;
  console.log(`  ${ok ? "✓ SEPARATE" : "✗ CHECK"}  "${a}" (${fa?.codes.length ?? 0}) vs "${b}" (${fb?.codes.length ?? 0})`);
}
console.log("\n  ── EVERY FMP/Series family: do the series numbers survive as distinct families? ──");
const fmp = [...fams.values()].filter((f) => /\bfmp\b|fixed maturity|\bseries\b/.test(f.key));
console.log(`  ${fmp.length} series-bearing families. Sample (each MUST be its own fund):`);
for (const f of fmp.slice(0, 10)) console.log(`    [${f.codes.length}] ${f.key}`);
const fmpBad = fmp.filter((f) => f.codes.length > 8);
console.log(`  series families with >8 codes (would indicate a cross-series merge): ${fmpBad.length}`);
for (const f of fmpBad.slice(0, 5)) { console.log(`    ✗ [${f.codes.length}] ${f.key}`); f.names.forEach((n) => console.log(`         ${n}`)); }

// ═══════════════════════════════════════════════════════════════
rule("D. THE IDENTITY-TAIL WORDS — do Segregated / Institutional / Retail / Bonus / Unclaimed exist?");
for (const w of ["Segregated", "Institutional", "Retail", "Bonus", "Unclaimed"]) {
  const hit = rows.filter((r) => new RegExp(`\\b${w}\\b`, "i").test(r.name));
  console.log(`\n  ${w}: ${hit.length} schemes`);
  for (const r of hit.slice(0, 3)) console.log(`     ${r.name}`);
}

// ═══════════════════════════════════════════════════════════════
rule("E. THE UNCONFIDENT — schemes the floor REFUSED to group (honest singletons)");
console.log(`  ${unconfident.length} refused. Sample:`);
for (const u of unconfident.slice(0, 15)) console.log(`    [${u.code}] "${u.name}"  → ${u.reason}`);

// ═══════════════════════════════════════════════════════════════
rule("F. EYEBALL SAMPLE — 15 real derived families (the thing to approve or reject)");
for (const f of grouped.slice(0, 15)) {
  console.log(`\n  ●  ${f.house} :: "${f.key}"   [${f.codes.length} scheme codes]`);
  f.codes.forEach((c, i) => console.log(`       ${c}  ${f.names[i]}`));
}

// ═══════════════════════════════════════════════════════════════
rule("G. BASELINE FINGERPRINT — must be byte-identical after the build (family is ADDITIVE)");
console.log(J(await q(`
  SELECT COUNT(*) AS mf_rows, COUNT(DISTINCT isin) AS isins, COUNT(DISTINCT amfi_scheme_code) AS codes,
         md5(string_agg(isin || '|' || COALESCE(amfi_scheme_code,'') || '|' || COALESCE(scheme_name,'')
             || '|' || COALESCE(current_nav::text,''), '~' ORDER BY isin)) AS fingerprint
  FROM instruments WHERE asset_class='mutual_fund'
`)));
console.log(J(await q(`SELECT COUNT(*) AS analytics_rows, md5(string_agg(scheme_code,'~' ORDER BY scheme_code)) AS fp FROM mf_analytics`)));

await prisma.$disconnect();
