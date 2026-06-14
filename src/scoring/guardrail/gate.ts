// File: src/scoring/guardrail/gate.ts
//
// THE GATE — Layer 1, runs BEFORE Layer-2 scoring (§0.1 two-layer pipeline). For a
// stock at a snapshot it: selects the applicable signatures (built + industry-path
// routed), evaluates each (pure detection), resolves every FIRED signature to its
// outcome (→ directives / stock-actions / annotations) and writes the audit event.
// Output is a GuardrailEvalResult held IN MEMORY — the directives gate scoring; the
// rows persist after.
//
// ── ORDERING (important; resolves an apparent FK cycle) ──────────────────────────
// score_suppressions is consumed by Layer-2 BEFORE any ScoreSnapshot exists. But
// score_guardrail_events.snapshot_id is a NOT-NULL FK to ScoreSnapshot, and a
// suppression's source_guardrail_event_id FKs the event. So within ONE scoring run:
//   1. GATE (this file): compute signatures → directives + events IN MEMORY. The
//      directives are keyed by `snapshotKey` (the runId/periodKey STRING — no FK),
//      which is known at run start. ← this is what Layer-2 reads.
//   2. SCORING (Layer 2): consume the directives via toSuppressionPredicate() →
//      produce pillar scores + the ScoreSnapshot row.
//   3. PERSIST (post-snapshot): now snapshotId exists → write the event rows, then
//      the suppression rows (source_guardrail_event_id resolvable). persist.ts does
//      this; in DRY-RUN it only plans.
// The CONSUMPTION seam is therefore the snapshotKey-keyed directive (FK-free); the
// FKs are provenance/teardown only. This matches the schema comment on
// SuppressionDirective ("stockId is a plain captured key … provenance runs through
// sourceGuardrailEventId").

import {
  type GuardrailStockInput,
  type GuardrailEvalResult,
  type GuardrailEventRow,
  type SuppressionDirectiveRow,
  type StockLevelAction,
  type Annotation,
  type PendingReview,
} from "./types.js";
import { resolveOutcome } from "./outcomes.js";
import { proposeReview } from "./review.js";
import { applicableBuiltSignatures } from "./signatures/registry.js";

/** Run the gate over ONE stock at ONE snapshot. Pure (no DB). */
export function runGuardrailGate(input: GuardrailStockInput): GuardrailEvalResult {
  const events: GuardrailEventRow[] = [];
  const directives: SuppressionDirectiveRow[] = [];
  const stockActions: StockLevelAction[] = [];
  const annotations: Annotation[] = [];
  const pendingReviews: PendingReview[] = [];
  const notes: string[] = [];

  for (const desc of applicableBuiltSignatures(input.industryPath)) {
    const sig = desc.signature!;
    if (!sig.applies(input)) {
      notes.push(`${sig.key}: did not evaluate (applies()=false — inputs absent / path mismatch)`);
      continue;
    }
    const result = sig.evaluate(input);
    if (result === null) {
      notes.push(`${sig.key}: could not evaluate (null — missing inputs)`);
      continue;
    }
    if (!result.fired) {
      // O1-style "flag cleared" — log nothing to the math, note for completeness.
      notes.push(`${sig.key}: evaluated, did not fire (${result.outcome}) — ${result.explanation}`);
      continue;
    }

    // ── AUTO vs REVIEW — the structural distinction (§0.7) ──
    // AUTO: resolve the outcome NOW (suppression/annotation/hold applies immediately).
    // REVIEW: write the audit event, HOLD the resolution as a PendingReview — nothing
    // applies until an operator records an `upheld` ruling (review.ts state machine).
    if (result.tier === "review") {
      const pending = proposeReview(result, { stockId: input.stockId, snapshotKey: input.snapshotKey });
      events.push(pending.event);
      pendingReviews.push(pending);
      notes.push(`${sig.key}: FIRED → REVIEW (proposed ${result.outcome}) · audit event written, resolution PENDING operator ruling (nothing applied yet)`);
      continue;
    }

    const resolved = resolveOutcome(result, { stockId: input.stockId, snapshotKey: input.snapshotKey });
    events.push(resolved.event);
    directives.push(...resolved.directives);
    stockActions.push(...resolved.stockActions);
    annotations.push(...resolved.annotations);
    notes.push(
      `${sig.key}: FIRED → ${result.outcome} (${result.tier})` +
        (resolved.directives.length ? ` · ${resolved.directives.length} suppression(s) [${resolved.directives.map((d) => d.metricKey).join(",")}]` : "") +
        (resolved.stockActions.length ? ` · ${resolved.stockActions.map((a) => a.kind).join(",")}` : "") +
        (resolved.annotations.length ? ` · annotated` : ""),
    );
  }

  return {
    stockId: input.stockId,
    symbol: input.symbol,
    snapshotKey: input.snapshotKey,
    events,
    directives,
    stockActions,
    annotations,
    pendingReviews,
    notes,
  };
}

/** Run the gate over every member of a peer group. Returns per-stock results AND
 *  the FLATTENED directive list — the flattened list is what builds the PG-wide
 *  suppression predicate (a peer's μ/σ exclusion depends on OTHER stocks' directives,
 *  so the predicate must see the whole PG's directives at once). */
export function runGuardrailGateForPG(inputs: GuardrailStockInput[]): {
  byStock: Map<string, GuardrailEvalResult>;
  allDirectives: SuppressionDirectiveRow[];
  allEvents: GuardrailEventRow[];
  allStockActions: StockLevelAction[];
} {
  const byStock = new Map<string, GuardrailEvalResult>();
  const allDirectives: SuppressionDirectiveRow[] = [];
  const allEvents: GuardrailEventRow[] = [];
  const allStockActions: StockLevelAction[] = [];
  for (const input of inputs) {
    const r = runGuardrailGate(input);
    byStock.set(input.stockId, r);
    allDirectives.push(...r.directives);
    allEvents.push(...r.events);
    allStockActions.push(...r.stockActions);
  }
  return { byStock, allDirectives, allEvents, allStockActions };
}
