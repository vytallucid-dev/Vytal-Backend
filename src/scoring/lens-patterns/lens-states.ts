// File: src/scoring/lens-patterns/lens-states.ts
//
// THE THREE LENS-STATE DERIVATIONS — pure reads over the persisted metric atom.
//
// Each derivation turns the stored lens columns into one of the discrete states in
// types.ts. They are DEFINITIONAL (§0.3): the moment the atom is read the state is
// true — there is nothing to predict, nothing to test.
//
// HONEST-EMPTY (§0.4, §5.4): a lens that cannot be computed returns not_evaluable —
// never a pass, a fail, or a fabricated value. A field-verdict (above/below_peer)
// is NEVER produced on too-few peers or an undefined near-band — those collapse to
// not_evaluable so the downstream catalog physically cannot fabricate a field claim.
//
// DIRECTION: already folded into the atom. l1Band is in goodness coordinates;
// l2Score/l3Score are orientation-corrected. So we read the fold FROM the oriented
// score's sign (score vs its applied anchor) and take the magnitude from the raw
// |value−μ|/σ (which is direction-independent). No second, drifting fold here.
//
// PURE. No DB, no I/O.

import {
  type MetricLensAtom,
  type LensTriplet,
  type L1State,
  type L2State,
  type L3State,
  L2_NEAR_BAND_SIGMA,
  L3_TREND_Z,
  DEFAULT_PEER_MIN_N,
} from "./types.js";

/** L1 — absolute bar. above = cleared the Acceptable bar or better; below = it did
 *  not (Concerning/Distress). Gated by l1Available (else not_evaluable).
 *
 *  The cut excellent/good/acceptable = above_bar is confirmed against how l1Band is
 *  assigned (lens-bars.ts): the band is "the highest bar the value cleared" — landing
 *  in `acceptable` means the value cleared the Acceptable bar (score ≥ 60), i.e. it
 *  is at/above the absolute-acceptability floor; `concerning`/`distress` did not. */
export function deriveL1State(a: MetricLensAtom): L1State {
  if (!a.l1Available || a.l1Band === null) return "not_evaluable";
  switch (a.l1Band) {
    case "excellent":
    case "good":
    case "acceptable":
      return "above_bar";
    case "concerning":
    case "distress":
      return "below_bar";
  }
}

/** L2 — peer cross-section. not_evaluable unless USABLE: l2Available AND peers ≥
 *  peerMinN AND σ>0. When σ=0 (peers identical) the near-band is UNDEFINED, so —
 *  even though L2 is "available" for SCORING — it is not_evaluable for PATTERN
 *  purposes (no field-verdict on an undefined band; briefing §2). near = within
 *  ±0.5σ of μ; otherwise above/below by the oriented score's sign. */
export function deriveL2State(a: MetricLensAtom, peerMinN: number = DEFAULT_PEER_MIN_N): L2State {
  if (!a.l2Available) return "not_evaluable";
  if (a.peerMean === null || a.peerStdDev === null || a.peerSampleN === null) return "not_evaluable";
  if (a.peerSampleN < peerMinN) return "not_evaluable"; // insufficient peers → NO field-verdict (§5.4)
  if (a.peerStdDev === 0) return "not_evaluable"; // σ=0 → near-band undefined (briefing §2)
  if (a.l2Score === null || a.l2AnchorApplied === null) return "not_evaluable"; // defensive

  const absDiff = Math.abs(a.rawValue - a.peerMean);
  if (absDiff <= L2_NEAR_BAND_SIGMA * a.peerStdDev) return "near_peer";
  // Outside the near-band: the oriented score's sign tells us the healthy direction
  // (score > anchor ⇔ zOriented > 0 ⇔ healthier than the field). zToScore is strictly
  // monotonic in zOriented when σ>0, so this agrees with sign(value−μ) folded by dir.
  return a.l2Score > a.l2AnchorApplied ? "above_peer" : "below_peer";
}

/** L3 — own-history trend. Gated by l3Available (window_n ≥ minEffectiveN; else
 *  not_evaluable). σ=0 sentinel → flat by construction (the stock's history is
 *  literally flat). Otherwise zOriented = sign(score−anchor)·|value−μ|/σ:
 *  |zOriented| < L3_TREND_Z → flat; ≥ +cut → improving; ≤ −cut → declining. */
export function deriveL3State(a: MetricLensAtom): L3State {
  if (!a.l3Available) return "not_evaluable";
  if (a.l3Mean === null || a.l3StdDev === null) return "not_evaluable"; // defensive
  if (a.l3StdDev === 0) return "flat"; // std_dev_zero guard → flat by construction
  if (a.l3Score === null || a.l3AnchorApplied === null) return "not_evaluable"; // defensive

  const absZ = Math.abs(a.rawValue - a.l3Mean) / a.l3StdDev;
  if (absZ < L3_TREND_Z) return "flat";
  // Healthy direction from the oriented score's sign (improving = healthier vs own past).
  return a.l3Score > a.l3AnchorApplied ? "improving" : "declining";
}

/** Derive the full triplet for one metric atom. */
export function deriveLensTriplet(a: MetricLensAtom, peerMinN: number = DEFAULT_PEER_MIN_N): LensTriplet {
  return {
    l1: deriveL1State(a),
    l2: deriveL2State(a, peerMinN),
    l3: deriveL3State(a),
  };
}
