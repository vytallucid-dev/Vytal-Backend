// File: src/scoring/guardrail/outcomes.ts
//
// THE SIX-OUTCOME ACTION SPACE (§0.6) — resolution of a fired signature into the
// concrete artifacts Layer-2 + persist consume. This is the single place that turns
// an `Outcome` into score_suppressions directives / stock-level actions /
// annotations, so the §0.8 "suppress = EXCLUDE, both halves, from one row" mechanic
// is defined EXACTLY ONCE and every signature inherits it.
//
//   O1 score normally   → nothing (flag cleared); event still logged (§7).
//   O2 suppress metric  → one directive per affected metric, BOTH booleans true
//                         (own-score + peer-mean). THE dual-exclusion. + audit event.
//   O3 annotate         → an Annotation (visible note), NO directive, NO math change.
//   O4 suppress peer    → one directive per affected metric, excludeFromOwnScore
//                         FALSE / excludeFromPeerMean TRUE (own score kept). + event.
//   O5 hold             → a stock-level hold action (freeze last clean). + event.
//   O6 remove           → a stock-level remove action (exit scoring + peer set),
//                         operator-confirm. + event.
//
// SUPPRESSION IS EXCLUDE, NEVER reweight-to-fabricate, NEVER substitute (§0.8). This
// file only sets the two booleans + keys the row; the EXCLUSION itself is performed
// by the already-built consumer (metric-scoring/wire.ts), which drops the metric and
// renormalizes survivors. We never write a substitute value anywhere.

import type {
  SignatureResult,
  GuardrailEventRow,
  SuppressionDirectiveRow,
  StockLevelAction,
  Annotation,
  AffectedMetric,
} from "./types.js";

/** What resolving one fired signature produces. The event is ALWAYS present (§7
 *  audit: every firing is logged regardless of outcome). The rest depend on the
 *  outcome. */
export interface ResolvedOutcome {
  event: GuardrailEventRow;
  directives: SuppressionDirectiveRow[];
  stockActions: StockLevelAction[];
  annotations: Annotation[];
}

/** Deterministic uuid-free local id: signatureKey is unique per snapshot
 *  (schema @@unique([snapshotId, signatureKey])), so "<stockId>:<signatureKey>" is a
 *  stable in-run correlation key for wiring directives → their source event WITHOUT
 *  Math.random()/Date.now() (unavailable / non-deterministic). The DB row gets a
 *  real uuid at persist time; this only correlates the in-memory graph. */
export function localEventId(stockId: string, signatureKey: string): string {
  return `evt:${stockId}:${signatureKey}`;
}

/**
 * Resolve a FIRED signature into directives/actions/annotations + its audit event.
 * Precondition: result.fired === true (the gate only calls this for fired
 * signatures). The signature has ALREADY chosen its `outcome` (e.g. A-2 picks O2 or
 * escalates to O5); this function only mechanises that choice — it does not decide.
 */
export function resolveOutcome(
  result: SignatureResult,
  ctx: { stockId: string; snapshotKey: string },
): ResolvedOutcome {
  const evtId = localEventId(ctx.stockId, result.signatureKey);
  const event: GuardrailEventRow = {
    localEventId: evtId,
    stockId: ctx.stockId,
    snapshotId: null, // resolved post-snapshot at persist (ordering note in gate.ts)
    signatureKey: result.signatureKey,
    triggeringValues: result.triggeringValues,
    outcome: result.outcome,
    tier: result.tier,
  };

  const directives: SuppressionDirectiveRow[] = [];
  const stockActions: StockLevelAction[] = [];
  const annotations: Annotation[] = [];

  const mkDirective = (m: AffectedMetric, excludeOwn: boolean, excludePeer: boolean): SuppressionDirectiveRow => ({
    stockId: ctx.stockId,
    snapshotKey: ctx.snapshotKey,
    metricKey: m.metricKey,
    sourceLocalEventId: evtId,
    outcome: result.outcome,
    excludeFromOwnScore: excludeOwn,
    excludeFromPeerMean: excludePeer,
  });

  switch (result.outcome) {
    case "O1":
      // Flag cleared, no distortion. Event logged for the audit trail; nothing else.
      break;

    case "O2":
      // THE dual-exclusion (§0.8 a+b): one row per affected metric, both true.
      for (const m of result.affectedMetrics) directives.push(mkDirective(m, true, true));
      break;

    case "O3":
      // Annotate only — full score computed, visible note, NO math change.
      annotations.push({
        stockId: ctx.stockId,
        snapshotKey: ctx.snapshotKey,
        sourceLocalEventId: evtId,
        affectedMetrics: result.affectedMetrics,
        text: result.explanation,
      });
      break;

    case "O4":
      // Peer-set exclusion ONLY — own score kept (§0.6 O4 / §0.8: half of O2).
      for (const m of result.affectedMetrics) directives.push(mkDirective(m, false, true));
      break;

    case "O5":
      // Hold — freeze last clean composite; skip this period's update.
      stockActions.push({
        kind: "hold",
        stockId: ctx.stockId,
        snapshotKey: ctx.snapshotKey,
        sourceLocalEventId: evtId,
        reason: result.explanation,
        requiresOperatorConfirm: false, // pure hold is auto; A-1's 2Q→remove sets this true
      });
      break;

    case "O6":
      // Remove — exit scoring + peer set; operator one-tap confirm (peer-set integrity).
      stockActions.push({
        kind: "remove",
        stockId: ctx.stockId,
        snapshotKey: ctx.snapshotKey,
        sourceLocalEventId: evtId,
        reason: result.explanation,
        requiresOperatorConfirm: true,
      });
      break;
  }

  return { event, directives, stockActions, annotations };
}
