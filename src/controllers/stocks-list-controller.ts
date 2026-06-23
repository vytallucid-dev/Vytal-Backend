// File: src/controllers/stocks-list-controller.ts
//
// GET /api/stocks            → ScoredStockListItem[]  (lean typeahead + landing list)
// GET /api/stocks/scan?tool= → StockScanItem[]        (ranked "most-interesting journey")
//
// Returned DIRECTLY (not wrapped) to match the frontend apiFetch contract, same as
// the per-stock health read. Errors are { message } with the right status.

import type { Request, Response } from "express";
import {
  buildScoredStocksList,
  buildUniverseStocksList,
  buildToolScan,
} from "../scoring/read/stocks-list.service.js";
import { buildOwnershipView } from "../scoring/read/ownership-series.service.js";
import { buildFundamentalsView } from "../scoring/read/fundamentals-view.service.js";
import type { Basis } from "../scoring/read/fundamentals-view.types.js";

export const getScoredStocks = async (_req: Request, res: Response) => {
  try {
    const list = await buildScoredStocksList();
    return res.json(list);
  } catch (err) {
    console.error("[stocks] list error:", err);
    return res.status(500).json({ message: "Failed to build scored-stock list" });
  }
};

export const getUniverseStocks = async (_req: Request, res: Response) => {
  try {
    const list = await buildUniverseStocksList();
    return res.json(list);
  } catch (err) {
    console.error("[stocks/universe] list error:", err);
    return res.status(500).json({ message: "Failed to build universe-stock list" });
  }
};

export const getStockScan = async (req: Request, res: Response) => {
  try {
    const tool = String(req.query.tool ?? "trajectory").toLowerCase().trim();
    const scan = await buildToolScan(tool);
    if (scan === null) {
      // Honest: the scan ranking for this tool isn't implemented yet.
      return res
        .status(400)
        .json({ message: `scan tool '${tool}' is not implemented yet` });
    }
    return res.json(scan);
  } catch (err) {
    console.error("[stocks/scan] error:", err);
    return res.status(500).json({ message: "Failed to build stock scan" });
  }
};

export const getStockOwnership = async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
    if (!symbol) {
      return res.status(400).json({ message: "symbol is required" });
    }
    // ?window= trailing quarters for the ownership series (default 12, clamp 1–40).
    const rawWindow = Number(req.query.window);
    const windowQuarters =
      Number.isFinite(rawWindow) && rawWindow > 0 ? Math.min(40, Math.floor(rawWindow)) : 12;

    const view = await buildOwnershipView(symbol, windowQuarters);
    if (!view) {
      return res.status(404).json({ message: `Stock ${symbol} not found in universe` });
    }
    return res.json(view);
  } catch (err) {
    console.error("[stocks/:symbol/ownership] error:", err);
    return res.status(500).json({ message: "Failed to build ownership series" });
  }
};

// GET /api/stocks/:symbol/fundamentals → FundamentalsView (dispatch-by-industry-family).
// Returned DIRECTLY (no {success,data} envelope), same as the health/ownership reads.
export const getStockFundamentals = async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
    if (!symbol) {
      return res.status(400).json({ message: "symbol is required" });
    }
    // ?basis= optional override from the tab's toggle; invalid values are ignored and
    // the service defaults to consolidated → the only-available basis.
    const rawBasis = String(req.query.basis ?? "").toLowerCase().trim();
    const basis: Basis | undefined =
      rawBasis === "consolidated" || rawBasis === "standalone" ? (rawBasis as Basis) : undefined;

    const view = await buildFundamentalsView(symbol, { basis });
    if (!view) {
      return res.status(404).json({ message: `Stock ${symbol} not found in universe` });
    }
    return res.json(view);
  } catch (err) {
    console.error("[stocks/:symbol/fundamentals] error:", err);
    return res.status(500).json({ message: "Failed to build fundamentals view" });
  }
};
