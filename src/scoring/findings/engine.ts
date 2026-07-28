// File: src/scoring/findings/engine.ts
//
// THE rule registry + runner. A findings pass = run every registered rule against one
// member's FiringContext and collect the fired set. Pure. Later stages append the
// remaining ~21 rules to STAGE_A_RULES (or a fuller registry) — the runner is unchanged.

import type { FireRule, FiringContext, FiredFinding } from "./types.js";
import { isNotEvaluable } from "./types.js";
import { ruleR6 } from "./rules/r6-distribution.js";
import { ruleP11 } from "./rules/p11-margin-compression.js";
import { ruleC1 } from "./rules/c1-divergence.js";
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
import { ruleB } from "./rules/b-deterioration.js";
import { ruleD } from "./rules/d-recovery.js";
import { ruleI } from "./rules/i-band-transition.js";
import { ruleG } from "./rules/g-convergence.js";
import { ruleF2 } from "./rules/f2-composition-shift.js";
import { ruleC2 } from "./rules/c2-ownership-divergence.js";
import { ruleC3 } from "./rules/c3-floor-trajectory-split.js";
import { ruleCOverTime } from "./rules/c-over-time.js";
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

/** Stage-A proven set: one red flag (R6), one single-snapshot pattern (P11), one
 *  divergence (C1) — one rule per major class, proved the contract end-to-end. */
export const STAGE_A_RULES: FireRule[] = [ruleR6, ruleP11, ruleC1];

/** Stage-B set: the clean, low-distortion-risk rules. R2/P1/P4 reuse the engine's proven
 *  ownership logic; R4/P8 read robust balance-sheet inputs.
 *  P2/P3 are RETIRED — consolidated into R6 (distribution) / R1 (pledging) per the firewall;
 *  their rule files remain (provisional triggers) but are NOT registered, so they never fire. */
export const STAGE_B_RULES: FireRule[] = [ruleR2, ruleR4, ruleP1, ruleP4, ruleP8];

/** Stage-C set: the distortion-prone rules. R3 (≥4-consecutive) and R5 (TTM + ≥2-consecutive)
 *  are STRUCTURALLY self-guarding; P7 reuses the engine's ACTUAL b1/b2/b3 (annual grain fits);
 *  P12 reuses both the Stage-B OPM guard + annual b1 (positive-exceptional, residual gap
 *  flagged); P13 is TTM-smoothed (and data-depth-gated until ~9 quarters land). */
export const STAGE_C_RULES: FireRule[] = [ruleR3, ruleP7, ruleR5, ruleP12, ruleP13];

/** Stage-D set: the TRAJECTORY rules (read FiringContext.priorSnapshots). B/D are sustained
 *  band crosses (persistence self-guards); I is subordinate to B/D (single-signal); G/C-over-
 *  time/C2/C3 share the K2 thresholds; F2 reads the mix shift vs last snapshot. */
export const STAGE_D_RULES: FireRule[] = [ruleB, ruleD, ruleI, ruleG, ruleF2, ruleC2, ruleC3, ruleCOverTime];

/** Stage-E set: feed-gated insider/block patterns (P5/P6/P10/H — ACTIVE, feed live) + F1
 *  (atypical-for-band). §2 risk-shape is NOT here — it is a read-layer computation
 *  (section2/risk-shape.ts), not a fired finding. */
export const STAGE_E_RULES: FireRule[] = [ruleP5, ruleP6, ruleP10, ruleH, ruleF1];

/** Family N (Notable) — the seven CONSTRUCTIVE twins (Amendment v1.0). Each is the positive
 *  mirror of a negative rule: N1↔P7, N2↔P8, N3↔R4, N4↔R5, N5↔P4, N6↔R2, N7↔R1. Display-only
 *  (green · magnitude null · polarity positive · temporalClass CONDITION). REGISTRATION IS
 *  MANDATORY — an unregistered rule never fires (the P2/P3 lesson); all seven go in ALL_RULES. */
export const FAMILY_N_RULES: FireRule[] = [ruleN1, ruleN2, ruleN3, ruleN4, ruleN5, ruleN6, ruleN7];

/** The full active catalog (ordering here is registry order, NOT File 1's §5 display
 *  ordering — that A→I sort is a read-layer concern). P9 stays UNBUILT (capex unavailable);
 *  P2/P3 are RETIRED (consolidated into R6/R1). */
export const ALL_RULES: FireRule[] = [...STAGE_A_RULES, ...STAGE_B_RULES, ...STAGE_C_RULES, ...STAGE_D_RULES, ...STAGE_E_RULES, ...FAMILY_N_RULES];

/** Run the rule set against a context; return the fired findings (order = registry
 *  order). A single throwing rule is isolated so it can never abort the others or the
 *  scoring pass (findings are best-effort — they never block a score write). */
export function runFindings(ctx: FiringContext, rules: FireRule[] = ALL_RULES): FiredFinding[] {
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
  return out;
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
  [ruleR6, "R6"], [ruleP11, "P11"], [ruleC1, "C1"],
  [ruleR2, "R2"], [ruleR4, "R4"], [ruleP1, "P1"], [ruleP4, "P4"], [ruleP8, "P8"],
  [ruleR3, "R3"], [ruleP7, "P7"], [ruleR5, "R5"], [ruleP12, "P12"], [ruleP13, "P13"],
  [ruleB, "B"], [ruleD, "D"], [ruleI, "I"], [ruleG, "G"], [ruleF2, "F2"],
  [ruleC2, "C2"], [ruleC3, "C3"], [ruleCOverTime, "C_over_time"],
  [ruleP5, "P5"], [ruleP6, "P6"], [ruleP10, "P10"], [ruleH, "H"], [ruleF1, "F1"],
  [ruleN1, "N1"], [ruleN2, "N2"], [ruleN3, "N3"], [ruleN4, "N4"],
  [ruleN5, "N5"], [ruleN6, "N6"], [ruleN7, "N7"],
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
export function runFindingsDetailed(ctx: FiringContext, rules: FireRule[] = ALL_RULES): RunFindingsDetailed {
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
  return { fired, notEvaluable: notEval };
}
