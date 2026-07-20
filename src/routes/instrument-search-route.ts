// File: src/routes/instrument-search-route.ts
// ─────────────────────────────────────────────────────────────
// Universe-wide instrument reads (mounted at /api/v1/instruments in app.ts).
//
//   GET /api/v1/instruments/search?q=&limit=&cursor=        — ranked, capped, keyset-paged catalogue search
//   GET /api/v1/instruments/:instrumentId/series?days=<n>   — the stored weekly NAV/close series (read-only)
//
// A public read router (no auth), the sibling of mfRouter / pricesRouter — catalogue/price data is
// public, exactly as the fund analytics/chart reads are.
//
// ROUTE ORDER: the literal `/search` is declared BEFORE the parametric `/:instrumentId/series` (they
// occupy different path shapes and cannot collide, but literals-first mirrors mf-route's discipline).
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { getInstrumentSearch } from "../controllers/instrument-search-controller.js";
import { getInstrumentSeries } from "../controllers/instrument-series-controller.js";

export const instrumentsRouter = Router();

instrumentsRouter.get("/search", getInstrumentSearch);
instrumentsRouter.get("/:instrumentId/series", getInstrumentSeries);
