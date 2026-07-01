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

/**
 * Honest metric state for the UI — maps every metric (scored AND not) to a
 * single discriminant so the UI never has to infer from null combinations.
 *   scored              — all three lenses computed; the metric contributed
 *   no_bar              — metric has no MetricBarSet (L1 unavailable)
 *   data_unavailable    — rawValue absent or metric excluded from this pillar
 *   normalized_out      — scoreState ∈ {suppressed, missing_renorm, neutral_hold}
 *   insufficient_peers  — l2Available but peer pool too small (N < 5 or σ=0)
 *   building_history    — l3Available=false because windowN < minEffectiveN
 */
export type MetricState =
  | "scored"
  | "no_bar"
  | "data_unavailable"
  | "normalized_out"
  | "insufficient_peers"
  | "building_history";
export type FlowCategoryKey = "A_promoter" | "B_institutional" | "C_insider" | "D_block";
export type FlowCategoryState = "scored" | "dormant_no_feed" | "dormant_no_data";
export type FlowTrendState = "three_up" | "three_down" | "mixed" | "neutral";
export type MarketSubKey = "A1" | "A2" | "B1" | "B2" | "B3" | "C1" | "D1";
export type MarketCategory = "A" | "B" | "C" | "D";
export type TrajectoryMarker = "improving" | "stable" | "deteriorating";
export type DivergenceFlag = "none" | "notable" | "wide";
export type BarDirection = "higher_better" | "lower_better";

/** SECTOR ARCHETYPE — Quality / Defensive / Commodity / Cyclical / Growth / PSU.
 *  Backed by the `sector_class` column on the `sectors` table (migration 20260620100000).
 *  Null only for coarse-bucket sectors (Financials, Energy & Materials) — honest-empty. */
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
  /** Sector archetype — null for coarse-bucket sectors. */
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

// ── THREE-LENS CONTRACT (S2 additions) ────────────────────────────────────────

/** L1 absolute-bar state (direction already folded in l1Band). */
export type L1State = "above_bar" | "below_bar" | "not_evaluable";
/** L2 peer cross-section state. */
export type L2State = "above_peer" | "near_peer" | "below_peer" | "not_evaluable";
/** L3 own-history trend state. */
export type L3State = "improving" | "flat" | "declining" | "not_evaluable";

/** One lens read as surfaced in the payload. referenceValue: bar (L1), peer μ (L2),
 *  own-history μ (L3). reason explains NOT evaluable (building_history, no_peers,
 *  std_dev_zero, …). evaluable=false ⇒ state is always not_evaluable. */
export interface LensRead {
  state: L1State | L2State | L3State;
  evaluable: boolean;
  referenceValue: number | null;
  reason: string | null;
}

/** L3 own-history series point for the per-metric sparkline. */
export interface L3SeriesPoint {
  periodKey: string;
  asOfDate: string; // YYYY-MM-DD
  rawValue: number;
}

/** Standing band from absolute rank in the PG (rank/N only — no z-score). */
export type LensStandingBand = "top" | "upper" | "mid" | "lower" | "bottom";
/** Rank second-check context attached at read-time (CONFIRMATION ONLY — never changes
 *  which pattern fired). null when the stock has no PG standing. */
export interface LensStandingContext {
  rank: number;
  n: number;
  band: LensStandingBand;
}

/** A fired metric-level lens pattern (verbatim from LM_CATALOG). */
export interface MetricLensPattern {
  id: string; // "LM1".."LM8"
  label: string;
  tone: string;
  fieldVerdict: "PG_WEAK" | "PG_STRONG" | null;
  /** Supporting-detail when the LM5 metric pattern defers to Family-D recovery. */
  role: "top_level" | "supporting_detail";
  /** S3.5 rank second-check (read-layer; rank/N only). null when no PG standing. */
  standingContext?: LensStandingContext | null;
  /** Display-ready, standing-reconciled verdict sentence. Frontend renders verbatim. */
  verdict?: string;
}

/** A fired pillar-level lens pattern (verbatim from LP_CATALOG). */
export interface PillarLensPattern {
  id: string; // "LP1".."LP6"
  label: string;
  tone: string;
  fieldVerdict: "PG_WEAK" | "PG_STRONG" | null;
  /** Supporting-detail when LP5/LP6 defer to Family-B deterioration. */
  role: "top_level" | "supporting_detail";
  /** S3.5 rank second-check (read-layer; rank/N only). null when no PG standing. */
  standingContext?: LensStandingContext | null;
  /** Display-ready, standing-reconciled verdict sentence. Frontend renders verbatim. */
  verdict?: string;
}

/** The 5 bar cuts + the active band + direction. Derived from MetricBarSet.
 *  null when no bar set is linked (metricState = no_bar). */
export interface BandLadder {
  direction: BarDirection;
  excellent: number;
  good: number;
  acceptable: number;
  concerning: number;
  distress: number;
  activeBand: MetricBand | null;
}

/** Pillar-level shares (denominator = per-lens-evaluable scored metrics only). */
export interface PillarLensShares {
  /** Fraction ≥ 0.70 = "strong", < 0.40 = "weak", else "mixed". null when N=0. */
  l1Pass: number | null;
  l2Pass: number | null;
  l3Improving: number | null;
  l3Declining: number | null;
  /** Per-lens denominators (evaluated, not_evaluable excluded). */
  nL1: number;
  nL2: number;
  nL3: number;
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

/** One PG member's value for a metric in the peer cross-section (modal §2.3). */
export interface PeerDistributionMember {
  symbol: string;
  value: number;
  isSelf: boolean;
}

/** The metric's full peer cross-section (members + mean + this stock's rank), for the
 *  modal's peer-field visual. null when no member values resolve. `usable` mirrors
 *  PeerStats.usable (≥5 peers AND σ>0) — when false the UI shows the spread but NOT a
 *  field-verdict (honest-empty over a fabricated field claim, trap 3). */
export interface PeerDistribution {
  mean: number;
  selfValue: number;
  /** Direction-aware rank: 1 = healthiest (highest for higher_better, lowest for lower_better). */
  rank: number;
  outOf: number;
  usable: boolean;
  members: PeerDistributionMember[];
}

/** Where the metric's BARS came from + when last recalibrated (modal §2.1 provenance).
 *  recalibratedAt = MetricBarSet.inForceFrom; inheritedFromPeerGroupId non-null ⇒ the
 *  bars were inherited from a parent PG (e.g. PG6←PG5). */
export interface BarProvenance {
  barPath: string;
  recalibratedAt: string; // YYYY-MM-DD
  inheritedFromPeerGroupId: string | null;
}

export interface MetricView {
  metricKey: string;
  /** null only for an honest-empty (non-scored) metric row — no value was available. */
  rawValue: number | null;
  l1Score: number | null;
  l2Score: number | null;
  l3Score: number | null;
  /** null when scoreState ≠ scored (not_scored metrics carry weights/contribution as 0). */
  metricScore: number | null;
  l1Band: MetricBand | null;
  scoreState: MetricScoreState;
  nominalWeight: number;
  effectiveWeight: number;
  contribution: number;
  /** Suppression reason when scoreState ≠ scored (from SuppressionDirective). null otherwise. */
  suppressionReason: string | null;
  /** The 5 L1 thresholds + direction (MetricBarSet); null when no bar set is linked. */
  bars: MetricBars | null;
  /** Peer μ/σ/N (PeerStatsSnapshot); null when peer stats unresolvable. */
  peer: PeerStats | null;

  // ── S2: Three-Lens contract fields ──────────────────────────────────────────

  /** Honest discriminant for every metric (scored AND not). The UI renders
   *  the right empty/unavailable state for each case — never a blank. */
  metricState: MetricState;

  /** Stored availability + window booleans (from score_metrics columns). */
  l2Available: boolean;
  l3Available: boolean;
  l3WindowN: number | null;
  /** Which lens fallback was applied (none | l1_only | l2_fallback | …). */
  lensFallbackApplied: string;

  /** The three lens reads — each with state, evaluable, referenceValue, reason.
   *  Always present when metricState = "scored"; present with evaluable=false for
   *  the specific unavailable lens otherwise (so the UI knows WHY, not just WHAT). */
  lens: {
    l1: LensRead;
    l2: LensRead;
    /** Includes l3Series for the sparkline. */
    l3: LensRead & { series: L3SeriesPoint[] };
  } | null;

  /** The fired LM pattern (LM1–LM8) + role; null for degenerate/no-tension cells
   *  or when a required lens is not_evaluable (honest-empty). */
  lensPattern: MetricLensPattern | null;

  /** 5 cuts + active band + direction. null when no bar set linked (metricState=no_bar). */
  bandLadder: BandLadder | null;

  /** The metric's peer cross-section (members + mean + rank) for the modal §2.3.
   *  null when no member values resolve (non-scored row, or no siblings scored it). */
  peerDistribution: PeerDistribution | null;
  /** Bar provenance (derived-from-PG + recalibration date) for the modal §2.1.
   *  null when no bar set is linked. */
  barProvenance: BarProvenance | null;
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

  // ── S2: Pillar-level lens contract ──────────────────────────────────────────
  /** Fired LP patterns (LP1–LP6) + role; empty array when no pattern fires.
   *  Foundation + Momentum only; null for Market and Ownership. */
  lensPillarPatterns: PillarLensPattern[] | null;
  /** Per-lens pass-shares used to derive the LP patterns. null for Market/Ownership. */
  lensShares: PillarLensShares | null;
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

/** One DAILY trajectory point — same shape as TrajectoryPoint, but one per calendar
 *  day (asOfDate) rather than one per quarter. Market/Ownership move day-to-day here;
 *  Foundation/Momentum carry forward flat between quarters (honest, not interpolated). */
export interface DailyTrajectoryPoint {
  asOfDate: string;
  periodKey: string;
  composite: number;
  labelBand: LabelBand;
  foundation: number;
  momentum: number;
  market: number;
  ownership: number;
}

/** A day within the daily window on which a NEW quarter's results landed and stepped
 *  all four pillars (the periodKey changed between consecutive daily points). Drives the
 *  chart's vertical "Result — <period>" reference marker that explains the F/M step. */
export interface ResultDayMarker {
  asOfDate: string;
  periodKey: string;
}

export interface TrajectorySection {
  windowQuarters: number;
  series: TrajectoryPoint[];
  /** Sub-quarterly series (one point per calendar day over a trailing ~60D window),
   *  exposing the daily-changing Market/Ownership recomputes. Empty when no daily
   *  version history exists yet. The 60D/30D/15D chart timeframes read from this. */
  dailySeries: DailyTrajectoryPoint[];
  /** Result-landing days inside the daily window (periodKey transitions) — the days a
   *  quarterly rescore stepped all four pillars. Empty when no result landed in-window. */
  resultDays: ResultDayMarker[];
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
