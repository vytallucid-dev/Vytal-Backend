// ─────────────────────────────────────────────────────────────
// /api/v1/me — behaviour-tracking routes (Phase 1). Mounted behind requireAuth in app.ts alongside
// the other me-routers. Owner is always req.authUser.userId (never the payload).
//
//   POST   /api/v1/me/activity   ingest a batch of attention events (a beacon; returns fast)
//   DELETE /api/v1/me/activity   clear all of the caller's activity (both event tables + rollup)
//
// Relationship events are NOT here — they are emitted server-side from the watchlist/alert/transaction
// mutations. This router only carries the client-originated attention ingest and the clear control.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { postActivity, clearMyActivity } from "../controllers/me/activity-controller.js";

export const meActivityRouter = Router();

meActivityRouter.post("/activity", postActivity);
meActivityRouter.delete("/activity", clearMyActivity);
