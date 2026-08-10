// File: src/scoring/findings/rules/s2-sticky-divergence.ts
//
// S2 · STICKY DIVERGENCE — unresolved and not converging.
// Vytal_Divergence_Tool_Spec Part 3, S2. Display-only · magnitude null · nothing rescores.
//
//     |Foundation − Momentum| ≥ 12,  SUSTAINED across more than one reading
//
// "When Foundation and Momentum sit 12+ points apart, neither reliably converges at the next reading
// — median movement ≈ 0. An observed structural property, NOT a return claim."
//
// ── ★ NO RETURN CLAIM — AND THAT IS WHY severity IS `low` ─────────────────────────────────────────
// S2 is a STATE, not a pattern with a measured outcome. The spec attaches no return figure to it at
// all, so nothing in evidence may imply one. Its value is teaching the model's honest limit: "the
// model can show you that it exists, but not when it will close." `low` maps to the ctx accent — a
// context row, never a warning.
//
// ── ★ THE SUSTAIN REQUIREMENT IS THE WHOLE POINT, AND ITS PREDECESSOR HAD NONE ────────────────────
// S2 supersedes the retired divergence_C3_floor_trajectory_split, which tested |F − M| ≥ 25 on a
// SINGLE SNAPSHOT — it never read a prior reading at all, so it could not distinguish a gap that had
// stood for a year from one that opened this quarter. "Sustained" was the missing half of the claim:
// the stickiness IS the finding.
//
// ── HOW "MORE THAN ONE READING" IS EXPRESSED ──────────────────────────────────────────────────────
// The CURRENT reading and the IMMEDIATELY PRIOR reading must BOTH be ≥ 12 — two consecutive readings,
// contiguous, no gap-skipping. Snapshots are quarterly, so "more than one reading" is ~2 quarters of
// wall-clock (~6 months). The run is then extended backwards while consecutive priors also qualify,
// and the length travels in evidence as `sustainedReadings` so the copy can say how long it has stood.
// A stock with a single snapshot CANNOT fire S2 — there is no second reading to sustain across.
//
// ⚠ Contiguity is deliberate. Walking backwards and counting only the qualifying readings would let a
// gap that closed and re-opened read as continuously sustained, which is the opposite of sticky.

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { scoredPair, gapTier, severityForTier, TIER_WORD } from "../divergence/bands.js";
import { seriesWithCurrent } from "../trajectory/view.js";
import { roundToPrecision } from "../format.js";
import type { FireRule } from "../types.js";

const ENTRY = STOCK_FINDINGS.divergence_S2_sticky_divergence;
const FACTS = ENTRY.facts;

/** §Part 3 S2 — the material floor, read from S2's OWN record.
 *  ★ THE ONE RECORD WHERE THIS FLOOR IS EVIDENCED RATHER THAN INHERITED: the stickiness that
 *  establishes 12 was measured on exactly this pair (Foundation ↔ Momentum). Every other pattern's
 *  gapFloor carries the same number across from here. */
export const S2_GAP_MIN = FACTS.gapFloor; // 12
/** ★ THE SUSTAIN LEG IS NOW HOMED, read from `FACTS.sustainReadings` — "more than one reading" is a
 *  run-length requirement with no home in `legs`, `gapFloor` or `movementFloor`; it is the field
 *  `sustainReadings` was added for. S2 is the only pattern in either family that has one. */
export const S2_MIN_READINGS = FACTS.sustainReadings; // 2

/** ★ ONE FORMATTER, THE PATTERN'S OWN PRECISION — see d1-price-ahead-quality.ts's full note. S2 has no
 *  temporal prior/now pair on its OWN reading (the gap is a single-snapshot fact; the sustain walk
 *  operates on the RAW series, not the rounded display value), so no distinctAtPrecision gate applies
 *  here — nothing in S2's firing condition could become invisible at display precision. */
const round = (x: number) => roundToPrecision(x, FACTS.displayPrecision);

export const ruleS2: FireRule = (ctx) => {
  const f = ctx.current.pillars.foundation;
  const m = ctx.current.pillars.momentum;
  const p0 = scoredPair(f, m); // inert-0 guard
  if (!p0) return null;
  const foundation = p0.a, momentum = p0.b;

  const gap = Math.abs(foundation - momentum);
  if (gap < S2_GAP_MIN) return null;
  const tier = gapTier(gap);
  if (!tier) return null;

  // ── the sustain walk: current + consecutive priors, newest→oldest, contiguous only ──
  const series = seriesWithCurrent(ctx);
  let readings = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    const p = series[i];
    if (p.foundation === null || p.momentum === null) break; // unscored breaks the run
    if (Math.abs(p.foundation - p.momentum) < S2_GAP_MIN) break; // closed here — run ends
    readings++;
  }
  if (readings < S2_MIN_READINGS) return null; // single reading ⇒ not yet sustained

  const oldest = series[series.length - readings];
  const floorLed = foundation > momentum;

  return {
    kind: "pattern",
    key: ENTRY.key,
    // A state with NO return claim → the context register, whatever the gap's size.
    severity: "low",
    // Neither good nor bad: it is the persistence that is the fact. F2 sets the precedent for a
    // fired finding with a null direction.
    direction: null,
    polarity: "neutral",
    temporalClass: "CONDITION",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "S2",
      name: "Sticky Divergence",
      foundation: round(foundation),
      momentum: round(momentum),
      gapPp: round(gap),
      tier,
      tierWord: TIER_WORD[tier],
      gapMin: S2_GAP_MIN,
      // ★ the sustain evidence
      sustainedReadings: readings,
      minReadings: S2_MIN_READINGS,
      sincePeriod: oldest.periodKey,
      // which side leads — the same fact C3 recorded as floorLed, kept because it changes the story
      floorLed,
      leadPillar: floorLed ? "foundation" : "momentum",
      // ⚠ NO return figure. The spec attaches none; inventing one is the failure this guards.
      returnClaim: null,
      structuralNote: "At 12+ points apart, neither pillar reliably converges at the next reading (median movement ≈ 0). An observed structural property, not a return claim.",
      // severityForTier is deliberately NOT used for the persisted token (see the header) — recorded
      // so the read layer can still show the §1.2 tier word without inferring a warning level.
      tierSeverityIfApplied: severityForTier(tier),
    },
  };
};
