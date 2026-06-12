// src/routes/ingestion/prices-route.ts
// ─────────────────────────────────────────────────────────────
// GET  /api/v1/prices/price-logs         — EOD fetch history / audit
// GET  /api/v1/prices/:symbol            — daily OHLCV + snapshot
// POST /api/v1/admin/prices/trigger      — manual EOD run (admin)
// POST /api/v1/admin/prices/backfill     — historical backfill (admin)
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import {
  getDailyPricesForSymbol,
  getPriceFetchLogs,
  triggerEodIngest,
  triggerPriceBackfill,
} from "../../controllers/ingestion/prices-controllers.js";

export const pricesRouter = Router();
export const adminPricesRouter = Router();

// ── GET /api/v1/prices/price-logs ─────────────────────────────
// Must be before /:symbol to avoid route shadowing.

pricesRouter.get("/price-logs", getPriceFetchLogs);

// ── GET /api/v1/prices/:symbol ────────────────────────────────
// Daily OHLCV history + latest snapshot for a stock.
// Query: days, page, limit

pricesRouter.get("/:symbol", getDailyPricesForSymbol);

// ── POST /api/v1/admin/prices/trigger ─────────────────────────
// Trigger EOD ingest for today or a specific date.
// Body: { date?: "YYYY-MM-DD" }

adminPricesRouter.post("/trigger", triggerEodIngest);

// ── POST /api/v1/admin/prices/backfill ────────────────────────
// Kick off historical backfill. Responds immediately; runs async.
// Body: { days: 365 }

adminPricesRouter.post("/backfill", triggerPriceBackfill);
