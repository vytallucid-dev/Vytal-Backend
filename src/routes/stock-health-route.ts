// File: src/routes/stock-health-route.ts
// ─────────────────────────────────────────────────────────────
// The /api/stocks read API (NOT /api/v1) — matches the frontend hook paths.
//
//   GET /api/stocks                   — lean scored-stock list (typeahead + landing)
//   GET /api/stocks/universe          — FULL universe list (scored + not-yet-scored)
//   GET /api/stocks/scan?tool=…       — ranked "most-interesting journey" per tool
//                                       ?pg= / ?patterns= narrow it (see the controller)
//   GET /api/stocks/scan/facets?tool= — that scan's filter options + counts
//   GET /api/stocks/:symbol/health    — the per-stock HealthSnapshotView
//                                       ?window=<n> trailing quarters (default 12)
//                                       ?omit=pillars,peerStanding — opt-in PROJECTION for consumers
//                                       that read the verdict/trajectory/findings and not the metric
//                                       block. Omitted sections come back as `null` (never `[]`) and
//                                       the response's `omitted` array names them. Absent ⇒ full view.
//   GET /api/stocks/:symbol/ownership — the per-stock OwnershipSeriesView
//   GET /api/stocks/:symbol/fundamentals — the per-stock FundamentalsView
//                                       (dispatch-by-industry-family; ?basis=consolidated|standalone)
//   GET /api/stocks/:symbol/overview  — the per-stock StockOverviewView
//                                       (editorial company profile; honest-empty when no row)
//   GET /api/stocks/:symbol/price     — the per-stock StockPriceView
//                                       (stock series + Nifty 50 + sector index, returns precomputed)
//   GET /api/stocks/:symbol/peer-comparison — the per-stock PeerComparisonView
//                                       (1-month move vs the stock's PEER GROUP's index + peer average;
//                                       honest-empty when no peer group / no benchmark index)
//
// Static segments (`/`, `/universe`, `/scan`) are registered before the
// `/:symbol/health` param route so they resolve unambiguously.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { getStockHealth } from "../controllers/stock-health-controller.js";
import {
  getScoredStocks,
  getUniverseStocks,
  getStockScan,
  getStockScanFacets,
  getStockOwnership,
  getStockFundamentals,
  getStockOverview,
  getStockPrice,
  getStockPeerComparison,
} from "../controllers/stocks-list-controller.js";

export const stocksRouter = Router();

stocksRouter.get("/", getScoredStocks);
stocksRouter.get("/universe", getUniverseStocks);
stocksRouter.get("/scan", getStockScan);
stocksRouter.get("/scan/facets", getStockScanFacets);
stocksRouter.get("/:symbol/health", getStockHealth);
stocksRouter.get("/:symbol/ownership", getStockOwnership);
stocksRouter.get("/:symbol/fundamentals", getStockFundamentals);
stocksRouter.get("/:symbol/overview", getStockOverview);
stocksRouter.get("/:symbol/price", getStockPrice);
stocksRouter.get("/:symbol/peer-comparison", getStockPeerComparison);
