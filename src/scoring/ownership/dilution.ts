// File: src/scoring/ownership/dilution.ts
//
// C-3 Half-A — DILUTION DETECTOR (Ownership engine).
//
// Classifies a quarterly drop in a promoter's PERCENTAGE stake as either real
// dilution (new shares issued — promoter sold nothing) or a genuine reduction
// (promoter actually sold). It is consumed later by the R2 disturbance rule:
//   R2: "promoter holding drops >5 percentage points in one quarter → −6".
// A QIP/rights/preferential issue can drop the promoter's % while their absolute
// share count is unchanged — that is dilution, and R2 must NOT fire on it.
//
// SCOPE: this module ONLY returns a verdict. It computes NO score, applies NO R2
// logic, and performs NO DB writes. Half-B (matching a sell-down to a recorded
// OFS/disinvestment) is DEFERRED and out of scope here. Where Half-A cannot
// confirm dilution, the verdict is NOT dilution — an unexplained drop stays
// R2-eligible (fail-safe).

/** The four mutually-exclusive verdicts. INDETERMINATE is a LABELED state — it is
 * never silently collapsed into "dilution" or "no_drop". Downstream (R2) treats
 * indeterminate as NOT dilution, i.e. the drop stays R2-eligible. */
export type DilutionVerdict =
  | "no_drop"
  | "dilution"
  | "genuine_reduction"
  | "indeterminate";

/** Minimal shape this detector needs from a ShareholdingPattern row. Share counts
 * are BigInt COUNTS — never rescaled. */
export interface ShareholdingRow {
  promoterShares: bigint | null;
  totalShares: bigint | null;
  asOnDate: Date;
  quarter?: string; // "Q1".."Q4" — label only
  fiscalYear?: string; // "FY26" — label only
}

export interface DilutionResult {
  verdict: DilutionVerdict;
  /** Percentage-point fall in promoter %, Q-1 → Q. Positive = % fell. null when
   * a percentage could not be computed (missing data / zero denominator). */
  pctDrop: number | null;
  promoterPctQ: number | null;
  promoterPctQ1: number | null;
  /** Signed change in promoter share COUNT (Q − Q1). null if a count is missing. */
  promoterShareChange: number | null;
  /** Signed change in total share COUNT (Q − Q1). null if a count is missing. */
  totalShareChange: number | null;
  /** true when Q-1 was not the immediately consecutive quarterly filing (a
   * quarter is missing between the two rows). */
  priorQuarterGap: boolean;
  reason: string;
}

// ── tol — ROUNDING-ABSORPTION BAND (NOT a calibrated threshold) ───────────────
// tol = 0.5% of the prior-quarter promoter share count. Its ONLY job is to
// absorb integer rounding and tiny routine moves (ESOP vesting, fractional
// adjustments) so they don't masquerade as a sell-down or as dilution. It is
// NOT tuned and NOT fit to any outcome (CN-8). Per spec the SAME band is applied
// to both the promoter-count test and the total-count test.
export const TOL_FRACTION = 0.005;

// Quarterly filings are ~3 months apart. If two consecutive ROWS are more than
// ~4 months apart, a quarter is missing between them → priorQuarterGap. This is
// a calendar-cadence heuristic, not a tuned value.
const GAP_MONTHS_THRESHOLD = 4;

/**
 * Classify the promoter-stake change from the prior quarter (Q-1) to the current
 * quarter (Q). PURE: no DB, no side effects.
 *
 * @param current  the quarter under test (Q)
 * @param prior    the immediately preceding ShareholdingPattern row (Q-1), or
 *                 null if none exists.
 */
export function classifyDilution(
  current: ShareholdingRow,
  prior: ShareholdingRow | null,
): DilutionResult {
  // ── No prior row → indeterminate (nothing to compare against) ──
  if (!prior) {
    return {
      verdict: "indeterminate",
      pctDrop: null,
      promoterPctQ: null,
      promoterPctQ1: null,
      promoterShareChange: null,
      totalShareChange: null,
      priorQuarterGap: false,
      reason: "indeterminate: no prior quarter row to compare against",
    };
  }

  const priorQuarterGap = isPriorQuarterGap(current.asOnDate, prior.asOnDate);
  const gapNote = priorQuarterGap
    ? " (NOTE: prior filing is not the immediately consecutive quarter — a quarter is missing)"
    : "";

  const pS_Q = current.promoterShares;
  const tS_Q = current.totalShares;
  const pS_Q1 = prior.promoterShares;
  const tS_Q1 = prior.totalShares;

  // ── Missing share counts → indeterminate ──
  const missing: string[] = [];
  if (pS_Q === null) missing.push("promoterShares(Q)");
  if (tS_Q === null) missing.push("totalShares(Q)");
  if (pS_Q1 === null) missing.push("promoterShares(Q-1)");
  if (tS_Q1 === null) missing.push("totalShares(Q-1)");
  if (missing.length > 0) {
    return {
      verdict: "indeterminate",
      pctDrop: null,
      promoterPctQ: null,
      promoterPctQ1: null,
      // counts may be partially present, but a clean signed change needs both:
      promoterShareChange:
        pS_Q !== null && pS_Q1 !== null ? Number(pS_Q - pS_Q1) : null,
      totalShareChange:
        tS_Q !== null && tS_Q1 !== null ? Number(tS_Q - tS_Q1) : null,
      priorQuarterGap,
      reason: `indeterminate: missing share count(s) [${missing.join(", ")}]${gapNote}`,
    };
  }

  // All four counts are non-null beyond this point.
  const promoterShareChange = Number(pS_Q! - pS_Q1!); // exact: counts ≪ 2^53
  const totalShareChange = Number(tS_Q! - tS_Q1!);

  // ── Zero / negative denominator → indeterminate (cannot compute %) ──
  // (BSE-type rows with totalShares = 0.) Share deltas are still reported.
  if (tS_Q! <= 0n || tS_Q1! <= 0n) {
    return {
      verdict: "indeterminate",
      pctDrop: null,
      promoterPctQ: tS_Q! > 0n ? (Number(pS_Q!) / Number(tS_Q!)) * 100 : null,
      promoterPctQ1: tS_Q1! > 0n ? (Number(pS_Q1!) / Number(tS_Q1!)) * 100 : null,
      promoterShareChange,
      totalShareChange,
      priorQuarterGap,
      reason: `indeterminate: totalShares is zero/invalid (Q=${tS_Q}, Q-1=${tS_Q1}) — cannot compute promoter %${gapNote}`,
    };
  }

  const promoterPctQ = (Number(pS_Q!) / Number(tS_Q!)) * 100;
  const promoterPctQ1 = (Number(pS_Q1!) / Number(tS_Q1!)) * 100;
  const pctDrop = promoterPctQ1 - promoterPctQ; // positive = % fell

  const base = {
    pctDrop,
    promoterPctQ,
    promoterPctQ1,
    promoterShareChange,
    totalShareChange,
    priorQuarterGap,
  };

  // ── NO_DROP: promoter % flat or rose ──
  if (pctDrop <= 0) {
    const bothZero = pS_Q! === 0n && pS_Q1! === 0n;
    return {
      ...base,
      verdict: "no_drop",
      reason: bothZero
        ? `no_drop: zero promoter stake in both quarters — no stake to reduce${gapNote}`
        : `no_drop: promoter % flat or rose (${promoterPctQ1.toFixed(2)}% → ${promoterPctQ.toFixed(2)}%)${gapNote}`,
    };
  }

  // pctDrop > 0 from here. tol uses the prior promoter count.
  const tol = TOL_FRACTION * Number(pS_Q1!);

  // ── DILUTION: promoter count STABLE and total count ROSE ──
  // The promoter didn't sell; newly-issued shares diluted their %.
  if (Math.abs(promoterShareChange) <= tol && totalShareChange > tol) {
    return {
      ...base,
      verdict: "dilution",
      reason:
        `dilution: promoter % fell ${pctDrop.toFixed(2)}pp but promoter count is stable ` +
        `(Δ=${promoterShareChange}, within ±${Math.round(tol)} tol) while total shares rose ` +
        `(Δ=${totalShareChange}) — new issuance, not a sell-down${gapNote}`,
    };
  }

  // ── GENUINE_REDUCTION: promoter count actually FELL ──
  // (Includes a promoter exiting to literally zero — that is a real reduction,
  // not dilution.)
  if (promoterShareChange < -tol) {
    const exited = pS_Q! === 0n;
    return {
      ...base,
      verdict: "genuine_reduction",
      reason:
        `genuine_reduction: promoter % fell ${pctDrop.toFixed(2)}pp and promoter count fell ` +
        `(Δ=${promoterShareChange}, beyond −${Math.round(tol)} tol)` +
        (exited ? " — promoter exited to zero" : " — promoter sold shares") +
        gapNote,
    };
  }

  // ── INDETERMINATE: % fell but the share counts fit no clean pattern ──
  // e.g. promoter stable yet total ~flat (data inconsistency), or promoter count
  // actually ROSE while % fell. Fail-safe: labeled, never silently classified.
  return {
    ...base,
    verdict: "indeterminate",
    reason:
      `indeterminate: promoter % fell ${pctDrop.toFixed(2)}pp but share counts fit neither ` +
      `dilution nor sell-down (promoterΔ=${promoterShareChange}, totalΔ=${totalShareChange}, ` +
      `tol=±${Math.round(tol)}) — possible data inconsistency${gapNote}`,
  };
}

/** True if `priorDate` is not the immediately preceding quarterly filing, i.e. a
 * quarter is missing between the two rows (calendar-cadence heuristic). */
export function isPriorQuarterGap(currentDate: Date, priorDate: Date): boolean {
  const months =
    (currentDate.getUTCFullYear() - priorDate.getUTCFullYear()) * 12 +
    (currentDate.getUTCMonth() - priorDate.getUTCMonth());
  return months > GAP_MONTHS_THRESHOLD;
}
