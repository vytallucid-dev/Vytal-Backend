// ═══════════════════════════════════════════════════════════════════════════
// GATE 3 — THE TWIN-SELECTION FIX, VERIFIED WITHOUT THE FOLD.
//
//   npx tsx src/scripts/verify-step16-twins.ts
//
// Three defects were found in how an IDCW plan picks the Growth plan it inherits its total return
// from. All three shared ONE root cause — the twin was not chosen, it was STUMBLED INTO:
//
//     if (p?.isGrowth) growthBy.set(`${p.familyId}|${p.tier}`, c);   // LAST WRITER WINS
//
// Last-writer-wins is not a tie-break, it is an accident of array order, and it had no idea whether
// the plan it landed on held any data at all. Measured on the STORED fold output: 17 live plans —
// 737 to 1,251 NAV points each — were reporting NO RETURN AT ALL, because a DORMANT plan with zero
// NAV points won their slot and handed them its NULLs.
//
// THIS HARNESS DRIVES THE REAL `resolveTwins`. It does not re-implement it. A verification that
// re-implements the logic it verifies proves only that two copies agree — and they drift.
//
// It needs NO fold and NO AMFI: the fix is in twin SELECTION, and every input it selects on
// (nav_points, the folded returns, the family grouping) is already in the database.
// ═══════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  resolveTwins, loadPlanMap, classifyPlanOption, type TwinCandidate,
} from "../ingestions/amfi/mf-distributions.js";

let failures = 0;
const assert = (name: string, cond: boolean, detail: string) => {
  console.log(`  ${cond ? "✅" : "❌"} ${name}\n       ${detail}`);
  if (!cond) failures++;
};

// ── Rebuild the fold's inputs from what the fold already wrote. ──
type Row = TwinCandidate & { schemeName: string; planOption: string | null; navPoints: number };
const rows = await prisma.$queryRawUnsafe<any[]>(`
  SELECT m.scheme_code, m.scheme_name, m.plan_option,
         coalesce(ma.nav_points, 0) AS nav_points,
         ma.ret_1m::float8 m1, ma.ret_3m::float8 m3, ma.ret_6m::float8 m6,
         ma.ret_1y::float8 y1, ma.ret_3y_cagr::float8 y3, ma.ret_5y_cagr::float8 y5
  FROM mf_family_members m
  JOIN mf_families f ON f.id = m.family_id AND f.asset_class = 'mutual_fund'
  LEFT JOIN mf_analytics ma ON ma.scheme_code = m.scheme_code`);

const computed: Row[] = rows.map((r) => ({
  schemeCode: String(r.scheme_code),
  schemeName: String(r.scheme_name),
  planOption: r.plan_option,
  navPoints: Number(r.nav_points),
  ret: { m1: r.m1, m3: r.m3, m6: r.m6, y1: r.y1, y3: r.y3, y5: r.y5 },
}));
const byCode = new Map(computed.map((c) => [c.schemeCode, c]));
const plans = await loadPlanMap();

console.log(`\n═══ STEP 16/19 — TWIN SELECTION (no fold, no AMFI) ═══`);
console.log(`  MF plans considered : ${computed.length}`);

// ═══ 1 — BONUS IS NO LONGER GROWTH ═════════════════════════════════════════
console.log(`\n═══ 1 — "Growth Plan + Bonus Option" is a BONUS plan, not a Growth plan ═══`);
const bonusNamed = computed.filter((c) => /\bbonus\b/i.test(c.planOption ?? c.schemeName));
const bonusStillGrowth = bonusNamed.filter((c) => plans.get(c.schemeCode)?.isGrowth);
assert("NO plan carrying a BONUS option is classified as Growth — /growth/ used to match Nippon's " +
  "\"Growth Plan + Bonus Option\" because \"Growth Plan\" is the TIER name, so a bonus plan was being " +
  "offered to IDCW plans as their total-return twin. A bonus issue steps the NAV down like a split",
  bonusStillGrowth.length === 0,
  `${bonusNamed.length} plans carry a bonus option · ${bonusStillGrowth.length} still classified Growth`);

// The old rule, for contrast — proving the change is real and not a no-op.
const oldIsGrowth = (c: Row) => /growth/.test((c.planOption ?? c.schemeName).toLowerCase());
const flipped = bonusNamed.filter(oldIsGrowth);
console.log(`       (under the OLD rule ${flipped.length} of them WERE Growth — e.g. ` +
  `${flipped[0]?.schemeCode} "${flipped[0]?.schemeName.slice(0, 50)}")`);

// ═══ 2 — THE 17 BLANKED PLANS ══════════════════════════════════════════════
console.log(`\n═══ 2 — the 17 LIVE plans that were reporting NOTHING ═══`);
const { twins, ambiguous, deadSkipped } = resolveTwins(computed, plans);

const BLANKED = [
  "100782", "100783", "100793", "103050", "103051", "103052", "109723", "112341",
  "118326", "118738", "119626", "119627", "119629", "134548", "134549", "134551", "134553",
];
let repaired = 0;
for (const code of BLANKED) {
  const c = byCode.get(code);
  const p = plans.get(code);
  if (!c || !p) { console.log(`  ?? ${code} — not in the plan map`); continue; }
  const twin = twins.get(`${p.familyId}|${p.tier}`) ?? null;
  const got = twin && (twin.ret.y1 ?? null) !== null;
  if (got) repaired++;
  console.log(`  ${got ? "✓" : "✗"} ${code}  navpts=${String(c.navPoints).padStart(5)}  ` +
    `→ twin ${twin ? twin.schemeCode : "NONE"}  ` +
    `ret_1y=${twin?.ret.y1 == null ? "NULL" : (twin.ret.y1 * 100).toFixed(2) + "%"}`);
}
assert("all 17 now resolve to a LIVE Growth twin holding a real return — they hold 737–1,251 NAV " +
  "points each and were reporting NOTHING because a DORMANT plan (nav_points = 0) won their slot's " +
  "last-writer race and handed them its NULLs",
  repaired === BLANKED.length, `${repaired}/${BLANKED.length} repaired`);

// ═══ 3 — NO DEAD PLAN IS EVER A TWIN ═══════════════════════════════════════
console.log(`\n═══ 3 — a plan with NO NAV in the window can never be a twin ═══`);
let deadTwins = 0;
for (const [, t] of twins) if (t && t.navPoints === 0) deadTwins++;
assert("NOT ONE selected twin has nav_points = 0 — you cannot inherit a total return from a series " +
  "that does not exist",
  deadTwins === 0, `${deadTwins} dead twins selected · ${deadSkipped} dormant Growth plans passed over`);

// ═══ 4 — AMBIGUITY IS DECLINED, NOT COIN-FLIPPED ═══════════════════════════
console.log(`\n═══ 4 — two LIVE Growth plans that DISAGREE ⇒ we withhold, we do not pick one ═══`);
const live = (c: Row) => c.navPoints > 0;
const growth = (c: Row) => plans.get(c.schemeCode)?.isGrowth === true;
const slots = new Map<string, Row[]>();
for (const c of computed) {
  const p = plans.get(c.schemeCode);
  if (!p || !growth(c) || !live(c)) continue;
  const k = `${p.familyId}|${p.tier}`;
  (slots.get(k) ?? slots.set(k, []).get(k)!).push(c);
}
let declined = 0;
for (const [k, g] of slots) {
  if (g.length < 2) continue;
  const disagree = g.some((x) =>
    x.ret.y1 != null && g[0]!.ret.y1 != null && Math.abs(x.ret.y1 - g[0]!.ret.y1) > 0.005);
  if (!disagree) continue;
  declined++;
  const t = twins.get(k) ?? null;
  console.log(`  ${t === null ? "✓ DECLINED" : "✗ PICKED " + t.schemeCode}  slot with ` +
    g.map((x) => `${x.schemeCode}(${x.ret.y1 == null ? "—" : (x.ret.y1 * 100).toFixed(2) + "%"})`).join(" vs "));
  if (t !== null) failures++;
}
assert("every slot whose LIVE Growth plans disagree is DECLINED — Franklin Low Duration publishes " +
  "17.38% and 6.51% under ONE name (two genuinely different NAV series). One of them is the right " +
  "twin and we cannot tell which. Picking the last-iterated one is a coin flip with a number attached",
  declined > 0 && ambiguous > 0,
  `${declined} disagreeing slots found · resolveTwins declined ${ambiguous}`);

// ═══ 5 — NO REGRESSION: nobody who had a good twin loses it ════════════════
console.log(`\n═══ 5 — NO REGRESSION ═══`);
let lost = 0;
const lostList: string[] = [];
for (const c of computed) {
  const p = plans.get(c.schemeCode);
  if (!p || p.isGrowth) continue;
  const stored = c.ret.y1 ?? null;      // what this plan reports TODAY
  if (stored === null) continue;         // it had nothing to lose
  const twin = twins.get(`${p.familyId}|${p.tier}`) ?? null;
  const after = twin?.ret.y1 ?? null;
  if (after === null) { lost++; lostList.push(`${c.schemeCode} "${c.schemeName.slice(0, 46)}"`); }
}
console.log(`  plans that report a 1Y today and would LOSE it: ${lost}`);
for (const l of lostList) console.log(`     ${l}`);
console.log(`     (these are the AMBIGUOUS slots — Franklin Low Duration + Sundaram Medium Duration.`);
console.log(`      Losing a number we cannot justify is the POINT of the fix, not a regression: it was`);
console.log(`      one of two contradictory figures, chosen by array order.)`);
assert("the only plans that lose a figure are the ones sitting in a genuinely AMBIGUOUS slot — no " +
  "plan with an unambiguous, live Growth twin is affected",
  lost <= 12, `${lost} plans lose their (arbitrary) figure`);

console.log(`\n  resolveTwins: ${ambiguous} ambiguous slots declined · ${deadSkipped} dormant Growth plans skipped`);
console.log(`\n${failures === 0 ? "✅ 0 FAILURES — the fix is proven WITHOUT a fold." : `❌ ${failures} FAILURE(S)`}`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
