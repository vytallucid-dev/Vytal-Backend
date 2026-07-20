// ─────────────────────────────────────────────────────────────
// THE INSTRUMENT LANES — manual triggers for the three udiff BhavCopy pipelines that had none.
//
//   POST /api/v1/admin/reits/trigger            — reit_daily            (Step 14)
//   POST /api/v1/admin/govt-securities/trigger  — govt_securities_daily (Step 15)
//   POST /api/v1/admin/corporate-bonds/trigger  — corporate_bonds_daily (Step 17)
//
// WHY THIS FILE EXISTS AT ALL. All three shipped as CRON-ONLY. They were registered in
// pipelines-controller (so their last-run timestamp was readable) and each carried a comment
// promising it would "never become the mystery cron that Step 10 had to go back and fix" — but
// there was no manual trigger and no admin page, so an operator could not run one, could not watch
// one run, and could not reproduce a failure. That is a mystery cron with a paper trail.
//
// WHY THEY SHARE ONE FILE, when prices/indices/mf each have their own. Because they are genuinely
// ONE SHAPE: each reads the SAME NSE udiff BhavCopy, takes NO payload, and enqueues a single job.
// Three files would be three copies of nine lines, and the copies would drift. The pipelines are
// still SEPARATE JOBS with separate cards, separate retry policies and separate failure domains —
// that separation lives where it matters (the job registry), not in the routing layer.
//
// THE CONTRACT IS THE HOUSE CONTRACT, unchanged: enqueue → 202 { jobId, statusUrl } → the caller
// polls GET /api/v1/admin/jobs/:id until terminal. Identical to the MF/prices/deals triggers, so
// the frontend's job-and-poll machinery is the same machinery, not a lookalike.
// ─────────────────────────────────────────────────────────────
import type { Request, Response } from "express";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes, type JobType } from "../../jobs/types.js";

/** One enqueue, one 202, one status URL. The only thing that differs per lane is the job + the copy. */
async function enqueueLane(res: Response, type: JobType, message: string) {
  const job = await enqueueJob({ type, payload: {}, triggeredBy: "user:admin" });
  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message,
    },
  });
}

// ── POST /api/v1/admin/reits/trigger ─────────────────────────
export const triggerReitIngest = async (_req: Request, res: Response) =>
  enqueueLane(
    res,
    JobTypes.REIT_DAILY,
    "REIT/InvIT ingest enqueued (NSE udiff BhavCopy, series RR/IV — identity + close + distribution yield). Poll the status URL.",
  );

// ── POST /api/v1/admin/govt-securities/trigger ───────────────
export const triggerGovtSecuritiesIngest = async (_req: Request, res: Response) =>
  enqueueLane(
    res,
    JobTypes.GOVT_SECURITIES_DAILY,
    "Government securities ingest enqueued (series GS/TB/GB/SG — G-secs, T-bills, SDLs, Sovereign Gold Bonds). " +
      "Reads a 10-session look-back: government paper is thin, and one day is a sample, not the universe. Poll the status URL.",
  );

// ── POST /api/v1/admin/corporate-bonds/trigger ───────────────
export const triggerCorporateBondsIngest = async (_req: Request, res: Response) =>
  enqueueLane(
    res,
    JobTypes.CORPORATE_BONDS_DAILY,
    "Corporate bond ingest enqueued (NCDs, debentures, municipal green bonds). Fenced on the ISIN's own " +
      "security-type, NOT on the NSE series — a series is a trading board, not an instrument type. " +
      "Idempotent, and the catalogue ACCUMULATES: each run adds whatever new paper traded. Poll the status URL.",
  );
