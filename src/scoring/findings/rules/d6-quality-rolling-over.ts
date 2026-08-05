// File: src/scoring/findings/rules/d6-quality-rolling-over.ts
//
// D6 · QUALITY ROLLING OVER — Foundation strong, Momentum cooling. The SIEMENS pattern.
// Vytal_Divergence_Tool_Spec Part 2, D6. Display-only · magnitude null · nothing rescores.
//
//     Foundation ≥ 72  AND  Momentum falls below 75 (from ≥ 75)
//
// A high-quality business that the market has ALREADY priced as high-quality. Its only FRESH input —
// the trajectory — has turned down. There is no upside surprise left to deliver, and the one thing
// that could still move the story is now moving the wrong way.
//
// Named case (spec): SIEMENS — Foundation rock-stable at 68–73 throughout, yet Market fell 91→46 as
// the price de-rated ₹4,600→₹3,000 and Momentum cooled 80→67. Stability is not immunity from falling.
//
// ── ★ THIS IS A CROSSING, NOT A STANDING GAP ──────────────────────────────────────────────────────
// "Momentum falls below 75 FROM ≥ 75" needs the PRIOR reading: the pattern is the crossing event, not
// the level. A stock that has sat at Momentum 60 for six quarters has not rolled over — it was never
// at 75 to roll over from. So the prior snapshot's Momentum must be ≥ 75 and the current below it.
//
// ── ★ WHY THE §1.2 GAP-SEVERITY SCALE IS NOT APPLIED HERE ─────────────────────────────────────────
// §1.2 defines severity as the size of the two-pillar GAP, and §1.1's 8–11 suppression governs which
// gaps may surface at all. Both are about STANDING GAPS. D6's trigger is a crossing, and its F−M gap
// at the moment of firing can legitimately be tiny (F=72, M=74 → −2) or large — the number says
// nothing about how meaningful the roll-over is. Tiering that gap would attach a "material /
// stretched / extreme" label to a quantity the pattern is not about, and suppressing D6 when the gap
// sits in 8–11 would drop a real crossing for failing a test that was never meant for it.
// So: `gapPp` is recorded as CONTEXT, no §1.2 tier is claimed, and severity comes from the pattern's
// own evidence (n=11, −3.4%, and −7.3% in HOT). Stated here because it is an interpretive call.
//
// ── REGIME: EVIDENCE IS SPLIT, DISPLAY IS NOT (§1.3) ──────────────────────────────────────────────
// "−3.4% forward, 45% positive (n=11). In HOT phases −7.3%, 33% positive — worse precisely when the
// sector is running and the name is most fully priced." D6 therefore carries regime-split evidence
// and regime-conditional copy, and — like every divergence pattern — is displayed in every phase.

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { scoredPair } from "../divergence/bands.js";
import { distinctAtPrecision, roundToPrecision } from "../format.js";
import type { FireRule } from "../types.js";

const ENTRY = STOCK_FINDINGS.divergence_D6_quality_rolling_over;
const FACTS = ENTRY.facts;

/** §Part 2 D6 — Foundation's native strong mark, now homed in `FACTS.legs` (the crossing boundary
 *  itself stays on `evidencedTier`; `legs` carries both current-value conditions in full). */
export const D6_FOUNDATION_MIN = FACTS.legs.find((l) => l.pillar === "foundation")!.value; // 72
/** §Part 2 D6 — the level being crossed DOWN through, read from the record. Momentum's native strong
 *  mark; the record declares it so this rule is not a second home for the number. */
export const D6_MOMENTUM_CROSS = FACTS.evidencedTier; // 75

/** ★ ONE FORMATTER, THE PATTERN'S OWN PRECISION — see d1-price-ahead-quality.ts's full note. */
const round = (x: number) => roundToPrecision(x, FACTS.displayPrecision);

export const ruleD6: FireRule = (ctx) => {
  const f = ctx.current.pillars.foundation;
  const m = ctx.current.pillars.momentum;
  const p = scoredPair(f, m); // inert-0 guard
  if (!p) return null;
  const foundation = p.a, momentum = p.b;

  if (foundation < D6_FOUNDATION_MIN) return null;
  if (momentum >= D6_MOMENTUM_CROSS) return null; // must be BELOW now

  // ★ the crossing: the prior reading must have been AT OR ABOVE the mark.
  if (ctx.priorSnapshots.length === 0) return null;
  const prior = ctx.priorSnapshots[ctx.priorSnapshots.length - 1];
  if (!prior.momentumScored || prior.momentum === null) return null;
  if (prior.momentum < D6_MOMENTUM_CROSS) return null; // was already below — not a crossing
  // ★ THE DISPLAY-PRECISION GATE ("Ruling 3 on T9" — format.ts). D6 has NO minimum-margin floor on the
  // crossing itself (unlike D5's +5 movement floor) — a real, epsilon-cleared crossing can still round
  // to the same displayed Momentum on both sides. Refuse to fire on a move the card would show as
  // "75 to 75."
  if (!distinctAtPrecision(prior.momentum, momentum, FACTS.displayPrecision)) return null;

  return {
    kind: "pattern",
    key: ENTRY.key,
    severity: "high",
    direction: "negative",
    polarity: "negative",
    temporalClass: "EVENT", // the crossing is dated
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "D6",
      name: "Quality Rolling Over",
      foundation: round(foundation),
      momentum: round(momentum),
      momentumPrior: round(prior.momentum),
      momentumFallPp: round(prior.momentum - momentum),
      crossedBelow: D6_MOMENTUM_CROSS,
      foundationMin: D6_FOUNDATION_MIN,
      // context only — deliberately NOT tiered on the §1.2 gap scale (see the header)
      gapPp: round(foundation - momentum),
      gapTierApplies: false,
      isCrossing: true,
      evidencedForwardPct: -3.4,
      evidencedPositivePct: 45,
      evidencedN: 11,
      hotForwardPct: -7.3,
      hotPositivePct: 33,
      regimeConditionalCopy: true, // §1.3 — wording only, never a display gate
    },
    metricRefs: ["foundation", "momentum"],
  };
};
