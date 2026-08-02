// File: src/scoring/read/stocks-list.service.ts
//
// The lean scored-stock LIST + per-tool SCAN ranking assemblers.
//
// Reuse, not reinvention: the in-force row per (stock, period) is resolved with the
// SAME supersede-aware MAX(version) rule the shared resolver enforces, and the
// trajectory marker reuses the SAME eps=1.0 threshold as health-view / peer-group.
//
// ── THE READ MOVED OUT, AND IT IS CACHED ──────────────────────────────────────────────────────────
// The two-query load (all stocks + the in-force quarterly snapshots) now lives in
// universe-rows.cache.ts behind a 5-minute stale-while-revalidate slot, because all five builders
// below open with the identical read and nothing about it is per-request or per-reader. That module
// also carries the `distinct` that stopped this read shipping 3,110 superseded rows it then threw
// away. Everything below is unchanged: the same rows arrive, and the same in-memory reduction
// (inForceNewestFirst) remains the authority on which snapshot is in force.
//
// ⚠ THE ROWS ARE SHARED, NOT COPIED. Never sort or splice `stocks`, or a `byStock` array, in place —
// every other endpoint is holding the same objects. Reduce into a new array, as all five already do.
//
//   buildScoredStocksList() → one row per SCORED stock (composite + band + identity)
//   buildToolScan(tool)     → scored stocks ranked by "most-interesting journey"

import { prisma } from "../../db/prisma.js";
import { getUniverseRows, type LeanSnap } from "./universe-rows.cache.js";
import { buildToolScan as buildFindingsToolScan, type ToolScanItem } from "./tool-scan.service.js";
import type { LabelBand, PillarKey } from "./health-view.types.js";

/** Recent in-force composites carried for the OWNERSHIP landing card's sparkline. */
const SPARK_MAX = 8;
import type {
  ScoredStockListItem,
  UniverseStockListItem,
  OwnershipScanItem,
  OwnershipTell,
  SectorRef,
} from "./stocks-list.types.js";

const num = (d: unknown): number =>
  d == null
    ? 0
    : typeof (d as { toNumber?: () => number }).toNumber === "function"
      ? (d as { toNumber: () => number }).toNumber()
      : Number(d);
const numN = (d: unknown): number | null =>
  d == null
    ? null
    : typeof (d as { toNumber?: () => number }).toNumber === "function"
      ? (d as { toNumber: () => number }).toNumber()
      : Number(d);
const round2 = (x: number): number => Math.round(x * 100) / 100;

// ⚠ DELETED IN PHASE 4 — the tool-recomputation constants. Not moved, not renamed: GONE.
//   TRAJECTORY_EPS · DIVERGENCE_NOTABLE (15) · DIVERGENCE_WIDE (25) · GAP_EPS · ALL_PILLARS
// The 15/25 pair was the tools' own definition of "divergence", competing with the engine's
// (which Phase 2 moved to 12). Both tools now read the persisted findings — see buildToolScan.

/** Reduce a stock's raw snapshots to its in-force series, NEWEST→OLDEST:
 *  MAX(version) within each periodKey, then ordered by asOfDate desc. */
function inForceNewestFirst(rows: LeanSnap[]): LeanSnap[] {
  const byPeriod = new Map<string, LeanSnap>();
  for (const r of rows) {
    const cur = byPeriod.get(r.periodKey);
    if (
      !cur ||
      r.version > cur.version ||
      (r.version === cur.version && r.asOfDate > cur.asOfDate)
    ) {
      byPeriod.set(r.periodKey, r);
    }
  }
  return [...byPeriod.values()].sort(
    (a, b) =>
      b.asOfDate.getTime() - a.asOfDate.getTime() ||
      b.periodKey.localeCompare(a.periodKey),
  );
}

const sectorRef = (
  sector: { name: string; displayName: string } | null,
): SectorRef | null => (sector ? { key: sector.name, displayName: sector.displayName } : null);

/**
 * One lean row per SCORED stock (has ≥1 in-force snapshot): composite + band +
 * identity. Stocks without any quarterly snapshot are omitted (not "scored").
 * Sorted by symbol for a stable typeahead order.
 */
export async function buildScoredStocksList(): Promise<ScoredStockListItem[]> {
  const { stocks, byStock } = await getUniverseRows();

  return stocks
    .flatMap((st): ScoredStockListItem[] => {
      const rows = byStock.get(st.id);
      if (!rows || rows.length === 0) return [];
      const latest = inForceNewestFirst(rows)[0];
      return [
        {
          symbol: st.symbol,
          name: st.name,
          sector: sectorRef(st.sector),
          composite: round2(latest.composite),
          band: latest.labelBand,
        },
      ];
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * One lean row per stock in the FULL universe (scored + not-yet-scored), so the
 * screener typeahead can resolve every tracked stock — not only the scored subset.
 * Scored rows carry composite + band; the rest are `scored:false` with nulls.
 * Reuses the SAME two-query loadUniverse + in-force reduction as the scored list.
 * Sorted by symbol for a stable typeahead order.
 */
export async function buildUniverseStocksList(): Promise<UniverseStockListItem[]> {
  const { stocks, byStock } = await getUniverseRows();

  return stocks
    .map((st): UniverseStockListItem => {
      const rows = byStock.get(st.id);
      if (!rows || rows.length === 0) {
        return {
          id: st.id,
          symbol: st.symbol,
          name: st.name,
          sector: sectorRef(st.sector),
          scored: false,
          composite: null,
          band: null,
        };
      }
      const latest = inForceNewestFirst(rows)[0];
      return {
        id: st.id,
        symbol: st.symbol,
        name: st.name,
        sector: sectorRef(st.sector),
        scored: true,
        composite: round2(latest.composite),
        band: latest.labelBand,
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Scored stocks for the given tool's landing scan.
 *
 * ── ★ trajectory / divergence NOW READ THE PERSISTED FINDINGS ─────────────────
 * They no longer recompute a pattern. buildFindingsToolScan (read/tool-scan.service.ts)
 * reads score_patterns on each head snapshot, filters to the tool's FAMILIES, and
 * resolves every string from the catalogue. The recomputed vocabulary this file used
 * to emit — wide|notable|none, value|price_ahead|ownership|mixed — matched no finding
 * key and carried its own 15/25 thresholds, which Phase 2 superseded with 12. Both are
 * gone; see the header of tool-scan.service.ts for the full reasoning.
 *
 * `ownership` is a DIFFERENT instrument and is untouched: it ranks by institutional
 * flow deltas read straight from shareholding filings, not by a recomputed pattern,
 * so it never competed with the findings layer.
 */
export async function buildToolScan(
  tool: string,
): Promise<ToolScanItem[] | OwnershipScanItem[] | null> {
  if (tool === "trajectory") return buildFindingsToolScan("trajectory");
  if (tool === "divergence") return buildFindingsToolScan("divergence");
  if (tool === "ownership") return buildOwnershipScan();
  return null;
}

// ── TRAJECTORY + DIVERGENCE scans — REMOVED (Phase 4) ─────────────────────────
//
// Both recomputed their own patterns here. Deleted wholesale:
//   TRAJECTORY_EPS (1.0) · trajectoryTier() · buildTrajectoryScan()
//   DIVERGENCE_NOTABLE (15) · DIVERGENCE_WIDE (25) · GAP_EPS (1.0)
//   highLowPair() · scoredPillars() · divergenceConfig() · divergenceFlag()
//   divergenceDirection() · flagTier · buildDivergenceScan()
//
// They are replaced by read/tool-scan.service.ts, which reads the PERSISTED findings.
// Nothing that remains in this file computes a pattern.
//
// ⚠ subtotalOf/weightOf survive below ONLY because the OWNERSHIP scan uses them — that
// scan reads shareholding flow, not a recomputed pattern, and was never part of the
// duplication.

// ── OWNERSHIP scan ────────────────────────────────────────────────────────────
//
// Heavier than the trajectory/divergence scans (as approved): beyond loadUniverse it
// does TWO extra reads — r1Fired per latest snapshot, and the full shareholding
// history for every stock (so the tell can be derived from OBSERVED holding-split
// deltas, since the flow trend fields are null in the data). 4 round-trips total.
//
// The tell ranks by what's worth a look: R1 pledge breach > high pledging >
// institutions distributing > accumulating > rotating > flat. Pledge is derived from
// share counts (% of promoter holding); institutional flow from FII+DII deltas.

const PLEDGE_HIGH = 20; // % of promoter holding pledged → "high pledging" tell
const INST_EPS = 1.5; // pp change in FII+DII over a period that counts as a real move

function ownershipTell(
  r1Fired: boolean,
  pledgePct: number | null,
  instDelta: number | null,
  fiiDelta: number | null,
  diiDelta: number | null,
): OwnershipTell {
  if (r1Fired) return "pledge_r1";
  if (pledgePct != null && pledgePct >= PLEDGE_HIGH) return "pledge_high";
  if (instDelta != null) {
    if (instDelta <= -INST_EPS) return "distribution";
    if (instDelta >= INST_EPS) return "accumulation";
    // net-flat institutional share but FII/DII moved opposite → a rotation
    if (
      fiiDelta != null &&
      diiDelta != null &&
      Math.abs(fiiDelta) >= INST_EPS &&
      Math.sign(fiiDelta) !== Math.sign(diiDelta)
    )
      return "rotation";
  }
  return "flat";
}

const ownershipTier: Record<OwnershipTell, number> = {
  pledge_r1: 5,
  pledge_high: 4,
  distribution: 3,
  accumulation: 2,
  rotation: 1,
  flat: 0,
};

// one shareholding observation, lean, for the scan's delta + spark math.
// fiiPct/diiPct are Prisma Decimals → ALWAYS convert with numN before arithmetic
// (a bare `+` on two Decimals does not coerce to number — it yields NaN).
interface ShpLean {
  asOnDate: Date;
  fiiPct: unknown;
  diiPct: unknown;
  pledgedShares: bigint | null;
  promoterShares: bigint | null;
}
const inst = (r: ShpLean): number => (numN(r.fiiPct) ?? 0) + (numN(r.diiPct) ?? 0);

/** Pledge as % of promoter holding, from the reliable BigInt share counts (the
 *  Decimal pledge column is unit-inconsistent and unused). Genuine 0 → 0. */
const pledgePctOfPromoter = (pledged: bigint | null, promoter: bigint | null): number | null => {
  if (pledged == null) return null;
  const pl = Number(pledged);
  if (pl === 0) return 0;
  const prom = promoter != null ? Number(promoter) : null;
  return prom && prom > 0 ? round2((pl / prom) * 100) : null;
};

async function buildOwnershipScan(): Promise<OwnershipScanItem[]> {
  const { stocks, byStock } = await getUniverseRows();

  const latestByStock = new Map<
    string,
    { id: string; periodKey: string; composite: number; band: LabelBand }
  >();
  const latestIds: string[] = [];
  for (const [stockId, rows] of byStock) {
    const latest = inForceNewestFirst(rows)[0];
    latestByStock.set(stockId, {
      id: latest.id,
      periodKey: latest.periodKey,
      composite: round2(latest.composite),
      band: latest.labelBand,
    });
    latestIds.push(latest.id);
  }

  // 1 query: r1Fired + ownership subtotal for the latest snapshots
  const osSnaps = latestIds.length
    ? await prisma.scoreSnapshot.findMany({
        where: { id: { in: latestIds } },
        select: {
          stockId: true,
          ownershipSubtotal: true,
          ownershipPillar: { select: { ownershipScore: { select: { r1Fired: true } } } },
        },
      })
    : [];
  const osByStock = new Map<string, { r1Fired: boolean; finalOwnership: number }>();
  for (const s of osSnaps) {
    osByStock.set(s.stockId, {
      r1Fired: s.ownershipPillar?.ownershipScore?.r1Fired ?? false,
      finalOwnership: num(s.ownershipSubtotal),
    });
  }

  // 1 query: full shareholding history for all stocks (newest-first per stock).
  const stockIds = [...byStock.keys()];
  const shpRows = stockIds.length
    ? ((await prisma.shareholdingPattern.findMany({
        where: { stockId: { in: stockIds } },
        orderBy: [{ stockId: "asc" }, { asOnDate: "desc" }],
        select: {
          stockId: true,
          asOnDate: true,
          fiiPct: true,
          diiPct: true,
          pledgedShares: true,
          promoterShares: true,
        },
      })) as (ShpLean & { stockId: string })[])
    : [];
  const shpByStock = new Map<string, ShpLean[]>();
  for (const r of shpRows) {
    const arr = shpByStock.get(r.stockId) ?? [];
    arr.push(r); // already newest-first
    shpByStock.set(r.stockId, arr);
  }

  const items = stocks.flatMap((st): OwnershipScanItem[] => {
    const latest = latestByStock.get(st.id);
    if (!latest) return [];
    const os = osByStock.get(st.id) ?? { r1Fired: false, finalOwnership: 0 };
    const shp = shpByStock.get(st.id) ?? [];
    const cur = shp[0] ?? null;
    const prev = shp[1] ?? null;

    const pledgedPctOfPromoter = cur ? pledgePctOfPromoter(cur.pledgedShares, cur.promoterShares) : null;
    const instDelta = cur && prev ? round2(inst(cur) - inst(prev)) : null;
    const fiiDelta = cur && prev ? round2((numN(cur.fiiPct) ?? 0) - (numN(prev.fiiPct) ?? 0)) : null;
    const diiDelta = cur && prev ? round2((numN(cur.diiPct) ?? 0) - (numN(prev.diiPct) ?? 0)) : null;
    // institutional share over time (oldest→newest, ≤ SPARK_MAX)
    const spark = shp
      .slice(0, SPARK_MAX)
      .map((r) => round2(inst(r)))
      .reverse();

    return [
      {
        symbol: st.symbol,
        name: st.name,
        sector: sectorRef(st.sector),
        composite: latest.composite,
        band: latest.band,
        periodKey: latest.periodKey,
        tell: ownershipTell(os.r1Fired, pledgedPctOfPromoter, instDelta, fiiDelta, diiDelta),
        r1Fired: os.r1Fired,
        pledgedPctOfPromoter,
        instDelta,
        fiiDelta,
        diiDelta,
        finalOwnership: round2(os.finalOwnership),
        spark,
      },
    ];
  });

  items.sort(
    (a, b) =>
      ownershipTier[b.tell] - ownershipTier[a.tell] ||
      Math.abs(b.instDelta ?? 0) - Math.abs(a.instDelta ?? 0) ||
      (b.pledgedPctOfPromoter ?? 0) - (a.pledgedPctOfPromoter ?? 0) ||
      a.symbol.localeCompare(b.symbol),
  );

  return items;
}
