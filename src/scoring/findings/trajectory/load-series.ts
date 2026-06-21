// File: src/scoring/findings/trajectory/load-series.ts
//
// THE TRAJECTORY SUBSTRATE LOADER — populates FiringContext.priorSnapshots (the slot built
// in Stage A, filled here). Reads the stock's backfilled ScoreSnapshot history as an ordered
// oldest→newest series for the trajectory rules (B/D/G/I/F2/C-over-time).
//
// POINT-IN-TIME (load-bearing): a trajectory rule scoring period P must see ONLY snapshots
// STRICTLY BEFORE P — never the current period and never the future. Enforced two ways:
//   (1) periodKey ordinal < the current period's ordinal (excludes current + future cleanly,
//       independent of asOfDate quirks — a live re-score's current snapshot has a "now"
//       asOfDate that would otherwise leak in), and
//   (2) asOfDate ≤ cutoff when a point-in-time cutoff is set (the same discipline every other
//       raw read uses). Belt-and-suspenders.
//
// HEAD-OF-CHAIN: a period may have several versions (supersede chain). We keep the MAX
// version per period (the live head), never a stale superseded row.
//
// CURRENT-CALIBRATION CAVEAT: historical bands/composites were computed under TODAY's bars
// (the backfill's documented limitation). Within this calibration era a band cross reads
// consistently — which is what trajectory rules need — but the read layer should know the
// series is current-calibration, not as-of-period bars. Surfaced in each rule's evidence.

import { prisma } from "../../../db/prisma.js";
import type { TrajectoryPoint } from "../types.js";
import type { LabelBand } from "../../composite/types.js";

const num = (d: any): number => (d == null ? 0 : typeof d.toNumber === "function" ? d.toNumber() : Number(d));

/** "FY26Q4" → chronological ordinal (FY*4 + Q). 0 for a malformed key (sorts first). */
export function periodOrdinal(periodKey: string): number {
  const m = /^FY(\d{2})Q([1-4])$/.exec(periodKey);
  return m ? Number(m[1]) * 4 + Number(m[2]) : 0;
}

/**
 * Load a stock's prior-snapshot trajectory (oldest→newest), head-of-chain, STRICTLY before
 * `currentPeriodKey`, and ≤ `cutoff` when set. Excludes the current + future periods.
 */
export async function loadTrajectorySeries(
  stockId: string,
  currentPeriodKey: string,
  cutoff: Date | null,
): Promise<TrajectoryPoint[]> {
  const rows = await prisma.scoreSnapshot.findMany({
    where: { stockId, snapshotType: "quarterly", ...(cutoff ? { asOfDate: { lte: cutoff } } : {}) },
    select: {
      periodKey: true, asOfDate: true, version: true, composite: true, labelBand: true,
      foundationSubtotal: true, momentumSubtotal: true, marketSubtotal: true, ownershipSubtotal: true,
      wFoundation: true, wMomentum: true, wMarket: true, wOwnership: true,
    },
  });

  const curOrd = periodOrdinal(currentPeriodKey);
  // Head-of-chain per period = max version; exclude current + future periods.
  const headByPeriod = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (periodOrdinal(r.periodKey) >= curOrd) continue; // strictly before current (no leak)
    const ex = headByPeriod.get(r.periodKey);
    if (!ex || r.version > ex.version) headByPeriod.set(r.periodKey, r);
  }

  return [...headByPeriod.values()]
    .sort((a, b) => periodOrdinal(a.periodKey) - periodOrdinal(b.periodKey))
    .map((r): TrajectoryPoint => {
      const wF = num(r.wFoundation), wM = num(r.wMomentum), wMkt = num(r.wMarket), wO = num(r.wOwnership);
      // An unavailable pillar persisted an inert-0 subtotal with w=0 → expose it as null/not-scored.
      return {
        periodKey: r.periodKey,
        asOfDate: r.asOfDate,
        composite: num(r.composite),
        labelBand: r.labelBand as LabelBand,
        foundation: wF > 0 ? num(r.foundationSubtotal) : null,
        momentum: wM > 0 ? num(r.momentumSubtotal) : null,
        market: wMkt > 0 ? num(r.marketSubtotal) : null,
        ownership: wO > 0 ? num(r.ownershipSubtotal) : null,
        foundationScored: wF > 0,
        momentumScored: wM > 0,
        marketScored: wMkt > 0,
        ownershipScored: wO > 0,
      };
    });
}
