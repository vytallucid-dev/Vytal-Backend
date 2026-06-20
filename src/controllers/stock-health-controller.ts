// File: src/controllers/stock-health-controller.ts
//
// GET /api/stocks/:symbol/health → the HealthSnapshotView (returned DIRECTLY, not
// wrapped in a { success, data } envelope, to match the frontend apiFetch contract
// in lib/api/client.ts). Errors are { message } with the right status so React
// Query's error state fires.

import type { Request, Response } from "express";
import { buildHealthSnapshotView } from "../scoring/read/health-view.service.js";

export const getStockHealth = async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
    if (!symbol) {
      return res.status(400).json({ message: "symbol is required" });
    }

    // ?window= trailing quarters for the trajectory series (default 12, clamp 1–40).
    const rawWindow = Number(req.query.window);
    const windowQuarters =
      Number.isFinite(rawWindow) && rawWindow > 0 ? Math.min(40, Math.floor(rawWindow)) : 12;

    const view = await buildHealthSnapshotView(symbol, windowQuarters);
    if (!view) {
      return res.status(404).json({ message: `Stock ${symbol} not found in universe` });
    }

    return res.json(view);
  } catch (err) {
    console.error("[stocks/:symbol/health] error:", err);
    return res.status(500).json({ message: "Failed to build health snapshot" });
  }
};
