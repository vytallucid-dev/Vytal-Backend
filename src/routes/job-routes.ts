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

export const jobsRouter = Router();

// Order matters: more specific routes first
jobsRouter.get("/active", listActiveJobs);
jobsRouter.get("/:id", getJob);
jobsRouter.post("/:id/cancel", cancelJob);
jobsRouter.get("/", listJobsHandler);
