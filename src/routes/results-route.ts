// File: src/routes/results-route.ts
// ─────────────────────────────────────────────────────────────
// GET /api/v1/results          — cross-stock earnings feed, one scroll page at a time.
// GET /api/v1/results/overview — whole-feed stats for the landing header.
// GET /api/v1/results/:symbol  — the per-result viewer.
// Read API for the Results landing. Public, no auth.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { getResultsList, getResultsOverview } from "../controllers/results-list-controller.js";
import { getResultDetail } from "../controllers/result-detail-controller.js";

export const resultsRouter = Router();

// Both static routes MUST come before the "/:symbol" param route — it would otherwise
// swallow "/overview" and try to resolve it as a ticker.
resultsRouter.get("/", getResultsList);
resultsRouter.get("/overview", getResultsOverview);
resultsRouter.get("/:symbol", getResultDetail);
