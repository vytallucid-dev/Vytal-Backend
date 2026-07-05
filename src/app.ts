import cors from "cors";
import express from "express";
import helmet from "helmet";
import { requireAdmin, requireAuth } from "./middleware/auth.js";
import {
  adminDealsRouter,
  dealsRouter,
} from "./routes/ingestion/deals-route.js";
import {
  adminEventsRouter,
  eventsRouter,
} from "./routes/ingestion/events-route.js";
import {
  adminInsiderTradesRouter,
  insiderTradesRouter,
} from "./routes/ingestion/insider-trades-route.js";
import { adminNewsRouter, newsRouter } from "./routes/ingestion/news-route.js";
import {
  adminPeerMetricsRouter,
  peerGroupsRouter,
} from "./routes/ingestion/peer-metrics-route.js";
import {
  adminPricesRouter,
  pricesRouter,
} from "./routes/ingestion/prices-route.js";
import {
  adminIndicesRouter,
  indicesRouter,
} from "./routes/ingestion/indices-route.js";
import { resultsScanRouter } from "./routes/ingestion/results-scan-route.js";
import { adminBankSupplementaryRouter } from "./routes/ingestion/bank-supplementary-route.js";
import { legacyBackfillRouter } from "./routes/ingestion/legacy-backfill-route.js";
import {
  adminShareholdingRouter,
  shareholdingRouter,
} from "./routes/ingestion/shareholding-route.js";
import { jobsRouter } from "./routes/job-routes.js";
import { pipelinesRouter } from "./routes/pipelines-route.js";
import { ingestionErrorsRouter } from "./routes/ingestion/ingestion-errors-route.js";
import { resultsRouter } from "./routes/results-route.js";
import { stocksRouter } from "./routes/stock-health-route.js";
import { peerGroupHealthRouter } from "./routes/peer-group-health-route.js";
import { universeHealthRouter } from "./routes/universe-health-route.js";
import { compareRouter } from "./routes/compare-route.js";
import { meRouter } from "./routes/me-routes.js";
import { mePortfolioRouter } from "./routes/me-portfolio-routes.js";
import { meWatchlistRouter } from "./routes/me-watchlist-routes.js";
import { meAlertsRouter } from "./routes/me-alerts-routes.js";
import { meRemindersRouter } from "./routes/me-reminders-routes.js";

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(helmet());
  app.use(express.json());

  // Register routes.
  // ── Public read routers (GET-only; no auth yet — the frontend sends no
  //    tokens. Gating these is a LATER phase once the frontend sends JWTs). ──
  // ── Every /api/v1/admin/* mount below is gated with requireAdmin (valid
  //    Supabase JWT + role='admin', else 401/403). All 13 admin routers hold
  //    every mutating/ingestion endpoint; the public routers above are read-only. ──
  app.use("/api/v1/deals", dealsRouter);
  app.use("/api/v1/admin/deals", requireAdmin, adminDealsRouter);
  app.use("/api/v1/prices", pricesRouter);
  app.use("/api/v1/admin/prices", requireAdmin, adminPricesRouter);
  app.use("/api/v1/indices", indicesRouter);
  app.use("/api/v1/admin/indices", requireAdmin, adminIndicesRouter);
  app.use("/api/v1/events", eventsRouter);
  app.use("/api/v1/admin/events", requireAdmin, adminEventsRouter);
  app.use("/api/v1/shareholding", shareholdingRouter);
  app.use("/api/v1/admin/shareholding", requireAdmin, adminShareholdingRouter);
  app.use("/api/v1/insider-trades", insiderTradesRouter);
  app.use("/api/v1/admin/insider-trades", requireAdmin, adminInsiderTradesRouter);
  app.use("/api/v1/news", newsRouter);
  app.use("/api/v1/admin/news", requireAdmin, adminNewsRouter);
  app.use("/api/v1/peer-groups", peerGroupsRouter);
  app.use("/api/v1/admin/peer-metrics", requireAdmin, adminPeerMetricsRouter);
  app.use("/api/v1/admin/results-scan", requireAdmin, resultsScanRouter);
  app.use("/api/v1/admin/bank-supplementary", requireAdmin, adminBankSupplementaryRouter);
  app.use("/api/v1/admin/legacy-backfill", requireAdmin, legacyBackfillRouter);
  app.use("/api/v1/admin/jobs", requireAdmin, jobsRouter);
  app.use("/api/v1/admin/pipelines", requireAdmin, pipelinesRouter);
  app.use("/api/v1/admin/ingestion-errors", requireAdmin, ingestionErrorsRouter);

  // Read API — cross-stock results feed (reported + upcoming) for the Results landing.
  // Public, no auth; mounted under /api/v1 (envelope style). Reported numbers come from
  // the per-family quarterly_results tables; upcoming from corporate_events earnings.
  app.use("/api/v1/results", resultsRouter);

  // Read API — per-stock Health Score. Mounted at /api/stocks (no v1) to match the
  // frontend hook path. Canonical "health snapshot read" reused by later surfaces.
  app.use("/api/stocks", stocksRouter);

  // Read API — peer-group aggregates (scoring). The index-page list + the per-pond
  // Health tab. Mounted at /api/peer-groups (no v1); distinct from the v1 ingestion-
  // metrics router of the same path prefix.
  app.use("/api/peer-groups", peerGroupHealthRouter);

  // Read API — universe-level aggregate (all ~93 scored stocks). Mounted at
  // /api/universe (no v1). Provides the Briefing + Flags + Screen data for the Hub.
  app.use("/api/universe", universeHealthRouter);

  // Read API — stock-vs-stock COMPARISON. Mounted at /api/compare (no v1). A NEW
  // assembly/alignment endpoint over the existing per-stock reads (health/fundamentals/
  // price/ownership) — no new data tables. Owns the comparability/alignment logic:
  // the universal axis, the family-locked sets, and the honest boundary (never a winner).
  app.use("/api/compare", compareRouter);

  // ── Authenticated user's OWN onboarding (requireAuth). Every /api/v1/me/*
  //    handler derives the owner from the verified token (req.authUser.userId),
  //    never the payload — no IDOR surface. Distinct from the public reads above,
  //    which stay token-free this phase. ──
  app.use("/api/v1/me", requireAuth, meRouter);

  // ── Authenticated user's OWN portfolio (requireAuth). Transactions ledger +
  //    materialized FIFO holdings. Same base path + guard as onboarding; owner is
  //    always req.authUser.userId. Onboarding's meRouter is untouched. ──
  app.use("/api/v1/me", requireAuth, mePortfolioRouter);

  // ── Authenticated user's OWN watchlist (requireAuth). Pinned research surface —
  //    add/remove/rich-list, owner always req.authUser.userId. Onboarding + portfolio
  //    routers are untouched (a third router on the same base path). ──
  app.use("/api/v1/me", requireAuth, meWatchlistRouter);

  // ── Authenticated user's OWN alerts (requireAuth). User-created rules (price /
  //    health_band / finding) + the fired-events log; owner always req.authUser.userId.
  //    A fourth router on the same base path — the three above are untouched. Evaluation
  //    (firing) is the daily pass; this layer never sends email. ──
  app.use("/api/v1/me", requireAuth, meAlertsRouter);

  // ── Authenticated user's OWN event reminders (requireAuth). Date-triggered sibling of
  //    alerts: "remind me N days before this stock's next <eventType>". Owner always
  //    req.authUser.userId. A fifth router on the same base path — the four above are
  //    untouched. Firing is the daily eval pass; delivery reuses the alerts email pipeline. ──
  app.use("/api/v1/me", requireAuth, meRemindersRouter);

  return app;
};
