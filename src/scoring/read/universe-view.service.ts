// File: src/scoring/read/universe-view.service.ts
//
// Universe-level aggregate: all ~93 scored stocks folded into ONE ScopeAggregate.
// Reuses computeScopeAggregate + the buildPeerGroupList query pattern without the
// per-pond bucketing. Two DB round-trips; no per-stock series calls.
//
// RT1 (parallel): lean quarterly snapshots + peer groups (for sector mapping)
// RT2 (parallel): full cross-section (no metricScores) + stock names + anchor flags
//
// The reach thresholds for pathology are rescaled:
//   Pond   → widespread = N/M ≥ 0.50 (half the pond, N≈4–10)
//   Universe → widespread = N/M ≥ 0.20 (one fifth of 93 stocks — systemic signal)

import { prisma } from "../../db/prisma.js";
import { computeScopeAggregate, describeScope, type ScopeMember } from "./scope-aggregate.js";
import type {
  PillarKey,
  LabelBand,
  TrajectoryMarker,
  DivergenceFlag,
  FlowCategoryState,
} from "./health-view.types.js";
import type {
  PathologyCensusItem,
  PathologyReach,
  PeerGroupMover,
  FiredFlag,
  FiredPattern,
  BandDistribution,
} from "./peer-group-view.types.js";
import type {
  UniverseHealthView,
  UniverseMemberView,
  UniverseAggregate,
  UniverseSinceLastWeek,
} from "./universe-view.types.js";

// ── helpers (mirrors peer-group-view conventions) ───────────────────────────
const num = (d: unknown): number =>
  d == null
    ? 0
    : typeof (d as { toNumber?: () => number }).toNumber === "function"
      ? (d as { toNumber: () => number }).toNumber()
      : Number(d);

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const round2 = (x: number): number => Math.round(x * 100) / 100;

const DIVERGENCE_NOTABLE = 15;
const DIVERGENCE_WIDE = 25;
const TRAJECTORY_EPS = 1.0;
const MOVER_CAP = 10;
const DETERIORATION_THRESHOLD = -2.0;
const RECOVERY_THRESHOLD = 2.0;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// A stock is "live" in the universe if its latest in-force snapshot's asOfDate is within
// this window of the freshest asOfDate anywhere. Active names are EOD-rescored ~daily, so
// they all share a recent asOf even when a fiscal quarter behind on fundamentals; only
// names that have gone dark (delisted / no longer rescored) fall outside it and are held
// out as `notAtCurrentPeriod`. Comfortably wider than any holiday gap, tighter than a
// quarter — so a quarter rollover keeps ALL live names instead of collapsing the universe.
const STALE_ASOF_DAYS = 45;

// Scaled from pond's 0.50: for a universe of 93, N/M ≥ 0.20 = ~19 stocks firing
// the same flag — systemic, not isolated.
const UNIVERSE_WIDESPREAD_RATIO = 0.2;

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
const severityRank = (s: string | null): number =>
  s == null ? 99 : (SEVERITY_ORDER[s.toLowerCase()] ?? 50);
const worseSeverity = (a: string | null, b: string | null): string | null =>
  severityRank(a) <= severityRank(b) ? a : b;

const BAND_RANK: Record<LabelBand, number> = {
  fragile: 0,
  below_par: 1,
  steady: 2,
  healthy: 3,
  pristine: 4,
};

function divergenceOf(
  subtotals: { pillar: PillarKey; subtotal: number }[],
): { flag: DivergenceFlag; gap: number } {
  if (subtotals.length < 2) return { flag: "none", gap: 0 };
  const sorted = [...subtotals].sort((a, b) => b.subtotal - a.subtotal);
  const gap = round2(sorted[0].subtotal - sorted[sorted.length - 1].subtotal);
  const flag: DivergenceFlag =
    gap >= DIVERGENCE_WIDE ? "wide" : gap >= DIVERGENCE_NOTABLE ? "notable" : "none";
  return { flag, gap };
}

function reachOf(n: number, m: number): PathologyReach {
  if (n <= 1) return "isolated";
  if (m > 0 && n / m >= UNIVERSE_WIDESPREAD_RATIO) return "widespread";
  return "cluster";
}

// ── lean snapshot shape (RT1) ───────────────────────────────────────────────
interface LeanSnap {
  id: string;
  stockId: string;
  symbol: string;
  peerGroupId: string;
  periodKey: string;
  version: number;
  asOfDate: Date;
  composite: unknown;
  labelBand: string;
  foundationSubtotal: unknown;
  momentumSubtotal: unknown;
  marketSubtotal: unknown;
  ownershipSubtotal: unknown;
}

/** Supersede-aware cross-section: per (stock, period) keep MAX(version), per stock keep
 *  the latest period. `current` = every stock's latest in-force snapshot that is still
 *  fresh (asOf within STALE_ASOF_DAYS of the newest); genuinely dark names are `lagging`.
 *  `periodKey` is a display label (the plurality period) — members may span periods. */
function resolveCrossSection(rows: LeanSnap[]): {
  periodKey: string;
  asOfDate: Date;
  current: LeanSnap[];
  lagging: { symbol: string; latestPeriod: string }[];
} | null {
  if (rows.length === 0) return null;

  const inForce = new Map<string, LeanSnap>();
  for (const r of rows) {
    const k = `${r.stockId}|${r.periodKey}`;
    const cur = inForce.get(k);
    if (
      !cur ||
      r.version > cur.version ||
      (r.version === cur.version && r.asOfDate > cur.asOfDate)
    ) {
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

  // The universe = every stock at its LATEST in-force snapshot, REGARDLESS of fiscal
  // period, so a quarter rollover (when only part of the book has the new period yet)
  // never collapses the cross-section to the handful that rolled first. Only genuinely
  // STALE names — no longer EOD-rescored, i.e. whose latest snapshot's asOf sits far
  // behind the freshest one — are held out as lagging. Active names all carry ~the same
  // recent asOf even a quarter behind on fundamentals, so this cleanly splits live vs dark.
  const staleCutoff = new Date(maxAsOf.getTime() - STALE_ASOF_DAYS * 24 * 60 * 60 * 1000);
  const current = all.filter((r) => r.asOfDate >= staleCutoff);
  const lagging = all
    .filter((r) => r.asOfDate < staleCutoff)
    .map((r) => ({ symbol: r.symbol, latestPeriod: r.periodKey }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  // Representative period LABEL (members can now span periods): the one the plurality of
  // live members sit at, ties → the newer period. Display-only; not a membership gate.
  const periodCounts = new Map<string, number>();
  for (const r of current) periodCounts.set(r.periodKey, (periodCounts.get(r.periodKey) ?? 0) + 1);
  const periodKey =
    [...periodCounts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ??
    all[0].periodKey;
  // asOf shown = the freshest rescore date among the live members.
  const asOfDate = current.reduce((a, b) => (b.asOfDate > a.asOfDate ? b : a), current[0]).asOfDate;

  return { periodKey, asOfDate, current, lagging };
}

// ── lighter full cross-section load (RT2, no metricScores) ─────────────────
type FullUniverseSnap = Awaited<ReturnType<typeof loadUniverseCrossSection>>[number];

function loadUniverseCrossSection(ids: string[]) {
  return prisma.scoreSnapshot.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      stockId: true,
      symbol: true,
      composite: true,
      labelBand: true,
      foundationSubtotal: true,
      momentumSubtotal: true,
      marketSubtotal: true,
      ownershipSubtotal: true,
      foundationPillar: { select: { pillarState: true } },
      momentumPillar: { select: { pillarState: true } },
      marketPillar: { select: { pillarState: true } },
      ownershipPillar: {
        select: {
          pillarState: true,
          ownershipScore: {
            select: { flowCategories: { select: { category: true, categoryState: true } } },
          },
        },
      },
      redFlags: { select: { flagKey: true, severity: true, tier: true } },
      patterns: { select: { patternKey: true, direction: true, severity: true, displayState: true } },
    },
  });
}

// ── pathology census builder ────────────────────────────────────────────────
type Acc = { severity: string | null; members: { symbol: string; sev: string | null }[]; states: string[] };

// Dominant display state across a pattern's firing members: dampened wins (PG-wide dampening
// marks every member), else pending only when ALL are pending, else active.
const dominantState = (states: string[]): "active" | "pending_data_integration" | "dampened" =>
  states.some((s) => s === "dampened")
    ? "dampened"
    : states.length > 0 && states.every((s) => s === "pending_data_integration")
      ? "pending_data_integration"
      : "active";

function buildCensus(
  acc: Map<string, Acc>,
  kind: "red_flag" | "pattern",
  M: number,
): PathologyCensusItem[] {
  return [...acc.entries()]
    .map(([key, v]): PathologyCensusItem => {
      const members = v.members
        .sort(
          (a, b) =>
            severityRank(a.sev) - severityRank(b.sev) || a.symbol.localeCompare(b.symbol),
        )
        .map((m) => m.symbol);
      return {
        kind,
        key,
        severity: v.severity,
        memberCount: members.length,
        outOf: M,
        members,
        reach: reachOf(members.length, M),
        displayState: dominantState(v.states),
      };
    })
    .sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        b.memberCount - a.memberCount ||
        a.key.localeCompare(b.key),
    );
}

// ── main export ─────────────────────────────────────────────────────────────

export async function buildUniverseHealthView(): Promise<UniverseHealthView> {
  const now = new Date();
  const anchor = new Date(now.getTime() - SEVEN_DAYS_MS);
  const anchorDate = ymd(anchor);

  const EMPTY_WEEK: UniverseSinceLastWeek = {
    anchorDate,
    newVersionCount: 0,
    bandCrossings: [],
    newFlags: [],
    newDeteriorations: [],
    newRecoveries: [],
    honestNote:
      "Snapshots are quarterly + EOD price-driven rescores. The 7-day window compares " +
      "the current in-force version vs the oldest available version within the window " +
      "(falling back from the pre-anchor baseline when the period itself started inside " +
      "the window). Band crossings are almost entirely market-pillar-led.",
  };

  // ── RT1 (parallel): lean quarterly snaps + peer groups ───────────────────
  const [leanRows, pgs] = await Promise.all([
    prisma.scoreSnapshot.findMany({
      where: { snapshotType: "quarterly" },
      select: {
        id: true,
        stockId: true,
        symbol: true,
        peerGroupId: true,
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
    }) as Promise<LeanSnap[]>,
    prisma.peerGroup.findMany({
      select: {
        id: true,
        sector: { select: { name: true, displayName: true } },
      },
    }),
  ]);

  const sectorByPg = new Map(
    pgs.map((pg) => [
      pg.id,
      pg.sector ? { key: pg.sector.name, displayName: pg.sector.displayName } : null,
    ]),
  );

  const xs = resolveCrossSection(leanRows);
  if (!xs) {
    return {
      scored: false,
      periodKey: null,
      asOfDate: null,
      scoredUniverseSize: 0,
      aggregate: null,
      members: [],
      notAtCurrentPeriod: [],
      pathology: [],
      lensPathology: [],
      movers: { risers: [], slippers: [] },
      sinceLastWeek: EMPTY_WEEK,
    };
  }

  const currentIds = xs.current.map((r) => r.id);
  const currentStockIds = new Set(xs.current.map((r) => r.stockId));

  // Quick-access maps from the lean batch (no extra DB queries needed for
  // trajectory + drift + movers + sinceLastWeek anchor detection).

  // Per-stock: in-force snap at each period (MAX version per stockId|periodKey)
  // → used to derive trajectory markers and prior-period data.
  const inForceByPeriodByStock = new Map<string, Map<string, LeanSnap>>();
  for (const r of leanRows) {
    if (!currentStockIds.has(r.stockId)) continue;
    const periods = inForceByPeriodByStock.get(r.stockId) ?? new Map<string, LeanSnap>();
    const cur = periods.get(r.periodKey);
    if (!cur || r.version > cur.version) periods.set(r.periodKey, r);
    inForceByPeriodByStock.set(r.stockId, periods);
  }

  // Per-stock: the in-force snap at the period BEFORE the current period
  // → drift aggregate + movers
  const priorByStock = new Map<string, LeanSnap>();
  for (const [stockId, periods] of inForceByPeriodByStock) {
    const sorted = [...periods.values()].sort(
      (a, b) =>
        b.asOfDate.getTime() - a.asOfDate.getTime() || b.periodKey.localeCompare(a.periodKey),
    );
    if (sorted.length >= 2) priorByStock.set(stockId, sorted[1]);
  }

  // Quick-access: current in-force lean snap per stock (for peerGroupId → sector
  // and sinceLastWeek version comparison)
  const currentLeanByStock = new Map<string, LeanSnap>(
    xs.current.map((r) => [r.stockId, r]),
  );

  // sinceLastWeek anchor: MAX version at current period where asOfDate ≤ anchor.
  // Fallback: when no pre-anchor version exists (e.g. FY26Q4 scoring started WITHIN
  // the 7-day window), use the OLDEST available version at the current period as the
  // comparison baseline — so v1@Jun-18 → v2@Jun-20 changes are still surfaced.
  const priorAnchorByStock = new Map<string, LeanSnap>();
  // Pass 1: pre-anchor versions (MAX version where asOfDate ≤ anchor). Compared within
  // each stock's OWN current period (members can span periods post-rollover), not one
  // universe-wide period — so a stock a quarter behind still gets its 7-day baseline.
  for (const r of leanRows) {
    if (!currentStockIds.has(r.stockId)) continue;
    if (r.periodKey !== currentLeanByStock.get(r.stockId)?.periodKey) continue;
    if (r.asOfDate > anchor) continue;
    const cur = priorAnchorByStock.get(r.stockId);
    if (!cur || r.version > cur.version) priorAnchorByStock.set(r.stockId, r);
  }
  // Pass 2: fallback — MINIMUM (oldest) in-window version for stocks with no pre-anchor state
  for (const r of leanRows) {
    if (!currentStockIds.has(r.stockId)) continue;
    if (r.periodKey !== currentLeanByStock.get(r.stockId)?.periodKey) continue;
    if (priorAnchorByStock.has(r.stockId)) continue; // already have pre-anchor baseline
    const currentLean = currentLeanByStock.get(r.stockId);
    if (!currentLean || r.version >= currentLean.version) continue; // skip current version itself
    const cur = priorAnchorByStock.get(r.stockId);
    if (!cur || r.version < cur.version) priorAnchorByStock.set(r.stockId, r); // keep minimum
  }

  const anchorIds = [...priorAnchorByStock.values()].map((r) => r.id);

  // ── RT2 (parallel): full cross-section + stock names + anchor flags ───────
  const [fullSnaps, stocks, anchorFlagRows] = await Promise.all([
    loadUniverseCrossSection(currentIds),
    prisma.stock.findMany({
      where: { id: { in: [...currentStockIds] } },
      select: { id: true, name: true },
    }),
    anchorIds.length > 0
      ? prisma.redFlag.findMany({
          where: { snapshotId: { in: anchorIds } },
          select: { snapshotId: true, flagKey: true, severity: true },
        })
      : Promise.resolve([] as { snapshotId: string; flagKey: string; severity: string | null }[]),
  ]);

  const nameById = new Map(stocks.map((s) => [s.id, s.name]));

  const anchorFlagsBySnapId = new Map<
    string,
    { flagKey: string; severity: string | null }[]
  >();
  for (const row of anchorFlagRows) {
    const arr = anchorFlagsBySnapId.get(row.snapshotId) ?? [];
    arr.push({ flagKey: row.flagKey, severity: row.severity });
    anchorFlagsBySnapId.set(row.snapshotId, arr);
  }

  // ── Build members + scope members + pathology accumulators ────────────────
  const scopeMembers: ScopeMember[] = [];
  const memberViews: UniverseMemberView[] = [];
  const flagAcc = new Map<string, Acc>();
  const patternAcc = new Map<string, Acc>();

  // sinceLastWeek accumulators
  const bandCrossings: UniverseSinceLastWeek["bandCrossings"] = [];
  const newFlags: UniverseSinceLastWeek["newFlags"] = [];
  const newDeteriorations: UniverseSinceLastWeek["newDeteriorations"] = [];
  const newRecoveries: UniverseSinceLastWeek["newRecoveries"] = [];
  let newVersionCount = 0;

  for (const s of fullSnaps) {
    const pillars: Record<PillarKey, number> = {
      foundation: num(s.foundationSubtotal),
      momentum: num(s.momentumSubtotal),
      market: num(s.marketSubtotal),
      ownership: num(s.ownershipSubtotal),
    };

    // Divergence — only scored pillars contribute
    const scoredSubs: { pillar: PillarKey; subtotal: number }[] = [];
    if (s.foundationPillar?.pillarState === "scored")
      scoredSubs.push({ pillar: "foundation", subtotal: pillars.foundation });
    if (s.momentumPillar?.pillarState === "scored")
      scoredSubs.push({ pillar: "momentum", subtotal: pillars.momentum });
    if (s.marketPillar?.pillarState === "scored")
      scoredSubs.push({ pillar: "market", subtotal: pillars.market });
    if (s.ownershipPillar?.pillarState === "scored")
      scoredSubs.push({ pillar: "ownership", subtotal: pillars.ownership });

    const firedFlags: FiredFlag[] = s.redFlags
      .map((rf) => ({
        flagKey: rf.flagKey,
        severity: rf.severity,
        tier: rf.tier as "auto" | "review",
      }))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

    const firedPatterns: FiredPattern[] = s.patterns
      .map((p) => ({
        patternKey: p.patternKey,
        direction: p.direction,
        severity: p.severity,
        displayState: (p.displayState ?? "active") as FiredPattern["displayState"],
      }))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

    // Trajectory from in-memory lean batch (prior period for this stock)
    const priorSnap = priorByStock.get(s.stockId);
    let trajectoryMarker: TrajectoryMarker | null = null;
    let trajectoryDelta: number | null = null;
    if (priorSnap) {
      const d = round2(num(s.composite) - num(priorSnap.composite));
      trajectoryDelta = d;
      trajectoryMarker =
        d > TRAJECTORY_EPS ? "improving" : d < -TRAJECTORY_EPS ? "deteriorating" : "stable";
    }

    const sector = sectorByPg.get(currentLeanByStock.get(s.stockId)?.peerGroupId ?? "") ?? null;

    const flowCats = s.ownershipPillar?.ownershipScore?.flowCategories ?? [];
    const cState = flowCats.find((f) => f.category === "C_insider")?.categoryState;
    const dState = flowCats.find((f) => f.category === "D_block")?.categoryState;
    const flowCategoryStates =
      cState != null && dState != null
        ? { C_insider: cState as FlowCategoryState, D_block: dState as FlowCategoryState }
        : undefined;

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
      sector,
      flowCategoryStates,
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

    // Pathology accumulators
    for (const rf of s.redFlags) {
      const acc = flagAcc.get(rf.flagKey) ?? { severity: null, members: [], states: [] };
      acc.severity = worseSeverity(acc.severity, rf.severity);
      acc.members.push({ symbol: s.symbol, sev: rf.severity });
      flagAcc.set(rf.flagKey, acc);
    }
    for (const p of s.patterns) {
      const acc = patternAcc.get(p.patternKey) ?? { severity: null, members: [], states: [] };
      acc.severity = worseSeverity(acc.severity, p.severity);
      acc.members.push({ symbol: s.symbol, sev: p.severity });
      acc.states.push(p.displayState ?? "active");
      patternAcc.set(p.patternKey, acc);
    }

    // sinceLastWeek: compare current in-force vs anchor in-force
    const currentLean = currentLeanByStock.get(s.stockId)!;
    const priorAnchor = priorAnchorByStock.get(s.stockId);

    // A "new version in window" = a later version was committed after the anchor
    if (priorAnchor && priorAnchor.version < currentLean.version) {
      newVersionCount++;

      const currentBand = s.labelBand as LabelBand;
      const priorBand = priorAnchor.labelBand as LabelBand;
      const currentComp = round2(num(s.composite));
      const priorComp = round2(num(priorAnchor.composite));
      const delta = round2(currentComp - priorComp);

      if (currentBand !== priorBand) {
        bandCrossings.push({
          symbol: s.symbol,
          from: priorBand,
          to: currentBand,
          direction: BAND_RANK[currentBand] > BAND_RANK[priorBand] ? "up" : "down",
        });
      }

      const priorFlags = new Set(
        (anchorFlagsBySnapId.get(priorAnchor.id) ?? []).map((f) => f.flagKey),
      );
      for (const rf of s.redFlags) {
        if (!priorFlags.has(rf.flagKey)) {
          newFlags.push({ symbol: s.symbol, flagKey: rf.flagKey, severity: rf.severity });
        }
      }

      if (delta <= DETERIORATION_THRESHOLD) {
        newDeteriorations.push({
          symbol: s.symbol,
          delta,
          fromComposite: priorComp,
          toComposite: currentComp,
          fromBand: priorBand,
          toBand: currentBand,
        });
      }
      if (delta >= RECOVERY_THRESHOLD) {
        newRecoveries.push({
          symbol: s.symbol,
          delta,
          fromComposite: priorComp,
          toComposite: currentComp,
          fromBand: priorBand,
          toBand: currentBand,
        });
      }
    }
  }

  memberViews.sort((a, b) => b.composite - a.composite);
  newDeteriorations.sort((a, b) => a.delta - b.delta);
  newRecoveries.sort((a, b) => b.delta - a.delta);

  // ── Aggregate + drift ─────────────────────────────────────────────────────
  const agg = computeScopeAggregate(scopeMembers);
  const M = scopeMembers.length;

  let priorPeriodKey: string | null = null;
  let priorMedianComposite: number | null = null;
  let medianDrift: number | null = null;

  if (priorByStock.size > 0) {
    const priorList = [...priorByStock.values()];

    // Representative prior-period LABEL = the plurality prior period among live members
    // (ties → newer). Members can span periods, so there is no single prior period.
    const priorCounts = new Map<string, number>();
    for (const r of priorList) priorCounts.set(r.periodKey, (priorCounts.get(r.periodKey) ?? 0) + 1);
    priorPeriodKey =
      [...priorCounts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0][0];

    // Drift = universe median now vs one period back, each stock at ITS OWN prior
    // (second-latest) snapshot — coherent even when members span periods.
    const priorMembers: ScopeMember[] = priorList.map((r) => ({
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
      firesAnyRedFlag: false,
      weight: 1,
    }));

    const priorAgg = computeScopeAggregate(priorMembers);
    priorMedianComposite = priorAgg.medianComposite;
    medianDrift = round2(agg.medianComposite - priorAgg.medianComposite);
  }

  // ── Pathology census ──────────────────────────────────────────────────────
  // The LOUD three-lens patterns (LM3/LM7/LP2/LP5) persist to score_patterns with
  // `lens_*` keys (see lens-findings.ts). Partition them OUT of the P-series/structural
  // pathology into their own lens census — same shape, a distinct family for the board.
  const patternCensus = buildCensus(patternAcc, "pattern", M);
  const lensPathology = patternCensus.filter((p) => p.key.startsWith("lens_"));
  const pathology: PathologyCensusItem[] = [
    ...buildCensus(flagAcc, "red_flag", M),
    ...patternCensus.filter((p) => !p.key.startsWith("lens_")),
  ];

  // ── Movers (from in-memory lean batch) ────────────────────────────────────
  const moverRows: PeerGroupMover[] = [];
  for (const s of fullSnaps) {
    const prior = priorByStock.get(s.stockId);
    if (!prior) continue;
    const currentComp = round2(num(s.composite));
    const priorComp = round2(num(prior.composite));
    const delta = round2(currentComp - priorComp);
    if (delta === 0) continue;
    moverRows.push({
      symbol: s.symbol,
      composite: currentComp,
      priorComposite: priorComp,
      delta,
      fromPeriod: prior.periodKey,
      toPeriod: currentLeanByStock.get(s.stockId)?.periodKey ?? xs.periodKey,
    });
  }
  const risers = moverRows
    .filter((m) => m.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, MOVER_CAP);
  const slippers = moverRows
    .filter((m) => m.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, MOVER_CAP);

  // ── Assemble ──────────────────────────────────────────────────────────────
  const aggregate: UniverseAggregate = {
    scoredCount: agg.scoredCount,
    medianComposite: agg.medianComposite,
    meanComposite: agg.meanComposite,
    priorMedianComposite,
    medianDrift,
    priorPeriodKey,
    dispersion: agg.dispersion,
    range:
      agg.min && agg.max
        ? { min: agg.min, max: agg.max }
        : null,
    composites: agg.composites,
    bandDistribution: agg.bandDistribution as BandDistribution,
    pillarMedians: agg.pillarMedians,
    redFlagMemberCount: agg.redFlagMemberCount,
    descriptor: describeScope(scopeMembers, agg) ?? "",
  };

  const sinceLastWeek: UniverseSinceLastWeek = {
    anchorDate,
    newVersionCount,
    bandCrossings,
    newFlags,
    newDeteriorations,
    newRecoveries,
    honestNote:
      "Snapshots are quarterly + EOD price-driven rescores. The 7-day window compares " +
      "the current in-force version vs the oldest available version within the window " +
      "(falling back from the pre-anchor baseline when the period itself started inside " +
      "the window). Band crossings are almost entirely market-pillar-led.",
  };

  return {
    scored: true,
    periodKey: xs.periodKey,
    asOfDate: ymd(xs.asOfDate),
    scoredUniverseSize: M,
    aggregate,
    members: memberViews,
    notAtCurrentPeriod: xs.lagging,
    pathology,
    lensPathology,
    movers: { risers, slippers },
    sinceLastWeek,
  };
}
