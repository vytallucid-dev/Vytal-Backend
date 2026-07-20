// ─────────────────────────────────────────────────────────────────────────────
// PART B — PHS-COMPUTE ERROR GUARD (source="scoring", guardType "scoring_phs_failed").
//
// Surfaces a THROWN portfolio-health compute — computeAndPersistPhs raised — into the
// shared ingestion_errors table so it appears on the "Score Compute" tab. Rides the same
// table/lifecycle/dedup as the other scoring classes, but keyed on the USER and targeting
// "portfolio_health" (the book-level composite), not a single ScoreSnapshot.
//
// ⚠ THE ONE HONESTY RULE: ONLY A CAUGHT EXCEPTION LANDS HERE.
//   `surfacePhsComputeFailure` is called ONLY from the …Tracked wrapper's catch block, i.e.
//   only when computeAndPersistPhs actually THREW (case 1). A correct-null book (no scored
//   holdings — `evaluable:false`, `phs:null`) and a low-coverage book are valid RETURNS
//   (case 2), and a holiday / no-attempt day never calls the compute at all (case 3). None
//   reach this function. It keys on the caught error, NEVER on `phs == null` — wiring
//   "null → error" would flood the tab with correctly-uncoverable books and drown the real
//   crashes. This is the discipline the Faults/Auto-admitted split exists to protect.
//
// SELF-CLEARING via ONE resolver: `resolveHealedPhsComputeErrors` runs on EVERY successful
// compute (the wrapper's success branch, and after the Recompute action's compute). The
// Recompute button only TRIGGERS a compute; it does not itself resolve — a button that
// self-resolved could disagree with a recompute that then threw again.
//
// BEST-EFFORT, never throws (a detection write must never break the compute path, which has
// already caught + re-thrown the real error).
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import type { GuardType, IngestionSeverity, ResolutionPath } from "../../generated/prisma/client.js";

/** The guardType for a thrown PHS compute. Named once so no caller can typo it. */
export const PHS_COMPUTE_GUARD: GuardType = "scoring_phs_failed";
/** Synthetic cron — the scoring-class trick, so this can never collide with an ingestion or
 *  a stock/PG scoring row on the (cron, guardType, targetField, targetEntity, status) index. */
export const PHS_COMPUTE_CRON = "scoring:phs_compute";
/** The user's CORE score is stale/blank until it recomputes ⇒ HIGH. */
const PHS_COMPUTE_SEVERITY: IngestionSeverity = "high";
/** Reuse the existing `rescore` path value; the FE gates the Recompute button on guardType. */
const PHS_COMPUTE_RESOLUTION: ResolutionPath = "rescore";
/** The output "table" a PHS-compute error concerns — the book-level composite, keyed on user. */
const PHS_COMPUTE_TARGET_TABLE = "portfolio_health";

const shortUser = (userId: string): string => userId.slice(0, 8);

/**
 * Surface a THROWN computeAndPersistPhs for one user. Dedup-or-create ONE open row per user
 * (targetEntity=userId, targetField=null) on the shared dedup index; a re-trip bumps
 * `occurrences` and refreshes the evidence. Returns the IngestionError id, or null on any
 * error (never throws).
 */
export async function surfacePhsComputeFailure(userId: string, err: unknown): Promise<string | null> {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const observed = `computeAndPersistPhs threw: ${message}`;
    const detail =
      `The portfolio Health Score for user ${shortUser(userId)} FAILED TO COMPUTE — a caught exception, ` +
      `NOT a null/low-coverage result. The book's PHS is stale or blank until the next successful ` +
      `compute. Recompute re-attempts now; the row also self-resolves on the next successful compute ` +
      `(the EOD rescore or a book change).`;

    // Dedup: is the same failure already open? Same key shape as the other scoring writers.
    const existing = await prisma.ingestionError.findFirst({
      where: {
        status: "open",
        cron: PHS_COMPUTE_CRON,
        guardType: PHS_COMPUTE_GUARD,
        targetField: null,
        targetEntity: userId,
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.ingestionError.update({
        where: { id: existing.id },
        data: { occurrences: { increment: 1 }, lastSeenAt: new Date(), observed, detail },
      });
      return existing.id;
    }

    const created = await prisma.ingestionError.create({
      data: {
        source: "scoring",
        cron: PHS_COMPUTE_CRON,
        guardType: PHS_COMPUTE_GUARD,
        targetTable: PHS_COMPUTE_TARGET_TABLE,
        targetField: null,
        targetEntity: userId,
        severity: PHS_COMPUTE_SEVERITY,
        resolutionPath: PHS_COMPUTE_RESOLUTION,
        failureType: "phs_compute",
        recomputeAction: "recompute",
        expected: "a computed PHS",
        observed,
        detail,
        // status defaults to "open"; occurrences defaults to 1.
      },
      select: { id: true },
    });
    return created.id;
  } catch (e) {
    console.error(`[phs-compute-guard] surfacePhsComputeFailure failed for user ${userId}:`, e);
    return null;
  }
}

/**
 * THE ONE HEAL PATH (self-clearing). Close any OPEN scoring_phs_failed row for this user.
 * Called on EVERY successful compute — idempotent (no open row → count 0 → no-op). This is
 * the SOLE resolver; the Recompute action only triggers a compute. BEST-EFFORT, never throws.
 * Returns the number of rows resolved.
 */
export async function resolveHealedPhsComputeErrors(userId: string): Promise<number> {
  try {
    const { count } = await prisma.ingestionError.updateMany({
      where: {
        source: "scoring",
        guardType: PHS_COMPUTE_GUARD,
        status: "open",
        targetEntity: userId,
      },
      data: {
        status: "resolved",
        resolvedBy: "auto:phs-heal",
        resolvedAt: new Date(),
        resolutionNote: "healed by a successful PHS compute",
      },
    });
    if (count > 0) {
      console.log(`[phs-compute-guard] auto-resolved ${count} PHS-compute error(s) for user ${shortUser(userId)}`);
    }
    return count;
  } catch (e) {
    console.error(`[phs-compute-guard] resolveHealedPhsComputeErrors failed for user ${userId}:`, e);
    return 0;
  }
}
