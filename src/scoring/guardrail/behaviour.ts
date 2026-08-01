// File: src/scoring/guardrail/behaviour.ts
//
// THE BEHAVIOUR FILTER — the structural seam between "what a signature detected"
// and "what it is allowed to do to a score".
//
// The gate (gate.ts) is pure detection + outcome resolution: it faithfully produces
// whatever directives a signature's own outcome implies. This file stands between
// that raw result and BOTH consumers (the suppression predicate AND the persist
// path), and strips every directive whose signature is not `suppress` in
// GUARDRAIL_BEHAVIOUR.
//
// ── WHY FILTER BY SIGNATURE KEY, NOT BY OUTCOME ──────────────────────────────────
// The naive filter is "drop O3/O5/O6, keep O2/O4". That trusts each signature to
// keep returning the outcome we expect. It is one edit away from silent failure: if
// B-3 were changed tomorrow to return O2 on some new branch, an outcome-based filter
// would hand it suppression power over the composite with no review and no signal.
//
// So the filter keys on the SIGNATURE, resolved through the directive's
// sourceLocalEventId → its event → signatureKey. A signature acquires the ability to
// move a number ONLY by being changed to "suppress" in GUARDRAIL_BEHAVIOUR — an edit
// to the contract itself, which is reviewable, greppable, and the whole point.
//
// ── WHAT SURVIVES ────────────────────────────────────────────────────────────────
//   suppress  → directives kept (reach the predicate + become score_suppressions)
//   annotate  → directives DROPPED. Event still written.
//   detect    → directives DROPPED. Event + pendingReview still written.
//   disabled  → never got here (gate.ts skipped it before applies()).
// Events, annotations, stockActions and pendingReviews are ALWAYS preserved — the
// audit trail records everything that fired; only the score-changing half is gated.

import type { GuardrailEvalResult, SuppressionDirectiveRow, SignatureKey } from "./types.js";
import { canSuppress, GUARDRAIL_BEHAVIOUR, type GuardrailBehaviour } from "./signatures/registry.js";

/** What the filter removed, for the run log (a silent drop is the failure mode we
 *  keep re-fixing — every stripped directive is reported, never swallowed). */
export interface BehaviourAudit {
  /** Directives removed because their signature may not suppress. */
  strippedDirectives: { signatureKey: SignatureKey; behaviour: GuardrailBehaviour; stockId: string; metricKey: string; outcome: string }[];
  /** Signature keys that fired at all, with their behaviour — the "what happened" line. */
  firedByBehaviour: Record<GuardrailBehaviour, SignatureKey[]>;
}

/** Resolve a directive back to the signature that produced it (via its event). */
function signatureOf(r: GuardrailEvalResult, d: SuppressionDirectiveRow): SignatureKey | null {
  return r.events.find((e) => e.localEventId === d.sourceLocalEventId)?.signatureKey ?? null;
}

/**
 * Apply the behaviour contract to ONE stock's gate result.
 *
 * Returns a result whose `directives` contain ONLY suppress-behaviour rows. Because
 * both the suppression predicate and the persist path read from this same filtered
 * object, there is no path by which an annotate/detect directive reaches a score or
 * a score_suppressions row — the filtered-out rows do not exist downstream.
 */
export function applyBehaviour(r: GuardrailEvalResult): { result: GuardrailEvalResult; audit: BehaviourAudit } {
  const strippedDirectives: BehaviourAudit["strippedDirectives"] = [];
  const kept: SuppressionDirectiveRow[] = [];

  for (const d of r.directives) {
    const sig = signatureOf(r, d);
    // Unattributable directive ⇒ DROP. A directive whose event we cannot find has no
    // provable behaviour, and the safe reading of "unknown" is "not allowed to score".
    if (!sig) {
      strippedDirectives.push({ signatureKey: "?" as SignatureKey, behaviour: "detect", stockId: d.stockId, metricKey: d.metricKey, outcome: d.outcome });
      continue;
    }
    if (canSuppress(sig)) kept.push(d);
    else strippedDirectives.push({ signatureKey: sig, behaviour: GUARDRAIL_BEHAVIOUR[sig], stockId: d.stockId, metricKey: d.metricKey, outcome: d.outcome });
  }

  const firedByBehaviour: BehaviourAudit["firedByBehaviour"] = { suppress: [], annotate: [], detect: [], disabled: [] };
  for (const e of r.events) {
    const b = GUARDRAIL_BEHAVIOUR[e.signatureKey];
    if (b && !firedByBehaviour[b].includes(e.signatureKey)) firedByBehaviour[b].push(e.signatureKey);
  }

  return { result: { ...r, directives: kept }, audit: { strippedDirectives, firedByBehaviour } };
}

/** Apply the contract across a whole PG. Returns the filtered per-stock results plus
 *  the FLATTENED surviving directive list (the PG-wide predicate needs every member's
 *  directives at once — a peer's μ/σ exclusion depends on OTHER stocks' directives). */
export function applyBehaviourForPG(results: GuardrailEvalResult[]): {
  results: GuardrailEvalResult[];
  suppressDirectives: SuppressionDirectiveRow[];
  audits: BehaviourAudit[];
} {
  const out: GuardrailEvalResult[] = [];
  const audits: BehaviourAudit[] = [];
  const suppressDirectives: SuppressionDirectiveRow[] = [];
  for (const r of results) {
    const { result, audit } = applyBehaviour(r);
    out.push(result);
    audits.push(audit);
    suppressDirectives.push(...result.directives);
  }
  return { results: out, suppressDirectives, audits };
}
