// File: src/scoring/metric-scoring/lens-guards.ts
//
// CHANGE 2.6, AS AMENDED BY ADDENDUM C.1 — THE TWO PEER-LENS GUARDS.
//
// Both suppress Lens 2 (the peer cross-section) when the comparison it is about to make is
// not a comparison worth making. When either fires, L2 is UNAVAILABLE and the metric
// composite renormalises over L1 and L3 — which lenses/composite.ts already does.
//
// ★ EACH GUARD APPLIES TO EXACTLY ONE PILLAR, AND THIS TOOK THREE ATTEMPTS TO GET RIGHT.
//   The record's own history is the warning:
//     · first answer  — both guards on both pillars. Shipped in the frozen panel.
//     · second answer — Addendum B.1: sigma is what destroyed Momentum's peer lens
//       (accuracy 67%->60%, catch 58%->44%, spread +8.9->+2.6), so make it Foundation-only
//       and leave bad-class on both.
//     · THIRD AND FINAL — Addendum C.1 runs the same test on Foundation and finds the
//       MIRROR IMAGE: there it is BAD-CLASS that destroys the lens (83%->70% accuracy,
//       84%->67% catch) while sigma is benign and gives the best spread of any arm (+15.9).
//
//   So the shipping configuration is neither "both" nor "sigma Foundation-only". It is
//   EACH GUARD ON THE ONE PILLAR WHERE IT HAS A CASE:
//
//       sigma      -> FOUNDATION only
//       bad-class  -> MOMENTUM only
//
//   Getting this wrong is invisible: the run completes, the composite barely moves
//   (-0.2/1000, band [-3.8, +3.6]), and only a per-pillar LENS readout shows the damage.
//   That is precisely why the regression went unnoticed for a whole programme stage.
//
// ★ NEITHER GUARD TOUCHES THE BANK STACK. The calibration's lens pass is non-bank by
//   construction and bank Momentum comes from a separate stack these guards never reach,
//   so every figure above is on the 83 non-banks. Production shares one wiring function
//   between banks and non-banks, so the caller must NOT set these flags for a banking PG —
//   asserted in tmp/v2/guards-check.ts rather than left to a comment.

import { computeLens1, type AbsoluteBars } from "../lenses/lens-bars.js";
import type { BarDirection } from "../lenses/types.js";

/** The L1 score that means "cleared the acceptable bar". Below it the reading is not sound. */
export const ACCEPTABLE_L1 = 60;

/** Minimum peers before either guard is allowed an opinion (u6-lens.cjs: `l1.length < 4`). */
export const GUARD_MIN_PEERS = 4;

/**
 * BAD-CLASS GUARD — MOMENTUM ONLY.
 *
 * "Best in a bad class" must not read as good. A relative lens cannot certify a company
 * for topping a field that is failing in absolute terms. BEL's cash conversion collapsed
 * 0.38 -> 0.09 and its peer score ROSE 45.1 -> 49.5, because the defence peer group's own
 * mean conversion is 0.34-0.56.
 *
 * Fires when the MEDIAN peer L1 fails the acceptable bar. The claim — "this whole peer
 * group is having a bad year, so topping it is not health" — is substantive and survives
 * translation from a level to a growth rate intact, which is why it keeps its case on
 * Momentum and measures neutral-to-positive there (spread +8.9 -> +10.2).
 *
 * ⚠ ON FOUNDATION IT IS A MISCUT-BAR PROXY, NOT A HEALTH SIGNAL. It fires on 40-57% of
 *   Foundation peer-group-quarters — which is the 51 known miscut bar rows showing through,
 *   not fifty per cent of industries genuinely failing. C.1 rules it out there.
 *
 * @param peerValues the RAW values of the peer cross-section (the same set L2's mean/sd is over)
 */
export function l2BadClassGuard(peerValues: number[], bars: AbsoluteBars, direction: BarDirection): boolean {
  const l1 = peerValues.map((v) => computeLens1(v, bars, direction).score);
  if (l1.length < GUARD_MIN_PEERS) return false;
  const s = [...l1].sort((a, b) => a - b);
  // The UPPER median on an even count — `s[s.length >> 1]`, not the two-point average.
  // Kept exactly as the calibration computes it: on a 4- or 6-peer group the two differ,
  // and the difference decides whether the guard fires at all.
  const medianL1 = s[s.length >> 1];
  return medianL1 < ACCEPTABLE_L1;
}

/**
 * SIGMA GUARD — FOUNDATION ONLY.
 *
 * A spread larger than the mean makes the z-score meaningless. Britannia's interest cover
 * has a peer mean of 199.01 and a spread of 229.39, producing a peer-lens range of 3.6
 * points across twelve quarters — a lens that cannot say anything.
 *
 * ⚠ WHY IT IS FOUNDATION-ONLY, WHICH IS THE PART THAT MATTERS. `sd > |mean|` is a
 *   coefficient-of-variation test. For a LEVEL metric bounded below by zero and centred
 *   well away from it — interest cover, cash conversion, asset turnover — CV > 1 genuinely
 *   marks a degenerate comparison. For a GROWTH RATE, a quantity centred near zero that
 *   takes both signs by construction, CV > 1 is THE ORDINARY STATE OF THE WORLD. On
 *   Momentum it fires on 82.8% of profit-growth and 55.7% of revenue-growth peer-group-
 *   quarters; one firing example is a peer group whose revenue grows 6.9% on average with
 *   an 11.2-point spread, which is an industry where some companies grew 18% and some
 *   shrank 4%. That is exactly the comparison the peer lens exists to make, and the guard
 *   deletes it. It is not detecting a broken peer group; it is detecting that growth rates
 *   are centred near zero.
 */
export function l2SigmaGuard(peerMean: number, peerStdDev: number): boolean {
  return peerStdDev > Math.abs(peerMean);
}

/** Which guard suppressed L2, for the metric's recorded notes. null = none fired. */
export type L2Guard = "bad_class" | "sigma";
