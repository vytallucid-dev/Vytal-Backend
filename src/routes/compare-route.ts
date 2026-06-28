// File: src/routes/compare-route.ts
// ─────────────────────────────────────────────────────────────
// The comparison read API (NOT /api/v1) — matches the frontend hook-path convention
// used by /api/stocks and /api/peer-groups.
//
//   GET /api/compare?a=SYMBOL1&b=SYMBOL2 — the stock-vs-stock ComparisonView
//
// A NEW assembly/alignment endpoint over the EXISTING per-stock read services
// (health, fundamentals, price, ownership). No new data tables. PG-vs-PG is a
// separate later engine — not mounted here.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { getComparison } from "../controllers/compare-controller.js";

export const compareRouter = Router();

compareRouter.get("/", getComparison);
