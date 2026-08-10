// File: src/scoring/findings/rules/n7-pledge-release.ts
//
// N7 — Pledge Release (Family N · CONSTRUCTIVE MIRROR of R1 Pledging Crisis). Amendment §5.
// Where R1 fires when the pledge ratio breaches (>50% of promoter holding, OR a +10pp QoQ
// rise), N7 recognises the opposite: the promoter DE-PLEDGING — the pledge ratio falling.
//
// pledgeRatio = pledgedShares ÷ promoterShares × 100, from COUNTS (the same discipline R1 uses;
// the stored promoterPledged* percentage fields are corrupt and ignored). We reuse the engine's
// computePledging so N7 and R1 never disagree on the ratio or on whether R1 breached. As of the
// filing-pass build R1 is itself a rule (rules/r1-pledging.ts) reading that same helper, and the
// "is R1 standing?" question below is answered by the shared `r1StandingAt` predicate.
//
// Trigger (Amendment §5): pledge ratio falling ≥10pp QoQ, OR crossing below 50% from above.
// (10pp / 50% are SYMMETRIC with R1 — §2: do not loosen.)
//
// GATES: pledging column present for the peer group else not_evaluable{pledging_not_disclosed}
// (a null pledge count = not disclosed, mirroring computePledging's dormant_no_data) · ≥2
// shareholding quarters else not_evaluable{insufficient_shareholding_history}.
//
// ┌──────────────────────────────────────────────────────────────────────────────────────┐
// │ ANTI-DOUBLE-COUNT (Amendment §5) — N7 fires ONLY where R1 was NOT standing in the PRIOR │
// │ quarter. A fall from a non-breaching base (e.g. 38%→21%) never triggered R1 and is      │
// │ N7's case. A fall that CLEARS a standing R1 (e.g. 60%→45%, or any crossing below 50%    │
// │ from above) belongs to the flag-cleared finding (Family J), which owns dated            │
// │ restorations. We detect "R1 standing in the prior quarter" by re-running the engine's   │
// │ own R1 verdict on that quarter, via the shared `r1StandingAt(rows, idx)` predicate.     │
// │                                                                                          │
// │ ⚠️ KNOWN GAP, BY DESIGN: Family J does not exist yet. So a pledge fall that clears a     │
// │ standing R1 currently produces NO card at all until J ships. That is deliberate         │
// │ honest-empty — better than a wrong card, or two cards for one event. DO NOT "fix" it by │
// │ letting N7 fire on that case. When J ships it will own these dated restorations.        │
// └──────────────────────────────────────────────────────────────────────────────────────┘
// (Note: because "crossing below 50% from above" requires prior ratio > 50%, which is exactly
//  R1's standing level breach, that clause is currently always caught by the guard above — it
//  is the known-gap case. It is implemented for completeness / for when J ships.)
//
// DISPLAY-ONLY: green · positive · magnitude null (explicit) · CONDITION.

import { computePledging, r1StandingAt } from "../../ownership/pledging.js";
import { notEvaluable, type FilingRule } from "../types.js";
import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";

// ★ THE BAR THIS RULE FIRES AT, READ FROM THE CATALOGUE — never a literal here. Same binding the
//   D/S/T rules already use (`const FACTS = ENTRY.facts`); see catalogue/finding-facts.ts for why the
//   35 unstudied findings now carry a record too. Relocation only: every value is what this file
//   declared before, and the evidence-parity gate re-derives all 504 stocks to prove it.
const FACTS = STOCK_FINDINGS.ownership_N7_pledge_release.facts;

export const N7_QOQ_FALL_PP = FACTS.thresholds.qoqFallPp; // pledge ratio falling ≥ 10pp QoQ (R1-symmetric)
export const N7_RATIO_PCT = FACTS.thresholds.ratioPct;   // OR crossing below 50% from above (R1-symmetric)

export const ruleN7: FilingRule = (ctx) => {
  const rows = ctx.shareholding;
  if (rows.length < 2) return notEvaluable("insufficient_shareholding_history");

  const cur = rows[rows.length - 1];
  const prior = rows[rows.length - 2];
  // Disclosure gate: a null pledge count = pledging not disclosed for this peer group.
  if (cur.pledgedShares === null || prior.pledgedShares === null) return notEvaluable("pledging_not_disclosed");

  const cp = computePledging(cur, prior);
  const ratioQ = cp.pledgeRatioQ, ratioQ1 = cp.pledgeRatioQ1;
  if (ratioQ === null || ratioQ1 === null) return null; // no promoter stake → no pledge ratio → not_fired

  const fallPp = ratioQ1 - ratioQ; // positive = pledge ratio fell
  const fallTrigger = fallPp >= N7_QOQ_FALL_PP;
  const crossTrigger = ratioQ1 > N7_RATIO_PCT && ratioQ < N7_RATIO_PCT; // crossing below 50% from above
  if (!fallTrigger && !crossTrigger) return null; // checked, false → not_fired

  // ANTI-DOUBLE-COUNT: was R1 standing in the PRIOR quarter? If so, this fall CLEARS a standing
  // R1 → Family J's territory. N7 must not fire (KNOWN GAP: no card until J ships — see header).
  //
  // ★ ONE NAMED QUESTION, ONE ANSWER. This used to open-code the verdict —
  // `computePledging(prior, priorPrior).r1Breach`, with the index arithmetic for `priorPrior` inline
  // — which was correct but re-derived something R1 also derives. Now that R1 is a rule
  // (rules/r1-pledging.ts) both ask `r1StandingAt` of the same helper, so "was R1 standing" has a
  // single implementation and N7 no longer has to know how R1 decides.
  if (r1StandingAt(rows, rows.length - 2)) return null;

  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    kind: "pattern",
    key: "ownership_N7_pledge_release",
    severity: "green",
    direction: "positive",
    polarity: "positive",
    temporalClass: "CONDITION",
    magnitude: null, // EXPLICIT
    displayState: "active",
    evidence: {
      family: "N",
      pattern: "N7",
      name: "Pledge Release",
      period: `${cur.fiscalYear}${cur.quarter}`,
      priorPeriod: `${prior.fiscalYear}${prior.quarter}`,
      pledgeFromPct: r2(ratioQ1), // REQUIRED KEY (§3)
      pledgeToPct: r2(ratioQ),    // REQUIRED KEY (§3)
      fallPp: r2(fallPp),
      trigger: fallTrigger ? "qoq_fall" : "crossed_below_50",
      qoqFallPp: N7_QOQ_FALL_PP,
      ratioPct: N7_RATIO_PCT,
      priorR1Standing: false, // guaranteed by the anti-double-count guard above
      verdict:
        `Pledge release — the promoter's pledge ratio fell ${r2(fallPp).toFixed(2)}pp into ${cur.fiscalYear}${cur.quarter} ` +
        `(${r2(ratioQ1)}% → ${r2(ratioQ)}% of promoter holding), from a base that was not in pledging crisis.`,
    },
  };
};
