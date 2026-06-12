// ─────────────────────────────────────────────────────────────
// Service layer that wraps the computation engine with:
//   - Computation logging (PeerGroupComputationLog)
//   - All four trigger types:
//       scheduled    → monthly cron
//       post_xbrl_scan  → after XBRL quarterly results scan completes
//       manual_api   → admin API call
//       manual_seed  → after initial seeding
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import {
  computeAllPeerGroupMetrics,
  computePeerGroupMetrics,
  computeSectorPeerGroupMetrics,
  type BatchProgressFn,
  type BulkComputeResult,
  type ComputeResult,
} from "./compute.js";

// ── Types ─────────────────────────────────────────────────────

type TriggerType = "scheduled" | "post_upload" | "manual_api" | "manual_seed";
type RunType = "full" | "single" | "sector";

// ── Logging helper ────────────────────────────────────────────

async function logComputation(params: {
  runType: RunType;
  triggerType: TriggerType;
  peerGroupId?: string;
  sectorId?: string;
  fiscalYear?: string;
  groupsComputed: number;
  groupsSkipped: number;
  status: "success" | "partial" | "failed";
  error?: string;
  durationMs: number;
  results: ComputeResult[];
}) {
  const snapshot = params.results
    .filter((r) => r.metrics != null)
    .map((r) => ({
      peerGroupId: r.peerGroupId,
      name: r.peerGroupName,
      fiscalYear: r.metrics?.fiscalYear,
      stocksWithData: r.metrics?.stocksWithData,
      metrics: {
        avgPeRatio: r.metrics?.avgPeRatio,
        avgPbRatio: r.metrics?.avgPbRatio,
        avgRoe: r.metrics?.avgRoe,
        avgRoce: r.metrics?.avgRoce,
        avgNetMargin: r.metrics?.avgNetMargin,
        avgDebtToEquity: r.metrics?.avgDebtToEquity,
        avgRevenueGrowth: r.metrics?.avgRevenueGrowth,
      },
    }));

  await prisma.peerGroupComputationLog.create({
    data: {
      runType: params.runType,
      triggerType: params.triggerType,
      peerGroupId: params.peerGroupId ?? null,
      sectorId: params.sectorId ?? null,
      fiscalYear: params.fiscalYear ?? null,
      groupsComputed: params.groupsComputed,
      groupsSkipped: params.groupsSkipped,
      status: params.status,
      error: params.error ?? null,
      durationMs: params.durationMs,
      computedSnapshot: snapshot,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// TRIGGER 1: Scheduled (monthly cron)
// Recomputes ALL peer groups on a monthly schedule.
// Scheduled for the 5th of every month at 7 AM IST.
// Reason: fundamentals update quarterly, prices update daily.
// Monthly gives fresh P/E and P/B with current prices while
// not overcomputing on data that barely changes.
// ─────────────────────────────────────────────────────────────

export async function runScheduledPeerMetrics(): Promise<BulkComputeResult> {
  console.log("[PeerMetrics] Scheduled run starting (all peer groups)…");

  const result = await computeAllPeerGroupMetrics();

  const status =
    result.failed === 0
      ? "success"
      : result.computed > 0
        ? "partial"
        : "failed";

  await logComputation({
    runType: "full",
    triggerType: "scheduled",
    fiscalYear: result.fiscalYear,
    groupsComputed: result.computed,
    groupsSkipped: result.skipped,
    status,
    durationMs: result.durationMs,
    results: result.results,
  });

  return result;
}

// ─────────────────────────────────────────────────────────────
// TRIGGER 2: Post XBRL Quarterly Results Scan
// Called automatically after a quarterly results scan completes
// ingested for a stock.
//
// Logic: only recompute the peer group(s) that contain the
// uploaded stock — not the entire universe.
// This is efficient: uploading TCS only recomputes
// "Large-Cap IT Services" (6 stocks), not all 27 groups.
// ─────────────────────────────────────────────────────────────

export async function runPostUploadPeerMetrics(
  stockId: string,
): Promise<ComputeResult[]> {
  // Find which peer group(s) this stock belongs to
  const memberships = await prisma.stockPeerGroup.findMany({
    where: { stockId },
    select: {
      peerGroupId: true,
      peerGroup: { select: { name: true, sectorId: true } },
    },
  });

  if (memberships.length === 0) {
    console.log(
      `[PeerMetrics] Stock ${stockId} has no peer group — skipping post-upload compute`,
    );
    return [];
  }

  const results: ComputeResult[] = [];

  for (const membership of memberships) {
    console.log(
      `[PeerMetrics] Post-upload recompute: ${membership.peerGroup.name}`,
    );

    const result = await computePeerGroupMetrics(membership.peerGroupId);
    results.push(result);

    await logComputation({
      runType: "single",
      triggerType: "post_upload",
      peerGroupId: membership.peerGroupId,
      sectorId: membership.peerGroup.sectorId,
      fiscalYear: result.metrics?.fiscalYear,
      groupsComputed: result.skipped ? 0 : 1,
      groupsSkipped: result.skipped ? 1 : 0,
      status: result.success ? "success" : "failed",
      error: result.reason,
      durationMs: 0, // single group is fast, log 0
      results: [result],
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// TRIGGER 3: Manual API
// Called from admin endpoints — supports three granularities:
//   all       → recompute every peer group
//   sector    → recompute all groups in one sector
//   single    → recompute one specific peer group
// ─────────────────────────────────────────────────────────────

export async function runManualPeerMetrics(params: {
  scope: "all" | "sector" | "single";
  sectorId?: string;
  peerGroupId?: string;
  onBatchComplete?: BatchProgressFn;
}): Promise<BulkComputeResult> {
  const start = Date.now();

  let result: BulkComputeResult;

  if (params.scope === "all") {
    result = await computeAllPeerGroupMetrics(params.onBatchComplete);
  } else if (params.scope === "sector" && params.sectorId) {
    result = await computeSectorPeerGroupMetrics(params.sectorId);
  } else if (params.scope === "single" && params.peerGroupId) {
    const singleResult = await computePeerGroupMetrics(params.peerGroupId);
    result = {
      totalGroups: 1,
      computed: singleResult.skipped ? 0 : singleResult.success ? 1 : 0,
      skipped: singleResult.skipped ? 1 : 0,
      failed: singleResult.success ? 0 : 1,
      fiscalYear: singleResult.metrics?.fiscalYear ?? "unknown",
      results: [singleResult],
      durationMs: Date.now() - start,
    };
  } else {
    throw new Error(
      "Invalid scope params: provide sectorId for scope=sector, peerGroupId for scope=single",
    );
  }

  const status =
    result.failed === 0
      ? "success"
      : result.computed > 0
        ? "partial"
        : "failed";

  await logComputation({
    runType: params.scope === "all" ? "full" : params.scope,
    triggerType: "manual_api",
    peerGroupId: params.peerGroupId,
    sectorId: params.sectorId,
    fiscalYear: result.fiscalYear,
    groupsComputed: result.computed,
    groupsSkipped: result.skipped,
    status,
    durationMs: result.durationMs,
    results: result.results,
  });

  return result;
}

// ─────────────────────────────────────────────────────────────
// TRIGGER 4: Post Seed
// Called once after the initial universe seed script completes.
// Computes all peer groups so the DB has baseline values
// before any XBRL scans have completed.
// At this point most fundamentals won't exist yet —
// most groups will be skipped. That's expected and fine.
// ─────────────────────────────────────────────────────────────

export async function runPostSeedPeerMetrics(): Promise<BulkComputeResult> {
  console.log("[PeerMetrics] Post-seed run (initial baseline)…");

  const result = await computeAllPeerGroupMetrics();

  await logComputation({
    runType: "full",
    triggerType: "manual_seed",
    fiscalYear: result.fiscalYear,
    groupsComputed: result.computed,
    groupsSkipped: result.skipped,
    status: result.failed === 0 ? "success" : "partial",
    durationMs: result.durationMs,
    results: result.results,
  });

  console.log(
    `[PeerMetrics] Post-seed complete. ${result.computed} computed, ` +
      `${result.skipped} skipped (no data yet — expected).`,
  );

  return result;
}
