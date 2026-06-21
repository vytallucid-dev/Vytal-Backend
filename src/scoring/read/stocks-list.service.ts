// File: src/scoring/read/stocks-list.service.ts
//
// The lean scored-stock LIST + per-tool SCAN ranking assemblers.
//
// Reuse, not reinvention: the in-force row per (stock, period) is resolved with the
// SAME supersede-aware MAX(version) rule the shared resolver enforces, and the
// trajectory marker reuses the SAME eps=1.0 threshold as health-view / peer-group.
// Two queries total regardless of universe size (all stocks + all quarterly
// snapshots, lean), reduced in-memory — the same shape buildPeerGroupList() uses.
//
//   buildScoredStocksList() → one row per SCORED stock (composite + band + identity)
//   buildToolScan(tool)     → scored stocks ranked by "most-interesting journey"

import { prisma } from "../../db/prisma.js";
import type {
  LabelBand,
  TrajectoryMarker,
  DivergenceFlag,
  PillarKey,
} from "./health-view.types.js";
import type {
  ScoredStockListItem,
  UniverseStockListItem,
  StockScanItem,
  DivergenceScanItem,
  DivergenceConfig,
  DivergenceDirection,
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

const TRAJECTORY_EPS = 1.0; // same threshold as health-view / peer-group marker
const SPARK_MAX = 8; // recent in-force composites carried for the landing card

// Divergence thresholds — IDENTICAL to health-view (DIVERGENCE_NOTABLE/WIDE) so the
// scan's flag matches the single view's.
const DIVERGENCE_NOTABLE = 15;
const DIVERGENCE_WIDE = 25;
const GAP_EPS = 1.0; // slope deadband for widening vs narrowing
const ALL_PILLARS: PillarKey[] = ["foundation", "momentum", "market", "ownership"];

/** A lean snapshot row used for the in-force reduction. Carries the four pillar
 *  subtotals AND their applied weights (both denormalised on ScoreSnapshot) so the
 *  divergence scan needs no join. A pillar with applied weight 0 was
 *  `unavailable_redistributed` — its subtotal is meaningless and must be excluded
 *  from the spread, else a phantom gap dominates the ranking. */
interface LeanSnap {
  id: string;
  stockId: string;
  periodKey: string;
  version: number;
  asOfDate: Date;
  composite: number;
  labelBand: LabelBand;
  foundation: number;
  momentum: number;
  market: number;
  ownership: number;
  wFoundation: number;
  wMomentum: number;
  wMarket: number;
  wOwnership: number;
}

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

/** Fetch all stocks + all quarterly snapshots, bucketed by stock. The shared
 *  source for both the list and the scan (so one shape, one reduction rule). */
async function loadUniverse() {
  const [stocks, snaps] = await Promise.all([
    prisma.stock.findMany({
      select: {
        id: true,
        symbol: true,
        name: true,
        sector: { select: { name: true, displayName: true } },
      },
    }),
    prisma.scoreSnapshot.findMany({
      where: { snapshotType: "quarterly" },
      select: {
        id: true,
        stockId: true,
        periodKey: true,
        version: true,
        asOfDate: true,
        composite: true,
        labelBand: true,
        foundationSubtotal: true,
        momentumSubtotal: true,
        marketSubtotal: true,
        ownershipSubtotal: true,
        wFoundation: true,
        wMomentum: true,
        wMarket: true,
        wOwnership: true,
      },
    }),
  ]);

  const byStock = new Map<string, LeanSnap[]>();
  for (const s of snaps) {
    const arr = byStock.get(s.stockId) ?? [];
    arr.push({
      id: s.id,
      stockId: s.stockId,
      periodKey: s.periodKey,
      version: s.version,
      asOfDate: s.asOfDate,
      composite: num(s.composite),
      labelBand: s.labelBand as LabelBand,
      foundation: num(s.foundationSubtotal),
      momentum: num(s.momentumSubtotal),
      market: num(s.marketSubtotal),
      ownership: num(s.ownershipSubtotal),
      wFoundation: num(s.wFoundation),
      wMomentum: num(s.wMomentum),
      wMarket: num(s.wMarket),
      wOwnership: num(s.wOwnership),
    });
    byStock.set(s.stockId, arr);
  }

  return { stocks, byStock };
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
  const { stocks, byStock } = await loadUniverse();

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
  const { stocks, byStock } = await loadUniverse();

  return stocks
    .map((st): UniverseStockListItem => {
      const rows = byStock.get(st.id);
      if (!rows || rows.length === 0) {
        return {
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
 * Scored stocks ranked for the given tool's landing scan. `trajectory` and
 * `divergence` are implemented (over the SAME lean query group); `ownership`
 * remains the seam for later. Returns null for an unimplemented tool so the
 * controller can answer honestly (400).
 */
export async function buildToolScan(
  tool: string,
): Promise<StockScanItem[] | DivergenceScanItem[] | OwnershipScanItem[] | null> {
  if (tool === "trajectory") return buildTrajectoryScan();
  if (tool === "divergence") return buildDivergenceScan();
  if (tool === "ownership") return buildOwnershipScan();
  return null;
}

// ── TRAJECTORY scan ───────────────────────────────────────────────────────────

/** Rank tier — movers (improving/deteriorating) above stable above building-history.
 *  Within a tier, larger |delta| first. Surfaces the most-interesting journeys. */
function trajectoryTier(it: StockScanItem): number {
  if (it.marker == null) return 0; // building history (no second period)
  if (it.marker === "stable") return 1;
  return 2; // improving | deteriorating
}

async function buildTrajectoryScan(): Promise<StockScanItem[]> {
  const { stocks, byStock } = await loadUniverse();

  const items = stocks.flatMap((st): StockScanItem[] => {
    const rows = byStock.get(st.id);
    if (!rows || rows.length === 0) return [];
    const series = inForceNewestFirst(rows); // newest → oldest
    const latest = series[0];
    const prior = series[1] ?? null;

    let marker: TrajectoryMarker | null = null;
    let delta: number | null = null;
    if (prior) {
      delta = round2(latest.composite - prior.composite);
      marker =
        delta > TRAJECTORY_EPS
          ? "improving"
          : delta < -TRAJECTORY_EPS
            ? "deteriorating"
            : "stable";
    }

    const spark = series
      .slice(0, SPARK_MAX)
      .map((s) => round2(s.composite))
      .reverse();

    return [
      {
        symbol: st.symbol,
        name: st.name,
        sector: sectorRef(st.sector),
        composite: round2(latest.composite),
        band: latest.labelBand,
        periodKey: latest.periodKey,
        marker,
        delta,
        previousComposite: prior ? round2(prior.composite) : null,
        previousPeriodKey: prior?.periodKey ?? null,
        spark,
      },
    ];
  });

  items.sort(
    (a, b) =>
      trajectoryTier(b) - trajectoryTier(a) ||
      Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) ||
      a.symbol.localeCompare(b.symbol),
  );

  return items;
}

// ── DIVERGENCE scan ───────────────────────────────────────────────────────────

const subtotalOf = (s: LeanSnap, p: PillarKey): number =>
  p === "foundation" ? s.foundation : p === "momentum" ? s.momentum : p === "market" ? s.market : s.ownership;

const weightOf = (s: LeanSnap, p: PillarKey): number =>
  p === "foundation" ? s.wFoundation : p === "momentum" ? s.wMomentum : p === "market" ? s.wMarket : s.wOwnership;

/** Pillars that were actually SCORED in this snapshot (applied weight > 0). An
 *  `unavailable_redistributed` pillar has weight 0 and a meaningless subtotal — it
 *  must never enter the spread (else a phantom gap dominates). */
const scoredPillars = (s: LeanSnap): PillarKey[] => ALL_PILLARS.filter((p) => weightOf(s, p) > 0);

/** The two SCORED pillars furthest apart (max / min subtotal). Null when fewer than
 *  two pillars were scored — no spread can be read. */
function highLowPair(s: LeanSnap): { high: PillarKey; low: PillarKey } | null {
  const scored = scoredPillars(s);
  if (scored.length < 2) return null;
  let high = scored[0];
  let low = scored[0];
  for (const p of scored) {
    if (subtotalOf(s, p) > subtotalOf(s, high)) high = p;
    if (subtotalOf(s, p) < subtotalOf(s, low)) low = p;
  }
  return { high, low };
}

/** The asymmetric taxonomy from the (high, low) pair. Ownership in the pair → an
 *  ownership tell; else Market leading → price_ahead, Market lagging → value;
 *  else two fundamental pillars apart → mixed. */
export function divergenceConfig(high: PillarKey, low: PillarKey): DivergenceConfig {
  if (high === "ownership" || low === "ownership") return "ownership";
  if (high === "market") return "price_ahead";
  if (low === "market") return "value";
  return "mixed";
}

export function divergenceFlag(gap: number): DivergenceFlag {
  return gap >= DIVERGENCE_WIDE ? "wide" : gap >= DIVERGENCE_NOTABLE ? "notable" : "none";
}

function divergenceDirection(gapDelta: number | null): DivergenceDirection {
  if (gapDelta == null) return "steady";
  return gapDelta > GAP_EPS ? "widening" : gapDelta < -GAP_EPS ? "narrowing" : "steady";
}

const flagTier: Record<DivergenceFlag, number> = { wide: 2, notable: 1, none: 0 };

async function buildDivergenceScan(): Promise<DivergenceScanItem[]> {
  const { stocks, byStock } = await loadUniverse();

  const items = stocks.flatMap((st): DivergenceScanItem[] => {
    const rows = byStock.get(st.id);
    if (!rows || rows.length === 0) return [];
    const series = inForceNewestFirst(rows); // newest → oldest
    const latest = series[0];

    // Fix the spread pair on the latest SCORED pillars; skip stocks that can't read
    // a spread (fewer than two scored pillars).
    const pair = highLowPair(latest);
    if (!pair) return [];
    const { high, low } = pair;

    // The fixed pair's gap, but only over periods where BOTH were scored (weight > 0)
    // — so a quarter where one pillar was unavailable never injects a phantom gap.
    const validGaps = series
      .filter((s) => weightOf(s, high) > 0 && weightOf(s, low) > 0)
      .map((s) => round2(subtotalOf(s, high) - subtotalOf(s, low))); // newest → oldest

    const gap = validGaps[0];
    const previousGap = validGaps[1] ?? null;
    const gapDelta = previousGap != null ? round2(gap - previousGap) : null;

    const spark = validGaps.slice(0, SPARK_MAX).reverse(); // oldest → newest

    return [
      {
        symbol: st.symbol,
        name: st.name,
        sector: sectorRef(st.sector),
        composite: round2(latest.composite),
        band: latest.labelBand,
        periodKey: latest.periodKey,
        gap,
        flag: divergenceFlag(gap),
        config: divergenceConfig(high, low),
        direction: divergenceDirection(gapDelta),
        highPillar: high,
        lowPillar: low,
        previousGap,
        gapDelta,
        spark,
      },
    ];
  });

  // Rank by tension: flag tier, then gap magnitude.
  items.sort(
    (a, b) =>
      flagTier[b.flag] - flagTier[a.flag] ||
      b.gap - a.gap ||
      a.symbol.localeCompare(b.symbol),
  );

  return items;
}

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
  const { stocks, byStock } = await loadUniverse();

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
