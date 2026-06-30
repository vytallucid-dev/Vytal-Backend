// File: src/scoring/lens-patterns/standing-context.ts
//
// THE RANK SECOND-CHECK — pure-read standing band + standing-reconciled verdict text.
//
// CONFIRMATION ONLY (briefing §ruling): the three-lens triplet (L1,L2,L3) FIRES the
// pattern exactly as before — this module NEVER creates, suppresses, or overrides a
// pattern. It only reconciles the WORDING so the verdict sentence can't contradict the
// stock's ABSOLUTE rank in its peer group (e.g. an LP3 "trails an elite field" verdict
// rendered for the PG's #1 stock).
//
// SIMPLE VALUES ONLY (locked ruling ①/②/③): rank, N (PG size), and the per-lens
// evaluable count nL3 — NO z-scores, no σ, no new measurement. The band reads the
// already-computed peerStanding.perPillarRank; the thin-history check reads the
// already-computed PillarLensShares.nL3. Nothing here is fitted to any stock.
//
// PURE. No DB, no I/O.

import type { FieldVerdict } from "./types.js";

/** Plain standing band from absolute rank in the PG (ruling ①):
 *  #1 → top, #N → bottom (hard anchors); thirds between on pos=(N−rank)/(N−1):
 *  upper ≥0.66, mid 0.34–0.66, lower <0.34. Rank and N only. */
export type StandingBand = "top" | "upper" | "mid" | "lower" | "bottom";

export interface StandingContext {
  rank: number;
  n: number;
  band: StandingBand;
}

export function standingBand(rank: number, n: number): StandingBand {
  if (n <= 1) return "mid"; // degenerate single-member PG → no meaningful standing
  if (rank <= 1) return "top"; // hard anchor: PG leader
  if (rank >= n) return "bottom"; // hard anchor: PG laggard
  const pos = (n - rank) / (n - 1); // 1 = top … 0 = bottom
  if (pos >= 0.66) return "upper";
  if (pos >= 0.34) return "mid";
  return "lower";
}

// ── reconcile triggers (ruling ②/③) ───────────────────────────────────────────────
// TRAILS patterns (LP3, LM4) reconcile at {top, upper}; LP3/LM4 test the band inline.
// LEADS patterns (LM3, LM2, LM6) reconcile at {lower, bottom}.
const LEADS_RECONCILE = new Set<StandingBand>(["lower", "bottom"]);
const BREADTH_MIN_DENOM = 3; // nL3 ≥ 3 keeps "majority/broad"; ≤2 → "thin history" (ruling ③)

const metricWord = (n: number): string => (n === 1 ? "1 metric has" : `${n} metrics have`);

// ── PILLAR verdicts (LP1–LP6) ──────────────────────────────────────────────────────
/** Standing-reconciled verdict sentence for a fired LP pattern. band=null (no PG
 *  standing) and any non-trigger band fall through to the BASE wording, so only the
 *  contradictory cases change. shares.nL3 drives the breadth minimum-denominator honesty. */
export function composeLpVerdict(
  id: string,
  _fieldVerdict: FieldVerdict,
  band: StandingBand | null,
  shares: { nL3: number } | null,
): string {
  const nL3 = shares?.nL3 ?? null;
  const thin = nL3 !== null && nL3 < BREADTH_MIN_DENOM; // ≤2
  switch (id) {
    case "LP1":
      return "Strong on most metrics — absolutely and versus the field. Genuine breadth.";
    case "LP2":
      // "Leads the pond" — not on the reconcile list (no mismatch observed); base only.
      return "Most metrics trail their bars but beat the field — the relative strength is a weak-field artifact, not the stock being strong.";
    case "LP3":
      // "Trails an elite field" — reconcile at top/upper.
      if (band === "top")
        return "Leads the field on this pillar overall — on a few metrics it sits level with, not ahead of, an elite peer group.";
      if (band === "upper")
        return "Among the stronger names in the group — on some metrics it trails the very top of an elite field, not a weak one.";
      return "Most metrics clear their bars but trail the field — an elite peer group, not a weak stock.";
    case "LP4":
      if (thin)
        return `Improving against its own history, but only ${metricWord(nL3!)} enough own-history here — too thin to call broad improvement.`;
      return "A majority of metrics are improving against their own history — broad self-improvement.";
    case "LP5":
      if (thin)
        return `Sliding against its own history, but only ${metricWord(nL3!)} enough own-history here — too thin to call broad deterioration.`;
      return "A majority of metrics are sliding against their own history — broad self-deterioration.";
    case "LP6":
      if (thin)
        return `Most metrics clear their bars, but only ${metricWord(nL3!)} enough own-history — too thin to call the pillar broadly fading.`;
      return "Most metrics still clear their bars, but most are declining — strong, but fading.";
    default:
      return "";
  }
}

// ── METRIC verdicts (LM1–LM8) ──────────────────────────────────────────────────────
/** Standing-reconciled verdict sentence for a fired LM pattern. The metric's "field"
 *  claim is reconciled against the stock's PILLAR rank (band). band=null / non-trigger
 *  bands → BASE wording. */
export function composeLmVerdict(
  id: string,
  _fieldVerdict: FieldVerdict,
  band: StandingBand | null,
): string {
  const leadsReconcile = band !== null && LEADS_RECONCILE.has(band);
  switch (id) {
    case "LM1":
      return "Clears its bar, leads the field, and improving against its own history.";
    case "LM2":
      // "Best-in-class" — reconcile leads at lower/bottom.
      if (leadsReconcile)
        return "Clears its bar and leads the field on this metric, though the pillar ranks low overall — a bright spot, not best-in-class for the pillar.";
      return "Best-in-class on this metric, but no longer improving against its own history.";
    case "LM3":
      // "Leads a weak field" — reconcile leads at lower/bottom.
      if (band === "bottom")
        return "The whole field is weak on this metric, and this stock sits at the bottom of it — below its bar and at the back of a weak field.";
      if (band === "lower")
        return "Below its bar on this metric in a weak field, and near the lower end of the pillar overall — not a best-of-field read here.";
      return "Below its bar but above the peer mean — the field is weak on this metric, not uniquely this stock.";
    case "LM4":
      // "Trails an elite field" — reconcile at top/upper.
      if (band === "top")
        return "Clears its bar on this metric and sits just below an elite peer group on it — while the stock leads its pillar overall.";
      if (band === "upper")
        return "Clears its bar; trails only the very top of an elite field on this metric — among the stronger names in the pillar, not a weak one.";
      return "Clears its bar but sits below the peer mean — an elite field on this metric, not a weak stock.";
    case "LM5":
      return "Below its bar and the field, but improving against its own history.";
    case "LM6":
      // "Lead eroding" — reconcile leads at lower/bottom.
      if (leadsReconcile)
        return "Still above its bar on this metric and converging toward the field — the pillar ranks low overall, a soft spot easing, not a lead being lost.";
      return "Still above its bar, but its edge over the field has narrowed toward the average.";
    case "LM7":
      return "Below its bar, below the field, and declining — weak on all three lenses.";
    case "LM8":
      return "Below its bar and the field and not improving, inside an otherwise-acceptable pillar.";
    default:
      return "";
  }
}
