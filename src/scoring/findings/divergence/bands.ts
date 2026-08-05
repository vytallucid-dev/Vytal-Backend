// File: src/scoring/findings/divergence/bands.ts
//
// THE DIVERGENCE FAMILY'S SHARED SCALES — Vytal_Divergence_Tool_Spec §1.1 (what counts as a
// divergence) and §1.2 (severity IS the gap). PURE. Every D-pattern reads these; none re-derives
// them, so the "minor band never surfaces" law is enforced in one place rather than seven.
//
// ── §1.1 · WHAT COUNTS AS A DIVERGENCE ─────────────────────────────────────────────────────────────
//   ≤ 7      ALIGNED   no divergence. Proven neutral (−0.1%, 49% positive, n=226) — "there is
//                      genuinely nothing to read below this line". Rendered by the tool as S1, which
//                      is deliberately NOT a finding (see the S1 note below).
//   8 – 11   MINOR     "A gap exists but carries no demonstrated meaning. Do not surface."
//   ≥ 12     MATERIAL  the level at which the gap was shown to be STICKY — pillars 12+ apart do not
//                      reliably converge at the next reading (median movement ≈ 0).
//   ≥ 16     STRETCHED the Market-vs-a-fundamental-pillar condition behind D1/D2.
//
// ── §1.2 · SEVERITY IS THE GAP, NOT A SEPARATE CALCULATION ─────────────────────────────────────────
//   severity = |pillar_A − pillar_B|  →  12–15 material · 16–24 stretched · 25+ extreme
//
// ⚠ THIS SCALE IS DIVERGENCE-ONLY. It must NOT be applied to trajectory, where the Trajectory spec
// §1.3 inverts it outright: there, the SMALLEST Foundation gains carried the cleanest positive drift
// (+1.9%, 64% positive) and the largest carried none, and a 15+ point Momentum gain reacted
// NEGATIVELY (−1.1%, 31% positive). "Never scale a trajectory badge by the size of the move." Two
// families, two opposite readings of magnitude — which is exactly why this lives in the divergence
// directory and is imported by nothing outside it.
//
// ── ★ WHY S1 (ALIGNED) IS NOT BUILT AS A FINDING ──────────────────────────────────────────────────
// S1 is the neutral CONTROL (−0.1%, 49% positive, n=226) — the thing that proves the other patterns
// are not artefacts of the method. Its value is "telling you where you do NOT need to look", which is
// tool-page behaviour, not a card stamped on every aligned stock in the universe. Firing a finding on
// ~every quiet company would invert the §1.6 discipline (loud at the edges, quiet in the middle) that
// makes the loud findings credible. The tool page renders it; the engine does not emit it.

import { ALIGNED_GAP_CEILING, MATERIAL_GAP_FLOOR } from "../../../catalogue/pattern-facts.js";

/** §1.1 — the alignment ceiling. At or below this the pillars agree; nothing to read.
 *  ★ DECLARED IN THE CATALOGUE, not here — S1's record and this band are the same number, and this
 *  module used to be its only home. Re-exported so the read layer's existing imports are unchanged. */
export const GAP_ALIGNED_MAX = ALIGNED_GAP_CEILING;
/** §1.1 — the first gap that carries demonstrated meaning. Anything in 8–11 is MINOR and suppressed.
 *  ★ DECLARED IN THE CATALOGUE (MATERIAL_GAP_FLOOR), which also records WHERE it was evidenced
 *  (Foundation↔Momentum) and where it is inherited. Alias kept: three read-layer services and four
 *  rules import this name, and renaming them is not this build's job. */
export const GAP_MATERIAL = MATERIAL_GAP_FLOOR;
/** §1.1/§1.2 — Market vs a fundamental pillar at this distance is the "stretched" condition. */
export const GAP_STRETCHED = 16;
/** §1.2 — the top tier. */
export const GAP_EXTREME = 25;

/** §1.2 tiers. Present only on patterns whose TRIGGER is a standing gap — see gapTier's contract. */
export type GapTier = "material" | "stretched" | "extreme";

/**
 * §1.2 severity tier for a standing two-pillar gap, or null when the gap is below MATERIAL.
 *
 * ⚠ A null return is the SUPPRESSION SIGNAL, not a "use a default" signal. It covers both the aligned
 * band (≤7) and the minor band (8–11), and a gap-triggered rule that receives null must return
 * not_fired. There is no floor-clamping and no "at least material" fallback: manufacturing a tier for
 * an 8–11 gap is precisely the thing §1.1 forbids.
 */
export function gapTier(gapPp: number): GapTier | null {
  const g = Math.abs(gapPp);
  if (g >= GAP_EXTREME) return "extreme";
  if (g >= GAP_STRETCHED) return "stretched";
  if (g >= GAP_MATERIAL) return "material";
  return null; // aligned (≤7) or minor (8–11) — MUST NOT surface
}

/** True when a standing gap is large enough to be surfaced at all (§1.1 ≥ 12). The single predicate
 *  every gap-triggered rule guards on, so "nothing in the 8–11 band fires" is one line, not seven. */
export const isSurfaceableGap = (gapPp: number): boolean => gapTier(gapPp) !== null;

/** Reader-facing tier word for the verdict sentence. */
export const TIER_WORD: Readonly<Record<GapTier, string>> = {
  material: "material",
  stretched: "stretched",
  extreme: "extreme",
};

/**
 * The persisted severity token for a gap tier. The read layer maps token → accent
 * (critical|red → crit · high|amber → high · recovery|green → rec · medium|low → ctx).
 *
 * ⚠ `extreme` and `stretched` share the "high" token deliberately. The tokens above "high" are
 * critical/red, which are RED-FLAG territory (Family A) — a divergence is never a red flag, however
 * wide. The precise tier travels in evidence.tier, which is what the copy names.
 */
export function severityForTier(tier: GapTier): string {
  return tier === "material" ? "medium" : "high";
}

/**
 * THE INERT-0 GUARD, for the two pillars a divergence compares.
 *
 * An `unavailable_redistributed` pillar persists a subtotal of 0 that is NOT a real score. Naively
 * differencing against it fabricates an enormous gap — the audit found this alone dominates a naive
 * candidate list. Both pillars must be genuinely `scored` before any gap is computed.
 *
 * Returns the extracted VALUES rather than a type predicate: a TS predicate can narrow only its first
 * parameter, so `bothScored(a, b)` left `b.subtotal` still `number | null` at every call site and the
 * guard silently did half its job. Returning the pair makes the narrowing total and unavoidable.
 */
export function scoredPair(
  a: { subtotal: number | null; state: string },
  b: { subtotal: number | null; state: string },
): { a: number; b: number } | null {
  if (a.state !== "scored" || b.state !== "scored") return null;
  if (a.subtotal === null || b.subtotal === null) return null;
  return { a: a.subtotal, b: b.subtotal };
}
