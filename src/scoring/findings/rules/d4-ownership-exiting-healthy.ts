// File: src/scoring/findings/rules/d4-ownership-exiting-healthy.ts
//
// D4 · OWNERSHIP EXITING A HEALTHY BUSINESS — the mirror of D3.
// Vytal_Divergence_Tool_Spec Part 2, D4. Display-only · magnitude null · nothing rescores.
//
//     ΔOwnership < 0  AND  Foundation ≥ 72
//
// Smart money is leaving a business that still LOOKS sound on the published numbers. The exit tends
// to precede the deterioration showing up in the financials.
//
// Named case (spec): TATA STEEL — Foundation still read 71 while Ownership had already slipped
// 60→52. Momentum then collapsed to ~36, Market fell 79→34, the price faded, and only AFTERWARDS did
// Foundation follow 71→63. Ownership moved first.
//
// ── ★ THE ±8 RULING — LANGUAGE, NOT A GATE (owner) ────────────────────────────────────────────────
// The spec's trigger was ΔOwnership ≤ −8; removed as a firing condition. Any downward movement at
// Foundation ≥ 72 fires. |Δ| ≥ 8 selects the register:
//   strong (|Δ| ≥ 8)  the evidenced population — −3.4% sector-excess, 36% positive (n=11); a separate
//                     disclosure-anchored check returned −2.7% on the day, 0% positive (n=3).
//   plain  (|Δ| < 8)  the same condition, no measured outcome. Movement stated, driver named, figures
//                     withheld.
//
// ── SAMPLE CAVEAT — DISPLAY IT ────────────────────────────────────────────────────────────────────
// n=11, and n=3 on the short-window check. Sample-starved. The spec is explicit: "Present as a reason
// to investigate, never as a verdict." That is why severity is `medium` (→ ctx accent) rather than
// `high` — the register is investigate-this, not this-is-bad.
//
// Note the spec's own threshold correction: "The original test used a slightly lower Foundation bar;
// the native strong-zone threshold of 72 is specified here." So D4 reads Foundation's NATIVE strong
// mark, and takes it from NATIVE_ZONES rather than a local literal.

import { ownershipMove, driverClause } from "../divergence/ownership-move.js";
import { NATIVE_ZONES } from "../thresholds.js";
import type { FireRule } from "../types.js";

/** §Part 2 D4 — Foundation's own STRONG mark (the spec's stated correction to the original test). */
export const D4_FOUNDATION_MIN = NATIVE_ZONES.foundation.strong; // 72

const r1 = (x: number) => Math.round(x * 10) / 10;

export const ruleD4: FireRule = (ctx) => {
  const f = ctx.current.pillars.foundation;
  if (f.state !== "scored" || f.subtotal === null) return null; // inert-0 guard
  if (f.subtotal < D4_FOUNDATION_MIN) return null;

  const move = ownershipMove(ctx);
  if (!move) return null;
  if (move.deltaPp >= 0) return null; // D4 is the EXITING side

  return {
    kind: "pattern",
    key: "divergence_D4_ownership_exiting_healthy",
    // `medium` → ctx accent. Sample-starved: a reason to investigate, never a verdict.
    severity: "medium",
    direction: "negative",
    polarity: "negative",
    temporalClass: "EVENT",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "D4",
      name: "Ownership Exiting a Healthy Business",
      foundation: r1(f.subtotal),
      foundationMin: D4_FOUNDATION_MIN,
      ownershipDeltaPp: move.deltaPp,
      ownershipFrom: move.priorSubtotal,
      ownershipTo: move.currentSubtotal,
      strong: move.strong,
      strongCutPp: 8,
      cause: move.cause,
      shareholding: move.shareholding,
      flow: move.flow,
      driver: driverClause(move),
      evidencedSectorExcessPct: -3.4,
      evidencedPositivePct: 36,
      evidencedN: 11,
      disclosureAnchoredPct: -2.7,
      disclosureAnchoredPositivePct: 0,
      disclosureAnchoredN: 3,
      caveat: "n=11, and n=3 on the short-window check. Sample-starved — a reason to investigate, never a verdict.",
    },
    metricRefs: ["ownership", "foundation"],
  };
};
