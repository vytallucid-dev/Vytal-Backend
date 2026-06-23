// File: src/routes/stock-health-route.ts
// ─────────────────────────────────────────────────────────────
// The /api/stocks read API (NOT /api/v1) — matches the frontend hook paths.
//
//   GET /api/stocks                   — lean scored-stock list (typeahead + landing)
//   GET /api/stocks/universe          — FULL universe list (scored + not-yet-scored)
//   GET /api/stocks/scan?tool=…       — ranked "most-interesting journey" per tool
//   GET /api/stocks/:symbol/health    — the per-stock HealthSnapshotView
//                                       ?window=<n> trailing quarters (default 12)
//   GET /api/stocks/:symbol/ownership — the per-stock OwnershipSeriesView
//   GET /api/stocks/:symbol/fundamentals — the per-stock FundamentalsView
//                                       (dispatch-by-industry-family; ?basis=consolidated|standalone)
//
// Static segments (`/`, `/universe`, `/scan`) are registered before the
// `/:symbol/health` param route so they resolve unambiguously.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { getStockHealth } from "../controllers/stock-health-controller.js";
import {
  getScoredStocks,
  getUniverseStocks,
  getStockScan,
  getStockOwnership,
  getStockFundamentals,
} from "../controllers/stocks-list-controller.js";

export const stocksRouter = Router();

stocksRouter.get("/", getScoredStocks);
stocksRouter.get("/universe", getUniverseStocks);
stocksRouter.get("/scan", getStockScan);
stocksRouter.get("/:symbol/health", getStockHealth);
stocksRouter.get("/:symbol/ownership", getStockOwnership);
stocksRouter.get("/:symbol/fundamentals", getStockFundamentals);
