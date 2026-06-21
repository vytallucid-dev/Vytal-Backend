// File: src/scoring/read/health-view.types.ts
//
// THE CANONICAL HealthSnapshotView CONTRACT.
//
// This is the exact JSON shape `GET /api/stocks/:symbol/health` returns and the
// reusable read-model every later health surface (peer-group tab, research tools)
// renders from. Mirror this verbatim into the frontend `types/health.ts`.
//
// CONVENTIONS:
//   • Every number is a JS number (Prisma Decimals are converted at the edge).
//   • A field with no backing data is `null` with the key PRESENT — never omitted,
//     never fabricated. The frontend can rely on the key existing.
//   • Enum-ish fields are string unions matching the DB enums.

export type IndustryPath = "non_financial" | "banking";
export type CoverageState = "scored" | "covered" | "off_platform";
export type LabelBand = "fragile" | "below_par" | "steady" | "healthy" | "pristine";
export type PillarKey = "foundation" | "momentum" | "market" | "ownership";
export type PillarState = "scored" | "unavailable_redistributed";
export type MetricBand = "excellent" | "good" | "acceptable" | "concerning" | "distress";
export type MetricScoreState = "scored" | "suppressed" | "missing_renorm" | "neutral_hold";
export type FlowCategoryKey = "A_promoter" | "B_institutional" | "C_insider" | "D_block";
export type FlowCategoryState = "scored" | "dormant_no_feed" | "dormant_no_data";
export type FlowTrendState = "three_up" | "three_down" | "mixed" | "neutral";
export type MarketSubKey = "A1" | "A2" | "B1" | "B2" | "B3" | "C1" | "D1";
export type MarketCategory = "A" | "B" | "C" | "D";
export type TrajectoryMarker = "improving" | "stable" | "deteriorating";
export type DivergenceFlag = "none" | "notable" | "wide";
export type BarDirection = "higher_better" | "lower_better";

/** SECTOR ARCHETYPE — Quality / Defensive / Commodity / Cyclical / Growth / PSU.
 *  NOT stored anywhere in the schema today (see findings note). Always null until
 *  a backing column/config exists. */
export type SectorClass =
  | "Quality"
  | "Defensive"
  | "Commodity"
  | "Cyclical"
  | "Growth"
  | "PSU"
  | null;

export interface IdentitySection {
  symbol: string;
  name: string;
  sector: { key: string; displayName: string } | null;
  /** Load-bearing but ABSENT from the schema — always null today (flagged). */
  sectorClass: SectorClass;
  industryPath: IndustryPath;
  peerGroup: {
    id: string;
    name: string;
    displayName: string;
    /** Roster size (PeerGroup.stockCount). */
    memberCount: number;
  } | null;
  /** Latest StockScoringState — null when no coverage row exists (current reality). */
  coverageState: CoverageState | null;
  coverageReason: string | null;
  asOfDate: string; // YYYY-MM-DD
  periodKey: string; // e.g. "FY26Q4"
}

export interface BandColour {
  band: LabelBand;
  label: string;
  colour: string | null;
  /** [lower, upper] numeric cut range from BandMappingVersion; either end may be null. */
  range: [number | null, number | null] | null;
}

export interface DivergenceView {
  /** Derived from the SCORED pillar subtotals: notable ≥15, wide ≥25. */
  flag: DivergenceFlag;
  /** max(subtotal) − min(subtotal) across scored pillars. */
  gap: number;
  high: { pillar: PillarKey; subtotal: number } | null;
  low: { pillar: PillarKey; subtotal: number } | null;
  /** The engine's own per-snapshot divergence scalar (denormalised on the row). */
  storedScalar: number;
}

/** PG-level pond mask (File 1 §5 / File 2 §3.3) — inherited from the snapshot's PG. */
export interface PondMask {
  heat: "hot" | "warm" | "calm";
  /** heat === "hot" — the boolean the §5 price-linked cards (B/C1/D) consume. */
  isHot: boolean;
  /** signed pond median ~21d trailing return %, e.g. +12.4 / −17.5 (null when n/a). */
  trailingMovePct: number | null;
}

export interface VerdictSection {
  composite: number;
  label: BandColour;
  /** improving/stable/deteriorating from the last 2 in-force composites; null when
   *  fewer than 2 snapshots exist (insufficient history). */
  trajectoryMarker: TrajectoryMarker | null;
  trajectoryDelta: number | null;
  divergence: DivergenceView;
  /** PG-level pond mask; null when not established (no member quorum) or pre-stamp. */
  pondMask: PondMask | null;
}

export interface MetricBars {
  direction: BarDirection;
  excellent: number;
  good: number;
  acceptable: number;
  concerning: number;
  distress: number;
}

export interface PeerStats {
  mean: number;
  stdDev: number;
  sampleN: number;
  /** True only when the cross-section is a USABLE distribution: sampleN ≥ 5 AND
   *  stdDev > 0. When false the row exists for transparency (records WHY L2 was
   *  unavailable — too few peers / no spread) but the UI must NOT draw a
   *  distribution or compute (raw−μ)/σ from it. */
  usable: boolean;
}

export interface MetricView {
  metricKey: string;
  rawValue: number;
  l1Score: number | null;
  l2Score: number | null;
  l3Score: number | null;
  metricScore: number;
  l1Band: MetricBand | null;
  scoreState: MetricScoreState;
  nominalWeight: number;
  effectiveWeight: number;
  contribution: number;
  /** Suppression reason when scoreState ≠ scored (from SuppressionDirective). null otherwise. */
  suppressionReason: string | null;
  /** The 5 L1 thresholds + direction (MetricBarSet); null when no bar set is linked. */
  bars: MetricBars | null;
  /** Peer μ/σ/N (PeerStatsSnapshot); null — peer stats are not persisted today (flagged). */
  peer: PeerStats | null;
}

export interface MarketSubView {
  subComponent: MarketSubKey;
  category: MarketCategory;
  available: boolean;
  reason: string | null;
  rawValue: number | null;
  score: number | null;
  band: MetricBand | null;
  saturated: boolean;
  capped: boolean;
}

export interface FlowCategoryView {
  category: FlowCategoryKey;
  categoryState: FlowCategoryState;
  rawSubScore: number;
  capApplied: number;
  cappedSubScore: number;
  bandLanded: string | null;
  netFlowValue: number | null;
  trendState: FlowTrendState | null;
}

export interface OwnershipDetail {
  baseline: number;
  baselineReason: string;
  pledgingAdjustment: number;
  penalties: { r2: number; r6: number; prolongedFii: number };
  primarySubtotal: number;
  flowAdjustmentRaw: number;
  flowAdjustmentClamped: number;
  finalOwnership: number;
  r1Fired: boolean;
  r1TriggeringValues: unknown | null;
  flowCategories: FlowCategoryView[];
}

export interface NativeZone {
  lowerMark: number;
  upperMark: number;
  /** below_native | in_native | above_native, relative to the locked marks. */
  position: "below_native" | "in_native" | "above_native";
}

export interface PillarView {
  pillar: PillarKey;
  subtotal: number;
  state: PillarState;
  nominalWeight: number; // locked composite weight (0.35/0.25/0.20/0.20)
  appliedWeight: number; // snapshot w* (post §14.4 redistribution)
  nativeZone: NativeZone;
  /** Foundation & Momentum only — else null. */
  metrics: MetricView[] | null;
  /** Market only — the 7 universal sub-components, else null. */
  marketSubs: MarketSubView[] | null;
  /** Ownership only — else null. */
  ownership: OwnershipDetail | null;
}

export interface TrajectoryPoint {
  periodKey: string;
  asOfDate: string;
  composite: number;
  labelBand: LabelBand;
  foundation: number;
  momentum: number;
  market: number;
  ownership: number;
}

export interface CrossingEvent {
  /** "band" (composite label changed) | "pillar_zone" (a pillar crossed a native mark). */
  type: "band" | "pillar_zone";
  fromPeriod: string;
  toPeriod: string;
  pillar: PillarKey | null; // set for pillar_zone crossings
  from: string;
  to: string;
}

export interface CorporateEventView {
  eventType: string;
  eventDate: string;
  description: string | null;
  impactLevel: string;
}

export interface TrajectorySection {
  windowQuarters: number;
  series: TrajectoryPoint[];
  /** Model-derived band + pillar-zone crossings computed from the series. */
  crossings: CrossingEvent[];
  /** External overlay — CorporateEvent rows in the series window. */
  events: CorporateEventView[];
}

export interface RedFlagView {
  flagKey: string;
  severity: string | null;
  tier: "auto" | "review";
  triggeringValues: unknown | null;
  guardrailEventId: string | null;
}

export interface PatternView {
  patternKey: string;
  direction: string | null;
  severity: string | null;
  /** File 1 §5E display state: active | pending_data_integration | dampened. */
  displayState: "active" | "pending_data_integration" | "dampened";
  /** Effective §5E score impact; a dampened pattern carries the HALVED value. null for
   *  structural cards (B/C/D/F/G/H/I) which carry no §5E magnitude. */
  magnitude: number | null;
  evidence: unknown | null;
  metricRefs: unknown | null;
}

export interface FindingsSection {
  redFlags: RedFlagView[];
  patterns: PatternView[];
}

export interface PeerRankView {
  rank: number;
  outOf: number;
}

export interface PeerStandingSection {
  peerGroupId: string;
  periodKey: string;
  /** Number of scored siblings at this period. */
  memberCount: number;
  rank: number; // 1 = highest composite
  percentile: number; // 0–100
  neighbours: {
    above: { symbol: string; composite: number } | null;
    below: { symbol: string; composite: number } | null;
  };
  perPillarRank: Record<PillarKey, PeerRankView>;
}

/** THE top-level read-model returned by GET /api/stocks/:symbol/health.
 *
 *  `scored` is the discriminant. When false (a covered / off-platform stock with
 *  no in-force snapshot) `identity` is still populated (incl. coverageState) but
 *  every snapshot-derived section is null / empty — never fabricated. When true,
 *  all sections are present. The frontend null-checks on `scored`. */
export interface HealthSnapshotView {
  scored: boolean;
  identity: IdentitySection;
  verdict: VerdictSection | null;
  pillars: PillarView[];
  trajectory: TrajectorySection | null;
  findings: FindingsSection | null;
  peerStanding: PeerStandingSection | null;
}
