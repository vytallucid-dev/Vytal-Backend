// File: src/scoring/findings/engine.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE RULE REGISTRIES + RUNNER. There are now TWO registries, and which one a rule is in is the
// architectural statement, not a build-order accident.
//
// GOVERNING PRINCIPLE: a finding about a FILING belongs to the stock; a finding about a SCORE belongs
// to the snapshot.
//
//   FILING_RULES  (22) — read nothing but filed data (shareholding, annual fundamentals, quarterly
//                        results, insider transactions, block deals). Run by the STOCK-KEYED filing
//                        pass (src/filing) on all 504 active stocks, triggered by ingestion. They
//                        are typed {@link FilingRule}, so one that reaches for `ctx.current` does not
//                        compile.
//   SCORING_RULES (21) — genuinely about the score: they read the composite, the band, a pillar
//                        subtotal or the prior-snapshot series. Run by the PEER-GROUP-KEYED scoring
//                        pass (computePgScores) on the 95 scored stocks, daily.
//
// ⚠ `ALL_RULES` IS GONE, DELIBERATELY. It was the scoring pass's default rule set and, once 22 of the
// 43 rules stopped running there, its name would have been a lie — the single most misleading thing
// a registry can be called. Every call site now names the pass it means.
//
// P5 and P10 look like filing rules (they read the insider feed) and are NOT: P5 gates on
// `composite < 62` and P10 on `market < 74`, and that gate IS the rule's premise. Insider selling
// without distress is just insider selling. They stay in SCORING_RULES with their gates intact.

import type { FilingRule, FireRule, FilingContext, FiringContext, FiredFinding, RuleResult } from "./types.js";
import { isNotEvaluable } from "./types.js";
// R1 — a rule file as of the filing-pass build. It was previously computed inside the Ownership
// pillar and written as a RedFlag by the composite persist path, which meant a pledging fact could
// only exist for a stock that had been scored. See rules/r1-pledging.ts.
import { ruleR1 } from "./rules/r1-pledging.js";
import { ruleR6 } from "./rules/r6-distribution.js";
import { ruleP11 } from "./rules/p11-margin-compression.js";
import { ruleR2 } from "./rules/r2-promoter-exit.js";
import { ruleR4 } from "./rules/r4-debt-explosion.js";
import { ruleP1 } from "./rules/p1-clean-rotation.js";
import { ruleP4 } from "./rules/p4-dual-exit.js";
import { ruleP8 } from "./rules/p8-receivables.js";
// ruleP2 / ruleP3 are RETIRED (consolidated into R6 / R1) — files kept, not registered.
import { ruleR3 } from "./rules/r3-earnings-quality.js";
import { ruleP7 } from "./rules/p7-accruals.js";
import { ruleR5 } from "./rules/r5-interest-coverage.js";
import { ruleP12 } from "./rules/p12-margin-recovery.js";
import { ruleP13 } from "./rules/p13-revenue-inflection.js";
import { ruleF2 } from "./rules/f2-composition-shift.js";
import { ruleP5 } from "./rules/p5-insider-distress.js";
import { ruleP6 } from "./rules/p6-insider-conviction.js";
import { ruleP10 } from "./rules/p10-promoter-defense.js";
import { ruleH } from "./rules/h-ownership-events.js";
import { ruleF1 } from "./rules/f1-composition.js";
// Family N (Notable) — the constructive twins (Vytal Family N Amendment v1.0). Display-only,
// severity green, magnitude null; each fires AFTER composite assembly like every finding.
import { ruleN1 } from "./rules/n1-cash-backed-earnings.js";
import { ruleN2 } from "./rules/n2-working-capital.js";
import { ruleN3 } from "./rules/n3-deleveraging.js";
import { ruleN4 } from "./rules/n4-coverage-strengthening.js";
import { ruleN5 } from "./rules/n5-dual-institutional-build.js";
import { ruleN6 } from "./rules/n6-promoter-accumulation.js";
import { ruleN7 } from "./rules/n7-pledge-release.js";
// Family C (Divergence) — Vytal_Divergence_Tool_Spec Parts 2–3. Seven patterns + one state.
// These REPLACE the retired C1 / C2 / C3 / C-over-time / G set IN THE SAME CHANGE (see
// catalogue/retired-findings.ts), so no stock can ever show both an old C card and its D successor.
import { ruleD1 } from "./rules/d1-price-ahead-quality.js";
import { ruleD2 } from "./rules/d2-price-ahead-trajectory.js";
import { ruleD3 } from "./rules/d3-ownership-building-weak-foundation.js";
import { ruleD4 } from "./rules/d4-ownership-exiting-healthy.js";
import { coalesceFindings } from "./coalesce.js";
import { ruleD5 } from "./rules/d5-laggard-catching-up.js";
import { ruleD6 } from "./rules/d6-quality-rolling-over.js";
import { ruleD7 } from "./rules/d7-trajectory-breaking-base-holds.js";
import { ruleS2 } from "./rules/s2-sticky-divergence.js";
// Family T (Trajectory) — Vytal_Trajectory_Tool_Spec Parts 2–3. One score moving along its own path.
// These REPLACE the retired B / D / I set IN THE SAME CHANGE (see catalogue/retired-findings.ts).
// Keys carry their family in the prefix (trajectory_B_* = deterioration, trajectory_D_* = recovery),
// so familyOf classifies them with NO new branch — see the §5 note in the build report.
import { ruleT1 } from "./rules/t1-recovery-low-zone.js";
import { ruleT2 } from "./rules/t2-deterioration-high-base.js";
import { ruleT3 } from "./rules/t3-falling-out-of-pristine.js";
import { ruleT4 } from "./rules/t4-recovering-out-of-below-par.js";
import { ruleT5 } from "./rules/t5-foundation-out-of-weak.js";
import { ruleT6 } from "./rules/t6-momentum-breaking-into-weak.js";
import { ruleT7 } from "./rules/t7-momentum-improving-while-weak.js";
import { ruleT8 } from "./rules/t8-foundation-strong-improving.js";
import { ruleT9 } from "./rules/t9-foundation-weak-declining.js";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// REGISTRY 1 · FILING_RULES — the 22 that read nothing but filed data.
//
// These moved OUT of the scoring pass. Nothing about them was ever peer-group-shaped: R2 asks whether
// promoter holding fell between two shareholding filings, R3 whether net profit outran operating cash
// for four years, N5 whether FII and DII both built. Every one of those is true of the company and its
// filing, and stays true whether or not the stock has a peer group with five comparable members,
// committed bars, and a composite that survived. 355 of 504 stocks have no peer group and never will.
//
// ★ THEY ARE TYPED `FilingRule`, WHICH IS THE ENFORCEMENT. FilingContext carries no composite, no
// band, no pillars and no prior snapshots (see findings/types.ts), so a rule that drifts into reading
// the score fails `tsc` rather than failing quietly on the 409 stocks that have none.
//
// GROUPED BY THE FILING THEY READ, because that grouping is what the filing pass keys its rows on —
// see filing/registry.ts, which is the single table naming each rule's catalogue key, kind and period
// grain. The old STAGE_A…STAGE_E names were build order and carried no meaning worth preserving here.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** SHAREHOLDING FILING (grain S) — the quarterly shareholding pattern.
 *  R1 pledging · R2 promoter exit · R6 distribution · P1 clean rotation · P4 dual exit ·
 *  N5 dual institutional build · N6 promoter accumulation · N7 pledge release. */
export const SHAREHOLDING_RULES: FilingRule[] = [ruleR1, ruleR2, ruleR6, ruleP1, ruleP4, ruleN5, ruleN6, ruleN7];

/** ANNUAL ACCOUNTS (grain A) — the fiscal-year fundamentals.
 *  R3 earnings quality · R4 debt explosion · P7 accruals · P8 receivables ·
 *  N1 cash-backed earnings · N2 working capital · N3 deleveraging. */
export const ANNUAL_RULES: FilingRule[] = [ruleR3, ruleR4, ruleP7, ruleP8, ruleN1, ruleN2, ruleN3];

/** QUARTERLY RESULTS (grain Q) — the results filing.
 *  R5 interest coverage · N4 coverage strengthening · P11 margin compression ·
 *  P12 margin recovery · P13 revenue inflection. */
export const QUARTERLY_RULES: FilingRule[] = [ruleR5, ruleN4, ruleP11, ruleP12, ruleP13];

/** INSIDER + BLOCK-DEAL FEEDS (grain S — both anchor their window on the latest shareholding filing).
 *  P6 insider conviction · H block/bulk events.
 *  ⚠ P5 and P10 read the same feeds and are NOT here — see the header. */
export const FEED_RULES: FilingRule[] = [ruleP6, ruleH];

/** ★ THE FILING PASS'S REGISTRY. 22 rules, stock-keyed, no peer group, no snapshot. */
export const FILING_RULES: FilingRule[] = [...SHAREHOLDING_RULES, ...ANNUAL_RULES, ...QUARTERLY_RULES, ...FEED_RULES];

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// REGISTRY 2 · SCORING_RULES — the 21 that are genuinely about the score.
//
// Each one reads the composite, the band, a pillar subtotal, or the prior-snapshot series. None can be
// evaluated for a stock that has not been scored, and that is not a limitation to be engineered
// around — it is what the finding is about.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Composition — F1 atypical-for-band (reads the band-typical profiles), F2 mix shift vs the last
 *  snapshot. Both are statements about the SHAPE of a score. */
export const COMPOSITION_RULES: FireRule[] = [ruleF1, ruleF2];

/** SCORE-GATED insider/block patterns. Both read the same feeds the filing pass reads, and both are
 *  gated on a score reading that is the rule's PREMISE, not decoration:
 *    · P5 — insider selling on an ALREADY-WEAK name (composite < 62). Insider selling without
 *      distress is just insider selling; the gate is what makes it a distress signal.
 *    · P10 — promoter buying INTO WEAKNESS (Market < 74). Promoter buying into strength is not a
 *      defense.
 *  ⚠ Do not relax these gates and do not substitute anything for them to move the rules to the
 *  filing pass. Without the gate they are different rules making a claim the evidence does not carry. */
export const SCORE_GATED_FEED_RULES: FireRule[] = [ruleP5, ruleP10];

/** Family C (Divergence) — two pillars disagreeing (Vytal_Divergence_Tool_Spec Parts 2–3).
 *  D1/D2 price ahead of quality / of trajectory (two halves of ONE n=79 configuration, so they
 *  consolidate); D3/D4 ownership MOVEMENT against the Foundation level (the ±8 cut selects the
 *  LANGUAGE, never whether they fire); D5 convergence toward the strong pillar; D6/D7 crossings,
 *  which require the prior reading; S2 a sustained state carrying no return claim.
 *  S1 (Aligned) is deliberately NOT a rule — it is the tool's neutral control, not a card stamped on
 *  every quiet stock. */
export const FAMILY_C_RULES: FireRule[] = [ruleD1, ruleD2, ruleD3, ruleD4, ruleD5, ruleD6, ruleD7, ruleS2];

/** Family T (Trajectory) — ONE score moving along its own path (Vytal_Trajectory_Tool_Spec Parts
 *  2–3). T1/T2 are MOVE patterns (prev level + Δ magnitude); T3/T4/T5/T6 are crossings; T7/T8/T9 are
 *  level-and-direction states. Every one reads the IMMEDIATELY-PRIOR reading only — no sustain,
 *  because the spec's triggers ask for none.
 *
 *  ★ NINE SEPARATE RULES, NOT THREE MULTI-LEG ONES. The retired D packed four pillar legs into one
 *  key behind a `break`, so a stock recovering on three pillars persisted ONE finding naming one
 *  pillar. Per-pattern rules make that defect unrepresentable: T5 (Foundation), T7 (Momentum) and T8
 *  (Foundation strong) are independent and all fire when all are true.
 *
 *  ★ REGIME IS A REQUIRED FIELD PER PATTERN (§1.4), in three tiers — T3/T6 decide whether a
 *  directional read EXISTS (and point OPPOSITE ways); T2 must always display the phase; the rest
 *  take it as a magnitude caveat. See trajectory/regime-tier.ts. */
export const FAMILY_T_RULES: FireRule[] = [ruleT1, ruleT2, ruleT3, ruleT4, ruleT5, ruleT6, ruleT7, ruleT8, ruleT9];

/** ★ THE SCORING PASS'S REGISTRY. 21 rules, peer-group-keyed, run daily on the 95 scored stocks.
 *  P9 stays UNBUILT (capex unavailable); P2/P3 are RETIRED (consolidated into R6/R1). */
export const SCORING_RULES: FireRule[] = [...COMPOSITION_RULES, ...SCORE_GATED_FEED_RULES, ...FAMILY_C_RULES, ...FAMILY_T_RULES];

/** Every registered rule across BOTH passes — for tooling that must reason about the whole
 *  vocabulary (catalogue reconciliation, rule-ref coverage). NOT a runnable set: the two passes
 *  build different contexts and run on different universes. */
export const EVERY_RULE: FireRule[] = [...FILING_RULES, ...SCORING_RULES];

/** Run the rule set against a context; return the fired findings (order = registry
 *  order). A single throwing rule is isolated so it can never abort the others or the
 *  scoring pass (findings are best-effort — they never block a score write). */
export function runFindings(ctx: FiringContext, rules: FireRule[] = SCORING_RULES): FiredFinding[] {
  // ★ COALESCED ON THE WAY OUT — see coalesce.ts for why the runner is the right seam (three callers,
  //   pure, and ahead of a persist layer whose only dedup silently drops the second row).
  const out: FiredFinding[] = [];
  for (const rule of rules) {
    try {
      const r = rule(ctx);
      // Three outcomes, one fired set: a FiredFinding is collected; `null` (not_fired) and a
      // NotEvaluable (could-not-check) are BOTH excluded. not_evaluable is a truthy object, so
      // the old `if (f)` would have wrongly pushed it — the isNotEvaluable guard keeps it out.
      // (Behaviour for existing rules is unchanged: they never return NotEvaluable, so this is
      // exactly `if (r) out.push(r)` for them.) not_evaluable is intentionally NOT surfaced here
      // — see runFindingsDetailed for the migration-facing accessor.
      if (r && !isNotEvaluable(r)) out.push(r);
    } catch {
      // swallow — a buggy rule must not break scoring; it simply does not fire.
    }
  }
  return coalesceFindings(out);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RULE IDENTITY (Phase 2). A declined check must be recorded against a STABLE reference, and rules are
// bare arrow functions with no intrinsic name. `runFindingsDetailed` previously reported the rule's
// ARRAY INDEX, which is worthless the moment registry order changes — and useless for persistence.
//
// This map gives every registered rule a stable `ruleRef`. It lives beside the registry (the one place
// that already names each rule at import) rather than being stamped onto 30 rule files, and it is the
// SINGLE source of the ref that reaches the database and the read surface. A rule missing from the map
// degrades to "unknown_rule" rather than throwing — a diagnostic gap, never a broken scoring pass.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const RULE_REFS: ReadonlyMap<FireRule, string> = new Map<FireRule, string>([
  [ruleR1, "R1"], [ruleR6, "R6"], [ruleP11, "P11"],
  [ruleR2, "R2"], [ruleR4, "R4"], [ruleP1, "P1"], [ruleP4, "P4"], [ruleP8, "P8"],
  [ruleR3, "R3"], [ruleP7, "P7"], [ruleR5, "R5"], [ruleP12, "P12"], [ruleP13, "P13"],
  [ruleF2, "F2"],
  [ruleP5, "P5"], [ruleP6, "P6"], [ruleP10, "P10"], [ruleH, "H"], [ruleF1, "F1"],
  [ruleN1, "N1"], [ruleN2, "N2"], [ruleN3, "N3"], [ruleN4, "N4"],
  [ruleN5, "N5"], [ruleN6, "N6"], [ruleN7, "N7"],
  [ruleD1, "D1"], [ruleD2, "D2"], [ruleD3, "D3"], [ruleD4, "D4"],
  [ruleD5, "D5"], [ruleD6, "D6"], [ruleD7, "D7"], [ruleS2, "S2"],
  [ruleT1, "T1"], [ruleT2, "T2"], [ruleT3, "T3"], [ruleT4, "T4"], [ruleT5, "T5"],
  [ruleT6, "T6"], [ruleT7, "T7"], [ruleT8, "T8"], [ruleT9, "T9"],
]);

export const ruleRefOf = (rule: FireRule): string => RULE_REFS.get(rule) ?? "unknown_rule";

/** One declined check: WHICH rule could not run, and WHY. The pair the read surface needs to say
 *  "we can't check earnings quality here yet — it needs four years of accounts and we have two." */
export interface DeclinedCheck {
  ruleRef: string;
  reason: string;
}

/** Migration-facing variant: returns the fired set AND the declined set. As of Phase 2 this IS the live
 *  scoring path (score-pass.ts calls it), because a rule that declined for depth and a rule that
 *  evaluated to false are different facts and the card must be able to tell them apart. Pure, same
 *  isolation guarantee as {@link runFindings}. */
export interface RunFindingsDetailed {
  fired: FiredFinding[];
  notEvaluable: DeclinedCheck[];
}
export function runFindingsDetailed(ctx: FiringContext, rules: FireRule[] = SCORING_RULES): RunFindingsDetailed {
  const fired: FiredFinding[] = [];
  const notEval: DeclinedCheck[] = [];
  for (const rule of rules) {
    try {
      const r = rule(ctx);
      if (isNotEvaluable(r)) notEval.push({ ruleRef: ruleRefOf(rule), reason: r.reason });
      else if (r) fired.push(r);
    } catch {
      // swallow — a buggy rule must not break scoring.
    }
  }
  // ★ THE SAME COALESCING AS runFindings, AND IT MUST BE. This is the LIVE scoring path (score-pass.ts
  //   calls it), so applying it in only one of the two runners would mean the live pass and the
  //   backfills disagreed about what one move produces.
  return { fired: coalesceFindings(fired), notEvaluable: notEval };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FILING RUNNER — same isolation, a DIFFERENT return shape, and the difference is the point.
//
// `runFindingsDetailed` above returns { fired, notEvaluable } and DROPS not_fired entirely, because
// the scoring pass persists findings against a snapshot and a snapshot with no R2 row means "R2 did
// not fire". The filing pass cannot use that convention: it writes one row per rule per filing
// period, and row ABSENCE there means "this rule has not been run for this period" — a third fact.
//
// So this returns EVERY rule's outcome, including the ones that ran and found nothing. "We checked
// and it is clean" is a renderable statement and it has to survive the runner to be persisted.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** One rule's outcome on one stock. `state` is the three-valued fact; the payload arm that carries
 *  detail depends on it (finding ⇔ fired, reason ⇔ not_evaluable). */
export interface FilingRuleOutcome {
  ruleRef: string;
  state: "fired" | "not_fired" | "not_evaluable";
  finding: FiredFinding | null;
  reason: string | null;
  /** True when the rule THREW. Recorded as not_evaluable with reason "rule_error" rather than
   *  silently dropped — a rule crashing is a fact about our coverage, not about the company. */
  errored: boolean;
}

/** Run the filing rule set over a filed-data context. Pure. A throwing rule is isolated exactly as in
 *  the scoring runner, but here it lands as an explicit not_evaluable outcome instead of vanishing. */
export function runFilingRules(ctx: FilingContext, rules: FilingRule[] = FILING_RULES): FilingRuleOutcome[] {
  const out: FilingRuleOutcome[] = [];
  for (const rule of rules) {
    const ruleRef = ruleRefOf(rule);
    let r: RuleResult;
    try {
      r = rule(ctx);
    } catch {
      out.push({ ruleRef, state: "not_evaluable", finding: null, reason: "rule_error", errored: true });
      continue;
    }
    if (isNotEvaluable(r)) out.push({ ruleRef, state: "not_evaluable", finding: null, reason: r.reason, errored: false });
    else if (r) out.push({ ruleRef, state: "fired", finding: r, reason: null, errored: false });
    else out.push({ ruleRef, state: "not_fired", finding: null, reason: null, errored: false });
  }
  return out;
}
