// ─────────────────────────────────────────────────────────────────────────────
// STEP 16/19 — THE BONUS-TWIN DEFECT, SIZED BY VALUE (GATE 0, READ-ONLY).
//
// The earlier simulation counted only NULL→real transitions (14). That UNDERSTATES the defect: where
// a Bonus plan HAS a folded return, that return comes from its own NAV series — which a bonus issue
// steps DOWN exactly like a split. So an IDCW plan inheriting it gets a real-looking number that is
// simply the WRONG one. This script measures the VALUE delta, not just the null delta.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { classifyPlanOption } from "../ingestions/amfi/mf-distributions.js";

type M = {
  family_id: string; family_key: string; fund_house: string;
  scheme_code: string; scheme_name: string; plan_option: string | null;
  ret_1y: number | null; ret_3y: number | null; nav_points: number | null;
};

const members = await prisma.$queryRawUnsafe<M[]>(`
  SELECT m.family_id, f.family_key, f.fund_house,
         m.scheme_code, m.scheme_name, m.plan_option,
         ma.ret_1y::float8 AS ret_1y, ma.ret_3y_cagr::float8 AS ret_3y, ma.nav_points
  FROM mf_family_members m
  JOIN mf_families f ON f.id = m.family_id
  LEFT JOIN mf_analytics ma ON ma.scheme_code = m.scheme_code
  WHERE f.asset_class = 'mutual_fund'
  ORDER BY m.family_id, m.scheme_code`);

const srcOf = (m: M) => (m.plan_option ?? m.scheme_name).toLowerCase();
const tierOf = (m: M) => classifyPlanOption(m.plan_option ?? m.scheme_name).tier;
const growthNow = (m: M) => /growth/.test(srcOf(m));
const growthFix = (m: M) => /growth/.test(srcOf(m)) && !/\bbonus\b/.test(srcOf(m));

const pick = (isG: (m: M) => boolean) => {
  const g = new Map<string, M>();
  for (const m of members) if (isG(m)) g.set(`${m.family_id}|${tierOf(m)}`, m); // last-writer-wins
  return g;
};
const twinNow = pick(growthNow), twinFix = pick(growthFix);

const pc = (v: number | null) => (v === null ? "NULL" : (v * 100).toFixed(2) + "%");

console.log(`\n═══ THE BONUS TWIN — WHAT DOES IT ACTUALLY HAND OUT? ═══\n`);

let nullToReal = 0, valueChanged = 0, sameValue = 0, stillNull = 0;
let maxDelta = 0; let worst = "";
const rows: string[] = [];

for (const m of members) {
  if (growthFix(m)) continue; // a true Growth plan — folds from its own (correct) NAV
  const k = `${m.family_id}|${tierOf(m)}`;
  const before = growthNow(m) ? m : twinNow.get(k) ?? null; // today's source of its numbers
  const after = twinFix.get(k) ?? null;                     // under FIX-1
  if (!before || !after || before.scheme_code === after.scheme_code) { sameValue++; continue; }

  const bNull = before.ret_1y === null && before.ret_3y === null;
  const aNull = after.ret_1y === null && after.ret_3y === null;

  if (bNull && aNull) { stillNull++; continue; }
  if (bNull && !aNull) { nullToReal++; }
  else {
    // BOTH have numbers, and they come from DIFFERENT series. How far apart are they?
    const d1 = before.ret_1y !== null && after.ret_1y !== null ? Math.abs(before.ret_1y - after.ret_1y) : 0;
    const d3 = before.ret_3y !== null && after.ret_3y !== null ? Math.abs(before.ret_3y - after.ret_3y) : 0;
    const d = Math.max(d1, d3);
    if (d < 0.0001) { sameValue++; continue; }
    valueChanged++;
    if (d > maxDelta) { maxDelta = d; worst = `${m.scheme_code} "${m.scheme_name.slice(0, 58)}"`; }
  }

  rows.push(
    `  ${m.scheme_code}  "${m.scheme_name.slice(0, 56)}"\n` +
    `      today  ← ${before.scheme_code} ${/\bbonus\b/.test(srcOf(before)) ? "[BONUS]" : "[growth]"}` +
    `  r1y=${pc(before.ret_1y)} r3y=${pc(before.ret_3y)}  navpts=${before.nav_points ?? "—"}\n` +
    `      FIX-1  ← ${after.scheme_code} [growth]  r1y=${pc(after.ret_1y)} r3y=${pc(after.ret_3y)}  navpts=${after.nav_points ?? "—"}`);
}

console.log(`  plans whose inherited figure CHANGES under FIX-1:`);
console.log(`    NULL → a real number      : ${nullToReal}`);
console.log(`    a real number → a DIFFERENT real number : ${valueChanged}   ← a wrong number is shipping TODAY`);
console.log(`    still NULL (both dead)    : ${stillNull}`);
console.log(`    unaffected                : ${sameValue}`);
console.log(`\n  worst single divergence: ${(maxDelta * 100).toFixed(2)}pp  on ${worst}\n`);

for (const r of rows.slice(0, 40)) console.log(r);
if (rows.length > 40) console.log(`\n  … and ${rows.length - 40} more`);

await prisma.$disconnect();
