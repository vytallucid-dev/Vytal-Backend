// File: src/scoring/findings/types.ts
//
// §2/§5 FINDINGS ENGINE — the shared write contract every fire-rule speaks. Built
// against Vytal_StockPage_Sections_2_and_5_Rules_Spec_v1.md (File 1). A fire-rule is
// a PURE function of a FiringContext and returns at most one FiredFinding. The hook
// (score-pass.ts) assembles the context AFTER composite assembly; the persist layer
// writes the fired set linked to the snapshot (append-only — versions WITH the snapshot).
//
// SCOPE NOTE: this is the contract + Stage-A rule shapes. The catalog (~24 rules)
// pours through this same context/finding/persist path in later stages.

import type { LabelBand, Pillar, PillarState } from "../composite/types.js";
import type { OwnershipQuarter } from "../ownership/types.js";
import type { FlowFeeds } from "../ownership/flow.js";
import type { DailyClose } from "../price/range.js";
import type { IndustryType } from "../bars-loader/label-map.js";
import type { FoundationAnnual, MomentumQuarter } from "../metrics/types.js";

/** Mirrors the Prisma `SectorClass` enum. File 1 §2 groups these A=Quality/Defensive,
 *  B=Commodity/Cyclical/PSU, C=Growth. NULL until the sector→class map is populated. */
export type SectorClass = "Quality" | "Defensive" | "Commodity" | "Cyclical" | "Growth" | "PSU";

/** One pillar's value + availability on the current snapshot. STATE is load-bearing:
 *  an unavailable_redistributed pillar persists an INERT-0 subtotal — rules MUST read
 *  `state`, never treat a 0 as a real score (the C1 inert-0 guard). */
export interface PillarSnapshot {
  subtotal: number | null;
  state: PillarState; // "scored" | "unavailable_redistributed"
}

/** One prior snapshot in the ordered per-stock trajectory series (≤ cutoff, oldest→
 *  newest, EXCLUDING current). Carries composite + band + 4 pillar subtotals + each
 *  pillar's availability (derived from the applied weight: 0 ⇒ that pillar was
 *  unavailable that snapshot). Consumed by trajectory rules (B/D/G/I/C-over-time/F2). */
export interface TrajectoryPoint {
  periodKey: string;
  asOfDate: Date;
  composite: number;
  labelBand: LabelBand;
  foundation: number | null;
  momentum: number | null;
  market: number | null;
  ownership: number | null;
  foundationScored: boolean;
  momentumScored: boolean;
  marketScored: boolean;
  ownershipScored: boolean;
}

/** One quarter of operating margin (P11/P12). OPM = operatingProfit / revenue × 100. */
export interface QuarterlyOpmPoint {
  periodKey: string; // "FY26Q3"
  opm: number;
}

/**
 * THE single input bundle a fire-rule reads. Assembled once per member per snapshot.
 * Everything a rule could need: the assembled current snapshot, the ordered prior
 * series (trajectory), the underlying raw series, the price series, the live feeds,
 * the sector class, and the point-in-time cutoff (so trajectory rules never read past
 * the period they fire for). Rules are pure functions of this — no DB, no Date.now.
 */
export interface FiringContext {
  stockId: string;
  symbol: string;
  periodKey: string;
  asOfDate: Date;
  industry: IndustryType; // "non_financial" | "banking"

  /** Point-in-time cutoff threaded from ComputeOpts.pointInTime; null in a live pass.
   *  Trajectory rules must read snapshots/series ≤ this only. */
  cutoff: Date | null;

  /** The assembled CURRENT snapshot — composite + band + the 4 pillar subtotals/states. */
  current: {
    composite: number;
    labelBand: LabelBand;
    pillars: Record<Pillar, PillarSnapshot>;
  };

  /** Ordered prior snapshots (≤ cutoff, oldest→newest, EXCLUDING current). EMPTY for
   *  Stage-A single-snapshot rules; populated by the stage that adds trajectory rules. */
  priorSnapshots: TrajectoryPoint[];

  /** Raw shareholding series, asOnDate ASC (R2/R6/P1–P4/P6…). */
  shareholding: OwnershipQuarter[];
  /** Standalone ANNUAL fundamentals, fiscalYear ASC (R4 D/E history, P8 receivables,
   *  R3/P7 accruals later). Empty for banks — these are non-financial annual rules. */
  annualFundamentals: FoundationAnnual[];
  /** Quarterly OPM series ASC; null for banks / when unavailable (P11/P12). */
  quarterlyOpm: QuarterlyOpmPoint[] | null;
  /** Raw standalone quarterly rows, qOrdinal ASC (R5 TTM interest-coverage, P13 TTM
   *  revenue). Empty for banks. Carries PBT/interest/revenue the OPM series doesn't. */
  quarterlyResults: MomentumQuarter[];
  /** Raw daily closes ASC (§2 realised-vol/drawdown — later stage). */
  daily: DailyClose[];
  /** Insider/block feeds (P5/P6/P10 + card H — later stage; live since the C/D feed). */
  feeds: FlowFeeds;
  /** Sector class-group input (§2 Line 2). Seeded from the ratified map; null only for an
   *  unmapped sector (none today). */
  sectorClass: SectorClass | null;
  /** Band-typical 4-pillar medians (F1 atypical-for-band). Computed once per pass over the
   *  universe's head snapshots ≤ cutoff; null when not computed (legacy callers). */
  bandTypicalProfiles?: import("./composition/band-typical.js").BandTypicalProfiles | null;
}

export type FindingKind = "red_flag" | "pattern";
/** File 1 §5E — the three mandatory pattern display states. */
export type FindingDisplayState = "active" | "pending_data_integration" | "dampened";

/**
 * The emit shape every rule returns. ONE finding = one card. `evidence` is the JSON the
 * UI reads to build the verdict sentence (it MUST carry the real breaching stat). The
 * persist layer maps `evidence` → RedFlag.triggeringValues (red_flag) or
 * ScorePattern.evidence (pattern), and `metricRefs` → ScorePattern.metricRefs.
 */
export interface FiredFinding {
  kind: FindingKind;
  /** RedFlag.flagKey (red flags) or ScorePattern.patternKey (patterns). */
  key: string;
  /** Red flags: "critical" (File 1 §5A). Patterns: the family-native severity token —
   *  E-patterns use red/amber/green (§5E), structural cards use high/medium/low/recovery
   *  (§5B–I). The read layer maps token → accent colour. FLAG: File 1 doesn't explicitly
   *  reconcile the two palettes — a read-layer concern to confirm. */
  severity: string;
  /** Pattern polarity (positive/negative); null/absent for red flags. */
  direction?: "positive" | "negative" | null;
  /** Pattern effective score impact (§5E: +5/−3/−8/±5). Null for red flags AND for the
   *  structural cards (B/C/D/F/G/H/I) which carry no §5E magnitude. A dampened pattern
   *  stores the HALVED value. */
  magnitude?: number | null;
  displayState?: FindingDisplayState; // patterns; defaults "active"
  /** UI-facing evidence JSON — the breaching stat(s) for the verdict sentence. */
  evidence: Record<string, unknown>;
  /** metricKeys / pillars the finding concerns (ScorePattern.metricRefs). */
  metricRefs?: string[];
}

/** A fire-rule: pure function of the context, returns a finding or null (no fire). */
export type FireRule = (ctx: FiringContext) => FiredFinding | null;
