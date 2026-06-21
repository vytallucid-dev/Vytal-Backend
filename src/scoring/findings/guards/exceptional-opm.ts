// File: src/scoring/findings/guards/exceptional-opm.ts
//
// THE GUARD-REUSE MECHANISM (Stage B) — exceptional-item detection for quarterly OPM rules
// (P11 here; P12/P13/R3/R5/P7 follow this pattern in Stage C).
//
// PRINCIPLE (reused from the engine's guardrail below-line family, guardrail/signatures/):
// the operating line is the honest line; a one-off exceptional charge lives BELOW it. The
// guardrail's b2-exceptional-loss isolates this by deriving operating profit FROM the
// stored EBITDA margin (so the one-off stays in the gap to net profit).
//
// WHY WE CANNOT REUSE b2/b3 DIRECTLY (verified — three findings, all FLAGGED in the report):
//   1. The guardrail GATE is NOT wired into the scoring pass (runGuardrailGate is only
//      called by test scripts), so no guard signal exists in the FiringContext.
//   2. b2/b3 are ANNUAL (latestFundamental vs priorFundamental YoY). The P11 distortion is
//      a SINGLE-QUARTER cliff that averages out annually — verified: b2/b3 fire on NONE of
//      DRREDDY / HCLTECH / ITC / TECHM / TORNTPHARM at the annual grain.
//   3. The quarterly operatingMargin is PBT-DERIVED (operatingProfit = PBT + interest −
//      otherIncome), so it ABSORBS below-line one-offs — b2's "operating line held" test
//      can't be applied to it (the quarterly OPM collapses WITH net profit).
//
// THE FINGERPRINT we can read cleanly: a quarterly OPM that SIGN-FLIPS NEGATIVE while the
// stock's recent operating baseline was clearly positive. For a PBT-derived figure that is
// the unmistakable mark of a one-off charge dragging the operating proxy under (the annual
// EBITDA OPM stays positive — DRREDDY FY26 +27.3% vs quarterly −21.4%; HCLTECH ~+18% vs
// quarterly −23.5%). This is the quarterly analog of the guardrail's `profitSignFlip`.

import type { QuarterlyOpmPoint } from "../types.js";

/** A "clearly positive operating baseline" — the median of the PRIOR quarters' OPM must
 *  exceed this for a negative latest quarter to read as a sign-FLIP (one-off) rather than a
 *  chronically loss-making business. */
export const DISTORTION_BASELINE_MIN_PCT = 5;

/** Is `series[idx]` a below-line-distorted OPM reading (sign-flip from a positive baseline)? */
export function isDistortedOpm(series: QuarterlyOpmPoint[], idx: number): boolean {
  if (idx < 0 || idx >= series.length) return false;
  if (series[idx].opm >= 0) return false; // distortion fingerprint is a NEGATIVE operating proxy
  const priors = series.slice(0, idx).map((p) => p.opm).sort((a, b) => a - b);
  if (!priors.length) return false; // no baseline to judge a flip against
  const median = priors[Math.floor(priors.length / 2)];
  return median > DISTORTION_BASELINE_MIN_PCT; // negative now, healthy before ⇒ one-off charge
}

/** Does the LATEST quarter carry an exceptional-item distortion? If so, a "currently
 *  compressing" claim can't be made cleanly → the caller should suppress. */
export function latestQuarterDistorted(series: QuarterlyOpmPoint[]): boolean {
  return isDistortedOpm(series, series.length - 1);
}
