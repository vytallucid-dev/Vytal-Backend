// File: src/scoring/read/universe-view.types.ts
//
// Universe-level aggregate read-model: all ~93 scored stocks folded into one
// ScopeAggregate. Mirrors PeerGroupHealthView structure minus pond-identity
// (the scope IS the full universe), plus the sinceLastWeek 7-day delta block
// for the Hub Briefing.
//
// Reuses from peer-group-view.types:
//   PeerGroupMemberView  — per-stock roster row (extended with sector here)
//   PathologyCensusItem  — flag/pattern census (reach thresholds rescaled for N≈93)
//   PeerGroupAggregate   — aggregate stats (identical field contract)
//   PeerGroupMover       — risers/slippers

import type { LabelBand, PillarKey } from "./health-view.types.js";
import type { ScopeDispersion } from "./scope-aggregate.js";
import type {
  BandDistribution,
  PeerGroupMemberView,
  PathologyCensusItem,
  PeerGroupMover,
} from "./peer-group-view.types.js";

export type { PeerGroupMemberView, PathologyCensusItem, PeerGroupMover };

/** Universe-level member row. Extends PeerGroupMemberView with `sector` for the
 *  Hub Overview table's sector grouping / filter column. */
export interface UniverseMemberView extends PeerGroupMemberView {
  sector: { key: string; displayName: string } | null;
}

/** Identical field contract to PeerGroupAggregate. */
export interface UniverseAggregate {
  scoredCount: number;
  medianComposite: number;
  meanComposite: number;
  /** Median composite of the same stocks one period back. null at the earliest period. */
  priorMedianComposite: number | null;
  /** medianComposite − priorMedianComposite. null when prior is null. */
  medianDrift: number | null;
  /** The immediate-prior periodKey the drift is measured against. */
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

/** What changed in the trailing 7 days.
 *
 *  Comparison: current in-force snapshot vs oldest available baseline within the
 *  window. Primary baseline = MAX version at current period WHERE asOfDate ≤ anchor
 *  (today−7). Fallback when no pre-anchor version exists (new scoring period started
 *  inside the window): use the OLDEST version at the current period — e.g. v1@Jun-18
 *  vs v2@Jun-20 when FY26Q4 scoring started Jun-18.
 *
 *  Honest scope: snapshots are quarterly + EOD price-driven rescores. The 7-day
 *  window catches price-driven Market-pillar moves and any rescores committed this
 *  week — not weekly fundamental churn (quarterly by nature). Band crossings are
 *  almost entirely market-pillar-led. */
export interface UniverseSinceLastWeek {
  /** today − 7 days, YYYY-MM-DD */
  anchorDate: string;
  /** Stocks with a newer in-force version than what existed at the anchor. */
  newVersionCount: number;
  bandCrossings: Array<{
    symbol: string;
    from: LabelBand;
    to: LabelBand;
    /** "up" = improved band, "down" = deteriorated. */
    direction: "up" | "down";
  }>;
  newFlags: Array<{
    symbol: string;
    flagKey: string;
    severity: string | null;
  }>;
  /** Stocks whose composite fell ≥2 pts vs the anchor version (sorted worst-first). */
  newDeteriorations: Array<{
    symbol: string;
    delta: number;
    fromComposite: number;
    toComposite: number;
    fromBand: LabelBand;
    toBand: LabelBand;
  }>;
  /** Stocks whose composite rose ≥2 pts vs the anchor version (sorted best-first). */
  newRecoveries: Array<{
    symbol: string;
    delta: number;
    fromComposite: number;
    toComposite: number;
    fromBand: LabelBand;
    toBand: LabelBand;
  }>;
  honestNote: string;
}

export interface UniverseHealthView {
  scored: boolean;
  periodKey: string | null;
  asOfDate: string | null;
  /** Total stocks scored in the cross-section — the M for pathology reach ratios. */
  scoredUniverseSize: number;
  aggregate: UniverseAggregate | null;
  /** Full roster descending by composite. */
  members: UniverseMemberView[];
  /** Members at an older period than the cross-section — listed, never silently folded in. */
  notAtCurrentPeriod: { symbol: string; latestPeriod: string }[];
  /** Flag + pattern census universe-wide.
   *  Reach thresholds: isolated (N=1) | cluster (N≥2 and N/M<0.20) | widespread (N/M≥0.20).
   *  Scaled down from the pond's 0.50 — 20% of a 93-stock universe is systemic. */
  pathology: PathologyCensusItem[];
  /** Top-10 risers / slippers vs the prior period. */
  movers: { risers: PeerGroupMover[]; slippers: PeerGroupMover[] };
  sinceLastWeek: UniverseSinceLastWeek;
}
