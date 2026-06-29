// File: src/scoring/read/scoring-read.service.ts
//
// THE SHARED SCORING-READ RESOLVER (the reusable core every health surface imports).
//
// ScoreSnapshot is APPEND-ONLY with a supersede chain (schema rulings 1/3): a
// restated quarter writes a NEW `version` pointing `supersedesId` at the prior row;
// nothing is overwritten. The "current" in-force row for a stock is therefore
// MAX(version) per (stockId, snapshotType, periodKey) — then the latest asOfDate
// across periods. A naive findFirst would silently read a superseded/stale row.
//
// StockScoringState is ALSO append-only (ruling 1): a coverage change writes a NEW
// row, newest-by-createdAt wins on read.
//
// These three functions are the SINGLE place the newest-version rule is enforced.
// The per-stock candidate set is tiny (a handful of periods × versions), so the
// MAX(version) reduction is done in-memory for provable correctness rather than via
// a window-function query.

import { prisma } from "../../db/prisma.js";

export type SnapshotType = "quarterly" | "live";
export type CoverageState = "scored" | "covered" | "off_platform";

/** Lightweight in-force snapshot descriptor (the resolution result). */
export interface SnapshotRef {
  id: string;
  stockId: string;
  symbol: string;
  snapshotType: SnapshotType;
  periodKey: string;
  version: number;
  asOfDate: Date;
}

/** One trajectory point — composite + the four pillar subtotals at a period.
 *  Every field is denormalised on ScoreSnapshot, so the series is a single
 *  index-range scan with no joins (schema's QP2 design). */
export interface SeriesPoint {
  periodKey: string;
  asOfDate: Date;
  version: number;
  composite: number;
  labelBand: string;
  foundationSubtotal: number;
  momentumSubtotal: number;
  marketSubtotal: number;
  ownershipSubtotal: number;
}

const num = (d: unknown): number =>
  d == null ? 0 : typeof (d as { toNumber?: () => number }).toNumber === "function"
    ? (d as { toNumber: () => number }).toNumber()
    : Number(d);

/**
 * Reduce a stock's snapshots to the IN-FORCE row per periodKey:
 * MAX(version) within each (snapshotType, periodKey) group. Tie-break on the
 * same version (should never happen given the unique index) by latest asOfDate.
 * Returns a Map<periodKey, SnapshotRef>.
 */
async function inForceByPeriod(
  stockId: string,
  snapshotType: SnapshotType,
): Promise<Map<string, SnapshotRef>> {
  const rows = await prisma.scoreSnapshot.findMany({
    where: { stockId, snapshotType },
    select: {
      id: true,
      stockId: true,
      symbol: true,
      snapshotType: true,
      periodKey: true,
      version: true,
      asOfDate: true,
    },
  });

  const byPeriod = new Map<string, SnapshotRef>();
  for (const r of rows) {
    const ref: SnapshotRef = {
      id: r.id,
      stockId: r.stockId,
      symbol: r.symbol,
      snapshotType: r.snapshotType as SnapshotType,
      periodKey: r.periodKey,
      version: r.version,
      asOfDate: r.asOfDate,
    };
    const cur = byPeriod.get(r.periodKey);
    if (
      !cur ||
      ref.version > cur.version ||
      (ref.version === cur.version && ref.asOfDate > cur.asOfDate)
    ) {
      byPeriod.set(r.periodKey, ref);
    }
  }
  return byPeriod;
}

/**
 * The in-force CURRENT snapshot for a stock: the latest-asOfDate among the
 * MAX(version)-per-period in-force rows. Supersede-aware — never returns a
 * superseded row. Returns the full ScoreSnapshot id ref, or null if the stock
 * has no snapshot of this type.
 *
 * @param snapshotType defaults to "quarterly" — the canonical Health Score the
 *   per-stock health page is built on. Pass "live" for the intraday composite.
 */
export async function getLatestSnapshotRef(
  stockId: string,
  snapshotType: SnapshotType = "quarterly",
): Promise<SnapshotRef | null> {
  const byPeriod = await inForceByPeriod(stockId, snapshotType);
  let latest: SnapshotRef | null = null;
  for (const ref of byPeriod.values()) {
    if (
      !latest ||
      ref.asOfDate > latest.asOfDate ||
      (ref.asOfDate.getTime() === latest.asOfDate.getTime() &&
        ref.periodKey > latest.periodKey)
    ) {
      latest = ref;
    }
  }
  return latest;
}

/**
 * The in-force current snapshot with the FULL relation graph the health view
 * needs (pillars → metrics+bars+peerStats, market subs, ownership+flows,
 * findings, band mapping). Two queries: resolve the in-force id, then one
 * findUnique. Returns null if the stock has no snapshot.
 */
export async function getLatestSnapshot(
  stockId: string,
  snapshotType: SnapshotType = "quarterly",
) {
  const ref = await getLatestSnapshotRef(stockId, snapshotType);
  if (!ref) return null;
  return prisma.scoreSnapshot.findUnique({
    where: { id: ref.id },
    include: {
      bandMappingVersion: true,
      foundationPillar: {
        include: { metricScores: { include: { metricBarSet: true, peerStats: true } } },
      },
      momentumPillar: {
        include: { metricScores: { include: { metricBarSet: true, peerStats: true } } },
      },
      marketPillar: { include: { marketSubScores: true } },
      ownershipPillar: { include: { ownershipScore: { include: { flowCategories: true } } } },
      redFlags: true,
      patterns: true,
    },
  });
}

/**
 * The trailing trajectory series: the in-force (MAX-version) row for each of the
 * most recent `windowQuarters` periods, OLDEST→NEWEST (for left-to-right plotting).
 * Composite + four pillar subtotals per period. Supersede-aware per period.
 */
export async function getSnapshotSeries(
  stockId: string,
  windowQuarters = 12,
  snapshotType: SnapshotType = "quarterly",
): Promise<SeriesPoint[]> {
  const byPeriod = await inForceByPeriod(stockId, snapshotType);
  if (byPeriod.size === 0) return [];

  // Newest-first by asOfDate, take the window, then re-fetch the denormalised
  // numbers for exactly those in-force ids.
  const refsNewestFirst = [...byPeriod.values()].sort(
    (a, b) =>
      b.asOfDate.getTime() - a.asOfDate.getTime() || b.periodKey.localeCompare(a.periodKey),
  );
  const windowRefs = refsNewestFirst.slice(0, Math.max(1, windowQuarters));
  const ids = windowRefs.map((r) => r.id);

  const rows = await prisma.scoreSnapshot.findMany({
    where: { id: { in: ids } },
    select: {
      periodKey: true,
      asOfDate: true,
      version: true,
      composite: true,
      labelBand: true,
      foundationSubtotal: true,
      momentumSubtotal: true,
      marketSubtotal: true,
      ownershipSubtotal: true,
    },
  });

  const points: SeriesPoint[] = rows.map((r) => ({
    periodKey: r.periodKey,
    asOfDate: r.asOfDate,
    version: r.version,
    composite: num(r.composite),
    labelBand: r.labelBand as string,
    foundationSubtotal: num(r.foundationSubtotal),
    momentumSubtotal: num(r.momentumSubtotal),
    marketSubtotal: num(r.marketSubtotal),
    ownershipSubtotal: num(r.ownershipSubtotal),
  }));

  // Oldest → newest for plotting.
  points.sort(
    (a, b) =>
      a.asOfDate.getTime() - b.asOfDate.getTime() || a.periodKey.localeCompare(b.periodKey),
  );
  return points;
}

/**
 * The windowed in-force snapshot REFS (id + period + asOfDate), OLDEST→NEWEST — the
 * SAME supersede-aware reduction + windowing getSnapshotSeries uses, but returning
 * the row IDs so a caller can load the full pillar graph (ownership flows, anatomy)
 * for exactly the in-force rows in the window. Point-in-time by construction.
 */
export async function getInForceSeriesRefs(
  stockId: string,
  windowQuarters = 12,
  snapshotType: SnapshotType = "quarterly",
): Promise<SnapshotRef[]> {
  const byPeriod = await inForceByPeriod(stockId, snapshotType);
  if (byPeriod.size === 0) return [];
  const newestFirst = [...byPeriod.values()].sort(
    (a, b) =>
      b.asOfDate.getTime() - a.asOfDate.getTime() || b.periodKey.localeCompare(a.periodKey),
  );
  return newestFirst.slice(0, Math.max(1, windowQuarters)).reverse(); // oldest → newest
}

/** Coverage descriptor (latest StockScoringState, newest-by-createdAt). */
export interface CoverageInfo {
  coverageState: CoverageState;
  coverageReason: string | null;
  lastScoredRunId: string | null;
  asOf: Date;
}

/**
 * Latest coverage state for a stock. StockScoringState is append-only — newest
 * createdAt wins. Returns null when no coverage row exists for the stock (the
 * caller surfaces coverageState: null rather than guessing).
 */
export async function resolveCoverage(stockId: string): Promise<CoverageInfo | null> {
  const row = await prisma.stockScoringState.findFirst({
    where: { stockId },
    orderBy: { createdAt: "desc" },
    select: {
      coverageState: true,
      coverageReason: true,
      lastScoredRunId: true,
      createdAt: true,
    },
  });
  if (!row) return null;
  return {
    coverageState: row.coverageState as CoverageState,
    coverageReason: row.coverageReason,
    lastScoredRunId: row.lastScoredRunId,
    asOf: row.createdAt,
  };
}

/**
 * In-force sibling snapshots for a peer group at one periodKey — MAX(version)
 * per stock. Used by peer-standing (rank/percentile/neighbours). Returns the
 * denormalised composite + pillar subtotals per sibling stock.
 */
export interface PeerSibling {
  stockId: string;
  symbol: string;
  composite: number;
  foundationSubtotal: number;
  momentumSubtotal: number;
  marketSubtotal: number;
  ownershipSubtotal: number;
}

/**
 * Per-METRIC peer member rawValues for a PG at one periodKey — the cross-section
 * behind each metric's Lens-2, for the metric modal's peer-field visual (§2.3). For
 * every scored F/M metric, returns the in-force (MAX-version) value held by each PG
 * member at this period. Two queries: the sibling head snapshots, then their scored
 * metric rawValues. Read-only; never fabricates a member that didn't score the metric.
 */
export async function getPeerMetricValues(
  peerGroupId: string,
  periodKey: string,
  snapshotType: SnapshotType = "quarterly",
): Promise<Map<string, { symbol: string; value: number }[]>> {
  const snaps = await prisma.scoreSnapshot.findMany({
    where: { peerGroupId, periodKey, snapshotType },
    select: { stockId: true, symbol: true, version: true, asOfDate: true, foundationPillarId: true, momentumPillarId: true },
  });
  // MAX(version) per stock (supersede-aware) → the head snapshot for each sibling.
  const byStock = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) {
    const cur = byStock.get(s.stockId);
    if (!cur || s.version > cur.version || (s.version === cur.version && s.asOfDate > cur.asOfDate)) byStock.set(s.stockId, s);
  }
  const heads = [...byStock.values()];
  const pillarToSymbol = new Map<string, string>();
  for (const h of heads) {
    if (h.foundationPillarId) pillarToSymbol.set(h.foundationPillarId, h.symbol);
    if (h.momentumPillarId) pillarToSymbol.set(h.momentumPillarId, h.symbol);
  }
  const pillarIds = [...pillarToSymbol.keys()];
  const out = new Map<string, { symbol: string; value: number }[]>();
  if (!pillarIds.length) return out;
  const rows = await prisma.metricScore.findMany({
    where: { pillarScoreId: { in: pillarIds }, scoreState: "scored" },
    select: { pillarScoreId: true, metricKey: true, rawValue: true },
  });
  for (const r of rows) {
    const symbol = pillarToSymbol.get(r.pillarScoreId);
    if (!symbol) continue;
    const arr = out.get(r.metricKey) ?? [];
    arr.push({ symbol, value: num(r.rawValue) });
    out.set(r.metricKey, arr);
  }
  return out;
}

export async function getPeerSiblings(
  peerGroupId: string,
  periodKey: string,
  snapshotType: SnapshotType = "quarterly",
): Promise<PeerSibling[]> {
  const rows = await prisma.scoreSnapshot.findMany({
    where: { peerGroupId, periodKey, snapshotType },
    select: {
      stockId: true,
      symbol: true,
      version: true,
      asOfDate: true,
      composite: true,
      foundationSubtotal: true,
      momentumSubtotal: true,
      marketSubtotal: true,
      ownershipSubtotal: true,
    },
  });

  // MAX(version) per stock (supersede-aware) within this PG+period.
  const byStock = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const cur = byStock.get(r.stockId);
    if (!cur || r.version > cur.version || (r.version === cur.version && r.asOfDate > cur.asOfDate)) {
      byStock.set(r.stockId, r);
    }
  }

  return [...byStock.values()].map((r) => ({
    stockId: r.stockId,
    symbol: r.symbol,
    composite: num(r.composite),
    foundationSubtotal: num(r.foundationSubtotal),
    momentumSubtotal: num(r.momentumSubtotal),
    marketSubtotal: num(r.marketSubtotal),
    ownershipSubtotal: num(r.ownershipSubtotal),
  }));
}
