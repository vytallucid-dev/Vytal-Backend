// ─────────────────────────────────────────────────────────────
// /api/v1/results-season — the results-season banner for the Stock Overview + Stock Health pages.
//
//   GET /api/v1/results-season/stock/:stockId            the strip for one stock and one reader.
//   GET /api/v1/results-season/peer-group/:peerGroupId   the section for one pond and one reader.
//
// Mounted behind `optionalAuth` in app.ts — NOT under /api/v1/me/* (anonymous is a valid caller) and
// NOT under /api/v1/results/* (that router is public + cacheable; this response is per-reader and must
// never be cached stock-side). Its own top-level mount, exactly as the relational card has.
//
// ★ THE PEER-GROUP SECTION SHARES THIS ROUTER, not the peer-group one. The pond's own read
// (/api/peer-groups/:id/health) is PUBLIC and unauthenticated — nothing on that page resolves a
// reader today — so hanging a per-reader, no-store response off it would mean re-deciding auth and
// caching on a router whose rulings are the opposite. Here they are already right.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import {
  getResultsSeasonBanner,
  getPeerGroupResultsSeason,
} from "../controllers/results-season-controller.js";

export const resultsSeasonRouter = Router();

resultsSeasonRouter.get("/stock/:stockId", getResultsSeasonBanner);
resultsSeasonRouter.get("/peer-group/:peerGroupId", getPeerGroupResultsSeason);
