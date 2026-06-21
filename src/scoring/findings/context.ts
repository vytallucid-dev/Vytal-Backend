// File: src/scoring/findings/context.ts
//
// FiringContext assembly helpers (pure). The hook (score-pass.ts) owns the raw inputs;
// these turn them into the shapes rules read. Kept tiny + pure so the proof and the live
// hook build identical contexts.

import type { MomentumQuarter } from "../metrics/types.js";
import type { CompositeResult, Pillar } from "../composite/types.js";
import type { PillarSnapshot, QuarterlyOpmPoint } from "./types.js";

/** Quarterly OPM series (ASC) from standalone momentum quarters. OPM = operatingProfit /
 *  revenue × 100 — the stored `operating_margin` column equals this exactly (verified
 *  across the universe). Skips quarters missing either input or with zero revenue. */
export function opmSeriesFromQuarters(qRows: MomentumQuarter[]): QuarterlyOpmPoint[] {
  const out: QuarterlyOpmPoint[] = [];
  for (const q of [...qRows].sort((a, b) => a.qOrdinal - b.qOrdinal)) {
    if (q.operatingProfitStored === null || q.revenue === null || q.revenue === 0) continue;
    out.push({ periodKey: `${q.fiscalYear}${q.quarter}`, opm: (q.operatingProfitStored / q.revenue) * 100 });
  }
  return out;
}

/** Project an assembled CompositeResult's four PillarInputs into the rule-facing map
 *  (subtotal + state per pillar). State is preserved so rules can apply the inert-0
 *  guard (an unavailable_redistributed pillar has subtotal stored as 0 but state ≠ scored). */
export function pillarMapOf(c: CompositeResult): Record<Pillar, PillarSnapshot> {
  const get = (p: Pillar): PillarSnapshot => {
    const pi = c.pillars.find((x) => x.pillar === p);
    return { subtotal: pi?.subtotal ?? null, state: pi?.state ?? "unavailable_redistributed" };
  };
  return { foundation: get("foundation"), momentum: get("momentum"), market: get("market"), ownership: get("ownership") };
}
