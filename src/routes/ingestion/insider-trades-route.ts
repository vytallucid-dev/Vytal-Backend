// src/routes/ingestion/insider-trades-route.ts
// ─────────────────────────────────────────────────────────────
// GET  /api/v1/insider-trades/trade-logs     — fetch history / audit
// GET  /api/v1/insider-trades/:symbol        — trades for a stock
// POST /api/v1/admin/insider-trades/trigger  — manual daily run (admin)
// POST /api/v1/admin/insider-trades/backfill — backfill last N months (admin)
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import {
  getInsiderTradeLogs,
  getInsiderTradesForSymbol,
  triggerBackfillIngest,
  triggerDailyIngest,
} from "../../controllers/ingestion/insider-trades-controllers.js";

export const insiderTradesRouter = Router();
export const adminInsiderTradesRouter = Router();

// ── GET /api/v1/insider-trades/insider-trade-logs ─────────────────────
// Must be registered before /:symbol to avoid route shadowing.

insiderTradesRouter.get("/insider-trade-logs", getInsiderTradeLogs);

// ── GET /api/v1/insider-trades/:symbol ────────────────────────
// Returns SEBI PIT insider trades for a stock, paginated,
// filterable by personCategory, transactionType, and days.

insiderTradesRouter.get("/:symbol", getInsiderTradesForSymbol);

// ── POST /api/v1/admin/insider-trades/trigger ─────────────────
// Manually trigger the daily ingest (T and T-1 disclosures).

adminInsiderTradesRouter.post("/trigger", triggerDailyIngest);

// ── POST /api/v1/admin/insider-trades/backfill ────────────────
// Historical backfill. Runs async — returns 202 immediately.
// Body: { months: 12 }

adminInsiderTradesRouter.post("/backfill", triggerBackfillIngest);
