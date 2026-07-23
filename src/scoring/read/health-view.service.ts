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
  getDailySnapshotSeries,
  getInForceSeriesRefs,
  getPeerSiblings,
  getPeerMetricValues,
  resolveCoverage,
} from "./scoring-read.service.js";
import { canonicalMetric } from "../bars-loader/label-map.js";
import type { BarDirection as EngineBarDirection } from "../lenses/types.js";
import {
  deriveLensTriplet,
  lensPattern as computeLensPattern,
  lensPillarPattern as computeLensPillarPattern,
  applyAntiDoubleCount,
  applyAntiDoubleCountPillar,
  STEADY_EQUIVALENT_MIN,
  type MetricLensAtom,
  type FiredHeadline,
} from "../lens-patterns/index.js";
import {
  standingBand,
  composeLpVerdict,
  composeLmVerdict,
} from "../lens-patterns/standing-context.js";
import type {
  HealthSnapshotView,
  PillarView,
  PillarKey,
  MetricView,
  MetricState,
  LensRead,
  L3SeriesPoint,
  MetricLensPattern,
  PillarLensPattern,
  BandLadder,
  PillarLensShares,
  MarketSubView,
  FlowCategoryView,
  OwnershipDetail,
  NativeZone,
  BandColour,
  LabelBand,
  DivergenceView,
  DivergenceFlag,
  TrajectoryPoint,
  DailyTrajectoryPoint,
  ResultDayMarker,
  CrossingEvent,
  CorporateEventView,
  RedFlagView,
  PatternView,
  PeerStandingSection,
  TrajectoryMarker,
  MetricBars,
  PeerStats,
  PeerDistribution,
  BarProvenance,
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
type LoadedMetricScore = LoadedSnapshot["foundationPillar"]["metricScores"][number];

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};
const severityRank = (s: string | null): number =>
  s == null ? 99 : SEVERITY_ORDER[s.toLowerCase()] ?? 50;

/** Derive the MetricState discriminant from the stored columns.
 *  Every scored+not metric maps to exactly one honest state.
 *
 *  For scoreState=scored metrics: the discriminant is "scored" in all cases where
 *  L1 computed — individual lens evaluability is surfaced in lens.l1/l2/l3, not here.
 *  The sub-states (building_history, insufficient_peers) describe why a specific lens
 *  is not_evaluable; they live in lens.l*.reason. The top-level metricState is the
 *  SCORED state, which is the dominant fact for routing the UI panel.
 *
 *  Exception: no_bar means L1 itself could not run (no bar set) — that's a top-level
 *  scored-but-unratable situation distinct from "scored with limited peer/history data". */
function deriveMetricState(ms: LoadedMetricScore, peer: PeerStats | null): MetricState {
  if (ms.scoreState !== "scored") return "normalized_out";
  if (!ms.l1Available || !ms.metricBarSet) return "no_bar";
  return "scored";
}

/** Build the MetricLensAtom from the loaded row + resolved peer. */
function toAtom(
  ms: LoadedMetricScore,
  pillar: "foundation" | "momentum",
  peer: { mean: unknown; stdDev: unknown; sampleN: number } | null,
): MetricLensAtom {
  return {
    metricKey: ms.metricKey,
    pillar,
    scored: ms.scoreState === "scored",
    rawValue: num(ms.rawValue),
    l1Available: ms.l1Available,
    l1Band: (ms.l1Band as MetricLensAtom["l1Band"]) ?? null,
    l2Available: ms.l2Available,
    l2Score: numN(ms.l2Score),
    l2AnchorApplied: numN(ms.l2AnchorApplied),
    peerMean: peer ? num(peer.mean) : null,
    peerStdDev: peer ? num(peer.stdDev) : null,
    peerSampleN: peer ? peer.sampleN : null,
    l3Available: ms.l3Available,
    l3Score: numN(ms.l3Score),
    l3AnchorApplied: numN(ms.l3AnchorApplied),
    l3Mean: numN(ms.l3Mean),
    l3StdDev: numN(ms.l3StdDev),
    l3WindowN: ms.l3WindowN ?? null,
  };
}

/** Build the three LensRead views from a derived triplet + atom.
 *  acceptableBar: the L1 acceptable threshold from MetricBarSet (referenceValue for L1). */
function toLensReads(
  atom: MetricLensAtom,
  acceptableBar: number | null,
): { l1: LensRead; l2: LensRead; l3: LensRead } {
  const triplet = deriveLensTriplet(atom);

  const l1: LensRead = {
    state: triplet.l1,
    evaluable: triplet.l1 !== "not_evaluable",
    referenceValue: acceptableBar,
    reason: triplet.l1 === "not_evaluable" ? (atom.l1Available ? "no_bar" : "l1_unavailable") : null,
  };

  const l2Reason = (): string | null => {
    if (triplet.l2 !== "not_evaluable") return null;
    if (!atom.l2Available) return "l2_unavailable";
    if (atom.peerSampleN === null || atom.peerMean === null) return "no_peer_stats";
    if (atom.peerSampleN < 5) return "insufficient_peers";
    if (atom.peerStdDev === 0) return "std_dev_zero";
    return "l2_unavailable";
  };

  const l2: LensRead = {
    state: triplet.l2,
    evaluable: triplet.l2 !== "not_evaluable",
    referenceValue: atom.peerMean,
    reason: l2Reason(),
  };

  const l3Reason = (): string | null => {
    if (triplet.l3 !== "not_evaluable") return null;
    if (!atom.l3Available) return "building_history";
    if (atom.l3Mean === null || atom.l3StdDev === null) return "no_history_stats";
    return "l3_unavailable";
  };

  const l3: LensRead = {
    state: triplet.l3,
    evaluable: triplet.l3 !== "not_evaluable",
    referenceValue: atom.l3Mean,
    reason: l3Reason(),
  };

  return { l1, l2, l3 };
}

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

/** The minimal bar-set shape the provenance + synthesized-row helpers read — assignable
 *  from BOTH the loaded metricScore.metricBarSet relation and the lightweight bar-set
 *  query used to enumerate the pillar's full metric set. */
interface BarSetLite {
  direction: string;
  excellent: unknown; good: unknown; acceptable: unknown; concerning: unknown; distress: unknown;
  barPath: string;
  inForceFrom: Date;
  inheritsFromPeerGroupId: string | null;
}

/** Bar provenance (modal §2.1): where the bars came from + when last recalibrated. */
function toBarProvenance(
  bs: { barPath: string; inForceFrom: Date; inheritsFromPeerGroupId: string | null } | null,
): BarProvenance | null {
  if (!bs) return null;
  return { barPath: bs.barPath, recalibratedAt: ymd(bs.inForceFrom), inheritedFromPeerGroupId: bs.inheritsFromPeerGroupId };
}

/** Per-metric peer cross-section (modal §2.3): members + mean + direction-aware rank.
 *  Returns null for an honest-empty row or when no member values resolve. Self is always
 *  included (the stock IS a member of its own field). */
function toPeerDistribution(
  metricKey: string,
  selfRaw: number | null,
  selfSymbol: string,
  peer: PeerStats | null,
  direction: EngineBarDirection | null,
  peerValues: Map<string, { symbol: string; value: number }[]>,
): PeerDistribution | null {
  if (selfRaw === null) return null;
  const raw = peerValues.get(metricKey) ?? [];
  if (raw.length === 0) return null;
  const members = raw.map((m) => ({ symbol: m.symbol, value: m.value, isSelf: m.symbol === selfSymbol }));
  if (!members.some((m) => m.isSelf)) members.push({ symbol: selfSymbol, value: selfRaw, isSelf: true });
  // Direction-aware rank: 1 = healthiest (highest for higher_better, lowest for lower_better).
  const sorted = [...members].sort((a, b) => (direction === "lower_better" ? a.value - b.value : b.value - a.value));
  const rank = sorted.findIndex((m) => m.isSelf) + 1;
  const mean = peer ? peer.mean : members.reduce((s, m) => s + m.value, 0) / members.length;
  return { mean, selfValue: selfRaw, rank, outOf: members.length, usable: peer?.usable ?? false, members };
}

/** An honest-empty MetricView for a pillar metric that has a BAR but no scored row this
 *  period (§1 — every metric appears). metricState is normalized_out when the metric was
 *  guardrail-suppressed, else data_unavailable. NEVER fabricates a value/score/lens. */
function synthesizeMissingMetric(
  metricKey: string,
  bs: BarSetLite | null,
  suppressionReason: string | null,
): MetricView {
  const bars: MetricBars | null = bs
    ? {
        direction: bs.direction as MetricBars["direction"],
        excellent: num(bs.excellent), good: num(bs.good), acceptable: num(bs.acceptable),
        concerning: num(bs.concerning), distress: num(bs.distress),
      }
    : null;
  const metricState: MetricState = suppressionReason ? "normalized_out" : bars ? "data_unavailable" : "no_bar";
  return {
    metricKey,
    label: canonicalMetric(metricKey)?.label ?? metricKey,
    rawValue: null,
    l1Score: null, l2Score: null, l3Score: null, metricScore: null,
    l1Band: null,
    scoreState: suppressionReason ? "suppressed" : "missing_renorm",
    nominalWeight: 0, effectiveWeight: 0, contribution: 0,
    suppressionReason,
    bars,
    peer: null,
    metricState,
    l2Available: false, l3Available: false, l3WindowN: null,
    lensFallbackApplied: "none",
    lens: null,
    lensPattern: null,
    bandLadder: bars ? { ...bars, activeBand: null } : null,
    peerDistribution: null,
    barProvenance: toBarProvenance(bs),
  };
}

function mapMetric(
  ms: LoadedMetricScore,
  pillar: "foundation" | "momentum",
  peerFallback: PeerFallback,
  l3SeriesMap: Map<string, L3SeriesPoint[]>,
  headlines: FiredHeadline[],
  pillarSubtotal: number,
  pillarScored: boolean,
  selfSymbol: string,
  peerValues: Map<string, { symbol: string; value: number }[]>,
): MetricView {
  // ── bars (from metricBarSet FK) ───────────────────────────────────────────
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

  // ── peer stats (FK first, natural-key fallback, then usability guard) ─────
  const peerSrc = ms.peerStats ?? peerFallback.get(ms.metricKey) ?? null;
  const peer = toPeerStats(peerSrc);

  // ── metricState discriminant ──────────────────────────────────────────────
  const metricState = deriveMetricState(ms, peer);

  // ── lens atom + triplet + lensPattern ────────────────────────────────────
  const atom = toAtom(ms, pillar, peerSrc);
  const acceptableBar = ms.metricBarSet ? num(ms.metricBarSet.acceptable) : null;
  const lensReads = toLensReads(atom, acceptableBar);
  const l3Series = l3SeriesMap.get(ms.metricKey) ?? [];

  // LM pattern: only on scored metrics. LM8 needs pillar anti-mask check.
  let lensPatternOut: MetricLensPattern | null = null;
  if (ms.scoreState === "scored") {
    const triplet = deriveLensTriplet(atom);
    const pillarReadsAcceptable =
      pillarScored && pillarSubtotal >= STEADY_EQUIVALENT_MIN;
    const fired = computeLensPattern(triplet.l1, triplet.l2, triplet.l3, {
      pillarReadsAcceptable,
    });
    if (fired) {
      const adc = applyAntiDoubleCount(fired, pillar, headlines);
      lensPatternOut = {
        id: fired.id,
        label: fired.label,
        tone: fired.tone,
        fieldVerdict: fired.fieldVerdict,
        role: adc.role,
      };
    }
  }

  // ── bandLadder (5 cuts + active band) ────────────────────────────────────
  const bandLadder: BandLadder | null = ms.metricBarSet
    ? {
        direction: ms.metricBarSet.direction as MetricBars["direction"],
        excellent: num(ms.metricBarSet.excellent),
        good: num(ms.metricBarSet.good),
        acceptable: num(ms.metricBarSet.acceptable),
        concerning: num(ms.metricBarSet.concerning),
        distress: num(ms.metricBarSet.distress),
        activeBand: (ms.l1Band as MetricView["l1Band"]) ?? null,
      }
    : null;

  return {
    metricKey: ms.metricKey,
    label: canonicalMetric(ms.metricKey)?.label ?? ms.metricKey,
    rawValue: num(ms.rawValue),
    l1Score: numN(ms.l1Score),
    l2Score: numN(ms.l2Score),
    l3Score: numN(ms.l3Score),
    metricScore: ms.scoreState === "scored" ? num(ms.metricScore) : null,
    l1Band: (ms.l1Band as MetricView["l1Band"]) ?? null,
    scoreState: ms.scoreState as MetricView["scoreState"],
    nominalWeight: num(ms.nominalWeight),
    effectiveWeight: num(ms.effectiveWeight),
    contribution: num(ms.contribution),
    suppressionReason: null, // filled below from SuppressionDirective when applicable
    bars,
    peer,
    // ── S2 fields ────────────────────────────────────────────────────────────
    metricState,
    l2Available: ms.l2Available,
    l3Available: ms.l3Available,
    l3WindowN: ms.l3WindowN ?? null,
    lensFallbackApplied: ms.lensFallbackApplied ?? "none",
    lens: {
      l1: lensReads.l1,
      l2: lensReads.l2,
      l3: { ...lensReads.l3, series: l3Series },
    },
    lensPattern: lensPatternOut,
    bandLadder,
    peerDistribution: toPeerDistribution(
      ms.metricKey,
      ms.rawValue === null ? null : num(ms.rawValue),
      selfSymbol,
      peer,
      (ms.metricBarSet?.direction as EngineBarDirection) ?? null,
      peerValues,
    ),
    barProvenance: toBarProvenance(ms.metricBarSet),
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
    // Pond mask (File 1 §5) — PG-level heat stamped on this snapshot. null ⇒ not established /
    // pre-stamp ⇒ the read layer treats as no-mask. isHot is the boolean the §5 cards consume.
    pondMask: snap.maskHeat
      ? {
          heat: snap.maskHeat as "hot" | "warm" | "calm",
          isHot: snap.maskHeat === "hot",
          trailingMovePct: numN(snap.pgTrailingMovePct),
        }
      : null,
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

  // ── §1 full pillar metric set + §2.3 per-metric peer cross-section ───────────────
  // The bar-set keys for this snapshot's barPath ARE the PG's scored metric universe; a
  // key with NO scored row is an honest-empty (non-scored) metric we still surface (§1).
  // The per-metric member values feed the modal's peer-field visual (§2.3).
  const barSetRows = await prisma.metricBarSet.findMany({
    where: { barPath: snap.barPath },
    select: {
      metricKey: true, direction: true, excellent: true, good: true, acceptable: true,
      concerning: true, distress: true, inForceFrom: true, barPath: true, inheritsFromPeerGroupId: true,
    },
  });
  const barSetByKey = new Map<string, (typeof barSetRows)[number]>();
  for (const bs of barSetRows) {
    const cur = barSetByKey.get(bs.metricKey);
    if (!cur || bs.inForceFrom > cur.inForceFrom) barSetByKey.set(bs.metricKey, bs); // latest in-force per key
  }
  const expectedKeysByPillar = new Map<"foundation" | "momentum", string[]>([["foundation", []], ["momentum", []]]);
  for (const key of barSetByKey.keys()) {
    const pl = canonicalMetric(key)?.pillar;
    if (pl === "foundation" || pl === "momentum") expectedKeysByPillar.get(pl)!.push(key);
  }
  const peerMetricValues = await getPeerMetricValues(snap.peerGroupId, snap.periodKey);

  // ── L3 series for per-metric sparklines (F+M only) ───────────────────────────────
  // Load rawValue per metric across the in-force series window, then bucket by metricKey.
  // This uses the SAME supersede-aware ref list that the composite series uses, so point-
  // in-time correctness is guaranteed. One extra query per view (indexed by stockId+pillar).
  const seriesRefs = await getInForceSeriesRefs(stock.id, windowQuarters);
  // Build L3 series (per-metric sparkline) for Foundation + Momentum.
  const l3SeriesFoundation = new Map<string, L3SeriesPoint[]>();
  const l3SeriesMomentum = new Map<string, L3SeriesPoint[]>();

  if (seriesRefs.length > 0) {
    // Load all in-window snapshots' pillarScoreIds for foundation + momentum.
    const windowSnapshots = await prisma.scoreSnapshot.findMany({
      where: { id: { in: seriesRefs.map((r) => r.id) } },
      select: {
        periodKey: true,
        asOfDate: true,
        foundationPillarId: true,
        momentumPillarId: true,
      },
    });

    // Collect all unique pillarScore IDs per pillar type.
    const fPillarIds = [...new Set(windowSnapshots.map((s) => s.foundationPillarId).filter(Boolean))] as string[];
    const mPillarIds = [...new Set(windowSnapshots.map((s) => s.momentumPillarId).filter(Boolean))] as string[];

    // pillarScoreId → (periodKey, asOfDate) via snapshot rows.
    const pillarToMeta = new Map<string, { periodKey: string; asOfDate: Date }>();
    for (const s of windowSnapshots) {
      if (s.foundationPillarId) pillarToMeta.set(s.foundationPillarId, { periodKey: s.periodKey, asOfDate: s.asOfDate });
      if (s.momentumPillarId) pillarToMeta.set(s.momentumPillarId, { periodKey: s.periodKey, asOfDate: s.asOfDate });
    }

    // One bulk query per pillar type for rawValue across all window periods.
    const fMetricRows = fPillarIds.length
      ? await prisma.metricScore.findMany({
          where: { pillarScoreId: { in: fPillarIds } },
          select: { pillarScoreId: true, metricKey: true, rawValue: true },
        })
      : [];
    const mMetricRows = mPillarIds.length
      ? await prisma.metricScore.findMany({
          where: { pillarScoreId: { in: mPillarIds } },
          select: { pillarScoreId: true, metricKey: true, rawValue: true },
        })
      : [];

    function buildL3Map(
      rows: { pillarScoreId: string; metricKey: string; rawValue: unknown }[],
    ): Map<string, L3SeriesPoint[]> {
      const out = new Map<string, L3SeriesPoint[]>();
      for (const r of rows) {
        const meta = pillarToMeta.get(r.pillarScoreId);
        if (!meta) continue;
        const pt: L3SeriesPoint = {
          periodKey: meta.periodKey,
          asOfDate: ymd(meta.asOfDate),
          rawValue: num(r.rawValue),
        };
        const arr = out.get(r.metricKey) ?? [];
        arr.push(pt);
        out.set(r.metricKey, arr);
      }
      // Sort oldest → newest within each metric.
      for (const pts of out.values()) {
        pts.sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
      }
      return out;
    }

    const builtF = buildL3Map(fMetricRows);
    const builtM = buildL3Map(mMetricRows);
    for (const [k, v] of builtF) l3SeriesFoundation.set(k, v);
    for (const [k, v] of builtM) l3SeriesMomentum.set(k, v);
  }

  // ── fired headlines for anti-double-count ────────────────────────────────────────
  const firedHeadlines: FiredHeadline[] = snap.patterns.map((p) => {
    const ev = p.evidence as { leg?: string } | null;
    return { patternKey: p.patternKey, leg: ev?.leg ?? null };
  });

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

  const fmMetrics = (
    p: LoadedSnapshot["foundationPillar"],
    pillarKey: "foundation" | "momentum",
    l3SeriesMap: Map<string, L3SeriesPoint[]>,
  ): MetricView[] => {
    const pillarSubtotal = num(p.subtotal);
    const pillarScored = p.pillarState === "scored";
    const scored = p.metricScores
      .map((ms) =>
        mapMetric(ms, pillarKey, peerFallback, l3SeriesMap, firedHeadlines, pillarSubtotal, pillarScored, stock.symbol, peerMetricValues),
      )
      .map((m) => ({ ...m, suppressionReason: suppressionByMetric.get(m.metricKey) ?? null }));
    // §1 EVERY METRIC: synthesize honest-empty rows for the pillar's bar-set keys that
    // produced NO scored row this period (data unavailable / guardrail-suppressed). Never
    // hidden, never fabricated — null value + the dashed-track bandLadder + a reason.
    const scoredKeys = new Set(scored.map((m) => m.metricKey));
    const missing = (expectedKeysByPillar.get(pillarKey) ?? []).filter((k) => !scoredKeys.has(k));
    const synthesized = missing.map((k) =>
      synthesizeMissingMetric(k, barSetByKey.get(k) ?? null, suppressionByMetric.get(k) ?? null),
    );
    return [...scored, ...synthesized].sort((a, b) => a.metricKey.localeCompare(b.metricKey));
  };

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
    let metrics: MetricView[] | null = null;
    let lensPillarPatterns: PillarLensPattern[] | null = null;
    let lensShares: PillarLensShares | null = null;

    if (pillar === "foundation") {
      metrics = fmMetrics(snap.foundationPillar, "foundation", l3SeriesFoundation);
      // LP roll-up over scored metrics (the primitive reads the atom, we build atoms here).
      const atoms = snap.foundationPillar.metricScores.map((ms) =>
        toAtom(ms, "foundation", ms.peerStats ?? peerFallback.get(ms.metricKey) ?? null),
      );
      const lpResult = computeLensPillarPattern(atoms);
      lensShares = lpResult.shares as PillarLensShares;
      lensPillarPatterns = lpResult.patterns.map((p) => {
        const adc = applyAntiDoubleCountPillar(p, "foundation", firedHeadlines);
        return { id: p.id, label: p.label, tone: p.tone, fieldVerdict: p.fieldVerdict, role: adc.role };
      });
    } else if (pillar === "momentum") {
      metrics = fmMetrics(snap.momentumPillar, "momentum", l3SeriesMomentum);
      const atoms = snap.momentumPillar.metricScores.map((ms) =>
        toAtom(ms, "momentum", ms.peerStats ?? peerFallback.get(ms.metricKey) ?? null),
      );
      const lpResult = computeLensPillarPattern(atoms);
      lensShares = lpResult.shares as PillarLensShares;
      lensPillarPatterns = lpResult.patterns.map((p) => {
        const adc = applyAntiDoubleCountPillar(p, "momentum", firedHeadlines);
        return { id: p.id, label: p.label, tone: p.tone, fieldVerdict: p.fieldVerdict, role: adc.role };
      });
    }

    const base: PillarView = {
      pillar,
      subtotal: subtotalOf[pillar],
      state: stateOf[pillar] as PillarView["state"],
      nominalWeight: PILLAR_WEIGHTS[pillar],
      appliedWeight: applied[pillar],
      nativeZone: nativeZone(pillar, subtotalOf[pillar], stateOf[pillar]),
      metrics,
      marketSubs: pillar === "market" ? marketSubs : null,
      ownership: pillar === "ownership" ? ownershipDetail : null,
      lensPillarPatterns,
      lensShares,
    };
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

  // ── daily sub-quarterly series (one point per calendar day, trailing window) ──
  // Exposes the intra-quarter Market/Ownership recomputes stored as successive
  // versions. Fetch a wide (~13-month) window so the client can serve every daily
  // timeframe (60/30/15D) AND an arbitrary custom date-range purely client-side by
  // slicing; the range is honestly bounded by whatever retention actually holds.
  // Empty when the stock has no daily version history yet.
  const dailyRaw = await getDailySnapshotSeries(stock.id, 400);
  const dailySeries: DailyTrajectoryPoint[] = dailyRaw.map((p) => ({
    asOfDate: ymd(p.asOfDate),
    periodKey: p.periodKey,
    composite: p.composite,
    labelBand: p.labelBand as LabelBand,
    foundation: p.foundationSubtotal,
    momentum: p.momentumSubtotal,
    market: p.marketSubtotal,
    ownership: p.ownershipSubtotal,
  }));

  // Result-days = periodKey transitions between consecutive daily points (the day a
  // new quarter's rescore stepped all four pillars). Explains the F/M step on the chart.
  const resultDays: ResultDayMarker[] = [];
  for (let i = 1; i < dailySeries.length; i++) {
    if (dailySeries[i].periodKey !== dailySeries[i - 1].periodKey) {
      resultDays.push({ asOfDate: dailySeries[i].asOfDate, periodKey: dailySeries[i].periodKey });
    }
  }

  const trajectory: HealthSnapshotView["trajectory"] = {
    windowQuarters,
    series: seriesView,
    dailySeries,
    resultDays,
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
      displayState: (p.displayState ?? "active") as PatternView["displayState"],
      magnitude: numN(p.magnitude),
      evidence: p.evidence ?? null,
      metricRefs: p.metricRefs ?? null,
    }))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const findings: HealthSnapshotView["findings"] = { redFlags, patterns };

  // ── peer standing (rank within PG by composite at this period) ──
  const peerStanding = pg
    ? buildPeerStanding(pg.id, snap.periodKey, stock.id, await getPeerSiblings(pg.id, snap.periodKey))
    : null;

  // ── S3.5 rank second-check (read-layer; rank/N only, NO z-score) ──────────────
  // CONFIRMATION ONLY: the triplet already FIRED each pattern above; here we attach the
  // absolute standing band + a standing-reconciled display `verdict` so the field-line /
  // pillar-verdict wording can never contradict the stock's rank in its PG (e.g. an LP3
  // "trails an elite field" verdict on the PG's #1 stock). Firing is byte-identical —
  // we mutate only the verdict text on the already-built pattern objects.
  for (const pv of pillars) {
    if (pv.pillar !== "foundation" && pv.pillar !== "momentum") continue;
    const rk = peerStanding?.perPillarRank?.[pv.pillar] ?? null;
    const band = rk ? standingBand(rk.rank, rk.outOf) : null;
    const ctx = rk && band ? { rank: rk.rank, n: rk.outOf, band } : null;
    for (const lp of pv.lensPillarPatterns ?? []) {
      lp.standingContext = ctx;
      lp.verdict = composeLpVerdict(lp.id, lp.fieldVerdict, band, pv.lensShares);
    }
    for (const m of pv.metrics ?? []) {
      if (!m.lensPattern) continue;
      m.lensPattern.standingContext = ctx;
      m.lensPattern.verdict = composeLmVerdict(m.lensPattern.id, m.lensPattern.fieldVerdict, band);
    }
  }

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
