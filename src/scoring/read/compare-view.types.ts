// File: src/scoring/read/compare-view.types.ts
//
// Read-model for the COMPARISON view — the exact JSON shape returned by
// GET /api/compare?a=SYMBOL1&b=SYMBOL2 (stock-vs-stock).
//
// This is NOT a new data bank. The comparison service fetches BOTH entities' existing
// per-stock views (health, fundamentals, price, ownership) in parallel and runs the
// ALIGNMENT logic — it decides what is honestly comparable and emits ONE curated
// payload. The real product is the alignment manifest, not the raw numbers.
//
// THE PHILOSOPHY (non-negotiable, encoded as guardrails below):
//   • It NEVER declares a winner. No overallWinner, no aWins/bWins, no per-metric
//     "winner" flag, no score tally. The payload presents both values; the user reads.
//   • Universal metrics line up for ANY two stocks. Family-specific metrics line up
//     ONLY within the same family — across families they move to a labeled
//     `familyContext` section and are NEVER placed side-by-side.
//   • sectorClass IS exposed: CompareeIdentity carries each entity's class; ComparisonView
//     carries a top-level classContext with an interpretive note. Class-framing is context
//     only — no prediction, no recommendation, no winner via class language.
//   • No phantom metrics — only real fields from the actual per-stock payloads.
//   • Honest-empty per metric — a null value stays null, never fabricated.
//
// CONVENTIONS (mirror health-view / fundamentals-view): numbers are JS numbers; a
// metric with no backing data is `null` with the key PRESENT; every value is already
// canonical (percent as percent, money as ₹ Cr, ratios/multiples as-is).

import type {
  IndustryFamily,
  QuarterPoint,
  AnnualSnapshot,
  BankingQuarter,
  BankingAnnual,
  NbfcQuarter,
  NbfcAnnual,
  LifeInsuranceQuarter,
  LifeInsuranceAnnual,
  GeneralInsuranceQuarter,
  GeneralInsuranceAnnual,
} from "./fundamentals-view.types.js";
import type { InsiderEvent, BlockEvent } from "./ownership-series.types.js";
import type {
  LabelBand,
  PillarKey,
  PillarView,
  SectorClass,
  TrajectoryMarker,
  TrajectoryPoint,
  DivergenceFlag,
  FindingsSection,
  PondMask,
} from "./health-view.types.js";

/** TWO-TIER comparability — the only two states. `same_family` → full comparison
 *  (universal axis + that family's specific set, directly comparable). `cross_family`
 *  → universal axis only; family-specific metrics suppressed from the side-by-side
 *  (moved to `familyContext`, NOT directly comparable) + a warning. */
export type Comparability = "same_family" | "cross_family";

/** A metric's display unit — drives the frontend's formatter. No verdict semantics. */
export type MetricUnit =
  | "score" // 0–100 health composite / pillar subtotal
  | "band" // LabelBand string (fragile…pristine)
  | "marker" // TrajectoryMarker string
  | "flag" // DivergenceFlag string
  | "pct" // percent (e.g. 18.2 = +18.2%)
  | "cr" // ₹ crore
  | "rupees" // ₹ per share
  | "ratio" // dimensionless ratio
  | "multiple"; // a leverage/solvency multiple (e.g. 3.13×) — NEVER a percent

/** One UNIVERSAL metric, paired side-by-side. These line up for ANY two stocks
 *  regardless of family — this is the always-comparable axis. */
export interface UniversalMetric {
  key: string;
  label: string;
  unit: MetricUnit;
  /** number for quantitative metrics; string for band/marker/flag; null = honest-empty. */
  aValue: number | string | null;
  bValue: number | string | null;
}

/** One FAMILY-SPECIFIC metric for a single entity. Shown in `familyContext`, labeled.
 *  Placed side-by-side as directly-comparable ONLY when both entities share the family
 *  (comparability === "same_family"). */
export interface FamilyMetric {
  key: string;
  label: string;
  unit: MetricUnit;
  value: number | null;
}

/** THE FULL STATEMENT SERIES for one entity — the SAME family-shaped `quarters[]` +
 *  `annualSeries[]` the per-stock Fundamentals tab already renders, forwarded verbatim
 *  (ZERO re-mapping; ZERO new reads — the fundamentals view is already fetched). Both are
 *  oldest→newest; annual (latest) == annualSeries[last]. A discriminated union on `family`
 *  so the frontend picks the right per-family line-defs. Insurers carry NO cash flow (their
 *  annual shape has no CFO/CFI/CFF) — honest absence, not a gap. Present on both same- and
 *  cross-family payloads; the frontend decides the layout off `familyContext.comparableDirectly`. */
export type CompareeStatements =
  | { family: "non_financial"; quarters: QuarterPoint[]; annualSeries: AnnualSnapshot[] }
  | { family: "banking"; quarters: BankingQuarter[]; annualSeries: BankingAnnual[] }
  | { family: "nbfc"; quarters: NbfcQuarter[]; annualSeries: NbfcAnnual[] }
  | { family: "life_insurance"; quarters: LifeInsuranceQuarter[]; annualSeries: LifeInsuranceAnnual[] }
  | { family: "general_insurance"; quarters: GeneralInsuranceQuarter[]; annualSeries: GeneralInsuranceAnnual[] };

/** Each entity's within-PG standing. NEVER compared across entities unless they sit
 *  in the SAME peer group (see `peerStandingComparable`) — ranks are relative to
 *  different member sets and don't line up otherwise. */
export interface CompareePeerStanding {
  peerGroupId: string;
  peerGroupName: string | null;
  rank: number;
  percentile: number;
  memberCount: number;
  perPillarRank: Record<PillarKey, { rank: number; outOf: number }>;
}

/** Interpretive class context for the comparison pair — present when both entities have
 *  a known sectorClass (20/20 fine-grained sectors are populated). null when either side
 *  is a coarse-bucket sector (honest-empty). The note reuses §2-Line-2 group vocabulary;
 *  it is interpretive context only — never a prediction or recommendation. */
export interface ClassContext {
  aClass: Exclude<SectorClass, null>;
  bClass: Exclude<SectorClass, null>;
  /** true when both entities share the exact same sectorClass */
  sameClass: boolean;
  note: string;
}

/** Lightweight identity for an entity in the comparison. */
export interface CompareeIdentity {
  sector: { key: string; displayName: string } | null;
  /** Sector archetype — null for coarse-bucket sectors (honest-empty). */
  sectorClass: SectorClass;
  peerGroup: { id: string; name: string; displayName: string; memberCount: number } | null;
  asOfDate: string;
  periodKey: string;
}

/** One side of the comparison — A or B. `universal` holds this entity's raw universal
 *  values (keyed); the top-level `universalMetrics` pairs A's and B's for the
 *  side-by-side. `familySpecific` holds this entity's family-locked metrics. */
export interface Comparee {
  symbol: string;
  name: string;
  family: IndustryFamily;
  /** Display label for the family (e.g. "Banking", "Non-Financial"). */
  familyLabel: string;
  scored: boolean;
  identity: CompareeIdentity;
  universal: {
    composite: number | null;
    band: LabelBand | null;
    trajectoryMarker: TrajectoryMarker | null;
    divergenceFlag: DivergenceFlag | null;
    divergenceGap: number | null;
    foundation: number | null;
    momentum: number | null;
    market: number | null;
    ownership: number | null;
    roe: number | null;
    basicEps: number | null;
    bookValuePerShare: number | null;
    patGrowthYoy: number | null;
    totalAssets: number | null;
    netWorth: number | null;
    // BS + CF comparable metrics — cross-family-meaningful (present AND same meaning in every
    // family). totalDebt = borrowings; insurers have NO cash flow → their CFO/CFI/CFF stay null
    // (honest-empty, dashed — not a gap). These enrich the cross-family universal table beyond P&L.
    totalDebt: number | null;
    cashAndCashEquivalents: number | null;
    cashFromOperating: number | null;
    cashFromInvesting: number | null;
    cashFromFinancing: number | null;
    return1y: number | null;
    return3y: number | null;
    pctFrom52WHigh: number | null;
    pctFrom52WLow: number | null;
    promoterPct: number | null;
    fiiPct: number | null;
    diiPct: number | null;
    pledgedPctOfPromoter: number | null;
    /** Live market cap (₹ Cr) from the price view — scoring-INDEPENDENT, present for unscored
     *  stocks too. Feeds the Overview's size/identity universal sections. null when no shares /
     *  split-gated. */
    marketCap: number | null;
  };
  familySpecific: FamilyMetric[];
  /** THE FULL STATEMENT SERIES — this entity's family-shaped `quarters[]` + `annualSeries[]`,
   *  forwarded verbatim from the per-stock fundamentals view (ZERO re-mapping; ZERO extra reads).
   *  Drives the same-family side-by-side statements AND the cross-family per-stock statement
   *  blocks. Insurers carry no CF (honest absence). null only when the fundamentals view has no
   *  payload for the family (defensive — never in practice). */
  statements: CompareeStatements | null;
  /** Per-pillar metric breakdown — passed through verbatim from this entity's health
   *  view (already fetched by fetchEntity; ZERO extra reads). Foundation/Momentum carry
   *  `metrics[]`, Market carries `marketSubs[]`, Ownership carries `ownership`. Per-pillar
   *  metric KEYS for foundation/momentum are family-specific, so they line up side-by-side
   *  ONLY same-family (the same `familyContext.comparableDirectly` gate); market subs and
   *  the ownership structure are universal. The compare service does NOT re-rank these —
   *  it forwards what the health view already computed. */
  pillars: PillarView[];
  /** THE QUALITATIVE HEALTH LAYER — all four fields below are straight pass-throughs of
   *  this entity's health view (already fetched by fetchEntity; ZERO extra reads). They are
   *  rendered PER ENTITY, never row-paired against the other side.
   *
   *  Fired findings (patterns + red flags). The findings engine already prunes by family
   *  at fire-time (a bank can never fire the 6 non-financial-only patterns), so a
   *  cross-family pair's two lists are honest with NO extra gating here — each entity simply
   *  shows what it fired. A pattern present for one and absent for the other is just absent. */
  findings: FindingsSection | null;
  /** Composite-score HISTORY on the universal 0–100 scale. Both entities' series live on the
   *  same axis, so they overlay directly on one shared time axis (the trajectory overlay) —
   *  the temporal shape of difference a static side-by-side can't show. Factual: the score
   *  path over time, never a "pulling ahead" verdict. */
  trajectorySeries: TrajectoryPoint[];
  /** PG-level pond heat — a fact about THIS entity's OWN peer group, NEVER cross-compared
   *  (the two stocks sit in different ponds with different distributions; comparing pond
   *  temperatures is the same error as comparing ranks across different peer groups). */
  pondMask: PondMask | null;
  /** Composite trajectory delta (universal 0–100 movement) — stated per entity. */
  trajectoryDelta: number | null;
  peerStanding: CompareePeerStanding | null;
  /** Recent insider / block-deal activity — straight pass-through of this entity's ownership
   *  view events (already fetched by fetchEntity; ZERO extra reads). Per entity, never row-paired.
   *  These feeds are wired-but-dormant today (no live feed) → arrays are empty → the UI shows the
   *  honest "awaiting feed" state; they light up when the feed lands. Newest-first, capped 25. */
  events: { insider: InsiderEvent[]; block: BlockEvent[] };
}

/** THE top-level read-model returned by GET /api/compare?a=…&b=…. */
export interface ComparisonView {
  a: Comparee;
  b: Comparee;
  comparability: Comparability;
  /** The always-line-up axis — paired A vs B. Rendered as the direct side-by-side. */
  universalMetrics: UniversalMetric[];
  /** Family-specific metrics, shown LABELED and separate. `comparableDirectly` is true
   *  ONLY when same_family — then the two arrays line up; otherwise they are shown as
   *  independent family context and must NOT be placed side-by-side. */
  familyContext: {
    a: FamilyMetric[];
    b: FamilyMetric[];
    comparableDirectly: boolean;
  };
  /** Honest comparability boundary statements — empty when fully comparable. */
  warnings: string[];
  /** false when the two stocks sit in different peer groups (or either lacks standing)
   *  — their within-PG ranks are NOT comparable. */
  peerStandingComparable: boolean;
  /** Class-level interpretive context — present when both entities have a known
   *  sectorClass; null when either is a coarse-bucket sector (honest-empty). */
  classContext: ClassContext | null;
}
