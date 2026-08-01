// File: src/scoring/guardrail/scoring-gate.ts
//
// THE SCORING-PASS INTEGRATION — Layer 1 (the gate) as consumed by Layer 2.
//
// This is the ONLY place the live scoring pass touches the guardrail layer. It:
//   1. builds a GuardrailStockInput per member from inputs the pass ALREADY loaded,
//   2. runs the gate with the `disabled` signatures filtered out (never evaluated),
//   3. applies the behaviour contract (behaviour.ts) so only suppress-signatures
//      keep their directives,
//   4. hands back the SuppressionPredicates that scoreMetricCrossSection consumes.
//
// ── WHERE THIS SITS IN THE PASS (load-bearing) ───────────────────────────────────
// It must run AFTER metric values are resolved (dispatchLiveValues has produced each
// member's foundation/momentum MetricValue[]) and BEFORE scoreMetricCrossSection
// computes peer μ/σ — because an O2 suppression removes the value from the peer
// cross-section, so the predicate must exist before the statistics are taken. In
// score-pass.ts that is the gap between the `raws` loop and scorePillarKeys().
//
// ── ZERO ADDITIONAL DB READS ─────────────────────────────────────────────────────
// Every input below comes from data the pass already holds in `raws` (annual
// fundamentals, shareholding). Nothing here queries. That is not an accident: the
// three signatures needing extra data (A-1 filing dates, A-4 activity, C-2 corporate
// actions) are exactly the three that are `disabled`, so their inputs are left absent
// and never read. If one of them is ever enabled, its input must be sourced FIRST —
// leaving the field absent would make the signature silently no-op, which is the
// failure mode this layer exists to prevent.

import type {
  GuardrailStockInput,
  GuardrailEvalResult,
  LatestFundamentalInput,
  IndustryPath,
} from "./types.js";
import { runGuardrailGateForPG } from "./gate.js";
import { applyBehaviourForPG, type BehaviourAudit } from "./behaviour.js";
import { isEvaluable, behaviourGroups } from "./signatures/registry.js";
import { toSuppressionPredicates } from "./suppression-adapter.js";
import { NO_SUPPRESSION, type SuppressionInput } from "../metric-scoring/types.js";
import { netWorthFrom, type FoundationAnnual } from "../metrics/types.js";
import type { OwnershipQuarter } from "../ownership/types.js";

/** The per-member substrate the gate needs, as the scoring pass already has it. */
export interface GateMemberSource {
  stockId: string;
  symbol: string;
  /** Standalone annual rows. EMPTY for banks (the pass does not load them on the
   *  banking path) ⇒ latest/priorFundamental are null ⇒ A-2/B-* cannot evaluate and
   *  return null. Honest no-opinion, not a silent pass. */
  fRows: FoundationAnnual[];
  /** Shareholding quarters (ascending). Last row supplies B-5's promoterPct. */
  own: OwnershipQuarter[];
}

/**
 * FoundationAnnual → the gate's fundamental shape.
 *
 * ⚠ DELIBERATE DUPLICATE of the identical private converter in
 * findings/guards/annual-exceptional.ts. That file is a load-bearing production
 * caller of runGuardrailGate (it gates P7/P12/N1) and is under a do-not-modify
 * constraint, so we do not reach into it to export this. The two must stay in step:
 * `tax` is DERIVED (PBT − NP; FoundationAnnual carries no tax column) and
 * `operatingMargin` is the stored EBITDA-based annual OPM, which is what the
 * below-line B-family arithmetic expects.
 */
function toFundInput(r: FoundationAnnual): LatestFundamentalInput {
  return {
    fiscalYear: r.fiscalYear,
    revenue: r.revenue,
    netProfit: r.netProfit,
    netWorth: netWorthFrom(r),
    totalAssets: r.totalAssets,
    profitBeforeTax: r.profitBeforeTax,
    tax: r.profitBeforeTax !== null && r.netProfit !== null ? r.profitBeforeTax - r.netProfit : null,
    otherIncome: r.otherIncome,
    financeCosts: r.financeCosts,
    operatingMargin: r.stored.operatingMargin,
  };
}

/** Build ONE member's gate input from the pass's own loaded rows. */
export function buildGateInput(m: GateMemberSource, ctx: { industryPath: IndustryPath; snapshotKey: string }): GuardrailStockInput {
  const sorted = [...m.fRows].sort((a, b) => a.fyOrdinal - b.fyOrdinal);
  const latest = sorted.length ? sorted[sorted.length - 1] : null;
  const prior = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const latestSh = m.own.length ? m.own[m.own.length - 1] : null;

  return {
    stockId: m.stockId,
    symbol: m.symbol,
    industryPath: ctx.industryPath,
    snapshotKey: ctx.snapshotKey,
    latestFundamental: latest ? toFundInput(latest) : null,
    priorFundamental: prior ? toFundInput(prior) : null,
    promoterPct: latestSh?.promoterPct ?? null,
    history: { fundamentalRows: m.fRows.length, shareholdingRows: m.own.length },
    // quarterlyFiling (A-1), activity (A-4), corporateAction (C-2) deliberately ABSENT
    // — all three signatures are `disabled` and are never evaluated. See header.
    // bandFlipDetected deliberately ABSENT — the B-3/B-4 second pass is not built, so
    // both correctly resolve to O3 (and are `annotate` regardless).
  };
}

export interface ScoringGateResult {
  /** False ⇒ the gate did not run; `reason` says why. Suppression is NO_SUPPRESSION. */
  ran: boolean;
  reason: string | null;
  /** BEHAVIOUR-FILTERED per-stock results. `directives` here are suppress-only, so
   *  this is safe to hand to both the predicate and the persist path. */
  results: GuardrailEvalResult[];
  /** What scoreMetricCrossSection consumes. NO_SUPPRESSION when the gate did not run. */
  suppression: SuppressionInput;
  audits: BehaviourAudit[];
  /** Run-log summary — never silent. */
  summary: {
    membersEvaluated: number;
    firedEvents: number;
    appliedDirectives: number;
    strippedDirectives: number;
    pendingReviews: number;
    stockActions: number;
  };
}

/** The no-op result — identical scoring to a pass with no guardrail at all. */
export function gateNotRun(reason: string): ScoringGateResult {
  return {
    ran: false,
    reason,
    results: [],
    suppression: NO_SUPPRESSION,
    audits: [],
    summary: { membersEvaluated: 0, firedEvents: 0, appliedDirectives: 0, strippedDirectives: 0, pendingReviews: 0, stockActions: 0 },
  };
}

/**
 * Run Layer 1 over a whole peer group and produce the Layer-2 suppression seam.
 *
 * PG-wide by construction: the predicate must see every member's directives at once,
 * because one member's O2 changes the μ/σ every OTHER member is scored against.
 */
export function runScoringGate(members: GateMemberSource[], ctx: { industryPath: IndustryPath; snapshotKey: string }): ScoringGateResult {
  const inputs = members.map((m) => buildGateInput(m, ctx));
  // `disabled` signatures are filtered HERE — skipped before applies()/evaluate(),
  // so they cannot fire, cannot emit an event, and cost nothing.
  const raw = runGuardrailGateForPG(inputs, { signatureFilter: isEvaluable });
  const rawResults = [...raw.byStock.values()];

  // THE STRUCTURAL GATE: strip every directive whose signature may not suppress.
  const { results, suppressDirectives, audits } = applyBehaviourForPG(rawResults);

  return {
    ran: true,
    reason: null,
    results,
    suppression: toSuppressionPredicates(suppressDirectives, ctx.snapshotKey),
    audits,
    summary: {
      membersEvaluated: inputs.length,
      firedEvents: results.reduce((n, r) => n + r.events.length, 0),
      appliedDirectives: suppressDirectives.length,
      strippedDirectives: audits.reduce((n, a) => n + a.strippedDirectives.length, 0),
      pendingReviews: results.reduce((n, r) => n + r.pendingReviews.length, 0),
      stockActions: results.reduce((n, r) => n + r.stockActions.length, 0),
    },
  };
}

/** One-line run-log describing the live contract — printed by the pass so "was this
 *  snapshot gate-screened, and under what contract?" is answerable from the log. */
export function behaviourContractLine(): string {
  const g = behaviourGroups();
  return `guardrail contract — suppress:[${g.suppress.join(",")}] annotate:[${g.annotate.join(",")}] detect:[${g.detect.join(",")}] disabled:[${g.disabled.join(",")}]`;
}
