// ─────────────────────────────────────────────────────────────────────────────
// STEP 16 — ADJUDICATE THE "PLAN A" FAMILIES (GATE 0, READ-ONLY).
//
// The tokenizer eats "Plan A" — "plan" is a TAIL_PHRASE and "a" is a CONNECTOR — so a Plan-A share
// class collapses into the base fund. "Plan B" survives, because "b" is not a connector. That
// asymmetry is what makes this a HOLE rather than a rule.
//
// But a collapsed Plan A is only a BUG where Plan A is a REAL, SEPARATE SHARE CLASS. AMFI also
// simply spells one fund's IDCW plans "…Fund - Plan A - Monthly - IDCW" and its Growth plan
// "…Fund - Growth", with no Plan A anywhere else — one fund, inconsistent naming. Merging THOSE is
// correct, and "fixing" it would split one fund in half.
//
// THE DISCRIMINATOR IS THE DATA, NOT THE NAME: does a "Plan A — GROWTH" plan actually EXIST in this
// family? If it does, two share classes coexist and the Plan-A IDCW plans are inheriting the wrong
// series. If it does not, there is only one share class and the merge is right.
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

const byFam = new Map<string, M[]>();
for (const m of members) {
  const l = byFam.get(m.family_id) ?? [];
  l.push(m);
  byFam.set(m.family_id, l);
}

const info = (m: M) => classifyPlanOption(m.plan_option ?? m.scheme_name);
/** "Plan A" — the marker the tokenizer swallows. Only the letter A: B..Z already survive the walk. */
const isPlanA = (m: M) => /\bplan\s*[-–]?\s*a\b/i.test(m.scheme_name);

console.log(`\n═══ FAMILIES CONTAINING A "PLAN A" MEMBER ═══`);
console.log(`  (the tokenizer collapsed the Plan-A marker; is Plan A a REAL separate share class here?)\n`);

let realSplit = 0, namingOnly = 0;
const realSplitFams: string[] = [];

for (const [famId, ms] of byFam) {
  const planA = ms.filter(isPlanA);
  if (!planA.length) continue;

  const planAGrowth = planA.filter((m) => info(m).isGrowth);
  const baseGrowth = ms.filter((m) => !isPlanA(m) && info(m).isGrowth);
  const planAIdcw = planA.filter((m) => !info(m).isGrowth);

  // TWO SHARE CLASSES coexist only if BOTH a Plan-A Growth and a non-Plan-A Growth exist.
  const twoClasses = planAGrowth.length > 0 && baseGrowth.length > 0;
  if (twoClasses) { realSplit++; realSplitFams.push(famId); } else { namingOnly++; }

  console.log(`  ${twoClasses
    ? "⚠️  REAL SHARE-CLASS SPLIT — a Plan-A Growth AND a base Growth both exist"
    : "✓  NAMING ONLY — no Plan-A Growth exists; one share class; the merge is CORRECT"}`);
  console.log(`     house=${ms[0]!.fund_house}   key="${ms[0]!.family_key}"`);
  console.log(`     plan-A growth: ${planAGrowth.length} · base growth: ${baseGrowth.length} · plan-A idcw: ${planAIdcw.length}`);
  for (const m of ms) {
    const p = info(m);
    const tag = isPlanA(m) ? "PLAN-A" : "  base";
    const kind = p.isGrowth ? "GROWTH" : "idcw  ";
    console.log(`       ${tag} ${kind} ${m.scheme_code} ${p.tier.padEnd(7)}` +
      ` r1y=${m.ret_1y === null ? "  NULL" : ((m.ret_1y * 100).toFixed(2) + "%").padStart(7)}` +
      ` r3y=${m.ret_3y === null ? "  NULL" : ((m.ret_3y * 100).toFixed(2) + "%").padStart(7)}` +
      `  navpts=${String(m.nav_points ?? "—").padStart(5)}  "${m.scheme_name}"`);
  }
  console.log("");
}

console.log(`═══ VERDICT ═══`);
console.log(`  ⚠️  REAL share-class splits (Plan A is a distinct fund) : ${realSplit}`);
console.log(`  ✓  naming-only (one fund; the merge is correct)         : ${namingOnly}`);
console.log(`\n  ⇒ ONLY the ${realSplit} real ones need the tokenizer fix. "Fixing" the other ${namingOnly}`);
console.log(`    would SPLIT one fund in half and strand its Growth plan — the exact damage this step exists to avoid.`);

await prisma.$disconnect();
