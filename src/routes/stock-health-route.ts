// File: src/routes/stock-health-route.ts
// ─────────────────────────────────────────────────────────────
// GET /api/stocks/:symbol/health  — the per-stock HealthSnapshotView.
//   ?window=<n>  trailing quarters for the trajectory series (default 12).
//
// Mounted at /api/stocks (NOT /api/v1) to match the frontend hook path
// `/api/stocks/:symbol/health` (lib/api/hooks/use-stock-health.ts).
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { getStockHealth } from "../controllers/stock-health-controller.js";

export const stocksRouter = Router();

stocksRouter.get("/:symbol/health", getStockHealth);
