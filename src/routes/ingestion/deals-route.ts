// src/routes/deals.ts
// ─────────────────────────────────────────────────────────────
// GET  /api/deals/:symbol           — deals for a stock
// GET  /api/deals/logs              — fetch history / audit
// POST /api/admin/deals/trigger     — manual daily run (admin)
// POST /api/admin/deals/backfill    — backfill last N days (admin)
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import {
    getDealLogs,
    getDealsForSymbol,
    triggerBackfillIngest,
    triggerDailyIngest,
} from "../../controllers/ingestion/deals-controllers.js";

export const dealsRouter = Router();
export const adminDealsRouter = Router();

// ── GET /api/deals/deal-logs ──────────────────────────────────
// Must be registered before /:symbol to avoid route shadowing.

dealsRouter.get("/deal-logs", getDealLogs);

// ── GET /api/deals/:symbol ────────────────────────────────────
// Returns block/bulk deals for a stock, paginated, filterable.

dealsRouter.get("/:symbol", getDealsForSymbol);

// ── POST /api/admin/deals/trigger ─────────────────────────────
// Manually trigger the daily ingest (useful for testing or
// if the cron missed a day).

adminDealsRouter.post("/trigger", triggerDailyIngest);

// ── POST /api/admin/deals/backfill ────────────────────────────
// One-time backfill. Run once after deployment.
// Body: { days: 90 }

adminDealsRouter.post("/backfill", triggerBackfillIngest);
