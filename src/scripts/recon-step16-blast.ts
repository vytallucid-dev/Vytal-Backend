// ─────────────────────────────────────────────────────────────────────────────
// THE EXACT BLAST RADIUS, MEASURED ON THE STORED FOLD OUTPUT — not on a simulation.
//
// The signature of the Bonus defect is unmistakable and needs no name-matching to find:
//
//     a plan with a LIVE NAV SERIES (nav_points > 0) that reports NO RETURN AT ALL,
//     while a LIVE GROWTH PLAN sits in its own family and tier with a real return.
//
// That combination cannot arise honestly. The fold only NULLs a plan's metrics by inheriting them
// from a twin, so a live plan holding NULL means it inherited from a DEAD twin — and the only dead
// plans masquerading as Growth are the Bonus ones ("Growth Plan + Bonus Option" matches /growth/).
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
  JOIN mf_analytics ma ON ma.scheme_code = m.scheme_code
  WHERE f.asset_class = 'mutual_fund'`);

const byFam = new Map<string, M[]>();
for (const m of members) {
  const l = byFam.get(m.family_id) ?? [];
  l.push(m);
  byFam.set(m.family_id, l);
}

const srcOf = (m: M) => (m.plan_option ?? m.scheme_name).toLowerCase();
const tierOf = (m: M) => classifyPlanOption(m.plan_option ?? m.scheme_name).tier;
const isBonus = (m: M) => /\bbonus\b/.test(srcOf(m));
const trueGrowth = (m: M) => /growth/.test(srcOf(m)) && !isBonus(m);
const live = (m: M) => (m.nav_points ?? 0) > 0;
const hasRet = (m: M) => m.ret_1y !== null || m.ret_3y !== null;

const victims: M[] = [];
const fams = new Set<string>();

for (const [famId, ms] of byFam) {
  for (const m of ms) {
    if (!live(m) || hasRet(m)) continue; // must be LIVE and yet report NOTHING
    const tier = tierOf(m);
    const rescuer = ms.find((x) => tierOf(x) === tier && trueGrowth(x) && live(x) && hasRet(x));
    if (!rescuer) continue;              // no live Growth twin → its NULL is honest
    victims.push(m);
    fams.add(famId);
  }
}

console.log(`\n═══ LIVE PLANS REPORTING NOTHING, WITH A LIVE GROWTH TWIN BESIDE THEM ═══\n`);
console.log(`  ${victims.length} plan(s) across ${fams.size} family/families.\n`);

victims.sort((a, b) => a.scheme_code.localeCompare(b.scheme_code));
for (const v of victims) {
  const tier = tierOf(v);
  const r = (byFam.get(v.family_id) ?? []).find(
    (x) => tierOf(x) === tier && trueGrowth(x) && live(x) && hasRet(x))!;
  console.log(`  ${v.scheme_code}  navpts=${String(v.nav_points).padStart(5)}  ret=NULL   "${v.scheme_name.slice(0, 56)}"`);
  console.log(`         its live Growth twin ${r.scheme_code} holds r1y=${r.ret_1y === null ? "NULL" : (r.ret_1y * 100).toFixed(2) + "%"}` +
    `  r3y=${r.ret_3y === null ? "NULL" : (r.ret_3y * 100).toFixed(2) + "%"}`);
}

// Are they ALL explained by a dead Bonus plan winning the slot?
let byBonus = 0;
for (const v of victims) {
  const tier = tierOf(v);
  const bonusInSlot = (byFam.get(v.family_id) ?? []).some(
    (x) => tierOf(x) === tier && isBonus(x) && /growth/.test(srcOf(x)) && !hasRet(x));
  if (bonusInSlot) byBonus++;
}
console.log(`\n  ⇒ ${byBonus} of ${victims.length} sit in a slot containing a DEAD Bonus plan that /growth/ matched.`);
console.log(`     That is the mechanism: the Bonus plan won the last-writer race and handed out its NULLs.`);

const houses = new Map<string, number>();
for (const v of victims) houses.set(v.fund_house, (houses.get(v.fund_house) ?? 0) + 1);
console.log(`\n  by fund house:`);
for (const [h, n] of [...houses.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(3)}  ${h}`);

await prisma.$disconnect();
