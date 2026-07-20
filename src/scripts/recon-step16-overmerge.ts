// ─────────────────────────────────────────────────────────────────────────────
// STEP 16 — OVER-MERGE BLAST RADIUS (GATE 0, READ-ONLY. No AMFI, no fold, no writes.)
//
//   npx tsx src/scripts/recon-step16-overmerge.ts
//
// ⚠️  THE IDENTITY TEST CANNOT BE A NAME TEST, AND THE FIRST CUT OF THIS SCRIPT PROVED IT.
//
//     Within a family every member has the SAME key by construction — that is how they were
//     grouped — so any residue recomputed from the name normalises straight back to the key and
//     reports "same fund" for everything. That first attempt returned 0 over-merges (a false
//     NEGATIVE, it cannot see past the strip) and simultaneously flagged Franklin/Edelweiss/Tata as
//     impure because AMFI spells one fund "Banking & PSU" on two codes and "Banking and PSU" on two
//     others (a false POSITIVE — the tokenizer maps & → and ON PURPOSE, and that grouping is right).
//     A detector that is wrong in both directions cannot size a blast radius.
//
// SO THE IDENTITY TEST IS GROUND-TRUTH, NOT TEXTUAL: two Growth plans that are really the same fund
// hold the same portfolio at the same expense ratio, so they must post the SAME RETURN. If two
// Growth plans in one (family, tier) disagree materially on ret_3y/ret_1y, they are different funds
// and the family is over-merged. That reads the NAV history we already folded — it does not ask a
// regex what a fund is.
//
// The NAME is then used for one thing only, and only after the returns have spoken: to say WHICH
// SIGNAL the tokenizer discarded, so the fix can preserve exactly that and nothing more.
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

console.log(`\n═══ STEP 16 OVER-MERGE RECON (read-only — no AMFI, no fold, no writes) ═══`);
console.log(`  MF family members : ${members.length}`);

const byFam = new Map<string, M[]>();
for (const m of members) {
  const l = byFam.get(m.family_id) ?? [];
  l.push(m);
  byFam.set(m.family_id, l);
}
console.log(`  MF families       : ${byFam.size}`);

/** Exactly what the fold sees (mirrors loadPlanMap: normalised token first, raw name second). */
const info = (m: M) => classifyPlanOption(m.plan_option ?? m.scheme_name);

/** SAME FUND ⇒ SAME RETURN. Two Growth plans of one fund differ only by rounding. 0.5pp is far
 *  wider than any rounding and far narrower than any real fund-to-fund gap. NULL on either side =
 *  UNDECIDABLE (never silently "same"). */
const SAME_RET_TOL = 0.005; // 0.5 percentage points, on the fraction scale
type Verdict = "same" | "different" | "undecidable";
const sameFund = (a: M, b: M): Verdict => {
  const pairs: [number | null, number | null][] = [[a.ret_3y, b.ret_3y], [a.ret_1y, b.ret_1y]];
  let decided = false;
  for (const [x, y] of pairs) {
    if (x === null || y === null) continue;
    decided = true;
    if (Math.abs(x - y) > SAME_RET_TOL) return "different";
  }
  return decided ? "same" : "undecidable";
};

/** The SIGNAL THE TOKENIZER DISCARDED. Reported only to explain a verdict the RETURNS already gave.
 *  "Plan A" is eaten because "plan" is a TAIL_PHRASE and "a" is a CONNECTOR — note "Plan B" would
 *  survive, since "b" is not a connector. That asymmetry is the tell that this is a hole, not a rule. */
const shareClass = (name: string): string => {
  const bits: string[] = [];
  // "Plan A" / "Plan - I" / "Plan B". A single letter (or roman numeral) after "plan" IS the share
  // class. No lookahead: an earlier cut excluded a match followed by "- Growth", which rejected the
  // marker on exactly the GROWTH plans and left it on the IDCW ones — manufacturing a mismatch on
  // every correctly-grouped Plan-B family. The word "plan" followed by a real word ("Plan Bonus",
  // "Plan Growth") cannot match, because \b after a single letter forbids it.
  const pl = name.match(/\bplan\s*[-–]?\s*([a-z]|[iv]{1,3})\b/i);
  if (pl) bits.push(`plan ${pl[1]!.toUpperCase()}`);
  for (const w of ["retail", "institutional", "wholesale", "eco"]) {
    if (new RegExp(`\\b${w}\\b`, "i").test(name)) bits.push(w);
  }
  return bits.join("+");
};

/** Is this plan's OPTION actually BONUS? `isGrowth` is /growth/ over the whole token string, and
 *  Nippon names the TIER "Growth Plan" and the OPTION "Bonus Option" — so "growth plan + bonus
 *  option" matches /growth/ and a BONUS plan is offered as a total-return twin. A bonus issue steps
 *  the NAV down exactly like a split, so a Bonus NAV is no more a total-return series than an IDCW
 *  NAV is; and most Bonus plans have no folded return at all, so inheriting one hands an IDCW plan
 *  NULLs where its real Growth twin had a number. */
const isBonus = (m: M) => /\bbonus\b/.test((m.plan_option ?? m.scheme_name).toLowerCase());

// ── (A) (family, tier) SLOTS HOLDING >1 GROWTH PLAN ────────────────────────
console.log(`\n═══ (A) (family, tier) slots holding MORE THAN ONE "Growth" plan ═══`);
let benign = 0, over = 0, undec = 0;
const overFams = new Set<string>();

for (const [famId, ms] of byFam) {
  for (const tier of ["direct", "regular", "none"] as const) {
    const growths = ms.filter((m) => info(m).tier === tier && info(m).isGrowth);
    if (growths.length < 2) continue;

    // Compare every Growth against the first — one "different" makes the slot an over-merge.
    let v: Verdict = "same";
    for (let i = 1; i < growths.length; i++) {
      const r = sameFund(growths[0]!, growths[i]!);
      if (r === "different") { v = "different"; break; }
      if (r === "undecidable" && v === "same") v = "undecidable";
    }
    const tag = v === "same" ? "BENIGN — same fund (returns match)"
      : v === "different" ? "⚠️  OVER-MERGE — DIFFERENT FUNDS (returns diverge)"
      : "❓ UNDECIDABLE — no folded return to compare";
    if (v === "same") benign++;
    else if (v === "different") { over++; overFams.add(famId); }
    else undec++;

    if (v !== "same") {
      console.log(`\n  ${tag}`);
      console.log(`    house=${ms[0]!.fund_house}  tier=${tier}  key="${ms[0]!.family_key}"`);
      for (const g of growths) {
        console.log(`      GROWTH ${g.scheme_code}  ret1y=${g.ret_1y === null ? "—" : (g.ret_1y * 100).toFixed(2) + "%"}` +
          `  ret3y=${g.ret_3y === null ? "—" : (g.ret_3y * 100).toFixed(2) + "%"}` +
          `  shareClass="${shareClass(g.scheme_name) || "—"}"`);
        console.log(`             "${g.scheme_name}"   [stripped: ${g.plan_option}]`);
      }
    }
  }
}
console.log(`\n  ⇒ ${benign + over + undec} slots with >1 Growth:  ${benign} BENIGN · ${over} OVER-MERGE · ${undec} UNDECIDABLE`);

// ── (B) SILENT MIS-INHERITANCE — the dangerous population ──────────────────
//
// Reproduce the fold's ACTUAL choice (mf-distributions.ts: growthBy is keyed family|tier, LAST
// Growth iterated wins), then ask the returns whether the twin it landed on is the same fund.
//
// This is NOT a subset of (A): an over-merged family holding fund X (Direct-Growth + Direct-IDCW)
// and fund Y (Direct-IDCW only) has ONE Growth in the tier, trips no collision — and Y's IDCW
// silently takes X's return.
console.log(`\n═══ (B) IDCW plans inheriting from a Growth plan of a DIFFERENT FUND ═══`);

const growthBy = new Map<string, M>();
for (const m of members) {
  const p = info(m);
  if (p.isGrowth) growthBy.set(`${m.family_id}|${p.tier}`, m); // last writer wins — the bug, reproduced
}

let ok = 0;
const shareClassBad: { idcw: M; twin: M }[] = []; // twin is a DIFFERENT SHARE CLASS (Plan A vs base)
const bonusBad: { idcw: M; twin: M }[] = [];      // twin's option is BONUS, not Growth
const divergeBad: { idcw: M; twin: M }[] = [];    // the slot's Growth plans disagree on return

for (const m of members) {
  const p = info(m);
  if (p.isGrowth) continue;
  const twin = growthBy.get(`${m.family_id}|${p.tier}`);
  if (!twin) continue; // honest-NULL already — nothing to mis-inherit

  const scIdcw = shareClass(m.scheme_name), scTwin = shareClass(twin.scheme_name);
  const sameSlotGrowths = (byFam.get(m.family_id) ?? []).filter(
    (x) => info(x).tier === p.tier && info(x).isGrowth);
  const divergent = sameSlotGrowths.some((g) => sameFund(g, twin) === "different");

  if (scIdcw !== scTwin) shareClassBad.push({ idcw: m, twin });
  else if (isBonus(twin)) bonusBad.push({ idcw: m, twin });
  else if (divergent) divergeBad.push({ idcw: m, twin });
  else ok++;
}

const badAll = [...shareClassBad, ...bonusBad, ...divergeBad];
console.log(`  IDCW plans that inherit                    : ${ok + badAll.length}`);
console.log(`  ├─ twin is the SAME fund (correct)         : ${ok}`);
console.log(`  ├─ twin is a DIFFERENT SHARE CLASS         : ${shareClassBad.length}   ← "Plan A" was stripped`);
console.log(`  ├─ twin's option is BONUS, not Growth      : ${bonusBad.length}   ← /growth/ matched "Growth Plan + Bonus Option"`);
console.log(`  └─ the slot's Growth plans DISAGREE        : ${divergeBad.length}   ← duplicate scheme codes\n`);

const show = (title: string, list: { idcw: M; twin: M }[]) => {
  if (!list.length) return;
  console.log(`  ── ${title} ──`);
  for (const b of list) {
    console.log(`  ⚠️  ${b.idcw.scheme_code}  "${b.idcw.scheme_name}"`);
    console.log(`          inherits ← ${b.twin.scheme_code}  "${b.twin.scheme_name}"`);
    console.log(`          idcw class="${shareClass(b.idcw.scheme_name) || "—"}"  twin class="${shareClass(b.twin.scheme_name) || "—"}"` +
      `   twin ret1y=${b.twin.ret_1y === null ? "NULL" : (b.twin.ret_1y * 100).toFixed(2) + "%"}` +
      `  ret3y=${b.twin.ret_3y === null ? "NULL" : (b.twin.ret_3y * 100).toFixed(2) + "%"}`);
  }
  console.log("");
};
show("DIFFERENT SHARE CLASS (the 'Plan A' hole)", shareClassBad);
show("TWIN IS A BONUS PLAN (the /growth/ hole)", bonusBad);
show("GROWTH PLANS DISAGREE (duplicate codes)", divergeBad);

const badFams = new Set(badAll.map((b) => b.idcw.family_id));
console.log(`  ⇒ ${badAll.length} mis-inheritance(s) across ${badFams.size} family/families.`);

// ── (C) THE BONUS MISCLASSIFICATION ────────────────────────────────────────
//
// `isGrowth` is /growth/ over the WHOLE plan_option string. Nippon names the tier "Growth Plan" and
// the option "Bonus Option", so "growth plan + bonus option" MATCHES — and a Bonus plan is offered
// to IDCW plans as their total-return twin. A bonus issue steps the NAV down exactly like a split,
// so a Bonus NAV is no more a total-return series than an IDCW NAV is.
console.log(`\n═══ (C) plans classified as GROWTH whose option is actually BONUS ═══`);
const bonusAsGrowth = members.filter((m) => {
  const s = (m.plan_option ?? m.scheme_name).toLowerCase();
  return info(m).isGrowth && /\bbonus\b/.test(s);
});
console.log(`  ${bonusAsGrowth.length} plan(s) match /growth/ but carry a BONUS option.`);

// How many of those are actually SELECTED as a twin by the fold's last-writer-wins?
const bonusTwins = [...growthBy.entries()].filter(([, m]) =>
  /\bbonus\b/.test((m.plan_option ?? m.scheme_name).toLowerCase()));
console.log(`  ${bonusTwins.length} of them are the SELECTED twin for their (family, tier) slot.\n`);
for (const [k, m] of bonusTwins) {
  const idcwCount = (byFam.get(m.family_id) ?? []).filter((x) => {
    const p = info(x);
    return !p.isGrowth && `${x.family_id}|${p.tier}` === k;
  }).length;
  console.log(`  ⚠️  ${m.scheme_code}  "${m.scheme_name}"`);
  console.log(`          is the twin for ${idcwCount} IDCW plan(s) in this slot   [stripped: ${m.plan_option}]`);
}

await prisma.$disconnect();
