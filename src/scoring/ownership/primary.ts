// File: src/scoring/ownership/primary.ts
//
// OWNERSHIP PRIMARY — the orchestrator. Assembles the PRIMARY SUBTOTAL:
//
//   primarySubtotal = baseline
//                   + pledging ladder adjustment
//                   + R2 penalty + R6 penalty + prolonged-FII penalty
//
// The subtotal is NOT clamped here. Ownership = Primary Subtotal + Flow Adjustment
// → clamp(40,100), and BOTH the Flow Adjustment and the final 40–100 clamp are a
// LATER build. For now the Primary Subtotal is stored AS-IS and used as the
// Ownership pillar's current value, with an explicit flowApplied=false /
// clampApplied=false marker so any composite computed now consumes a Primary-only,
// honestly-labelled Ownership.
//
// Every intermediate is a STORED, DECOMPOSABLE fact (CN-6): "why is Ownership X?"
// is answerable from the returned object (and the rows persist.ts writes from it).
//
// PURE: no DB, no side effects. Crypto hashing is deterministic.

import { createHash } from "node:crypto";
import { computeBaseline, type BaselineResult } from "./baseline.js";
import { computePledging, type PledgingResult } from "./pledging.js";
import {
  computeProlongedFii,
  computeR2,
  computeR6,
  type ProlongedFiiResult,
  type R2Result,
  type R6Result,
} from "./disturbances.js";
import { periodKeyOf, quarterLabel, type OwnershipQuarter } from "./types.js";

/**
 * A red flag the Primary engine DETECTED but whose score_red_flags ROW is DEFERRED.
 * A RedFlag row requires a ScoreSnapshot (snapshot_id NOT NULL), which requires the
 * three other pillars (out of scope this build). The flag is COMPUTED, returned,
 * and stored decomposably on the OwnershipScore inputs — only the row write waits
 * for the composite/snapshot build. (R1 is, per spec, a red flag — NOT a pillar nudge.)
 */
export interface DeferredRedFlag {
  flagKey: string; // e.g. "ownership_R1_pledge"
  severity: string; // "critical" (File 1 §5A — red flags are Critical)
  tier: "auto" | "review";
  triggeringValues: Record<string, unknown>;
  reasons: string[];
  persistenceDeferred: true;
}

export interface PrimaryOwnershipResult {
  symbol: string;
  snapshot: {
    asOnDate: Date;
    quarter: string;
    fiscalYear: string;
    periodKey: string; // "FY26Q3" — PillarScore.sourcePeriod
    label: string; // human-readable
    index: number; // index into the series that was scored
  };

  baseline: BaselineResult;
  pledging: PledgingResult;
  r2: R2Result;
  r6: R6Result;
  prolongedFii: ProlongedFiiResult;

  /** baseline + ladder + R2 + R6 + PF. UNCLAMPED (clamp deferred to post-Flow). */
  primarySubtotal: number;

  // Honest markers: this is Primary-only, pre-clamp.
  flowApplied: false;
  clampApplied: false;

  /** Detected red flags whose row write is deferred (R1, …). */
  redFlags: DeferredRedFlag[];

  /** Deterministic hash of the ownership INPUT set up to & incl. the snapshot,
   * INCLUDING the period key. persist.ts folds the spec version into this to form
   * the PillarScore identity (ruling-2 skip-identical / event-driven versioning). */
  dataFingerprint: string;
}

/**
 * Compute the full Primary Ownership decomposition for one stock at one snapshot.
 *
 * @param symbol      ticker (denormalised onto the score rows)
 * @param rows        full quarterly series, sorted asOnDate ASC
 * @param snapshotIdx the quarter to score (default = latest). Parameterised so the
 *                    verification harness can score a HISTORICAL quarter (e.g. the
 *                    quarter a promoter exited) — promoter exits rarely sit at the
 *                    latest quarter.
 * @returns the decomposition, or null if there are no rows.
 */
export function computePrimaryOwnership(
  symbol: string,
  rows: OwnershipQuarter[],
  snapshotIdx: number = rows.length - 1,
): PrimaryOwnershipResult | null {
  if (rows.length === 0 || snapshotIdx < 0 || snapshotIdx >= rows.length) return null;

  const current = rows[snapshotIdx];
  const prior = snapshotIdx >= 1 ? rows[snapshotIdx - 1] : null;

  const baseline = computeBaseline(rows, snapshotIdx);
  const pledging = computePledging(current, prior);
  const r2 = computeR2(current, prior);
  const r6 = computeR6(current, prior);
  const prolongedFii = computeProlongedFii(rows, snapshotIdx);

  const primarySubtotal =
    baseline.baseline +
    pledging.ladderAdjustment +
    r2.penalty +
    r6.penalty +
    prolongedFii.penalty;

  const redFlags: DeferredRedFlag[] = [];
  if (pledging.r1Breach) {
    redFlags.push({
      flagKey: "ownership_R1_pledge",
      severity: "critical", // File 1 §5A: red flags are severity Critical (kept in sync with the DB-write site in composite/persist.ts)
      tier: "auto",
      triggeringValues: {
        pledgeRatioQ: pledging.pledgeRatioQ,
        pledgeRatioQ1: pledging.pledgeRatioQ1,
        qoqRisePp: pledging.qoqRisePp,
        thresholdPct: 50,
        thresholdQoqRisePp: 10,
      },
      reasons: pledging.r1Reasons,
      persistenceDeferred: true,
    });
  }

  return {
    symbol,
    snapshot: {
      asOnDate: current.asOnDate,
      quarter: current.quarter,
      fiscalYear: current.fiscalYear,
      periodKey: periodKeyOf(current),
      label: quarterLabel(current),
      index: snapshotIdx,
    },
    baseline,
    pledging,
    r2,
    r6,
    prolongedFii,
    primarySubtotal,
    flowApplied: false,
    clampApplied: false,
    redFlags,
    dataFingerprint: fingerprintInputs(symbol, rows, snapshotIdx),
  };
}

/**
 * Canonical, deterministic hash of the ownership input set up to & including the
 * snapshot. Two runs over identical data → identical hash → the PillarScore
 * @@unique([stockId, pillar, inputsFingerprint]) blocks a duplicate row (the
 * skip-identical / event-driven cadence). A genuine input change → new hash →
 * a new version. Counts are stringified (BigInt) so JSON.stringify is safe.
 */
export function fingerprintInputs(
  symbol: string,
  rows: OwnershipQuarter[],
  snapshotIdx: number,
): string {
  const slice = rows.slice(0, snapshotIdx + 1).map((r) => ({
    d: r.asOnDate.toISOString().slice(0, 10),
    q: r.quarter,
    fy: r.fiscalYear,
    ps: r.promoterShares?.toString() ?? null,
    ts: r.totalShares?.toString() ?? null,
    pl: r.pledgedShares?.toString() ?? null,
    pp: r.promoterPct,
    fi: r.fiiPct,
    re: r.retailPct,
  }));
  const payload = JSON.stringify({
    symbol,
    period: periodKeyOf(rows[snapshotIdx]),
    slice,
  });
  return createHash("sha256").update(payload).digest("hex");
}
