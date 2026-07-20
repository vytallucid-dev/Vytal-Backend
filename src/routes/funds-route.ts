// File: src/routes/funds-route.ts
// ─────────────────────────────────────────────────────────────
// Fund/ETF DISCOVERY (mounted at /api/v1/funds in app.ts).
//
//   GET /api/v1/funds  — filterable family catalogue: category, fund house, plan; sortable by
//                         name or return (nulls last); faceted; cursor-paged.
//
// The fund-detail page's door: /research/funds/[schemeCode] had no browse surface until now — the
// only catalogue read was /api/v1/instruments/search, built for the transaction sheet's manual
// entry and deliberately left untouched (min-3-char q, no filters, scheme-grain, no returns). This
// is a different question — family-grain, filter-and-narrow, never a leaderboard — and gets its
// own read. A public GET-only router, no auth, same posture as mfRouter / instrumentsRouter.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { getFundsBrowse } from "../controllers/funds-controller.js";

export const fundsRouter = Router();

fundsRouter.get("/", getFundsBrowse);
