// ─────────────────────────────────────────────────────────────────────────────
// STEP 16 — SIMULATE THE CANDIDATE FIXES BEFORE BUILDING ANY OF THEM (GATE 0, READ-ONLY).
//
// Two candidate fixes fell out of the recon. They are NOT equal, and the simulation is what says so.
//
//   FIX-1  BONUS IS AN OPTION, NOT GROWTH.  `isGrowth` is /growth/ over the whole token string, and
//          Nippon names the TIER "Growth Plan" and the OPTION "Bonus Option" — so "growth plan +
//          bonus option" matches, and a BONUS plan is handed to IDCW plans as their total-return
//          twin. A bonus issue steps the NAV down like a split, and most Bonus plans have NO folded
//          return at all — so the IDCW plans inherit NULLs where a real Growth twin sat beside them.
//          Candidate: isGrowth = /growth/ AND NOT /bonus/.
//
//   FIX-2  PRESERVE "PLAN A" IN THE TOKENIZER.  Superficially symmetrical (Plan B..Z already
//          survive; only "A" is eaten, because "a" is a CONNECTOR). But a fix must not WRONGLY SPLIT
//          a correct family, and most "Plan A" families are ONE fund whose IDCW plans AMFI happens
//          to label "Plan A" while labelling its Growth plan plainly. Splitting those strands the
//          Growth plan and honest-NULLs IDCW plans that are correct TODAY.
//
// This script counts, on real data, what each fix REPAIRS and what it BREAKS.
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

const src = (m: M) => (m.plan_option ?? m.scheme_name).toLowerCase();
const tierOf = (m: M) => classifyPlanOption(m.plan_option ?? m.scheme_name).tier;
const growthNow = (m: M) => /growth/.test(src(m));                       // TODAY
const growthFix = (m: M) => /growth/.test(src(m)) && !/\bbonus\b/.test(src(m)); // FIX-1
const isPlanA = (m: M) => /\bplan\s*[-–]?\s*a\b/i.test(m.scheme_name);
const has = (m: M) => m.ret_1y !== null || m.ret_3y !== null;

// ══ FIX-1 — BONUS IS NOT GROWTH ════════════════════════════════════════════
console.log(`\n═══ FIX-1 — "Bonus" is an OPTION, not Growth ═══`);

const pick = (isG: (m: M) => boolean) => {
  const g = new Map<string, M>();
  for (const m of members) if (isG(m)) g.set(`${m.family_id}|${tierOf(m)}`, m); // last-writer-wins, as the fold does
  return g;
};
const twinNow = pick(growthNow), twinFix = pick(growthFix);

let repaired = 0, nowNull = 0, stillNull = 0, unchanged = 0, bonusRepaired = 0;
const examples: string[] = [];

for (const m of members) {
  const tier = tierOf(m);
  const k = `${m.family_id}|${tier}`;

  // Every plan that is NOT a Growth plan under the FIXED rule takes a twin — including the BONUS
  // plans themselves, which under the fix stop pretending to be total-return series and inherit the
  // real Growth plan's figures (same fund, same tier, same portfolio — its NAV IS the total return).
  const wasG = growthNow(m), isG = growthFix(m);
  if (isG) continue;                       // a true Growth plan — untouched by either rule

  const before = wasG ? m : (twinNow.get(k) ?? null); // what it reported TODAY
  const after = twinFix.get(k) ?? null;               // what it would report under FIX-1

  const bHas = before !== null && has(before);
  const aHas = after !== null && has(after);

  if (wasG && !isG) bonusRepaired++;       // a BONUS plan, previously folded from its own stepped NAV

  if (!bHas && aHas) {
    repaired++;
    if (examples.length < 8 && after) {
      examples.push(`    ${m.scheme_code} "${m.scheme_name.slice(0, 62)}"\n` +
        `        was: ${before ? `${before.scheme_code} (${before.ret_1y === null ? "NULL" : (before.ret_1y * 100).toFixed(2) + "%"})` : "no twin"}` +
        `   →  now: ${after.scheme_code} (${(after.ret_1y! * 100).toFixed(2)}%)`);
    }
  } else if (bHas && !aHas) nowNull++;
  else if (!bHas && !aHas) stillNull++;
  else unchanged++;
}

console.log(`  plans whose twin GAINS a real number (was NULL/absent → now real) : ${repaired}   ← REPAIRED`);
console.log(`  plans whose twin LOSES a real number (was real → now NULL)        : ${nowNull}   ← would be a REGRESSION`);
console.log(`  BONUS plans that stop being treated as a total-return series      : ${bonusRepaired}`);
console.log(`  unchanged                                                          : ${unchanged}`);
if (examples.length) {
  console.log(`\n  examples of the repair:`);
  for (const e of examples) console.log(e);
}

// Does FIX-1 also collapse the >1-Growth ambiguity?
const slots = (isG: (m: M) => boolean) => {
  let n = 0;
  for (const [, ms] of byFam)
    for (const t of ["direct", "regular", "none"])
      if (ms.filter((m) => tierOf(m) === t && isG(m)).length > 1) n++;
  return n;
};
console.log(`\n  (family, tier) slots holding >1 "Growth":  ${slots(growthNow)} today  →  ${slots(growthFix)} under FIX-1`);

// ══ FIX-2 — PRESERVE "PLAN A" ══════════════════════════════════════════════
console.log(`\n═══ FIX-2 — preserve "Plan A" in the tokenizer ═══`);

let fixes = 0, breaks = 0;
const breakList: string[] = [], fixList: string[] = [];

for (const [, ms] of byFam) {
  const planA = ms.filter(isPlanA);
  if (!planA.length || planA.length === ms.length) continue; // pure families do not split at all

  // A MIXED family. Preserving "Plan A" splits it into {Plan A} and {base}. Who loses a twin?
  for (const t of ["direct", "regular", "none"]) {
    const aG = planA.filter((m) => tierOf(m) === t && growthFix(m));
    const bG = ms.filter((m) => !isPlanA(m) && tierOf(m) === t && growthFix(m));
    const aI = planA.filter((m) => tierOf(m) === t && !growthFix(m));

    if (aI.length === 0) continue;
    if (aG.length > 0 && bG.length > 0) {
      // Both classes have their own Growth → the split is a REAL repair.
      fixes += aI.length;
      fixList.push(`    ✔ ${ms[0]!.family_key} [${t}] — ${aI.length} Plan-A IDCW plan(s) stop borrowing the BASE fund's return`);
    } else if (aG.length === 0 && bG.length > 0) {
      // Plan A has NO Growth of its own → after the split its IDCW plans have NO twin → honest-NULL.
      breaks += aI.length;
      const live = aI.filter(has).length;
      breakList.push(`    ✘ ${ms[0]!.family_key} [${t}] — ${aI.length} Plan-A IDCW plan(s) LOSE their twin` +
        ` (${live} of them report a real number TODAY) → honest-NULL`);
    }
  }
}
console.log(`  IDCW plans REPAIRED by preserving "Plan A" : ${fixes}`);
console.log(`  IDCW plans BROKEN   by preserving "Plan A" : ${breaks}   ← currently correct, would go honest-NULL`);
if (fixList.length) { console.log(`\n  repairs:`); for (const l of fixList) console.log(l); }
if (breakList.length) { console.log(`\n  breakage:`); for (const l of breakList) console.log(l); }

// ══ THE DUPLICATE-CODE FAMILIES ════════════════════════════════════════════
console.log(`\n═══ DUPLICATE SCHEME CODES — two Growth plans, same name, DIFFERENT returns ═══`);
for (const [, ms] of byFam) {
  for (const t of ["direct", "regular", "none"]) {
    const g = ms.filter((m) => tierOf(m) === t && growthFix(m));
    if (g.length < 2) continue;
    const withRet = g.filter(has);
    if (withRet.length < 2) continue;
    const diverge = withRet.some((x) => Math.abs((x.ret_1y ?? 0) - (withRet[0]!.ret_1y ?? 0)) > 0.005);
    if (!diverge) continue;
    console.log(`\n  house=${ms[0]!.fund_house}  key="${ms[0]!.family_key}"  tier=${t}`);
    for (const x of g) {
      console.log(`    ${x.scheme_code}  r1y=${x.ret_1y === null ? "NULL" : (x.ret_1y * 100).toFixed(2) + "%"}` +
        `  r3y=${x.ret_3y === null ? "NULL" : (x.ret_3y * 100).toFixed(2) + "%"}` +
        `  navpts=${String(x.nav_points ?? "—").padStart(5)}  "${x.scheme_name}"`);
    }
  }
}

await prisma.$disconnect();
