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
  getDailySnapshotSeries,
  getPeerSiblings,
  getPeerMetricValues,
  // ★ THE ONE-MAP SEAM — see inForceByPeriod's note. These four replace getLatestSnapshot /
  //   getSnapshotSeries / getInForceSeriesRefs here, which each resolved that map privately and so
  //   issued the same query three times, sequentially, per view.
  inForceByPeriod,
  latestRefFrom,
  loadSnapshotProjected,
  seriesFrom,
  seriesRefsFrom,
  type ProjectedSnapshot,
} from "./scoring-read.service.js";
// ★ THE REQUEST-SCOPED READ MEMO — see db/read-memo.ts. It is opened HERE, around the whole view, so
//   the three callers that each want a slice of one stock's snapshot rows share one round-trip.
import { withReadMemo } from "../../db/read-memo.js";
// ★ THE FILING CHANNEL. Rooted at STOCK, not at ScoreSnapshot — see filing/read.ts. This is the
//   one section of this view that a stock with no snapshot can still populate.
import { readFilingFindings, type FilingFindingsSection } from "../../filing/read.js";
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
// File-1 §5 verdict sentences, rendered onto the finding rows (Stage 3 of the copy catalogue).
// Additive: the field is new, and nothing reads it until the frontend switches at Stage 5.
import { renderVerdict, composeVerdict, composeEndedVerdict } from "../findings/verdicts.js";
// ★ THE ONE NARROWING for both channels' payload columns (scoring/findings/evidence.ts). Applied
//   HERE, at the read boundary, so `RedFlagView.triggeringValues` / `PatternView.evidence` reach a
//   consumer already typed instead of `unknown` for each of them to re-narrow by hand.
import { asEvidenceBag } from "../findings/evidence.js";
import { findingName } from "../../catalogue/index.js";
import { dropRetiredPatterns } from "../../catalogue/retired-findings.js";
// ★ CHANNEL SUPPRESSION — the filing pass owns these 22 keys now, and `filingFindings` below already
//   serves them. Keyed on FILING_REGISTRY, never on a literal list; see filing/channel.ts.
import { dropFilingPatterns } from "../../filing/channel.js";
// ★ RETIREMENT SUPPRESSION's sibling — a persisted `notcovered_*` row (this turn's Part 2) must never
//   reach a finding-facing surface either. Same guard shape, applied at the same three boundaries.
import { dropNotCoveredPatterns, notCoveredPatternKey, isNotCoveredKey, NOT_COVERED, NOT_COVERED_SILENT_LINE } from "../../catalogue/not-covered.js";
import { pairKeyOf, isSupersededOnPair, stickyContextLine, gapDirectionOf, STICKY_KEY } from "./pair-presentation.js";
import { GAP_MATERIAL, GAP_STRETCHED } from "../findings/divergence/bands.js";
import { NATIVE_ZONES } from "../findings/thresholds.js";
import { COMPOSITE_MOVE_DEADBAND } from "./display-constants.js";
// ★ RULING 3 + the fired finding's own pair — ONE home, replacing the widest-pair derivation that
//   existed here, in universe-view, in peer-group-view and on the frontend. See that file's header.
import {
  ALIGNED_MAX,
  contextPairOf,
  firingDivergenceKeys,
  headlineOf,
  leadDivergence,
  pairOf,
  pillarSpreadOf,
} from "./divergence-headline.js";
import { isPatternKey, PATTERN_FACTS } from "../../catalogue/pattern-facts.js";
// ★ THE SAME NARROWING THE CATALOGUE ENDPOINT APPLIES — one function, so a finding row and the
//   catalogue document cannot disagree about which facts are safe to serve.
import { servedFacts } from "../../catalogue/serialise.js";
import { firedCrossingEvents } from "./fired-crossings.js";
import { notCoveredFor, type SubjectReadings } from "./not-covered.service.js";
import { forTool } from "../../catalogue/tool-families.js";
import { severityWeight } from "../../catalogue/divergence.js";
import { getRegimeByStock } from "../regime/regime.service.js";
import { REGIME_HOT_ABOVE, REGIME_STRESSED_BELOW } from "../regime/regime.js";
// Finding lifecycle — firstSeen / runLength / direction / ended+resolution, read off the append-only
// pattern history. Facts only; no sentence in this file changes because of it.
import { resolveFindingLifecycles } from "./finding-lifecycle.service.js";
import { OMITTABLE_SECTIONS } from "./health-view.types.js";
import type {
  HealthSnapshotView,
  HealthSection,
  HealthViewOptions,
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
  SectorClass,
  LabelBand,
  DivergenceView,
  DivergenceFlag,
  TrajectoryPoint,
  DailyTrajectoryPoint,
  ResultDayMarker,
  CrossingEvent,
  CrossToolSummary,
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
// ★ NATIVE_MARKS WAS A VERBATIM SECOND TRANSCRIPTION OF NATIVE_ZONES (findings/thresholds.ts) — the
// same four pairs of numbers the pattern RECORDS are themselves derived from, in a third home that no
// rule ever read. A copy nothing reads is the one that can drift for a whole release without a single
// finding changing. Projected from the one home instead; the shape is kept because two call sites
// below want {lower, upper} rather than {weak, strong}.
const NATIVE_MARKS: Record<PillarKey, { lower: number; upper: number }> = {
  foundation: { lower: NATIVE_ZONES.foundation.weak, upper: NATIVE_ZONES.foundation.strong },
  momentum: { lower: NATIVE_ZONES.momentum.weak, upper: NATIVE_ZONES.momentum.strong },
  market: { lower: NATIVE_ZONES.market.weak, upper: NATIVE_ZONES.market.strong },
  ownership: { lower: NATIVE_ZONES.ownership.weak, upper: NATIVE_ZONES.ownership.strong },
};
/** The same four pairs on the TRAJECTORY block — see TrajectorySection.pillarZones for why a
 *  section that already ships `pillars[].nativeZone` carries them a second time. Projected from
 *  NATIVE_ZONES, never re-typed, so the two can only ever say one thing. */
const PILLAR_ZONES: Record<PillarKey, { weak: number; strong: number }> = {
  foundation: { weak: NATIVE_ZONES.foundation.weak, strong: NATIVE_ZONES.foundation.strong },
  momentum: { weak: NATIVE_ZONES.momentum.weak, strong: NATIVE_ZONES.momentum.strong },
  market: { weak: NATIVE_ZONES.market.weak, strong: NATIVE_ZONES.market.strong },
  ownership: { weak: NATIVE_ZONES.ownership.weak, strong: NATIVE_ZONES.ownership.strong },
};
// ★ PHASE 4 — the local 15/25 pair is GONE. These now come from the ONE place the divergence family
//   declares its bands (findings/divergence/bands.ts §1.1), so this view can no longer disagree with
//   the engine. It used to: the engine's material cut moved to 12 in Phase 2 while this file kept
//   calling 15 "notable", so a stock could carry divergence_S2 (gap 13) and read "none" here.
//   `notable` = the MATERIAL band (≥12) · `wide` = STRETCHED and above (≥16).
//   ⚠ This is a SPREAD DESCRIPTOR for display (which two pillars, how far apart), not a pattern
//   claim — the patterns are the fired D-family findings. Do not re-derive a pattern from it.
const DIVERGENCE_NOTABLE = GAP_MATERIAL;
const DIVERGENCE_WIDE = GAP_STRETCHED;
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

/**
 * ★ THE LOADED ROW IS A UNION NOW, AND THAT IS THE POINT.
 *
 * `ProjectedSnapshot` is `full | lean`, discriminated on `pillarDetail`. Every field this file reads
 * off the snapshot ROW (composite, subtotals, weights, band, mask) and every pillar's `pillarState`
 * live on both arms and need no narrowing. The METRIC GRAPH — `metricScores`, `marketSubScores`,
 * `ownershipScore` — exists only on the full arm, so touching it without first narrowing on
 * `snap.pillarDetail` does not compile. See `loadSnapshotProjected` for why the alternative
 * (an empty array standing in for "not fetched") was rejected.
 *
 * `FullSnapshot` is the narrowed arm, and it is what the metric-graph mappers below take as their
 * parameter type — so those mappers are unreachable from a lean load by construction rather than by
 * a convention someone has to remember.
 */
type LoadedSnapshot = ProjectedSnapshot;
type FullSnapshot = Extract<ProjectedSnapshot, { pillarDetail: true }>;
type LoadedMetricScore = FullSnapshot["foundationPillar"]["metricScores"][number];

/** One row of the identity join — the stock and its (optional) sector, in one trip. Enums come back
 *  as text because the driver has no mapping for a Postgres enum; both are compared as strings
 *  downstream, exactly as the Prisma-typed values were. */
interface StockIdentityRow {
  id: string;
  symbol: string;
  name: string;
  industry_type: string;
  sector_name: string | null;
  sector_display_name: string | null;
  /** ⚠ TYPED AS THE VIEW'S OWN UNION, AND THAT IS EXACT rather than convenient: the column is the
   *  `SectorClass` Postgres enum, whose six members ARE this union's non-null members, or NULL —
   *  which the union also carries. A `string` here would push the widening onto the identity block. */
  sector_class: SectorClass;
}

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
    // ★ null, never 0 — an unmeasured metric did not contribute nothing (§3.6, resolver #5).
    nominalWeight: null, effectiveWeight: null, contribution: null,
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
    // Gated on scoreState exactly as `metricScore` two lines above is — one rule, applied to every
    // field that is meaningless unless the metric scored.
    nominalWeight: ms.scoreState === "scored" ? num(ms.nominalWeight) : null,
    effectiveWeight: ms.scoreState === "scored" ? num(ms.effectiveWeight) : null,
    contribution: ms.scoreState === "scored" ? num(ms.contribution) : null,
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
export function buildHealthSnapshotView(
  symbolRaw: string,
  windowQuarters = 12,
  opts: HealthViewOptions = {},
): Promise<HealthSnapshotView | null> {
  // ★ ONE MEMO SCOPE PER VIEW. Everything below — including the services it awaits — shares one
  //   store, so a question asked by three call sites costs one round-trip. The scope ends when this
  //   promise settles; nothing survives the request, which is why there is no invalidation problem to
  //   have. See db/read-memo.ts.
  return withReadMemo(() => buildHealthSnapshotViewInScope(symbolRaw, windowQuarters, opts));
}

async function buildHealthSnapshotViewInScope(
  symbolRaw: string,
  windowQuarters = 12,
  opts: HealthViewOptions = {},
): Promise<HealthSnapshotView | null> {
  const symbol = symbolRaw.toUpperCase();

  // ★ THE PROJECTION, RESOLVED ONCE. `omitted` is what the response will DECLARE, and it is derived
  //   by intersecting the request with the omittable set — so an unknown token cannot silently
  //   change the payload, and what the caller asked for is never assumed to be what it got.
  const omitted: HealthSection[] = OMITTABLE_SECTIONS.filter((s) => opts.omit?.includes(s));
  const wantPillars = !omitted.includes("pillars");
  const wantPeerStanding = !omitted.includes("peerStanding");

  // ── ★ IDENTITY IN ONE ROUND-TRIP, NOT TWO. ────────────────────────────────────────────────────
  //
  // This was `stock.findUnique` with a nested `sector` select — one Prisma call, and TWO statements.
  // A to-one relation reached through `select` is a second query for Prisma, not a SQL join, so the
  // read opened with `stocks` and then `sectors`, each a wave of exactly one statement. On the
  // measured profile those were waves 1 and 2: ~140 ms of pure latency, nothing else in flight,
  // nothing to overlap them with. A LEFT JOIN is the same rows in one trip — and it removes a WAVE,
  // which is what matters now that the read is chain-depth-bound rather than statement-bound.
  //
  // ⚠ LEFT, NOT INNER. `Stock.sectorId` is nullable and a stock with no sector is a real state the
  //   identity block already renders (`sector: null`). An INNER JOIN would turn that stock into a
  //   404 — the one failure mode this join could plausibly introduce, and the reason the null is
  //   reconstructed below rather than assumed away.
  //
  // ⚠ `"industryType"` IS QUOTED, AND IT IS THE ONE COLUMN HERE THAT NEEDS TO BE. Stock.industryType
  //   carries no @map, so Prisma named the column verbatim in camelCase; unquoted, Postgres folds it
  //   to industry_type and the statement fails with 42703. Every other column in this join is
  //   snake_cased by an explicit @map and needs no quoting. (Caught by running it, not by reading it.)
  const rows = await prisma.$queryRaw<StockIdentityRow[]>`
      SELECT st.id                AS id,
             st.symbol            AS symbol,
             st.name              AS name,
             st."industryType"::text AS industry_type,
             sc.name              AS sector_name,
             sc.display_name      AS sector_display_name,
             sc.sector_class::text AS sector_class
        FROM stocks st
        LEFT JOIN sectors sc ON sc.id = st.sector_id
       WHERE st.symbol = ${symbol}
       LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  // Rebuilt into the exact shape the rest of this function already reads, so nothing downstream
  // knows the join happened. `sector` is null when the LEFT JOIN found no row — never `{name: null}`.
  const stock = {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    industryType: row.industry_type,
    sector:
      row.sector_name !== null
        ? { name: row.sector_name, displayName: row.sector_display_name!, sectorClass: row.sector_class }
        : null,
  };

  // ══ LAYER 1 ══ everything that needs nothing but `stock.id`.
  //
  // ★ `inForceByPeriod` IS RESOLVED ONCE HERE AND FEEDS THREE ANSWERS. It used to be issued three
  //   times per view — privately, inside getLatestSnapshot, getSnapshotSeries and
  //   getInForceSeriesRefs — as three sequential round-trips for one unchanging fact. The head ref,
  //   the plotted series and the L3 window all come off this single map now.
  //
  // ⚠ COVERAGE IS NOT READ HERE ANY MORE, AND THE PAYLOAD DID NOT CHANGE. `resolveCoverage` queried
  //   score_stock_states — 0 rows, no writer, dropped 2026-08-09 — so `coverage` was ALWAYS null and
  //   both identity fields below have always serialised as null. They are written as literal nulls
  //   now rather than removed: the wire shape (and every consumer's fallback copy) is byte-identical,
  //   one round-trip per view is gone, and the honest derivation already exists in
  //   src/relational/coverage.ts for whoever wires it in. Do NOT re-point these at that derivation as
  //   a drive-by — it returns a DIFFERENT vocabulary and would change what four surfaces render.
  const [spg, byPeriod, filingBy] = await Promise.all([
    prisma.stockPeerGroup.findFirst({
      where: { stockId: stock.id },
      select: { peerGroup: { select: { id: true, name: true, displayName: true, stockCount: true } } },
    }),
    inForceByPeriod(stock.id),
    // ★ RESOLVED IN LAYER 1, BEFORE THE `!ref` GUARD. That position is the whole point: every read
    //   below this line is snapshot-derived and unreachable for 409 of 504 stocks, so a filing
    //   channel resolved after the guard would be a filing channel that never runs for the stocks
    //   that have nothing else. One indexed query on (stock_id, period_end DESC).
    readFilingFindings([stock.id]),
  ]);
  const pg = spg?.peerGroup ?? null;
  const ref = latestRefFrom(byPeriod);
  const filingFindings: FilingFindingsSection | null = filingBy.get(stock.id) ?? null;

  // ── NOT-SCORED branch: identity + coverage only, every snapshot section null ──
  // ⚠ `pillars: []` HERE IS A REAL EMPTY, NOT AN OMISSION — the stock has no pillars because it has
  //   no snapshot. `omitted` still reports what the caller asked to drop, so the two facts stay
  //   distinguishable even on this branch.
  const notScored = (): HealthSnapshotView => ({
    scored: false,
    identity: {
      id: stock.id,
      symbol: stock.symbol,
      name: stock.name,
      sector: stock.sector ? { key: stock.sector.name, displayName: stock.sector.displayName } : null,
      sectorClass: stock.sector?.sectorClass ?? null,
      industryPath: stock.industryType === "banking" ? "banking" : "non_financial",
      peerGroup: pg ? { id: pg.id, name: pg.name, displayName: pg.displayName, memberCount: pg.stockCount } : null,
      coverageState: null, // score_stock_states is gone — see the note at the coverage read above
      coverageReason: null,
      asOfDate: "",
      periodKey: "",
    },
    verdict: null,
    pillars: [],
    trajectory: null,
    // ⚠ STILL NULL, AND STILL CORRECT. `findings` is the SCORE findings section — divergences,
    //   trajectories, composition. Every one of them is a statement about a reading this stock does
    //   not have, so null is the honest answer and the boundary stays exactly where it was.
    findings: null,
    // ★ THE ONE SECTION THAT OPENS. A filing finding is about what the company FILED — promoter
    //   pledging, an earnings-quality run, receivables outpacing revenue — and is true whether or not
    //   anyone ever computed a Health Score. 409 stocks reach only this branch; before this line they
    //   rendered as though we had nothing to say about any of them.
    filingFindings,
    peerStanding: null,
    // The regime is a SECTOR fact and is resolvable for an unscored stock, but this branch returns
    // nothing snapshot-derived at all; a badge with no reading beside it has nothing to qualify.
    regime: null,
    omitted,
  });
  if (!ref) return notScored();

  // ══ LAYER 2 ══ the snapshot row, and everything keyed only by `stock.id` or the resolved ref.
  //
  // Every one of these used to be its own sequential await; not one of them depends on another's
  // result. The gated entries are the projection's: with `pillars` omitted, the suppression lookup
  // and the L3 window read are not issued at all.
  const seriesRefs = wantPillars ? seriesRefsFrom(byPeriod, windowQuarters) : [];
  const [snap, series, dailyRaw, regimeByStock, lifecycles, suppressions, windowSnapshots, peerSiblings] =
    await Promise.all([
      // ★ THE PROJECTION REACHES THE LOADER. `wantPillars` decides the SHAPE, not just which extra
      //   queries are skipped: a pillars-omitted read no longer walks the metric graph at all.
      loadSnapshotProjected(ref.id, wantPillars),
      seriesFrom(byPeriod, windowQuarters),
      getDailySnapshotSeries(stock.id, 400),
      getRegimeByStock([stock.id]),
      // `ref.periodKey` IS `snap.periodKey` — same row — so the lifecycle walk no longer waits for
      // the snapshot's relation graph to load before it can start.
      resolveFindingLifecycles(stock.id, ref.periodKey),
      wantPillars
        ? prisma.suppressionDirective.findMany({
            where: { stockId: stock.id, snapshotKey: ref.periodKey },
            select: { metricKey: true, outcome: true },
          })
        : Promise.resolve([] as { metricKey: string; outcome: string }[]),
      seriesRefs.length
        ? prisma.scoreSnapshot.findMany({
            where: { id: { in: seriesRefs.map((r) => r.id) } },
            select: { periodKey: true, asOfDate: true, foundationPillarId: true, momentumPillarId: true },
          })
        : Promise.resolve([] as { periodKey: string; asOfDate: Date; foundationPillarId: string | null; momentumPillarId: string | null }[]),
      pg && wantPeerStanding
        ? getPeerSiblings(pg.id, ref.periodKey)
        : Promise.resolve(null),
    ]);
  // A ref that resolves to no row is not reachable in practice (same transaction-visible id), but the
  // branch is kept rather than asserted — an absent row is the not-scored answer, not a crash.
  if (!snap) return notScored();

  // ── identity ──
  const identity: HealthSnapshotView["identity"] = {
    id: stock.id,
    symbol: stock.symbol,
    name: stock.name,
    sector: stock.sector ? { key: stock.sector.name, displayName: stock.sector.displayName } : null,
    sectorClass: stock.sector?.sectorClass ?? null,
    industryPath: snap.industryPath === "banking" ? "banking" : "non_financial",
    peerGroup: pg ? { id: pg.id, name: pg.name, displayName: pg.displayName, memberCount: pg.stockCount } : null,
    coverageState: null, // score_stock_states is gone — see the note at the coverage read above
    coverageReason: null,
    asOfDate: ymd(snap.asOfDate),
    periodKey: snap.periodKey,
  };

  // ── trajectory marker (needs ≥2 in-force snapshots; `series` came off layer 2) ──
  let trajectoryMarker: TrajectoryMarker | null = null;
  let trajectoryDelta: number | null = null;
  if (series.length >= 2) {
    const last = series[series.length - 1].composite;
    const prev = series[series.length - 2].composite;
    trajectoryDelta = Math.round((last - prev) * 1e4) / 1e4;
    trajectoryMarker =
      trajectoryDelta > COMPOSITE_MOVE_DEADBAND ? "improving" : trajectoryDelta < -COMPOSITE_MOVE_DEADBAND ? "deteriorating" : "stable";
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

  // ── divergence: RULING 3's headline state + the LEAD FINDING'S OWN PAIR ──────────────────────────
  //
  // ★ THE WIDEST-PAIR DERIVATION IS GONE. It sorted the four scored subtotals, took the extremes, and
  //   banded the distance at 15/25 — producing a pair chosen with no reference to which pair any fired
  //   finding is actually about, and a third severity scale alongside §1.2's and S1's. IOC is the
  //   case: it fires S2 on Foundation↔Momentum while its widest pair is Foundation↔Market, so the
  //   chart and the prose on one card named different pillars. The same block existed, independently,
  //   in universe-view and peer-group-view.
  //
  //   What remains here is S1's arithmetic and nothing else: the spread, its ceiling, and the
  //   three-way state that ceiling decides. The PAIR now comes from the fired finding's own record.
  const spread = pillarSpreadOf(scoredPillarSubtotals);
  const liveRows = dropNotCoveredPatterns(dropRetiredPatterns(snap.patterns));
  const lead = leadDivergence(liveRows);
  const headline = headlineOf(spread, firingDivergenceKeys(liveRows));
  const divergence: DivergenceView = {
    headline,
    spread,
    alignedMax: ALIGNED_MAX,
    pair: lead ? pairOf(lead.patternKey, scoredPillarSubtotals) : null,
    // ★ THE CONTEXT PAIR, AND THE ONE CONDITION THAT MAKES IT SAFE. `spread`'s two pillars, named —
    //   but ONLY in the states where no finding names a pair of its own, so the widest pair can never
    //   appear beside a finding about a different one (the IOC bug, four services deep). The ternary
    //   IS the guarantee; see DivergenceView.contextPair and contextPairOf's own header.
    contextPair: headline === "patterns_firing" ? null : contextPairOf(scoredPillarSubtotals),
    storedScalar: num(snap.divergence),
  };

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

  // ══ LAYER 3 ══ the reads that genuinely could not start earlier: they need a field off the
  // snapshot row (peerGroupId / barPath / asOfDate) or the plotted series, both of which land in
  // layer 2. Under the projection, only the two trajectory reads remain.
  //
  //   peerStats / barSets / peerMetricValues   need snap.peerGroupId · snap.barPath — pillars only
  //   l3 metric rows                           need the pillar ids off the L2 window — pillars only
  //   crossings / corporate events             need the plotted series' periodKeys and span
  const fPillarIds = [...new Set(windowSnapshots.map((s) => s.foundationPillarId).filter(Boolean))] as string[];
  const mPillarIds = [...new Set(windowSnapshots.map((s) => s.momentumPillarId).filter(Boolean))] as string[];
  const seriesPeriodKeys = series.map((p) => p.periodKey);
  const latestAsOf = series.length ? series[series.length - 1].asOfDate : snap.asOfDate;
  const earliestAsOf =
    series.length > 1
      ? series[0].asOfDate
      : new Date(latestAsOf.getTime() - windowQuarters * 92 * 24 * 3600 * 1000);

  const [peerStatsRows, barSetRows, peerMetricValues, fMetricRows, mMetricRows, firedCrossings, eventRows] =
    await Promise.all([
      // peer-stats natural-key fallback (for MetricScores written before the FK existed) — one
      // indexed lookup by (peerGroupId, asOfDate), the period's whole cross-section. New scores
      // carry the FK directly and skip this; backfilled rows resolve here. Read-only, never a write.
      wantPillars
        ? prisma.peerStatsSnapshot.findMany({
            where: { peerGroupId: snap.peerGroupId, asOfDate: snap.asOfDate },
            select: { metricKey: true, mean: true, stdDev: true, sampleN: true },
          })
        : Promise.resolve([] as { metricKey: string; mean: unknown; stdDev: unknown; sampleN: number }[]),
      // §1 full pillar metric set — the bar-set keys for this barPath ARE the PG's scored metric
      // universe; a key with NO scored row is an honest-empty metric we still surface.
      wantPillars
        ? prisma.metricBarSet.findMany({
            where: { barPath: snap.barPath },
            select: {
              metricKey: true, direction: true, excellent: true, good: true, acceptable: true,
              concerning: true, distress: true, inForceFrom: true, barPath: true, inheritsFromPeerGroupId: true,
            },
          })
        : Promise.resolve(
            [] as {
              metricKey: string; direction: string; excellent: unknown; good: unknown; acceptable: unknown;
              concerning: unknown; distress: unknown; inForceFrom: Date; barPath: string;
              inheritsFromPeerGroupId: string | null;
            }[],
          ),
      // §2.3 per-metric peer cross-section — the modal's peer-field visual.
      wantPillars ? getPeerMetricValues(snap.peerGroupId, snap.periodKey) : Promise.resolve(new Map()),
      // L3 per-metric rawValue across the window, one bulk query per pillar type.
      fPillarIds.length
        ? prisma.metricScore.findMany({
            where: { pillarScoreId: { in: fPillarIds } },
            select: { pillarScoreId: true, metricKey: true, rawValue: true },
          })
        : Promise.resolve([] as { pillarScoreId: string; metricKey: string; rawValue: unknown }[]),
      mPillarIds.length
        ? prisma.metricScore.findMany({
            where: { pillarScoreId: { in: mPillarIds } },
            select: { pillarScoreId: true, metricKey: true, rawValue: true },
          })
        : Promise.resolve([] as { pillarScoreId: string; metricKey: string; rawValue: unknown }[]),
      // The pillar-zone crossings a T-pattern ACTUALLY fired, across the window.
      firedCrossingEvents(stock.id, seriesPeriodKeys),
      prisma.corporateEvent.findMany({
        where: { stockId: stock.id, eventDate: { gte: earliestAsOf, lte: latestAsOf } },
        orderBy: { eventDate: "asc" },
        select: { eventType: true, eventDate: true, description: true, impactLevel: true },
      }),
    ]);

  const suppressionByMetric = new Map(suppressions.map((s) => [s.metricKey, `guardrail ${s.outcome}`]));
  const peerFallback: PeerFallback = new Map(
    peerStatsRows.map((r) => [r.metricKey, { mean: r.mean, stdDev: r.stdDev, sampleN: r.sampleN }]),
  );
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
  // ── L3 series for per-metric sparklines (F+M only) ───────────────────────────────
  // Bucket the window's per-metric rawValues (fetched in layer 3) by metricKey. The window refs are
  // the SAME supersede-aware list the composite series uses, so point-in-time correctness holds.
  const l3SeriesFoundation = new Map<string, L3SeriesPoint[]>();
  const l3SeriesMomentum = new Map<string, L3SeriesPoint[]>();

  if (windowSnapshots.length > 0) {
    // pillarScoreId → (periodKey, asOfDate) via snapshot rows.
    const pillarToMeta = new Map<string, { periodKey: string; asOfDate: Date }>();
    for (const s of windowSnapshots) {
      if (s.foundationPillarId) pillarToMeta.set(s.foundationPillarId, { periodKey: s.periodKey, asOfDate: s.asOfDate });
      if (s.momentumPillarId) pillarToMeta.set(s.momentumPillarId, { periodKey: s.periodKey, asOfDate: s.asOfDate });
    }

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
  // Retired keys are dropped here too: anti-double-count suppresses a lens pattern when a headline
  // covers the same ground, and a RETIRED headline must not go on suppressing a live lens read.
  const firedHeadlines: FiredHeadline[] = dropNotCoveredPatterns(dropRetiredPatterns(snap.patterns)).map((p) => {
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

  // ★ THE PARAMETER TYPE IS THE NARROWED ARM. A lean pillar row has no `metricScores`, so it cannot
  //   be passed here at all — the guarantee is the signature, not a comment.
  const fmMetrics = (
    p: FullSnapshot["foundationPillar"],
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

  // ★ MOVED BEHIND THE NARROWING, AND THIS IS THE MAPPER THE FORK FORCED. `marketSubs` and
  //   `ownershipDetail` used to be computed UNCONDITIONALLY at this level, then used only inside
  //   `pillars[]` (`marketSubs: pillar === "market" ? marketSubs : null`). On a lean load their
  //   inputs do not exist, so they are now functions the pillars branch calls — which also stops the
  //   full path building two objects it then discards on every projected read.
  const marketSubsOf = (full: FullSnapshot): MarketSubView[] =>
    full.marketPillar.marketSubScores
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

  const ownershipDetailOf = (full: FullSnapshot): OwnershipDetail | null => {
  const os = full.ownershipPillar.ownershipScore;
  return os
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
  };

  /**
   * ★ EVERY METRIC-GRAPH READ ON THIS PAGE, BEHIND ONE NARROWING.
   *
   * It takes the FULL arm, so nothing inside can be reached from a lean load and nothing inside needs
   * to re-check. The body is unchanged from when it was an inline `.map` — `snap` became `full`, and
   * the two detail blocks became the calls above.
   */
  const buildPillars = (full: FullSnapshot): PillarView[] => {
    const marketSubs = marketSubsOf(full);
    const ownershipDetail = ownershipDetailOf(full);
    return PILLARS.map((pillar) => {
    let metrics: MetricView[] | null = null;
    let lensPillarPatterns: PillarLensPattern[] | null = null;
    let lensShares: PillarLensShares | null = null;

    if (pillar === "foundation") {
      metrics = fmMetrics(full.foundationPillar, "foundation", l3SeriesFoundation);
      // LP roll-up over scored metrics (the primitive reads the atom, we build atoms here).
      const atoms = full.foundationPillar.metricScores.map((ms) =>
        toAtom(ms, "foundation", ms.peerStats ?? peerFallback.get(ms.metricKey) ?? null),
      );
      const lpResult = computeLensPillarPattern(atoms);
      lensShares = lpResult.shares as PillarLensShares;
      lensPillarPatterns = lpResult.patterns.map((p) => {
        const adc = applyAntiDoubleCountPillar(p, "foundation", firedHeadlines);
        return { id: p.id, label: p.label, tone: p.tone, fieldVerdict: p.fieldVerdict, role: adc.role };
      });
    } else if (pillar === "momentum") {
      metrics = fmMetrics(full.momentumPillar, "momentum", l3SeriesMomentum);
      const atoms = full.momentumPillar.metricScores.map((ms) =>
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
  };

  // ★ THE PROJECTION'S ONE BRANCH ON SHAPE — and now it is a TYPE branch, not a boolean one. `null` —
  //   never `[]` — because the two facts are different: `[]` is "this stock has no pillars" (the
  //   not-scored branch says exactly that) and `null` is "you did not ask for them". `omitted` on the
  //   response names which it was.
  //
  //   ⚠ THE DISCRIMINANT IS READ OFF THE LOADED ROW, NOT OFF `wantPillars`. They are the same fact —
  //     `wantPillars` is what was passed to the loader — but only the row's own flag narrows the type,
  //     and routing the branch through it is what makes "pillars were requested" and "the metric graph
  //     is present" one statement instead of two that could drift.
  const pillars: PillarView[] | null = snap.pillarDetail ? buildPillars(snap) : null;

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

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★ THE CROSSING OVERLAY — FIRED T3–T6 ROWS ONLY. The local zone derivation is DELETED.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠ WHAT WENT, AND WHY IT WAS A PATTERN FACT. The `pillar_zone` half of this loop banded each
  // pillar against NATIVE_ZONES at every period and emitted a "crossing" whenever the label changed —
  // a fifth local derivation of a pattern-defining fact, sitting on the very tool whose job is to
  // render T3–T6. It competed directly with them: it drew a Momentum zone crossing at 54 that T6 may
  // not have fired (T6 is a crossing WITH a measured directional read that the regime gates), and it
  // drew Foundation crossings at 60/72 where only the ↑60 one (T5) survived the study at all —
  // Part 5's excluded list kills Foundation ↓60 (+8.2%, "the cross arrives late") and the cross INTO
  // strong (a single +59% outlier drove it). So the overlay was, literally, drawing excluded
  // conditions beside the surviving ones with nothing marking which was which.
  //
  // ★ IT WILL READ NEAR-EMPTY UNTIL THE D/S/T FAMILY ACCUMULATES QUARTERS, AND THAT IS THE POINT.
  // The live T-family is one quarter old, so almost no historical T3–T6 rows exist yet. Honest-empty
  // over a fifth local derivation — the same call the retired coverage ceiling got.
  //
  // The BAND crossings stay: `labelBand` is the composite's own persisted band, not a pattern claim.
  const crossings: CrossingEvent[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const cur = series[i];
    if (prev.labelBand !== cur.labelBand) {
      crossings.push({ type: "band", fromPeriod: prev.periodKey, toPeriod: cur.periodKey, pillar: null, from: prev.labelBand, to: cur.labelBand });
    }
  }
  // The pillar-zone crossings a T-pattern ACTUALLY fired, read off the persisted rows across the
  // window. `crossedBelow`/`crossedAbove` is the mark the rule itself stamped; the pillar is the
  // record's own subject. Nothing here re-derives a zone.
  // (fetched in layer 3 — the event window is the series span, widened back `windowQuarters` when
  //  the series is a single point so the overlay is still meaningful; see `earliestAsOf` there)
  for (const ev of firedCrossings) crossings.push(ev);

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
  // Empty when the stock has no daily version history yet. (fetched in layer 2)
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
    pillarZones: PILLAR_ZONES,
  };

  // ── findings (raw, sorted by severity; red flags first, then patterns) ──
  // ★ RETIREMENT SUPPRESSION (boundary 1 of 9 — the stock page, and via it the chat's
  //   get-stock-facts and the AI grounding block, which both read THIS view's findings).
  //   A retired key's persisted row would otherwise render with a humanised title, a family
  //   boundary line and the fluent sentence the retired rule wrote into evidence at fire time.
  //
  // ★ THE SCORE CHANNEL FIRES NO RED FLAGS, AND THIS ARRAY SAYS SO — 2026-08-11.
  //
  // It used to read `snap.redFlags` through two suppression predicates. `score_red_flags` is gone;
  // every red-flag rule (R1…R6) is a FILING rule, and the scoring pass registers none — so the honest
  // value of "red flags fired by the SCORE channel on this snapshot" is the empty array, and the field
  // keeps its shape and its meaning rather than being deleted from the contract.
  //
  // ⚠ IT MUST NOT BE REPOINTED AT THE LIVE CHANNEL, and this is the load-bearing part. `filingFindings`
  //   on this same payload already carries every standing red flag, from the filing's own period, and
  //   the frontend MERGES the two: prepareStockFindings composes `findings.redFlags` ∪ `filingFindings`
  //   into one list (lib/findings/index.ts). Feeding this array from the filing channel would render
  //   all 55 live red flags as two cards each with two dates — exactly the duplication step 4's
  //   channel suppression removed, arrived at from the opposite direction.
  //
  // ⚠ THE PATTERN HALF IS UNAFFECTED: `dropFilingPatterns` below is still doing real work, because
  //   score_patterns DOES still carry frozen filing-rule pattern rows.
  const redFlags: RedFlagView[] = [];
  // ★ LIFECYCLE — how long each finding has been true, which way it is moving, and what ended.
  //   A pure read over the append-only score_patterns history (read/finding-lifecycle.service.ts);
  //   it re-runs no rule and changes no firing decision. The verdict sentences above are untouched.
  //   The head period is passed so the resolver's notion of "current" is THIS view's head, not a
  //   second derivation of it — see the param note on resolveFindingLifecycles. (fetched in layer 2,
  //   off `ref.periodKey`, which is the same row's key.)

  const patterns: PatternView[] = dropFilingPatterns(dropNotCoveredPatterns(dropRetiredPatterns(snap.patterns)))
    .map((p) => {
      const lifecycle = lifecycles.firing.get(p.patternKey) ?? null;
      // ★ THE CLAUSE SET, COMPOSED WITH THE LIFECYCLE — this is the one call site that can supply the
      //   value history, so it is the one place the `movement` clause becomes available. `text` is the
      //   joined string the `verdict` field has always carried; the parts ship beside it.
      const composed = composeVerdict(p.patternKey, p.evidence ?? null, lifecycle);
      return {
        patternKey: p.patternKey,
        direction: p.direction,
        severity: p.severity,
        displayState: (p.displayState ?? "active") as PatternView["displayState"],
        magnitude: numN(p.magnitude),
        evidence: asEvidenceBag(p.evidence),
        // ⚠ PRECEDENCE UNCHANGED. renderVerdict still resolves authored → engine → generic, and the
        //   authored path is now composeVerdict's own text. Falling back to renderVerdict when the
        //   composer produced nothing keeps the engine-sentence and generic tiers reachable.
        verdict: composed.text || renderVerdict(p.patternKey, p.evidence ?? null),
        lifecycle,
        clauses: composed.clauses.length ? composed.clauses : null,
        // ★ THE RECORD, ON THE ROW. Every surface that used to pick a pair for itself now reads the
        //   pair this finding declares. Narrowed by the SAME function the catalogue endpoint uses, so
        //   a finding row can never serve a threshold the document withholds.
        facts: isPatternKey(p.patternKey) ? servedFacts(PATTERN_FACTS[p.patternKey]) : null,
        state: ((): "formed" | "building" | null => {
          const st = (p.evidence as { state?: unknown } | null)?.state;
          return st === "formed" || st === "building" ? st : null;
        })(),
        tier: typeof (p.evidence as { tierWord?: unknown } | null)?.tierWord === "string"
          ? ((p.evidence as { tierWord: string }).tierWord)
          : null,
        pair: pairOf(p.patternKey, scoredPillarSubtotals),
      };
    })
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  // ── NOT-COVERED · the head's readings and its immediate prior ────────────────────────────────
  // ⚠ THE PRIOR COMES FROM THE SAME SERIES THE CHART DRAWS, head-of-chain per period. A crossing
  //   needs two adjacent readings; with only one, nothing matches — which is correct, a stock with
  //   one reading has not crossed anything.
  // Reuses the SAME inert-0-guarded set the divergence pair is resolved from — an
  // `unavailable_redistributed` pillar persists a 0 that is not a score, and a not-covered trigger
  // reading it as one would report a phantom crossing.
  const scoredByPillar = new Map(scoredPillarSubtotals.map((x) => [x.pillar, x.subtotal]));
  const ncNow: SubjectReadings = {
    composite: num(snap.composite),
    foundation: scoredByPillar.get("foundation") ?? null,
    momentum: scoredByPillar.get("momentum") ?? null,
    market: scoredByPillar.get("market") ?? null,
    ownership: scoredByPillar.get("ownership") ?? null,
  };
  const priorPoint = series.length >= 2 ? series[series.length - 2] : null;
  const ncPrior: SubjectReadings | null = priorPoint
    ? {
        composite: priorPoint.composite,
        foundation: priorPoint.foundationSubtotal,
        momentum: priorPoint.momentumSubtotal,
        market: priorPoint.marketSubtotal,
        ownership: priorPoint.ownershipSubtotal,
      }
    : null;
  // ★ LIFECYCLE, ATTACHED — the SAME `lifecycles.firing` map resolved above for `patterns`. It makes
  //   no assumption about key namespace (see finding-lifecycle.service.ts), so a persisted
  //   `notcovered_*` row resolves through it exactly like a real finding's row does; `null` only when
  //   this is the FIRST period the configuration has matched (nothing persisted yet to walk).
  // ── ★ PAIR PRESENTATION · which reading leads its pair, and which drop to context ─────────────
  //
  // A TAB IS A PILLAR PAIR, so the question "lead or context?" is answered per pair, after both
  // channels are assembled — it is the one question no finding can answer on its own, because it
  // depends on what ELSE occupies the pair. See read/pair-presentation.ts for the two ruled rules.
  //
  // ⚠ NOTHING IS TRIMMED FROM THE PAYLOAD. A demoted reading travels in full, flagged; the surface
  //   decides how to render it. Suppressing the data here would make the wire disagree with what fired.
  const notCoveredRaw = notCoveredFor(ncNow, ncPrior);

  // The occupants of each pair, from BOTH channels — a note occupies a pair exactly as a pattern does.
  const occupantsByPair = new Map<string, string[]>();
  for (const p of patterns) {
    const subjects = p.facts?.pillarPair;
    if (!subjects?.length) continue;
    const k = pairKeyOf(subjects);
    occupantsByPair.set(k, [...(occupantsByPair.get(k) ?? []), p.patternKey]);
  }
  for (const n of notCoveredRaw) {
    const k = pairKeyOf(NOT_COVERED[n.id].subjects);
    occupantsByPair.set(k, [...(occupantsByPair.get(k) ?? []), notCoveredPatternKey(n.id)]);
  }

  // ★ RULE 2 — a note beside the exact pattern that supersedes it is dropped, not demoted. It is the
  //   same measurement, weaker; showing it in context would be redundancy dressed as extra evidence.
  const notCovered = notCoveredRaw
    .filter((n) => {
      const k = pairKeyOf(NOT_COVERED[n.id].subjects);
      const patternKeysOnPair = (occupantsByPair.get(k) ?? []).filter((key) => !isNotCoveredKey(key));
      return !isSupersededOnPair(n.id, patternKeysOnPair);
    })
    .map((n) => ({
      ...n,
      lifecycle: lifecycles.firing.get(notCoveredPatternKey(n.id)) ?? null,
    }));

  // ★ RULE 1 — S2 demotes whenever ANYTHING else occupies its pair (broader than coalescing: it
  //   applies beside D5, beside the coalesced D6+D7 entry, and beside a note). Recomputed against the
  //   POST-SUPPRESSION occupant set, so a note dropped by rule 2 cannot be what demotes sticky.
  const survivingOnPair = new Map<string, string[]>();
  for (const p of patterns) {
    const subjects = p.facts?.pillarPair;
    if (!subjects?.length) continue;
    const k = pairKeyOf(subjects);
    survivingOnPair.set(k, [...(survivingOnPair.get(k) ?? []), p.patternKey]);
  }
  for (const n of notCovered) {
    const k = pairKeyOf(NOT_COVERED[n.id].subjects);
    survivingOnPair.set(k, [...(survivingOnPair.get(k) ?? []), notCoveredPatternKey(n.id)]);
  }
  for (const p of patterns) {
    if (p.patternKey !== STICKY_KEY) continue;
    const subjects = p.facts?.pillarPair;
    if (!subjects?.length) continue;
    const others = (survivingOnPair.get(pairKeyOf(subjects)) ?? []).filter((k) => k !== STICKY_KEY);
    if (!others.length) continue; // alone on its pair ⇒ it headlines, unchanged
    p.demoted = true;
    // The gap's direction at THIS reading, from the lifecycle's own value series — the same numbers
    // the chart draws, never a second derivation. Null when there is no prior point to compare.
    const series = p.lifecycle?.valueSeries ?? [];
    const now = series.length ? series[series.length - 1]?.value ?? null : p.pair?.gap ?? null;
    const prior = series.length >= 2 ? series[series.length - 2]?.value ?? null : null;
    p.contextLine = stickyContextLine(gapDirectionOf(now, prior));
  }

  // ── THE THIRD SILENT STATE — a scored stock, nothing firing, and no not-covered configuration
  //   matched either. `patterns` is built above; `notCovered` just above this. Both empty is the ONLY
  //   condition this line renders under — see the field note on HealthSnapshotView.findings.quietNote.
  //
  // ★ AND NOW A THIRD CLAUSE: THE PAGE IS NOT QUIET IF THE OTHER CHANNEL IS SPEAKING. The channel
  //   filter above can empty `patterns` on a stock that is still firing — BLUESTARCO's accruals,
  //   TATACONSUM's margin compression — because those findings moved to `filingFindings` and are
  //   rendered from there. Without this clause the page would carry "quiet means nothing tested
  //   reliable here" directly beside a fired filing card, which is the surface contradicting itself.
  //   The condition is strictly NARROWER than before, so it can only withdraw the line, never add it.
  const quietNote: string | null =
    patterns.length === 0 && notCovered.length === 0 && (filingFindings?.fired.length ?? 0) === 0
      ? NOT_COVERED_SILENT_LINE
      : null;

  // ── CROSS-TOOL · what the OTHER tool is showing, in two lines ────────────────────────────────
  // Built from the `patterns` array already assembled — one source, so the summary and the tool's
  // own cards cannot disagree. `leadFact` is the lead finding's OWN observation clause, verbatim.
  const crossTool: CrossToolSummary[] = (["divergence", "trajectory"] as const).map((tool) => {
    const mine = forTool(patterns, tool, (p) => p.patternKey);
    const lead = [...mine].sort((a, b) => severityWeight(a.severity) - severityWeight(b.severity))[0] ?? null;
    return {
      tool,
      count: mine.length,
      names: mine.map((p) => findingName(p.patternKey)),
      leadFact: lead?.clauses?.find((c) => c.type === "observation")?.text ?? null,
      leadPatternKey: lead?.patternKey ?? null,
    };
  });

  const findings: HealthSnapshotView["findings"] = {
    redFlags,
    patterns,
    // Ended findings ride in their OWN array with their OWN closed-card clause set — see the field
    // note. A consumer that ignores this key renders exactly what it rendered before; one that reads
    // it cannot mistake an ending for a firing, because there is no shared array to confuse them in.
    // ★ NOT-COVERED — evaluated at READ TIME from the head and its prior, matched against the SAME
    //   registry the persisted `notcovered_*` rows come from, and now carrying that row's lifecycle
    //   (see the `lifecycle.firing.get` above). Still never a FireRule and never merged into
    //   `patterns` — see not-covered.ts's header for why persistence + lifecycle stopped short of
    //   "this is a claim".
    notCovered,
    // ★ THE THIRD SILENT STATE — see the field note. Null whenever `patterns` or `notCovered` has
    //   something to say.
    quietNote,
    // ★ THE OTHER TOOL, summarised. Built from the SAME `patterns` array below — no second query,
    //   no second opinion.
    crossTool,
    // ★ NOT-COVERED SUPPRESSION — a persisted `notcovered_*` row must never surface as "this
    //   configuration ended", which would misreport a decision-not-to-claim as a claim that closed.
    //   (Retired keys are ALREADY excluded — resolveFindingLifecycles drops them before the run-walk,
    //   per its own header — so only the not-covered guard is new here.)
    recentlyEnded: dropNotCoveredPatterns(lifecycles.recentlyEnded).map((e) => {
      const composed = composeEndedVerdict(e.patternKey, e.lifecycle);
      return {
        patternKey: e.patternKey,
        name: findingName(e.patternKey),
        lifecycle: e.lifecycle,
        clauses: composed.clauses,
        text: composed.text,
      };
    }),
  };

  // ── peer standing (rank within PG by composite at this period) ──
  // The siblings were fetched in layer 2 (they need only `pg.id` + the head period). `null` covers
  // both "no peer group" and "not requested" — `omitted` on the response tells the two apart.
  const peerStanding = pg && peerSiblings ? buildPeerStanding(pg.id, snap.periodKey, stock.id, peerSiblings) : null;

  // ── S3.5 rank second-check (read-layer; rank/N only, NO z-score) ──────────────
  // CONFIRMATION ONLY: the triplet already FIRED each pattern above; here we attach the
  // absolute standing band + a standing-reconciled display `verdict` so the field-line /
  // pillar-verdict wording can never contradict the stock's rank in its PG (e.g. an LP3
  // "trails an elite field" verdict on the PG's #1 stock). Firing is byte-identical —
  // we mutate only the verdict text on the already-built pattern objects.
  for (const pv of pillars ?? []) {
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

  // ★ THE LIVE REGIME — resolved THROUGH the stock's peer group, never computed on the stock. This
  //   is the first call site getRegimeByStock has ever had: before it, the only regime a reader could
  //   see was a frozen stamp inside one finding's evidence, at that scoring run's asOf rather than now.
  //   (fetched in layer 2 — it needs only `stock.id`, and used to sit at the very END of the chain,
  //   three sequential round-trips after everything else had already resolved.)
  const regimeView = regimeByStock.get(stock.id) ?? null;
  const regime: HealthSnapshotView["regime"] = regimeView
    ? {
        regime: regimeView.regime,
        trailing6mo: regimeView.trailing6mo,
        source: regimeView.source,
        indexName: regimeView.indexName,
        asOf: regimeView.asOf,
        reason: regimeView.reason ?? null,
        // ★ THE TEST, BESIDE THE READING — the same discipline `alignedMax` follows. An explainer
        //   that says "above +25%" has to get that number from the rule that used it, not from a
        //   sentence typed on the other side of the wire. See RegimeBadgeView.
        hotAbove: REGIME_HOT_ABOVE,
        stressedBelow: REGIME_STRESSED_BELOW,
      }
    : null;

  // ★ TWO CHANNELS, NEVER ONE ARRAY. `findings` is score-derived and exists on 95 stocks;
  //   `filingFindings` is filing-derived and exists on all 504. They are separate fields because they
  //   have different populations behind them — and step 5 gives them different base-rate denominators
  //   for exactly that reason. Merging them here would force a re-split the moment base rates land.
  return { scored: true, identity, verdict, pillars, trajectory, findings, filingFindings, peerStanding, regime, omitted };
}

// ★ zoneLabel() IS DELETED. It banded a pillar against NATIVE_ZONES to emit chart crossings — the
// fifth local derivation of a pattern fact, and the one sitting on the very tool that renders T3–T6.
// See read/fired-crossings.ts for what replaced it, and why the overlay is thin for now.

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
