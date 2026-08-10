// File: src/scoring/findings/rules/d3-ownership-building-weak-foundation.ts
//
// D3 · OWNERSHIP BUILDING AGAINST A WEAK FOUNDATION — the strongest positive pattern in the study.
// Vytal_Divergence_Tool_Spec Part 2, D3. Display-only · magnitude null · nothing rescores.
//
//     ΔOwnership > 0  AND  Foundation < 60
//
// Institutions are INCREASING their stake in a business whose published fundamentals look weak. That
// is a deliberate, costly decision taken against the visible evidence — which is exactly what makes
// it informative. Someone with a better view is putting real money behind a thesis the numbers do not
// yet reflect.
//
// ── ★ THIS IS POSITIVE. THE RULE IT REPLACES SHIPPED IT AS A WARNING. ─────────────────────────────
// The retired divergence_C2_ownership_vs_fundamentals covered this condition on its
// `build_under_weakness` leg and wrote direction: "negative" on BOTH legs unconditionally. Its own
// catalogue copy called that leg "the classic smart-money tell" and its own verdict called it "the
// regime-robust tell" — while the persisted direction column made every consuming surface render the
// study's STRONGEST POSITIVE as a red card. D3 is positive/constructive, and that is the point of
// rebuilding it rather than patching C2.
//
// ── ★ THE ±8 RULING — LANGUAGE, NOT A GATE (owner) ────────────────────────────────────────────────
// The spec's trigger was ΔOwnership ≥ +8. That threshold is REMOVED as a firing condition: any
// upward movement at Foundation < 60 fires. |Δ| ≥ 8 selects the REGISTER instead:
//   strong (|Δ| ≥ 8)  the evidenced population — +1.9% sector-excess / 58% positive (n=26), +10.3%
//                     absolute / 88% positive, and 100% positive in STRESSED (n=7), the only pattern
//                     in the entire study that held up through stress.
//   plain  (|Δ| < 8)  the SAME condition with NO measured outcome. The movement is stated and its
//                     driver named; the evidenced figures are withheld, because a 2-point move was
//                     never part of the population they were measured on.
//
// ── ★ AND IT ANSWERS "WHY" ────────────────────────────────────────────────────────────────────────
// ownershipMove() detects whether the filing changed (→ promoter/FII/DII/pledge deltas) or whether
// the pillar moved on flow while the filing stood still (→ insider/block activity). See
// divergence/ownership-move.ts for why that distinction is load-bearing.
//
// ── CAVEAT TO DISPLAY ─────────────────────────────────────────────────────────────────────────────
// n=26, and the Ownership pillar is heavily compressed (its 25th/40th/50th/60th percentiles are all
// exactly 60.0), which structurally limits sample size on every Ownership pattern. Directionally the
// strongest positive found; not a large-sample law.

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { ownershipMove, driverClause } from "../divergence/ownership-move.js";
import { roundToPrecision } from "../format.js";
import { movementState } from "../divergence/pattern-state.js";
import type { FireRule } from "../types.js";

const ENTRY = STOCK_FINDINGS.divergence_D3_ownership_building_weak_foundation;
const FACTS = ENTRY.facts;

/** ★ Now homed in `FACTS.legs` — the one condition genuinely expressible as a current-value pillar
 *  threshold (the ΔOwnership leg is a delta, not a level, and stays in `movementFloor`; see the
 *  record's own comment). */
export const D3_FOUNDATION_MAX = FACTS.legs.find((l) => l.pillar === "foundation")!.value; // 60
/** ★ The ±8 register cut, read from the record. NOT a firing gate — it selects which language the
 *  verdict may use (see the header). Same value as before; the home moved, the behaviour did not. */
export const D3_STRONG_CUT_PP = FACTS.evidencedTier; // 8

/** ★ ONE FORMATTER, THE PATTERN'S OWN PRECISION — see d1-price-ahead-quality.ts's full note. */
const round = (x: number) => roundToPrecision(x, FACTS.displayPrecision);

export const ruleD3: FireRule = (ctx) => {
  const f = ctx.current.pillars.foundation;
  if (f.state !== "scored" || f.subtotal === null) return null; // inert-0 guard
  if (f.subtotal >= D3_FOUNDATION_MAX) return null;

  // ★ ownershipMove ALREADY rounds deltaPp/priorSubtotal/currentSubtotal to FACTS.displayPrecision and
  // refuses to return a move invisible at that precision (the display-precision gate — format.ts).
  const move = ownershipMove(ctx, D3_STRONG_CUT_PP, FACTS.displayPrecision);
  if (!move) return null;          // no prior snapshot / unscored / zero (or invisible) movement
  if (move.deltaPp <= 0) return null; // D3 is the BUILDING side

  // ★ THE STATE — BY SIZE OF MOVE, NOT BY LEVEL. `evidencedTier` (8) is the Building/Formed
  //   boundary; `movementFloor` (2) is the Absent/Building one. Both were already declared on the
  //   record; what changed is that they are read as a three-way state instead of an on/off gate.
  //   ⚠ movementFloor was previously declared-and-unwired — this is where it becomes live, and it
  //   is what stops a 0.4pp drift surfacing as a pattern at all.
  const state = movementState(Math.abs(move.deltaPp), FACTS.evidencedTier, FACTS.movementFloor);
  if (state === "absent") return null;

  return {
    kind: "pattern",
    key: ENTRY.key,
    // Constructive. `green` maps to the `rec` accent — never a warning colour.
    severity: "green",
    direction: "positive",
    polarity: "positive",
    temporalClass: "EVENT", // a dated movement between two readings, not a standing condition
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "D3",
      name: "Ownership Building Against a Weak Foundation",
      foundation: round(f.subtotal),
      foundationMax: D3_FOUNDATION_MAX,
      ownershipDeltaPp: move.deltaPp,
      ownershipFrom: move.priorSubtotal,
      ownershipTo: move.currentSubtotal,
      // ★ the tier that selects the register (see the header) — NOT a firing gate
      strong: move.strong,
      // ★ formed | building. Absent returned null above.
      state,
      formedAtPp: FACTS.evidencedTier,
      buildingFloorPp: FACTS.movementFloor,
      strongCutPp: D3_STRONG_CUT_PP,
      // ★ what actually drove it
      cause: move.cause,
      shareholding: move.shareholding,
      flow: move.flow,
      driver: driverClause(move),
      // evidenced figures — belong to the strong population ONLY; the verdict gates on `strong`
      evidencedSectorExcessPct: 1.9,
      evidencedPositivePct: 58,
      evidencedAbsolutePct: 10.3,
      evidencedAbsolutePositivePct: 88,
      evidencedN: 26,
      stressedPositivePct: 100,
      stressedN: 7,
      caveat: "n=26, and the Ownership pillar is compressed (25th/40th/50th/60th percentiles all exactly 60.0), which structurally limits sample size on every Ownership pattern.",
    },
  };
};
