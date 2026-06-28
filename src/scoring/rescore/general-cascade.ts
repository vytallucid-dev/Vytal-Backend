// File: src/scoring/rescore/general-cascade.ts
//
// GENERAL forward-cascade self-heal for a back-dated NON-banking fundamentals /
// shareholding fill — the banking cascade's Option-1 live/PIT split lifted to be
// PG-TYPE-AGNOSTIC. When a raw field is corrected for a PAST period, rescore each
// of the stock's scored PG(s) for the range [editedPeriod .. current] in period
// order, each PIT-correct:
//   • HISTORICAL periods → PIT rescore (computePgScores with pointInTime →
//     Market frozen at quarter-end + the period's raw state read PIT). The SAME
//     mechanism backfill-history / the batch PIT rescore use. NO future leak.
//   • the CURRENT/LIVE period → LIVE rescore (no pointInTime): current Market +
//     newest data, NEVER rolled back. Rolling Market back to a past quarter-end
//     corrupts it (the KOTAK 63.75→42.30 lesson generalises to every PG) — so
//     the live period is never PIT'd. This is the Option-1 split.
// PEER-WIDE: a fundamentals edit shifts the L2 peer μ/σ for every metric it feeds
//   at each period, so each period rescores the WHOLE PG (computePgScores is
//   per-PG); skip-identical no-ops members/periods the edit didn't move.
//
// REUSE (not reimplementation): buildCascadePlan / computePgPeriod /
// persistPgPeriod / quarterEnd / pkOrdinal from banking-cascade.ts + computePgScores
// + ensureScaffold/finalizeRun. The ONLY banking-specifics dropped: BANK_PG_IDS
// filtering and the casaPeriodKey cutoff (CASA-specific; computePgPeriod already
// passes ONLY pointInTime, so non-banking PGs read their raw state PIT with no CASA
// concept). runBankingCascade is left UNTOUCHED — banking edits still route there.
//
// DIFFERENCE from banking: the deriveFromRow re-derive runs on the edited row
// BEFORE this cascade (in applyRawFieldEdit), so each PIT period reads the
// corrected raw + the re-derived ratios. And the edited period is mapped from the
// fundamentals row: a QUARTERLY row carries its FYxxQy key; an ANNUAL row maps to
// the earliest scored quarter whose quarter-end ≥ the annual's reportDate (the
// first quarter that reads that annual). Later quarters reading a NEWER annual
// rescore → skip-identical (idempotent).

import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import {
  computePgScores, ensureScaffold, finalizeRun, type PgRef, type Scaffold,
} from "../composite/score-pass.js";
import { pgRefsForSymbols } from "../composite/pg-registry.js";
import {
  buildCascadePlan, computePgPeriod, persistPgPeriod, quarterEnd, pkOrdinal,
  type CascadePlan, type CascadeStepResult,
} from "./banking-cascade.js";

class RollbackSignal extends Error {}

/** The fill's edited period, table-shape aware (set by reDeriveRow). */
export type FillEdit =
  | { kind: "annual"; reportDate: Date }
  | { kind: "quarter"; periodKey: string };

/** PG members (stockIds) for a PgRef. */
async function pgMemberIds(ref: PgRef): Promise<string[]> {
  const pg = await prisma.peerGroup.findFirst({
    where: { name: ref.pgName },
    include: { stocks: { select: { stockId: true } } },
  });
  return (pg?.stocks ?? []).map((s) => s.stockId);
}

/** Distinct SCORED quarterly periods across members, ascending. Last = current/live. */
async function scoredPeriods(memberIds: string[]): Promise<string[]> {
  if (!memberIds.length) return [];
  const rows = await prisma.scoreSnapshot.findMany({
    where: { stockId: { in: memberIds }, snapshotType: "quarterly" },
    select: { periodKey: true }, distinct: ["periodKey"],
  });
  return rows
    .map((r) => r.periodKey)
    .filter((pk) => /^FY\d{2}Q[1-4]$/.test(pk))
    .sort((a, b) => pkOrdinal(a) - pkOrdinal(b));
}

/**
 * Map the fill's edited period to a quarterly start key within this PG's scored
 * periods. Quarterly edit → its own key. Annual edit → the earliest scored quarter
 * whose quarter-end ≥ the annual's reportDate (the first quarter that reads it); if
 * none yet read it (annual newer than every scored quarter), the current period
 * (→ live-only). Returns null only when the PG has no scored periods.
 */
export function resolveEditedPeriod(edit: FillEdit, periods: string[]): string | null {
  if (!periods.length) return null;
  if (edit.kind === "quarter") return edit.periodKey;
  const firstReading = periods.find((pk) => quarterEnd(pk).getTime() >= edit.reportDate.getTime());
  return firstReading ?? periods[periods.length - 1];
}

export interface GeneralPgCascade {
  ref: PgRef;
  plan: CascadePlan;
  steps: CascadeStepResult[];
  superseded: number; created: number; skippedIdentical: number; noSnapshot: number;
}
export interface GeneralCascadeResult {
  symbol: string;
  runId: string | null;
  perPg: GeneralPgCascade[];
  superseded: number; created: number; skippedIdentical: number; noSnapshot: number;
}

/**
 * Run the general forward-cascade for a back-dated fill on (symbol, edit). Runs
 * across EVERY scored PG the symbol belongs to (peer-wide per period). REAL
 * (dryRun=false): one ScoringRun; each period committed in its own tx oldest→newest.
 * DRY (dryRun=true): each period persisted in a ROLLED-BACK tx (writes nothing) —
 * reads committed state, so it reflects an already-committed raw edit. Returns null
 * if the symbol is in no scored PG.
 */
export async function runGeneralCascade(
  symbol: string,
  edit: FillEdit,
  opts: { dryRun?: boolean; onProgress?: (pct: number, note: string) => void | Promise<void> } = {},
): Promise<GeneralCascadeResult | null> {
  const refs = await pgRefsForSymbols([symbol]);
  if (!refs.length) return null;
  const dry = !!opts.dryRun;
  const report = opts.onProgress ?? (() => {});

  // REAL: one scaffold (ScoringRun) reused across all PGs + periods.
  let scaffold: Scaffold | null = null;
  if (!dry) {
    scaffold = await prisma.$transaction(async (tx) =>
      ensureScaffold(tx as unknown as Prisma.TransactionClient, new Date(), { runType: "quarterly", triggerType: "post_ingest" }),
    );
  }

  const perPg: GeneralPgCascade[] = [];
  for (let pgi = 0; pgi < refs.length; pgi++) {
    const ref = refs[pgi];
    const memberIds = await pgMemberIds(ref);
    const periods = await scoredPeriods(memberIds);
    const editedPeriod = resolveEditedPeriod(edit, periods);
    if (!editedPeriod) continue;
    const plan = buildCascadePlan(ref, symbol, editedPeriod, periods);
    if (plan.kind === "noop") {
      perPg.push({ ref, plan, steps: [], superseded: 0, created: 0, skippedIdentical: 0, noSnapshot: 0 });
      continue;
    }

    const steps: CascadeStepResult[] = [];
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const pct = Math.round(((pgi + i / plan.steps.length) / refs.length) * 90) + 5;
      await report(pct, `${ref.pgId} ${step.periodKey} (${step.mode}) — pg ${pgi + 1}/${refs.length} step ${i + 1}/${plan.steps.length}`);
      const computed = await computePgPeriod(ref, step.periodKey, step.mode);
      let results: CascadeStepResult["results"] = [];
      if (dry) {
        try {
          await prisma.$transaction(async (tx) => {
            const sc = await ensureScaffold(tx as unknown as Prisma.TransactionClient, computed.asOf, { runType: "quarterly", triggerType: "post_ingest" });
            results = await persistPgPeriod(tx as unknown as Prisma.TransactionClient, computed, ref.pgId, sc);
            throw new RollbackSignal();
          }, { timeout: 180_000, maxWait: 30_000 });
        } catch (e) { if (!(e instanceof RollbackSignal)) throw e; }
      } else {
        results = await prisma.$transaction(async (tx) =>
          persistPgPeriod(tx as unknown as Prisma.TransactionClient, computed, ref.pgId, scaffold!), { timeout: 180_000, maxWait: 30_000 });
      }
      steps.push({ ...step, results });
    }

    const all = steps.flatMap((s) => s.results);
    perPg.push({
      ref, plan, steps,
      superseded: all.filter((r) => r.action === "created" && r.superseded).length,
      created: all.filter((r) => r.action === "created" && !r.superseded).length,
      skippedIdentical: all.filter((r) => r.action === "skipped_identical").length,
      noSnapshot: all.filter((r) => r.action === "unavailable_no_snapshot").length,
    });
  }

  if (!dry && scaffold) {
    const owned = await prisma.scoreSnapshot.count({ where: { runId: scaffold.runId } });
    await prisma.$transaction(async (tx) => finalizeRun(tx as unknown as Prisma.TransactionClient, scaffold!.runId, owned, new Date()));
  }

  const flat = perPg.flatMap((p) => p.steps).flatMap((s) => s.results);
  return {
    symbol, runId: scaffold?.runId ?? null, perPg,
    superseded: flat.filter((r) => r.action === "created" && r.superseded).length,
    created: flat.filter((r) => r.action === "created" && !r.superseded).length,
    skippedIdentical: flat.filter((r) => r.action === "skipped_identical").length,
    noSnapshot: flat.filter((r) => r.action === "unavailable_no_snapshot").length,
  };
}
