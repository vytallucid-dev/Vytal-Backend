// File: src/scoring/read/ownership-series.types.ts
//
// Read-model for the OWNERSHIP-OVER-TIME view (the Ownership research tool's
// differentiating data — ownership history doesn't exist in getSnapshotSeries,
// which carries only the ownership scalar). Two time series + the current anatomy:
//
//   • series   — per in-force period: flow lanes (4 categories w/ state) + the
//                point-in-time holding split (promoter/FII/DII/retail)
//   • pledging — promoter pledge % / shares over time (point-in-time, asOnDate-ordered)
//   • current  — the latest period's full ownership anatomy (baseline, penalties, R1)
//
// CONVENTIONS (mirror health-view): numbers are JS numbers; a field with no backing
// data is null with the key PRESENT; BigInt share counts are stringified.

import type { FlowCategoryView } from "./health-view.types.js";

/** The holding split at a point in time (the ShareholdingPattern with the latest
 *  asOnDate ≤ the period's asOfDate — no lookahead).
 *
 *  PLEDGING is derived from the BigInt SHARE COUNTS, never the Decimal
 *  promoter_pledged_pct column (which has a unit inconsistency — 60.57 vs 0.6057 for
 *  the same value; an ingestion bug). `pledgedPctOfPromoter` (pledged ÷ promoter
 *  shares) is the headline — it matches the scoring engine's R1 definition. */
export interface OwnershipHolding {
  asOnDate: string; // YYYY-MM-DD — the observation actually used (point-in-time)
  promoterPct: number | null;
  fiiPct: number | null;
  diiPct: number | null;
  retailPct: number | null;
  othersPct: number | null;
  pledgedPctOfPromoter: number | null; // pledgedShares / promoterShares × 100 (headline, R1-aligned)
  pledgedPctOfTotal: number | null; // pledgedShares / totalShares × 100 (secondary)
}

/** One period of the flow-lane series (lean — the full anatomy is in `current`). */
export interface OwnershipSeriesPoint {
  periodKey: string;
  asOfDate: string;
  baseline: number;
  pledgingAdjustment: number;
  primarySubtotal: number;
  flowAdjustmentClamped: number;
  finalOwnership: number;
  r1Fired: boolean;
  flowCategories: FlowCategoryView[]; // 4 lanes, each w/ categoryState (dormant lanes carried, never dropped)
  holding: OwnershipHolding | null;
}

/** One pledging observation (ShareholdingPattern, point-in-time). Pledge % derived
 *  from share counts (the Decimal pledge columns are unreliable — see OwnershipHolding). */
export interface PledgingPoint {
  asOnDate: string;
  sourceDate: string;
  fiscalYear: string;
  quarter: string;
  pledgedPctOfPromoter: number | null; // headline, R1-aligned
  pledgedPctOfTotal: number | null; // secondary
  pledgedShares: string | null; // BigInt → string (raw, for transparency)
  promoterShares: string | null;
  totalShares: string | null;
}

/** The current-period full ownership anatomy (same shape as health-view's OwnershipDetail). */
export interface OwnershipAnatomy {
  periodKey: string;
  asOfDate: string;
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
  holding: OwnershipHolding | null;
}

/** One insider trade event from the raw InsiderTrade table (NSE PIT disclosures).
 *  Always arrays — empty when no events in window. */
export interface InsiderEvent {
  tradeDate: string | null; // YYYY-MM-DD (nullable — some disclosures omit exact date)
  personName: string;
  personCategory: string; // "promoter" | "promoter_group" | "director" | "kmp" | "designated_employee" | "immediate_relative" | "other"
  transactionType: string; // "buy" | "sell" | "pledge" | "revoke_pledge" | "inter_se_transfer" | "esos" | "other"
  securitiesTraded: string | null; // Decimal(18,0) stringified — large share counts lose precision as float
  holdingPctDelta: number | null; // holdingPctPost − holdingPctPre (can be 0.0000)
  tradeValueCr: number | null; // ₹ crore (securitiesTraded × price / 1e7)
  acquisitionMode: string | null; // "market" | "off_market" | "preferential_allotment" | ...
  regulation: string; // "7(2)" | "7(3)" | "29(1)" | ...
}

/** One block/bulk deal event from the raw BlockDeal table. */
export interface BlockEvent {
  dealDate: string; // YYYY-MM-DD
  dealType: string; // "bulk" | "block"
  clientName: string;
  transactionType: string; // "buy" | "sell"
  quantity: string; // BigInt stringified
  price: number;
  valueCr: number | null; // ₹ crore (qty × price / 1e7)
}

export interface OwnershipSeriesView {
  symbol: string;
  name: string;
  windowQuarters: number;
  scored: boolean; // false when the stock has no in-force ownership history (alias of hasScoredPeriod)
  hasScoredPeriod: boolean; // true → flow-lane sub-scores / baseline / R1 verdict are populated.
  // The raw ledger (holding split, pledging, insider, block) populates whenever its rows
  // exist, INDEPENDENT of this flag — the UI gates only the score-derived sections on it.
  series: OwnershipSeriesPoint[]; // oldest → newest
  pledging: PledgingPoint[]; // oldest → newest
  current: OwnershipAnatomy | null;
  events: {
    insider: InsiderEvent[]; // newest first, capped at 25 in window — empty array when none
    block: BlockEvent[]; // newest first, capped at 25 in window — empty array when none
  };
}
