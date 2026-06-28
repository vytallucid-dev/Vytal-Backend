// File: src/routes/results-route.ts
// ─────────────────────────────────────────────────────────────
// GET /api/v1/results — cross-stock earnings feed (reported + upcoming).
// Read API for the Results landing. Public, no auth.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { getResultsList } from "../controllers/results-list-controller.js";
import { getResultDetail } from "../controllers/result-detail-controller.js";

export const resultsRouter = Router();

// Static "/" (the cross-stock feed) before the "/:symbol" param route (per-result viewer).
resultsRouter.get("/", getResultsList);
resultsRouter.get("/:symbol", getResultDetail);
