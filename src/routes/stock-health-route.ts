// File: src/routes/stock-health-route.ts
// ─────────────────────────────────────────────────────────────
// The /api/stocks read API (NOT /api/v1) — matches the frontend hook paths.
//
//   GET /api/stocks                   — lean scored-stock list (typeahead + landing)
//   GET /api/stocks/scan?tool=…       — ranked "most-interesting journey" per tool
//   GET /api/stocks/:symbol/health    — the per-stock HealthSnapshotView
//                                       ?window=<n> trailing quarters (default 12)
//
// Static segments (`/`, `/scan`) are registered before the `/:symbol/health`
// param route so they resolve unambiguously.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { getStockHealth } from "../controllers/stock-health-controller.js";
import {
  getScoredStocks,
  getStockScan,
  getStockOwnership,
} from "../controllers/stocks-list-controller.js";

export const stocksRouter = Router();

stocksRouter.get("/", getScoredStocks);
stocksRouter.get("/scan", getStockScan);
stocksRouter.get("/:symbol/health", getStockHealth);
stocksRouter.get("/:symbol/ownership", getStockOwnership);
