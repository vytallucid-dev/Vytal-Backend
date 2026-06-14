// File: src/scoring/composite/composite.ts
//
// THE BLEND. Assemble the composite Health Score from the four pillar inputs:
//
//   composite = Σ appliedWeight[p] · subtotal[p]   over the SURVIVING pillars
//
// where appliedWeight is the §-locked set (0.35/0.25/0.20/0.20) AFTER §14.4
// redistribution (surviving pillars renormalized to sum to 1.0). Full precision is
// stored; the integer rounding is for display only. The label band is derived from
// the full-precision composite (single source: label.ts).
//
// PURE: no DB. The minimum-pillars rule (weights.ts) decides scored vs unavailable.

import {
  type CompositeResult,
  type Pillar,
  type PillarInput,
  type SnapshotType,
} from "./types.js";
import { PILLAR_WEIGHTS, redistributeWeights } from "./weights.js";
import { BAND_MAPPING_VERSION, labelFor } from "./label.js";

export interface CompositeContext {
  snapshotType: SnapshotType;
  periodKey: string;
  asOfDate: Date;
}

const round0 = (x: number) => Math.round(x);

/** Business (non-price) blend over surviving Foundation/Momentum/Ownership, using
 *  their locked weights renormalized among themselves. null if none survive. */
function nonMarketBlend(byPillar: Map<Pillar, PillarInput>, surviving: Pillar[]): number | null {
  const nm = surviving.filter((p) => p !== "market");
  if (nm.length === 0) return null;
  const wsum = nm.reduce((a, p) => a + PILLAR_WEIGHTS[p], 0);
  return nm.reduce((a, p) => a + (PILLAR_WEIGHTS[p] / wsum) * (byPillar.get(p)!.subtotal as number), 0);
}

export function assembleComposite(
  stockId: string,
  symbol: string,
  pillars: PillarInput[],
  ctx: CompositeContext,
): CompositeResult {
  const flags: string[] = [];
  const byPillar = new Map(pillars.map((p) => [p.pillar, p]));

  // A pillar is usable iff it scored AND carries a subtotal.
  const available = {} as Record<Pillar, boolean>;
  for (const p of pillars) available[p.pillar] = p.state === "scored" && p.subtotal !== null;

  const redist = redistributeWeights(available);

  const baseResult: Omit<CompositeResult, "state" | "composite" | "compositeRounded" | "labelBand" | "labelText" | "divergence" | "unavailableReason"> = {
    stockId,
    symbol,
    snapshotType: ctx.snapshotType,
    periodKey: ctx.periodKey,
    asOfDate: ctx.asOfDate,
    bandMappingVersion: BAND_MAPPING_VERSION,
    appliedWeights: redist.weights,
    redistributionReason: redist.reason,
    survivingPillars: redist.surviving,
    unavailablePillars: redist.unavailable,
    pillars,
    flags,
  };

  if (redist.reason !== "none") {
    flags.push(`§14.4 redistribution (${redist.reason}): ${redist.unavailable.join(", ")} unavailable → ${redist.surviving.map((p) => `${p} ${(redist.weights[p] * 100).toFixed(2)}%`).join(", ")}`);
  }

  // Minimum-pillars guard → composite UNAVAILABLE (recorded, not fabricated).
  if (!redist.canScore) {
    return {
      ...baseResult,
      state: "unavailable",
      composite: null,
      compositeRounded: null,
      labelBand: null,
      labelText: null,
      divergence: null,
      unavailableReason: redist.canScoreReason,
    };
  }

  // The blend over surviving pillars.
  let composite = 0;
  for (const p of redist.surviving) composite += redist.weights[p] * (byPillar.get(p)!.subtotal as number);

  const band = labelFor(composite);
  const divergence = available.market ? (() => {
    const blend = nonMarketBlend(byPillar, redist.surviving);
    return blend === null ? null : (byPillar.get("market")!.subtotal as number) - blend;
  })() : null;

  return {
    ...baseResult,
    state: "scored",
    composite,
    compositeRounded: round0(composite),
    labelBand: band.band,
    labelText: band.label,
    divergence,
    unavailableReason: null,
  };
}
