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

import { Prisma } from "../../../generated/prisma/client.js";
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
 * ★ THE VERSION-CHURN REDUCTION — EXTRACTED SO IT HAS ONE HOME.
 *
 * ScoreSnapshot (and score_patterns hanging off it) is APPEND-ONLY with NO uniqueness constraint on
 * (stock, period): a period accumulates one row per snapshot VERSION as the supersede chain grows.
 * ACC/FY27Q1 exists at versions 11, 12 and 13; GLENMARK/FY26Q4 at 36. Reading those rows AS HISTORY
 * reads version churn as pattern history and inflates every run length several-fold — which is the
 * single correctness trap in any "how long has this been true" question asked of this schema.
 *
 * Collapse to the HEAD (max version) per period. A caller that genuinely needs the intra-period path
 * asks for it explicitly and says why (see read/finding-lifecycle.service.ts's two-clock loader); this
 * is the default, and it is the reduction loadTrajectorySeries has always done inline.
 *
 * @param strictlyBefore when set, periods at or after this key are excluded outright (the trajectory
 *        loader's point-in-time rule: a rule scoring period P may never see P or the future).
 */
export function headOfChainByPeriod<T extends { periodKey: string; version: number }>(
  rows: readonly T[],
  opts: { strictlyBefore?: string } = {},
): Map<string, T> {
  const cutOrd = opts.strictlyBefore === undefined ? null : periodOrdinal(opts.strictlyBefore);
  const head = new Map<string, T>();
  for (const r of rows) {
    if (cutOrd !== null && periodOrdinal(r.periodKey) >= cutOrd) continue;
    const ex = head.get(r.periodKey);
    if (!ex || r.version > ex.version) head.set(r.periodKey, r);
  }
  return head;
}

/** One already-collapsed head row, as Postgres returns it (snake_case, numerics as strings). */
interface HeadRow {
  period_key: string;
  as_of_date: Date;
  version: number;
  composite: unknown;
  label_band: string;
  foundation_subtotal: unknown;
  momentum_subtotal: unknown;
  market_subtotal: unknown;
  ownership_subtotal: unknown;
  w_foundation: unknown;
  w_momentum: unknown;
  w_market: unknown;
  w_ownership: unknown;
}

/**
 * Load a stock's prior-snapshot trajectory (oldest→newest), head-of-chain, STRICTLY before
 * `currentPeriodKey`, and ≤ `cutoff` when set. Excludes the current + future periods.
 *
 * ── ★ WHY THIS IS RAW SQL AND NOT `distinct: ["periodKey"]` ──────────────────────────────────────
 * The collapse used to happen in JS: fetch every version, keep the max per period. That read the
 * WHOLE supersede chain to use ~7 rows of it — GLENMARK returns 46 rows for 6 useful ones — and the
 * ratio grows with every trading day, because the daily Market pass appends a version per stock that
 * moved. Some (stock, period) pairs are already at version 41.
 *
 * Prisma's `distinct` does NOT fix this, and it looks like it does, which is the trap. Verified
 * against Prisma 7.7: `distinct: ["periodKey"]` with `orderBy: [{periodKey}, {version: "desc"}]`
 * emits NO distinct clause at all —
 *     SELECT … FROM score_snapshots WHERE … ORDER BY period_key ASC, version DESC OFFSET $3
 * — and dedupes inside the query engine. The JS-visible count drops to 6 while all 46 rows still
 * cross the wire, so the only cost that matters is unchanged. DISTINCT ON is therefore written out
 * by hand, where Postgres can actually apply it.
 *
 * IDENTICAL OUTPUT BY CONSTRUCTION: `DISTINCT ON (period_key) … ORDER BY period_key, version DESC`
 * selects the max-version row per period — the same row `headOfChainByPeriod` picks. The collapse
 * below is KEPT rather than dropped: it still applies `strictlyBefore` (the point-in-time rule), and
 * it is idempotent on input that is already one row per period, so it remains the single home for
 * the reduction for every caller that still hands it a full chain.
 */
export async function loadTrajectorySeries(
  stockId: string,
  currentPeriodKey: string,
  cutoff: Date | null,
): Promise<TrajectoryPoint[]> {
  const raw = await prisma.$queryRaw<HeadRow[]>`
    SELECT DISTINCT ON (period_key)
           period_key, as_of_date, version, composite, label_band::text AS label_band,
           foundation_subtotal, momentum_subtotal, market_subtotal, ownership_subtotal,
           w_foundation, w_momentum, w_market, w_ownership
    FROM score_snapshots
    WHERE stock_id = ${stockId}
      AND snapshot_type = 'quarterly'::"SnapshotType"
      ${cutoff ? Prisma.sql`AND as_of_date <= ${cutoff}` : Prisma.empty}
    ORDER BY period_key, version DESC`;

  // Back to the camelCase shape the collapse + mapper expect. `version` arrives as a JS number
  // (integer column); the numerics stay unconverted and go through `num` below exactly as before.
  const rows = raw.map((r) => ({
    periodKey: r.period_key, asOfDate: r.as_of_date, version: r.version,
    composite: r.composite, labelBand: r.label_band,
    foundationSubtotal: r.foundation_subtotal, momentumSubtotal: r.momentum_subtotal,
    marketSubtotal: r.market_subtotal, ownershipSubtotal: r.ownership_subtotal,
    wFoundation: r.w_foundation, wMomentum: r.w_momentum, wMarket: r.w_market, wOwnership: r.w_ownership,
  }));

  // Head-of-chain per period = max version; exclude current + future periods. ★ ONE HOME — the same
  // reduction the lifecycle resolver runs, extracted above rather than kept as two inline copies.
  // Now a no-op on the max-version pick (SQL already did it) and load-bearing on `strictlyBefore`.
  const headByPeriod = headOfChainByPeriod(rows, { strictlyBefore: currentPeriodKey });

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
