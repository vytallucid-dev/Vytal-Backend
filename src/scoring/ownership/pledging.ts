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
import { STOCK_FINDINGS } from "../../catalogue/stock-findings.js";
// ★ THE SAME ROUNDING HELPER THE OTHER 52 RULES USE. R1 not calling it was the whole defect.
import { roundToPrecision } from "../findings/format.js";

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

// ★ R1's TWO BARS, READ FROM THE CATALOGUE (catalogue/finding-facts.ts). They were declared here as
//   bare literals — the only home either number had — which is why nothing could ask the catalogue
//   what R1 fires at, and why "Thresholdpct: 50" was reaching a reader as though it were a fact about
//   their company. Relocation only: still 50 and 10.
//
// ⚠ THREE CALLERS SHARE THESE, AND THAT IS THE POINT. R1 fires on them, N7 mirrors them (a pledge
//   RELEASE is defined against the same 50%/10pp marks), and the Ownership pillar's ladder reads the
//   same `computePledging` result. One home means the R1/N7 symmetry is structural rather than a
//   comment asking two files to stay in step.
const R1_FACTS = STOCK_FINDINGS.ownership_R1_pledge.facts;
export const R1_PLEDGE_RATIO_PCT = R1_FACTS.thresholds.pledgeRatioPct;
export const R1_QOQ_RISE_PP = R1_FACTS.thresholds.qoqRisePp;

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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// R1 — THE FINDING SHAPE. ONE DERIVATION, ONE CONSUMER (AS OF STEP 4).
//
// R1 is THE FINDING, and there is now exactly one place it becomes one:
//   · rules/r1-pledging.ts    → a StockFinding row, on the FILING pass (all 504 stocks)
//
// The dual write is gone. ownership/primary.ts used to build a second, snapshot-bound copy for
// score_red_flags on the scoring pass (the 95); step 4 removed that write once alerts, the alert
// vocabulary and the portfolio's PS1 were rewired onto stock_findings. What primary.ts still emits is
// the PILLAR's observation of the breach, recorded on its own OwnershipScore row — not a finding.
//
// The builders below stay shared for the same reason they were introduced: N7 reads R1's standing
// (`r1StandingAt`) to avoid double-counting a pledge release against a pledge crisis, and the pillar
// records the same triggering values the rule stamps. One derivation means "N7's view of R1 matches
// R1's" is a structural property rather than something that happens to hold today. Same discipline as
// `computePledging` itself, which N7 and R1 already share so the RATIO can never diverge.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** File 1 §5A — red flags are Critical. The single source for both write paths. */
export const R1_SEVERITY = "critical";

/**
 * THE AUTHORED VERDICT (§1.6) — the reader-facing claim, composed from values already in the
 * PledgingResult. No new computation, no re-derivation.
 *
 * Two shapes, because R1 has two independent breach paths and the honest sentence differs:
 *   · level breach    — the ratio itself is above our declared 50% line
 *   · velocity breach — the ratio jumped ≥10pp in a single quarter (may still be under 50%)
 * Both may hold; the level statement leads because it is the standing condition.
 *
 * (Moved verbatim out of primary.ts so the filing rule renders the identical sentence. Before this,
 * R1 shipped only `reasons` — ENGINEER-facing diagnostics — and every ASHOKLEY card fell back to
 * "A red flag is standing on this stock.", the emptiest sentence on the live surface.)
 */
export function r1Verdict(p: PledgingResult): string {
  const ratio = p.pledgeRatioQ;
  const rise = p.qoqRisePp;
  const levelBreach = ratio !== null && ratio > R1_PLEDGE_RATIO_PCT;
  const riseBreach = rise !== null && rise >= R1_QOQ_RISE_PP;
  const parts: string[] = [];
  if (levelBreach) {
    parts.push(`${ratio!.toFixed(1)}% of the promoter holding is pledged — above the ${R1_PLEDGE_RATIO_PCT}% level at which we mark pledging as critical`);
  }
  if (riseBreach) {
    parts.push(
      levelBreach
        ? `and it rose ${rise!.toFixed(1)}pp in a single quarter`
        : `promoter pledging rose ${rise!.toFixed(1)}pp in a single quarter — at or above the ${R1_QOQ_RISE_PP}pp single-quarter move at which we mark it as critical`,
    );
  }
  return `Promoter pledging — ${parts.join(" ")}.`;
}

/**
 * The `triggeringValues` payload.
 *
 * ── ★ ROUNDED AT THE STAMP — R1 WAS THE ONLY RULE OF 53 THAT WAS NOT ─────────────────────────────
 * Every other rule runs its numbers through `roundToPrecision(x, FACTS.displayPrecision)` before
 * writing them into evidence. R1 wrote raw floats, so a card that printed this bag directly showed
 *
 *     Pledgeratioq: 51.367518980187285
 *
 * beside an S2 gap of 18.6 and a Momentum of 59.1 that the other rules had already rounded. The
 * verdict sentence two lines above has always said "51.4%" — the SAME number, formatted — so the
 * card was quoting one value at two precisions in two places.
 *
 * ⚠ ROUNDED AT THE STAMP, NEVER IN THE TEST. `computePledging` decides `r1Breach` on the raw ratio
 * and is untouched; only what is RECORDED changes. Rounding before the comparison would move the
 * firing boundary — a 50.04% ratio rounds to 50.0 and would stop breaching a `> 50` bar — which is a
 * recalibration wearing a formatting change's clothes. Same discipline as s2-sticky-divergence.ts,
 * which walks the sustain run on raw gaps and rounds only into `gapPp`.
 */
export function r1TriggeringValues(p: PledgingResult): Record<string, unknown> {
  const round = (x: number | null): number | null =>
    x === null ? null : roundToPrecision(x, R1_FACTS.displayPrecision);
  return {
    pledgeRatioQ: round(p.pledgeRatioQ),
    pledgeRatioQ1: round(p.pledgeRatioQ1),
    qoqRisePp: round(p.qoqRisePp),
    thresholdPct: R1_PLEDGE_RATIO_PCT,
    thresholdQoqRisePp: R1_QOQ_RISE_PP,
    verdict: r1Verdict(p),
  };
}

/** ★ THE PERSISTED EVIDENCE. What score_red_flags.triggeringValues actually holds today —
 *  `buildOwnershipScoreData` merges `reasons` in under `breaches` at the write, so the filing
 *  rule's `evidence` must carry it too or the two rows would differ by one key. */
export function r1Evidence(p: PledgingResult): Record<string, unknown> {
  return { ...r1TriggeringValues(p), breaches: p.r1Reasons };
}

/**
 * ★ WAS R1 STANDING AT `rows[idx]`? The one place that question is answered.
 *
 * N7's anti-double-count needs it (a pledge fall that CLEARS a standing R1 belongs to Family J, not
 * to N7) and it was open-coding `computePledging(prior, priorPrior).r1Breach` — correct, but it
 * re-derived a verdict R1 also derives, with the index arithmetic inline at the call site. Now both
 * rules ask the same named question of the same helper.
 *
 * Returns false for an out-of-range index — "not standing" is the right answer when there is no
 * such quarter to stand in.
 */
export function r1StandingAt(rows: OwnershipQuarter[], idx: number): boolean {
  if (idx < 0 || idx >= rows.length) return false;
  return computePledging(rows[idx], idx >= 1 ? rows[idx - 1] : null).r1Breach;
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
