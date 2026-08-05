// File: src/scoring/findings/divergence/aligned.ts
//
// S1 · ALIGNED — NO TENSION. THE ONE PLACE THIS IS COMPUTED. PURE.
// Vytal_Divergence_Tool_Spec Part 3, S1.
//
//     max(all four pillars) − min(all four pillars) ≤ 7
//
// ── ★ WHY S1 IS A TOOL STATE AND NOT A FINDING ────────────────────────────────────────────────────
// S1 is the study's CONTROL: −0.1%, 49% positive (n=226) — "verifiably, deliberately neutral. This is
// the control that proves the other patterns are not artefacts of the method."
// Its value to a reader is the opposite of a finding's: "most of a screening tool's value is telling
// you where you do NOT need to look."
// Emitting it as a fired finding would stamp a card on a large share of the universe every quarter,
// which inverts the density law that makes the loud findings credible (Trajectory §1.6: "loud at the
// edges and quiet in the middle; that quiet is what makes the loud parts credible"). So it is
// computed HERE, read by the divergence tool, and never persisted to score_patterns.
//
// ⚠ RULING 3 — S1 DOES HAVE A REAL CATALOGUE KEY (`divergence_S1_aligned`, status `never_emitted`).
// A tool STATE and a catalogue ENTRY are different questions: the first asks whether a rule ever fires
// it (no), the second asks whether it has one home for its name/description/facts (now yes — the same
// home every other pattern has). Giving it a key did not make it a finding; it closed the second home
// its facts used to have. See types.ts's KeyStatus for the full distinction from `synthesised`.
//
// ── ★ AND WHY IT LIVES IN THIS MODULE SPECIFICALLY ────────────────────────────────────────────────
// S1's arithmetic is the pillar spread — the SAME quantity the retired scan-layer derivations
// computed independently seven times over. Putting S1 anywhere else would recreate exactly the
// duplication this phase exists to remove. It sits beside GAP_ALIGNED_MAX in bands.ts (the constant
// it tests) and reuses trajectory/cross.ts's pillarSpread (the arithmetic), so there is no second
// spread implementation anywhere in the codebase.
//
// ⚠ MUTUALLY EXCLUSIVE WITH EVERY D PATTERN, BY ARITHMETIC. S1 requires the WIDEST pillar gap ≤ 7;
// every D pattern requires a specific pair ≥ 12 (or, for D1/D2, ≥16 by construction). A pair's gap
// can never exceed the max−min spread, so `spread ≤ 7` makes `anyPair ≥ 12` impossible. The
// exclusivity is a theorem, not a rule to enforce — but it is asserted in verification anyway,
// because a theorem that is never checked is an assumption.

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { pillarSpread } from "../trajectory/cross.js";

/**
 * ★ S1, READ FROM ITS OWN CATALOGUE ENTRY (Ruling 3 — S1 is a real catalogue key now, status
 * `never_emitted`; see types.ts's KeyStatus). This is the ONE place its name/description/facts are
 * read FROM, never re-typed — the same discipline every D/S/T rule already follows for its own key.
 */
const ENTRY = STOCK_FINDINGS.divergence_S1_aligned;
const FACTS = ENTRY.facts;

/**
 * ★ S1's CEILING, READ FROM ITS OWN DECLARED RECORD.
 *
 * S1's facts: all four pillars, gap basis, spread ≤ 7, no directional read in any phase, and the
 * measured control population (−0.1%, 49% positive, n=226). Those live with every other pattern's,
 * so S1 is not the one reading in the system whose defining number is a local literal.
 *
 * ⚠ On S1's record `gapFloor` bounds from ABOVE — see the note there.
 */
const GAP_ALIGNED_MAX = FACTS.gapFloor;

/** The catalogue's own name/description — no longer re-typed here. */
export const S1_NAME = ENTRY.name;
export const S1_DESCRIPTION = ENTRY.description;
/** The spec's own copy, VERBATIM (Part 3 · S1 · "User copy"). Instance-level "user copy", distinct
 *  from `description` ("what it means") — S1 never fires as a FiredFinding with evidence to bind a
 *  dynamic verdict to, so this stays a static constant rather than a renderVerdict entry. */
export const S1_VERDICT =
  "The pillars agree. What the market is paying and what the business shows are in line — no unresolved tension to read here.";
/** The control's measured neutrality. Stated as evidence, never as a return claim about a stock.
 *  ★ PROJECTED FROM S1's RECORD, not re-typed — the same three numbers every other pattern's
 *  `evidenceStats` carries, in the shape this module's consumers already read. */
export const S1_EVIDENCE = {
  meanPct: FACTS.evidenceStats.effectPct,
  positivePct: FACTS.evidenceStats.hitRatePct,
  n: FACTS.evidenceStats.n,
} as const;

export interface AlignedState {
  aligned: boolean;
  /** max − min across the SCORED pillars. Null when fewer than two pillars are scored. */
  spread: number | null;
  highPillar: string | null;
  lowPillar: string | null;
  /** The ceiling tested against — carried so a surface can show it WITHOUT typing it into prose. */
  alignedMax: number;
}

/**
 * Is this stock aligned? Reads the four pillar subtotals with their scored flags.
 *
 * ⚠ Inert-0 guard: an `unavailable_redistributed` pillar persists a 0 that is not a score. Passing it
 * in would fabricate a ~60-point spread and turn every such stock from aligned into maximally
 * diverged — the precise inversion of what S1 says.
 */
export function alignedState(p: {
  foundation: number | null;
  momentum: number | null;
  market: number | null;
  ownership: number | null;
}): AlignedState {
  const sp = pillarSpread(p);
  if (!sp) return { aligned: false, spread: null, highPillar: null, lowPillar: null, alignedMax: GAP_ALIGNED_MAX };
  return {
    aligned: sp.spread <= GAP_ALIGNED_MAX,
    spread: Math.round(sp.spread * 10) / 10,
    highPillar: sp.maxPillar,
    lowPillar: sp.minPillar,
    alignedMax: GAP_ALIGNED_MAX,
  };
}
