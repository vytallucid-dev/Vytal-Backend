// src/routes/events.ts
// ─────────────────────────────────────────────────────────────
// GET  /api/events/:symbol          — events for a stock
// GET  /api/events/calendar         — upcoming events (all stocks)
// POST /api/admin/events/trigger    — manual weekly run
// POST /api/admin/events/refresh    — manual daily run
// POST /api/admin/events/backfill   — historical backfill
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import {
  backfillEvents,
  getAllCalendarEvents,
  getCalendarBounds,
  getEventLogs,
  getEventsBySymbol,
  triggerDailyEventRefresh,
  triggerWeeklyEventIngest,
} from "../../controllers/ingestion/events-controllers.js";

export const eventsRouter = Router();
export const adminEventsRouter = Router();

// ── GET /api/events/calendar/bounds ───────────────────────────
// The earliest / latest event date we hold — the month grid's navigation limits.
// Registered ahead of "/calendar" purely for readability; the paths are distinct.

eventsRouter.get("/calendar/bounds", getCalendarBounds);

// ── GET /api/events/calendar ──────────────────────────────────
// Events across all stocks in universe — the forward `days` look-ahead by default, an
// explicit `from`/`to` window (including history) on request, keyset-paged with `limit`.
// Primary driver for the event calendar UI feature.

eventsRouter.get("/calendar", getAllCalendarEvents);

// ── GET /api/events/ — fetch logs ────────────────────────────

eventsRouter.get("/event-logs", getEventLogs);

// ── GET /api/events/:symbol ───────────────────────────────────
// All events for a specific stock (past + upcoming)

eventsRouter.get("/:symbol", getEventsBySymbol);

// ── POST /api/admin/events/trigger ────────────────────────────

adminEventsRouter.post("/trigger", triggerWeeklyEventIngest);

// ── POST /api/admin/events/refresh ────────────────────────────
// Quick daily refresh of next 7 days (catches rescheduled events)

adminEventsRouter.post("/refresh", triggerDailyEventRefresh);

// ── POST /api/admin/events/backfill ───────────────────────────

adminEventsRouter.post("/backfill", backfillEvents);
