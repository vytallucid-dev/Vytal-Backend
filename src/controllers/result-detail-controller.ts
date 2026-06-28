// File: src/controllers/result-detail-controller.ts
//
// GET /api/v1/results/:symbol[?period=FY26Q4] → the per-result viewer payload.
// Public, no auth. v1 { success, data } envelope. 404 when the symbol is unknown OR
// the stock has no filed results yet (honest — nothing to view).

import type { Request, Response } from "express";
import { buildResultDetail } from "../scoring/read/result-detail.service.js";

export const getResultDetail = async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
    if (!symbol) return res.status(400).json({ success: false, error: "symbol is required" });

    const period = req.query.period ? String(req.query.period).toUpperCase().trim() : undefined;

    const data = await buildResultDetail(symbol, period);
    if (!data) {
      return res.status(404).json({ success: false, error: `No results found for ${symbol}` });
    }
    return res.json({ success: true, data });
  } catch (err) {
    console.error("[results/:symbol] error:", err);
    return res.status(500).json({ success: false, error: "Failed to build result detail" });
  }
};
