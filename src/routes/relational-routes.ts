// ─────────────────────────────────────────────────────────────
// /api/v1/relational — the reader-relative Overview card (Relational L4).
//
//   GET /api/v1/relational/stock/:stockId   resolve the card for one stock and one reader.
//
// Mounted behind `optionalAuth` in app.ts — NOT under /api/v1/me/* (anonymous is a valid caller) and NOT
// under /api/stocks/* (that namespace is public + cacheable by symbol; this response is per-reader and
// must never be cached stock-side). Its own top-level mount because it is its own read surface.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { getRelationalStock } from "../controllers/relational-controller.js";

export const relationalRouter = Router();

relationalRouter.get("/stock/:stockId", getRelationalStock);
