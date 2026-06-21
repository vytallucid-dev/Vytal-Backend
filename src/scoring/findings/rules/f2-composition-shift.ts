// File: src/scoring/findings/rules/f2-composition-shift.ts
//
// F2 — Composition Shift (File 1 §5F · severity Low). TRAJECTORY rule. Fire: the pillar MIX
// shifted materially vs the LAST snapshot THOUGH the composite held — which pillar carries
// the score changed (e.g. Foundation-led → Market-led) while the headline number barely moved.
//
// Distinct from F1 (Stage E): F1 = atypical-for-band composition at a POINT (vs the band-
// typical profile); F2 = shifted-vs-LAST-snapshot (a trajectory delta). Different references.

import { seriesWithCurrent, CALIBRATION_NOTE, type SeriesPoint } from "../trajectory/view.js";
import type { FireRule } from "../types.js";
import type { Pillar } from "../../composite/types.js";

export const F2_COMPOSITE_HOLD = 3; // |Δ composite| < 3 ⇒ "the composite held" — FLAG: provisional
export const F2_SHIFT_PP = 8;       // a pillar moved ≥ 8pp ⇒ "material mix shift" — FLAG: provisional

const PILLARS: Pillar[] = ["foundation", "momentum", "market", "ownership"];
const leader = (s: SeriesPoint): Pillar | null => {
  let best: Pillar | null = null, bv = -Infinity;
  for (const k of PILLARS) { const v = s[k]; if (v !== null && v > bv) { bv = v; best = k; } }
  return best;
};

export const ruleF2: FireRule = (ctx) => {
  const series = seriesWithCurrent(ctx);
  if (series.length < 2) return null;
  const cur = series[series.length - 1], prior = series[series.length - 2];
  if (Math.abs(cur.composite - prior.composite) >= F2_COMPOSITE_HOLD) return null; // composite did NOT hold

  // Per-pillar deltas (only where both snapshots scored the pillar).
  const deltas = PILLARS.map((k) => ({ k, d: cur[k] !== null && prior[k] !== null ? (cur[k] as number) - (prior[k] as number) : null }))
    .filter((x): x is { k: Pillar; d: number } => x.d !== null);
  if (!deltas.length) return null;
  const maxAbs = deltas.reduce((m, x) => Math.max(m, Math.abs(x.d)), 0);
  const leadCur = leader(cur), leadPrior = leader(prior);
  const leadChanged = leadCur !== null && leadPrior !== null && leadCur !== leadPrior;
  if (maxAbs < F2_SHIFT_PP && !leadChanged) return null; // no material shift

  const rose = [...deltas].sort((a, b) => b.d - a.d)[0];
  const fell = [...deltas].sort((a, b) => a.d - b.d)[0];
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    kind: "pattern",
    key: "trajectory_F2_composition_shift",
    severity: "low", // §5F
    direction: null, // contextual — no good/bad polarity (a mix shift isn't inherently +/−)
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "F2", name: "Composition Shift",
      compositeHeld: { prior: Math.round(prior.composite), current: Math.round(cur.composite) },
      leaderChanged: leadChanged, leaderPrior: leadPrior, leaderCurrent: leadCur,
      pillarDeltas: deltas.map((x) => ({ pillar: x.k, deltaPp: r1(x.d) })),
      calibration: CALIBRATION_NOTE,
      verdict:
        `Mix shifted while the score held (${Math.round(prior.composite)}→${Math.round(cur.composite)}) — ` +
        `${rose.k} rose ${r1(rose.d)}pp, ${fell.k} fell ${r1(-fell.d)}pp` +
        (leadChanged ? `; lead passed from ${leadPrior} to ${leadCur}.` : `.`),
    },
    metricRefs: [rose.k, fell.k],
  };
};
