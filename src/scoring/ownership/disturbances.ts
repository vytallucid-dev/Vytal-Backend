// File: src/scoring/ownership/disturbances.ts
//
// OWNERSHIP PRIMARY — step 3: the DISTURBANCE PENALTIES (quarterly-state negatives).
// PRIMARY OWNS THESE OUTRIGHT.
//
//   R2  Promoter exit          — promoter % drops >5pp in one quarter, EX-DILUTION → −6
//   R6  Distribution pattern   — promoter ↓ AND FII ↓ AND retail ↑, SAME quarter   → −8
//   PF  Prolonged FII exit     — FII declines ≥0.5pp each quarter, 4 consecutive Q  → −4
//
// ── FIREWALL (Primary owns vs Flow will own) ──────────────────────────────────
// These three are QUARTERLY-SHAREHOLDING DISTURBANCE reads, and they are FINAL here.
// The later Flow layer (categories A/B/C/D, the [-12,+12] adjustment) MUST NOT
// re-score:
//   • quarterly distribution        → R6 owns it
//   • single-quarter promoter exit  → R2 owns it
//   • single-quarter / sustained institutional exit → R2 + PF own it
// If Flow ever needs these signals it must READ Primary's stored facts, never
// recompute a competing penalty. Double-counting here is the bug the firewall prevents.
//
// R2 ↔ Half-A: R2 CONSUMES the C-3 Half-A dilution detector (classifyDilution).
// A QIP/rights/preferential issue can drop a promoter's % while their absolute
// count is unchanged — that is dilution, not an exit, and R2 must NOT fire on it.

import {
  classifyDilution,
  isPriorQuarterGap,
  type DilutionVerdict,
} from "./dilution.js";
import type { OwnershipQuarter } from "./types.js";

// Spec penalty values + thresholds (explicit, not tuned).
export const R2_PENALTY = -6;
export const R2_DROP_PP = 5; // promoter % drop must be > 5pp (strict)
export const R6_PENALTY = -8;
// R6 directional ROUNDING/NOISE floor — explicitly NOT a calibrated threshold
// (CN-8), same spirit as the dilution detector's `tol`. Its ONLY job is to stop a
// rounding artifact being read as a real directional move: a per-leg QoQ move
// smaller than this (pp) is reporting noise and does NOT count toward the
// promoter↓/FII↓/retail↑ pattern. Without it a rock-stable promoter (a −0.01pp
// rounding wiggle) would complete a spurious triple and eat a −8.
export const R6_MIN_MOVE_PP = 0.05;
export const PF_PENALTY = -4;
export const PF_MIN_DECLINE_PP = 0.5; // FII must fall ≥0.5pp each quarter
export const PF_QUARTERS = 4; // for 4 consecutive quarters (→ 4 QoQ transitions, 5 data points)

// ── R2 — Promoter exit, ex-dilution ──────────────────────────────────────────

export interface R2Result {
  fired: boolean;
  penalty: number; // R2_PENALTY when fired, else 0
  /** Half-A's COUNT-derived promoter-% drop (positive = % fell). The R2 trigger
   * magnitude is taken from Half-A so the gate and the trigger agree on one
   * measurement. null when Half-A could not compute a % (missing/zero counts). */
  pctDrop: number | null;
  /** The Half-A verdict that GATED the decision (decomposability requirement). */
  gatingVerdict: DilutionVerdict;
  /** Half-A's priorQuarterGap — true when the R2 drop spans a missing quarter. */
  spansGap: boolean;
  reason: string;
}

/**
 * R2: fires ONLY when the promoter-% drop is >5pp AND Half-A's verdict is NOT
 * 'dilution'.
 *   • 'dilution'          → does NOT fire (issuance artifact — the firewall working)
 *   • 'genuine_reduction' → fires (a real sell-down / exit)
 *   • 'indeterminate'     → fires (fail-safe: an unexplained >5pp drop stays eligible)
 *   • 'no_drop'           → pctDrop ≤ 0, so the >5pp bar is never met → does not fire
 * PURE.
 */
export function computeR2(
  current: OwnershipQuarter,
  prior: OwnershipQuarter | null,
): R2Result {
  const dil = classifyDilution(current, prior);
  const verdict = dil.verdict;
  const drop = dil.pctDrop;
  const gapNote = dil.priorQuarterGap ? " [drop spans a quarter gap]" : "";

  // The >5pp bar requires a known (non-null) drop. A null drop (missing/zero
  // counts → indeterminate) cannot ASSERT a >5pp fall, so R2 stays unfired.
  const dropExceeds = drop !== null && drop > R2_DROP_PP;

  if (!dropExceeds) {
    return {
      fired: false,
      penalty: 0,
      pctDrop: drop,
      gatingVerdict: verdict,
      spansGap: dil.priorQuarterGap,
      reason:
        `R2 not fired: promoter-% drop ${drop === null ? "n/a" : drop.toFixed(2) + "pp"} ` +
        `≤ ${R2_DROP_PP}pp bar (Half-A=${verdict})${gapNote}`,
    };
  }

  if (verdict === "dilution") {
    return {
      fired: false,
      penalty: 0,
      pctDrop: drop,
      gatingVerdict: verdict,
      spansGap: dil.priorQuarterGap,
      reason:
        `R2 SUPPRESSED by Half-A firewall: drop ${drop!.toFixed(2)}pp > ${R2_DROP_PP}pp ` +
        `but verdict=dilution (new issuance, not an exit)${gapNote}`,
    };
  }

  // genuine_reduction | indeterminate, with drop > 5pp → fire.
  return {
    fired: true,
    penalty: R2_PENALTY,
    pctDrop: drop,
    gatingVerdict: verdict,
    spansGap: dil.priorQuarterGap,
    reason:
      `R2 fired (−6): promoter-% drop ${drop!.toFixed(2)}pp > ${R2_DROP_PP}pp, ` +
      `Half-A verdict=${verdict} (not dilution)${gapNote}`,
  };
}

// ── R6 — Distribution pattern ─────────────────────────────────────────────────

export interface R6Result {
  fired: boolean;
  penalty: number; // R6_PENALTY when fired, else 0
  promoterDelta: number | null; // Q − Q1 (negative = promoter fell)
  fiiDelta: number | null; // negative = FII fell
  retailDelta: number | null; // positive = retail rose
  reason: string;
}

/**
 * R6: promoter ↓ AND FII ↓ AND retail ↑ in the SAME quarter → −8. Reads the CLEAN
 * stored percentage buckets (promoterPct / fiiPct / retailPct), which are correct
 * post the FII/DII fix. Strict directional moves; requires all three present. PURE.
 */
export function computeR6(
  current: OwnershipQuarter,
  prior: OwnershipQuarter | null,
): R6Result {
  if (!prior) {
    return { fired: false, penalty: 0, promoterDelta: null, fiiDelta: null, retailDelta: null,
      reason: "R6 not fired: no prior quarter" };
  }
  const p = current.promoterPct, p1 = prior.promoterPct;
  const f = current.fiiPct, f1 = prior.fiiPct;
  const r = current.retailPct, r1 = prior.retailPct;
  if (p === null || p1 === null || f === null || f1 === null || r === null || r1 === null) {
    return { fired: false, penalty: 0, promoterDelta: null, fiiDelta: null, retailDelta: null,
      reason: "R6 not fired: missing promoter/FII/retail % in Q or Q-1" };
  }

  const promoterDelta = p - p1;
  const fiiDelta = f - f1;
  const retailDelta = r - r1;
  // Each leg must be a GENUINE directional move (beyond the noise band), not a
  // sub-reporting-precision wiggle.
  const fired =
    promoterDelta <= -R6_MIN_MOVE_PP &&
    fiiDelta <= -R6_MIN_MOVE_PP &&
    retailDelta >= R6_MIN_MOVE_PP;

  return {
    fired,
    penalty: fired ? R6_PENALTY : 0,
    promoterDelta,
    fiiDelta,
    retailDelta,
    reason: fired
      ? `R6 fired (−8): promoter ↓${(-promoterDelta).toFixed(2)} & FII ↓${(-fiiDelta).toFixed(2)} ` +
        `& retail ↑${retailDelta.toFixed(2)} (same quarter — distribution to retail)`
      : `R6 not fired: promoterΔ=${promoterDelta.toFixed(2)} fiiΔ=${fiiDelta.toFixed(2)} ` +
        `retailΔ=${retailDelta.toFixed(2)} (need promoter↓ & FII↓ & retail↑, each ≥ ${R6_MIN_MOVE_PP}pp)`,
  };
}

// ── PF — Prolonged FII exit ───────────────────────────────────────────────────

export interface ProlongedFiiResult {
  fired: boolean;
  penalty: number; // PF_PENALTY when fired, else 0
  /** Per-transition FII declines (pp, positive = fell), most-recent transition
   * first, in the trailing window actually examined. */
  declines: number[];
  transitionsChecked: number;
  reason: string;
}

/**
 * PF: FII holding declines ≥0.5pp in each of the 4 most-recent CONSECUTIVE
 * quarterly transitions ending at the snapshot → −4. Needs 5 consecutive data
 * points (4 transitions) with fiiPct present and no calendar gap. PURE.
 *
 * @param rows        full series, asOnDate ASC
 * @param snapshotIdx the quarter being scored (default latest)
 */
export function computeProlongedFii(
  rows: OwnershipQuarter[],
  snapshotIdx: number = rows.length - 1,
): ProlongedFiiResult {
  const declines: number[] = [];

  if (snapshotIdx < PF_QUARTERS) {
    return { fired: false, penalty: 0, declines, transitionsChecked: 0,
      reason: `PF not fired: insufficient history (need ${PF_QUARTERS + 1} consecutive quarters)` };
  }

  for (let k = 0; k < PF_QUARTERS; k++) {
    const cur = rows[snapshotIdx - k];
    const prv = rows[snapshotIdx - k - 1];

    if (isPriorQuarterGap(cur.asOnDate, prv.asOnDate)) {
      return { fired: false, penalty: 0, declines, transitionsChecked: k,
        reason: `PF not fired: calendar gap in the trailing window (broke "consecutive") after ${k} transition(s)` };
    }
    if (cur.fiiPct === null || prv.fiiPct === null) {
      return { fired: false, penalty: 0, declines, transitionsChecked: k,
        reason: `PF not fired: missing fiiPct in the trailing window after ${k} transition(s)` };
    }

    const decline = prv.fiiPct - cur.fiiPct; // positive = FII fell this quarter
    declines.push(decline);
    if (decline < PF_MIN_DECLINE_PP) {
      return { fired: false, penalty: 0, declines, transitionsChecked: k + 1,
        reason: `PF not fired: a quarter's FII decline ${decline.toFixed(2)}pp < ${PF_MIN_DECLINE_PP}pp ` +
          `(needs ≥${PF_MIN_DECLINE_PP}pp in each of ${PF_QUARTERS} consecutive quarters)` };
    }
  }

  return {
    fired: true,
    penalty: PF_PENALTY,
    declines,
    transitionsChecked: PF_QUARTERS,
    reason:
      `PF fired (−4): FII declined ≥${PF_MIN_DECLINE_PP}pp in each of the last ${PF_QUARTERS} ` +
      `consecutive quarters [${declines.map((d) => d.toFixed(2)).join(", ")} pp]`,
  };
}
