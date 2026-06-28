// File: src/controllers/results-list-controller.ts
//
// GET /api/v1/results → the cross-stock earnings feed (reported + upcoming).
// Public, no auth. Returns the v1 { success, data } envelope.
//
// Query params (all optional):
//   filter=reported|upcoming|all   which halves to build (default all)
//   days=<n>                       reported window — only results filed in last n days
//                                  (omit → latest per stock regardless of age)
//   upcomingDays=<n>               upcoming look-ahead window (default 60, max 365)
//   limit=<n>                      max items per half (default 250, max 500)

import type { Request, Response } from "express";
import { buildResultsList } from "../scoring/read/results-list.service.js";

export const getResultsList = async (req: Request, res: Response) => {
  try {
    const rawFilter = String(req.query.filter ?? "all").toLowerCase().trim();
    const filter: "reported" | "upcoming" | "all" =
      rawFilter === "reported" || rawFilter === "upcoming" ? rawFilter : "all";

    const daysRaw = Number(req.query.days);
    const days =
      Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(1825, Math.floor(daysRaw)) : undefined;

    const upRaw = Number(req.query.upcomingDays);
    const upcomingDays =
      Number.isFinite(upRaw) && upRaw > 0 ? Math.min(365, Math.floor(upRaw)) : 60;

    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : 250;

    const data = await buildResultsList({ filter, days, upcomingDays, limit });
    return res.json({ success: true, data });
  } catch (err) {
    console.error("[results] list error:", err);
    return res.status(500).json({ success: false, error: "Failed to build results list" });
  }
};
