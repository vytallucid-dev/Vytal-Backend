// ─────────────────────────────────────────────────────────────
// GET  /api/shareholding/:symbol         — pattern history
// GET  /api/shareholding/:symbol/latest  — most recent quarter
// POST /api/admin/shareholding/trigger   — run quarterly job now
// POST /api/admin/shareholding/backfill  — full historical backfill
// POST /api/admin/shareholding/:symbol   — single stock manual run
// ─────────────────────────────────────────────────────────────

import { Router } from "express";

import {
  backfillShareholding,
  getLatestShareHoldingForStock,
  getShareHoldingForStock,
  getShareholdingLogs,
  triggerManualShareholdingIngestForStock,
  triggerQuarterlyShareholdingIngest,
  triggerSmartShareholdingRefresh,
} from "../../controllers/ingestion/shareholding-controllers.js";

export const shareholdingRouter = Router();
export const adminShareholdingRouter = Router();


// ── GET /api/shareholding/ — fetch logs ───────────────────────

shareholdingRouter.get("/shareholding-logs", getShareholdingLogs);

// ── GET /api/shareholding/:symbol ────────────────────────────
// Returns shareholding history for a stock (most recent first)

shareholdingRouter.get("/:symbol", getShareHoldingForStock);


// ── GET /api/shareholding/:symbol/latest ─────────────────────

shareholdingRouter.get("/:symbol/latest", getLatestShareHoldingForStock);

// ── POST /api/admin/shareholding/trigger ──────────────────────
// Run quarterly job for ALL stocks now

adminShareholdingRouter.post("/trigger", triggerQuarterlyShareholdingIngest);

// ── POST /api/admin/shareholding/smart-refresh ────────────────
// Only fetch stocks whose earnings event was 7–21 days ago

adminShareholdingRouter.post("/smart-refresh", triggerSmartShareholdingRefresh);

// ── POST /api/admin/shareholding/backfill ─────────────────────
// Full historical backfill — run once on setup

adminShareholdingRouter.post("/backfill", backfillShareholding);

// ── POST /api/admin/shareholding/:symbol ──────────────────────
// Manual run for a single stock

adminShareholdingRouter.post(
  "/:symbol",
  triggerManualShareholdingIngestForStock,
);
