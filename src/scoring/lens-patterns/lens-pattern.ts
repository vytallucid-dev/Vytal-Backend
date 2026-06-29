// File: src/scoring/lens-patterns/lens-pattern.ts
//
// THE PRIMITIVE — lensPattern() (metric-level LM1–8) + lensPillarPattern() (LP1–6)
// + the anti-double-count discriminator (§5.3).
//
// PURE READ. Inputs are the three derived lens STATES (lens-states.ts), which are
// themselves pure reads of the persisted atom. Stores nothing, recomputes no lens.
//
// THE THREE ENFORCED DISCIPLINES, all in the ENGINE (not the UI):
//   1. HONEST-EMPTY (§5.4) — a pattern depending on a not_evaluable lens does not
//      fire (it is not_evaluable, not false). Falls out of the catalog match: every
//      cell requires SPECIFIC L1/L2 states, so a not_evaluable L1/L2 matches nothing;
//      LM3/LM4 accept "L3 any" so they still fire when only L3 is missing. A field-
//      verdict (LM3/LM4/LP2/LP3) is physically impossible when L2 is not_evaluable
//      because above/below_peer are only produced for usable peers (lens-states.ts).
//   2. ANTI-DOUBLE-COUNT (§5.3) — LM5 defers to Family-D (trajectory_D_recovery);
//      LP5/LP6 defer to Family-B (trajectory_B_deterioration). Applied by
//      applyAntiDoubleCount() against the snapshot's already-fired findings.
//   3. NO-FORWARD-LANGUAGE — enforced by no-forward-guard.ts over the catalog.

import { LM_CATALOG, LP_CATALOG } from "./catalog.js";
import {
  type LensPattern,
  type LensPillarPattern,
  type L1State,
  type L2State,
  type L3State,
  type LensTriplet,
  type MetricLensAtom,
  type PillarShares,
  type PillarLensClass,
  type PatternRole,
  PILLAR_STRONG_SHARE,
  PILLAR_WEAK_SHARE,
} from "./types.js";
import { deriveLensTriplet } from "./lens-states.js";

const face = (id: string): LensPattern => {
  const f = LM_CATALOG[id];
  return { id: f.id, label: f.label, tone: f.tone, fieldVerdict: f.fieldVerdict };
};

export interface LensPatternOpts {
  /** LM8 anti-mask gate: true when this metric's PILLAR reads ≥ Steady-equivalent
   *  (the pillar is masking the laggard). Required for LM8 to be evaluable; when
   *  omitted, the below·below·flat cell renders as a plain "below bar" state (null),
   *  NOT LM8 — honest-empty over a fabricated anti-mask claim. */
  pillarReadsAcceptable?: boolean;
}

/**
 * lensPattern — the closed LM1–8 catalog (§4 faces table). Returns the fired pattern,
 * or null for a degenerate / no-tension cell (renders as the metric's plain lens
 * state, NOT a card) or when a required lens is not_evaluable (honest-empty).
 *
 * Cells (§4):
 *   LM1 above·above·improving
 *   LM2 above·above·(flat|declining)
 *   LM3 below·above·any            → fieldVerdict PG_WEAK
 *   LM4 above·below·any            → fieldVerdict PG_STRONG
 *   LM5 below·below·improving
 *   LM6 above·near·declining
 *   LM7 below·below·declining
 *   LM8 below·below·flat  WHERE pillar ≥ Steady-equivalent (anti-mask)
 */
export function lensPattern(
  l1: L1State,
  l2: L2State,
  l3: L3State,
  opts: LensPatternOpts = {},
): LensPattern | null {
  // LM3 / LM4 — the field-verdict cases. L3 is "any" (including not_evaluable): a
  // metric with L1+L2 present but L3 missing STILL fires these (§5.4). They depend
  // ONLY on L1+L2, and above/below_peer can only exist for usable peers, so the
  // field-verdict can never be fabricated.
  if (l1 === "below_bar" && l2 === "above_peer") return face("LM3"); // PG weak
  if (l1 === "above_bar" && l2 === "below_peer") return face("LM4"); // PG strong

  // The remaining cells require all three lenses evaluable in the stated states.
  if (l1 === "above_bar" && l2 === "above_peer") {
    if (l3 === "improving") return face("LM1");
    if (l3 === "flat" || l3 === "declining") return face("LM2");
    return null; // L3 not_evaluable → cannot fire LM1/LM2 (honest-empty)
  }

  if (l1 === "above_bar" && l2 === "near_peer" && l3 === "declining") return face("LM6");

  if (l1 === "below_bar" && l2 === "below_peer") {
    if (l3 === "improving") return face("LM5");
    if (l3 === "declining") return face("LM7");
    if (l3 === "flat") {
      // LM8 only when the pillar masks the laggard; else plain "below bar" (null).
      return opts.pillarReadsAcceptable === true ? face("LM8") : null;
    }
    return null; // L3 not_evaluable → none of LM5/LM7/LM8 fire (honest-empty)
  }

  // Every other cell (incl. any not_evaluable L1/L2, and the degenerate no-tension
  // cells in the databank's "Degenerate / non-firing" table) → no card.
  return null;
}

/** Convenience: derive the triplet from the atom and fire the metric pattern. */
export function lensPatternForAtom(
  atom: MetricLensAtom,
  opts: LensPatternOpts = {},
): { triplet: LensTriplet; pattern: LensPattern | null } {
  const triplet = deriveLensTriplet(atom);
  return { triplet, pattern: lensPattern(triplet.l1, triplet.l2, triplet.l3, opts) };
}

// ── ANTI-DOUBLE-COUNT (§5.3) ─────────────────────────────────────────────────────

/** A headline R/P finding already fired on this snapshot (read from score_patterns). */
export interface FiredHeadline {
  patternKey: string;
  /** evidence.leg — "composite" | "foundation" | "momentum" | "market" | "ownership". */
  leg: string | null;
}

export interface PatternRoleResult {
  role: PatternRole;
  defersTo: string | null; // the headline patternKey it became supporting-detail for
}

/** True when a headline of `patternKey` fired for `pillar` (or at the composite,
 *  which subsumes the pillar). Discriminates via evidence.leg (d-recovery / b-
 *  deterioration both set evidence.leg = the pillar key or "composite"). */
function headlineFiredFor(headlines: FiredHeadline[], patternKey: string, pillar: string): FiredHeadline | null {
  return (
    headlines.find(
      (h) => h.patternKey === patternKey && (h.leg === pillar || h.leg === "composite"),
    ) ?? null
  );
}

/**
 * Demote a metric-level pattern to SUPPORTING-DETAIL when its family headline fired:
 *   • LM5 (metric recovery) defers to Family-D trajectory_D_recovery (§5.3).
 * Other LM patterns are never demoted (LM3/LM4 field-verdicts have no existing-finding
 * overlap and surface freely; the rest are metric-level texture with no headline twin).
 */
export function applyAntiDoubleCount(
  pattern: LensPattern,
  pillar: string,
  headlines: FiredHeadline[],
): PatternRoleResult {
  if (pattern.id === "LM5") {
    const d = headlineFiredFor(headlines, "trajectory_D_recovery", pillar);
    if (d) return { role: "supporting_detail", defersTo: d.patternKey };
  }
  return { role: "top_level", defersTo: null };
}

/** Pillar-level anti-double-count: LP5/LP6 defer to Family-B trajectory_B_deterioration. */
export function applyAntiDoubleCountPillar(
  pattern: LensPillarPattern,
  pillar: string,
  headlines: FiredHeadline[],
): PatternRoleResult {
  if (pattern.id === "LP5" || pattern.id === "LP6") {
    const b = headlineFiredFor(headlines, "trajectory_B_deterioration", pillar);
    if (b) return { role: "supporting_detail", defersTo: b.patternKey };
  }
  return { role: "top_level", defersTo: null };
}

// ── PILLAR ROLL-UP (§3) ──────────────────────────────────────────────────────────

const classify = (share: number | null): PillarLensClass | null => {
  if (share === null) return null;
  if (share >= PILLAR_STRONG_SHARE) return "strong";
  if (share < PILLAR_WEAK_SHARE) return "weak";
  return "mixed";
};

const pillarFace = (id: string): LensPillarPattern => {
  const f = LP_CATALOG[id];
  return { id: f.id, label: f.label, tone: f.tone, fieldVerdict: f.fieldVerdict };
};

/**
 * lensPillarPattern — the LP1–6 roll-up (§3). Computes the three pass-shares over
 * ONLY scored + per-lens-evaluable metrics (not_evaluable EXCLUDED from the
 * denominator, never a fail — §3.1 / §0.4), then maps to the fired LP patterns.
 *
 * SIGNATURE NOTE: the briefing's single-object return is adapted to { shares,
 * patterns } because the LP catalog spans TWO orthogonal axes (§3.3): the L1×L2 axis
 * yields at most one of {LP1,LP2,LP3}, the L3 axis yields LP4/LP5, and LP6 (L1
 * strong · L3 declining) can co-fire — so more than one LP can be true at once.
 * Returning the set is the faithful, non-lossy form.
 */
export function lensPillarPattern(
  metrics: MetricLensAtom[],
  opts: { peerMinN?: number } = {},
): { shares: PillarShares; patterns: LensPillarPattern[] } {
  const scored = metrics.filter((m) => m.scored);

  // Per-lens triplets (each metric's three states).
  const triplets = scored.map((m) => deriveLensTriplet(m, opts.peerMinN));

  const l1Eval = triplets.filter((t) => t.l1 !== "not_evaluable");
  const l2Eval = triplets.filter((t) => t.l2 !== "not_evaluable");
  const l3Eval = triplets.filter((t) => t.l3 !== "not_evaluable");

  const l1Pass = l1Eval.length ? l1Eval.filter((t) => t.l1 === "above_bar").length / l1Eval.length : null;
  const l2Pass = l2Eval.length ? l2Eval.filter((t) => t.l2 === "above_peer").length / l2Eval.length : null;
  const l3Improving = l3Eval.length ? l3Eval.filter((t) => t.l3 === "improving").length / l3Eval.length : null;
  const l3Declining = l3Eval.length ? l3Eval.filter((t) => t.l3 === "declining").length / l3Eval.length : null;

  const shares: PillarShares = {
    l1Pass,
    l2Pass,
    l3Improving,
    l3Declining,
    nL1: l1Eval.length,
    nL2: l2Eval.length,
    nL3: l3Eval.length,
  };

  const c1 = classify(l1Pass);
  const c2 = classify(l2Pass);
  const patterns: LensPillarPattern[] = [];

  // L1 × L2 axis (mutually exclusive — at most one).
  if (c1 === "strong" && c2 === "strong") patterns.push(pillarFace("LP1"));
  else if ((c1 === "weak" || c1 === "mixed") && c2 === "strong") patterns.push(pillarFace("LP2")); // PG weak
  else if (c1 === "strong" && (c2 === "weak" || c2 === "mixed")) patterns.push(pillarFace("LP3")); // PG strong

  // L3 axis (improving XOR declining at the ≥0.70 cut; both ≥0.70 is impossible).
  if (l3Improving !== null && l3Improving >= PILLAR_STRONG_SHARE) patterns.push(pillarFace("LP4"));
  if (l3Declining !== null && l3Declining >= PILLAR_STRONG_SHARE) patterns.push(pillarFace("LP5"));

  // LP6 — hollow pillar: L1 strong AND L3 declining strong (can co-fire with LP5/LP3).
  if (c1 === "strong" && l3Declining !== null && l3Declining >= PILLAR_STRONG_SHARE) {
    patterns.push(pillarFace("LP6"));
  }

  return { shares, patterns };
}
