// ─────────────────────────────────────────────────────────────────────────────
// BACKFILL-ON-FIRST-HOLD TRIGGER (Step 21) — enqueue a weekly-series backfill for a newly-held
// non-stock instrument, ONCE, off the request's critical path.
//
// Deduped two ways so a re-hold / a routine broker re-sync enqueues NOTHING: (1) if the instrument
// already has a stored series (the weekly cron keeps it current thereafter), (2) if a backfill for
// it is already pending/running. Best-effort — a failure here never fails the caller's write (same
// discipline as the post-commit PHS refresh).
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes, JobStatus, type InstrumentHistoryBackfillPayload } from "../../jobs/types.js";
import { hasSeries } from "./series-store.js";

/**
 * Enqueue a single-instrument backfill iff it is a NON-STOCK instrument with no series and no
 * in-flight backfill. Returns the new job id, or null when nothing was enqueued.
 *
 * A STOCK (stockId set) takes the daily-price path and is NOT charted from this store — skipped.
 */
export async function enqueueHistoryBackfillIfNeeded(
  instrumentId: string | null,
  stockId: string | null,
  triggeredBy: string,
): Promise<string | null> {
  if (!instrumentId || stockId) return null; // stocks use daily_prices; nothing to store here
  try {
    if (await hasSeries(prisma, instrumentId)) return null; // already backfilled → cron maintains it

    const inflight = await prisma.backgroundJob.findFirst({
      where: {
        type: JobTypes.INSTRUMENT_HISTORY_BACKFILL,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
        payload: { path: ["instrumentId"], equals: instrumentId },
      },
      select: { id: true },
    });
    if (inflight) return null;

    const job = await enqueueJob({
      type: JobTypes.INSTRUMENT_HISTORY_BACKFILL,
      payload: { instrumentId, mode: "single" } satisfies InstrumentHistoryBackfillPayload,
      triggeredBy,
      priority: 100,
    });
    return job.id;
  } catch (err) {
    console.warn(`[history-backfill] enqueue failed for instrument ${instrumentId}:`, err);
    return null; // best-effort — never break the write that triggered us
  }
}
