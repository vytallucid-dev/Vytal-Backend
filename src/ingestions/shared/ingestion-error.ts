// ─────────────────────────────────────────────────────────────
// SHARED ingestion-error reporting seam (cron-agnostic).
//
// Any cron's detection guard calls reportIngestionError() when it
// trips. The guards never write the table directly — this function is
// the single seam every cron reuses (prices first; shareholding /
// fundamentals / events next).
//
// Writes ONE IngestionError row (status="open") per distinct violation,
// with DEDUP so a daily-recurring gap collapses to one row (occurrences
// bumped) instead of N rows.
//
// COMPLEMENTS the per-run fetch logs (PriceFetchLog etc.) — does not
// replace them. Link via `runRef`.
//
// BEST-EFFORT: this function never throws. A guard reporting a problem
// must never itself break ingestion (guards are additive). DB hiccups
// while reporting are swallowed + logged.
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type {
  GuardType,
  IngestionSeverity,
  ResolutionPath,
} from "../../generated/prisma/client.js";

export interface ReportIngestionErrorInput {
  /** Origin source, e.g. "nse_bhavcopy". */
  source: string;
  /** Owning cron, e.g. "daily_eod_prices". */
  cron: string;
  /** Which guard family tripped. */
  guardType: GuardType;
  /** Destination table the guard protects, e.g. "DailyPrice". */
  targetTable: string;
  /** Field-level guards: the column, e.g. "close". Omit for batch-level guards. */
  targetField?: string | null;
  /** Field-level guards: which record (symbol / priceDate). Omit for batch-level. */
  targetEntity?: string | null;
  /** Drives behaviour + UI. See severity→path mapping. */
  severity: IngestionSeverity;
  /** source_code (no fill-button) | admin_fill (fill-button). */
  resolutionPath: ResolutionPath;
  /** What the guard expected, e.g. "150–250 rows". */
  expected: string;
  /** What it actually saw, e.g. "12 rows". */
  observed: string;
  /** Human context. */
  detail?: string | null;
  /** Soft ref to the run-log identity, e.g. "<priceDate>:<provider>". */
  runRef?: string | null;
}

// ── DEDUP KEY ────────────────────────────────────────────────
// An open IngestionError is "the same ongoing violation" as a new
// report when these match, scoped to status = "open":
//
//     (cron, guardType, targetField, targetEntity)
//
// targetField/targetEntity are NULL for batch-level guards (shape/
// count/skip), so those dedup per-cron-per-guard; field-level guards
// (range/null_rate) dedup per-(field,entity) — e.g. one open row per
// symbol whose close is out of range.
//
// On a match → UPDATE the open row (bump occurrences + lastSeenAt,
// refresh observed/detail/runRef/severity) instead of inserting. Once
// the open row is resolved/ignored, the next trip opens a fresh row.
// This is what keeps a 30-day recurring gap to ONE row (occurrences=30)
// rather than 30 rows.

/**
 * Report a single ingestion-guard violation. Idempotent-ish via dedup.
 * Returns the IngestionError id (new or updated), or null if the write
 * failed (never throws — reporting must not break ingestion).
 */
export async function reportIngestionError(
  input: ReportIngestionErrorInput,
): Promise<string | null> {
  const {
    source,
    cron,
    guardType,
    targetTable,
    targetField = null,
    targetEntity = null,
    severity,
    resolutionPath,
    expected,
    observed,
    detail = null,
    runRef = null,
  } = input;

  try {
    // Dedup: is the same violation already open?
    const existing = await prisma.ingestionError.findFirst({
      where: {
        status: "open",
        cron,
        guardType,
        targetField,
        targetEntity,
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.ingestionError.update({
        where: { id: existing.id },
        data: {
          occurrences: { increment: 1 },
          lastSeenAt: new Date(),
          // Refresh the evidence to the latest observation.
          observed,
          expected,
          detail,
          severity,
          resolutionPath,
          runRef,
        },
      });
      return existing.id;
    }

    const created = await prisma.ingestionError.create({
      data: {
        source,
        cron,
        guardType,
        targetTable,
        targetField,
        targetEntity,
        severity,
        resolutionPath,
        expected,
        observed,
        detail,
        runRef,
        // status defaults to "open"; occurrences defaults to 1.
      },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    // Best-effort: a failure to record a guard violation must never
    // propagate into the ingestion pipeline.
    console.error(
      `[reportIngestionError] failed to record ${cron}/${guardType} ` +
        `(${targetField ?? "-"}/${targetEntity ?? "-"}):`,
      err,
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// SCORING ERROR sibling writer (source="scoring").
//
// A scoring error is a SCORE that failed to compute/refresh properly even when
// the input data is fine — a NEW error class that SHARES the IngestionError
// table (and so its triage UI / lifecycle / dedup). Stage 1 records the cleanest
// case: a terminal-failed rescore BackgroundJob (already fully persisted on the
// job row, just unsurfaced).
//
// Mirrors reportIngestionError exactly: dedup-or-create, BEST-EFFORT never-throws
// (a detection write must never break the thing it watches), occurrences bumped on
// re-trip. The scoring-specific columns (pgId/periodKey/failureType/…) are written
// in addition to the shared columns.
//
// NO COLLISION with ingestion rows: the dedup query keys on (cron, guardType,
// targetField, targetEntity, status), and scoring rows carry a synthetic cron
// ("scoring:<jobType>") + a scoring_* guardType — neither of which any ingestion
// row ever uses. So a scoring dedup can never match (nor be matched by) an
// ingestion row even though they share the table + the index.
// ─────────────────────────────────────────────────────────────

export type ScoringFailureType = "job_failed" | "degraded" | "stale";

const GUARD_TYPE_FOR: Record<ScoringFailureType, GuardType> = {
  job_failed: "scoring_job_failed",
  degraded: "scoring_degraded",
  stale: "scoring_stale",
};

export interface ReportScoringErrorInput {
  /** "job_failed" (Stage 1) | "degraded" (Stage 4) | "stale" (Stage 3). */
  failureType: ScoringFailureType;
  /** Synthetic cron tag for dedup + provenance, e.g. "scoring:pg_rescore". */
  cron: string;
  /** PG entity ("PG5") for PG-keyed rescores; null for symbol-only cascades. */
  pgId?: string | null;
  /** Stock symbol for symbol-keyed cascades; null for PG-keyed pg_rescore. */
  symbol?: string | null;
  /** Affected/edited period ("FY26Q2"); folded into the dedup entity key; null = live. */
  periodKey?: string | null;
  /** Pillar/metric the degradation concerns (Stages 3/4); null for job_failed. */
  targetField?: string | null;
  /** job_failed ⇒ "high" (a stock/PG may carry no fresh score, or a stale one). */
  severity: IngestionSeverity;
  /** "rescore" | "fill_then_rescore" | "source_code". */
  recomputeAction: string;
  /** Resolution path gating the UI action — "rescore" for a failed job. */
  resolutionPath: ResolutionPath;
  /** What a healthy outcome looks like, e.g. "PG5 rescores successfully". */
  expected: string;
  /** What happened, e.g. the errorMessage. */
  observed: string;
  /** Human context. */
  detail?: string | null;
  /** The failed BackgroundJob id (job_failed) — provenance back to the job row. */
  triggeringJobId?: string | null;
  /** The affected ScoreSnapshot id (degraded/stale, Stages 3/4). */
  snapshotId?: string | null;
  /** Structured degradation evidence (Stages 3/4). */
  degradationDetail?: unknown;
}

/** The output table a scoring error concerns (the score, not an input table). */
const SCORING_TARGET_TABLE = "ScoreSnapshot";

/**
 * Build the dedup entity key: the PG/symbol with the period folded in, so the
 * EXISTING (cron, guardType, targetField, targetEntity, status) index serves the
 * scoring dedup key (source=scoring, failureType, pgId/symbol, periodKey) without
 * a new index. e.g. "PG5" (live) | "HDFCBANK@FY26Q2" (cascade).
 */
export function scoringEntityKey(pgId?: string | null, symbol?: string | null, periodKey?: string | null): string | null {
  const base = symbol ?? pgId ?? null;
  if (!base) return null;
  return periodKey ? `${base}@${periodKey}` : base;
}

/**
 * Report a single scoring error. Idempotent-ish via the same dedup philosophy as
 * reportIngestionError. Returns the IngestionError id (new or updated), or null if
 * the write failed (never throws — a detection write must not break scoring).
 */
export async function reportScoringError(
  input: ReportScoringErrorInput,
): Promise<string | null> {
  const {
    failureType,
    cron,
    pgId = null,
    symbol = null,
    periodKey = null,
    targetField = null,
    severity,
    recomputeAction,
    resolutionPath,
    expected,
    observed,
    detail = null,
    triggeringJobId = null,
    snapshotId = null,
    degradationDetail,
  } = input;

  const guardType = GUARD_TYPE_FOR[failureType];
  const targetEntity = scoringEntityKey(pgId, symbol, periodKey);
  // Only set the Json column when evidence was supplied (leave NULL otherwise).
  const detailJson =
    degradationDetail === undefined
      ? undefined
      : (degradationDetail as Prisma.InputJsonValue);

  try {
    // Dedup: is the same scoring failure already open? Same key shape as the
    // ingestion writer → reuses the existing dedup index.
    const existing = await prisma.ingestionError.findFirst({
      where: { status: "open", cron, guardType, targetField, targetEntity },
      select: { id: true },
    });

    if (existing) {
      await prisma.ingestionError.update({
        where: { id: existing.id },
        data: {
          occurrences: { increment: 1 },
          lastSeenAt: new Date(),
          // Refresh the evidence + the latest provenance.
          observed,
          expected,
          detail,
          severity,
          resolutionPath,
          recomputeAction,
          triggeringJobId,
          snapshotId,
          ...(detailJson === undefined ? {} : { degradationDetail: detailJson }),
        },
      });
      return existing.id;
    }

    const created = await prisma.ingestionError.create({
      data: {
        source: "scoring",
        cron,
        guardType,
        targetTable: SCORING_TARGET_TABLE,
        targetField,
        targetEntity,
        severity,
        resolutionPath,
        expected,
        observed,
        detail,
        // scoring-specific columns
        pgId,
        periodKey,
        failureType,
        recomputeAction,
        triggeringJobId,
        snapshotId,
        ...(detailJson === undefined ? {} : { degradationDetail: detailJson }),
        // status defaults to "open"; occurrences defaults to 1.
      },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    // Best-effort: a failure to record a scoring error must never propagate
    // into the worker / scoring pipeline.
    console.error(
      `[reportScoringError] failed to record ${cron}/${guardType} ` +
        `(${targetEntity ?? "-"}):`,
      err,
    );
    return null;
  }
}
