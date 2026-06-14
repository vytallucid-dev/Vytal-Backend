// File: src/scoring/guardrail/review.ts
//
// THE REVIEW STATE MACHINE — the operator-ruling path for REVIEW-tier signatures
// (§0.7 / §7). Phase-1's only review signature is B-5 (HoldCo extraction); C-1 is a
// later prompt. The structural distinction from AUTO:
//
//   AUTO     signature fires → gate resolves the outcome → suppression/annotation
//            applies IMMEDIATELY (the metrics-affected map is fixed → deterministic).
//   REVIEW   signature fires → gate writes the audit event + holds a PendingReview
//            → NOTHING applies → an operator records a ruling → THEN:
//              • upheld     → the proposed outcome is resolved & applied (directives
//                             /annotation produced now);
//              • overridden → nothing applied, the decision is logged;
//              • deferred   → still pending; the stock scores NORMALLY meanwhile,
//                             flagged "under review".
//
// score_guardrail_reviews is append-only; the LATEST ruling (by ruledAt) wins. The
// operator INPUT is a stub here (recordRuling builds the row) — the point is the
// detect → review → ruling → apply STATE MACHINE, not a UI.

import { resolveOutcome, localEventId, type ResolvedOutcome } from "./outcomes.js";
import type {
  SignatureResult,
  PendingReview,
  GuardrailEventRow,
  SuppressionDirectiveRow,
  StockLevelAction,
  Annotation,
  Outcome,
} from "./types.js";

/** Mirror schema enum GuardrailRuling. */
export type Ruling = "upheld" | "overridden" | "deferred";

/** score_guardrail_reviews create-shape (prisma GuardrailReview). guardrailEventId
 *  resolves from the source event at persist; ruledAt is supplied by the caller
 *  (no Date.now() in pure code — the run passes asOfDate). */
export interface GuardrailReviewRow {
  sourceLocalEventId: string; // → guardrail_event_id
  operatorId: string;
  ruling: Ruling;
  reason: string | null;
  ruledAt: Date;
  proposedOutcome: Outcome; // denormalised for plan/inspection (not a DB column)
}

/** Build the PendingReview for a fired REVIEW-tier signature: write the audit event
 *  (tier forced to "review"), hold the verdict, apply NOTHING. */
export function proposeReview(result: SignatureResult, ctx: { stockId: string; snapshotKey: string }): PendingReview {
  const event: GuardrailEventRow = {
    localEventId: localEventId(ctx.stockId, result.signatureKey),
    stockId: ctx.stockId,
    snapshotId: null, // resolved post-snapshot at persist
    signatureKey: result.signatureKey,
    triggeringValues: result.triggeringValues,
    outcome: result.outcome, // the PROPOSED outcome (not yet applied)
    tier: "review",
  };
  return { event, result, state: "pending" };
}

/** The operator-input stub: record a ruling against a pending review. (A real admin
 *  route / function would call this; here it just shapes the row.) */
export function recordRuling(
  pending: PendingReview,
  input: { operatorId: string; ruling: Ruling; reason?: string | null; ruledAt: Date },
): GuardrailReviewRow {
  return {
    sourceLocalEventId: pending.event.localEventId,
    operatorId: input.operatorId,
    ruling: input.ruling,
    reason: input.reason ?? null,
    ruledAt: input.ruledAt,
    proposedOutcome: pending.result.outcome,
  };
}

/** What applying a ruling produces. For `upheld` the proposed outcome is resolved
 *  NOW (this is where a review-tier O2 would finally write its suppression, or B-5's
 *  O3 its annotation). For `overridden`/`deferred` nothing is applied. The audit
 *  event already exists (written at proposeReview); we do NOT re-emit it. */
export interface RulingApplication {
  applied: boolean;
  ruling: Ruling;
  directives: SuppressionDirectiveRow[];
  annotations: Annotation[];
  stockActions: StockLevelAction[];
  note: string;
}

/** Apply a recorded ruling to a pending review. */
export function applyRuling(pending: PendingReview, ruling: Ruling, ctx: { stockId: string; snapshotKey: string }): RulingApplication {
  switch (ruling) {
    case "upheld": {
      // Resolve the held verdict now. resolveOutcome rebuilds the event with the
      // SAME deterministic localEventId (idempotent — it is the already-written
      // audit row), so callers/persist apply only the directives/annotations/actions.
      const resolved: ResolvedOutcome = resolveOutcome(pending.result, ctx);
      return {
        applied: true,
        ruling,
        directives: resolved.directives,
        annotations: resolved.annotations,
        stockActions: resolved.stockActions,
        note: `upheld → proposed ${pending.result.outcome} applied (${resolved.directives.length} suppression(s), ${resolved.annotations.length} annotation(s), ${resolved.stockActions.length} action(s))`,
      };
    }
    case "overridden":
      return { applied: false, ruling, directives: [], annotations: [], stockActions: [], note: "overridden → nothing applied; the decision is logged (stock scores normally)" };
    case "deferred":
      return { applied: false, ruling, directives: [], annotations: [], stockActions: [], note: "deferred → still pending; stock scores normally, flagged under review" };
  }
}
