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

// ★ THE LIFECYCLE TYPES ARE RE-EXPORTED, NOT RE-DECLARED. They are computed in
// read/finding-lifecycle.service.ts and every field's meaning — why `resolved` is a different question
// from `type`, why a crossing's quantity is `distance_from_mark`, which clock ran — is documented
// beside the code that produces it. Restating the shape here would be a second home for it, and the
// second home is the one that goes stale. When mirroring this contract into the frontend's
// types/health.ts, inline these from the service file.
import type { FindingLifecycle } from "./finding-lifecycle.types.js";
import type { VerdictClause } from "../findings/verdicts.js";
import type { ServedPatternFacts } from "../../catalogue/pattern-facts.js";
import type { NotCoveredNote } from "./not-covered.service.js";
export type { NotCoveredNote, NotCoveredReading, NotCoveredPair } from "./not-covered.service.js";
export type { ServedPatternFacts } from "../../catalogue/pattern-facts.js";
export type { VerdictClause, ClauseType, ComposedVerdict } from "../findings/verdicts.js";
export type {
  FindingLifecycle,
  LifecycleState,
  LifecycleDirection,
  LifecycleValueBasis,
  LifecycleClock,
  IntraPeriodPoint,
  EndedResolution,
} from "./finding-lifecycle.types.js";

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
  /**
   * ★ The raw Stock.id (UUID). Carried here because the CLIENT NEEDS IT AND HAD NOWHERE ELSE TO GET IT.
   *
   * Every per-stock mutation is keyed on the id, not the symbol — watchlist pin/unpin, alert rules,
   * event reminders, the relational card. The stock page had no id in any response it already read, so
   * four components resolved it the only way available: download GET /api/stocks/universe (104 KB raw /
   * 22.1 KB gzip, 504 rows) and run `universe.find(s => s.symbol === symbol)?.id`. A full universe
   * scan, per page, to read one 36-byte field the server already had in hand.
   *
   * TRADEOFF, STATED: hanging it here means anything that needs the id waits on the health fetch. That
   * is not a new dependency — the relational card was already gated behind the universe list resolving,
   * and the page awaits health before it renders anything at all. It IS a real coupling for the
   * not-scored path, which is why the `scored: false` branch populates it too: identity is always
   * present even when every snapshot-derived section is null, so the id never depends on a stock
   * having been scored.
   */
  id: string;
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

/**
 * ── ★ "DIVERGENCE" NAMES THREE DIFFERENT THINGS. `gap` IS THE CANONICAL ONE. ──────────────────────
 *
 *   ① score_snapshots.divergence   the ENGINE SCALAR, surfaced below as `storedScalar`.
 *                                  market − Σ(w_p/Σw_nonMarket)·subtotal_p (composite/composite.ts).
 *                                  SIGNED. Negative means Market reads BELOW the rest.
 *   ② `gap` / `flag` (HERE)        the READER GAP. max − min across scored subtotals, UNSIGNED,
 *                                  banded notable ≥15 / wide ≥25. Every card, chip, filter, screen,
 *                                  scan and the Divergence research tool show THIS.
 *   ③ divergence_C1/C2/C3/C_over_time  the FINDING FAMILY — four rules, not a number, consolidated
 *                                  into one card by §5C (catalogue/divergence.ts).
 *
 * ANYTHING READER-FACING USES ②. That is not a new rule, it is what every surface already does; it is
 * written down here because the three share a word and nothing said which one won.
 *
 * ① AND ② ARE NOT THE SAME NUMBER AND NEVER AGREE. Measured over 559 in-force snapshots: 559/559
 * differ, 287 carry a NEGATIVE ① beside a positive ② (TCS: ① −37.61, ② 47.39). Do not treat ① as ②
 * with a sign, or as its magnitude.
 *
 * scripts/verify-divergence-authority.ts holds all of this shut: the disagreement, the fact that ①
 * has no reader, and the grounding withholding below.
 */
export interface DivergenceView {
  /**
   * ★ RULING 3 — THE HEADLINE STATE, DECIDED HERE. A surface renders it; no surface computes it.
   *
   *   aligned           spread ≤ S1's ceiling (7). The pillars agree — the study's measured CONTROL.
   *   no_pattern        spread is past the ceiling but NOTHING matched: the 8–11 minor band, or a
   *                     ≥12 spread on a pair no rule names. ★ THIS IS THE STATE THAT DID NOT EXIST.
   *   patterns_firing   one or more D/S findings are standing.
   *
   * ⚠ THE MISSING THIRD STATE IS THE WHOLE POINT. Every surface used to run `lead ? patterns :
   * Aligned` — a two-way branch over a three-way fact. GLENMARK carries a 49-point Market↔Foundation
   * spread and no live D finding (its rows are retired C-family), so that branch rendered it as
   * "Aligned — no tension" on the widest spread in the universe. `no_pattern` says the true thing:
   * the pillars do NOT agree, and nothing we have measured describes this shape.
   */
  headline: DivergenceHeadline;
  /**
   * ★ max − min across SCORED pillar subtotals — S1's OWN quantity, and the only thing this object
   * measures. Null when fewer than two pillars are scored.
   *
   * ⚠ THIS IS NOT "THE DIVERGENCE". It is the ALIGNMENT TEST's input (findings/divergence/aligned.ts),
   * which is why it may be computed here at all: S1 is a real catalogue record and this is its
   * arithmetic, not a surface inventing a pattern. The gap a FIRED finding is about lives on that
   * finding, under its own `pair`.
   */
  spread: number | null;
  /** S1's ceiling, read from S1's record. Carried so a surface can state the test without typing 7. */
  alignedMax: number;
  /**
   * ★ THE PAIR THE LEAD FIRING FINDING IS ABOUT — from ITS OWN RECORD's `pillarPair`. Null when
   * nothing is firing (`aligned` or `no_pattern`), because then there is no pair: absence, not a
   * fallback to the widest one.
   *
   * ⚠ THIS REPLACES `high`/`low`, WHICH WERE THE WIDEST SCORED PAIR AND WERE THE IOC BUG. IOC fires
   * S2 (Foundation ↔ Momentum, 30.6 apart) while its widest pair is Foundation ↔ Market. The old
   * fields put Market on the chart and Momentum in the prose, on the same card, and the four services
   * that computed them each did it independently.
   */
  pair: DivergencePair | null;
  /**
   * ⚠ NOT `gap`, AND NOT FOR DISPLAY. The engine's own per-snapshot scalar (denormalised on the row).
   * It reaches no render path, and grounding.ts deliberately keeps it out of the model's fact block:
   * it is a linear function of the WITHHELD pillar weights, so printing it beside the four subtotals
   * hands over the weight vector. It is also lossy — persist.ts coerces null → 0, so a stored 0 cannot
   * be told apart from "the Market pillar was unavailable" (live: VEDL, INDUSINDBK).
   * Kept on the view for parity with the persisted row. If you are reaching for it, you want the
   * fired finding's own `pair`, or `spread` for the alignment test.
   */
  storedScalar: number;
}

/** Ruling 3's three states. Total — there is no fourth, and no surface may add one. */
export type DivergenceHeadline = "aligned" | "no_pattern" | "patterns_firing";

/** One end of a fired finding's declared pair, resolved against the current snapshot. */
export interface PillarReading {
  pillar: PillarKey;
  subtotal: number;
}

/**
 * The pair a fired finding names, high/low resolved. Resolved SERVER-SIDE so a surface never decides
 * which end is which — that is arithmetic over a pattern fact, and Ruling 0 puts it here.
 */
export interface DivergencePair {
  /** Which finding this pair belongs to. A second firing pattern may name a different pair. */
  patternKey: string;
  high: PillarReading;
  low: PillarReading;
  /** |high − low| for THIS pair, at the pattern's own display precision. */
  gap: number;
}

/**
 * ★ THE LIVE MARKET REGIME for this stock's sector — NET-NEW ON THE WIRE.
 *
 * ── ⚠ THERE WAS NO LIVE REGIME PATH AT ALL ────────────────────────────────────────────────────────
 * `getRegimeByStock` existed with ZERO call sites, and regime resolved only inside the scoring batch,
 * for the findings that declare a dependency, stamped at THAT RUN's asOf. So the only regime a reader
 * could ever see was a frozen stamp inside one finding's evidence — there was no answer at all to
 * "what phase is this sector in right now", which is the question the T-family's Tier-1 patterns turn
 * on (T3 reads in HOT and is blank in NORMAL; T6 is the exact reverse).
 *
 * ⚠ RESOLUTION BY STOCK, NEVER COMPUTATION ON A STOCK. The value is the stock's PEER GROUP's phase,
 * identical for every member. A stock in no peer group gets null and a reason — never a regime
 * derived from its own closes.
 *
 * ⚠ NULL IS A FIRST-CLASS ANSWER AND HAS NO NUMERIC FALLBACK. When the window is too short, too
 * stale, or the stock has no peer group, `regime` is null and `reason` says why. A surface states
 * that plainly; there is no "assume NORMAL" and inventing one would put a phase-conditional reading
 * on screen with nothing behind it.
 */
export interface RegimeBadgeView {
  regime: "HOT" | "NORMAL" | "STRESSED" | null;
  /** Signed FRACTION (0.2215 = +22.15%), the pool's trailing ~6-month return. Null iff regime null. */
  trailing6mo: number | null;
  source: "index" | "pg_pool" | null;
  /** The index the reading came from, or null on a pg_pool reading. */
  indexName: string | null;
  /** Trading date the reading is AS OF (YYYY-MM-DD). Null when not computable. */
  asOf: string | null;
  /** Why, whenever `regime` is null — and on pg_pool readings, which members and why no index. */
  reason: string | null;
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
  /** Canonical human label from CANONICAL_METRICS (F7 → "Asset Turnover"); the engine key itself
   *  when unknown (honest, never fabricated). Server-side name so every read surface — the AI fact
   *  block included — can speak the metric instead of its internal code. */
  label: string;
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CANONICAL FINDING ROWS. Both carry `verdict` as of Stage 3 of the copy-catalogue migration.
//
// ★ WHY THE VERDICT RIDES THE ROW AND NOT THE CATALOGUE ENDPOINT. A verdict interpolates THIS stock's
// evidence numbers — "promoter −6.30pp and FII −2.10pp both cut while retail absorbed +8.40pp". It is
// an (evidence) => string function, so it cannot be static JSON, and it is meaningless without the
// instance it is bound to. It therefore travels with the instance. The static half of the copy — name,
// description, doesn't-mean — is served ONCE from the catalogue endpoint and never repeated per row.
//
// ⚠ WHICH IS ALSO WHY THE CENSUS SHAPES DO NOT GET THIS FIELD. PathologyCensusItem / FiredFlag /
// FiredPattern carry NO evidence: a census row is an aggregate over N members, and there is no single
// stock's numbers to bind a sentence to. Adding `verdict` there would force either a fabricated
// sentence or a permanently-null field that looks like a bug. Those surfaces render `description`,
// which is exactly the layer that exists for them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface RedFlagView {
  flagKey: string;
  severity: string | null;
  tier: "auto" | "review";
  triggeringValues: unknown | null;
  guardrailEventId: string | null;
  /** The File-1 §5 verdict sentence, bound to this firing's own evidence. Never empty — the
   *  renderer falls back to the engine's assembled sentence, then to a generic form. */
  verdict: string;
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
  /** The File-1 §5 verdict sentence, bound to this firing's own evidence. Never empty. */
  verdict: string;
  /**
   * ★ HOW LONG THIS HAS BEEN TRUE AND WHICH WAY IT IS MOVING — read/finding-lifecycle.service.ts.
   *
   * FACTS ONLY. The verdict sentence above is unchanged by this field and does not read it: a gap of
   * 31 still renders exactly as it did, and nothing here becomes language until a later prompt turns
   * it into one.
   *
   * NULL MEANS ONE OF TWO THINGS, AND BOTH ARE HONEST ABSENCES: either this surface does not resolve
   * lifecycles (the watchlist list-view does not — see `recentlyEnded`), or the stock's history
   * carries no HEAD row for this key (a finding that has only ever appeared on a superseded version).
   * It never means "this finding has no history".
   */
  lifecycle: FindingLifecycle | null;
  /**
   * ★ THE SAME VERDICT, DECOMPOSED — observation · movement · size · phase · boundary, fixed order.
   *
   * `verdict` above is the joined string and stays the finished-string contract every consumer already
   * reads. These are the parts it was joined from, so a surface can render them separately (or drop
   * one) without re-parsing prose. Null for a finding with no authored clause set.
   *
   * ⚠ The `boundary` clause is PRESENT here and ABSENT from `verdict` — every card already renders
   * `doesntMean` in its own slot, and joining it would print it twice. See ComposedVerdict.text.
   */
  clauses: VerdictClause[] | null;
  /**
   * ★ THE PATTERN'S OWN RECORD FACTS — `pillarPair`, `basis`, `displayPrecision`. Served so a surface
   * reads which pillars this finding is ABOUT instead of picking the widest pair for itself.
   *
   * ⚠ DISPLAY GEOMETRY ONLY. Every threshold field (gapFloor, movementFloor, evidencedTier, legs,
   * regimeMap, evidenceStats) is a scoring bar and is stripped before serving — the same narrowing
   * catalogue/serialise.ts applies to the catalogue document. Null for a finding with no record (a red
   * flag, an ownership event): those genuinely have no pillar pair, and inventing one is the defect
   * this field exists to end.
   */
  facts: ServedPatternFacts | null;
  /**
   * The §1.2 severity tier word — `material` / `stretched` / `extreme` — off the finding's own
   * evidence, where the rule stamped it. Null for every CROSSING and MOVEMENT pattern, which have no
   * severity gradient (bands.ts; Trajectory §1.3 inverts the scale outright). A surface that wants to
   * order by tension reads this; it does not re-band a gap.
   */
  tier: string | null;
  /**
   * ★ FORMED or BUILDING — the pattern state, stamped by the rule (D1–D4 today).
   *
   * A threshold grades intensity; it does not gate existence. `building` means the shape holds but at
   * least one leg has not crossed its evidenced threshold — so the card carries NO claim, NO study
   * figure and NO regime clause, and a surface must render it as visibly a different state from
   * `formed` rather than as a weaker version of the same card. Null for patterns that declare no
   * state (D5–D7, S2, T1–T9 — crossings and measured discriminants with no "almost").
   */
  state: "formed" | "building" | null;
  /** This finding's own pair, high/low resolved. Null for a pattern whose subject is not two real
   *  pillars (the composite patterns T1–T4, and the single-pillar T5–T9). */
  pair: DivergencePair | null;
}

export interface FindingsSection {
  redFlags: RedFlagView[];
  patterns: PatternView[];
  /**
   * ★ FINDINGS THAT HAVE ENDED — carried for the tool surfaces, NEVER mixed into `patterns`.
   *
   * They are a separate array, not a flag on a row in the firing set, so a consumer cannot render one
   * as current by forgetting to check a boolean. Each carries its own `lifecycle` with `state:
   * "ended"`, how many periods ago it ended, and — for a gap-basis divergence — whether it converged
   * or collapsed. Bounded to `RECENTLY_ENDED_WINDOW_PERIODS` (4) periods; retired keys are excluded
   * at source, because a rule we withdrew is not a divergence that resolved.
   *
   * ⚠ `null` ≠ `[]`. `[]` is a resolved answer — lifecycles were computed and nothing ended in the
   * window. `null` says this surface DID NOT RESOLVE them at all: the watchlist is a list view over
   * many stocks and a per-stock history walk there would be N× the queries for a fact it does not
   * render. Collapsing the two into `[]` would let a list view silently assert "nothing has ended"
   * about every stock on it.
   */
  recentlyEnded: EndedFindingView[] | null;
  /**
   * ★ NOT-COVERED NOTES — configurations both specs TESTED AND DELIBERATELY DID NOT SHIP.
   *
   * ⚠ THEIR OWN ARRAY, PLAINLY SEPARATE FROM `patterns`, AND THAT IS THE DESIGN. A not-covered note
   * is the record of a decision NOT to make a claim. It carries no severity, no lifecycle, no gap
   * size and no ordering, and it must never be merged into the finding list — the moment a 41-point
   * version reads louder than a 15-point one, the excluded generic-spread pattern is back.
   * See catalogue/not-covered.ts for the four things it must never acquire.
   */
  notCovered: NotCoveredNote[];
  /**
   * ★ THE THIRD SILENT STATE, NAMED. A scored stock can be quiet for two different reasons that used
   * to render identically: nothing tested reliably here (a `NOT_COVERED_RECORDS` trigger matched, so
   * `notCovered` is non-empty), or truly nothing was looked at that had anything to say (`patterns`
   * AND `notCovered` are both empty). This carries the registry-level line for the SECOND case only —
   * `null` whenever there is a pattern firing or a not-covered note already saying something.
   */
  quietNote: string | null;
  /**
   * ★ THE OTHER TOOL, IN TWO LINES. Both tools ignored the other family entirely, so a stock with a
   * divergence AND a trajectory reading showed each surface half its own story with no signpost.
   * Enough to render a summary line and a link — deliberately NOT enough to render a card, because a
   * second card is a duplicate and duplicates are how two surfaces start disagreeing.
   */
  crossTool: CrossToolSummary[];
}

/** A compact per-family digest of what the OTHER tool is showing. */
export interface CrossToolSummary {
  tool: "divergence" | "trajectory";
  /** How many patterns of that tool's families are firing. */
  count: number;
  /** Their display names, in the tool's own order. */
  names: string[];
  /**
   * The single most severe one's headline fact — its OBSERVATION clause, verbatim. Not a new
   * sentence: the same words that tool's own card leads with, so the two cannot drift.
   */
  leadFact: string | null;
  leadPatternKey: string | null;
}

/**
 * ★ AN ENDED FINDING — ITS OWN CARD. What it was, how long it stood, that it has closed, and how.
 *
 * This is the tool proving it was reading something real: a divergence that simply vanished taught the
 * reader nothing, and taught them to distrust the next one. It lives in its own array and carries its
 * own `name` and `clauses` so a surface renders it as a closed card, never as a firing one — the
 * separation is structural, not a flag someone can forget to check.
 */
export interface EndedFindingView {
  patternKey: string;
  /** The catalogue's display title — so the card can say WHAT it was without a second lookup. */
  name: string;
  lifecycle: FindingLifecycle;
  /**
   * The closed-card clause set. `observation` states what the finding was; `movement` carries the
   * closure and — when the resolution typing established it — whether it CONVERGED or COLLAPSED.
   *
   * ⚠ NO `size` AND NO `phase` ON AN ENDED CARD, EVER. Both qualify a claim about a condition that
   * holds NOW, and this one does not hold. Quoting the study's reading beside a closed divergence
   * would attach a live population's outcome to a stock that has left it.
   */
  clauses: VerdictClause[];
  /** The joined closed-card sentence (boundary excluded, same rule as `verdict`). */
  text: string;
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
  /** ★ The LIVE sector regime — see RegimeBadgeView. Null on the not-scored path only. */
  regime: RegimeBadgeView | null;
}
