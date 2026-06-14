// File: src/scoring/ownership/pledging.ts
//
// OWNERSHIP PRIMARY — step 2: the PLEDGING ADJUSTMENT (+ the R1 red flag).
//
// pledgeRatio is computed from COUNTS, never from the stored percentage fields:
// promoterPledgedPct / promoterPledgedSharesPct are CORRUPT and are ignored
// entirely (same discipline as the dilution detector, which reads counts only —
// see [[ownership-dilution-detector]]).
//
//   pledgeRatio = pledgedShares / promoterShares * 100   (Number() of BigInt counts,
//                                                          guarded promoterShares > 0)
//
// SCOPE — PLEDGE-PROPER ONLY: pledgedShares is NumberOfSharesEncumberedUnderPledged.
// Non-Disposal-Undertaking (NDU) encumbrance is NOT included in this build; it is a
// flagged OPEN SPEC ITEM. If/when NDU is folded in, it belongs in a separate,
// clearly-labelled encumbrance term — do not silently widen `pledgedShares`.
//
// TWO SEPARATE OUTPUTS (do not conflate):
//   1. the LADDER adjustment  → a pillar nudge (0 / +1 / −2 / −4), summed into the subtotal
//   2. the R1 breach          → a RED FLAG (a score_red_flags row), NOT a pillar nudge
// Even when R1 fires, the ladder still contributes its own independent nudge.

import type { OwnershipQuarter } from "./types.js";

export type PledgeLadderState =
  | "zero" //            current pledgeRatio = 0  → 0 (baseline preserved)
  | "falling" //         pledgeRatio fell QoQ     → +1
  | "stable" //          pledgeRatio steady, > 0  → −2
  | "rising" //          pledgeRatio rose QoQ     → −4
  | "dormant_no_data" // §11.5.1: pledgedShares absent → 0, RECORDED (dormant ≠ silent 0)
  | "no_promoter" //     promoterShares ≤ 0 → ratio undefined → 0, RECORDED
  | "no_prior"; //       no prior quarter for a QoQ comparison → 0, RECORDED

/** Ladder point values (spec §11.5). dormant / no_promoter / no_prior all
 * contribute 0 but are DISTINCT recorded states, never a silent 0. */
export const LADDER_POINTS: Record<PledgeLadderState, number> = {
  zero: 0,
  falling: +1,
  stable: -2,
  rising: -4,
  dormant_no_data: 0,
  no_promoter: 0,
  no_prior: 0,
};

// QoQ "stable" band — a pure ROUNDING / NOISE-ABSORPTION floor, explicitly NOT a
// calibrated threshold (CN-8), mirroring the dilution detector's `tol`. Its ONLY
// job is to stop a rounding artifact in the pledge RATIO from being read as a real
// QoQ direction (rising/falling); a move within ±this many pp is "unchanged to
// reporting precision" → stable. It does NOT decide materiality — the −2 bottom
// rung already encodes that any positive pledge is material (operator ruling).
export const PLEDGE_STABLE_BAND_PP = 0.01;

// R1 thresholds (spec — explicit, not tuned).
export const R1_PLEDGE_RATIO_PCT = 50; // pledgeRatio > 50% OF PROMOTER HOLDING
export const R1_QOQ_RISE_PP = 10; // OR a +10pp single-quarter rise in pledgeRatio

// NOTE (operator ruling): there is NO materiality floor on the pledge ratio. Pledge
// is a CATEGORICAL signal — any pledge ratio > 0 lands on the −2 "stable, >0" rung
// (or +1 falling / −4 rising per QoQ). A "negligible-pledge" floor would be
// curve-fitting; the −2 bottom rung already encodes materiality. So a BAJAJ-AUTO-
// type 0.009% pledge CORRECTLY scores −2.

export interface PledgingResult {
  pledgeRatioQ: number | null; // pledged/promoter*100, current quarter (Q)
  pledgeRatioQ1: number | null; // prior quarter (Q-1)
  qoqRisePp: number | null; // ratioQ − ratioQ1 (positive = rose); null if no prior ratio
  ladderState: PledgeLadderState;
  ladderAdjustment: number; // 0 | +1 | −2 | −4 — the pillar nudge
  /** true for the three recorded zero-states (dormant_no_data / no_promoter /
   * no_prior): contributed 0, but as an explicit state, not an absence. */
  dormant: boolean;
  reason: string;

  // ── R1 RED FLAG (separate output; a red flag, NOT a pillar nudge) ──────────
  r1Breach: boolean;
  r1Reasons: string[];
}

/** pledgeRatio from counts, or null when undefined (missing pledge data, or
 * promoterShares ≤ 0). PLEDGE-PROPER only. */
function pledgeRatio(q: OwnershipQuarter): number | null {
  if (q.pledgedShares === null) return null; // pledge data absent
  if (q.promoterShares === null || q.promoterShares <= 0n) return null; // guard > 0
  return (Number(q.pledgedShares) / Number(q.promoterShares)) * 100;
}

/**
 * Compute the pledging ladder adjustment + R1 breach at the snapshot. PURE.
 *
 * @param current snapshot quarter (Q)
 * @param prior   immediately preceding quarter (Q-1), or null
 */
export function computePledging(
  current: OwnershipQuarter,
  prior: OwnershipQuarter | null,
): PledgingResult {
  const empty: Omit<PledgingResult, "ladderState" | "ladderAdjustment" | "dormant" | "reason"> = {
    pledgeRatioQ: null,
    pledgeRatioQ1: null,
    qoqRisePp: null,
    r1Breach: false,
    r1Reasons: [],
  };

  // ── §11.5.1 DORMANT: pledge data absent for the stock (no pledgedShares) ──
  // The ladder is dormant (0) and that dormant state is RECORDED — consistent
  // with the dormant ≠ zero discipline. (Rare in current data; pledgedShares is
  // populated/zero for ~all rows — but handled.)
  if (current.pledgedShares === null) {
    return {
      ...empty,
      ladderState: "dormant_no_data",
      ladderAdjustment: LADDER_POINTS.dormant_no_data,
      dormant: true,
      reason:
        "§11.5.1 dormant: pledgedShares absent — pledging ladder DORMANT (0 adj), recorded (not a silent 0)",
    };
  }

  // ── No promoter holding → pledge ratio undefined (e.g. ITC-type zero-promoter) ──
  if (current.promoterShares === null || current.promoterShares <= 0n) {
    return {
      ...empty,
      ladderState: "no_promoter",
      ladderAdjustment: LADDER_POINTS.no_promoter,
      dormant: true,
      reason:
        "no promoter holding (promoterShares ≤ 0) — pledge ratio undefined → ladder 0, recorded (no spurious trigger)",
    };
  }

  const ratioQ = pledgeRatio(current)!; // defined past the guards above
  const ratioQ1 = prior ? pledgeRatio(prior) : null;
  const qoqRisePp = ratioQ1 !== null ? ratioQ - ratioQ1 : null;

  // ── R1 breach (SEPARATE red-flag output; does NOT affect the ladder nudge) ──
  const r1Reasons: string[] = [];
  if (ratioQ > R1_PLEDGE_RATIO_PCT) {
    r1Reasons.push(
      `pledgeRatio ${ratioQ.toFixed(2)}% > ${R1_PLEDGE_RATIO_PCT}% of promoter holding`,
    );
  }
  if (qoqRisePp !== null && qoqRisePp >= R1_QOQ_RISE_PP) {
    r1Reasons.push(
      `pledgeRatio rose +${qoqRisePp.toFixed(2)}pp QoQ (≥ +${R1_QOQ_RISE_PP}pp single-quarter)`,
    );
  }
  const r1Breach = r1Reasons.length > 0;

  const finish = (state: PledgeLadderState, reason: string): PledgingResult => ({
    pledgeRatioQ: ratioQ,
    pledgeRatioQ1: ratioQ1,
    qoqRisePp,
    ladderState: state,
    ladderAdjustment: LADDER_POINTS[state],
    dormant: state === "no_prior",
    reason,
    r1Breach,
    r1Reasons,
  });

  // ── Ladder (spec precedence: zero first, then QoQ direction) ──────────────
  // LITERAL ladder: only an EXACT zero pledge takes the "zero" rung. Any pledge
  // ratio > 0 is categorically material → −2/+1/−4 per QoQ (no materiality floor).
  // NOTE: a drop-TO-zero lands in "zero" (0), not "falling" (+1) — the zero rung
  // takes precedence per spec ("zero pledging → 0, baseline preserved").
  if (ratioQ === 0) {
    return finish("zero", `zero pledging (pledgeRatio = 0.00%) → 0, baseline preserved`);
  }
  if (ratioQ1 === null) {
    // Positive pledge but no prior ratio to compare against → cannot assess QoQ
    // direction. Conservative: 0, recorded (not penalised on an unassessable move).
    return finish(
      "no_prior",
      `pledgeRatio ${ratioQ.toFixed(2)}% but no prior quarter ratio for QoQ comparison → 0, recorded`,
    );
  }

  const delta = ratioQ - ratioQ1; // positive = rose (worse)
  if (Math.abs(delta) <= PLEDGE_STABLE_BAND_PP) {
    return finish(
      "stable",
      `pledgeRatio stable & > 0 (${ratioQ1.toFixed(2)}% → ${ratioQ.toFixed(2)}%, |Δ| ≤ ${PLEDGE_STABLE_BAND_PP}pp) → −2`,
    );
  }
  if (delta < 0) {
    return finish(
      "falling",
      `pledgeRatio falling QoQ (${ratioQ1.toFixed(2)}% → ${ratioQ.toFixed(2)}%, Δ=${delta.toFixed(2)}pp) → +1`,
    );
  }
  return finish(
    "rising",
    `pledgeRatio rising QoQ (${ratioQ1.toFixed(2)}% → ${ratioQ.toFixed(2)}%, Δ=+${delta.toFixed(2)}pp) → −4`,
  );
}
