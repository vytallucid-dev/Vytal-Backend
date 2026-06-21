// File: src/scoring/read/peer-group-view.types.ts
//
// THE CANONICAL peer-group aggregate read-models. Two shapes:
//   • PeerGroupListItem[]   ← GET /api/peer-groups            (the index page)
//   • PeerGroupHealthView   ← GET /api/peer-groups/:id/health (the Health tab)
//
// Mirror these verbatim into the frontend types. SAME conventions as
// HealthSnapshotView: every number is a JS number; a field with no backing data is
// `null` with the key PRESENT — never omitted, never fabricated. The descriptor is
// templated from real numbers (see scope-aggregate.describeScope).

import type {
  LabelBand,
  PillarKey,
  MetricBand,
  BarDirection,
  SectorClass,
  TrajectoryMarker,
  DivergenceFlag,
  FlowCategoryState,
} from "./health-view.types.js";
import type { ScopeDispersion } from "./scope-aggregate.js";

export type BandDistribution = Record<LabelBand, number>;

export interface SectorRef {
  key: string;
  displayName: string;
}

// ── LIST ─────────────────────────────────────────────────────────────────────

/** One lightweight card on the index page. When `scored` is false the pond has no
 *  in-force snapshots — every aggregate field is null (10 of 23 ponds today). */
export interface PeerGroupListItem {
  id: string;
  name: string;
  displayName: string;
  /** Parent sector (PeerGroup.sectorId) — for grouping cards under sector headers
   *  (banks: Private + PSU both under "Banks"). null only if the link is missing. */
  sector: SectorRef | null;
  /** Roster size (PeerGroup.stockCount). */
  memberCount: number;
  scored: boolean;
  periodKey: string | null;
  asOfDate: string | null; // YYYY-MM-DD
  /** Members folded into the aggregate (scored at the period; may be < memberCount). */
  scoredCount: number;
  medianComposite: number | null;
  meanComposite: number | null;
  bandDistribution: BandDistribution | null;
  dispersion: { stdDev: number; iqr: number } | null;
  range: { min: number; max: number } | null;
  /** Templated from median band + dispersion (e.g. "healthy, tight"). null when unscored. */
  descriptor: string | null;
  /** Members currently firing ≥1 red flag — the attention indicator. */
  redFlagMemberCount: number;
}

// ── DETAIL ───────────────────────────────────────────────────────────────────

export interface PeerGroupIdentity {
  id: string;
  name: string;
  displayName: string;
  sector: SectorRef | null;
  /** Sector archetype (Sector.sectorClass) — null when unset. */
  sectorClass: SectorClass;
  /** "banking" | "non_financial" from members' snapshots; "mixed" if a pond spans both. */
  industryPath: "banking" | "non_financial" | "mixed" | null;
  memberCount: number; // roster
  periodKey: string | null;
  asOfDate: string | null;
}

export interface PeerGroupAggregate {
  scoredCount: number;
  medianComposite: number;
  meanComposite: number;
  /** Median composite of the SAME members one period back. null when no prior
   *  period exists (pond at its earliest scored quarter). */
  priorMedianComposite: number | null;
  /** medianComposite − priorMedianComposite. null when prior is null. */
  medianDrift: number | null;
  /** The immediate-prior periodKey the drift is measured against. null when absent. */
  priorPeriodKey: string | null;
  dispersion: ScopeDispersion;
  range: {
    min: { symbol: string; composite: number };
    max: { symbol: string; composite: number };
  } | null;
  /** Raw composites ASCENDING — the distribution strip substrate. */
  composites: number[];
  bandDistribution: BandDistribution;
  pillarMedians: Record<PillarKey, number>;
  redFlagMemberCount: number;
  descriptor: string;
}

export interface FiredFlag {
  flagKey: string;
  severity: string | null;
  tier: "auto" | "review";
}
export interface FiredPattern {
  patternKey: string;
  direction: string | null;
  severity: string | null;
  /** File 1 §5E display state; defaults "active". */
  displayState?: "active" | "pending_data_integration" | "dampened";
}

export interface PeerGroupMemberView {
  symbol: string;
  name: string;
  composite: number;
  labelBand: LabelBand;
  /** Four pillar subtotals. */
  pillars: Record<PillarKey, number>;
  /** From the member's own in-force series (last two composites); null when <2 periods. */
  trajectoryMarker: TrajectoryMarker | null;
  trajectoryDelta: number | null;
  /** Spread across the member's SCORED pillars (same rule as the stock view). */
  divergence: { flag: DivergenceFlag; gap: number };
  firedFlags: FiredFlag[];
  firedPatterns: FiredPattern[];
  /** C/D ownership flow-category state — read-projection of score_ownership_flows.category_state.
   *  undefined when the stock has no shareholding data (own=null in the scoring pass). */
  flowCategoryStates?: { C_insider: FlowCategoryState; D_block: FlowCategoryState };
}

/** How widely a flag/pattern is shared across the pond — the clustering read. */
export type PathologyReach = "isolated" | "cluster" | "widespread";

export interface PathologyCensusItem {
  kind: "red_flag" | "pattern";
  key: string;
  /** Worst severity seen across firing members. */
  severity: string | null;
  memberCount: number; // N firing
  outOf: number; // M scored at period
  members: string[]; // symbols firing, worst-first then alpha
  /** isolated (N=1) | widespread (N/M ≥ 0.5) | cluster (between). */
  reach: PathologyReach;
  /** Dominant display state across firing members (File 1 §5E). A pattern dampened PG-wide
   *  (>80%) surfaces as "dampened" so the board can show the sector-wide chip. Defaults "active". */
  displayState?: "active" | "pending_data_integration" | "dampened";
}

export interface PeerMetricMemberPoint {
  symbol: string;
  rawValue: number;
  l1Band: MetricBand | null;
  scoreState: string;
}

/** One metric's cross-section: per-member raw values + the persisted peer μ/σ/N
 *  (usable-guarded) + the data-derived bar thresholds. The metric-explorer substrate. */
export interface PeerMetricDistribution {
  metricKey: string;
  pillar: "foundation" | "momentum";
  direction: BarDirection | null;
  bars: {
    excellent: number;
    good: number;
    acceptable: number;
    concerning: number;
    distress: number;
  } | null;
  /** From score_peer_stats (period-keyed). `usable` = sampleN≥5 && stdDev>0 — when
   *  false the values surface for transparency but the UI must NOT draw a curve. */
  peer: { mean: number; stdDev: number; sampleN: number; usable: boolean } | null;
  /** Only members with a SCORED row for this metric (row-absence convention). */
  members: PeerMetricMemberPoint[];
}

export interface PeerGroupMover {
  symbol: string;
  composite: number;
  priorComposite: number;
  delta: number;
  fromPeriod: string;
  toPeriod: string;
}

export interface PeerGroupHealthView {
  scored: boolean;
  identity: PeerGroupIdentity;
  /** null only when the pond has no in-force snapshots. */
  aggregate: PeerGroupAggregate | null;
  /** Full roster of members scored at the current period. */
  members: PeerGroupMemberView[];
  /** Roster members whose latest in-force snapshot is at an OLDER period (e.g.
   *  NESTLEIND@FY26Q2) — listed, never silently folded into the cross-section. */
  notAtCurrentPeriod: { symbol: string; latestPeriod: string }[];
  pathology: PathologyCensusItem[];
  metricDistributions: PeerMetricDistribution[];
  movers: { risers: PeerGroupMover[]; slippers: PeerGroupMover[] };
}
