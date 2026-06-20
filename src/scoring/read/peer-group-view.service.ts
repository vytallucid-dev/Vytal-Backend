// File: src/scoring/read/peer-group-view.service.ts
//
// THE peer-group aggregate ASSEMBLERS. Two entry points over ONE primitive
// (scope-aggregate.computeScopeAggregate):
//   • buildPeerGroupList()            → lightweight card per pond (index page)
//   • buildPeerGroupHealthView(pgId)  → the full pond (Health tab)
//
// Reuse, not reinvention: the in-force cross-section is resolved with the SAME
// supersede-aware MAX(version) rule the shared resolver enforces; the trajectory
// marker + movers reuse getSnapshotSeries; the peer μ/σ/N comes from the persisted
// PeerStatsSnapshot with the SAME usable-guard as the stock view. No scoring math is
// recomputed here — this is a pure read over already-committed rows.

import { prisma } from "../../db/prisma.js";
import { getSnapshotSeries } from "./scoring-read.service.js";
import {
  computeScopeAggregate,
  describeScope,
  type ScopeMember,
} from "./scope-aggregate.js";
import type {
  PillarKey,
  LabelBand,
  DivergenceFlag,
  TrajectoryMarker,
  MetricBand,
} from "./health-view.types.js";
import type {
  PeerGroupListItem,
  PeerGroupHealthView,
  PeerGroupMemberView,
  PathologyCensusItem,
  PathologyReach,
  PeerMetricDistribution,
  PeerGroupMover,
  BandDistribution,
} from "./peer-group-view.types.js";

// ── helpers (mirrors health-view conventions) ───────────────────────────────────
const num = (d: unknown): number =>
  d == null ? 0 : typeof (d as { toNumber?: () => number }).toNumber === "function"
    ? (d as { toNumber: () => number }).toNumber()
    : Number(d);
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const round2 = (x: number): number => Math.round(x * 100) / 100;

const DIVERGENCE_NOTABLE = 15;
const DIVERGENCE_WIDE = 25;
const TRAJECTORY_EPS = 1.0;
const MOVER_CAP = 10; // top-N each side; honestly capped (ponds are ≤10 today)

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const severityRank = (s: string | null): number =>
  s == null ? 99 : SEVERITY_ORDER[s.toLowerCase()] ?? 50;
const worseSeverity = (a: string | null, b: string | null): string | null =>
  severityRank(a) <= severityRank(b) ? a : b;

function divergenceOf(
  scoredSubtotals: { pillar: PillarKey; subtotal: number }[],
): { flag: DivergenceFlag; gap: number } {
  if (scoredSubtotals.length < 2) return { flag: "none", gap: 0 };
  const sorted = [...scoredSubtotals].sort((a, b) => b.subtotal - a.subtotal);
  const gap = round2(sorted[0].subtotal - sorted[sorted.length - 1].subtotal);
  const flag: DivergenceFlag = gap >= DIVERGENCE_WIDE ? "wide" : gap >= DIVERGENCE_NOTABLE ? "notable" : "none";
  return { flag, gap };
}

function reachOf(n: number, m: number): PathologyReach {
  if (n <= 1) return "isolated";
  if (m > 0 && n / m >= 0.5) return "widespread";
  return "cluster";
}

// A lean snapshot row used for the in-force reduction.
interface LeanSnap {
  id: string;
  stockId: string;
  symbol: string;
  periodKey: string;
  version: number;
  asOfDate: Date;
}

/** Reduce a pond's raw snapshot rows to the current cross-section:
 *  per (stock, period) keep MAX(version); per stock keep the latest period; then
 *  the pond's current period = the latest asOfDate seen. Members whose latest period
 *  is older are returned separately (lagging) — never folded into the cross-section. */
function resolveCrossSection(rows: LeanSnap[]): {
  periodKey: string;
  asOfDate: Date;
  current: LeanSnap[]; // in-force snapshot per member AT the current period
  lagging: { symbol: string; latestPeriod: string }[];
} | null {
  if (rows.length === 0) return null;

  const inForce = new Map<string, LeanSnap>(); // key stockId|period
  for (const r of rows) {
    const k = `${r.stockId}|${r.periodKey}`;
    const cur = inForce.get(k);
    if (!cur || r.version > cur.version || (r.version === cur.version && r.asOfDate > cur.asOfDate)) {
      inForce.set(k, r);
    }
  }
  const latestPerStock = new Map<string, LeanSnap>();
  for (const r of inForce.values()) {
    const cur = latestPerStock.get(r.stockId);
    if (
      !cur ||
      r.asOfDate > cur.asOfDate ||
      (r.asOfDate.getTime() === cur.asOfDate.getTime() && r.periodKey > cur.periodKey)
    ) {
      latestPerStock.set(r.stockId, r);
    }
  }
  const all = [...latestPerStock.values()];
  const maxAsOf = all.reduce((a, b) => (b.asOfDate > a.asOfDate ? b : a)).asOfDate;
  const periodKey = all.filter((r) => r.asOfDate.getTime() === maxAsOf.getTime())[0].periodKey;
  const current = all.filter((r) => r.periodKey === periodKey);
  const lagging = all
    .filter((r) => r.periodKey !== periodKey)
    .map((r) => ({ symbol: r.symbol, latestPeriod: r.periodKey }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { periodKey, asOfDate: maxAsOf, current, lagging };
}

const toBandDistribution = (b: Record<LabelBand, number>): BandDistribution => b;

// ── LIST ────────────────────────────────────────────────────────────────────────

/**
 * One lightweight aggregate card per peer group. 3 queries total regardless of pond
 * count: peer-groups+sector, all quarterly snapshots (lean), red-flag presence for
 * the resolved cross-section. Unscored ponds return `scored:false` with null stats.
 */
export async function buildPeerGroupList(): Promise<PeerGroupListItem[]> {
  const [pgs, snaps] = await Promise.all([
    prisma.peerGroup.findMany({
      orderBy: [{ sector: { displayName: "asc" } }, { displayName: "asc" }],
      select: {
        id: true,
        name: true,
        displayName: true,
        stockCount: true,
        sector: { select: { name: true, displayName: true } },
      },
    }),
    prisma.scoreSnapshot.findMany({
      where: { snapshotType: "quarterly" },
      select: {
        id: true,
        peerGroupId: true,
        stockId: true,
        symbol: true,
        periodKey: true,
        version: true,
        asOfDate: true,
        composite: true,
        labelBand: true,
        foundationSubtotal: true,
        momentumSubtotal: true,
        marketSubtotal: true,
        ownershipSubtotal: true,
      },
    }),
  ]);

  // Bucket snapshots by pond.
  const byPg = new Map<string, typeof snaps>();
  for (const s of snaps) {
    const arr = byPg.get(s.peerGroupId) ?? [];
    arr.push(s);
    byPg.set(s.peerGroupId, arr);
  }

  // Resolve every pond's cross-section, collecting the in-force snapshot IDs so we
  // can ask for red-flag presence in ONE grouped query.
  const resolvedByPg = new Map<
    string,
    { periodKey: string; asOfDate: Date; rows: (typeof snaps) }
  >();
  const allCrossIds: string[] = [];
  for (const pg of pgs) {
    const rows = byPg.get(pg.id) ?? [];
    const xs = resolveCrossSection(rows as LeanSnap[]);
    if (!xs) continue;
    const currentIds = new Set(xs.current.map((r) => r.id));
    const currentRows = rows.filter((r) => currentIds.has(r.id));
    resolvedByPg.set(pg.id, { periodKey: xs.periodKey, asOfDate: xs.asOfDate, rows: currentRows });
    allCrossIds.push(...currentIds);
  }

  const flagRows = allCrossIds.length
    ? await prisma.redFlag.groupBy({
        by: ["snapshotId"],
        where: { snapshotId: { in: allCrossIds } },
        _count: { _all: true },
      })
    : [];
  const firesFlag = new Set(flagRows.filter((r) => r._count._all > 0).map((r) => r.snapshotId));

  return pgs.map((pg): PeerGroupListItem => {
    const sector = pg.sector ? { key: pg.sector.name, displayName: pg.sector.displayName } : null;
    const resolved = resolvedByPg.get(pg.id);
    if (!resolved) {
      return {
        id: pg.id,
        name: pg.name,
        displayName: pg.displayName,
        sector,
        memberCount: pg.stockCount,
        scored: false,
        periodKey: null,
        asOfDate: null,
        scoredCount: 0,
        medianComposite: null,
        meanComposite: null,
        bandDistribution: null,
        dispersion: null,
        range: null,
        descriptor: null,
        redFlagMemberCount: 0,
      };
    }
    const members: ScopeMember[] = resolved.rows.map((r) => ({
      stockId: r.stockId,
      symbol: r.symbol,
      composite: num(r.composite),
      labelBand: r.labelBand as LabelBand,
      pillars: {
        foundation: num(r.foundationSubtotal),
        momentum: num(r.momentumSubtotal),
        market: num(r.marketSubtotal),
        ownership: num(r.ownershipSubtotal),
      },
      firesAnyRedFlag: firesFlag.has(r.id),
      weight: 1,
    }));
    const agg = computeScopeAggregate(members);
    return {
      id: pg.id,
      name: pg.name,
      displayName: pg.displayName,
      sector,
      memberCount: pg.stockCount,
      scored: true,
      periodKey: resolved.periodKey,
      asOfDate: ymd(resolved.asOfDate),
      scoredCount: agg.scoredCount,
      medianComposite: agg.medianComposite,
      meanComposite: agg.meanComposite,
      bandDistribution: toBandDistribution(agg.bandDistribution),
      dispersion: { stdDev: agg.dispersion.stdDev, iqr: agg.dispersion.iqr },
      range: agg.min && agg.max ? { min: agg.min.composite, max: agg.max.composite } : null,
      descriptor: describeScope(members, agg),
      redFlagMemberCount: agg.redFlagMemberCount,
    };
  });
}

// ── DETAIL ──────────────────────────────────────────────────────────────────────

type FullSnap = Awaited<ReturnType<typeof loadFullCrossSection>>[number];

function loadFullCrossSection(ids: string[]) {
  return prisma.scoreSnapshot.findMany({
    where: { id: { in: ids } },
    include: {
      foundationPillar: { include: { metricScores: { include: { metricBarSet: true } } } },
      momentumPillar: { include: { metricScores: { include: { metricBarSet: true } } } },
      marketPillar: { select: { pillarState: true } },
      ownershipPillar: { select: { pillarState: true } },
      redFlags: true,
      patterns: true,
    },
  });
}

/**
 * The full aggregate for one pond. Returns null only when the peer group id is
 * unknown (controller → 404). An existing-but-unscored pond returns a `scored:false`
 * shell (identity populated, every snapshot section null/empty).
 */
export async function buildPeerGroupHealthView(
  pgId: string,
): Promise<PeerGroupHealthView | null> {
  const pg = await prisma.peerGroup.findUnique({
    where: { id: pgId },
    select: {
      id: true,
      name: true,
      displayName: true,
      stockCount: true,
      sector: { select: { name: true, displayName: true, sectorClass: true } },
    },
  });
  if (!pg) return null;

  const sector = pg.sector ? { key: pg.sector.name, displayName: pg.sector.displayName } : null;
  const baseIdentity = {
    id: pg.id,
    name: pg.name,
    displayName: pg.displayName,
    sector,
    sectorClass: pg.sector?.sectorClass ?? null,
    memberCount: pg.stockCount,
  };

  const leanRows = await prisma.scoreSnapshot.findMany({
    where: { peerGroupId: pgId, snapshotType: "quarterly" },
    select: { id: true, stockId: true, symbol: true, periodKey: true, version: true, asOfDate: true },
  });
  const xs = resolveCrossSection(leanRows);

  // ── unscored pond shell ──
  if (!xs) {
    return {
      scored: false,
      identity: { ...baseIdentity, industryPath: null, periodKey: null, asOfDate: null },
      aggregate: null,
      members: [],
      notAtCurrentPeriod: [],
      pathology: [],
      metricDistributions: [],
      movers: { risers: [], slippers: [] },
    };
  }

  const crossIds = xs.current.map((r) => r.id);
  const stockIds = xs.current.map((r) => r.stockId);

  const [fullSnaps, stocks, peerStatsRows] = await Promise.all([
    loadFullCrossSection(crossIds),
    prisma.stock.findMany({
      where: { id: { in: stockIds } },
      select: { id: true, name: true, industryType: true },
    }),
    prisma.peerStatsSnapshot.findMany({
      where: { peerGroupId: pgId, asOfDate: xs.asOfDate },
      select: { metricKey: true, mean: true, stdDev: true, sampleN: true },
    }),
  ]);

  const nameById = new Map(stocks.map((s) => [s.id, s.name]));
  const peerByMetric = new Map(
    peerStatsRows.map((r) => [r.metricKey, { mean: num(r.mean), stdDev: num(r.stdDev), sampleN: r.sampleN }]),
  );

  // industryPath — uniform across a pond normally; "mixed" if it spans both.
  const industrySet = new Set(fullSnaps.map((s) => (s.industryPath === "banking" ? "banking" : "non_financial")));
  const industryPath: PeerGroupHealthView["identity"]["industryPath"] =
    industrySet.size === 1 ? ([...industrySet][0] as "banking" | "non_financial") : "mixed";

  // ── member views + ScopeMembers + pathology accumulation ──
  const scopeMembers: ScopeMember[] = [];
  const memberViews: PeerGroupMemberView[] = [];

  // pathology census accumulators
  type Acc = { severity: string | null; members: { symbol: string; sev: string | null }[] };
  const flagAcc = new Map<string, Acc>();
  const patternAcc = new Map<string, Acc>();

  // trajectory series per member (also powers movers) — reuse the shared resolver.
  const series2 = await Promise.all(
    fullSnaps.map((s) => getSnapshotSeries(s.stockId, 2).then((pts) => [s.stockId, pts] as const)),
  );
  const seriesByStock = new Map(series2);

  for (const s of fullSnaps) {
    const pillars: Record<PillarKey, number> = {
      foundation: num(s.foundationSubtotal),
      momentum: num(s.momentumSubtotal),
      market: num(s.marketSubtotal),
      ownership: num(s.ownershipSubtotal),
    };
    const scoredSubs: { pillar: PillarKey; subtotal: number }[] = [];
    if (s.foundationPillar.pillarState === "scored") scoredSubs.push({ pillar: "foundation", subtotal: pillars.foundation });
    if (s.momentumPillar.pillarState === "scored") scoredSubs.push({ pillar: "momentum", subtotal: pillars.momentum });
    if (s.marketPillar.pillarState === "scored") scoredSubs.push({ pillar: "market", subtotal: pillars.market });
    if (s.ownershipPillar.pillarState === "scored") scoredSubs.push({ pillar: "ownership", subtotal: pillars.ownership });

    const firedFlags = [...s.redFlags]
      .map((rf) => ({ flagKey: rf.flagKey, severity: rf.severity, tier: rf.tier as "auto" | "review" }))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    const firedPatterns = [...s.patterns]
      .map((p) => ({ patternKey: p.patternKey, direction: p.direction, severity: p.severity }))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

    // trajectory marker from the member's last-2 in-force composites
    const pts = seriesByStock.get(s.stockId) ?? [];
    let trajectoryMarker: TrajectoryMarker | null = null;
    let trajectoryDelta: number | null = null;
    if (pts.length >= 2) {
      const d = round2(pts[pts.length - 1].composite - pts[pts.length - 2].composite);
      trajectoryDelta = d;
      trajectoryMarker = d > TRAJECTORY_EPS ? "improving" : d < -TRAJECTORY_EPS ? "deteriorating" : "stable";
    }

    memberViews.push({
      symbol: s.symbol,
      name: nameById.get(s.stockId) ?? s.symbol,
      composite: round2(num(s.composite)),
      labelBand: s.labelBand as LabelBand,
      pillars,
      trajectoryMarker,
      trajectoryDelta,
      divergence: divergenceOf(scoredSubs),
      firedFlags,
      firedPatterns,
    });

    scopeMembers.push({
      stockId: s.stockId,
      symbol: s.symbol,
      composite: num(s.composite),
      labelBand: s.labelBand as LabelBand,
      pillars,
      firesAnyRedFlag: s.redFlags.length > 0,
      weight: 1,
    });

    // accumulate pathology
    for (const rf of s.redFlags) {
      const acc = flagAcc.get(rf.flagKey) ?? { severity: null, members: [] };
      acc.severity = worseSeverity(acc.severity, rf.severity);
      acc.members.push({ symbol: s.symbol, sev: rf.severity });
      flagAcc.set(rf.flagKey, acc);
    }
    for (const p of s.patterns) {
      const acc = patternAcc.get(p.patternKey) ?? { severity: null, members: [] };
      acc.severity = worseSeverity(acc.severity, p.severity);
      acc.members.push({ symbol: s.symbol, sev: p.severity });
      patternAcc.set(p.patternKey, acc);
    }
  }

  memberViews.sort((a, b) => b.composite - a.composite);

  const agg = computeScopeAggregate(scopeMembers);
  const M = scopeMembers.length;

  // ── pathology census ──
  const buildCensus = (acc: Map<string, Acc>, kind: "red_flag" | "pattern"): PathologyCensusItem[] =>
    [...acc.entries()]
      .map(([key, v]): PathologyCensusItem => {
        const members = v.members
          .sort((a, b) => severityRank(a.sev) - severityRank(b.sev) || a.symbol.localeCompare(b.symbol))
          .map((m) => m.symbol);
        return {
          kind,
          key,
          severity: v.severity,
          memberCount: members.length,
          outOf: M,
          members,
          reach: reachOf(members.length, M),
        };
      })
      .sort(
        (a, b) =>
          severityRank(a.severity) - severityRank(b.severity) ||
          b.memberCount - a.memberCount ||
          a.key.localeCompare(b.key),
      );
  const pathology = [...buildCensus(flagAcc, "red_flag"), ...buildCensus(patternAcc, "pattern")];

  // ── metric distributions ──
  const metricDistributions = buildMetricDistributions(fullSnaps, peerByMetric);

  // ── movers (risers/slippers) where ≥2 periods exist ──
  const moverRows: PeerGroupMover[] = [];
  for (const s of fullSnaps) {
    const pts = seriesByStock.get(s.stockId) ?? [];
    if (pts.length < 2) continue;
    const prior = pts[pts.length - 2];
    const last = pts[pts.length - 1];
    const delta = round2(last.composite - prior.composite);
    if (delta === 0) continue;
    moverRows.push({
      symbol: s.symbol,
      composite: round2(last.composite),
      priorComposite: round2(prior.composite),
      delta,
      fromPeriod: prior.periodKey,
      toPeriod: last.periodKey,
    });
  }
  const risers = moverRows.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, MOVER_CAP);
  const slippers = moverRows.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, MOVER_CAP);

  // ── pond drift: the SAME aggregate one period back ──────────────────────────
  // Reuse each current member's prior in-force snapshot (series[len-2], supersede-
  // aware, point-in-time). The pond's prior period = the immediate-prior period
  // (latest periodKey among those prior points); members whose prior in-force
  // snapshot is older than that (a filing gap) are excluded — never carried forward.
  let priorMedianComposite: number | null = null;
  let medianDrift: number | null = null;
  let priorPeriodKey: string | null = null;
  const priorPoints = fullSnaps
    .map((s) => {
      const pts = seriesByStock.get(s.stockId) ?? [];
      return pts.length >= 2 ? { stockId: s.stockId, symbol: s.symbol, p: pts[pts.length - 2] } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (priorPoints.length > 0) {
    priorPeriodKey = priorPoints.map((x) => x.p.periodKey).reduce((a, b) => (b > a ? b : a));
    const priorMembers: ScopeMember[] = priorPoints
      .filter((x) => x.p.periodKey === priorPeriodKey)
      .map((x) => ({
        stockId: x.stockId,
        symbol: x.symbol,
        composite: x.p.composite,
        labelBand: x.p.labelBand as LabelBand,
        pillars: {
          foundation: x.p.foundationSubtotal,
          momentum: x.p.momentumSubtotal,
          market: x.p.marketSubtotal,
          ownership: x.p.ownershipSubtotal,
        },
        firesAnyRedFlag: false, // not used for the median; drift only needs composites
        weight: 1,
      }));
    const priorAgg = computeScopeAggregate(priorMembers);
    priorMedianComposite = priorAgg.medianComposite;
    medianDrift = round2(agg.medianComposite - priorAgg.medianComposite);
  }

  return {
    scored: true,
    identity: { ...baseIdentity, industryPath, periodKey: xs.periodKey, asOfDate: ymd(xs.asOfDate) },
    aggregate: {
      scoredCount: agg.scoredCount,
      medianComposite: agg.medianComposite,
      meanComposite: agg.meanComposite,
      priorMedianComposite,
      medianDrift,
      priorPeriodKey,
      dispersion: agg.dispersion,
      range: agg.min && agg.max ? { min: agg.min, max: agg.max } : null,
      composites: agg.composites,
      bandDistribution: toBandDistribution(agg.bandDistribution),
      pillarMedians: agg.pillarMedians,
      redFlagMemberCount: agg.redFlagMemberCount,
      descriptor: describeScope(scopeMembers, agg) ?? "",
    },
    members: memberViews,
    notAtCurrentPeriod: xs.lagging,
    pathology,
    metricDistributions,
    movers: { risers, slippers },
  };
}

/** Group the foundation+momentum metric scores across all members by metricKey,
 *  attaching the data-derived bars (from any member's MetricBarSet) and the
 *  persisted peer μ/σ/N with the usable-guard. */
function buildMetricDistributions(
  fullSnaps: FullSnap[],
  peerByMetric: Map<string, { mean: number; stdDev: number; sampleN: number }>,
): PeerMetricDistribution[] {
  type Bucket = {
    pillar: "foundation" | "momentum";
    direction: string | null;
    bars: PeerMetricDistribution["bars"];
    members: { symbol: string; rawValue: number; l1Band: MetricBand | null; scoreState: string }[];
  };
  const buckets = new Map<string, Bucket>();

  const ingest = (
    symbol: string,
    pillar: "foundation" | "momentum",
    scores: FullSnap["foundationPillar"]["metricScores"],
  ) => {
    for (const ms of scores) {
      const b = buckets.get(ms.metricKey) ?? {
        pillar,
        direction: ms.metricBarSet?.direction ?? null,
        bars: ms.metricBarSet
          ? {
              excellent: num(ms.metricBarSet.excellent),
              good: num(ms.metricBarSet.good),
              acceptable: num(ms.metricBarSet.acceptable),
              concerning: num(ms.metricBarSet.concerning),
              distress: num(ms.metricBarSet.distress),
            }
          : null,
        members: [],
      };
      // fill bars/direction if a later member carries a bar set the first lacked
      if (!b.bars && ms.metricBarSet) {
        b.direction = ms.metricBarSet.direction;
        b.bars = {
          excellent: num(ms.metricBarSet.excellent),
          good: num(ms.metricBarSet.good),
          acceptable: num(ms.metricBarSet.acceptable),
          concerning: num(ms.metricBarSet.concerning),
          distress: num(ms.metricBarSet.distress),
        };
      }
      b.members.push({
        symbol,
        rawValue: num(ms.rawValue),
        l1Band: (ms.l1Band as MetricBand | null) ?? null,
        scoreState: ms.scoreState,
      });
      buckets.set(ms.metricKey, b);
    }
  };

  for (const s of fullSnaps) {
    ingest(s.symbol, "foundation", s.foundationPillar.metricScores);
    ingest(s.symbol, "momentum", s.momentumPillar.metricScores);
  }

  return [...buckets.entries()]
    .map(([metricKey, b]): PeerMetricDistribution => {
      const ps = peerByMetric.get(metricKey) ?? null;
      return {
        metricKey,
        pillar: b.pillar,
        direction: b.direction as PeerMetricDistribution["direction"],
        bars: b.bars,
        peer: ps
          ? { mean: ps.mean, stdDev: ps.stdDev, sampleN: ps.sampleN, usable: ps.sampleN >= 5 && ps.stdDev > 0 }
          : null,
        members: b.members.sort((a, b2) => a.symbol.localeCompare(b2.symbol)),
      };
    })
    .sort((a, b) => a.pillar.localeCompare(b.pillar) || a.metricKey.localeCompare(b.metricKey));
}
