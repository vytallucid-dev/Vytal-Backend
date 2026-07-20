// ─────────────────────────────────────────────────────────────────────────────
// PHS REFRESH — the MUTATION-side recompute triggers. Portfolio health moves for
// exactly two reasons: the book changed (a transaction write) or the constituent
// scores changed (the nightly rescore). Both call computeAndPersistPhs, which is
// idempotent + append-only (skip-write when the input fingerprint is unchanged) — so
// a refresh that finds nothing new writes nothing. A READ never calls these.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import { computeAndPersistPhs, type PersistOutcome } from "./persist.js";
import { recordScoreHistory } from "./score-history.js";
import { surfacePhsComputeFailure, resolveHealedPhsComputeErrors } from "../../scoring/errors/phs-compute-guard.js";

/**
 * THE ONE WRAP POINT (GATE 0.1). Runs the load-bearing compute UNTOUCHED, then attaches the
 * two decoupled side-effects the score itself must never carry:
 *   · SUCCESS → best-effort daily history upsert (Part A) + heal any open PHS-compute error
 *     for this user (Part B — the ONE self-clearing resolver). Both are best-effort and
 *     NEVER throw, so neither can fail the score that already returned.
 *   · THROW   → surface a PHS-compute error row (Part B, keyed on the CAUGHT exception —
 *     never on `phs == null`), then RE-THROW so every caller's existing best-effort
 *     accounting (failed++ / "write still committed") is byte-identical.
 *
 * The raw `computeAndPersistPhs` and its snapshot write are unchanged (§13-safe): this only
 * adds sibling side-writes around it. Production PHS recompute paths call THIS; scripts that
 * assert on snapshot rows keep calling the raw function directly.
 */
export async function computeAndPersistPhsTracked(userId: string): Promise<PersistOutcome> {
  let outcome: PersistOutcome;
  try {
    outcome = await computeAndPersistPhs(userId);
  } catch (e) {
    // Case (1) THREW — the ONLY real error. A correct-null / low-coverage book never lands
    // here (it RETURNS below); this branch keys on the exception, not on a null score.
    await surfacePhsComputeFailure(userId, e);
    throw e; // preserve callers' failed++ / best-effort-never-throws semantics exactly
  }
  // A real return (INCLUDING a correct-null / low-coverage book). Both side-effects best-effort.
  await recordScoreHistory(userId, outcome);
  await resolveHealedPhsComputeErrors(userId);
  return outcome;
}

export interface PhsRefreshOutcome {
  users: number; // distinct users whose book intersects the changed symbols
  written: number; // computeAndPersistPhs calls that produced a fresh snapshot
  skipped: number; // idempotent no-ops (fingerprint unchanged)
  failed: number; // per-user failures (never thrown — best-effort)
}

/** Recompute + persist PHS for every user holding (open qty) at least one of `symbols`.
 *  Best-effort: a per-user failure is logged and skipped, never thrown. */
export async function refreshPhsForSymbols(
  symbols: string[],
): Promise<PhsRefreshOutcome> {
  const distinct = [
    ...new Set(symbols.filter((s) => typeof s === "string" && s.length > 0)),
  ];
  if (distinct.length === 0)
    return { users: 0, written: 0, skipped: 0, failed: 0 };

  // A user "holds" a symbol if it appears ANYWHERE in their union (Step 3): a manual holding OR
  // a broker-mirrored one. Scanning only the manual table would leave a broker-only holder's PHS
  // stale after that stock rescored — their book contains it, so their health must recompute.
  const [manualHolders, brokerHolders] = await Promise.all([
    prisma.holding.findMany({
      // Through the catalog (Step 1.5). Matching on the instrument's STOCK symbol (not the
      // instrument's own symbol) keeps this exactly equity-scoped — a future non-equity
      // instrument sharing a ticker can never pull a user into an equity rescore.
      where: {
        quantity: { gt: 0 },
        instrument: { stock: { symbol: { in: distinct } } },
      },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.brokerHolding.findMany({
      // NO `enabled` FILTER (Step 4). A SEVERED connection's holdings are FROZEN, not gone — they
      // are still in the union and still carry PHS weight, so their owner must still be rescored
      // when one of those stocks moves. Excluding them here (as this did until Step 4) would have
      // frozen the OWNER's health too: they hold the stock, the stock's score changed, and their
      // portfolio health would have silently kept quoting the old number.
      // Keyed on the instrument's STOCK symbol, not broker_holdings.symbol (raw broker text,
      // possibly unmapped).
      where: { instrument: { stock: { symbol: { in: distinct } } } },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);
  const holders = [
    ...new Set([...manualHolders, ...brokerHolders].map((h) => h.userId)),
  ].map((userId) => ({ userId }));

  let written = 0;
  let skipped = 0;
  let failed = 0;
  for (const { userId } of holders) {
    try {
      const out = await computeAndPersistPhsTracked(userId);
      if (out.skipped) skipped++;
      else written++;
    } catch (e) {
      failed++;
      console.error(
        `[phs-refresh] user ${userId} recompute failed:`,
        (e as Error).message,
      );
    }
  }
  return { users: holders.length, written, skipped, failed };
}

/** (Construction v2 Stage 7 — §12) THE CATALOGUE TRIGGER — a newly-CATALOGUED stock can change a held
 *  BOND's sector, and therefore that book's C3/C4 and its displayed Construction.
 *
 *  WHY THIS EXISTS SEPARATELY FROM `refreshPhsForSymbols`. That function reaches a user through
 *  `instrument.stock.symbol IN (…)` — it can only ever find holders of an instrument that HAS a `stock`
 *  relation. A bond does not: 0 of 356 catalogued bonds carry a `stock_id`, because the bond→issuer link
 *  is not a foreign key at all. It is a 7-char ISIN-STEM match performed at ASSEMBLE time (INE733E01010
 *  and INE733E07AB1 are the same issuer). So a user holding ONLY the NTPC bond is STRUCTURALLY
 *  unreachable by the symbol trigger — no symbol of theirs ever appears in the changed set. Their sector
 *  resolution would change and their book would never recompute: silently, until they happened to
 *  transact. Nothing would look wrong. That is the same shape of bug as a served 55.01 against an engine
 *  32.38, and undiagnosable for the same reason.
 *
 *  CATALOGUED, NOT SCORED. §12's wording says "a newly-SCORED stock", which predates Stage 4's ruling: a
 *  bond inherits its issuer's sector from any CATALOGUED stock, because a sector is a company fact, not a
 *  scoring artifact (`cv2-s4-bond-sector-catalogued` — 191 catalogued issuers resolve vs 8 scored ones).
 *  Keying this on scoring would miss 96% of the resolutions it exists to catch. The trigger is CATALOGUING.
 *
 *  The stem match mirrors `assemblePortfolio`'s exactly (`isin.slice(0, 7)`); if one changes, both must.
 *  Broker holdings are included WITHOUT an `enabled` filter, for the same reason `refreshPhsForSymbols`
 *  omits it: a severed connection's holdings are FROZEN, not gone — they still carry Construction weight. */
export async function refreshPhsForCataloguedIsins(
  isins: string[],
): Promise<PhsRefreshOutcome> {
  const stems = [
    ...new Set(
      isins
        .filter((i): i is string => typeof i === "string" && i.length >= 7)
        .map((i) => i.slice(0, 7)),
    ),
  ];
  if (stems.length === 0)
    return { users: 0, written: 0, skipped: 0, failed: 0 };
  const stemMatch = {
    assetClass: "bond" as const,
    OR: stems.map((s) => ({ isin: { startsWith: s } })),
  };

  const [manualHolders, brokerHolders] = await Promise.all([
    prisma.holding.findMany({
      where: { quantity: { gt: 0 }, instrument: stemMatch },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.brokerHolding.findMany({
      where: { instrument: stemMatch }, // instrumentId is nullable — the relation filter excludes unmapped rows
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);
  const holders = [
    ...new Set([...manualHolders, ...brokerHolders].map((h) => h.userId)),
  ];

  let written = 0,
    skipped = 0,
    failed = 0;
  for (const userId of holders) {
    try {
      const out = await computeAndPersistPhsTracked(userId);
      if (out.skipped) skipped++;
      else written++;
    } catch (e) {
      failed++;
      console.error(
        `[phs-refresh] user ${userId} catalogue-recompute failed:`,
        (e as Error).message,
      );
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
export async function backfillAllPhs(
  onProgress?: (done: number, total: number) => void,
): Promise<PhsRefreshOutcome> {
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
      const out = await computeAndPersistPhsTracked(holders[i].userId);
      if (out.skipped) skipped++;
      else written++;
    } catch (e) {
      failed++;
      console.error(
        `[phs-backfill] user ${holders[i].userId} recompute failed:`,
        (e as Error).message,
      );
    }
    onProgress?.(i + 1, holders.length);
  }
  return { users: holders.length, written, skipped, failed };
}

/** Best-effort convenience for the transaction-write path: refresh ONE user's PHS.
 *  Never throws — a PHS failure must not fail the transaction that already committed. */
export async function refreshPhsForUser(userId: string): Promise<void> {
  try {
    await computeAndPersistPhsTracked(userId);
  } catch (e) {
    console.error(
      `[phs-refresh] user ${userId} recompute failed (write still committed):`,
      (e as Error).message,
    );
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

const SCORING_JOB_TYPES = new Set([
  "pg_rescore",
  "pg_cascade_rescore",
  "fill_cascade_rescore",
]);

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
