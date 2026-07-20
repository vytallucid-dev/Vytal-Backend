// ═══════════════════════════════════════════════════════════════
// STEP 16 — GATE 0 FINAL (READ-ONLY). The normalizer I propose to build, and the proof set.
//
// ── THE ONE RULE THAT MATTERS ────────────────────────────────────────────────────────────────
// PUNCTUATION IS NEVER IDENTITY. WORDS ALWAYS ARE.
// Everything below follows from it, and the two temptations it forbids are the two that would
// have destroyed the grouping:
//
//   TEMPTATION 1 — "fuzzy-match near-identical keys." FORBIDDEN.
//     8,705 key pairs sit within edit-distance 2 inside a single house. At d=1, "govenment"/
//     "government" (SAME fund — an AMFI typo) is textually INDISTINGUISHABLE from "the 30s"/
//     "the 40s" and "sdl sep 2025"/"sep 2027" (DIFFERENT funds). At d=2, "low duration"/"long
//     duration" (DIFFERENT funds). No threshold separates them. So: EXACT KEY, always. The typo
//     splitting one fund into two families is the price — and it is the cheap one.
//
//   TEMPTATION 2 — "strip the plan word wherever it appears." FORBIDDEN, and this one is subtle.
//     "Regular" is BOTH a plan marker AND a fund-name word:
//         ICICI Prudential SAVINGS Fund  [14 codes]  ≠  ICICI Prudential REGULAR SAVINGS Fund [10]
//         DSP  SAVINGS Fund              [ 9 codes]  ≠  DSP  REGULAR SAVINGS Fund             [ 6]
//     (money-market funds vs conservative hybrids — genuinely different funds, one word apart.)
//     A positional strip merges them. So plan words are stripped ONLY from the TAIL, where they
//     are structurally an annotation, never from the middle, where they are a name.
//
// ── THE MECHANISM ────────────────────────────────────────────────────────────────────────────
// Tail-strip, STOP-AT-FIRST-UNKNOWN. The fund identity is the HEAD; plan/option tokens are the
// TAIL. Repeatedly remove a KNOWN plan/option phrase from the end; the instant the tail is a word
// we don't know, HALT and keep everything left. The guard is therefore STRUCTURAL, not a blocklist:
// unrecognised trailing text is IDENTITY BY DEFAULT. FMP series numbers survive not because a rule
// protects them, but because "264" is not in the vocabulary and the walk stops there.
//
// Writes NOTHING. This is the artifact Gate 2 will promote to src/ingestions/amfi/mf-family.ts.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));

// "(formerly known as X)" embeds ANOTHER fund's name mid-string. A blind paren-strip would delete
// real identity like "(93 Days)", so we remove ONLY parentheticals that announce themselves.
const NOISE_PAREN = /\((?:\s*(?:formerly|erstwhile|earlier)\b[^)]*)\)?/gi;
// NOTE — there is deliberately NO "strip (Regular)/(Direct) parentheticals" rule. It looks right
// and is WRONG: for JM's entire book the parenthetical IS the plan marker ("JM Large Cap Fund
// (Regular) - IDCW"), so deleting it collapses Direct and Regular onto ONE slot — 86 collisions,
// up from 15. Punctuation-collapse already turns "(Regular)" into a bare tail word that the
// stripper removes in the right order, preserving the plan in the slot. Measured, not assumed.

const TAIL_PHRASES: string[] = [
  "reinvestment of income distribution cum capital withdrawal option",
  "payout of income distribution cum capital withdrawal option",
  "income distribution cum capital withdrawal option",
  "reinvestment of income distribution cum capital withdrawal",
  "payout of income distribution cum capital withdrawal",
  "income distribution cum capital withdrawal",
  "payout and reinvestment", "payout of", "reinvestment of", "re investment of",
  "idcw payout option", "idcw reinvestment option", "idcw payout", "idcw reinvestment",
  "idcw option", "idcw plan", "idcws option", "idcws", "idcw",
  "dividend payout option", "dividend reinvestment option", "dividend payout",
  "dividend reinvestment", "dividend option", "dividend plan", "dividend",
  "div payout option", "div reinvestment option", "div option", "div plan", "div",
  "growth option", "growth plan", "growth",
  "cumulative option", "cumulative plan", "cumulative",
  "bonus option", "bonus plan", "bonus",
  "payout option", "reinvestment option", "reinvest option",
  "payout", "reinvestment", "re investment", "reinvest",
  "direct plan", "regular plan", "direct", "regular",
  "daily", "weekly", "fortnightly", "monthly", "quarterly", "half yearly", "halfyearly",
  "annual", "annually", "yearly", "flexi", "maturity", "periodic",
  "option", "plan",
];

// Tail words that CHANGE WHICH FUND THIS IS. Stripping a plan-CLASS token (institutional/retail/
// eco) would not merely rename a family — it would collide two schemes onto ONE plan+option slot
// (ABSL Global Excellence publishes "Retail Plan - Direct Plan - Growth" AND a plain Direct
// Growth). Retaining them is what keeps the slots unique — the collision detector proves it.
const IDENTITY_TAIL = new Set([
  "segregated", "portfolio", "institutional", "retail", "eco", "series", "unclaimed",
]);

// Grammatical glue. Never the last word of a fund's name, so popping one from the tail cannot
// destroy identity — the same argument that licenses collapsing punctuation.
const CONNECTORS = new Set(["and", "of", "the", "cum", "with", "a", "an"]);

/** Punctuation is never identity: collapse it all to whitespace. "&" becomes the WORD "and" —
 *  never a space — because "Large & Mid Cap" must not collapse onto a real "Large Mid Cap". */
const clean = (s: string) =>
  s.replace(NOISE_PAREN, " ")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type FamilyKey = { key: string; slot: string; reason?: string };
export function familyKey(schemeName: string): FamilyKey {
  // An unclaimed-amount scheme is a SEPARATE scheme, not a plan variant of the parent fund — and
  // its name ("Unclaimed Redemption and Dividend Plan") contains option words as IDENTITY, which
  // the stripper would eat. Refuse it outright: honest singleton.
  if (/\bunclaimed\b/i.test(schemeName))
    return { key: "", slot: "", reason: "unclaimed-amount scheme — not a plan variant" };

  let words = clean(schemeName).split(" ").filter(Boolean);
  const stripped: string[] = [];
  for (let g = 0; g < 40; g++) {
    const last = words[words.length - 1];
    // A fund name NEVER ends in a connector. Kotak publishes "IDCW - Payout & Re-investment of
    // Income Distribution cum capital withdrawal option": once the legalese is stripped the tail
    // is a dangling "and", which halts the walk and STRANDS the plan word — splitting the fund.
    // Popping a trailing connector is as safe as popping punctuation, and for the same reason.
    if (last && CONNECTORS.has(last)) { words.pop(); continue; }
    if (last && IDENTITY_TAIL.has(last)) break;      // never strip past an identity word
    let hit = "";
    for (const p of TAIL_PHRASES) {                  // authored longest-first
      const pw = p.split(" ");
      if (pw.length > words.length) continue;
      if (words.slice(words.length - pw.length).join(" ") === p) { hit = p; break; }
    }
    if (!hit) break;                                 // ── STOP-AT-FIRST-UNKNOWN ──
    words = words.slice(0, words.length - hit.split(" ").length);
    stripped.unshift(hit);
  }

  const key = words.join(" ");
  if (words.filter((w) => w.length > 1).length < 2) return { key, slot: stripped.join(" + "), reason: "key eaten to <2 words" };
  if (key.length < 6) return { key, slot: stripped.join(" + "), reason: "key eaten to <6 chars" };
  return { key, slot: stripped.join(" + ") };
}

// ═══════════════════════════════════════════════════════════════
const rows = await q(`
  SELECT DISTINCT amfi_scheme_code AS code, scheme_name AS name, fund_house AS house
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL ORDER BY amfi_scheme_code`);

type M = { code: string; name: string; slot: string };
const fams = new Map<string, { house: string; key: string; m: M[] }>();
const refused: { code: string; name: string; reason: string }[] = [];
for (const r of rows) {
  const { key, slot, reason } = familyKey(r.name);
  if (reason) { refused.push({ code: r.code, name: r.name, reason }); continue; }
  const id = `${r.house}||${key}`;
  const f = fams.get(id) ?? { house: r.house, key, m: [] as M[] };
  f.m.push({ code: r.code, name: r.name, slot }); fams.set(id, f);
}

rule("A. THE GROUPING");
const multi = [...fams.values()].filter((f) => f.m.length > 1);
const solo = [...fams.values()].filter((f) => f.m.length === 1);
const cov = multi.reduce((a, f) => a + f.m.length, 0);
console.log(`  scheme codes in          : ${rows.length}`);
console.log(`  families derived         : ${fams.size + refused.length}`);
console.log(`  ├─ multi-scheme families : ${multi.length}  → grouping ${cov} codes`);
console.log(`  ├─ singleton (1 variant) : ${solo.length}`);
console.log(`  └─ singleton (REFUSED)   : ${refused.length}  ← honest-empty, logged, never force-merged`);
console.log(`\n  CONFIDENTLY GROUPED      : ${cov} / ${rows.length}  (${((cov / rows.length) * 100).toFixed(1)}%)`);
const sizes = new Map<number, number>();
for (const f of fams.values()) sizes.set(f.m.length, (sizes.get(f.m.length) ?? 0) + 1);
console.log("\n  family size → count   (the spike at 4 = Direct/Regular × Growth/IDCW, the modern fund)");
for (const s of [...sizes.keys()].sort((a, b) => a - b)) console.log(`   ${String(s).padStart(3)} → ${sizes.get(s)}`);

rule("B. COLLISION — two scheme codes claiming ONE plan+option slot inside a family");
console.log("  A real fund has exactly ONE 'Direct + Growth'. A collision = over-merge OR AMFI dup.\n");
let coll = 0, collCodes = 0; const cs: string[] = [];
for (const f of fams.values()) {
  const by = new Map<string, M[]>();
  for (const m of f.m) { const a = by.get(m.slot) ?? []; a.push(m); by.set(m.slot, a); }
  for (const [slot, ms] of by) if (ms.length > 1) {
    coll++; collCodes += ms.length;
    if (cs.length < 4) cs.push(`  · ${f.house} :: "${f.key}" slot=[${slot || "(none)"}]\n` + ms.map((m) => `      ${m.code} ${m.name}`).join("\n"));
  }
}
console.log(`  colliding slots: ${coll}  (${collCodes} codes)`);
cs.forEach((s) => console.log(s));

rule("C. CEILING — max = (Growth + Bonus + ~8 IDCW cadences) × (Direct + Regular)");
const srt = [...fams.values()].sort((a, b) => b.m.length - a.m.length);
console.log(`  largest family : ${srt[0].m.length} codes    families >20 : ${srt.filter((f) => f.m.length > 20).length}`);
srt.slice(0, 3).forEach((f) => console.log(`   [${f.m.length}] ${f.house} :: "${f.key}"`));

rule("D. NON-MERGE PROOF — the funds that MUST stay apart");
const K = (k: string) => [...fams.values()].find((f) => f.key === k);
for (const [a, b] of [
  ["icici prudential savings fund", "icici prudential regular savings fund"],
  ["dsp savings fund", "dsp regular savings fund"],
  ["aditya birla sun life low duration fund", "aditya birla sun life long duration fund"],
  ["aditya birla sun life retirement fund the 30s", "aditya birla sun life retirement fund the 40s"],
  ["aditya birla sun life nifty sdl sep 2025 index fund", "aditya birla sun life nifty sdl sep 2027 index fund"],
  ["mirae asset large cap fund", "mirae asset large and midcap fund"],
  ["icici prudential nifty 50 index fund", "icici prudential nifty 500 index fund"],
  ["dsp fmp series 264 60m 17d", "dsp fmp series 267 1172 days"],
] as [string, string][]) {
  const fa = K(a), fb = K(b);
  console.log(`  ${fa && fb ? "✓ SEPARATE" : "· (one absent)"}  "${a}" [${fa?.m.length ?? 0}]   ×   "${b}" [${fb?.m.length ?? 0}]`);
}
const ser = [...fams.values()].filter((f) => /\bfmp\b|fixed maturity|fixed term|\bseries\b|interval/.test(f.key));
console.log(`\n  series/FMP/interval families: ${ser.length}   ·   any with >8 codes (cross-series merge): ${ser.filter((f) => f.m.length > 8).length}`);

rule("E. RESIDUAL SPLITS — plan word still stranded in a key (fund shattered across families)");
const stripPlan = (k: string) => k.split(" ").filter((w) => !["direct", "regular", "plan"].includes(w)).join(" ");
const buckets = new Map<string, any[]>();
for (const f of fams.values()) { const b = `${f.house}||${stripPlan(f.key)}`; const a = buckets.get(b) ?? []; a.push(f); buckets.set(b, a); }
const susp = [...buckets.values()].filter((fs) => fs.length > 1 && fs.some((f: any) => /\b(direct|regular)\b/.test(f.key)));
console.log(`  suspicious buckets: ${susp.length}   (NB: some are genuinely DIFFERENT funds — "Savings" vs "Regular Savings")\n`);
for (const fs of susp.slice(0, 8)) {
  console.log(`  ── ${fs[0].house}`);
  for (const f of fs) { console.log(`      "${f.key}" [${f.m.length}]`); f.m.slice(0, 2).forEach((m: any) => console.log(`          ${m.code} ${m.name}`)); }
}

rule("F. SPOT-CHECK — India's biggest funds. Do their known variants land in ONE family?");
for (const n of ["hdfc large cap fund", "sbi large cap fund", "axis large cap fund", "hdfc flexi cap fund",
                 "sbi small cap fund", "parag parikh flexi cap fund", "hdfc balanced advantage fund",
                 "uti flexi cap fund", "aditya birla sun life liquid fund"]) {
  const f = K(n);
  if (!f) { console.log(`\n  ✗ "${n}" NOT FOUND`); continue; }
  console.log(`\n  ● ${f.house} :: "${f.key}"  [${f.m.length} codes]`);
  f.m.forEach((m) => console.log(`      ${m.code}  ${m.name}`));
}

rule("G. HONEST SINGLETONS — what we REFUSED to group");
const br = new Map<string, number>();
for (const s of refused) br.set(s.reason, (br.get(s.reason) ?? 0) + 1);
for (const [r, n] of br) console.log(`  ${String(n).padStart(4)}  ${r}`);
refused.slice(0, 5).forEach((s) => console.log(`     [${s.code}] ${s.name}`));
console.log("\n  ── ACCEPTED LIMITATION: an AMFI TYPO splits one fund into two families ──");
for (const k of ["aditya birla sun life govenment securities fund", "aditya birla sun life government securities fund"]) {
  const f = K(k); if (f) console.log(`     [${f.m.length}] "${f.key}"`);
}
console.log("     ↑ the SAME fund. We do NOT fuzzy-merge — see the header. An honest split beats a wrong merge.");

rule("H. BASELINE FINGERPRINT — must be byte-identical after Gate 2 (family is purely ADDITIVE)");
console.log(J(await q(`
  SELECT COUNT(*) AS mf_rows, COUNT(DISTINCT amfi_scheme_code) AS codes,
    md5(string_agg(isin||'|'||COALESCE(amfi_scheme_code,'')||'|'||COALESCE(scheme_name,'')||'|'||
        COALESCE(current_nav::text,'')||'|'||COALESCE(nav_date::text,''),'~' ORDER BY isin)) AS fingerprint
  FROM instruments WHERE asset_class='mutual_fund'`)));
console.log(J(await q(`SELECT COUNT(*) AS analytics_rows,
  md5(string_agg(scheme_code||'|'||COALESCE(ret_1y::text,''),'~' ORDER BY scheme_code)) AS fingerprint FROM mf_analytics`)));
console.log(J(await q(`SELECT COUNT(*) AS etf_rows FROM instruments WHERE asset_class='etf'`)));

await prisma.$disconnect();
