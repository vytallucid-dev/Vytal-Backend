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
  /** What the guard expected, e.g. "454–556 rows". */
  expected: string;
  /** What it actually saw, e.g. "12 rows". */
  observed: string;
  /** Human context. */
  detail?: string | null;
  /** Soft ref to the run-log identity, e.g. "<priceDate>:<provider>". */
  runRef?: string | null;
  /**
   * KNOWN-RECURRING fault (opt-in; default false — every existing caller is unaffected).
   *
   * THE PROBLEM IT SOLVES: the dedup below matches only status="open". So once an operator
   * RESOLVES or IGNORES a violation, the next trip finds no open twin and opens a BRAND-NEW
   * row. For a source that reships the same junk every night that is a slow flood: AMFI's 15
   * known quirks (9× the literal string "Redeemed" in an ISIN column, 1× "HDFCNIVODG", 5×
   * one ISIN under two scheme codes) would open 15 fresh rows nightly — ~5,475 rows a year,
   * burying an 11-row triage queue under known, un-actionable noise.
   *
   * WITH recurring=true: a re-trip whose evidence (`observed`) is UNCHANGED bumps occurrences
   * on the existing resolved/ignored row and LEAVES IT CLOSED. The audit trail keeps counting;
   * the queue stays clean.
   *
   * AND THE PART THAT MATTERS: if `observed` has CHANGED, there is no match and a fresh row
   * OPENS. "AMFI still ships the same bug" is silenced. "AMFI now ships a DIFFERENT bug" is
   * not. Suppression is scoped to the exact evidence that was triaged — never to the guard.
   */
  recurring?: boolean;
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
    recurring = false,
  } = input;

  try {
    // ── KNOWN-RECURRING PASS (opt-in; skipped entirely unless recurring=true, so no
    //    existing caller's behaviour moves by a byte). ──
    // Match a CLOSED row with the same key AND the SAME EVIDENCE. Same bug, still there →
    // bump the count, leave it closed. Different evidence → no match → falls through and
    // opens a fresh row below, exactly as it should.
    if (recurring) {
      const known = await prisma.ingestionError.findFirst({
        where: {
          status: { in: ["resolved", "ignored"] },
          cron,
          guardType,
          targetField,
          targetEntity,
          observed, // ← the whole point: suppression is scoped to the triaged EVIDENCE
        },
        select: { id: true },
      });

      if (known) {
        await prisma.ingestionError.update({
          where: { id: known.id },
          data: {
            occurrences: { increment: 1 },
            lastSeenAt: new Date(),
            runRef,
            // status is deliberately NOT touched — a triaged, unchanged quirk stays triaged.
          },
        });
        return known.id;
      }
    }

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
// BROKER-SEEDED AUDIT writer (source="broker") — Step 17, Part C.
//
// AN INFORMATIONAL ROW IN A FAULT TABLE, AND THE DISTINCTION IS THE WHOLE POINT.
//
// When a broker surfaces a holding whose ISIN we have never seen, universe-admit admits it to the
// catalogue — a stock, or a bond, per its ISIN (shared/isin-class.ts). That is a real change to
// SHARED, CANONICAL data made on a single user's broker feed, and an operator must be able to see
// every one of them. But it IS NOT A FAULT. Nothing is broken. Nothing needs fixing. Nobody should
// be paged, and it must never appear in the number an operator reads as "things that are wrong".
//
// This codebase's central discipline is the line between A FAULT and AN HONEST EMPTY. An auto-admit
// is neither: it is A THING THAT HAPPENED. So it gets its own class — guardType `broker_seeded`,
// severity `info` — and every consumer that counts faults excludes it (see
// ingestion-errors-controller). Gate 3 proves the open-fault count does not move when one fires.
//
// WHY IT SHARES THIS TABLE. There is already a precedent, and it is exactly this shape: the SCORING
// class (below) rides the same table with its own guardTypes and a synthetic cron, inheriting the
// lifecycle, the dedup, the occurrences counter and the triage UI for free. This is that move a
// third time. A parallel table would duplicate every one of those and drift from them.
//
// PER-INSTRUMENT, EXACTLY ONCE. The caller fires this at CATALOGUE-ROW CREATION, not at holding
// resolution — so a second user (on a different broker) holding the same ISIN resolves at Pass 0 and
// never reaches the write. The `recurring`-style dedup below is a belt to that braces: keyed on the
// ISIN, a re-fire bumps `occurrences` rather than opening a second row.
//
// WHAT IT DELIBERATELY DOES NOT CARRY: the USER. An audit event names the INSTRUMENT and the BROKER
// that surfaced it. Naming the user would put a person's holding into an operator's triage queue,
// and no operator needs to know WHO owns a bond in order to know that the bond now exists.
//
// AND IT IS THE DEMAND SIGNAL. A pile of broker-seeded STOCKS says the 504-name universe misses what
// people actually hold. A pile of broker-seeded BONDS says the deferred BSE/OTC bond ingestion has
// real users waiting for it. This table is where "what should we build next" stops being a guess.
// ─────────────────────────────────────────────────────────────

/** The audit class's guardType + severity. Named once, so no caller can typo a fault into existence. */
export const BROKER_SEEDED_GUARD: GuardType = "broker_seeded";
export const BROKER_SEEDED_SEVERITY: IngestionSeverity = "info";
/** Synthetic cron — the same trick the scoring class uses, so this can never collide with an
 *  ingestion row on the (cron, guardType, targetField, targetEntity) dedup key. */
export const BROKER_SEEDED_CRON = "broker:auto_admit";

export interface ReportBrokerSeededInput {
  /** The spine. Also the dedup key — one event per instrument, forever. */
  isin: string;
  /** The instrument's BROKER-NEUTRAL name as stored (today: the exchange tradingsymbol — the broker
   *  sends no company name, so this is genuinely all anyone told us). Never broker-branded. */
  name: string;
  /** What it was admitted AS, per the ISIN taxonomy. */
  assetClass: string;
  /** Why the taxonomy classed it that way — the audit trail for the decision, in one line. */
  reason: string;
  /** The broker that surfaced it. Recorded ON THE EVENT ONLY — never on the instrument, which is a
   *  shared row and must stay broker-neutral. Optional: the resolver does not always know it. */
  broker?: string | null;
}

/**
 * Record that a broker seeded a new catalogue instrument. INFORMATIONAL — never a fault.
 *
 * BEST-EFFORT, never throws: an audit write must never be able to break the sync it is auditing. A
 * user's holdings importing correctly matters more than our record of it being complete.
 */
export async function reportBrokerSeeded(input: ReportBrokerSeededInput): Promise<string | null> {
  const { isin, name, assetClass, reason, broker = null } = input;

  try {
    // Dedup on the ISIN, across ANY status. Unlike a fault — which legitimately re-opens after being
    // resolved, because the underlying problem came back — an admission is a ONE-TIME HISTORICAL
    // EVENT. It happened once. Once an operator has seen it and dismissed it, it must never claw its
    // way back into the feed, so a re-fire bumps the counter and leaves the status alone.
    const existing = await prisma.ingestionError.findFirst({
      where: { cron: BROKER_SEEDED_CRON, guardType: BROKER_SEEDED_GUARD, targetEntity: isin },
      select: { id: true },
    });

    if (existing) {
      await prisma.ingestionError.update({
        where: { id: existing.id },
        data: { occurrences: { increment: 1 }, lastSeenAt: new Date() },
      });
      return existing.id;
    }

    const created = await prisma.ingestionError.create({
      data: {
        source: "broker",
        cron: BROKER_SEEDED_CRON,
        guardType: BROKER_SEEDED_GUARD,
        targetTable: assetClass === "stock" ? "Stock" : "Instrument",
        targetField: "asset_class",
        targetEntity: isin,
        severity: BROKER_SEEDED_SEVERITY,
        // There is nothing to FIX, so there is no fill button and no rescore. `source_code` is the
        // honest "a human looks at this if they want to", which is exactly what an audit row is.
        resolutionPath: "source_code",
        expected: `an instrument the catalogue already knew`,
        observed: `${isin} — "${name}" — surfaced by a broker holding${broker ? ` (${broker})` : ""}, admitted as asset_class=${assetClass}`,
        detail:
          `AUTO-ADMITTED (informational — NOT a fault, nothing to fix). A broker holding carried an ISIN ` +
          `no ingest had ever shown us, so it was admitted to the shared catalogue on the ISIN spine. ` +
          `Classification: ${reason} ` +
          (assetClass === "stock"
            ? `It is HELD-NOT-SCORED: no peer group, therefore no Health Score. Scoring it is a separate, ` +
              `deliberate promotion. Daily prices will pick it up from the next run onward.`
            : `It is HELD-NOT-SCORED by construction (stock_id NULL — the scoring universe cannot see it). ` +
              `If it ever prints in an NSE BhavCopy, the ingest will upgrade this placeholder name to its real one.`),
        runRef: null,
      },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    console.error(`[reportBrokerSeeded] failed to record ${isin} (${assetClass}):`, err);
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
