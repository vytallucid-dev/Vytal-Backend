// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES — legacy backfill pipeline
//
// Mount under /api/v1/admin/legacy-backfill.
//
// Both endpoints enqueue a "legacy_backfill" job (manual trigger only —
// NOT on any cron schedule). v3 RESULTS_SCAN is the going-forward path.
//
// Job list / single-job status / cancel are NOT included here — they
// already exist at /api/v1/admin/jobs.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import {
  enqueueLegacyUniverseBackfill,
  enqueueLegacySymbolBackfill,
} from "../../controllers/ingestion/legacy-backfill-controller.js";

export const legacyBackfillRouter = Router();

// POST /api/v1/admin/legacy-backfill/universe
// Body: { fromDate?, toDate?, industries?, limit? }
legacyBackfillRouter.post("/universe", enqueueLegacyUniverseBackfill);

// POST /api/v1/admin/legacy-backfill/symbol
// Body: { symbol, fromDate?, toDate? }
legacyBackfillRouter.post("/symbol", enqueueLegacySymbolBackfill);
