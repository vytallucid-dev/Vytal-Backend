// ─────────────────────────────────────────────────────────────
// GET  /api/news/:symbol              — news feed for a stock
// GET  /api/news/feed/today           — high-impact news today
// POST /api/admin/news/trigger        — run daily ingest
// POST /api/admin/news/extract        — run extraction worker
// POST /api/admin/news/backfill       — historical backfill
// ─────────────────────────────────────────────────────────────

import { Router } from "express";

import {
  getNewsBySymbol,
  getNewsBySymbolAndId,
  getNewsFetchLogs,
  getTodayNewsFeed,
  triggerContentExtractionWorker,
  triggerDailyGoogleNewsIngest,
  triggerDailyNewsIngest,
  triggerDailyNseAnnouncementsIngest,
  triggerNewsBackfill,
} from "../../controllers/ingestion/news-controllers.js";

export const newsRouter = Router();
export const adminNewsRouter = Router();

// ── GET /api/news/ — fetch logs ────────────────────────────────

newsRouter.get("/news-logs", getNewsFetchLogs);

// ── GET /api/news/feed/today ──────────────────────────────────
// All high-impact news from last 24h across universe
// Must be registered BEFORE /:symbol to avoid being shadowed

newsRouter.get("/feed/today", getTodayNewsFeed);

// ── GET /api/news/:symbol ─────────────────────────────────────

newsRouter.get("/:symbol", getNewsBySymbol);

// ── GET /api/news/:symbol/:newsId ─────────────────────────────
// Single news item with full content (for AI summary page)

newsRouter.get("/:symbol/:newsId", getNewsBySymbolAndId);

// ── Admin routes ──────────────────────────────────────────────

adminNewsRouter.post("/trigger", triggerDailyNewsIngest);

adminNewsRouter.post("/trigger/nse", triggerDailyNseAnnouncementsIngest);

adminNewsRouter.post("/trigger/google", triggerDailyGoogleNewsIngest);

adminNewsRouter.post("/extract", triggerContentExtractionWorker);

adminNewsRouter.post("/backfill", triggerNewsBackfill);


