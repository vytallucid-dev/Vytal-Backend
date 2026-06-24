// src/routes/ingestion/indices-route.ts
// ─────────────────────────────────────────────────────────────
// DISPLAY-ONLY index pipeline (sibling of prices-route.ts).
//
// GET  /api/v1/indices/index-logs        — index fetch history / audit
// POST /api/v1/admin/indices/trigger     — manual EOD index run (admin)
// POST /api/v1/admin/indices/backfill    — historical backfill (admin)
//
// Same /admin/ prefix + no-explicit-middleware convention as the
// equity prices routes (inherits the same network-level protection).
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import {
  getIndexFetchLogs,
  triggerIndexIngest,
  triggerIndexBackfill,
} from "../../controllers/ingestion/indices-controllers.js";

export const indicesRouter = Router();
export const adminIndicesRouter = Router();

// ── GET /api/v1/indices/index-logs ────────────────────────────

indicesRouter.get("/index-logs", getIndexFetchLogs);

// ── POST /api/v1/admin/indices/trigger ────────────────────────
// Trigger EOD index ingest for today or a specific date.
// Body: { date?: "YYYY-MM-DD" }

adminIndicesRouter.post("/trigger", triggerIndexIngest);

// ── POST /api/v1/admin/indices/backfill ───────────────────────
// Kick off historical backfill. Responds immediately; runs async.
// Body: { days: 365 }

adminIndicesRouter.post("/backfill", triggerIndexBackfill);
