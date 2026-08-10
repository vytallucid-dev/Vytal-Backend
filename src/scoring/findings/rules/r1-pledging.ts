// File: src/scoring/findings/rules/r1-pledging.ts
//
// R1 — Pledging Crisis (File 1 §5A · red flag · Critical). Promoters have pledged more than half
// their stake as collateral, OR sharply increased what's pledged in a single quarter.
//
// ── WHY THIS FILE EXISTS NOW, AND DID NOT BEFORE ──────────────────────────────────────────────────
// R1 was the one catalogued finding with no rule. It was computed inside the Ownership pillar
// (ownership/primary.ts, off `computePledging`), carried on the pillar result as a DeferredRedFlag,
// and written to score_red_flags by the composite persist path — which meant it could only exist for
// a stock that had been SCORED. Pledging is a shareholding-filing fact. It is true of ASHOKLEY
// whether or not ASHOKLEY has a peer group, and 355 of 504 stocks never will.
//
// So R1 becomes a rule like every other finding, on the filing pass, keyed to the shareholding
// quarter it read.
//
// ── ★ THE RATIO IS NOT REIMPLEMENTED HERE ─────────────────────────────────────────────────────────
// This calls `computePledging` — the same function the pillar and N7 call. That is deliberate and it
// is not tidiness: the ratio has three edge cases that WOULD drift between two implementations —
//   · NDU (Non-Disposal-Undertaking) encumbrance is EXCLUDED from `pledgedShares` (open spec item);
//   · a null `pledgedShares` is "not disclosed", not zero;
//   · `promoterShares` ≤ 0 (an ITC-type zero-promoter company) makes the ratio undefined, not 0.
// A second implementation would get one of those wrong eventually, and the two R1s would disagree
// about the same company on the same quarter. The verdict, triggering values and severity come from
// the shared builders in pledging.ts for exactly the same reason.
//
// ── EVALUABILITY (the arm the pillar never had) ───────────────────────────────────────────────────
// The pillar knew only "fired / did not fire". A filing row must also say "could not check", so this
// rule adds the three not_evaluable arms — and only on inputs where the pillar produced no finding
// anyway, so the FIRED set is unchanged by construction:
//   · <1 shareholding filing        → insufficient_shareholding_history
//   · pledgedShares null            → pledging_not_disclosed  (computePledging's dormant_no_data;
//                                     the same gate N7 applies to the same column)
//   · promoterShares null           → share_count_unavailable (the count is missing, so the
//                                     denominator is unknown — distinct from a promoter stake of 0)
// A promoter stake of exactly 0 is NOT unevaluable: there is no promoter holding, so nothing can be
// pledged, and "checked, clean" is the true answer. computePledging returns `no_promoter` with
// r1Breach false and this rule reports not_fired — which is what a reader should see.

import { computePledging, r1Evidence, R1_SEVERITY } from "../../ownership/pledging.js";
import { notEvaluable, type FilingRule } from "../types.js";

export const ruleR1: FilingRule = (ctx) => {
  const rows = ctx.shareholding;
  if (rows.length < 1) return notEvaluable("insufficient_shareholding_history");

  const cur = rows[rows.length - 1];
  const prior = rows.length >= 2 ? rows[rows.length - 2] : null;

  if (cur.pledgedShares === null) return notEvaluable("pledging_not_disclosed");
  if (cur.promoterShares === null) return notEvaluable("share_count_unavailable");

  const p = computePledging(cur, prior);
  if (!p.r1Breach) return null; // checked — no breach (includes a genuine zero-promoter company)

  return {
    kind: "red_flag",
    key: "ownership_R1_pledge",
    severity: R1_SEVERITY,
    // ★ IDENTICAL to what score_red_flags.triggeringValues holds on the scoring path — same builder,
    //   including the `breaches` array the persist site merges in. See pledging.ts.
    evidence: r1Evidence(p),
  };
};
