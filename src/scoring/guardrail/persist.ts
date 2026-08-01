// File: src/scoring/guardrail/persist.ts
//
// GUARDRAIL WRITE PATH — persists the audit trail (§7) and the suppression
// directives (§0.8) AFTER the snapshot exists (the FK ordering in gate.ts). Builds
// the EXACT prisma row shapes for score_guardrail_events + score_suppressions and,
// in real mode, commits them in ONE transaction:
//
//   score_guardrail_events (one per fired signature)  ─┐
//                                                       ├─ events first (snapshot_id FK),
//   score_suppressions (one per O2/O4 affected metric) ─┘  then suppressions whose
//                                                          source_guardrail_event_id
//                                                          resolves to the event row.
//
// DRY-RUN GATE (consistent with the rest of the engine): with dryRun=true this PLANS
// the rows and mutates NOTHING. The directive CONSUMPTION (toSuppressionPredicate →
// wire.ts) does NOT depend on this write — it runs off the in-memory directives — so
// the seam is fully exercisable in dry-run while persistence stays gated.
//
// O5/O6 (stock-level hold/remove) and O3 (annotation) are NOT score_suppressions
// rows: hold/remove are run-orchestrator actions (the audit event still records
// them), and an annotation is the event + a flag. Only O2/O4 produce suppression
// rows. This layer writes the events for ALL of them (audit completeness) and the
// suppression rows for O2/O4.

import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import type { GuardrailEvalResult, Outcome, Tier } from "./types.js";
import type { GuardrailReviewRow, RulingApplication } from "./review.js";

type Db = Prisma.TransactionClient;

/** score_guardrail_events create-shape (prisma GuardrailEvent). */
export interface GuardrailEventCreate {
  stockId: string;
  /** The PERIOD ("FY27Q1") — the identity column. Always set; independent of any snapshot. */
  snapshotKey: string;
  /** Provenance only. Set ONLY when this run created that snapshot; null when the score did not
   *  change (skipped_identical) or was unavailable. NULL is normal, and is NEVER back-filled to a
   *  pre-existing snapshot — that snapshot was not screened, and pointing at it would say it was. */
  snapshotId: string | null;
  signatureKey: string;
  triggeringValues: object;
  outcome: Outcome;
  tier: Tier;
}

/** score_suppressions create-shape (prisma SuppressionDirective). sourceGuardrailEventId
 *  is resolved from the just-written event in real mode; a placeholder in dry-run. */
export interface SuppressionCreate {
  stockId: string;
  snapshotKey: string;
  metricKey: string;
  sourceGuardrailEventId: string;
  outcome: Outcome;
  excludeFromOwnScore: boolean;
  excludeFromPeerMean: boolean;
}

export interface GuardrailWriteContext {
  /** The PERIOD these events belong to. One write call = one period. Required — it is the
   *  identity column, and it is never inferred from "current" (the universe spans two periods
   *  at once, so "current" is ambiguous). */
  snapshotKey: string;
  /** stockId → the ScoreSnapshot id THIS RUN created for it, where it created one. A stock
   *  absent from this map (score unchanged, or composite unavailable) still gets its events
   *  written, with snapshot_id NULL — detection is recorded whether or not a score moved. */
  snapshotIdByStock: Map<string, string> | null;
  dryRun: boolean;
  /** TX-INJECTION (house rule: the caller owns the transaction). When set, rows are
   *  written on THIS client and no inner transaction is opened — so a caller that
   *  wraps the scoring pass in a tx (and may roll it back, as the proof harnesses do)
   *  gets guardrail rows inside that same atomic unit. When absent, this opens its own
   *  transaction, preserving the original standalone behaviour for existing callers. */
  db?: Db;
}

export interface GuardrailWritePlan {
  action: "wrote" | "would_write_dry_run";
  eventRows: (GuardrailEventCreate & { _localEventId: string; _snapshotResolved: boolean })[];
  suppressionRows: (SuppressionCreate & { _sourceLocalEventId: string })[];
  /** O5/O6 actions surfaced for the run orchestrator (not a table written here). */
  stockActions: { kind: string; stockId: string; reason: string; requiresOperatorConfirm: boolean }[];
  annotations: { stockId: string; metricKeys: string[]; text: string }[];
  notes: string[];
}

/** Build the plan (and, in real mode, write) for a SET of per-stock gate results at
 *  one snapshot. Pass the whole PG so events + suppressions write together. */
export async function writeGuardrailEval(
  results: GuardrailEvalResult[],
  ctx: GuardrailWriteContext,
): Promise<GuardrailWritePlan> {
  const notes: string[] = [];
  const eventRows: GuardrailWritePlan["eventRows"] = [];
  const suppressionRows: GuardrailWritePlan["suppressionRows"] = [];
  const stockActions: GuardrailWritePlan["stockActions"] = [];
  const annotations: GuardrailWritePlan["annotations"] = [];

  const snapId = (stockId: string): string | null => ctx.snapshotIdByStock?.get(stockId) ?? null;

  for (const r of results) {
    for (const e of r.events) {
      const sid = snapId(e.stockId);
      eventRows.push({
        _localEventId: e.localEventId,
        _snapshotResolved: sid !== null,
        stockId: e.stockId,
        snapshotKey: ctx.snapshotKey,
        snapshotId: sid, // null ⇒ no snapshot written this run; the event is still recorded
        signatureKey: e.signatureKey,
        triggeringValues: e.triggeringValues as object,
        outcome: e.outcome,
        tier: e.tier,
      });
    }
    for (const d of r.directives) {
      suppressionRows.push({
        _sourceLocalEventId: d.sourceLocalEventId,
        stockId: d.stockId,
        snapshotKey: d.snapshotKey,
        metricKey: d.metricKey,
        sourceGuardrailEventId: `(event ${d.sourceLocalEventId})`, // resolved at write
        outcome: d.outcome,
        excludeFromOwnScore: d.excludeFromOwnScore,
        excludeFromPeerMean: d.excludeFromPeerMean,
      });
    }
    for (const a of r.stockActions) stockActions.push({ kind: a.kind, stockId: a.stockId, reason: a.reason, requiresOperatorConfirm: a.requiresOperatorConfirm });
    for (const an of r.annotations) annotations.push({ stockId: an.stockId, metricKeys: an.affectedMetrics.map((m) => m.metricKey), text: an.text });
  }

  // ── DRY-RUN: plan only ──
  if (ctx.dryRun) {
    notes.push(`would write ${eventRows.length} guardrail event(s) + ${suppressionRows.length} suppression row(s)`);
    if (stockActions.length) notes.push(`${stockActions.length} stock-level action(s) (hold/remove) → run orchestrator (no table here)`);
    if (annotations.length) notes.push(`${annotations.length} annotation(s) → event + flag (no suppression)`);
    const unresolved = eventRows.filter((e) => !e._snapshotResolved).length;
    if (unresolved) notes.push(`${unresolved} event(s) await a ScoreSnapshot id (write deferred to post-Layer-2, like the composite/R1 path)`);
    return { action: "would_write_dry_run", eventRows, suppressionRows, stockActions, annotations, notes };
  }

  // ── REAL WRITE — events then suppressions, FK-resolved ──
  // IDEMPOTENT (house rule, cf. ensurePeerStats/writeFmPillar): both tables carry a
  // natural @@unique, so a re-run must get-or-create, never blind-create.
  //   • GuardrailEvent   @@unique([snapshotId, signatureKey])
  //   • SuppressionDirective @@unique([stockId, snapshotKey, metricKey]) ← keyed on the
  //     PERIOD STRING, not the snapshot FK. A supersede writes a NEW snapshot but reuses
  //     the same snapshotKey, so a second scoring run at the same period WOULD collide
  //     here. Get-or-create makes re-scoring safe; the row is append-only either way.
  if (!ctx.snapshotIdByStock) throw new Error("writeGuardrailEval: real write requires snapshotIdByStock (snapshots must exist first)");

  const writeAll = async (tx: Db) => {
    const dbIdByLocal = new Map<string, string>();
    for (const r of results) {
      // A stock with NO snapshot from this run is no longer skipped. Its detections are
      // written with snapshot_id NULL — that is the entire point of the decoupling. The old
      // `if (!sid) continue` here is what silently discarded 79 of 106 detections on the
      // first live run, including B-1/HINDPETRO and A-2/NESTLEIND.
      const sid = ctx.snapshotIdByStock?.get(r.stockId) ?? null;
      for (const e of r.events) {
        // GET-OR-CREATE on the natural identity (stock, period, signature) — NOT on the
        // snapshot. Re-running a pass finds the existing row and reuses its id, so a rescore
        // never duplicates. Load-bearing: A-3 fires on 91 of 95 stocks, so a duplicate-per-run
        // bug would bury the real signal within weeks.
        const existing = await tx.guardrailEvent.findUnique({
          where: { stockId_snapshotKey_signatureKey: { stockId: e.stockId, snapshotKey: ctx.snapshotKey, signatureKey: e.signatureKey } },
          select: { id: true },
        });
        if (existing) { dbIdByLocal.set(e.localEventId, existing.id); continue; }
        const created = await tx.guardrailEvent.create({
          data: {
            stockId: e.stockId,
            snapshotKey: ctx.snapshotKey,
            snapshotId: sid,
            signatureKey: e.signatureKey,
            triggeringValues: e.triggeringValues as object,
            outcome: e.outcome,
            tier: e.tier,
          },
          select: { id: true },
        });
        dbIdByLocal.set(e.localEventId, created.id);
      }
    }
    for (const r of results) {
      for (const d of r.directives) {
        const srcId = dbIdByLocal.get(d.sourceLocalEventId);
        if (!srcId) { notes.push(`suppression ${d.stockId}/${d.metricKey}: source event not written (held) → skipped`); continue; }
        const existing = await tx.suppressionDirective.findUnique({
          where: { stockId_snapshotKey_metricKey: { stockId: d.stockId, snapshotKey: d.snapshotKey, metricKey: d.metricKey } },
          select: { id: true },
        });
        if (existing) continue;
        await tx.suppressionDirective.create({
          data: {
            stockId: d.stockId,
            snapshotKey: d.snapshotKey,
            metricKey: d.metricKey,
            sourceGuardrailEventId: srcId,
            outcome: d.outcome,
            excludeFromOwnScore: d.excludeFromOwnScore,
            excludeFromPeerMean: d.excludeFromPeerMean,
          },
        });
      }
    }
  };

  // Caller-owned tx when injected (no nesting); otherwise our own, as before.
  if (ctx.db) await writeAll(ctx.db);
  else await prisma.$transaction(writeAll);

  notes.push(`wrote ${eventRows.length} event(s) + ${suppressionRows.length} suppression(s)`);
  return { action: "wrote", eventRows, suppressionRows, stockActions, annotations, notes };
}

// ── REVIEW-RULING WRITE PATH (B-5 / future review signatures) ────────────────────
export interface GuardrailReviewWritePlan {
  action: "wrote" | "would_write_dry_run";
  ruling: GuardrailReviewRow["ruling"];
  /** score_guardrail_reviews row shape. */
  reviewRow: { guardrailEventId: string; operatorId: string; ruling: string; reason: string | null; ruledAt: Date };
  /** Suppression rows produced ONLY when the ruling is `upheld` and the proposed
   *  outcome was a suppression (O2/O4). For an upheld O3 (B-5) this is empty —
   *  the annotation is the applied artifact, not a directive. */
  appliedSuppressions: SuppressionCreate[];
  notes: string[];
}

/**
 * Plan (dry-run) or commit (real) an operator ruling on a pending review:
 * always writes the score_guardrail_reviews row; on `upheld` ALSO writes the
 * resolved suppression directives (the structural "suppression waits for the
 * ruling" guarantee). `eventDbId` is the persisted GuardrailEvent id (resolved
 * post-snapshot); a placeholder in dry-run.
 */
export async function writeGuardrailReview(
  review: GuardrailReviewRow,
  application: RulingApplication,
  ctx: { dryRun: boolean; eventDbId?: string | null },
): Promise<GuardrailReviewWritePlan> {
  const notes: string[] = [];
  const eventId = ctx.eventDbId ?? `(event ${review.sourceLocalEventId})`;
  const reviewRow = { guardrailEventId: eventId, operatorId: review.operatorId, ruling: review.ruling, reason: review.reason, ruledAt: review.ruledAt };
  const appliedSuppressions: SuppressionCreate[] = application.directives.map((d) => ({
    stockId: d.stockId, snapshotKey: d.snapshotKey, metricKey: d.metricKey,
    sourceGuardrailEventId: eventId, outcome: d.outcome,
    excludeFromOwnScore: d.excludeFromOwnScore, excludeFromPeerMean: d.excludeFromPeerMean,
  }));

  if (ctx.dryRun) {
    notes.push(`would write 1 score_guardrail_reviews row (ruling=${review.ruling})`);
    notes.push(application.applied ? `upheld → would write ${appliedSuppressions.length} suppression(s) + ${application.annotations.length} annotation(s)` : `${review.ruling} → applies nothing (decision logged)`);
    return { action: "would_write_dry_run", ruling: review.ruling, reviewRow, appliedSuppressions, notes };
  }

  if (!ctx.eventDbId) throw new Error("writeGuardrailReview: real write requires eventDbId (the persisted GuardrailEvent)");
  await prisma.$transaction(async (tx) => {
    await tx.guardrailReview.create({ data: { guardrailEventId: ctx.eventDbId!, operatorId: review.operatorId, ruling: review.ruling, reason: review.reason, ruledAt: review.ruledAt } });
    for (const s of appliedSuppressions) {
      await tx.suppressionDirective.create({ data: { stockId: s.stockId, snapshotKey: s.snapshotKey, metricKey: s.metricKey, sourceGuardrailEventId: ctx.eventDbId!, outcome: s.outcome, excludeFromOwnScore: s.excludeFromOwnScore, excludeFromPeerMean: s.excludeFromPeerMean } });
    }
  });
  notes.push(`wrote ruling ${review.ruling}${application.applied ? ` + ${appliedSuppressions.length} suppression(s)` : ""}`);
  return { action: "wrote", ruling: review.ruling, reviewRow, appliedSuppressions, notes };
}

/** Read-back: load persisted suppression rows for a snapshot (the peer-stats
 *  builder's "who to exclude" query — uses the @@index([snapshotKey, metricKey])).
 *  Returns the row shape the adapter consumes, so a LATER run re-derives the exact
 *  same predicate from the DB. (Safe in dry-run; just reads.) */
export async function loadSuppressionRows(snapshotKey: string) {
  const rows = await prisma.suppressionDirective.findMany({
    where: { snapshotKey },
    select: { stockId: true, snapshotKey: true, metricKey: true, sourceGuardrailEventId: true, outcome: true, excludeFromOwnScore: true, excludeFromPeerMean: true },
  });
  return rows.map((r) => ({
    stockId: r.stockId,
    snapshotKey: r.snapshotKey,
    metricKey: r.metricKey,
    sourceLocalEventId: r.sourceGuardrailEventId,
    outcome: r.outcome as Outcome,
    excludeFromOwnScore: r.excludeFromOwnScore,
    excludeFromPeerMean: r.excludeFromPeerMean,
  }));
}
