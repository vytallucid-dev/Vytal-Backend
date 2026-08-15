// ─────────────────────────────────────────────────────────────
// JOBS ROUTES
//
// Mount under /api/jobs. Protect with admin auth middleware before
// exposing publicly.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import {
  getJob,
  listJobsHandler,
  listActiveJobs,
  cancelJob,
} from "../controllers/jobs-controller.js";
import {
  listRunningJobs,
  getJobHistory,
  getLatestHealthCheck,
} from "../controllers/admin/job-monitor-controller.js";

export const jobsRouter = Router();

// ⚠ ORDER MATTERS AND IT IS A TRAP HERE. `/:id` is a catch-all for any single path
//   segment, so EVERY literal route must be declared above it or Express will hand
//   "running" / "history" / "health" to getJob as an id and 404 them. That is why the
//   monitor routes sit here rather than at the bottom next to the code that added them.
jobsRouter.get("/active", listActiveJobs);
jobsRouter.get("/running", listRunningJobs);
jobsRouter.get("/history", getJobHistory);
jobsRouter.get("/health", getLatestHealthCheck);

jobsRouter.get("/:id", getJob);
jobsRouter.post("/:id/cancel", cancelJob);
jobsRouter.get("/", listJobsHandler);
