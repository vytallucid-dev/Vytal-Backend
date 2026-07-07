// ─────────────────────────────────────────────────────────────────────────────
// PHS REFRESH — the MUTATION-side recompute triggers. Portfolio health moves for
// exactly two reasons: the book changed (a transaction write) or the constituent
// scores changed (the nightly rescore). Both call computeAndPersistPhs, which is
// idempotent + append-only (skip-write when the input fingerprint is unchanged) — so
// a refresh that finds nothing new writes nothing. A READ never calls these.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import { computeAndPersistPhs } from "./persist.js";

export interface PhsRefreshOutcome {
  users: number; // distinct users whose book intersects the changed symbols
  written: number; // computeAndPersistPhs calls that produced a fresh snapshot
  skipped: number; // idempotent no-ops (fingerprint unchanged)
  failed: number; // per-user failures (never thrown — best-effort)
}

/** Recompute + persist PHS for every user holding (open qty) at least one of `symbols`.
 *  Best-effort: a per-user failure is logged and skipped, never thrown. */
export async function refreshPhsForSymbols(symbols: string[]): Promise<PhsRefreshOutcome> {
  const distinct = [...new Set(symbols.filter((s) => typeof s === "string" && s.length > 0))];
  if (distinct.length === 0) return { users: 0, written: 0, skipped: 0, failed: 0 };

  const holders = await prisma.holding.findMany({
    where: { quantity: { gt: 0 }, stock: { symbol: { in: distinct } } },
    select: { userId: true },
    distinct: ["userId"],
  });

  let written = 0;
  let skipped = 0;
  let failed = 0;
  for (const { userId } of holders) {
    try {
      const out = await computeAndPersistPhs(userId);
      if (out.skipped) skipped++;
      else written++;
    } catch (e) {
      failed++;
      console.error(`[phs-refresh] user ${userId} recompute failed:`, (e as Error).message);
    }
  }
  return { users: holders.length, written, skipped, failed };
}

/** ONE-TIME DEPLOY BACKFILL (portfolio-spec 1.2 decoupling). Force-recompute + persist PHS
 *  for EVERY user with open holdings — bypassing the normal trigger gate (a transaction write
 *  or a per-member rescore only ever refreshes the users a change touched, so nothing would
 *  otherwise revisit a book that hasn't moved since before the deploy). On the 1.2 cutover the
 *  CONSTANT_VERSION bump changes every user's input fingerprint, so each call writes ONE fresh
 *  DECOUPLED row and the stale blended-1.1 row stops being the latest served. Idempotent + safe
 *  to re-run: a second pass finds each fingerprint unchanged and skips every user (0 written).
 *  Best-effort per user — a single failure is logged and skipped, never thrown. */
export async function backfillAllPhs(onProgress?: (done: number, total: number) => void): Promise<PhsRefreshOutcome> {
  const holders = await prisma.holding.findMany({
    where: { quantity: { gt: 0 } },
    select: { userId: true },
    distinct: ["userId"],
  });

  let written = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < holders.length; i++) {
    try {
      const out = await computeAndPersistPhs(holders[i].userId);
      if (out.skipped) skipped++;
      else written++;
    } catch (e) {
      failed++;
      console.error(`[phs-backfill] user ${holders[i].userId} recompute failed:`, (e as Error).message);
    }
    onProgress?.(i + 1, holders.length);
  }
  return { users: holders.length, written, skipped, failed };
}

/** Best-effort convenience for the transaction-write path: refresh ONE user's PHS.
 *  Never throws — a PHS failure must not fail the transaction that already committed. */
export async function refreshPhsForUser(userId: string): Promise<void> {
  try {
    await computeAndPersistPhs(userId);
  } catch (e) {
    console.error(`[phs-refresh] user ${userId} recompute failed (write still committed):`, (e as Error).message);
  }
}

// ── scoring-job → changed symbols ───────────────────────────────────────────────
/** Pull the symbols whose score ACTUALLY changed out of a completed scoring job's
 *  result. PG_RESCORE (the nightly path: EOD prices → all 13 PGs) and the cascades all
 *  return a `perMember` ledger with an `action` per symbol — created/superseded ⇒ the
 *  score moved. Anything else (skip-identical / no-snapshot) did not. Tolerant of
 *  shapes that only expose `changedSymbols`. Unknown shape ⇒ [] (no refresh). */
function changedScoredSymbols(result: unknown): string[] {
  if (result == null || typeof result !== "object") return [];
  const r = result as { perMember?: unknown; changedSymbols?: unknown };

  if (Array.isArray(r.perMember)) {
    return r.perMember
      .filter((m): m is { symbol: string; action: string } => {
        const mm = m as { symbol?: unknown; action?: unknown };
        return (
          typeof mm.symbol === "string" &&
          (mm.action === "created" || mm.action === "superseded")
        );
      })
      .map((m) => m.symbol);
  }
  if (Array.isArray(r.changedSymbols)) {
    return r.changedSymbols.filter((s): s is string => typeof s === "string");
  }
  return [];
}

const SCORING_JOB_TYPES = new Set(["pg_rescore", "pg_cascade_rescore", "fill_cascade_rescore"]);

/**
 * The NIGHTLY-RESCORE trigger: after a scoring job SUCCEEDS, recompute PHS for the users
 * whose holdings intersect the symbols whose score just changed. No-op for non-scoring
 * jobs and for rescores that wrote nothing (all skip-identical). Best-effort — the caller
 * runs it after the job is already marked SUCCEEDED, so a failure never changes the job.
 */
export async function maybeRefreshPortfolioHealthForScoringJob(
  jobType: string,
  result: unknown,
): Promise<PhsRefreshOutcome | null> {
  if (!SCORING_JOB_TYPES.has(jobType)) return null;
  const symbols = changedScoredSymbols(result);
  if (symbols.length === 0) return null;
  return refreshPhsForSymbols(symbols);
}
