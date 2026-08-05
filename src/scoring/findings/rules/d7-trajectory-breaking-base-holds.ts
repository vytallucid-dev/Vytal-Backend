// File: src/scoring/findings/rules/d7-trajectory-breaking-base-holds.ts
//
// D7 · TRAJECTORY BREAKING WHILE THE BASE HOLDS — an early warning.
// Vytal_Divergence_Tool_Spec Part 2, D7. Display-only · magnitude null · nothing rescores.
//
//     Momentum falls below 54 (from ≥ 54)  AND  Foundation ≥ 60
//
// The balance sheet is still intact but the operating trajectory has broken into weakness. This is
// early — the base has not deteriorated yet, but the direction has changed.
//
// ── ★ THE COUNTER-INTUITIVE FINDING BELONGS IN THE COPY ───────────────────────────────────────────
// "Worth noting: the intact Foundation does NOT cushion this — the version with fundamentals holding
// is MORE negative than the bare Momentum break alone (−1.4%, 41% positive, n=22), which is the
// opposite of the intuitive expectation."
// So the reader must not be told "at least the balance sheet is fine". D7's own reading is −2.9%
// forward, 40% positive (n=10) — worse than the unconditioned break it is a subset of. That contrast
// travels in evidence and is spoken in the verdict, because a reader who supplies the intuitive
// reading themselves will get it exactly backwards.
//
// ── REGIME ────────────────────────────────────────────────────────────────────────────────────────
// "In NORMAL phases −4.9%, 38% positive — reads more clearly in calm markets, consistent with every
// directional pattern in the model." Recorded; D7 has no regime-conditional COPY in the spec (only D1
// and D6 do), so the phase is carried as evidence, not as an appended sentence.
//
// ── CROSSING, NOT A GAP — see d6-quality-rolling-over.ts for why §1.2's tier is not applied ───────
// Same reasoning: the trigger is a crossing (below 54 from ≥54), and the F−M gap at fire time is
// incidental to it. `gapPp` is context; no tier is claimed; the 8–11 suppression does not gate it.

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";
import { scoredPair } from "../divergence/bands.js";
import { distinctAtPrecision, roundToPrecision } from "../format.js";
import type { FireRule } from "../types.js";

const ENTRY = STOCK_FINDINGS.divergence_D7_trajectory_breaking_base_holds;
const FACTS = ENTRY.facts;

/** §Part 2 D7 — the level being crossed DOWN through, read from the record (Momentum's native weak
 *  mark). */
export const D7_MOMENTUM_CROSS = FACTS.evidencedTier; // 54
/** §Part 2 D7 — Foundation's native weak mark; the base must be at or above it, now homed in
 *  `FACTS.legs` — see the same note on D6. */
export const D7_FOUNDATION_MIN = FACTS.legs.find((l) => l.pillar === "foundation")!.value; // 60

/** ★ ONE FORMATTER, THE PATTERN'S OWN PRECISION — see d1-price-ahead-quality.ts's full note. */
const round = (x: number) => roundToPrecision(x, FACTS.displayPrecision);

export const ruleD7: FireRule = (ctx) => {
  const f = ctx.current.pillars.foundation;
  const m = ctx.current.pillars.momentum;
  const p = scoredPair(f, m); // inert-0 guard
  if (!p) return null;
  const foundation = p.a, momentum = p.b;

  if (foundation < D7_FOUNDATION_MIN) return null;
  if (momentum >= D7_MOMENTUM_CROSS) return null; // must be BELOW now

  // ★ the crossing: the prior reading must have been AT OR ABOVE the mark.
  if (ctx.priorSnapshots.length === 0) return null;
  const prior = ctx.priorSnapshots[ctx.priorSnapshots.length - 1];
  if (!prior.momentumScored || prior.momentum === null) return null;
  if (prior.momentum < D7_MOMENTUM_CROSS) return null; // was already weak — not a break
  // ★ THE DISPLAY-PRECISION GATE ("Ruling 3 on T9" — format.ts). D7 has NO minimum-margin floor on the
  // crossing itself — see d6-quality-rolling-over.ts's identical note.
  if (!distinctAtPrecision(prior.momentum, momentum, FACTS.displayPrecision)) return null;

  return {
    kind: "pattern",
    key: ENTRY.key,
    // Early warning, n=10 — investigate register, not alarm.
    severity: "medium",
    direction: "negative",
    polarity: "negative",
    temporalClass: "EVENT",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "D7",
      name: "Trajectory Breaking While the Base Holds",
      foundation: round(foundation),
      momentum: round(momentum),
      momentumPrior: round(prior.momentum),
      momentumFallPp: round(prior.momentum - momentum),
      crossedBelow: D7_MOMENTUM_CROSS,
      foundationMin: D7_FOUNDATION_MIN,
      gapPp: round(foundation - momentum),
      gapTierApplies: false,
      isCrossing: true,
      evidencedForwardPct: -2.9,
      evidencedPositivePct: 40,
      evidencedN: 10,
      normalPhasePct: -4.9,
      normalPhasePositivePct: 38,
      // ★ the counter-intuitive contrast — the intact base does NOT cushion this
      bareBreakPct: -1.4,
      bareBreakPositivePct: 41,
      bareBreakN: 22,
      baseDoesNotCushion: true,
    },
    metricRefs: ["momentum", "foundation"],
  };
};
