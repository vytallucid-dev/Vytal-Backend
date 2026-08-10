// File: src/filing/pass.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE FILING PASS — stock-keyed, peer-group-free, snapshot-free.
//
// Takes a stock. Resolves its filed context. Evaluates the 22 filing rules. Upserts one row per rule
// into stock_findings, keyed on the period of the filing that rule read.
//
// It does not take a peer group, does not read a composite / band / pillar / snapshot, and does not
// require a ScoreSnapshot to exist. That is not a convention here — the rules are typed `FilingRule`
// against a context that HAS no score fields (findings/types.ts), so a rule that drifts into reading
// one fails to compile, and this file has nothing score-shaped to hand it even if one did.
//
// ── THREE STATES, AND ROW ABSENCE IS A FOURTH FACT ────────────────────────────────────────────────
//   fired          the rule checked and the pattern is TRUE
//   not_fired      the rule checked and the pattern is FALSE     ← written, not inferred
//   not_evaluable  the rule COULD NOT check, with a reason       ← written, not inferred
//   (no row)       this rule has not been run for this period
//
// A row is written for every rule that EVALUATED, not only for those that fired. "We checked
// ASHOKLEY's receivables and they are fine" and "we could not check them" are different statements,
// both renderable, and neither survives a fired-only table.
//
// ── STANDING STATE ────────────────────────────────────────────────────────────────────────────────
// Each row is compared against the PRIOR period's row for the same (stock, rule): newly_standing,
// continuing, resolved, not_standing. A finding that fired last period and does not fire now gets a
// RESOLVED ROW WRITTEN — resolution is never represented by row absence, because absence already
// means something else. N7's anti-double-count against a standing R1 is the first consumer.
//
// ── IDEMPOTENCE ───────────────────────────────────────────────────────────────────────────────────
// Upsert on (stock_id, rule_key, period_key). Reprocessing the same filing produces the same row.
// PRIOR PERIODS ARE NEVER TOUCHED — the pass writes only at the periods the current context resolves
// to, so re-running today cannot rewrite history it did not read.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { runFilingRules } from "../scoring/findings/engine.js";
import { FILING_REGISTRY, filingRulesForFeeds, type FilingRuleEntry, type FilingFeed } from "./registry.js";
import { loadFilingContext, type FilingSubject, type LoadedFilingContext } from "./context.js";
import type { ResolvedPeriod } from "./period.js";

type EvaluationState = "fired" | "not_fired" | "not_evaluable";
type StandingState = "newly_standing" | "continuing" | "resolved" | "not_standing";

/** One rule's resolved row, before it is written. */
export interface FilingFindingRow {
  ruleRef: string;
  ruleKey: string;
  kind: "red_flag" | "pattern";
  periodKey: string;
  periodEnd: Date;
  evaluationState: EvaluationState;
  standingState: StandingState | null;
  notEvaluableReason: string | null;
  severity: string | null;
  direction: string | null;
  magnitude: number | null;
  displayState: string;
  evidence: Prisma.InputJsonValue | undefined;
}

export interface FilingPassResult {
  stockId: string;
  symbol: string;
  industry: string;
  rows: FilingFindingRow[];
  /** Rules that could not be written because their GRAIN has no filing for this stock. A stock with
   *  no shareholding pattern has no shareholding quarter to key an R2 row on, and inventing one would
   *  be a fabricated statement about a quarter the company never filed. Counted, never silent. */
  skippedNoPeriod: { ruleRef: string; grain: string }[];
  periods: LoadedFilingContext["periods"];
  counts: LoadedFilingContext["counts"];
  written: number;
}

/**
 * ★ STANDING, FROM THE PRIOR ROW.
 *
 * The pairing is total and follows the schema's constraint table exactly:
 *   fired         -> newly_standing | continuing
 *   not_fired     -> resolved | not_standing
 *   not_evaluable -> null (we could not check, so we cannot claim standing either way)
 *
 * `priorFired` is read from the most recent row for this (stock, rule) at an EARLIER period_end. A
 * prior row that was itself not_evaluable counts as NOT standing for the transition — we never
 * established that it stood — and that prior row keeps its own honest state, so a reader following
 * the series can see the gap rather than inferring a transition we did not observe.
 */
export function resolveStanding(state: EvaluationState, priorFired: boolean): StandingState | null {
  if (state === "not_evaluable") return null;
  if (state === "fired") return priorFired ? "continuing" : "newly_standing";
  return priorFired ? "resolved" : "not_standing";
}

const periodFor = (periods: LoadedFilingContext["periods"], e: FilingRuleEntry): ResolvedPeriod | null => periods[e.grain];

/**
 * Evaluate the filing rules for one stock and build its rows. PURE past the context load — no writes,
 * so a caller can inspect the rows (the verification scripts do) before anything is persisted.
 */
export async function computeFilingPass(
  subject: FilingSubject,
  asOf: Date,
  cutoff?: Date,
  /**
   * ★ THE FEED SCOPE (step 6). Absent ⇒ every rule, which is what a backfill wants. Present ⇒ only the
   * rules those feeds drive, which is what an ingestion trigger wants: a shareholding upload has no
   * business rewriting a receivables verdict, and rewriting it would also reset that row's
   * `standingState` against a period nothing moved in.
   *
   * The context load is NOT narrowed to match. It is one indexed read per stock either way, and a
   * partial context would mean each rule subset saw a different `ctx` — the fastest route to two
   * passes disagreeing about the same stock on the same day.
   */
  feeds?: readonly FilingFeed[],
): Promise<FilingPassResult> {
  const loaded = await loadFilingContext(subject, asOf, cutoff);
  const registry = feeds ? filingRulesForFeeds(feeds) : FILING_REGISTRY;
  const outcomes = runFilingRules(loaded.ctx, registry.map((e) => e.rule));
  const byRef = new Map(outcomes.map((o) => [o.ruleRef, o]));

  const rows: FilingFindingRow[] = [];
  const skippedNoPeriod: { ruleRef: string; grain: string }[] = [];

  // ── PRIOR ROWS, ONE QUERY ─────────────────────────────────────────────────────────────────────
  // Every row this pass writes needs "did this rule fire at the previous period?". That is one
  // indexed read of the stock's whole history (the (stock_id, period_end DESC) index), reduced in
  // memory, rather than 22 point lookups.
  const priorRows = await prisma.stockFinding.findMany({
    where: { stockId: subject.stockId },
    orderBy: { periodEnd: "desc" },
    select: { ruleKey: true, periodKey: true, periodEnd: true, evaluationState: true },
  });

  for (const e of registry) {
    const outcome = byRef.get(e.ruleRef);
    if (!outcome) continue; // unreachable — runFilingRules returns one outcome per rule
    const period = periodFor(loaded.periods, e);
    if (!period) {
      skippedNoPeriod.push({ ruleRef: e.ruleRef, grain: e.grain });
      continue;
    }

    // The most recent row for this rule STRICTLY BEFORE this period. Rows are period_end DESC, so the
    // first match is the latest prior. A re-run at the SAME period must not read its own last write
    // as "the prior period" — that would flip newly_standing to continuing on every re-run and make
    // the pass non-idempotent, which is why the comparison is strict.
    const prior = priorRows.find((r) => r.ruleKey === e.ruleKey && r.periodEnd.getTime() < period.periodEnd.getTime());
    const standing = resolveStanding(outcome.state, prior?.evaluationState === "fired");

    const f = outcome.finding;
    rows.push({
      ruleRef: e.ruleRef,
      ruleKey: e.ruleKey,
      kind: e.kind,
      periodKey: period.periodKey,
      periodEnd: period.periodEnd,
      evaluationState: outcome.state,
      standingState: standing,
      notEvaluableReason: outcome.reason,
      // ★ SEVERITY IS STAMPED BY THE RULE AT EVALUATION TIME, never re-derived at read time. Null on
      //   a not_fired / not_evaluable row: a rule that did not fire has no severity, and a default
      //   would be a claim.
      severity: f?.severity ?? null,
      direction: f?.direction ?? null,
      magnitude: f?.magnitude ?? null,
      // ⚠ NO PG DAMPENING HERE, BY DESIGN. `applyPgDampening` halves a pattern's magnitude when it
      // fires on >80% of a peer group. A filing finding has no peer group to be prevalent within —
      // 355 of 504 stocks have none at all — so the magnitude persisted here is the rule's own.
      // Prevalence for filing patterns is a UNIVERSE-level question and belongs to base rates
      // (step 5), not to a pond the stock may not be in.
      displayState: f?.displayState ?? "active",
      evidence: (f?.evidence ?? undefined) as Prisma.InputJsonValue | undefined,
    });
  }

  return {
    stockId: subject.stockId,
    symbol: subject.symbol,
    industry: subject.industry,
    rows,
    skippedNoPeriod,
    periods: loaded.periods,
    counts: loaded.counts,
    written: 0,
  };
}

/**
 * Persist a computed pass. IDEMPOTENT: upsert on (stock_id, rule_key, period_key), so reprocessing
 * the same filing produces the same row and never a second one. Prior periods are untouched — this
 * writes only at the periods the current context resolved to.
 */
export async function persistFilingPass(result: FilingPassResult): Promise<number> {
  // One batched transaction per stock: 22 upserts in a single round-trip rather than 22 sequential
  // ones. Across the universe that is 504 batches instead of ~11,000 individual writes, and the
  // stock's row set lands atomically — a crash mid-stock cannot leave half its rules updated to this
  // period and half still on the last one.
  const ops = result.rows.map((r) => {
    const data = {
      symbol: result.symbol,
      ruleRef: r.ruleRef,
      periodEnd: r.periodEnd,
      evaluationState: r.evaluationState,
      standingState: r.standingState,
      notEvaluableReason: r.notEvaluableReason,
      kind: r.kind,
      severity: r.severity,
      direction: r.direction,
      magnitude: r.magnitude,
      displayState: r.displayState,
      evidence: r.evidence,
    };
    return prisma.stockFinding.upsert({
      where: { stockId_ruleKey_periodKey: { stockId: result.stockId, ruleKey: r.ruleKey, periodKey: r.periodKey } },
      create: { stockId: result.stockId, ruleKey: r.ruleKey, periodKey: r.periodKey, ...data },
      update: data,
    });
  });
  if (!ops.length) return 0;
  await prisma.$transaction(ops);
  return ops.length;
}

/**
 * Compute + persist for one stock. THE entry point the ingestion triggers call.
 *
 * `feeds` scopes the run to the rules that ingestion moved. Omit it for a full 22-rule recompute —
 * which is what {@link runFilingBackfill} does, and what THE STANDING LAW (rules/BACKFILL-LAW.md)
 * requires after any change to a rule's logic or constants.
 */
export async function runFilingPass(
  subject: FilingSubject,
  asOf: Date = new Date(),
  cutoff?: Date,
  feeds?: readonly FilingFeed[],
): Promise<FilingPassResult> {
  const result = await computeFilingPass(subject, asOf, cutoff, feeds);
  result.written = await persistFilingPass(result);
  return result;
}

export interface FilingBackfillResult {
  stocks: number;
  written: number;
  failed: { symbol: string; error: string }[];
  /** Rules that had no filing to key a row on, summed across the universe. */
  skippedNoPeriod: number;
  startedAt: Date;
  finishedAt: Date;
}

/**
 * ★ THE BACKFILL ENTRY POINT — every rule, every active stock. See rules/BACKFILL-LAW.md.
 *
 * This exists because filing-triggered recompute is CORRECT and INSUFFICIENT at the same time. A
 * stock computes when its filing lands and then holds that row until the next one, which for an
 * annual rule is up to eleven months. Change a threshold and the universe splits into rows computed
 * under the old constant and rows computed under the new one, with nothing on either row to say
 * which — and Phase 2 is entirely threshold work.
 *
 * `onProgress` is called per stock so a job handler can report without this module knowing about jobs.
 */
export async function runFilingBackfill(opts: {
  asOf?: Date;
  /** Restrict to these symbols. Omit for the whole active universe — the normal case. */
  symbols?: readonly string[];
  /** Scope to specific feeds' rules. Omit for all 22, which is what the law requires. */
  feeds?: readonly FilingFeed[];
  /**
   * ★ RULE REFS WHOSE EXISTING ROWS ARE DELETED BEFORE RECOMPUTING — the false-transition guard.
   *
   * A rule-logic FIX can move a row from not_fired to fired, and `resolveStanding` would then read
   * the old row as the prior state and stamp `newly_standing` — which the alert evaluator fires on
   * and every read surface renders as "new". If the finding was true all along and only the fix made
   * it visible, that announces a change at the company that never happened.
   *
   * Deleting the old rows makes the recomputed ones first observations, and step 4's conservative
   * rule ("a first observation is not a transition") then applies by itself.
   *
   * ⚠ ONLY FOR ROWS PRODUCED BY LOGIC NOW KNOWN TO BE WRONG. They are not a prior state of the same
   * measurement — they are a different measurement. A threshold you deliberately moved is NOT this
   * case: a stock crossing the new threshold genuinely is newly standing under the rule as it exists.
   */
  resetRules?: readonly string[];
  onProgress?: (done: number, total: number, symbol: string) => void | Promise<void>;
} = {}): Promise<FilingBackfillResult> {
  const startedAt = new Date();
  const asOf = opts.asOf ?? startedAt;
  const all = await filingUniverse();
  const subjects = opts.symbols?.length
    ? all.filter((s) => opts.symbols!.includes(s.symbol))
    : all;

  if (opts.resetRules?.length) {
    const refs = new Set(opts.resetRules.map((r) => r.toUpperCase()));
    const keys = FILING_REGISTRY.filter((e) => refs.has(e.ruleRef.toUpperCase())).map((e) => e.ruleKey);
    const unknown = [...refs].filter((r) => !FILING_REGISTRY.some((e) => e.ruleRef.toUpperCase() === r));
    if (unknown.length) throw new Error(`runFilingBackfill: unknown rule ref(s) [${unknown.join(", ")}] — expected one of ${FILING_REGISTRY.map((e) => e.ruleRef).join(", ")}`);
    const del = await prisma.stockFinding.deleteMany({
      where: { ruleKey: { in: keys }, ...(opts.symbols?.length ? { stockId: { in: subjects.map((s) => s.stockId) } } : {}) },
    });
    console.log(`[filing-backfill] --reset-rule ${[...refs].join(",")} → deleted ${del.count} row(s) before recompute`);
  }

  let written = 0, skippedNoPeriod = 0;
  const failed: { symbol: string; error: string }[] = [];
  for (let i = 0; i < subjects.length; i++) {
    const s = subjects[i];
    try {
      const r = await runFilingPass(s, asOf, undefined, opts.feeds);
      written += r.written;
      skippedNoPeriod += r.skippedNoPeriod.length;
    } catch (err) {
      // One stock's failure never stops the universe — a backfill that aborts halfway leaves exactly
      // the split state it was run to end.
      failed.push({ symbol: s.symbol, error: String(err) });
    }
    if (opts.onProgress) await opts.onProgress(i + 1, subjects.length, s.symbol);
  }
  return { stocks: subjects.length, written, failed, skippedNoPeriod, startedAt, finishedAt: new Date() };
}

/** Resolve a stock by symbol or id into the subject shape. Returns null for an unknown symbol. */
export async function filingSubject(symbolOrId: string): Promise<FilingSubject | null> {
  const s = await prisma.stock.findFirst({
    where: { OR: [{ symbol: symbolOrId }, { id: symbolOrId }] },
    select: { id: true, symbol: true, industryType: true },
  });
  return s ? { stockId: s.id, symbol: s.symbol, industry: s.industryType } : null;
}

/** Every ACTIVE stock, in symbol order — the filing pass's universe. No peer-group filter: that is
 *  the scoring pass's firewall and has nothing to do with what a company filed. */
export async function filingUniverse(): Promise<FilingSubject[]> {
  const rows = await prisma.stock.findMany({
    where: { isActive: true },
    orderBy: { symbol: "asc" },
    select: { id: true, symbol: true, industryType: true },
  });
  return rows.map((s) => ({ stockId: s.id, symbol: s.symbol, industry: s.industryType }));
}
