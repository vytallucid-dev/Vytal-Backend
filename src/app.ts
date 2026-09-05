import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { requireAdmin, requireAuth, optionalAuth } from "./middleware/auth.js";
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
import { adminMfRouter, mfRouter } from "./routes/ingestion/mf-route.js";
import { instrumentsRouter } from "./routes/instrument-search-route.js";
import { fundsRouter } from "./routes/funds-route.js";
import {
  adminReitsRouter,
  adminGovtSecuritiesRouter,
  adminCorporateBondsRouter,
} from "./routes/ingestion/instrument-lanes-route.js";
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
import { retentionAdminRouter } from "./routes/admin/retention-route.js";
import { missLogAdminRouter } from "./routes/admin/miss-log-route.js";
import { ingestionErrorsRouter } from "./routes/ingestion/ingestion-errors-route.js";
import { catalogueRouter } from "./routes/catalogue-route.js";
import { resultsRouter } from "./routes/results-route.js";
import { stocksRouter } from "./routes/stock-health-route.js";
import { peerGroupHealthRouter } from "./routes/peer-group-health-route.js";
import { universeHealthRouter } from "./routes/universe-health-route.js";
import { compareRouter } from "./routes/compare-route.js";
import { meRouter } from "./routes/me-routes.js";
import { mePortfolioRouter } from "./routes/me-portfolio-routes.js";
import { meActivityRouter } from "./routes/me-activity-routes.js";
import { meWatchlistRouter } from "./routes/me-watchlist-routes.js";
import { meAlertsRouter } from "./routes/me-alerts-routes.js";
import { meMemoriesRouter } from "./routes/me-memories-routes.js";
import { meAskRouter } from "./routes/me-ask-routes.js";
import { meRemindersRouter } from "./routes/me-reminders-routes.js";
import { meBrokerRouter } from "./routes/me-broker-routes.js";
import { meChatRouter } from "./routes/me-chat-routes.js";
import { relationalRouter } from "./routes/relational-routes.js";
import { resultsSeasonRouter } from "./routes/results-season-routes.js";
import { peerGroupExposureRouter } from "./routes/peer-group-exposure-route.js";

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(helmet());

  // ── RESPONSE COMPRESSION ──────────────────────────────────────────────────────────────────────
  // Every read route on this server sends JSON, and JSON is the most compressible thing we ship:
  // the catalogue is 54 KB on the wire and 14.6 KB gzipped. This was the only transport-level cost
  // nobody was paying attention to, because nothing here ever set a Content-Encoding by hand.
  //
  // ORDER — after cors + helmet, before express.json() and before every route mount:
  //   · AFTER cors()    a preflight OPTIONS is ended by the cors handler with an empty body. It
  //                     never reaches this layer, so it never pays for the wrapper it cannot use.
  //   · AFTER helmet()  helmet only sets response headers synchronously; it neither writes a body
  //                     nor cares whether one is later encoded.
  //   · BEFORE routes   compression works by wrapping res.write/res.end, so it has to be installed
  //                     before the handler that calls them. A middleware registered after a route
  //                     mount is simply never reached for that route.
  //
  // ⚠ ETag INTERACTION — the thing to get right, because ETags are the only cache mechanism here.
  // Express computes its default WEAK ETag inside res.json/res.send, from the body it was handed —
  // that is, before this layer encodes anything. So the same resource keeps ONE ETag whether it goes
  // out gzipped or identity, which is exactly what a weak validator is allowed to do (RFC 9110 §8.8.3:
  // weak comparison is for representations that are semantically, not byte-, equivalent). Conditional
  // requests keep working unchanged, and a 304 carries no body to compress in the first place.
  //
  // The one strong ETag in the codebase is the catalogue's `"${version}"` (catalogue-controller.ts),
  // which is public + shared-cacheable and now has two encodings behind one validator. That is safe
  // ONLY because compression sets `Vary: Accept-Encoding` on everything it considers — including
  // responses it declines to compress — so a shared cache keys the gzip and identity variants apart
  // instead of handing a gzip body to an identity-only client. The Vary header is the load-bearing
  // part of adding this, not the byte saving.
  //
  // Defaults are kept deliberately: threshold 1024 (below that the gzip header costs more than it
  // saves) and compression.filter (compressible content-types only, and it stands down on
  // `Cache-Control: no-transform`). Nothing on this server streams or sets its own Content-Encoding.
  app.use(compression());

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
  // ── Mutual funds (Steps 9 + 10/11). Public reads + admin manual triggers, so the MF
  //    pipeline is observable and triggerable exactly like every other one.
  app.use("/api/v1/mf", mfRouter);
  app.use("/api/v1/admin/mf", requireAdmin, adminMfRouter);
  // ── Universe-wide instrument SEARCH (name / symbol / ISIN). Public read, same posture as the
  //    stock/fund reads: it makes the ~19k non-equity instruments discoverable for manual entry.
  //    Additive — no existing route's behaviour changes. ──
  app.use("/api/v1/instruments", instrumentsRouter);
  // ── Fund/ETF DISCOVERY — the browse door the fund-detail page had none of. Family-grain,
  //    filter-and-narrow (category/fundHouse/plan), never a leaderboard. Public read, additive. ──
  app.use("/api/v1/funds", fundsRouter);
  // The three udiff instrument lanes (Steps 14 / 15 / 17). They shipped cron-only — registered in
  // pipelines-controller but with no trigger and no page, which is a mystery cron with a paper
  // trail. Each is its own mount because each is its own card and its own failure domain.
  app.use("/api/v1/admin/reits", requireAdmin, adminReitsRouter);
  app.use("/api/v1/admin/govt-securities", requireAdmin, adminGovtSecuritiesRouter);
  app.use("/api/v1/admin/corporate-bonds", requireAdmin, adminCorporateBondsRouter);
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
  app.use("/api/v1/admin/retention", requireAdmin, retentionAdminRouter);
  // T-0 · the persisted miss-log — "what are readers asking that has no family?" (§6.4, T-22).
  app.use("/api/v1/admin/miss-log", requireAdmin, missLogAdminRouter);
  app.use("/api/v1/admin/ingestion-errors", requireAdmin, ingestionErrorsRouter);

  // Read API — cross-stock results feed (reported + upcoming) for the Results landing.
  // Public, no auth; mounted under /api/v1 (envelope style). Reported numbers come from
  // the per-family quarterly_results tables; upcoming from corporate_events earnings.
  // ★ optionalAuth — the results viewer is PUBLIC, and reads the token only so a signed-in reader
  // gets the brief's personal section. Anonymous is a valid caller; see result-detail-controller.ts.
  app.use("/api/v1/results", optionalAuth, resultsRouter);

  // Read API — THE COPY CATALOGUE. Static product vocabulary: every finding's name, description and
  // interpretive boundary, the three-lens faces, the portfolio library's boundaries, and the guardrail
  // signatures. Public, no auth, no DB read — the response is assembled from frozen module constants
  // and changes on deploy only, which is why it is the one route in this file that sets a `public`
  // Cache-Control (relational's `private, no-store` is the opposite case; see the controller header).
  app.use("/api/v1/catalogue", catalogueRouter);

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

  // The reader's stated preferences (stage 8) — the endpoint the memory controls call.
  app.use("/api/v1/me", requireAuth, meMemoriesRouter);

  // ★ THE COMPOSITION PATH (stage 8). Router → resolvers → sections; no tools, no model-visible data.
  app.use("/api/v1/me", requireAuth, meAskRouter);

  // ── Authenticated user's OWN event reminders (requireAuth). Date-triggered sibling of
  //    alerts: "remind me N days before this stock's next <eventType>". Owner always
  //    req.authUser.userId. A fifth router on the same base path — the four above are
  //    untouched. Firing is the daily eval pass; delivery reuses the alerts email pipeline. ──
  app.use("/api/v1/me", requireAuth, meRemindersRouter);

  // ── Authenticated user's OWN broker integrations (requireAuth). READ-ONLY holdings
  //    import: connect/sync/deactivate/clear + status. Owner always req.authUser.userId
  //    (IDOR-proof). A sixth router on the same base path — the five above are untouched.
  //    The broker-agnostic lifecycle lives in src/brokers; adapters never place orders. ──
  app.use("/api/v1/me", requireAuth, meBrokerRouter);

  // ── Behaviour tracking (Phase 1): the client-originated attention ingest (a beacon) + the
  //    clear-my-activity control. A SEVENTH router on the same base path; the others are untouched.
  //    Relationship events ride the existing mutations server-side, not this router. ──
  app.use("/api/v1/me", requireAuth, meActivityRouter);

  // ── Authenticated user's OWN chat (requireAuth). Stage 2 conversation engine: discuss-sidebar +
  //    chat-page sessions with server-composed, grounded openings; owner always req.authUser.userId
  //    (IDOR-proof). An EIGHTH router on the same base path — the seven above are untouched. Grounding,
  //    tone, the output guardrail and metering are reused from src/ai; nothing here sends email. ──
  app.use("/api/v1/me", requireAuth, meChatRouter);

  // ── Relational L4 — the reader-relative Overview card (standalone service; the card + the AI layer are
  //    both consumers). Behind `optionalAuth`: an ANONYMOUS reader is a valid caller (M9 Stranger, UO only,
  //    UG8), never a 401. Its OWN top-level mount — deliberately NOT under /api/v1/me/* (anonymous is
  //    valid) and NOT under /api/stocks/* (public + cacheable by symbol; this response is per-reader and
  //    must never be cached stock-side). ──
  app.use("/api/v1/relational", optionalAuth, relationalRouter);

  // ── Results-season banner — the conditional strip above the Stock Overview / Stock Health pages.
  //    Behind `optionalAuth` for the same reason as the card above it: the anonymous sentence is one of
  //    the three authored variants, not a degraded fallback. Deliberately NOT folded into
  //    /api/v1/results (public + cacheable) — this response varies by reader and is `private, no-store`.
  //    Silence is a 200 with `banner: null`; it is the ordinary answer, not a failure. ──
  app.use("/api/v1/results-season", optionalAuth, resultsSeasonRouter);

  // ── The reader's own positions inside one peer group — the marks every table on the peer-group page
  //    wears, and the condition for the page's one exposure legend. Behind `optionalAuth`: anonymous is
  //    a valid caller and gets an empty map (no marks, no legend), never a 401. Deliberately NOT folded
  //    into /api/peer-groups/:id/health, which is public and cached per pond for every reader — see the
  //    service header. `private, no-store`. ──
  app.use("/api/v1/peer-group-exposure", optionalAuth, peerGroupExposureRouter);

  return app;
};
