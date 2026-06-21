// File: src/scoring/findings/engine.ts
//
// THE rule registry + runner. A findings pass = run every registered rule against one
// member's FiringContext and collect the fired set. Pure. Later stages append the
// remaining ~21 rules to STAGE_A_RULES (or a fuller registry) — the runner is unchanged.

import type { FireRule, FiringContext, FiredFinding } from "./types.js";
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

/** The full active catalog (ordering here is registry order, NOT File 1's §5 display
 *  ordering — that A→I sort is a read-layer concern). P9 stays UNBUILT (capex unavailable);
 *  P2/P3 are RETIRED (consolidated into R6/R1). */
export const ALL_RULES: FireRule[] = [...STAGE_A_RULES, ...STAGE_B_RULES, ...STAGE_C_RULES, ...STAGE_D_RULES, ...STAGE_E_RULES];

/** Run the rule set against a context; return the fired findings (order = registry
 *  order). A single throwing rule is isolated so it can never abort the others or the
 *  scoring pass (findings are best-effort — they never block a score write). */
export function runFindings(ctx: FiringContext, rules: FireRule[] = ALL_RULES): FiredFinding[] {
  const out: FiredFinding[] = [];
  for (const rule of rules) {
    try {
      const f = rule(ctx);
      if (f) out.push(f);
    } catch {
      // swallow — a buggy rule must not break scoring; it simply does not fire.
    }
  }
  return out;
}
