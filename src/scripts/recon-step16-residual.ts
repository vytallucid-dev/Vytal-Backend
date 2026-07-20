// ═══════════════════════════════════════════════════════════════
// STEP 16 — GATE 0, PROBE 7 (READ-ONLY). CLASSIFY THE RESIDUAL. No "90 unknowns" in the report.
//
// 90 buckets hold >1 family with the same plan-stripped key. Two utterly different things:
//   TRUE SPLIT      — one fund shattered by a plan word an exotic tail stranded. Each fragment
//                     therefore carries only ONE plan type (all-regular here, all-direct there).
//   DIFFERENT FUNDS — "DSP Savings Fund" vs "DSP Regular Savings Fund". Each is a COMPLETE fund:
//                     each family internally holds BOTH direct and regular members.
//
// plan_type (ingested from AMFI in Step 9, independent of the name text) is the discriminator.
// A family that is internally plan-complete is not a fragment of anything.
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { familyKey } from "./recon-step16-final.js";
const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const rule = (s: string) => console.log("\n" + "█".repeat(88) + "\n" + s + "\n" + "█".repeat(88));

const rows = await q(`
  SELECT DISTINCT amfi_scheme_code AS code, scheme_name AS name, fund_house AS house, plan_type AS plan
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL ORDER BY amfi_scheme_code`);

const fams = new Map<string, { house: string; key: string; m: any[] }>();
for (const r of rows) {
  const { key, reason } = familyKey(r.name);
  if (reason) continue;
  const id = `${r.house}||${key}`;
  const f = fams.get(id) ?? { house: r.house, key, m: [] as any[] };
  f.m.push(r); fams.set(id, f);
}

const stripPlan = (k: string) => k.split(" ").filter((w) => !["direct", "regular", "plan"].includes(w)).join(" ");
const buckets = new Map<string, any[]>();
for (const f of fams.values()) { const b = `${f.house}||${stripPlan(f.key)}`; const a = buckets.get(b) ?? []; a.push(f); buckets.set(b, a); }

const plansOf = (f: any) => new Set(f.m.map((m: any) => m.plan).filter(Boolean));
const susp = [...buckets.values()].filter((fs) => fs.length > 1 && fs.some((f: any) => /\b(direct|regular)\b/.test(f.key)));

const trueSplits: any[] = [], differentFunds: any[] = [];
for (const fs of susp) {
  // COMPLETE = a family that already holds both plan types (or is a legacy no-plan fund with >1
  // option). A bucket of complete families is a set of DIFFERENT FUNDS, not a shattered one.
  const allComplete = fs.every((f: any) => plansOf(f).size >= 2);
  (allComplete ? differentFunds : trueSplits).push(fs);
}

rule(`RESIDUAL CLASSIFIED — ${susp.length} suspicious buckets`);
console.log(`  TRUE SPLITS      : ${trueSplits.length} buckets  (${trueSplits.reduce((a, fs) => a + fs.reduce((x: number, f: any) => x + f.m.length, 0), 0)} scheme codes)`);
console.log(`  DIFFERENT FUNDS  : ${differentFunds.length} buckets  ← correctly separated, NO action\n`);

console.log("  ── DIFFERENT FUNDS (the trap: a positional plan-strip would MERGE these) ──");
for (const fs of differentFunds.slice(0, 6)) {
  console.log(`   · ${fs[0].house}`);
  for (const f of fs) console.log(`       "${f.key}" [${f.m.length}]  plans={${[...plansOf(f)].join(",")}}  ← complete fund`);
}

console.log("\n  ── TRUE SPLITS (one fund, shattered by an exotic legacy option token) ──");
const gaps = new Map<string, number>();
for (const fs of trueSplits) {
  for (const f of fs) {
    const after = f.key.split(/\b(?:direct|regular)\b/).pop()!.replace(/^\s*plan\s*/, "").trim();
    if (after) gaps.set(after, (gaps.get(after) ?? 0) + 1);
  }
}
for (const fs of trueSplits.slice(0, 10)) {
  console.log(`   ✗ ${fs[0].house}`);
  for (const f of fs) {
    console.log(`       "${f.key}" [${f.m.length}]  plans={${[...plansOf(f)].join(",") || "—"}}`);
    f.m.slice(0, 2).forEach((m: any) => console.log(`            ${m.code}  ${m.name}`));
  }
}
console.log("\n  ── the vocabulary gaps that STRAND the plan word (the triage list) ──");
for (const [g, n] of [...gaps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15))
  console.log(`     ${String(n).padStart(3)}  "${g}"`);

rule("ETF CHECK — run the SAME normalizer over the 337 ETFs. Do any two merge? (They must not.)");
const etf = await q(`SELECT amfi_scheme_code AS code, scheme_name AS name, fund_house AS house
                     FROM instruments WHERE asset_class='etf' ORDER BY amfi_scheme_code`);
const ef = new Map<string, any[]>();
for (const r of etf) {
  const { key, reason } = familyKey(r.name);
  if (reason) continue;
  const id = `${r.house}||${key}`;
  const a = ef.get(id) ?? []; a.push(r); ef.set(id, a);
}
const merged = [...ef.entries()].filter(([, a]) => a.length > 1);
console.log(`  ETF rows: ${etf.length}   ETF families: ${ef.size}   families with >1 ETF: ${merged.length}`);
for (const [id, a] of merged.slice(0, 8)) {
  console.log(`   ⚠ "${id.split("||")[1]}"`);
  a.forEach((r: any) => console.log(`        ${r.code}  ${r.name}`));
}
if (!merged.length) console.log("  ✓ every ETF is its own singleton family — 1 scheme = 1 fund, as predicted.");

await prisma.$disconnect();
