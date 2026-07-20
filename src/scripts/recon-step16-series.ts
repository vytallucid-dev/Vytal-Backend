// ═══════════════════════════════════════════════════════════════
// STEP 16 — GATE 0, PROBE 6 (READ-ONLY). THE ONE UNEXPLAINED SIGNAL.
//
// The final recon reports 42 series/FMP/interval families holding >8 scheme codes. A cross-series
// merge (Series 264 swallowing Series 267) is THE catastrophic failure this whole step is built to
// prevent — so this is not a number to wave through. Two possibilities:
//     (a) benign — an INTERVAL fund legitimately has many IDCW cadences (like a liquid fund), or
//     (b) fatal  — the normalizer ate a series discriminator and merged different funds.
// Only looking at the raw names can tell them apart.
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { familyKey } from "./recon-step16-final.js";
const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));

const rows = await q(`
  SELECT DISTINCT amfi_scheme_code AS code, scheme_name AS name, fund_house AS house
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL ORDER BY amfi_scheme_code`);

const fams = new Map<string, { house: string; key: string; m: any[] }>();
for (const r of rows) {
  const { key, reason } = familyKey(r.name);
  if (reason) continue;
  const id = `${r.house}||${key}`;
  const f = fams.get(id) ?? { house: r.house, key, m: [] as any[] };
  f.m.push(r); fams.set(id, f);
}

const ser = [...fams.values()].filter((f) => /\bfmp\b|fixed maturity|fixed term|\bseries\b|interval/.test(f.key));
const big = ser.filter((f) => f.m.length > 8).sort((a, b) => b.m.length - a.m.length);

rule(`THE 42 — series-bearing families with >8 codes. Benign cadence spread, or a CROSS-SERIES MERGE?`);
console.log(`  series/FMP/interval families : ${ser.length}`);
console.log(`  with >8 codes               : ${big.length}\n`);

// THE TEST: inside one family, do all members carry the SAME series discriminator? Pull every
// number/roman-numeral token out of each raw name. If a family holds TWO different series tokens,
// it merged across series — fatal. If every member shares one, the size is just cadence spread.
const discr = (n: string) =>
  (n.toLowerCase().match(/\b(?:series\s+)?([0-9]+[a-z]?|[ivxl]+)\b/g) ?? [])
    .map((s) => s.replace(/^series\s+/, ""))
    .filter((s) => !/^(?:plan|option|growth)$/.test(s));

let fatal = 0;
for (const f of big) {
  // the discriminator set implied by the KEY (what survived normalization) is shared by all members
  // by construction; the real question is whether the RAW names disagree on any series token that
  // the key does NOT carry.
  const keyTokens = new Set(discr(f.key));
  const extra = new Set<string>();
  for (const m of f.m) for (const t of discr(m.name)) if (!keyTokens.has(t)) extra.add(t);
  const bad = extra.size > 0;
  if (bad) fatal++;
  console.log(`  ${bad ? "⚠" : "✓"} [${String(f.m.length).padStart(2)}] ${f.house} :: "${f.key}"`);
  if (bad) {
    console.log(`        key tokens: {${[...keyTokens].join(", ")}}   EXTRA in member names: {${[...extra].join(", ")}}`);
    f.m.slice(0, 6).forEach((m: any) => console.log(`         ${m.code}  ${m.name}`));
  }
}
console.log(`\n  families whose members disagree on a series token NOT in the key: ${fatal}`);
console.log(`  (0 ⇒ every big family is one fund with many cadences. >0 ⇒ a cross-series merge.)`);

rule("SANITY — the top 3 big families, in full. Eyeball: is each ONE fund?");
for (const f of big.slice(0, 3)) {
  console.log(`\n  ● [${f.m.length}] ${f.house} :: "${f.key}"`);
  f.m.forEach((m: any) => console.log(`      ${m.code}  ${m.name}`));
}

await prisma.$disconnect();
