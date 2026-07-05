// ─────────────────────────────────────────────────────────────
// PIPELINES ROUTES
//
// Mount under /api/v1/admin/pipelines behind requireAdmin. Read-only
// operational summary powering the Admin Panel's per-card "last run".
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { getPipelineStatus } from "../controllers/pipelines-controller.js";

export const pipelinesRouter = Router();

pipelinesRouter.get("/", getPipelineStatus);
