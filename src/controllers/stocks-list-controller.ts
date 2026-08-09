// File: src/controllers/stocks-list-controller.ts
//
// GET /api/stocks             → ScoredStockListItem[]  (lean typeahead + landing list)
// GET /api/stocks/scan?tool=  → ToolScanPage           (one page of the ranked scan)
// GET /api/stocks/scan/facets → ToolScanFacets         (that scan's filter options + counts)
//
// Returned DIRECTLY (not wrapped) to match the frontend apiFetch contract, same as
// the per-stock health read. Errors are { message } with the right status.
//
// Scan query params:
//   tool=trajectory|divergence|ownership   which ranking (default trajectory)
//   limit=<n>                              page size (default 16, max 100)
//   cursor=<opaque>                        the previous page's cursor; omit for page 1
//   pg=<id>[,<id>…]                        narrow to these peer groups (OR)
//   patterns=<key>[,<key>…]                narrow to rows carrying any of these findings (OR)
//   bands=<band>[,<band>…]                 narrow to these condition bands (OR)
// The three filters AND with each other. Each accepts a comma-joined list OR repeated params.
// ★ The FILTERS ARE SERVER-SIDE BY NECESSITY, not by preference — see the header of
//   tool-scan.page.ts: filtering a cursor-paged landing in the client filters a prefix.

import type { Request, Response } from "express";
import {
  buildScoredStocksList,
  buildUniverseStocksList,
} from "../scoring/read/stocks-list.service.js";
import { asScanTool } from "../scoring/read/tool-scan.cache.js";
import {
  buildToolScanPage,
  buildToolScanFacets,
  SCAN_PAGE_SIZE,
  SCAN_MAX_LIMIT,
  type ToolScanFilters,
} from "../scoring/read/tool-scan.page.js";
import { buildOwnershipView } from "../scoring/read/ownership-series.service.js";
import { buildFundamentalsView } from "../scoring/read/fundamentals-view.service.js";
import type { Basis } from "../scoring/read/fundamentals-view.types.js";
import { buildOverviewView } from "../scoring/read/overview-view.service.js";
import { buildPriceView } from "../scoring/read/price-view.service.js";
import { buildPeerComparisonView } from "../scoring/read/peer-comparison.service.js";

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

/**
 * A repeatable list query param, normalised. Accepts BOTH shapes a client can produce —
 * `?pg=a,b` and `?pg=a&pg=b` — because express parses them differently and a filter that
 * silently ignored one of them would fail in exactly the hard-to-see way.
 * Bounded: an untrusted caller cannot make the predicate arbitrarily wide.
 */
const MAX_FILTER_VALUES = 200;
function listParam(raw: unknown): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw])
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(parts)].slice(0, MAX_FILTER_VALUES);
}

/** The scan filters carried on a request. Empty lists are dropped — absent means "don't narrow". */
function scanFilters(req: Request): ToolScanFilters {
  const peerGroups = listParam(req.query.pg);
  const patterns = listParam(req.query.patterns);
  const bands = listParam(req.query.bands);
  return {
    ...(peerGroups.length ? { peerGroups } : {}),
    ...(patterns.length ? { patterns } : {}),
    ...(bands.length ? { bands } : {}),
  };
}

export const getStockScan = async (req: Request, res: Response) => {
  try {
    const raw = String(req.query.tool ?? "trajectory").toLowerCase().trim();
    const tool = asScanTool(raw);
    if (!tool) {
      // Honest: the scan ranking for this tool isn't implemented yet.
      return res.status(400).json({ message: `scan tool '${raw}' is not implemented yet` });
    }

    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(SCAN_MAX_LIMIT, Math.floor(limitRaw))
        : SCAN_PAGE_SIZE;

    const page = await buildToolScanPage(tool, {
      limit,
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      filters: scanFilters(req),
    });
    return res.json(page);
  } catch (err) {
    console.error("[stocks/scan] error:", err);
    return res.status(500).json({ message: "Failed to build stock scan" });
  }
};

// GET /api/stocks/scan/facets?tool=… → the landing filters' option lists.
// Same query params as the scan; the filters passed here CROSS-FILTER the counts (each
// dimension is counted with the other's selection applied) — see tool-scan.page.ts.
export const getStockScanFacets = async (req: Request, res: Response) => {
  try {
    const raw = String(req.query.tool ?? "trajectory").toLowerCase().trim();
    const tool = asScanTool(raw);
    if (!tool) {
      return res.status(400).json({ message: `scan tool '${raw}' is not implemented yet` });
    }
    return res.json(await buildToolScanFacets(tool, scanFilters(req)));
  } catch (err) {
    console.error("[stocks/scan/facets] error:", err);
    return res.status(500).json({ message: "Failed to build stock scan facets" });
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

// GET /api/stocks/:symbol/overview → StockOverviewView (editorial company profile).
// Returned DIRECTLY (no envelope), same as the health/ownership/fundamentals reads.
// 404 when the symbol is unknown; an in-universe stock with no editorial row returns
// a honest-empty view (hasProfile=false), NOT a 404.
export const getStockOverview = async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
    if (!symbol) {
      return res.status(400).json({ message: "symbol is required" });
    }
    const view = await buildOverviewView(symbol);
    if (!view) {
      return res.status(404).json({ message: `Stock ${symbol} not found in universe` });
    }
    return res.json(view);
  } catch (err) {
    console.error("[stocks/:symbol/overview] error:", err);
    return res.status(500).json({ message: "Failed to build overview view" });
  }
};

// GET /api/stocks/:symbol/price → StockPriceView (factual price performance + benchmark
// + sector-index comparison lines). Returned DIRECTLY (no envelope). 404 when the symbol
// is unknown; a stock with no price rows returns hasPrice=false (honest-empty), NOT a 404.
export const getStockPrice = async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
    if (!symbol) {
      return res.status(400).json({ message: "symbol is required" });
    }
    const view = await buildPriceView(symbol);
    if (!view) {
      return res.status(404).json({ message: `Stock ${symbol} not found in universe` });
    }
    return res.json(view);
  } catch (err) {
    console.error("[stocks/:symbol/price] error:", err);
    return res.status(500).json({ message: "Failed to build price view" });
  }
};

// GET /api/stocks/:symbol/peer-comparison → PeerComparisonView (the stock's 1-month move
// vs its PEER GROUP's benchmark index, and vs its peer group's average 1-month move).
// Returned DIRECTLY (no envelope). 404 when the symbol is unknown; a stock with no peer
// group assignment returns hasPeerGroup=false (honest-empty), NOT a 404.
export const getStockPeerComparison = async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
    if (!symbol) {
      return res.status(400).json({ message: "symbol is required" });
    }
    const view = await buildPeerComparisonView(symbol);
    if (!view) {
      return res.status(404).json({ message: `Stock ${symbol} not found in universe` });
    }
    return res.json(view);
  } catch (err) {
    console.error("[stocks/:symbol/peer-comparison] error:", err);
    return res.status(500).json({ message: "Failed to build peer comparison view" });
  }
};
