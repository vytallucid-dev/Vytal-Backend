// File: src/scoring/ownership/ownership.ts
//
// THE COMPLETE OWNERSHIP PILLAR (Primary + Flow + clamp). Top-level orchestrator.
//
//   Final Ownership = clamp( Primary Subtotal + clamp(Flow Adjustment, −12, +12), 40, 100 )
//
// Computation order (per stock per snapshot), every intermediate a STORED,
// DECOMPOSABLE fact (CN-6):
//   Primary Subtotal (baseline + pledging + R2/R6/PF)        [built earlier]
//   → A (cap [−4,+6]) → B (cap [−6,+6]) → C+trend (cap [−8,+5]) → D+trend (cap [−6,+6])
//   → Flow Adjustment = A+B+C+D, clamp [−12,+12]
//   → Final Ownership = clamp(Primary + Flow, 40, 100)
//
// FIREWALL: R2's fired-state is computed ONCE in Primary and PASSED to Flow's
// Category A (so a >5pp promoter exit is scored by R2 only, never also by A3).

import { computePrimaryOwnership, type PrimaryOwnershipResult } from "./primary.js";
import { clamp, computeFlow, type FlowFeeds, type FlowResult, type PriceProbe } from "./flow.js";
import type { OwnershipQuarter } from "./types.js";

export const OWNERSHIP_FLOOR = 40;
export const OWNERSHIP_CEIL = 100;

export interface OwnershipContext {
  /** Probes the A1 inter-filing-window 52-week-range-dip condition. null = no price feed. */
  priceProbe: PriceProbe | null;
  /** C/D continuous feeds. In this build both are null → C/D dormant_no_feed. */
  feeds: FlowFeeds;
}

export interface OwnershipResult {
  symbol: string;
  snapshot: PrimaryOwnershipResult["snapshot"];
  primary: PrimaryOwnershipResult;
  flow: FlowResult;
  flowAdjustmentRaw: number;
  flowAdjustmentClamped: number;
  /** clamp(primarySubtotal + flowAdjustmentClamped, 40, 100) — the REAL pillar value. */
  finalOwnership: number;
  flowApplied: true;
  clampApplied: true;
}

/**
 * Compute the complete Ownership pillar for one stock at one snapshot. PURE
 * (price/feeds are injected via `ctx`; no DB).
 */
export function computeOwnership(
  symbol: string,
  rows: OwnershipQuarter[],
  ctx: OwnershipContext,
  snapshotIdx: number = rows.length - 1,
): OwnershipResult | null {
  const primary = computePrimaryOwnership(symbol, rows, snapshotIdx);
  if (!primary) return null;

  const flow = computeFlow(rows, snapshotIdx, primary.r2.fired, ctx);
  const finalOwnership = clamp(
    primary.primarySubtotal + flow.flowAdjustmentClamped,
    OWNERSHIP_FLOOR,
    OWNERSHIP_CEIL,
  );

  return {
    symbol,
    snapshot: primary.snapshot,
    primary,
    flow,
    flowAdjustmentRaw: flow.flowAdjustmentRaw,
    flowAdjustmentClamped: flow.flowAdjustmentClamped,
    finalOwnership,
    flowApplied: true,
    clampApplied: true,
  };
}
