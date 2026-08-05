// File: src/controllers/results-list-controller.ts
//
// GET /api/v1/results          → one PAGE of one half of the cross-stock earnings feed.
// GET /api/v1/results/overview → the whole-feed context the landing header needs.
// Both public, no auth. Both return the v1 { success, data } envelope.
//
// Feed query params (all optional):
//   feed=reported|upcoming   which half to page (default reported)
//   q=<text>                 match on symbol / company name / sector
//   days=<n>                 reported only — filed within the last n days ("This week" → 7)
//   scored=true              reported only — only stocks carrying a health score
//   upcomingDays=<n>         upcoming look-ahead window (default 60, max 365)
//   limit=<n>                page size (default 12, max 100)
//   cursor=<opaque>          the previous page's cursor; omit for the first page
//
// Overview query params:
//   upcomingDays=<n>         same window as above, so the "Upcoming" chip count matches
//                            the feed it opens (default 60, max 365)

import type { Request, Response } from "express";
import { buildResultsFeed, buildResultsOverview } from "../scoring/read/results-list.service.js";
import { UPCOMING_HORIZON_DAYS } from "../scoring/read/results-feed.cache.js";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 100;
const DEFAULT_UPCOMING_DAYS = 60;

/** Clamp a positive-integer query param, falling back when it is absent or unusable. */
function posInt(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : fallback;
}

const upcomingWindow = (raw: unknown): number =>
  posInt(raw, DEFAULT_UPCOMING_DAYS, UPCOMING_HORIZON_DAYS);

export const getResultsList = async (req: Request, res: Response) => {
  try {
    const feed = String(req.query.feed ?? "reported").toLowerCase().trim() === "upcoming"
      ? ("upcoming" as const)
      : ("reported" as const);

    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : undefined;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    // `days` is genuinely optional — absent means "latest per stock regardless of age",
    // which is a different feed from any window, so it gets no default.
    const daysRaw = Number(req.query.days);
    const days =
      Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(1825, Math.floor(daysRaw)) : undefined;

    const data = await buildResultsFeed({
      feed,
      q,
      days,
      scoredOnly: String(req.query.scored ?? "") === "true",
      upcomingDays: upcomingWindow(req.query.upcomingDays),
      limit: posInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT),
      cursor,
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.error("[results] feed error:", err);
    return res.status(500).json({ success: false, error: "Failed to build results feed" });
  }
};

export const getResultsOverview = async (req: Request, res: Response) => {
  try {
    const data = await buildResultsOverview(upcomingWindow(req.query.upcomingDays));
    return res.json({ success: true, data });
  } catch (err) {
    console.error("[results] overview error:", err);
    return res.status(500).json({ success: false, error: "Failed to build results overview" });
  }
};
