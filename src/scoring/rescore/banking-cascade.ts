// File: src/scoring/rescore/banking-cascade.ts
//
// FORWARD-CASCADE self-heal for CASA edits. When CASA is written for a PAST quarter (a
// correction or a newly-added historical quarter), rescore the bank's PG for the range
// [editedPeriod .. currentPeriod] in period order — each PIT-correct:
//   • HISTORICAL periods (≤ the period before current) → PIT rescore: computePgScores with
//     pointInTime → the casaPeriodKey cutoff filters CASA to ≤ that period (Market frozen at
//     quarter-end). NO future CASA leaks into a past snapshot.
//   • the CURRENT/LIVE period → LIVE rescore (no cutoff): newest CASA overall + CURRENT
//     prices. A PIT rescore here would roll Market back to the quarter-end (corruption), so
//     the live period is never PIT'd — the Option-1 split, applied automatically.
// Later periods that used the edited quarter as a fallback RE-RESOLVE (self-heal); later
// periods with their OWN quarter's CASA are unaffected → skip-identical (cheap no-op).
//
// REUSE (not reimplementation): computePgScores + the casaPeriodKey cutoff (banking-load.ts)
// + persistMember — the SAME machinery the batch rescore (rescore-banking-pit.ts) uses. The
// cascade only adds the range/mode selection (which period, PIT vs live) scoped to ONE bank's
// PG, P-forward, write-triggered.
//
// CORRECTNESS — WHY PER-PG (not per-bank): CASA feeds an L2 peer cross-section. Bank B's CASA
// edit at period P shifts the PG's CASA peer μ/σ at P → every PG member's L2 CASA at P can
// move. So each period rescores the WHOLE PG (computePgScores is per-PG); skip-identical
// no-ops the members/periods that didn't actually change. Append-only (supersede); findings
// re-fire on changed heads. Banking-only (the bank's PG — PG5 or PG6).
//
// ORDER + COMMIT: periods rescore oldest→newest, each COMMITTED before the next computes, so
// a later period's trajectory/findings substrate reads the updated (head) prior snapshot.

import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import {
  computePgScores, ensureScaffold, finalizeRun, persistMember, requireFindingsEvaluated,
  type PgRef, type Scaffold, type MemberWriteResult, type PgComputed,
} from "../composite/score-pass.js";
import { pgRefsForSymbols } from "../composite/pg-registry.js";

type Db = Prisma.TransactionClient;

/** Rollback sentinel for dry-run persists (declared before use — class decls don't hoist). */
class RollbackSignal extends Error {}

const BANK_PG_IDS = new Set(["PG5", "PG6"]);

export function isPeriodKey(pk: string): boolean { return /^FY\d{2}Q[1-4]$/.test(pk); }

/** Monotonic ordinal for FYxxQy comparison (fy*4 + q). FY26Q4=107 > FY26Q3=106 > … */
export function pkOrdinal(pk: string): number {
  const m = /^FY(\d{2})Q([1-4])$/.exec(pk);
  if (!m) throw new Error(`pkOrdinal: bad periodKey ${pk}`);
  return Number(m[1]) * 4 + Number(m[2]);
}

/** Indian FYxxQy → quarter-end Date (UTC midnight). Same mapping as the batch rescore +
 *  backfill: FY26Q1→Jun-30-2025, Q2→Sep-30, Q3→Dec-31, Q4→Mar-31-2026. */
export function quarterEnd(periodKey: string): Date {
  const m = /^FY(\d{2})Q([1-4])$/.exec(periodKey);
  if (!m) throw new Error(`quarterEnd: bad periodKey ${periodKey}`);
  const fy = 2000 + Number(m[1]); const q = Number(m[2]);
  if (q === 1) return new Date(Date.UTC(fy - 1, 5, 30));
  if (q === 2) return new Date(Date.UTC(fy - 1, 8, 30));
  if (q === 3) return new Date(Date.UTC(fy - 1, 11, 31));
  return new Date(Date.UTC(fy, 2, 31));
}

/** Resolve the banking PG (PG5/PG6) for a symbol + its member stockIds. null if the symbol
 *  is not a member of a banking PG (so the caller can fall back to the default live trigger). */
export async function bankingPgForSymbol(symbol: string): Promise<{ ref: PgRef; memberIds: string[] } | null> {
  const refs = await pgRefsForSymbols([symbol]);
  const ref = refs.find((r) => BANK_PG_IDS.has(r.pgId));
  if (!ref) return null;
  const pg = await prisma.peerGroup.findFirst({ where: { name: ref.pgName }, include: { stocks: { select: { stockId: true } } } });
  return { ref, memberIds: (pg?.stocks ?? []).map((s) => s.stockId) };
}

/** The distinct SCORED quarterly periods across a set of stocks, ascending by ordinal.
 *  The last element is the CURRENT/live period. */
export async function scoredBankingPeriods(memberIds: string[]): Promise<string[]> {
  if (!memberIds.length) return [];
  const rows = await prisma.scoreSnapshot.findMany({
    where: { stockId: { in: memberIds }, snapshotType: "quarterly" },
    select: { periodKey: true }, distinct: ["periodKey"],
  });
  return rows.map((r) => r.periodKey).filter(isPeriodKey).sort((a, b) => pkOrdinal(a) - pkOrdinal(b));
}

export interface CascadeStepPlan { periodKey: string; mode: "pit" | "live" }
export interface CascadePlan {
  symbol: string; pgId: string; pgName: string; editedPeriod: string; currentPeriod: string | null;
  /** "cascade" = past edit, rescore [edited..current]; "current_live" = P≥current, live-only
   *  (no backward cascade); "noop" = symbol has no scored banking history. */
  kind: "cascade" | "current_live" | "noop";
  steps: CascadeStepPlan[];
}

/** PURE: build the cascade plan from the edited period + the PG's scored periods. The live
 *  period is the latest scored one; only it gets mode "live" (Option-1 split), all earlier
 *  periods in the range get "pit". */
export function buildCascadePlan(ref: PgRef, symbol: string, editedPeriod: string, scoredPeriods: string[]): CascadePlan {
  const base = { symbol, pgId: ref.pgId, pgName: ref.pgName, editedPeriod };
  if (!scoredPeriods.length) return { ...base, currentPeriod: null, kind: "noop", steps: [] };
  const current = scoredPeriods[scoredPeriods.length - 1];
  const co = pkOrdinal(current), eo = pkOrdinal(editedPeriod);
  if (eo >= co) {
    // P is the current period (or a not-yet-scored future quarter) → live rescore of the
    // current period only. Nothing later exists to re-resolve → no backward cascade.
    return { ...base, currentPeriod: current, kind: "current_live", steps: [{ periodKey: current, mode: "live" }] };
  }
  // Past edit → rescore each SCORED period in [edited .. current], oldest→newest.
  const range = scoredPeriods.filter((pk) => pkOrdinal(pk) >= eo && pkOrdinal(pk) <= co);
  const steps: CascadeStepPlan[] = range.map((pk) => ({ periodKey: pk, mode: pk === current ? "live" : "pit" }));
  return { ...base, currentPeriod: current, kind: "cascade", steps };
}

/** Compute ONE PG-period (PIT or live), reusing computePgScores + the casaPeriodKey cutoff.
 *  Reads the CURRENT committed DB state (so a later period sees earlier periods' committed
 *  heads when called in order). Asserts the emerged period matches the requested one. */
export async function computePgPeriod(ref: PgRef, periodKey: string, mode: "pit" | "live"): Promise<PgComputed> {
  // withGuardrail is passed on BOTH legs deliberately — the intent is uniform ("screen
  // whatever is current") and POLICY is enforced structurally, not by the caller:
  //   • live leg → screens, so a cascade-triggered current-period rescore is treated
  //     identically to a normal one (no split-brain where the same stock is screened
  //     or not depending on which job touched it).
  //   • pit leg  → REFUSED by the history block in computePgScores (a point-in-time
  //     pass never screens without an explicit screenHistory:true). History therefore
  //     stays uniformly unscreened even though this asks for screening.
  // Verified in Stage 2: PIT+withGuardrail ⇒ ran=false, reason "point-in-time pass".
  const computed = mode === "live"
    ? await computePgScores(ref, { withFindings: true, withGuardrail: true })
    : await computePgScores(ref, { withFindings: true, withGuardrail: true, pointInTime: { quarterEnd: quarterEnd(periodKey), expectPeriodKey: periodKey } });
  if (computed.periodKey !== periodKey) {
    throw new Error(`computePgPeriod: ${ref.pgId} expected periodKey ${periodKey}, computePgScores produced ${computed.periodKey}`);
  }
  return computed;
}

/** Persist all members of a computed PG-period (append-only supersede / skip-identical),
 *  findings on. Mirrors handlePgRescore / the batch persist loop. */
export async function persistPgPeriod(db: Db, computed: PgComputed, pgId: string, scaffold: Scaffold): Promise<MemberWriteResult[]> {
  const out: MemberWriteResult[] = [];
  // Narrowing gate: computePgPeriod always computes withFindings, and this asserts it rather than
  // trusting it. Shared by BOTH cascades (CASA/banking here, the general fill cascade via
  // general-cascade.ts), so one check covers two job types and every period-step they walk.
  for (const m of requireFindingsEvaluated(computed)) {
    if (m.composite.state !== "scored" || m.composite.composite == null || !m.own || !m.market) {
      out.push({ symbol: m.symbol, action: "unavailable_no_snapshot", version: 0, superseded: false, snapshotId: null, composite: m.composite.composite ?? null, band: null, marketState: "none", pillarIds: {}, guardrailEventsWritten: -1 });
      continue;
    }
    // guardrail: carried so the snapshot records WHY it is unscreened. A cascade PIT
    // leg is history-blocked (computePgScores refuses to screen a point-in-time pass),
    // so this stamps guardrail_screened=false — a positive "we ran and did not screen",
    // not NULL "we don't know". Nothing is written to score_guardrail_events (ran=false).
    out.push(await persistMember(db, m, scaffold, computed.asOf, computed.peerGroupId, pgId, computed.industry, computed.peerStats, { writeGuardrail: true, guardrail: computed.guardrail }));
  }
  return out;
}

export interface CascadeStepResult extends CascadeStepPlan { results: MemberWriteResult[] }
export interface CascadeRunResult {
  plan: CascadePlan;
  runId: string | null;
  steps: CascadeStepResult[];
  superseded: number; created: number; skippedIdentical: number; noSnapshot: number;
}

/**
 * Run the forward-cascade for a CASA edit on (symbol, editedPeriod).
 *   REAL (dryRun=false): ONE ScoringRun; each period committed in its own tx, oldest→newest
 *     (so the next period's trajectory/findings read the updated head). Append-only supersede.
 *   DRY  (dryRun=true): each period computed against committed state + persisted in a
 *     ROLLED-BACK tx (writes nothing). Per-period independent — cross-period trajectory is
 *     not simulated (CASA resolution, the load-bearing part, IS accurate as it reads the
 *     committed CASA rows).
 * Returns null if the symbol is not a banking-PG member (caller falls back to default trigger).
 */
export async function runBankingCascade(
  symbol: string, editedPeriod: string,
  opts: { dryRun?: boolean; onProgress?: (pct: number, note: string) => void | Promise<void> } = {},
): Promise<CascadeRunResult | null> {
  const resolved = await bankingPgForSymbol(symbol);
  if (!resolved) return null;
  const { ref, memberIds } = resolved;
  const scoredPeriods = await scoredBankingPeriods(memberIds);
  const plan = buildCascadePlan(ref, symbol, editedPeriod, scoredPeriods);
  const dry = !!opts.dryRun;
  const report = opts.onProgress ?? (() => {});

  const steps: CascadeStepResult[] = [];
  if (plan.kind === "noop") return { plan, runId: null, steps, superseded: 0, created: 0, skippedIdentical: 0, noSnapshot: 0 };

  // REAL: one scaffold (ScoringRun) up front, reused across the range.
  let scaffold: Scaffold | null = null;
  if (!dry) {
    scaffold = await prisma.$transaction(async (tx) => ensureScaffold(tx as any, new Date(), { runType: "quarterly", triggerType: "post_ingest" }));
  }

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    await report(Math.round((i / plan.steps.length) * 90) + 5, `rescoring ${ref.pgId} ${step.periodKey} (${step.mode}) — ${i + 1}/${plan.steps.length}`);
    const computed = await computePgPeriod(ref, step.periodKey, step.mode);
    let results: MemberWriteResult[] = [];
    if (dry) {
      try {
        await prisma.$transaction(async (tx) => {
          const sc = await ensureScaffold(tx as any, computed.asOf, { runType: "quarterly", triggerType: "post_ingest" });
          results = await persistPgPeriod(tx as any, computed, ref.pgId, sc);
          throw new RollbackSignal();
        }, { timeout: 180_000, maxWait: 30_000 });
      } catch (e) { if (!(e instanceof RollbackSignal)) throw e; }
    } else {
      results = await prisma.$transaction(async (tx) => persistPgPeriod(tx as any, computed, ref.pgId, scaffold!), { timeout: 180_000, maxWait: 30_000 });
    }
    steps.push({ ...step, results });
  }

  if (!dry && scaffold) {
    const owned = await prisma.scoreSnapshot.count({ where: { runId: scaffold.runId } });
    await prisma.$transaction(async (tx) => finalizeRun(tx as any, scaffold!.runId, owned, new Date()));
  }

  const all = steps.flatMap((s) => s.results);
  return {
    plan, runId: scaffold?.runId ?? null, steps,
    superseded: all.filter((r) => r.action === "created" && r.superseded).length,
    created: all.filter((r) => r.action === "created" && !r.superseded).length,
    skippedIdentical: all.filter((r) => r.action === "skipped_identical").length,
    noSnapshot: all.filter((r) => r.action === "unavailable_no_snapshot").length,
  };
}
