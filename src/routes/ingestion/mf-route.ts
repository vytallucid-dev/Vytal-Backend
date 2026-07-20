// src/routes/ingestion/mf-route.ts
// ─────────────────────────────────────────────────────────────
// THE MUTUAL-FUND PIPELINE'S ROUTES (RULING ①b).
//
// Sibling of indices-route.ts / prices-route.ts, same shape: a public read router and an admin
// router mounted behind requireAdmin in app.ts.
//
//   GET  /api/v1/mf/run-logs                — MF pipeline run history (all three jobs)
//   GET  /api/v1/mf/:schemeCode/analytics   — computed analytics + the honest-empty ledger
//   GET  /api/v1/mf/:schemeCode/chart       — LIVE NAV series (transient; nothing stored)
//   GET  /api/v1/mf/:schemeCode/family      — the scheme's family + sibling plans (Step 16 read)
//
//   POST /api/v1/admin/mf/nav/trigger               — manual amfi_nav_daily
//   POST /api/v1/admin/mf/analytics/trigger         — manual mf_analytics_daily
//   POST /api/v1/admin/mf/corporate-actions/trigger — manual instrument_corporate_actions
//
// (/inception-walk is GONE — it anchored ret_since_earliest_cagr, a metric AMFI's raw NAV cannot
// support honestly. See the drop migration.)
//
// ROUTE ORDER MATTERS: /run-logs is declared BEFORE /:schemeCode/*, or "run-logs" would be
// captured as a scheme code.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import {
  getFundAnalytics,
  getFundChart,
  getFundFamily,
  getMfRunLogs,
  triggerMfNavIngest,
  triggerEtfNavIngest,
  triggerEtfPricesIngest,
  triggerMfAnalytics,
  triggerInstrumentCorporateActions,
} from "../../controllers/ingestion/mf-controllers.js";

export const mfRouter = Router();
export const adminMfRouter = Router();

// ── Public reads (fund data is public, mirroring /prices and /indices) ──
mfRouter.get("/run-logs", getMfRunLogs);
mfRouter.get("/:schemeCode/analytics", getFundAnalytics);
mfRouter.get("/:schemeCode/chart", getFundChart);
mfRouter.get("/:schemeCode/family", getFundFamily);

// ── Admin manual triggers (mounted behind requireAdmin in app.ts) ──
// Every job of the mutual-funds pipeline is reachable by hand. The two ETF ones were added last:
// they had shipped as cron-only, which is precisely the "mystery cron" Step 10 went back and fixed
// for amfi_nav_daily. A pipeline an operator cannot run is a pipeline they cannot debug.
adminMfRouter.post("/nav/trigger", triggerMfNavIngest);
adminMfRouter.post("/etf-nav/trigger", triggerEtfNavIngest);
adminMfRouter.post("/etf-prices/trigger", triggerEtfPricesIngest);
adminMfRouter.post("/analytics/trigger", triggerMfAnalytics);
adminMfRouter.post("/corporate-actions/trigger", triggerInstrumentCorporateActions);
