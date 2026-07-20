// ═══════════════════════════════════════════════════════════════
// STEP 16 — GATE 0b (READ-ONLY). THE CORRECTED NORMALIZER + THE FULL PROOF SET.
//
// Probes 1-4 found three defects in the draft. This is the fix, re-measured:
//
//   D1 SPLIT (fatal, fixed) — "Payout of IDCW" was not in the vocabulary (only the long
//        "Payout of Income Distribution cum..." legalese was). The strip halted on the orphaned
//        "of", stranding the PLAN word inside the key:
//            "…The 30s Plan-Direct Growth"          → "…retirement fund - the 30s"
//            "…The 30s Plan-Direct - Payout of IDCW" → "…the 30s plan - direct - payout of"
//        One fund, two families, split by plan — the exact failure the brief forbids.
//        FIX: "payout of" / "reinvestment of" / "re-investment of" are strippable phrases.
//        QA METRIC (section B): after a correct strip, NO key may still contain a plan word.
//        A key containing "direct"/"regular" IS a split. Target = 0.
//
//   D2 IDENTITY-EATEN (fixed) — "Unclaimed Redemption and Dividend Plan" is a SCHEME NAME; the
//        stripper ate "Dividend" out of its middle, so "…Unclaimed Dividend" and "…Unclaimed"
//        became the same key. Unclaimed-amount schemes are NOT plan variants of the parent fund.
//        FIX: any name containing "unclaimed" → UNCONFIDENT → honest singleton, logged.
//
//   D3 BONUS (ruled: strip) — all 189 "Bonus" schemes are the Bonus OPTION; the 12 that are not
//        followed by "Option/Plan" are "Plan - Bonus" / "Monthly Bonus" — still the option. NOT
//        ONE fund is named "…Bonus Fund". So Bonus is never identity → safe to strip.
//
//   PLUS the vocabulary the exhaustive tail census surfaced that no one would have guessed:
//        "div" (abbrev), "flexi"/"maturity"/"periodic" cadences, "payout & reinvestment",
//        "cumulative" (a Growth synonym), "idcws" (typo).
//
// NO FUZZY MATCHING — EVER. The near-miss probe found 8,705 key pairs within edit-distance 2 of
// each other inside a single house. At d=1, "govenment"/"government" (SAME fund, AMFI typo) is
// textually indistinguishable from "the 30s"/"the 40s" and "sdl sep 2025"/"sep 2027" (DIFFERENT
// funds); at d=2, "low duration"/"long duration" (DIFFERENT funds). No threshold separates them.
// So the key is EXACT. The typo-split is the price, and it is the cheap one.
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));

// ─────────────────────────────────────────────────────────────────────────────
const NOISE_PAREN = /\((?:\s*(?:formerly|erstwhile|earlier)\b[^)]*)\)?/gi;

const TAIL_PHRASES: string[] = [
  // ── the IDCW legalese, longest first ──
  "reinvestment of income distribution cum capital withdrawal option",
  "payout of income distribution cum capital withdrawal option",
  "income distribution cum capital withdrawal option",
  "reinvestment of income distribution cum capital withdrawal",
  "payout of income distribution cum capital withdrawal",
  "income distribution cum capital withdrawal",
  // ── the payout/reinvest PREFIX — D1, the split fix ──
  "payout & reinvestment", "payout / reinvestment", "payout and reinvestment",
  "payout of", "reinvestment of", "re-investment of", "re - investment of",
  // ── IDCW + its synonyms/abbrevs/typos ──
  "idcw payout option", "idcw reinvestment option", "idcw payout", "idcw reinvestment",
  "idcw option", "idcw plan", "idcws option", "idcws", "idcw",
  "dividend payout option", "dividend reinvestment option", "dividend payout",
  "dividend reinvestment", "dividend option", "dividend plan", "dividend",
  "div payout option", "div reinvestment option", "div option", "div plan", "div",
  // ── growth + its synonyms ──
  "growth option", "growth plan", "growth",
  "cumulative option", "cumulative plan", "cumulative",
  "bonus option", "bonus plan", "bonus",
  // ── bare payout/reinvest ──
  "payout option", "reinvestment option", "reinvest option",
  "payout", "reinvestment", "re-investment", "reinvest",
  // ── plan ──
  "direct plan", "regular plan", "direct", "regular",
  // ── cadence (an IDCW frequency is NEVER an identity) ──
  "daily", "weekly", "fortnightly", "monthly", "quarterly", "half yearly", "halfyearly",
  "half-yearly", "annual", "annually", "yearly", "flexi", "maturity", "periodic",
  // ── bare structural leftovers ──
  "option", "plan",
];

// Tail words that CHANGE WHICH FUND THIS IS. Stripping a plan-CLASS token (institutional/retail/
// eco) would not merely rename the family — it would collide two schemes onto ONE plan+option slot
// (ABSL Global Excellence has "Retail Plan - Direct Plan - Growth" AND a plain Direct Growth). The
// collision detector is what proves this: retaining them is what KEEPS the slots unique.
const IDENTITY_TAIL = new Set([
  "segregated", "portfolio", "institutional", "retail", "eco", "series", "unclaimed",
]);

const clean = (s: string) =>
  s.replace(NOISE_PAREN, " ")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9&+.\-/ ]+/g, " ")
    .replace(/\//g, " / ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();

type Key = { key: string; slot: string; reason?: string };
function familyKey(schemeName: string): Key {
  // D2 — an unclaimed-amount scheme is NOT a plan variant of its parent fund.
  if (/\bunclaimed\b/i.test(schemeName))
    return { key: "", slot: "", reason: "unclaimed-amount scheme — not a plan variant of the parent fund" };

  let words = clean(schemeName).split(" ").filter(Boolean);
  const stripped: string[] = [];
  for (let g = 0; g < 40; g++) {
    if (words.length && (words[words.length - 1] === "-" || words[words.length - 1] === "/")) { words.pop(); continue; }
    const last = words[words.length - 1];
    if (last && IDENTITY_TAIL.has(last)) break;              // never strip past an identity word
    let hit = "";
    for (const p of TAIL_PHRASES) {
      const pw = p.split(" ");
      if (pw.length > words.length) continue;
      if (words.slice(words.length - pw.length).join(" ") === p) { hit = p; break; }
    }
    if (!hit) break;                                          // STOP-AT-FIRST-UNKNOWN
    words = words.slice(0, words.length - hit.split(" ").length);
    stripped.unshift(hit);
  }
  while (words.length && ["-", "&", "/", "+"].includes(words[words.length - 1])) words.pop();

  const key = words.join(" ");
  const meaningful = words.filter((w) => w.length > 1 && w !== "-");
  if (meaningful.length < 2) return { key, slot: stripped.join(" + "), reason: "key eaten to <2 words — refuse to group" };
  if (key.length < 6) return { key, slot: stripped.join(" + "), reason: "key eaten to <6 chars — refuse to group" };
  return { key, slot: stripped.join(" + ") };
}

// ═══════════════════════════════════════════════════════════════
const rows = await q(`
  SELECT DISTINCT amfi_scheme_code AS code, scheme_name AS name, fund_house AS house
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL ORDER BY amfi_scheme_code`);

type M = { code: string; name: string; slot: string };
const fams = new Map<string, { house: string; key: string; m: M[] }>();
const singles: { code: string; name: string; reason: string }[] = [];
for (const r of rows) {
  const { key, slot, reason } = familyKey(r.name);
  if (reason) { singles.push({ code: r.code, name: r.name, reason }); continue; }
  const id = `${r.house}||${key}`;
  const f = fams.get(id) ?? { house: r.house, key, m: [] as M[] };
  f.m.push({ code: r.code, name: r.name, slot });
  fams.set(id, f);
}

rule("A. THE GROUPING");
const multi = [...fams.values()].filter((f) => f.m.length > 1);
const solo = [...fams.values()].filter((f) => f.m.length === 1);
console.log(`  scheme codes in         : ${rows.length}`);
console.log(`  families derived        : ${fams.size + singles.length}`);
console.log(`  ├─ multi-scheme families: ${multi.length}   (grouping ${multi.reduce((a, f) => a + f.m.length, 0)} codes)`);
console.log(`  ├─ singleton (1 variant): ${solo.length}`);
console.log(`  └─ singleton (REFUSED)  : ${singles.length}   ← honest-empty, never force-merged`);
const cov = multi.reduce((a, f) => a + f.m.length, 0);
console.log(`\n  confidently grouped     : ${cov} / ${rows.length}  (${((cov / rows.length) * 100).toFixed(1)}%)`);
const sizes = new Map<number, number>();
for (const f of fams.values()) sizes.set(f.m.length, (sizes.get(f.m.length) ?? 0) + 1);
console.log("\n  family size → count");
for (const s of [...sizes.keys()].sort((a, b) => a - b)) console.log(`   ${String(s).padStart(3)} → ${sizes.get(s)}`);

rule("B. THE SPLIT DETECTOR (D1) — a key still containing a PLAN word means one fund, two families");
const splitKeys = [...fams.values()].filter((f) => /\b(direct|regular)\b/.test(f.key));
console.log(`  families whose KEY still contains "direct"/"regular": ${splitKeys.length}   ← MUST BE 0`);
for (const f of splitKeys.slice(0, 10)) { console.log(`  ✗ ${f.house} :: "${f.key}"`); f.m.forEach((m) => console.log(`       ${m.code} ${m.name}`)); }

rule("C. THE COLLISION DETECTOR — two codes claiming ONE plan+option slot (over-merge or AMFI dup)");
let coll = 0; const collSamp: string[] = [];
for (const f of fams.values()) {
  const by = new Map<string, M[]>();
  for (const m of f.m) { const a = by.get(m.slot) ?? []; a.push(m); by.set(m.slot, a); }
  for (const [slot, ms] of by) if (ms.length > 1) {
    coll++;
    if (collSamp.length < 6) collSamp.push(`  · ${f.house} :: "${f.key}"  slot=[${slot || "(none)"}]\n` +
      ms.map((m) => `        ${m.code}  ${m.name}`).join("\n"));
  }
}
console.log(`  colliding slots: ${coll}`);
collSamp.forEach((s) => console.log(s));

rule("D. THE CEILING — a fund has at most (Growth+Bonus+~8 IDCW cadences) × (Direct+Regular)");
const srt = [...fams.values()].sort((a, b) => b.m.length - a.m.length);
console.log(`  largest family: ${srt[0].m.length} codes   ·  families >20: ${srt.filter((f) => f.m.length > 20).length}`);
for (const f of srt.slice(0, 3)) console.log(`   [${f.m.length}] ${f.house} :: "${f.key}"`);

rule("E. THE NON-MERGE PROOF — things that MUST stay apart");
const K = (k: string) => [...fams.values()].find((f) => f.key === k);
const MUST_DIFFER: [string, string][] = [
  ["aditya birla sun life low duration fund", "aditya birla sun life long duration fund"],
  ["aditya birla sun life retirement fund - the 30s", "aditya birla sun life retirement fund - the 40s"],
  ["aditya birla sun life nifty sdl sep 2025 index fund", "aditya birla sun life nifty sdl sep 2027 index fund"],
  ["mirae asset large cap fund", "mirae asset large & midcap fund"],
  ["icici prudential nifty 50 index fund", "icici prudential nifty 500 index fund"],
  ["dsp fmp series - 264 - 60m - 17d", "dsp fmp series - 267 - 1172 days"],
];
for (const [a, b] of MUST_DIFFER) {
  const fa = K(a), fb = K(b);
  console.log(`  ${fa && fb && a !== b ? "✓ SEPARATE" : "? "}  "${a}" [${fa?.m.length ?? 0}]  ×  "${b}" [${fb?.m.length ?? 0}]`);
}
const fmp = [...fams.values()].filter((f) => /\bfmp\b|fixed maturity|fixed term|\bseries\b|interval/.test(f.key));
console.log(`\n  series/FMP/interval families: ${fmp.length}  ·  any with >8 codes (cross-series merge): ${fmp.filter((f) => f.m.length > 8).length}`);

rule("F. SPOT-CHECK — India's biggest funds. Do their known variants land in ONE family?");
for (const name of ["hdfc large cap fund", "sbi large cap fund", "axis large cap fund",
                    "hdfc flexi cap fund", "sbi small cap fund", "parag parikh flexi cap fund",
                    "hdfc balanced advantage fund", "nippon india small cap fund"]) {
  const f = [...fams.values()].find((x) => x.key === name);
  if (!f) { console.log(`\n  ✗ "${name}" — NOT FOUND`); continue; }
  console.log(`\n  ● ${f.house} :: "${f.key}"  [${f.m.length} scheme codes]`);
  f.m.forEach((m) => console.log(`      ${m.code}  ${m.name}\n              slot: ${m.slot || "(none)"}`));
}

rule("G. THE HONEST SINGLETONS — what we REFUSED to group, and why");
const byReason = new Map<string, number>();
for (const s of singles) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
for (const [r, n] of byReason) console.log(`  ${String(n).padStart(4)}  ${r}`);
console.log("\n  sample:");
for (const s of singles.slice(0, 8)) console.log(`    [${s.code}] ${s.name}`);
console.log(`\n  ── KNOWN, ACCEPTED LIMITATION: a source typo splits one fund into two families ──`);
for (const k of ["aditya birla sun life govenment securities fund", "aditya birla sun life government securities fund"]) {
  const f = K(k); if (f) console.log(`    [${f.m.length}] "${f.key}"`);
}
console.log(`    ↑ SAME fund. AMFI misspells it on 2 of 4 codes. We do NOT fuzzy-merge (see header).`);

rule("H. BASELINE FINGERPRINT — must be byte-identical after Gate 2 (family is ADDITIVE)");
console.log(J(await q(`
  SELECT COUNT(*) AS mf_rows, COUNT(DISTINCT amfi_scheme_code) AS codes,
         md5(string_agg(isin||'|'||COALESCE(amfi_scheme_code,'')||'|'||COALESCE(scheme_name,'')||'|'||
             COALESCE(current_nav::text,'')||'|'||COALESCE(nav_date::text,''), '~' ORDER BY isin)) AS fingerprint
  FROM instruments WHERE asset_class='mutual_fund'`)));
console.log(J(await q(`SELECT COUNT(*) AS analytics_rows,
  md5(string_agg(scheme_code||'|'||COALESCE(ret_1y::text,''), '~' ORDER BY scheme_code)) AS fingerprint FROM mf_analytics`)));

await prisma.$disconnect();
