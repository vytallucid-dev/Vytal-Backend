// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES — v3 results scan pipeline
//
// Mount under /api/v1/admin/results-scan.
//
// NOTE: Job list / single-job status / cancel are NOT included
// here — they already exist at /api/v1/admin/jobs. See:
//   src/routes/job-routes.ts          (route definitions)
//   src/controllers/jobs-controller.ts (handlers)
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import {
  enqueueUniverseScan,
  enqueueSymbolScan,
  runRefreshIndustryTypes,
  getResultFetchLogs,
  getStockCoverage,
} from "../../controllers/ingestion/results-scan-controller.js";

export const resultsScanRouter = Router();

// POST /api/v1/admin/results-scan/universe
// Enqueue a "results_scan" job with mode "universe" or "backfill".
resultsScanRouter.post("/universe", enqueueUniverseScan);

// POST /api/v1/admin/results-scan/symbol
// Enqueue a "results_scan" job with mode "symbol".
resultsScanRouter.post("/symbol", enqueueSymbolScan);

// POST /api/v1/admin/results-scan/refresh-industry-types
// Run refreshIndustryTypes() synchronously (fast DB-only call).
resultsScanRouter.post("/refresh-industry-types", runRefreshIndustryTypes);

// GET /api/v1/admin/results-scan/logs?symbol=&status=&limit=&hoursBack=
// Query result_fetch_log with filters.
resultsScanRouter.get("/logs", getResultFetchLogs);

// GET /api/v1/admin/results-scan/stocks/:symbol/coverage
// Row counts in the industry-appropriate fundamentals + quarterly tables.
resultsScanRouter.get("/stocks/:symbol/coverage", getStockCoverage);
