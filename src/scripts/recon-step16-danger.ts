// ═══════════════════════════════════════════════════════════════
// STEP 16 — GATE 0, PROBE 3 (READ-ONLY). THE DANGER PROBE.
//
// The recon says the grouping looks good. This script tries to prove it WRONG. It hunts the four
// ways a name-derived family can lie:
//
//   1. COLLISION  — two schemes land in one family claiming the SAME plan+option slot. Either an
//                   AMFI duplicate, or two DIFFERENT funds we just merged. The sharpest over-merge
//                   detector available without a ground-truth key: a fund has ONE "Direct/Growth".
//   2. THE CEILING— a fund has at most (Growth + 7 IDCW cadences + Bonus) × (Direct + Regular).
//                   Any family above that ate identity.
//   3. NEAR-MISS  — family keys 1-2 edits apart inside ONE house. These are the split/merge
//                   boundary: "Govenment"/"Government" (same fund, AMFI typo → we SPLIT, honestly)
//                   vs "Top 100"/"Top 200" (different funds → we MUST split). We cannot tell them
//                   apart from text, and THAT is the whole argument for never fuzzy-matching.
//   4. IDENTITY EATEN — names where the stripper chewed a word out of the MIDDLE of a real scheme
//                   name ("Unclaimed *Dividend* Plan" → "dividend" is not an option there).
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));

const NOISE_PAREN = /\((?:\s*(?:formerly|erstwhile|earlier)\b[^)]*)\)/gi;
const TAIL_PHRASES: string[] = [
  "reinvestment of income distribution cum capital withdrawal option",
  "payout of income distribution cum capital withdrawal option",
  "income distribution cum capital withdrawal option",
  "reinvestment of income distribution cum capital withdrawal",
  "payout of income distribution cum capital withdrawal",
  "income distribution cum capital withdrawal",
  "idcw payout option", "idcw reinvestment option", "idcw payout", "idcw reinvestment",
  "idcw option", "idcw",
  "dividend payout option", "dividend reinvestment option", "dividend payout",
  "dividend reinvestment", "dividend option", "dividend",
  "growth option", "growth plan", "growth",
  "cumulative option", "cumulative",
  "payout option", "reinvestment option", "reinvest option",
  "payout", "reinvestment", "reinvest",
  "direct plan", "regular plan", "direct", "regular",
  "daily", "weekly", "fortnightly", "monthly", "quarterly", "half yearly", "halfyearly",
  "half-yearly", "annual", "annually", "yearly",
  "option", "plan",
];
const IDENTITY_TAIL = new Set(["segregated", "portfolio", "institutional", "retail", "unclaimed", "bonus", "series"]);
const clean = (s: string) =>
  s.replace(NOISE_PAREN, " ").toLowerCase().replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9&+.\-/ ]+/g, " ").replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ").trim();

function familyKey(schemeName: string) {
  let words = clean(schemeName).split(" ").filter(Boolean);
  const stripped: string[] = [];
  for (let g = 0; g < 40; g++) {
    if (words.length && words[words.length - 1] === "-") { words.pop(); continue; }
    const last = words[words.length - 1];
    if (last && IDENTITY_TAIL.has(last)) break;
    let hit = "";
    for (const p of TAIL_PHRASES) {
      const pw = p.split(" ");
      if (pw.length > words.length) continue;
      if (words.slice(words.length - pw.length).join(" ") === p) { hit = p; break; }
    }
    if (!hit) break;
    words = words.slice(0, words.length - hit.split(" ").length);
    stripped.unshift(hit);
  }
  while (words.length && (words[words.length - 1] === "-" || words[words.length - 1] === "&")) words.pop();
  return { key: words.join(" "), slot: stripped.join(" + ") };
}

const rows = await q(`
  SELECT DISTINCT amfi_scheme_code AS code, scheme_name AS name, fund_house AS house
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL ORDER BY amfi_scheme_code`);

type M = { code: string; name: string; slot: string };
const fams = new Map<string, { house: string; key: string; m: M[] }>();
for (const r of rows) {
  const { key, slot } = familyKey(r.name);
  const id = `${r.house}||${key}`;
  const f = fams.get(id) ?? { house: r.house, key, m: [] as M[] };
  f.m.push({ code: r.code, name: r.name, slot });
  fams.set(id, f);
}

// ═══ 1. COLLISION — two schemes, one plan+option slot ═════════════════════
rule("1. COLLISION TEST — do two scheme codes ever claim the SAME plan+option slot in one family?");
console.log("   A real fund has exactly ONE 'Direct Plan + Growth'. A collision means we merged\n" +
            "   two things that are not the same fund — OR AMFI genuinely lists a duplicate.\n");
let collisions = 0;
const collisionSamples: string[] = [];
for (const f of fams.values()) {
  const bySlot = new Map<string, M[]>();
  for (const m of f.m) { const a = bySlot.get(m.slot) ?? []; a.push(m); bySlot.set(m.slot, a); }
  for (const [slot, ms] of bySlot) {
    if (ms.length < 2) continue;
    collisions++;
    if (collisionSamples.length < 12)
      collisionSamples.push(`  ✗ ${f.house} :: "${f.key}"  slot=[${slot || "(none)"}]\n` +
        ms.map((m) => `        ${m.code}  ${m.name}`).join("\n"));
  }
}
console.log(`   COLLIDING SLOTS: ${collisions}\n`);
collisionSamples.forEach((s) => console.log(s));

// ═══ 2. THE CEILING ═══════════════════════════════════════════════════════
rule("2. CEILING TEST — max plausible family = (Growth+7 IDCW cadences+Bonus+Cumulative) × (Dir+Reg)");
const sorted = [...fams.values()].sort((a, b) => b.m.length - a.m.length);
console.log(`   largest family observed : ${sorted[0].m.length} codes`);
console.log(`   families > 16 codes     : ${sorted.filter((f) => f.m.length > 16).length}`);
console.log(`   families > 20 codes     : ${sorted.filter((f) => f.m.length > 20).length}`);
for (const f of sorted.filter((x) => x.m.length > 16).slice(0, 6)) {
  console.log(`\n   ⚠ [${f.m.length}] ${f.house} :: "${f.key}"`);
  f.m.forEach((m) => console.log(`        ${m.code}  ${m.name}`));
}

// ═══ 3. NEAR-MISS KEYS — the split/merge boundary ═════════════════════════
rule("3. NEAR-MISS KEYS — family keys 1-2 edits apart WITHIN one house. The judgment call.");
function lev(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}
const byHouse = new Map<string, string[]>();
for (const f of fams.values()) { const a = byHouse.get(f.house) ?? []; a.push(f.key); byHouse.set(f.house, a); }
let near = 0;
const nearSamples: string[] = [];
for (const [house, keys] of byHouse) {
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const d = lev(keys[i], keys[j], 2);
      if (d <= 2) {
        near++;
        if (nearSamples.length < 20) nearSamples.push(`   d=${d}  ${house}\n        "${keys[i]}"\n        "${keys[j]}"`);
      }
    }
}
console.log(`   near-miss key pairs (edit distance ≤2, same house): ${near}\n`);
nearSamples.forEach((s) => console.log(s));

// ═══ 4. IDENTITY EATEN — did the stripper chew a real word out of a name? ═
rule("4. IDENTITY-EATEN TEST — names where a REAL word got stripped as if it were an option");
console.log("   'Unclaimed Redemption and Dividend Plan' — 'Dividend' there is IDENTITY, not an option.\n");
for (const pat of ["unclaimed", "bonus"]) {
  const hit = rows.filter((r) => new RegExp(`\\b${pat}\\b`, "i").test(r.name));
  console.log(`   ── "${pat}" (${hit.length} schemes) → what key does each land on? ──`);
  const keys = new Map<string, number>();
  for (const r of hit) { const k = familyKey(r.name).key; keys.set(k, (keys.get(k) ?? 0) + 1); }
  for (const [k, n] of [...keys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`        [${n}] "${k}"`);
  for (const r of hit.slice(0, 4)) console.log(`        e.g. "${r.name}"\n             → key "${familyKey(r.name).key}"`);
  console.log("");
}
// Is any fund GENUINELY named with Bonus as identity (not "Bonus Option")?
const bonusIdentity = rows.filter((r) => /\bbonus\b/i.test(r.name) && !/bonus\s*(option|plan)\b/i.test(r.name));
console.log(`   schemes with "Bonus" NOT followed by Option/Plan (would block stripping it): ${bonusIdentity.length}`);
bonusIdentity.slice(0, 8).forEach((r) => console.log(`        ${r.name}`));

await prisma.$disconnect();
