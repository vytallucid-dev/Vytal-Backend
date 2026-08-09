// ─────────────────────────────────────────────────────────────
// GET  /api/news/:symbol              — news feed for a stock
// GET  /api/news/feed/today           — high-impact news today
// POST /api/admin/news/trigger        — run daily ingest
// POST /api/admin/news/extract        — run extraction worker
// POST /api/admin/news/backfill       — historical backfill
//
// ── ⚠ GET /api/news/:symbol/:newsId IS GONE (removed 2026-08-09) ────────────
// It threw PrismaClientValidationError on every call — its handler `include`d an
// `aiSummaries` relation that stopped existing when ai_summaries was dropped, so the
// route had been a guaranteed 500 ever since. It had no caller in either repo.
//
// ★ WHY THE BUILD NEVER CAUGHT IT, because the same trap is still open elsewhere:
// Prisma's `SelectSubset<T, U>` maps only the TOP-LEVEL arg keys (`where`, `include`,
// `select`) against the args type. `include`'s VALUE is passed through as inferred from
// the call site, so it is never checked against `StockNewsInclude` — an unknown relation
// key nested inside `include`/`select` is invisible to tsc and fails only at runtime.
// `tsc --noEmit --incremental false` was exit 0 with this bug live.
// A scan of all 79 `include:` blocks in src/ found this as the ONLY occurrence.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";

import {
  getNewsBySymbol,
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

// ── Admin routes ──────────────────────────────────────────────

adminNewsRouter.post("/trigger", triggerDailyNewsIngest);

adminNewsRouter.post("/trigger/nse", triggerDailyNseAnnouncementsIngest);

adminNewsRouter.post("/trigger/google", triggerDailyGoogleNewsIngest);

adminNewsRouter.post("/extract", triggerContentExtractionWorker);

adminNewsRouter.post("/backfill", triggerNewsBackfill);


