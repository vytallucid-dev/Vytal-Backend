// File: src/scoring/findings/trajectory/view.ts
//
// Turns a FiringContext into the ordered series the trajectory rules read: the prior
// snapshots PLUS the current (in-memory) snapshot as the newest point. PURE.

import type { FiringContext } from "../types.js";
import type { LabelBand, Pillar } from "../../composite/types.js";

export interface SeriesPoint {
  periodKey: string;
  composite: number;
  labelBand: LabelBand;
  foundation: number | null;
  momentum: number | null;
  market: number | null;
  ownership: number | null;
}

/** [...priorSnapshots (oldest→newest), current]. The current pillar value is its subtotal
 *  only when genuinely scored (an unavailable pillar → null, never an inert 0). */
export function seriesWithCurrent(ctx: FiringContext): SeriesPoint[] {
  const p = ctx.current.pillars;
  const scored = (k: Pillar) => (p[k].state === "scored" ? p[k].subtotal : null);
  const cur: SeriesPoint = {
    periodKey: ctx.periodKey,
    composite: ctx.current.composite,
    labelBand: ctx.current.labelBand,
    foundation: scored("foundation"),
    momentum: scored("momentum"),
    market: scored("market"),
    ownership: scored("ownership"),
  };
  const priors = ctx.priorSnapshots.map((s): SeriesPoint => ({
    periodKey: s.periodKey, composite: s.composite, labelBand: s.labelBand,
    foundation: s.foundation, momentum: s.momentum, market: s.market, ownership: s.ownership,
  }));
  return [...priors, cur];
}

/** The C-family price-vs-fundamentals gap at a point: Market − mean(Foundation, Momentum),
 *  or null unless all three are scored (the inert-0 guard, same as C1). */
export function priceGap(s: SeriesPoint): number | null {
  if (s.market === null || s.foundation === null || s.momentum === null) return null;
  return s.market - (s.foundation + s.momentum) / 2;
}

/** Caveat stamped into every trajectory finding's evidence so the read layer knows the
 *  series bands are under TODAY's calibration, not as-of-period bars. */
export const CALIBRATION_NOTE = "current-calibration: historical bands computed under today's bars";
