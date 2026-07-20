// STEP 10+11 (Option B) GATE 0 — READ-ONLY. The actual ranking buckets, sized.
// npx tsx src/scripts/recon-step10b-buckets.ts
import { prisma } from "../db/prisma.js";

const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);

// The proposed ranking bucket: (normalised leaf category, plan_type), OPEN-ENDED + ACTIVE only.
const rows = await prisma.$queryRawUnsafe<any[]>(`
  SELECT DISTINCT ON (amfi_scheme_code) amfi_scheme_code AS code, category, plan_type, is_active
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL`);

const leafOf = (c: string) => {
  const m = /\(([^)]*)\)/.exec(c);
  let l = m ? m[1]! : c;
  return l.replace(/^(Debt Scheme|Equity Scheme|Hybrid Scheme|Other Scheme|Solution Oriented Scheme|Income\/Debt Oriented Schemes|Growth\/Equity Oriented Schemes|Hybrid Schemes|Solution Oriented Schemes)\s*-\s*/i, "").trim();
};
const openEnded = (c: string) => !/^Close Ended|^Interval/i.test(c);

hdr("THE RANKABLE SET — open-ended + active");
const rankable = rows.filter((r) => openEnded(r.category) && r.is_active);
console.log(`  all scheme codes            : ${rows.length}`);
console.log(`  open-ended                 : ${rows.filter((r) => openEnded(r.category)).length}`);
console.log(`  open-ended AND active      : ${rankable.length}   ← the rankable set`);
const nullPlan = rankable.filter((r) => !r.plan_type).length;
console.log(`  …of which plan_type is NULL: ${nullPlan} (${((nullPlan / rankable.length) * 100).toFixed(1)}%)`);

hdr("BUCKET A — rank within (leaf category, plan_type)");
const a = new Map<string, number>();
for (const r of rankable) {
  if (!r.plan_type) continue;
  const k = `${leafOf(r.category)} | ${r.plan_type}`;
  a.set(k, (a.get(k) ?? 0) + 1);
}
const av = [...a.values()];
console.log(`  buckets: ${a.size}   schemes covered: ${av.reduce((x, y) => x + y, 0)}`);
console.log(`  bucket size: min=${Math.min(...av)} median=${av.sort((x, y) => x - y)[Math.floor(av.length / 2)]} max=${Math.max(...av)}`);
console.log(`  buckets with <5 schemes: ${av.filter((n) => n < 5).length}  → honest-empty their percentile`);
console.log(`  ⚠️  ${nullPlan} rankable schemes have NULL plan_type → they get NO bucket here.`);

hdr("BUCKET B — rank within leaf category only (plan-agnostic)");
const b = new Map<string, number>();
for (const r of rankable) { const k = leafOf(r.category); b.set(k, (b.get(k) ?? 0) + 1); }
const bv = [...b.values()];
console.log(`  buckets: ${b.size}   schemes covered: ${bv.reduce((x, y) => x + y, 0)} (ALL of them)`);
console.log(`  bucket size: min=${Math.min(...bv)} median=${bv.sort((x, y) => x - y)[Math.floor(bv.length / 2)]} max=${Math.max(...bv)}`);
console.log(`  buckets with <5 schemes: ${bv.filter((n) => n < 5).length}`);
console.log(`  ⚠️  mixes Direct + Regular plans of the SAME fund. Direct out-returns Regular by the`);
console.log(`     expense gap (~0.5–1.5 %/yr), so Direct plans systematically outrank their own twins.`);
console.log(`     The percentile would partly encode PLAN CHOICE, not fund quality.`);

hdr("THE TOP RANKABLE BUCKETS (option A)");
for (const [k, n] of [...a.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10)) {
  console.log(`  ${String(n).padStart(4)}  ${k}`);
}

hdr("RESULTS-TABLE SIZE — what actually persists");
const N = rows.length; // one row per scheme code, incl. dormant (they still get analytics)
// ~30 numeric metrics + ~8 rank/percentile + a few dates/flags.
const perRow = 30 * 9 + 8 * 5 + 40 + 24 + 60; // numerics + ranks + dates/flags + heap hdr + text keys
console.log(`  one row per scheme code: ${N.toLocaleString()}`);
console.log(`  ~30 metrics + ~8 percentiles + asOf/flags ≈ ${perRow} B/row`);
console.log(`  heap ≈ ${((N * perRow) / 1e6).toFixed(1)} MB   + PK/index ≈ 1 MB   ⇒ ~${((N * perRow) / 1e6 + 1).toFixed(0)} MB total`);
console.log(`  current DB 386 MB + ~${((N * perRow) / 1e6 + 1).toFixed(0)} MB ⇒ still ~${(500 - 386 - (N * perRow) / 1e6 - 1).toFixed(0)} MB under the 500 MB ceiling ✅`);
console.log(`  ⇒ SINGLE-DIGIT MB. The whole point of Option B holds.`);

await prisma.$disconnect();
