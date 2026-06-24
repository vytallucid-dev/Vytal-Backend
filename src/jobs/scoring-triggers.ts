// ─────────────────────────────────────────────────────────────
// SCORING TRIGGERS — event-driven PG rescore enqueue.
//
// This module owns the enqueue PRIMITIVE for PG_RESCORE jobs. The central
// trigger POLICY (which completed ingestion → which PG rescores) is added in
// Stage 3 and lives alongside this helper.
//
// DEDUP: the generic scheduler dedup (enqueueIfNotActive) keys on job TYPE
// only — too coarse for PG_RESCORE, which is one type parameterized by pgId.
// enqueuePgRescore dedups on (type, pgId): if a PENDING or RUNNING PG_RESCORE
// for the SAME pgId already exists, the enqueue is skipped. This is what
// coalesces two ingestions that both want the same PG (e.g. prices + a
// results-scan both targeting PG5) into a single rescore.
// ─────────────────────────────────────────────────────────────

import { enqueueJob, listJobs } from "./enqueue.js";
import { JobStatus, JobTypes } from "./types.js";
import type { PgRescorePayload } from "./types.js";
import { env } from "../config/env.js";
import type { PgRef } from "../scoring/composite/score-pass.js";
import { SCORED_PGS, pgRefsForSymbols } from "../scoring/composite/pg-registry.js";

/** PG_RESCORE runs AFTER its triggering ingestion (which uses the default 100 /
 *  urgent 10). 60 keeps rescores below fresh ingestion work but above nothing. */
const RESCORE_PRIORITY = 60;

/**
 * Enqueue a PG_RESCORE for one PG, deduped on (type, pgId). Returns the created
 * job, or null if an active (PENDING/RUNNING) PG_RESCORE for the same pgId already
 * exists (coalesced — the in-flight rescore will pick up the latest data anyway,
 * since the single worker runs it AFTER the triggering ingestion has committed).
 */
export async function enqueuePgRescore(
  ref: PgRef,
  triggeredBy: string,
  reason?: string,
) {
  const active = await listJobs({
    type: JobTypes.PG_RESCORE,
    status: [JobStatus.PENDING, JobStatus.RUNNING],
    limit: 500,
  });
  const dup = active.jobs.find(
    (j) => (j.payload as { pgId?: string } | null)?.pgId === ref.pgId,
  );
  if (dup) {
    console.log(
      `[scoring-trigger] PG_RESCORE(${ref.pgId}) already ${dup.status} (job ${dup.id}) — skip enqueue`,
    );
    return null;
  }

  const payload: PgRescorePayload = {
    pgId: ref.pgId,
    pgName: ref.pgName,
    seedKey: ref.seedKey,
    triggeredBy,
    reason,
  };
  const job = await enqueueJob({
    type: JobTypes.PG_RESCORE,
    payload,
    triggeredBy,
    priority: RESCORE_PRIORITY,
  });
  console.log(
    `[scoring-trigger] enqueued PG_RESCORE(${ref.pgId}) as job ${job.id} (by ${triggeredBy})`,
  );
  return job;
}

/** The kill switch (env.SCORING_TRIGGERS_ENABLED). When false, all auto-rescore
 *  enqueues below are skipped (ingestion still writes data normally). */
export function scoringTriggersEnabled(): boolean {
  return env.SCORING_TRIGGERS_ENABLED;
}

export interface TriggerOutcome {
  /** PG_RESCORE jobs newly enqueued. */
  enqueued: number;
  /** Rescores coalesced by the (type,pgId) dedup (an active rescore already pending). */
  deduped: number;
  /** Short scope tag for the audit log. */
  scope: string;
  /** The distinct pgIds the trigger targeted. */
  pgIds: string[];
}

async function enqueueForRefs(refs: readonly PgRef[], triggeredBy: string, reason: string, scope: string): Promise<TriggerOutcome> {
  let enqueued = 0, deduped = 0;
  for (const ref of refs) {
    const job = await enqueuePgRescore(ref, triggeredBy, reason);
    if (job) enqueued++; else deduped++;
  }
  return { enqueued, deduped, scope, pgIds: refs.map((r) => r.pgId) };
}

/** Fan a set of stock SYMBOLS out to their scored PGs (all memberships) and enqueue a
 *  deduped PG_RESCORE for each distinct PG. Used by the targeted (fundamentals /
 *  shareholding / CASA) triggers. No-op when the kill switch is off or no symbol maps to
 *  a scored PG. SAFE to call from any context (worker or an admin route). */
export async function triggerRescoreForSymbols(symbols: string[], triggeredBy: string, reason: string): Promise<TriggerOutcome | null> {
  if (!scoringTriggersEnabled()) return null;
  const distinct = [...new Set(symbols.filter((s) => typeof s === "string" && s.length))];
  if (!distinct.length) return { enqueued: 0, deduped: 0, scope: "no-symbols", pgIds: [] };
  const refs = await pgRefsForSymbols(distinct);
  if (!refs.length) return { enqueued: 0, deduped: 0, scope: "no-scored-pg", pgIds: [] };
  return enqueueForRefs(refs, triggeredBy, reason, `symbols:${distinct.length}→${refs.length}pg`);
}

/** changedSymbols emitted by an ingestion result — the symbols that ACTUALLY had data
 *  written ("changed" = wrote-something, not merely scanned). null/absent → []. */
function changedSymbolsOf(result: unknown): string[] {
  const cs = (result as { changedSymbols?: unknown } | null)?.changedSymbols;
  return Array.isArray(cs) ? cs.filter((x): x is string => typeof x === "string") : [];
}

/**
 * CENTRAL TRIGGER POLICY. Given a just-SUCCEEDED ingestion job + its result, enqueue the
 * PG_RESCORE(s) the new data implies:
 *   • EOD_PRICES_DAILY  → ALL 13 scored PGs, IF any new daily rows were inserted. Market
 *     moves universally (the whole peer pool's C1/D1 shift), so a price refresh implies
 *     every PG could move; the fingerprint guard makes unchanged PGs a cheap no-op.
 *   • RESULTS_SCAN / SHAREHOLDING_* → TARGETED: the changedSymbols (symbols that actually
 *     had data written) fanned out to ALL their scored-PG memberships, deduped by pgId.
 *   • anything else (incl. PG_RESCORE itself) → no-op (no rescore-of-a-rescore loop).
 * The (type,pgId) dedup naturally coalesces overlaps (prices + a results-scan both
 * wanting PG5 → one rescore). Returns null when the kill switch is off or the type is
 * not a trigger source.
 */
export async function maybeEnqueueRescoresForJob(jobType: string, result: unknown): Promise<TriggerOutcome | null> {
  if (!scoringTriggersEnabled()) return null;

  switch (jobType) {
    case JobTypes.EOD_PRICES_DAILY: {
      // result is IngestPricesResult[] (one per re-checked trading day).
      const days = Array.isArray(result) ? (result as Array<{ totalInserted?: number }>) : [];
      const inserted = days.reduce((s, d) => s + (d?.totalInserted ?? 0), 0);
      if (inserted <= 0) return { enqueued: 0, deduped: 0, scope: "prices:no-new-rows", pgIds: [] };
      return enqueueForRefs(SCORED_PGS, `hook:${jobType}`, `${inserted} new daily price row(s)`, "prices:all-13");
    }
    case JobTypes.RESULTS_SCAN:
    case JobTypes.SHAREHOLDING_QUARTERLY:
    case JobTypes.SHAREHOLDING_SMART_REFRESH: {
      const symbols = changedSymbolsOf(result);
      const out = await triggerRescoreForSymbols(symbols, `hook:${jobType}`, `${jobType} wrote ${symbols.length} symbol(s)`);
      return out ?? { enqueued: 0, deduped: 0, scope: "disabled", pgIds: [] };
    }
    default:
      // Not a trigger source (PG_RESCORE, news, deals, events, peer-metrics, …).
      // This INCLUDES the display-only index pipeline (INDEX_PRICES_DAILY /
      // INDEX_PRICES_BACKFILL): index data is a sibling write to the equity prices
      // and must NEVER move a Health Score, so its job types are deliberately
      // absent from the arms above → they fall here → no PG rescore is enqueued.
      return null;
  }
}
