// File: src/scoring/ownership/v2-pillar.ts
//
// CHANGE 2.5 — THE OWNERSHIP REBUILD.
//
// WHAT v1 DOES, AND WHY IT CANNOT WORK. A baseline of 75, plus a pledging term, minus three
// FIXED-STEP penalties: promoter exit −6 always, distribution −8 always, prolonged FII
// selling −4 always. A 3-point promoter exit and a 30-point one score identically. The
// maximum observed total penalty is −8 against a baseline of 75, which is the entire
// explanation for the pillar occupying 57–86 and taking TWENTY-FOUR distinct values across
// 1,139 quarters.
//
// THE SHARPEST CASE. v1's pledging term is a FIRST DIFFERENCE ON A LEVEL. Ashok Leyland's
// promoter stake was ~51% pledged for the whole window — a quarter of the company — and the
// adjustment reads 0.0000 in 8 of 12 quarters and +1.0 at the end, A CREDIT, because the
// pledge ticked down a fraction of a point. Meanwhile the R1 rule fires critical and
// Ownership sits at 81, its window maximum.
//
// THE REBUILD — three readings, each GRADED, none stepped:
//
//   pledge         0.40   LEVEL and DIRECTION. A company at 51% pledged is in danger whether
//                         or not it moved this quarter, so change alone would still miss
//                         Ashok Leyland; but a pledge being unwound is genuinely better than
//                         one being built, so level alone would miss the recovery.
//   promoter flow  0.35   the MAGNITUDE of the year-on-year change in promoter holding,
//                         graded against the universe's own cross-sectional distribution of
//                         that change in that quarter.
//   institutional  0.25   the year-on-year change in FII + DII, graded the same way.
//
// WEIGHTS ARE REASONED, NOT FITTED. Pledge is the only one of the three that is
// solvency-adjacent — it can force a sale of the company — so it carries most. Promoter
// change is the strongest statement of intent available from the register. Institutional
// flow is real information but is routinely reversed within a year.
//
// ★ THERE IS NO ABSOLUTE LADDER ON STAKE LEVEL, AND THAT MUST SURVIVE ANY FUTURE CHANGE.
//   There is no healthy level of promoter holding. Some companies have 75%, some 25%, some
//   none, and none of those is a health signal. What carries signal is BEHAVIOUR — a
//   promoter reducing steadily, institutions exiting repeatedly, a pledge building. The
//   pillar is deliberately built around change rather than position. THE ONE EXCEPTION IS
//   PLEDGING, where the level is itself a danger condition regardless of direction — which
//   is exactly the Ashok Leyland failure.
//
// ★ THE PLEDGE INPUT IS THE COUNTS-DERIVED RATIO, not the vendor percentage column.
//   pledgedShares / promoterTotalShares × 100 is immune BY CONSTRUCTION to both faults
//   Addendum C.3 was written to repair: a ratio of two counts cannot carry a units regime
//   and cannot inherit a "100.0" placeholder. Production has always read it this way
//   (ownership/pledging.ts), and on our data the two derivations agree within 0.01pp on
//   4,196 of 4,216 comparable filings.

import { computePeerStats } from "../metric-scoring/peer-stats.js";

export const PLEDGE_WEIGHT = 0.40;
export const PROMOTER_WEIGHT = 0.35;
export const INSTITUTIONAL_WEIGHT = 0.25;

/** Minimum cross-sectional sample before a flow can be graded (u6-own.cjs: `p.length < 8`). */
export const FLOW_MIN_POOL = 8;

const clamp100 = (v: number): number => Math.max(0, Math.min(100, v));

/**
 * THE PLEDGE LEVEL LADDER — stated, not fitted.
 *
 * 0.5% is clean; 5% is where lenders start to matter; 10% likewise; 25% is where a margin
 * call reshapes the company; 50%+ is the ASHOKLEY condition and cannot be scored as anything
 * but critical. Piecewise-linear between the stated breakpoints.
 */
export function pledgeLevel(pledgePct: number | null): number | null {
  if (pledgePct === null || !Number.isFinite(pledgePct)) return null;
  const x = Math.max(0, pledgePct);
  if (x <= 0.5) return 95;
  if (x <= 5) return 95 - (x - 0.5) * (15 / 4.5); // 95 -> 80
  if (x <= 10) return 80 - (x - 5) * (20 / 5); //    80 -> 60
  if (x <= 25) return 60 - (x - 10) * (30 / 15); //  60 -> 30
  if (x <= 50) return 30 - (x - 25) * (20 / 25); //  30 -> 10
  return Math.max(0, 10 - (x - 50) * (10 / 50)); //  50%+ -> 10 -> 0
}

/** The direction adjustment's own bound, before the level-dependent cap. */
export const PLEDGE_DIRECTION_BOUND = 12;
/** Cap on how far direction may move a CRITICAL level (<=30) versus any other. */
export const PLEDGE_CAP_CRITICAL = 8;
export const PLEDGE_CAP_NORMAL = 15;

/**
 * Level, then a CAPPED direction adjustment. Unwinding helps; the cap prevents unwinding
 * from a critical level reading as healthy.
 *
 * ★ A DELIBERATE, RECORDED DIVERGENCE FROM THE CALIBRATION CODE. `_tools/u6-own.cjs:115`
 *   reads `clamp(-dPl * 1.5, -12, 12)` — but `u-lib.cjs:9` defines `clamp` as a ONE-argument
 *   function, `v => Math.max(0, Math.min(100, v))`. The `-12, 12` are silently discarded, so
 *   the adjustment is clamped to [0, 100] and A PLEDGE BEING BUILT CONTRIBUTES NOTHING. Only
 *   unwinding ever moves the score — the opposite of the line the file's own comment states
 *   two lines above it ("unwinding helps, building hurts").
 *
 *   The handover is explicit that the .cjs files are calibration tooling to be read
 *   alongside the spec and not ported blindly ("Port the formulas; do not vendor the code"),
 *   and §2.5 specifies "level AND direction". So the bound is implemented as stated, ±12,
 *   symmetric. The cost is that the Ownership pillar moves further from the reference panel
 *   — which it is already a declared exemption from, because production derives the pledge
 *   from share counts and the panel cannot be regenerated on that basis.
 */
export function pledgeScore(
  pledgePctNow: number | null,
  pledgePctYearAgo: number | null,
): { score: number | null; level: number | null; adjustment: number } {
  const level = pledgeLevel(pledgePctNow);
  if (level === null || pledgePctNow === null) return { score: null, level, adjustment: 0 };
  if (pledgePctYearAgo === null) return { score: clamp100(level), level, adjustment: 0 };
  const delta = pledgePctNow - pledgePctYearAgo; // >0 = the pledge grew
  const raw = -delta * 1.5;
  const bounded = Math.max(-PLEDGE_DIRECTION_BOUND, Math.min(PLEDGE_DIRECTION_BOUND, raw));
  const cap = level <= 30 ? PLEDGE_CAP_CRITICAL : PLEDGE_CAP_NORMAL;
  const adjustment = Math.max(-cap, Math.min(cap, bounded));
  return { score: clamp100(level + adjustment), level, adjustment };
}

/**
 * Grade a flow against the universe's own cross-sectional distribution of the SAME change in
 * the SAME quarter — the relative logic L2 already uses, needing no invented constant.
 *
 * Same z->score shape as the lenses: 90 at z=+2, 30 at z=-2, 5 points per z beyond, anchor 60.
 * A pool smaller than FLOW_MIN_POOL cannot describe a distribution, so the leg drops out and
 * the other two renormalise — never a fabricated 60.
 */
export function gradeFlow(value: number | null, pool: number[]): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const p = pool.filter((x) => x !== null && Number.isFinite(x));
  if (p.length < FLOW_MIN_POOL) return null;
  const st = computePeerStats(p);
  if (st.stdDev === 0) return 60; // every company moved identically: the flow says nothing
  const z = (value - st.mean) / st.stdDev;
  if (z >= 2) return clamp100(90 + 5 * (z - 2));
  if (z <= -2) return clamp100(30 + 5 * (z + 2));
  return clamp100(60 + 15 * z);
}

export interface OwnershipV2Input {
  /** pledgedShares / promoterTotalShares × 100, this quarter and four filings back. */
  pledgePctNow: number | null;
  pledgePctYearAgo: number | null;
  /** Year-on-year change in promoter %, and the universe's distribution of it this quarter. */
  promoterChange: number | null;
  promoterPool: number[];
  /** Year-on-year change in FII + DII, and its universe distribution this quarter. */
  institutionalChange: number | null;
  institutionalPool: number[];
}

export interface OwnershipV2Result {
  subtotal: number | null;
  pledgePct: number | null;
  pledgeScore: number | null;
  pledgeLevelScore: number | null;
  pledgeAdjustment: number;
  promoterScore: number | null;
  institutionalScore: number | null;
  promoterChange: number | null;
  institutionalChange: number | null;
  /** Weight actually applied to each present leg (renormalised); 0 for an absent one. */
  appliedWeights: { pledge: number; promoter: number; institutional: number };
  reason: string;
}

/**
 * The pillar. Renormalises over whichever legs are present — if none is, the pillar is
 * UNAVAILABLE (null) and the composite's §14.4 redistribution handles it, which is the same
 * discipline every other pillar follows. Never a fabricated baseline.
 */
export function computeOwnershipV2(input: OwnershipV2Input): OwnershipV2Result {
  const pl = pledgeScore(input.pledgePctNow, input.pledgePctYearAgo);
  const prom = gradeFlow(input.promoterChange, input.promoterPool);
  const inst = gradeFlow(input.institutionalChange, input.institutionalPool);

  const legs: [number | null, number][] = [
    [pl.score, PLEDGE_WEIGHT],
    [prom, PROMOTER_WEIGHT],
    [inst, INSTITUTIONAL_WEIGHT],
  ];
  const present = legs.filter((l): l is [number, number] => l[0] !== null);
  const wsum = present.reduce((a, l) => a + l[1], 0);
  const subtotal = wsum > 0 ? present.reduce((a, l) => a + l[0] * l[1], 0) / wsum : null;

  const w = (v: number | null, nominal: number) => (v !== null && wsum > 0 ? nominal / wsum : 0);
  return {
    subtotal,
    pledgePct: input.pledgePctNow,
    pledgeScore: pl.score,
    pledgeLevelScore: pl.level,
    pledgeAdjustment: pl.adjustment,
    promoterScore: prom,
    institutionalScore: inst,
    promoterChange: input.promoterChange,
    institutionalChange: input.institutionalChange,
    appliedWeights: {
      pledge: w(pl.score, PLEDGE_WEIGHT),
      promoter: w(prom, PROMOTER_WEIGHT),
      institutional: w(inst, INSTITUTIONAL_WEIGHT),
    },
    reason: subtotal === null
      ? "Ownership unavailable — no pledge, promoter-flow or institutional-flow reading could be formed"
      : `Ownership=${subtotal.toFixed(2)} from ${present.length} of 3 readings ` +
        `[pledge ${pl.score === null ? "—" : pl.score.toFixed(1)}` +
        `${pl.score !== null ? ` (level ${pl.level!.toFixed(1)}${pl.adjustment ? `, direction ${pl.adjustment >= 0 ? "+" : ""}${pl.adjustment.toFixed(1)}` : ""})` : ""}` +
        `, promoter ${prom === null ? "—" : prom.toFixed(1)}, institutional ${inst === null ? "—" : inst.toFixed(1)}]`,
  };
}
