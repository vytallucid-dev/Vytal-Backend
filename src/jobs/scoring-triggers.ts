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
import type { PgRescorePayload, PgCascadeRescorePayload, FillCascadeRescorePayload } from "./types.js";
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

export interface PgRescoreHandle {
  /** The pollable BackgroundJob id (newly enqueued OR the in-flight one on coalesce). */
  jobId: string;
  /** true when an already-pending/running PG_RESCORE for this PG was reused. */
  coalesced: boolean;
  pgId: string;
}

/**
 * MANUAL/ADMIN single-PG rescore that ALWAYS yields a pollable jobId — enqueues a
 * PG_RESCORE, or returns the in-flight job's id when one is already pending/running
 * for this PG (coalesce). This is the resolve-action primitive for a scoring-error
 * "Re-score" button.
 *
 * Differs from enqueuePgRescore (the auto-policy primitive) in two ways the resolve
 * action needs: (1) it returns the EXISTING job's id on coalesce instead of null, so
 * the UI always gets a handle to poll; (2) it bypasses the SCORING_TRIGGERS_ENABLED
 * kill switch — that switch gates the AUTOMATIC post-ingest policy, not a deliberate
 * operator re-score (the worker processes the job regardless). The PG_RESCORE handler
 * is itself idempotent (skip-identical), so a redundant manual rescore is a cheap no-op.
 */
export async function enqueueOrGetPgRescore(
  ref: PgRef,
  triggeredBy: string,
  reason?: string,
): Promise<PgRescoreHandle> {
  const active = await listJobs({
    type: JobTypes.PG_RESCORE,
    status: [JobStatus.PENDING, JobStatus.RUNNING],
    limit: 500,
  });
  const dup = active.jobs.find(
    (j) => (j.payload as { pgId?: string } | null)?.pgId === ref.pgId,
  );
  if (dup) {
    console.log(`[scoring-trigger] manual PG_RESCORE(${ref.pgId}) coalesced → in-flight job ${dup.id}`);
    return { jobId: dup.id, coalesced: true, pgId: ref.pgId };
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
  console.log(`[scoring-trigger] manual PG_RESCORE(${ref.pgId}) enqueued as job ${job.id} (by ${triggeredBy})`);
  return { jobId: job.id, coalesced: false, pgId: ref.pgId };
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
  /** The enqueued PG_RESCORE job ids (for status polling — first is the pollable handle). */
  jobIds: string[];
}

async function enqueueForRefs(refs: readonly PgRef[], triggeredBy: string, reason: string, scope: string): Promise<TriggerOutcome> {
  let enqueued = 0, deduped = 0;
  const jobIds: string[] = [];
  for (const ref of refs) {
    const job = await enqueuePgRescore(ref, triggeredBy, reason);
    if (job) { enqueued++; jobIds.push(job.id); } else deduped++;
  }
  return { enqueued, deduped, scope, pgIds: refs.map((r) => r.pgId), jobIds };
}

/** Fan a set of stock SYMBOLS out to their scored PGs (all memberships) and enqueue a
 *  deduped PG_RESCORE for each distinct PG. Used by the targeted (fundamentals /
 *  shareholding / CASA) triggers. No-op when the kill switch is off or no symbol maps to
 *  a scored PG. SAFE to call from any context (worker or an admin route). */
export async function triggerRescoreForSymbols(symbols: string[], triggeredBy: string, reason: string): Promise<TriggerOutcome | null> {
  if (!scoringTriggersEnabled()) return null;
  const distinct = [...new Set(symbols.filter((s) => typeof s === "string" && s.length))];
  if (!distinct.length) return { enqueued: 0, deduped: 0, scope: "no-symbols", pgIds: [], jobIds: [] };
  const refs = await pgRefsForSymbols(distinct);
  if (!refs.length) return { enqueued: 0, deduped: 0, scope: "no-scored-pg", pgIds: [], jobIds: [] };
  return enqueueForRefs(refs, triggeredBy, reason, `symbols:${distinct.length}→${refs.length}pg`);
}

const BANK_PG_IDS = new Set(["PG5", "PG6"]);

export interface CascadeTriggerOutcome {
  /** 1 if a PG_CASCADE_RESCORE was enqueued, else 0. */
  enqueued: number;
  /** 1 if coalesced against an active identical (pgId, editedPeriod) cascade. */
  deduped: number;
  /** Short scope tag for the audit log. */
  scope: string;
  /** The PG the cascade targets ("PG5" / "PG6"), or [] if not a banking symbol. */
  pgIds: string[];
  /** The enqueued job id, when enqueued. */
  jobId?: string;
}

/**
 * Enqueue a CASA FORWARD-CASCADE for a bank's CASA edit. The handler determines the current
 * period and the [editedPeriod .. current] range (PIT historical + live current), so the
 * trigger only needs (symbol, editedPeriod). Deduped on (type, pgId, editedPeriod) — a second
 * identical edit while one is pending coalesces. No-op when the kill switch is off or the
 * symbol is not a banking-PG member (CASA is banking-only; defensive). SAFE from an admin route.
 */
export async function triggerCasaCascade(symbol: string, editedPeriod: string, triggeredBy: string, reason: string): Promise<CascadeTriggerOutcome | null> {
  if (!scoringTriggersEnabled()) return null;
  const refs = await pgRefsForSymbols([symbol]);
  const ref = refs.find((r) => BANK_PG_IDS.has(r.pgId));
  if (!ref) return { enqueued: 0, deduped: 0, scope: "not-banking", pgIds: [] };

  // Dedup on (type, pgId, editedPeriod): an identical re-submission while one is in flight
  // coalesces (the pending cascade rescores the same range). Distinct edits (different
  // periods) enqueue separately — each is idempotent (skip-identical no-ops the overlap).
  const active = await listJobs({ type: JobTypes.PG_CASCADE_RESCORE, status: [JobStatus.PENDING, JobStatus.RUNNING], limit: 500 });
  const dup = active.jobs.find((j) => {
    const p = j.payload as Partial<PgCascadeRescorePayload> | null;
    return p?.pgId === ref.pgId && p?.editedPeriod === editedPeriod;
  });
  if (dup) {
    console.log(`[scoring-trigger] PG_CASCADE_RESCORE(${ref.pgId} @ ${editedPeriod}) already ${dup.status} (job ${dup.id}) — skip enqueue`);
    return { enqueued: 0, deduped: 1, scope: `cascade:${symbol}@${editedPeriod}`, pgIds: [ref.pgId], jobId: dup.id };
  }

  const payload: PgCascadeRescorePayload = { pgId: ref.pgId, pgName: ref.pgName, seedKey: ref.seedKey, symbol, editedPeriod, triggeredBy, reason };
  const job = await enqueueJob({ type: JobTypes.PG_CASCADE_RESCORE, payload, triggeredBy, priority: RESCORE_PRIORITY });
  console.log(`[scoring-trigger] enqueued PG_CASCADE_RESCORE(${ref.pgId} @ ${editedPeriod}) as job ${job.id} (by ${triggeredBy})`);
  return { enqueued: 1, deduped: 0, scope: `cascade:${symbol}@${editedPeriod}`, pgIds: [ref.pgId], jobId: job.id };
}

export type FillEditRef =
  | { kind: "annual"; reportDate: Date }
  | { kind: "quarter"; periodKey: string };

export interface FillCascadeTriggerOutcome {
  /** 1 if a FILL_CASCADE_RESCORE was enqueued, else 0. */
  enqueued: number;
  /** 1 if coalesced against an active identical (symbol, edit) cascade. */
  deduped: number;
  scope: string;
  symbol: string;
  jobId?: string;
}

/**
 * Enqueue a GENERAL fill forward-cascade for a back-dated NON-banking fundamentals /
 * shareholding edit. The handler re-runs runGeneralCascade ([editedPeriod .. current],
 * PIT historical + live current, PG-wide). Deduped on (type, symbol, editKey) — a
 * second identical edit while one is pending coalesces. No-op when the kill switch is
 * off. SAFE from an admin route — returns immediately (the rescore runs in the worker),
 * so the POST never blocks on a full PG × periods × peers recompute.
 */
export async function triggerFillCascade(
  symbol: string,
  edit: FillEditRef,
  triggeredBy: string,
  reason: string,
): Promise<FillCascadeTriggerOutcome | null> {
  if (!scoringTriggersEnabled()) return null;
  const editKey = edit.kind === "annual" ? edit.reportDate.toISOString() : edit.periodKey;

  const active = await listJobs({ type: JobTypes.FILL_CASCADE_RESCORE, status: [JobStatus.PENDING, JobStatus.RUNNING], limit: 500 });
  const dup = active.jobs.find((j) => {
    const p = j.payload as Partial<FillCascadeRescorePayload> | null;
    const k = p?.editKind === "annual" ? p?.editReportDateIso : p?.editPeriodKey;
    return p?.symbol === symbol && k === editKey;
  });
  if (dup) {
    console.log(`[scoring-trigger] FILL_CASCADE_RESCORE(${symbol} @ ${editKey}) already ${dup.status} (job ${dup.id}) — skip enqueue`);
    return { enqueued: 0, deduped: 1, scope: `fill:${symbol}@${editKey}`, symbol, jobId: dup.id };
  }

  const payload: FillCascadeRescorePayload = {
    symbol,
    editKind: edit.kind,
    editReportDateIso: edit.kind === "annual" ? edit.reportDate.toISOString() : undefined,
    editPeriodKey: edit.kind === "quarter" ? edit.periodKey : undefined,
    triggeredBy,
    reason,
  };
  const job = await enqueueJob({ type: JobTypes.FILL_CASCADE_RESCORE, payload, triggeredBy, priority: RESCORE_PRIORITY });
  console.log(`[scoring-trigger] enqueued FILL_CASCADE_RESCORE(${symbol} @ ${editKey}) as job ${job.id} (by ${triggeredBy})`);
  return { enqueued: 1, deduped: 0, scope: `fill:${symbol}@${editKey}`, symbol, jobId: job.id };
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
      if (inserted <= 0) return { enqueued: 0, deduped: 0, scope: "prices:no-new-rows", pgIds: [], jobIds: [] };
      return enqueueForRefs(SCORED_PGS, `hook:${jobType}`, `${inserted} new daily price row(s)`, "prices:all-13");
    }
    case JobTypes.RESULTS_SCAN:
    case JobTypes.SHAREHOLDING_QUARTERLY:
    case JobTypes.SHAREHOLDING_SMART_REFRESH: {
      const symbols = changedSymbolsOf(result);
      const out = await triggerRescoreForSymbols(symbols, `hook:${jobType}`, `${jobType} wrote ${symbols.length} symbol(s)`);
      return out ?? { enqueued: 0, deduped: 0, scope: "disabled", pgIds: [], jobIds: [] };
    }
    default:
      // Not a trigger source (PG_RESCORE, news, deals, events, peer-metrics, …).
      // This INCLUDES the display-only index pipeline (INDEX_PRICES_DAILY /
      // INDEX_PRICES_BACKFILL): index data is a sibling write to the equity prices
      // and must NEVER move a Health Score, so its job types are deliberately
      // absent from the arms above → they fall here → no PG rescore is enqueued.
      //
      // IT ALSO INCLUDES THE WHOLE FUND PIPELINE — AMFI_NAV_DAILY (Step 9), ETF_NAV_DAILY
      // (Step 13), MF_ANALYTICS_DAILY and MF_INCEPTION_WALK. HELD-NOT-SCORED is enforced HERE,
      // structurally, by those types being absent from the arms above: a fund or an ETF can be
      // held, valued, charted and richly analysed, and STILL never move a Vytal Health Score.
      // The score is an EQUITY judgement built on fundamentals a fund does not have. Adding one
      // of these to a `case` arm is the single edit that would break that — so don't.
      return null;
  }
}
