// File: src/scoring/read/health-view.service.ts
//
// THE HealthSnapshotView ASSEMBLER. Reads the in-force snapshot (via the shared
// supersede-aware resolver), the trajectory series, peer siblings, coverage, and
// the CorporateEvent overlay, and maps them to the canonical read-model. PURE
// mapping + arithmetic on already-fetched rows — no fabrication: a field with no
// backing data is null with the key present.

import { prisma } from "../../db/prisma.js";
import { PILLAR_WEIGHTS } from "../composite/weights.js";
import {
  getLatestSnapshot,
  getSnapshotSeries,
  getPeerSiblings,
  resolveCoverage,
} from "./scoring-read.service.js";
import type {
  HealthSnapshotView,
  PillarView,
  PillarKey,
  MetricView,
  MarketSubView,
  FlowCategoryView,
  OwnershipDetail,
  NativeZone,
  BandColour,
  LabelBand,
  DivergenceView,
  DivergenceFlag,
  TrajectoryPoint,
  CrossingEvent,
  CorporateEventView,
  RedFlagView,
  PatternView,
  PeerStandingSection,
  TrajectoryMarker,
  MetricBars,
  PeerStats,
} from "./health-view.types.js";

// ── LOCKED CONSTANTS (methodology — not fitted, not per-PG) ──────────────────────
// Native-zone marks per pillar (the spec's locked [lower, upper] zone bounds).
const NATIVE_MARKS: Record<PillarKey, { lower: number; upper: number }> = {
  foundation: { lower: 60, upper: 72 },
  momentum: { lower: 54, upper: 75 },
  market: { lower: 50, upper: 74 },
  ownership: { lower: 60, upper: 72 },
};
const DIVERGENCE_NOTABLE = 15;
const DIVERGENCE_WIDE = 25;
const TRAJECTORY_EPS = 1.0; // composite-point delta for improving/deteriorating
const PILLARS: PillarKey[] = ["foundation", "momentum", "market", "ownership"];

const num = (d: unknown): number =>
  d == null ? 0 : typeof (d as { toNumber?: () => number }).toNumber === "function"
    ? (d as { toNumber: () => number }).toNumber()
    : Number(d);
const numN = (d: unknown): number | null =>
  d == null ? null : typeof (d as { toNumber?: () => number }).toNumber === "function"
    ? (d as { toNumber: () => number }).toNumber()
    : Number(d);
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** Build the peer view from a μ/σ/N source (FK relation OR natural-key fallback row),
 *  stamping the USABILITY guard: a distribution is usable only with ≥5 peers AND real
 *  spread (σ>0). When not usable the values still surface (transparency) but the UI must
 *  show "insufficient peers" — never a drawn curve or a (raw−μ)/σ read. */
function toPeerStats(src: { mean: unknown; stdDev: unknown; sampleN: number } | null): PeerStats | null {
  if (!src) return null;
  const mean = num(src.mean);
  const stdDev = num(src.stdDev);
  const sampleN = src.sampleN;
  return { mean, stdDev, sampleN, usable: sampleN >= 5 && stdDev > 0 };
}

type LoadedSnapshot = NonNullable<Awaited<ReturnType<typeof getLatestSnapshot>>>;

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};
const severityRank = (s: string | null): number =>
  s == null ? 99 : SEVERITY_ORDER[s.toLowerCase()] ?? 50;

function nativeZone(pillar: PillarKey, subtotal: number, state: string): NativeZone {
  const marks = NATIVE_MARKS[pillar];
  // An unavailable/redistributed pillar has an inert-0 subtotal; report it honestly
  // as below_native (it carries no real position).
  const position =
    state !== "scored"
      ? "below_native"
      : subtotal < marks.lower
        ? "below_native"
        : subtotal > marks.upper
          ? "above_native"
          : "in_native";
  return { lowerMark: marks.lower, upperMark: marks.upper, position };
}

function bandColour(band: LabelBand, mapping: unknown): BandColour {
  const m = (mapping as Record<string, { label?: string; colour?: string; range?: [number | null, number | null] }> | null)?.[band];
  return {
    band,
    label: m?.label ?? band,
    colour: m?.colour ?? null,
    range: m?.range ?? null,
  };
}

/** Natural-key peer-stats fallback: metricKey → μ/σ/N, loaded once per view for the
 *  snapshot's (peerGroupId, asOfDate). Used when a MetricScore predates the write-path
 *  fix and carries no peerStatsSnapshotId FK (the backfilled rows resolve here). */
type PeerFallback = Map<string, { mean: unknown; stdDev: unknown; sampleN: number }>;

function mapMetric(ms: LoadedSnapshot["foundationPillar"]["metricScores"][number], peerFallback: PeerFallback): MetricView {
  const bars: MetricBars | null = ms.metricBarSet
    ? {
        direction: ms.metricBarSet.direction as MetricBars["direction"],
        excellent: num(ms.metricBarSet.excellent),
        good: num(ms.metricBarSet.good),
        acceptable: num(ms.metricBarSet.acceptable),
        concerning: num(ms.metricBarSet.concerning),
        distress: num(ms.metricBarSet.distress),
      }
    : null;
  return {
    metricKey: ms.metricKey,
    rawValue: num(ms.rawValue),
    l1Score: numN(ms.l1Score),
    l2Score: numN(ms.l2Score),
    l3Score: numN(ms.l3Score),
    metricScore: num(ms.metricScore),
    l1Band: (ms.l1Band as MetricView["l1Band"]) ?? null,
    scoreState: ms.scoreState as MetricView["scoreState"],
    nominalWeight: num(ms.nominalWeight),
    effectiveWeight: num(ms.effectiveWeight),
    contribution: num(ms.contribution),
    suppressionReason: null, // filled below from SuppressionDirective when applicable
    bars,
    // Prefer the FK relation (new scores carry it); else the backfilled natural-key row.
    peer: toPeerStats(ms.peerStats ?? peerFallback.get(ms.metricKey) ?? null),
  };
}

/**
 * Assemble the full HealthSnapshotView for a symbol. Returns null only when the
 * stock itself is unknown (the controller maps that to 404). A known-but-unscored
 * stock returns a `scored: false` view with identity + coverage populated.
 */
export async function buildHealthSnapshotView(
  symbolRaw: string,
  windowQuarters = 12,
): Promise<HealthSnapshotView | null> {
  const symbol = symbolRaw.toUpperCase();

  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: {
      id: true,
      symbol: true,
      name: true,
      industryType: true,
      sector: { select: { name: true, displayName: true, sectorClass: true } },
    },
  });
  if (!stock) return null;

  const [coverage, spg] = await Promise.all([
    resolveCoverage(stock.id),
    prisma.stockPeerGroup.findFirst({
      where: { stockId: stock.id },
      select: { peerGroup: { select: { id: true, name: true, displayName: true, stockCount: true } } },
    }),
  ]);
  const pg = spg?.peerGroup ?? null;

  const snap = await getLatestSnapshot(stock.id);

  // ── NOT-SCORED branch: identity + coverage only, every snapshot section null ──
  if (!snap) {
    return {
      scored: false,
      identity: {
        symbol: stock.symbol,
        name: stock.name,
        sector: stock.sector ? { key: stock.sector.name, displayName: stock.sector.displayName } : null,
        sectorClass: stock.sector?.sectorClass ?? null,
        industryPath: stock.industryType === "banking" ? "banking" : "non_financial",
        peerGroup: pg ? { id: pg.id, name: pg.name, displayName: pg.displayName, memberCount: pg.stockCount } : null,
        coverageState: coverage?.coverageState ?? null,
        coverageReason: coverage?.coverageReason ?? null,
        asOfDate: "",
        periodKey: "",
      },
      verdict: null,
      pillars: [],
      trajectory: null,
      findings: null,
      peerStanding: null,
    };
  }

  // ── identity ──
  const identity: HealthSnapshotView["identity"] = {
    symbol: stock.symbol,
    name: stock.name,
    sector: stock.sector ? { key: stock.sector.name, displayName: stock.sector.displayName } : null,
    sectorClass: stock.sector?.sectorClass ?? null,
    industryPath: snap.industryPath === "banking" ? "banking" : "non_financial",
    peerGroup: pg ? { id: pg.id, name: pg.name, displayName: pg.displayName, memberCount: pg.stockCount } : null,
    coverageState: coverage?.coverageState ?? null,
    coverageReason: coverage?.coverageReason ?? null,
    asOfDate: ymd(snap.asOfDate),
    periodKey: snap.periodKey,
  };

  // ── series + trajectory marker (needs ≥2 in-force snapshots) ──
  const series = await getSnapshotSeries(stock.id, windowQuarters);
  let trajectoryMarker: TrajectoryMarker | null = null;
  let trajectoryDelta: number | null = null;
  if (series.length >= 2) {
    const last = series[series.length - 1].composite;
    const prev = series[series.length - 2].composite;
    trajectoryDelta = Math.round((last - prev) * 1e4) / 1e4;
    trajectoryMarker =
      trajectoryDelta > TRAJECTORY_EPS ? "improving" : trajectoryDelta < -TRAJECTORY_EPS ? "deteriorating" : "stable";
  }

  // ── divergence (derived from SCORED pillar subtotals) ──
  const pillarRows: { pillar: PillarKey; subtotal: number; state: string }[] = [
    { pillar: "foundation", subtotal: num(snap.foundationSubtotal), state: snap.foundationPillar.pillarState },
    { pillar: "momentum", subtotal: num(snap.momentumSubtotal), state: snap.momentumPillar.pillarState },
    { pillar: "market", subtotal: num(snap.marketSubtotal), state: snap.marketPillar.pillarState },
    { pillar: "ownership", subtotal: num(snap.ownershipSubtotal), state: snap.ownershipPillar.pillarState },
  ];
  const scoredPillarSubtotals = pillarRows
    .filter((p) => p.state === "scored")
    .map((p) => ({ pillar: p.pillar, subtotal: p.subtotal }));

  let divergence: DivergenceView;
  if (scoredPillarSubtotals.length >= 2) {
    const sorted = [...scoredPillarSubtotals].sort((a, b) => b.subtotal - a.subtotal);
    const high = sorted[0];
    const low = sorted[sorted.length - 1];
    const gap = Math.round((high.subtotal - low.subtotal) * 1e4) / 1e4;
    const flag: DivergenceFlag = gap >= DIVERGENCE_WIDE ? "wide" : gap >= DIVERGENCE_NOTABLE ? "notable" : "none";
    divergence = { flag, gap, high, low, storedScalar: num(snap.divergence) };
  } else {
    divergence = { flag: "none", gap: 0, high: null, low: null, storedScalar: num(snap.divergence) };
  }

  const verdict: HealthSnapshotView["verdict"] = {
    composite: num(snap.composite),
    label: bandColour(snap.labelBand as LabelBand, snap.bandMappingVersion.mapping),
    trajectoryMarker,
    trajectoryDelta,
    divergence,
    pondMask: null, // no PG-level mask in the schema (flagged)
  };

  // ── suppression reasons (one lookup keyed by snapshotKey = periodKey) ──
  const suppressions = await prisma.suppressionDirective.findMany({
    where: { stockId: stock.id, snapshotKey: snap.periodKey },
    select: { metricKey: true, outcome: true },
  });
  const suppressionByMetric = new Map(suppressions.map((s) => [s.metricKey, `guardrail ${s.outcome}`]));

  // ── peer-stats natural-key fallback (for MetricScores written before the FK existed) ──
  // One indexed lookup by (peerGroupId, asOfDate) — the period's whole cross-section. New
  // scores carry the FK directly and skip this; backfilled rows resolve here. Append-only:
  // a read-only join, never a write.
  const peerStatsRows = await prisma.peerStatsSnapshot.findMany({
    where: { peerGroupId: snap.peerGroupId, asOfDate: snap.asOfDate },
    select: { metricKey: true, mean: true, stdDev: true, sampleN: true },
  });
  const peerFallback: PeerFallback = new Map(
    peerStatsRows.map((r) => [r.metricKey, { mean: r.mean, stdDev: r.stdDev, sampleN: r.sampleN }]),
  );

  // ── pillars ──
  const applied: Record<PillarKey, number> = {
    foundation: num(snap.wFoundation),
    momentum: num(snap.wMomentum),
    market: num(snap.wMarket),
    ownership: num(snap.wOwnership),
  };
  const subtotalOf: Record<PillarKey, number> = {
    foundation: num(snap.foundationSubtotal),
    momentum: num(snap.momentumSubtotal),
    market: num(snap.marketSubtotal),
    ownership: num(snap.ownershipSubtotal),
  };
  const stateOf: Record<PillarKey, string> = {
    foundation: snap.foundationPillar.pillarState,
    momentum: snap.momentumPillar.pillarState,
    market: snap.marketPillar.pillarState,
    ownership: snap.ownershipPillar.pillarState,
  };

  const fmMetrics = (p: LoadedSnapshot["foundationPillar"]): MetricView[] =>
    p.metricScores
      .map((ms) => mapMetric(ms, peerFallback))
      .map((m) => ({ ...m, suppressionReason: suppressionByMetric.get(m.metricKey) ?? null }))
      .sort((a, b) => a.metricKey.localeCompare(b.metricKey));

  const marketSubs: MarketSubView[] = snap.marketPillar.marketSubScores
    .map((s) => ({
      subComponent: s.subComponent as MarketSubView["subComponent"],
      category: s.category as MarketSubView["category"],
      available: s.available,
      reason: s.reason,
      rawValue: numN(s.rawValue),
      score: numN(s.score),
      band: (s.band as MarketSubView["band"]) ?? null,
      saturated: s.saturated,
      capped: s.capped,
    }))
    .sort((a, b) => a.subComponent.localeCompare(b.subComponent));

  const os = snap.ownershipPillar.ownershipScore;
  const ownershipDetail: OwnershipDetail | null = os
    ? {
        baseline: num(os.baseline),
        baselineReason: os.baselineReason,
        pledgingAdjustment: num(os.pledgingAdjustment),
        penalties: { r2: num(os.penaltyR2), r6: num(os.penaltyR6), prolongedFii: num(os.penaltyProlongedFii) },
        primarySubtotal: num(os.primarySubtotal),
        flowAdjustmentRaw: num(os.flowAdjustmentRaw),
        flowAdjustmentClamped: num(os.flowAdjustmentClamped),
        finalOwnership: num(os.finalOwnership),
        r1Fired: os.r1Fired,
        r1TriggeringValues: os.r1TriggeringValues ?? null,
        flowCategories: os.flowCategories
          .map(
            (fc): FlowCategoryView => ({
              category: fc.category as FlowCategoryView["category"],
              categoryState: fc.categoryState as FlowCategoryView["categoryState"],
              rawSubScore: num(fc.rawSubScore),
              capApplied: num(fc.capApplied),
              cappedSubScore: num(fc.cappedSubScore),
              bandLanded: fc.bandLanded,
              netFlowValue: numN(fc.netFlowValue),
              trendState: (fc.trendState as FlowCategoryView["trendState"]) ?? null,
            }),
          )
          .sort((a, b) => a.category.localeCompare(b.category)),
      }
    : null;

  const pillars: PillarView[] = PILLARS.map((pillar) => {
    const base: PillarView = {
      pillar,
      subtotal: subtotalOf[pillar],
      state: stateOf[pillar] as PillarView["state"],
      nominalWeight: PILLAR_WEIGHTS[pillar],
      appliedWeight: applied[pillar],
      nativeZone: nativeZone(pillar, subtotalOf[pillar], stateOf[pillar]),
      metrics: null,
      marketSubs: null,
      ownership: null,
    };
    if (pillar === "foundation") base.metrics = fmMetrics(snap.foundationPillar);
    else if (pillar === "momentum") base.metrics = fmMetrics(snap.momentumPillar);
    else if (pillar === "market") base.marketSubs = marketSubs;
    else base.ownership = ownershipDetail;
    return base;
  });

  // ── trajectory: series + crossings + corporate-event overlay ──
  const seriesView: TrajectoryPoint[] = series.map((p) => ({
    periodKey: p.periodKey,
    asOfDate: ymd(p.asOfDate),
    composite: p.composite,
    labelBand: p.labelBand as LabelBand,
    foundation: p.foundationSubtotal,
    momentum: p.momentumSubtotal,
    market: p.marketSubtotal,
    ownership: p.ownershipSubtotal,
  }));

  const crossings: CrossingEvent[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const cur = series[i];
    if (prev.labelBand !== cur.labelBand) {
      crossings.push({ type: "band", fromPeriod: prev.periodKey, toPeriod: cur.periodKey, pillar: null, from: prev.labelBand, to: cur.labelBand });
    }
    for (const pillar of PILLARS) {
      const key = `${pillar}Subtotal` as const;
      const zonePrev = zoneLabel(pillar, prev[key]);
      const zoneCur = zoneLabel(pillar, cur[key]);
      if (zonePrev !== zoneCur) {
        crossings.push({ type: "pillar_zone", fromPeriod: prev.periodKey, toPeriod: cur.periodKey, pillar, from: zonePrev, to: zoneCur });
      }
    }
  }

  // Event window = the series span; widen back windowQuarters quarters when the
  // series is a single point so the overlay is meaningful.
  const latestAsOf = series.length ? series[series.length - 1].asOfDate : snap.asOfDate;
  const earliestAsOf =
    series.length > 1
      ? series[0].asOfDate
      : new Date(latestAsOf.getTime() - windowQuarters * 92 * 24 * 3600 * 1000);
  const eventRows = await prisma.corporateEvent.findMany({
    where: { stockId: stock.id, eventDate: { gte: earliestAsOf, lte: latestAsOf } },
    orderBy: { eventDate: "asc" },
    select: { eventType: true, eventDate: true, description: true, impactLevel: true },
  });
  const events: CorporateEventView[] = eventRows.map((e) => ({
    eventType: e.eventType,
    eventDate: ymd(e.eventDate),
    description: e.description,
    impactLevel: e.impactLevel,
  }));

  const trajectory: HealthSnapshotView["trajectory"] = {
    windowQuarters,
    series: seriesView,
    crossings,
    events,
  };

  // ── findings (raw, sorted by severity; red flags first, then patterns) ──
  const redFlags: RedFlagView[] = snap.redFlags
    .map((rf) => ({
      flagKey: rf.flagKey,
      severity: rf.severity,
      tier: rf.tier as RedFlagView["tier"],
      triggeringValues: rf.triggeringValues ?? null,
      guardrailEventId: rf.guardrailEventId,
    }))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const patterns: PatternView[] = snap.patterns
    .map((p) => ({
      patternKey: p.patternKey,
      direction: p.direction,
      severity: p.severity,
      evidence: p.evidence ?? null,
      metricRefs: p.metricRefs ?? null,
    }))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const findings: HealthSnapshotView["findings"] = { redFlags, patterns };

  // ── peer standing (rank within PG by composite at this period) ──
  const peerStanding = pg
    ? buildPeerStanding(pg.id, snap.periodKey, stock.id, await getPeerSiblings(pg.id, snap.periodKey))
    : null;

  return { scored: true, identity, verdict, pillars, trajectory, findings, peerStanding };
}

function zoneLabel(pillar: PillarKey, subtotal: number): string {
  const m = NATIVE_MARKS[pillar];
  return subtotal < m.lower ? "below_native" : subtotal > m.upper ? "above_native" : "in_native";
}

function buildPeerStanding(
  peerGroupId: string,
  periodKey: string,
  stockId: string,
  siblings: Awaited<ReturnType<typeof getPeerSiblings>>,
): PeerStandingSection | null {
  if (siblings.length === 0) return null;
  const byComposite = [...siblings].sort((a, b) => b.composite - a.composite);
  const idx = byComposite.findIndex((s) => s.stockId === stockId);
  if (idx === -1) return null;

  const rank = idx + 1;
  const outOf = byComposite.length;
  const percentile = outOf > 1 ? Math.round(((outOf - rank) / (outOf - 1)) * 1000) / 10 : 100;
  const above = idx > 0 ? { symbol: byComposite[idx - 1].symbol, composite: byComposite[idx - 1].composite } : null;
  const below = idx < outOf - 1 ? { symbol: byComposite[idx + 1].symbol, composite: byComposite[idx + 1].composite } : null;

  const rankBy = (key: keyof (typeof siblings)[number]) => {
    const sorted = [...siblings].sort((a, b) => (b[key] as number) - (a[key] as number));
    return { rank: sorted.findIndex((s) => s.stockId === stockId) + 1, outOf };
  };

  return {
    peerGroupId,
    periodKey,
    memberCount: outOf,
    rank,
    percentile,
    neighbours: { above, below },
    perPillarRank: {
      foundation: rankBy("foundationSubtotal"),
      momentum: rankBy("momentumSubtotal"),
      market: rankBy("marketSubtotal"),
      ownership: rankBy("ownershipSubtotal"),
    },
  };
}
