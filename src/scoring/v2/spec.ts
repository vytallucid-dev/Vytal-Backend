// File: src/scoring/v2/spec.ts
//
// THE SCORING SPEC AND BAR VINTAGE IN FORCE. One instrument, no switch.
//
// v2 is THE Health Score. It replaced v1 on 5 September 2026 — rolling Foundation, bank
// quarterly cadence, two per-pillar peer-lens guards, M5 -> the operating share of pre-tax
// profit, the rebuilt Ownership pillar, the Market weight halved, a re-cut bar set and a
// re-banded scale. There is no v1 code path and no flag: a scoring pass computes v2 because
// that is the only thing it can compute.
//
// ★ WHY THERE IS NO FLAG ANY MORE, AND WHY THERE WAS ONE. The migration landed in nine
//   phases against a live database, and a switch was the only way to keep production
//   byte-identical while half the change was in the tree. Once the historical rebuild put
//   every in-force snapshot on this spec, the switch became the hazard it had been guarding
//   against: a pass that resolved "off" would have written a v1 row as the head of a v2
//   history and re-opened the seam the rebuild exists to close. So it is gone.
//
// ★ WHAT REMAINS OF v1, AND WHY IT IS NOT AN ALTERNATIVE ENGINE. Two things, and both are
//   PROVENANCE rather than a code path:
//     · the `2026.1` band mapping (composite/label.ts) — 5,920 superseded snapshots are
//       pinned to it, and re-deriving their band under today's cuts would relabel a quarter
//       to a band it was never published under;
//     · the `v5.5.1` bar rows in score_metric_bar_sets — those snapshots' MetricScore rows
//       FK straight at them.
//   Neither is reachable from a scoring pass. Deleting either would not simplify the
//   instrument; it would make history lie about itself.
//
// ★ AND THE ANNUAL METRIC FORMS ARE NOT v1 EITHER. foundation.ts still exports f1Roce and
//   friends, and banking.ts still exports its annual readings, because v2's OWN
//   specification is TTM-first with an ANNUAL FALLBACK: a company short of four consecutive
//   quarters keeps the metric rather than losing it and thinning its pillar against the
//   §14.4 floor. They are a branch of v2, not a survival of v1.

/** The scoring spec every pass writes under. Stamped on every snapshot and inside
 *  snapshotInputsFingerprint, so a snapshot always names the instrument that produced it. */
export const SCORING_SPEC_VERSION = "2026.2";

/** The bar vintage every pass reads: the v5.5.1 derivation with change 2.7's 34 re-cut rows,
 *  plus change 2.9's ladder for M5_OPSHARE.
 *
 *  ★ SELECTED BY NAME, NOT BY DATE, AND THAT IS LOAD-BEARING. score-pass resolves bars at
 *    `new Date()` on purpose — one fixed measuring stick is what makes 2023 and 2026
 *    comparable, so a point-in-time rescore of FY23Q4 still uses today's ladders. The
 *    consequence is that `inForceFrom` CANNOT separate two vintages: a row given a later
 *    date wins for every pass. Both vintages therefore share inForceFrom 2026-06-17 and are
 *    told apart by MetricBarSet.specVersionId. */
export const BAR_SPEC_VERSION = "v5.5.1+v2recut";

/** Provenance for the ScoringSpecVersion row a pass get-or-creates. */
export const SCORING_SPEC_NOTES =
  "v2 Health Score: rolling Foundation (2.1), bank quarterly cadence (2.2/2.3), " +
  "Market weight 20%->10% (2.4), Ownership rebuild (2.5), sigma guard on Foundation / " +
  "bad-class guard on Momentum (2.6 as amended by Addendum C.1), re-cut bar rows (2.7), " +
  "per-company accounting basis on both sides of Foundation (2.8), " +
  "M5 -> operating share of pre-tax profit (2.9).";
