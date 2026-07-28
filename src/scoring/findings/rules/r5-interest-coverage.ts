// File: src/scoring/findings/rules/r5-interest-coverage.ts
//
// R5 — Interest Coverage Collapse (File 1 §5A · severity Critical · red flag · non-fin).
// Trigger (File 1): interest coverage < 1.5× for ≥2 consecutive quarters TTM.
//
// IC DEFINITION — matches the engine's F5 exactly (foundation.ts f5InterestCoverage):
//   IC = EBIT / finance costs,  EBIT = PBT + finance costs (post-depreciation, incl. other
//   income — ebitFrom in metrics/types.ts). NO pre-computed quarterly IC column exists, so
//   TTM is derived from rolling 4 quarters: IC_ttm = (ΣPBT + Σinterest) / Σinterest over
//   the trailing 4 CONTIGUOUS quarters. (interest = quarterly finance costs.) Do NOT invent
//   a divergent IC — this is the same metric the scoring engine computes.
//
// SELF-GUARDING (the guard read): TWO structural guards make R5 robust to one-offs without
// an exceptional-item guard — (1) TTM is a rolling-4-quarter SUM, so a single-quarter
// interest spike / operating dip is diluted by the other three quarters; (2) the breach must
// hold for ≥2 CONSECUTIVE TTM quarters. A one-off can't satisfy both. (Per §12 — don't
// over-engineer where the structure already guards. This is inherently far less one-off-
// sensitive than the quarterly OPM P11 reads.)

import { notEvaluable, type FireRule, type FiringContext } from "../types.js";
import type { MomentumQuarter } from "../../metrics/types.js";

export const R5_IC_THRESHOLD = 1.5;   // < 1.5×
export const R5_MIN_CONSECUTIVE = 2;  // ≥2 consecutive TTM quarters

/**
 * TTM interest coverage ending at row index `i` (rows sorted qOrdinal ASC). Requires 4 CONTIGUOUS
 * quarters with PBT + interest present and Σinterest > 0.
 *
 * ⚠ MIGRATED (Phase 2) to a TRI-STATE result, because the old `number | null` conflated two facts the
 * card must keep apart:
 *   · "unavailable"  — too few / non-contiguous quarters, or a null line item. The check DID NOT RUN.
 *   · "no_debt"      — Σinterest ≤ 0. The check RAN and the answer is a genuine non-breach: a debt-free
 *                      company cannot have an interest-coverage collapse. That is not_fired, not a gap.
 */
type TtmResult = { ok: true; ic: number } | { ok: false; why: "unavailable" | "no_debt" };

function ttmIC(rows: MomentumQuarter[], i: number): TtmResult {
  if (i < 3) return { ok: false, why: "unavailable" };
  const win = rows.slice(i - 3, i + 1);
  if (win[3].qOrdinal - win[0].qOrdinal !== 3) return { ok: false, why: "unavailable" }; // a quarter is missing
  let sumPbt = 0, sumInt = 0;
  for (const q of win) {
    if (q.profitBeforeTax === null || q.interest === null) return { ok: false, why: "unavailable" };
    sumPbt += q.profitBeforeTax;
    sumInt += q.interest;
  }
  if (sumInt <= 0) return { ok: false, why: "no_debt" }; // debt-free → no collapse is possible
  return { ok: true, ic: (sumPbt + sumInt) / sumInt }; // = ΣEBIT / Σinterest
}

export const ruleR5: FireRule = (ctx: FiringContext) => {
  // Scope decision, not a data gap — stays not_fired (see R3's banking note).
  if (ctx.industry === "banking") return null;
  const rows = [...ctx.quarterlyResults].sort((a, b) => a.qOrdinal - b.qOrdinal);
  // ⚠ MIGRATED (Phase 2): the depth gate is a declined check, not a false one.
  if (rows.length < R5_MIN_CONSECUTIVE + 3) return notEvaluable("insufficient_quarters"); // need 5 quarters

  // The latest TTM and the (R5_MIN_CONSECUTIVE−1) immediately-preceding TTMs must all breach.
  const last = rows.length - 1;
  const ttms: { endFy: string; endQ: string; ic: number }[] = [];
  for (let k = 0; k < R5_MIN_CONSECUTIVE; k++) {
    const res = ttmIC(rows, last - k);
    if (!res.ok) {
      // A missing/short window means we could not check; debt-free means we checked and it is false.
      return res.why === "unavailable" ? notEvaluable("insufficient_quarters") : null;
    }
    if (res.ic >= R5_IC_THRESHOLD) return null; // a non-breaching quarter breaks the run → not_fired
    ttms.unshift({ endFy: rows[last - k].fiscalYear, endQ: rows[last - k].quarter, ic: res.ic });
  }

  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    kind: "red_flag",
    key: "foundation_R5_interest_coverage", // canonical key
    severity: "critical", // File 1 §5A
    evidence: {
      rule: "R5",
      name: "Interest Coverage Collapse",
      threshold: R5_IC_THRESHOLD,
      consecutiveQuarters: R5_MIN_CONSECUTIVE,
      ttmSeries: ttms.map((t) => ({ period: `${t.endFy}${t.endQ}`, ttmIC: r2(t.ic) })),
      latestTtmIC: r2(ttms[ttms.length - 1].ic),
      verdict:
        `Interest coverage collapse — TTM interest coverage held below ${R5_IC_THRESHOLD}× for ` +
        `${R5_MIN_CONSECUTIVE} straight quarters (latest ${r2(ttms[ttms.length - 1].ic)}×).`,
    },
    metricRefs: ["interestCoverage"],
  };
};
