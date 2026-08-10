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
// ⚠ COVERAGE NO LONGER LIVES HERE. `resolveCoverage` + `CoverageInfo` read
// StockScoringState / score_stock_states, a table with 0 rows and no writer anywhere,
// so they returned `null` identically for a fully-scored stock and a never-scored one.
// The table was dropped on 2026-08-09 and both were removed with it. Coverage is
// DERIVED — src/relational/coverage.ts `deriveCoverage`, off the in-force snapshot ref,
// the persisted declined-check set, and peer-group membership.
//
// These functions are the SINGLE place the newest-version rule is enforced.
// The per-stock candidate set is tiny (a handful of periods × versions), so the
// MAX(version) reduction is done in-memory for provable correctness rather than via
// a window-function query.

import { prisma } from "../../db/prisma.js";
import { memoRead } from "../../db/read-memo.js";

export type SnapshotType = "quarterly" | "live";

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
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★ ONE STOCK'S SNAPSHOT ROWS — READ ONCE PER REQUEST, BY THREE CALLERS WHO EACH WANTED A SLICE.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── THE DEFECT, MEASURED ────────────────────────────────────────────────────────────────────────
 * Instrumented at the pg driver, one health read issued `SELECT … FROM score_snapshots WHERE
 * stock_id = $1 AND snapshot_type = $2` THREE TIMES, with identical bound values, differing only in
 * the column list:
 *
 *     inForceByPeriod            7 columns   id · stockId · symbol · snapshotType · periodKey · version · asOfDate
 *     getDailySnapshotSeries    10 columns   the plotted numbers + labelBand
 *     resolveFindingLifecycles  13 columns   the numbers + the four applied weights
 *
 * Three round-trips (~70 ms each on a remote database) for one row set that is at most a hundred rows
 * wide. They were not EXACT duplicates, which is precisely why no cache keyed on the emitted SQL
 * would have collapsed them — the fix has to be at the question, not at the statement.
 *
 * ── THE UNION IS THE POINT, AND IT IS CHEAP ─────────────────────────────────────────────────────
 * This selects what all three want. The extra columns each caller does not read cost bytes on a
 * result set bounded by a stock's own scoring history (54 rows on the median stock, 13 periods × a
 * handful of versions); the round-trips they replace cost 140 ms. Callers narrow locally, exactly as
 * before — no caller's behaviour changes, because none of them can see a column it does not read.
 *
 * ── ⚠ THE RESULT IS SHARED AND IS READ-ONLY BY CONTRACT ─────────────────────────────────────────
 * `memoRead` hands the SAME array to the second and third callers. What each does with it today:
 *
 *     inForceByPeriod            iterates, builds a fresh Map
 *     getDailySnapshotSeries     iterates into a fresh Map, then maps + sorts THAT
 *     resolveFindingLifecycles   maps into fresh SnapRows, then sorts THOSE
 *
 * Not one mutates the array or a row in place. A future caller that needs to must copy first; see
 * db/read-memo.ts's header for why the contract exists and what breaks without it.
 *
 * ⚠ OUTSIDE A MEMO SCOPE THIS IS AN ORDINARY QUERY. `resolveFindingLifecycles` is called standalone
 * from scripts and from the lifecycle surfaces; it must not require a ceremony to work, and it does
 * not — `memoRead` passes straight through when no scope is open.
 */
export interface StockSnapshotRow {
  id: string;
  stockId: string;
  symbol: string;
  snapshotType: string;
  periodKey: string;
  version: number;
  asOfDate: Date;
  composite: unknown;
  labelBand: string;
  foundationSubtotal: unknown;
  momentumSubtotal: unknown;
  marketSubtotal: unknown;
  ownershipSubtotal: unknown;
  wFoundation: unknown;
  wMomentum: unknown;
  wMarket: unknown;
  wOwnership: unknown;
}

export function snapshotRowsForStock(
  stockId: string,
  snapshotType: SnapshotType = "quarterly",
): Promise<StockSnapshotRow[]> {
  return memoRead(`snapshotRowsForStock:${stockId}:${snapshotType}`, () =>
    prisma.scoreSnapshot.findMany({
      where: { stockId, snapshotType },
      select: {
        id: true,
        stockId: true,
        symbol: true,
        snapshotType: true,
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
  ) as Promise<StockSnapshotRow[]>;
}

/**
 * Reduce a stock's snapshots to the IN-FORCE row per periodKey:
 * MAX(version) within each (snapshotType, periodKey) group. Tie-break on the
 * same version (should never happen given the unique index) by latest asOfDate.
 * Returns a Map<periodKey, SnapshotRef>.
 *
 * ── ★ EXPORTED SO ONE READ CAN SERVE THREE ANSWERS ───────────────────────────────────────────────
 * `getLatestSnapshot`, `getSnapshotSeries` and `getInForceSeriesRefs` each called this privately, so
 * a single health view issued the IDENTICAL query three times — three sequential round-trips for one
 * unchanging fact. A caller that needs more than one of those answers now resolves the map ONCE and
 * derives all three from it with the pure helpers below (`latestRefFrom` / `seriesRefsFrom`), which
 * also makes them parallelisable: they no longer each own a hidden await.
 *
 * The three original functions are unchanged and still resolve their own map, so every other
 * consumer is untouched — this is a seam added beside them, not a migration of them.
 */
export async function inForceByPeriod(
  stockId: string,
  snapshotType: SnapshotType = "quarterly",
): Promise<Map<string, SnapshotRef>> {
  const rows = await snapshotRowsForStock(stockId, snapshotType);

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
  return latestRefFrom(await inForceByPeriod(stockId, snapshotType));
}

/** ★ The same reduction as `getLatestSnapshotRef`, PURE — over a map the caller already holds. */
export function latestRefFrom(byPeriod: Map<string, SnapshotRef>): SnapshotRef | null {
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
  return loadSnapshotById(ref.id);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★ THE FORKED SNAPSHOT LOAD — two shapes, and the type system decides which mappers may run.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── ⚠ THE RELATION LOADS ARE NOT CONCURRENT. MEASURED. ──────────────────────────────────────────
 * This note used to claim they are: "Prisma issues these relation loads CONCURRENTLY off one
 * findUnique … so they cost roughly ONE round-trip layer, not one per relation." Timed at the pg
 * driver rather than at the Prisma call, that is false. Prisma resolves a nested include one LEVEL at
 * a time and must await each level before it has the foreign keys for the next, so the FULL include
 * is a three-level walk:
 *
 *   level 1   score_pillars ×4 (one statement each, `id = $1`) · score_band_mappings · score_red_flags · score_patterns
 *   level 2   score_metrics ×2 · score_market_subs · score_ownership
 *   level 3   score_metric_bar_sets ×2 · score_peer_stats ×2 · score_ownership_flows
 *
 * Sixteen statements, serialised twice over — by level, and by the 5-connection pool they saturate.
 * Measured A/B, alternating, same link: full include **328 ms** median vs a `pillarState`-only
 * include **209 ms**.
 *
 * ── ★ WHAT A PILLARS-OMITTED CALLER ACTUALLY READS OFF ALL THAT: `pillarState`. FOUR STRINGS. ────
 * Nothing else. The metric graph, the market sub-scores and the ownership score exist on the payload
 * only inside `pillars[]`, which that caller asked not to be built.
 *
 * ── ★ THE FORK IS HONEST, NOT CHEAP ─────────────────────────────────────────────────────────────
 * The cheap version — load lean, then hand back `metricScores: []` / `ownershipScore: null` so the
 * type stays one shape — SUBSTITUTES A FABRICATED EMPTY FOR "NOT FETCHED". This read layer's rule is
 * that a field with no backing data is `null` with the key present; `[]` is a different claim ("this
 * pillar scored no metrics"), and a future mapper reading it outside the projection branch would
 * render that claim with nothing to warn it.
 *
 * So there are two RETURN TYPES, discriminated by a literal `pillarDetail`. On the lean shape the
 * metric graph is not empty — it is ABSENT, and `snap.foundationPillar.metricScores` is a compile
 * error until the caller has narrowed on `snap.pillarDetail`. That is the guarantee the empty-array
 * version could not give: it is impossible to read a metric off a lean load.
 *
 * ⚠ THE DISCRIMINANT IS SET BY THIS FUNCTION FROM ITS OWN ARGUMENT, in one place, so the flag and the
 *   shape cannot disagree. A caller never constructs it.
 */
const PILLAR_DETAIL_INCLUDE = {
  bandMappingVersion: true,
  foundationPillar: {
    include: { metricScores: { include: { metricBarSet: true, peerStats: true } } },
  },
  momentumPillar: {
    include: { metricScores: { include: { metricBarSet: true, peerStats: true } } },
  },
  marketPillar: { include: { marketSubScores: true } },
  ownershipPillar: { include: { ownershipScore: { include: { flowCategories: true } } } },
  patterns: true,
} as const;

/**
 * ★ THE LEAN INCLUDE — the four pillar ROWS (for `pillarState`), the band mapping, and the findings.
 *
 * ⚠ `patterns` IS NOT PILLAR DETAIL and stays on both shapes. It is the findings block, which every
 *   projection serves; dropping it here would have been the actual behaviour change this fork exists
 *   to avoid. (`redFlags` sat beside it under the same rule until 2026-08-11, when score_red_flags was
 *   dropped — the score channel has no red flags to include on either shape.)
 */
const PILLAR_LEAN_INCLUDE = {
  bandMappingVersion: true,
  foundationPillar: true,
  momentumPillar: true,
  marketPillar: true,
  ownershipPillar: true,
  patterns: true,
} as const;

/** The full graph — pillars → metrics + bars + peer stats, market subs, ownership + flows. */
export function loadSnapshotById(id: string) {
  return prisma.scoreSnapshot.findUnique({ where: { id }, include: PILLAR_DETAIL_INCLUDE });
}

/** The same row with the pillar ROWS only — no metric graph, no subs, no ownership score. */
export function loadSnapshotLeanById(id: string) {
  return prisma.scoreSnapshot.findUnique({ where: { id }, include: PILLAR_LEAN_INCLUDE });
}

export type FullLoadedSnapshot = NonNullable<Awaited<ReturnType<typeof loadSnapshotById>>>;
export type LeanLoadedSnapshot = NonNullable<Awaited<ReturnType<typeof loadSnapshotLeanById>>>;

/**
 * The two shapes as one discriminated union. `pillarDetail: true` is the ONLY thing that unlocks the
 * metric graph, and it is set from the argument below rather than by any caller.
 */
export type ProjectedSnapshot =
  | (FullLoadedSnapshot & { pillarDetail: true })
  | (LeanLoadedSnapshot & { pillarDetail: false });

/** Load the snapshot at the detail the projection actually needs. Null when the id resolves to no row. */
export async function loadSnapshotProjected(
  id: string,
  pillarDetail: boolean,
): Promise<ProjectedSnapshot | null> {
  if (pillarDetail) {
    const row = await loadSnapshotById(id);
    return row ? { ...row, pillarDetail: true } : null;
  }
  const row = await loadSnapshotLeanById(id);
  return row ? { ...row, pillarDetail: false } : null;
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
  return seriesFrom(await inForceByPeriod(stockId, snapshotType), windowQuarters);
}

/** ★ `getSnapshotSeries` over a map the caller already holds — one query instead of two. */
export async function seriesFrom(
  byPeriod: Map<string, SnapshotRef>,
  windowQuarters = 12,
): Promise<SeriesPoint[]> {
  if (byPeriod.size === 0) return [];

  // Newest-first by asOfDate, take the window, then re-fetch the denormalised
  // numbers for exactly those in-force ids.
  const ids = seriesRefsFrom(byPeriod, windowQuarters).map((r) => r.id);

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
 * The DAILY trajectory series: one point per CALENDAR DAY (asOfDate) over a trailing
 * window of `windowDays`, OLDEST→NEWEST. Unlike getSnapshotSeries (which collapses the
 * whole supersede chain to ONE point per quarter), this surfaces the intra-quarter
 * version history — the daily-changing Market/Ownership recomputes that are physically
 * stored as successive versions of the same quarterly-keyed snapshot.
 *
 * REDUCTION: many versions can share one asOfDate (a backfill or several same-day
 * event rescores). For each asOfDate we keep the MAX(version) row — the in-force value
 * for that day. So the result is exactly one honest point per day a rescore landed;
 * non-trading days simply have no point (natural gaps, never fabricated).
 *
 * WINDOW: bounded by [latest asOfDate − windowDays, latest asOfDate]. If retention holds
 * fewer daily points than the window, we return what exists — honestly partial, never padded.
 * Foundation/Momentum subtotals carry forward unchanged across these daily points (their
 * PillarScore rows are input-fingerprint deduped), so they render FLAT between quarters —
 * which is correct, not interpolated.
 */
export async function getDailySnapshotSeries(
  stockId: string,
  windowDays = 60,
  snapshotType: SnapshotType = "quarterly",
): Promise<SeriesPoint[]> {
  // ★ THE SHARED READ — same stock, same type, the same rows `inForceByPeriod` and the lifecycle
  //   walk want. This used to be its own round-trip for a narrower projection of one row set.
  const rows = await snapshotRowsForStock(stockId, snapshotType);
  if (rows.length === 0) return [];

  // MAX(version) per asOfDate (one in-force point per calendar day).
  const byDay = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = r.asOfDate.toISOString().slice(0, 10);
    const cur = byDay.get(key);
    if (!cur || r.version > cur.version) byDay.set(key, r);
  }

  // Trailing window: windowDays back from the latest asOfDate present.
  const latestMs = Math.max(...[...byDay.values()].map((r) => r.asOfDate.getTime()));
  const cutoffMs = latestMs - windowDays * 24 * 60 * 60 * 1000;

  const points: SeriesPoint[] = [...byDay.values()]
    .filter((r) => r.asOfDate.getTime() >= cutoffMs)
    .map((r) => ({
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

  points.sort((a, b) => a.asOfDate.getTime() - b.asOfDate.getTime());
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
  return seriesRefsFrom(await inForceByPeriod(stockId, snapshotType), windowQuarters).reverse();
}

/**
 * ★ The window's in-force refs, PURE — NEWEST → OLDEST.
 *
 * ⚠ NOTE THE ORDER, AND THAT IT IS THE OPPOSITE OF `getInForceSeriesRefs`'s. This returns the slice
 * in the order the reduction produces it; the exported wrapper reverses to oldest→newest because
 * that is the order its callers plot in. Both orders are correct for their caller and neither is a
 * default — a helper that guessed would silently reverse someone's series.
 */
export function seriesRefsFrom(
  byPeriod: Map<string, SnapshotRef>,
  windowQuarters = 12,
): SnapshotRef[] {
  if (byPeriod.size === 0) return [];
  const newestFirst = [...byPeriod.values()].sort(
    (a, b) =>
      b.asOfDate.getTime() - a.asOfDate.getTime() || b.periodKey.localeCompare(a.periodKey),
  );
  return newestFirst.slice(0, Math.max(1, windowQuarters));
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
