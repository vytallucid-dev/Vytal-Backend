import cors from "cors";
import express from "express";
import helmet from "helmet";
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
import { resultsScanRouter } from "./routes/ingestion/results-scan-route.js";
import { legacyBackfillRouter } from "./routes/ingestion/legacy-backfill-route.js";
import {
  adminShareholdingRouter,
  shareholdingRouter,
} from "./routes/ingestion/shareholding-route.js";
import { jobsRouter } from "./routes/job-routes.js";

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(helmet());
  app.use(express.json());

  // Register routes
  app.use("/api/v1/deals", dealsRouter);
  app.use("/api/v1/admin/deals", adminDealsRouter);
  app.use("/api/v1/prices", pricesRouter);
  app.use("/api/v1/admin/prices", adminPricesRouter);
  app.use("/api/v1/events", eventsRouter);
  app.use("/api/v1/admin/events", adminEventsRouter);
  app.use("/api/v1/shareholding", shareholdingRouter);
  app.use("/api/v1/admin/shareholding", adminShareholdingRouter);
  app.use("/api/v1/insider-trades", insiderTradesRouter);
  app.use("/api/v1/admin/insider-trades", adminInsiderTradesRouter);
  app.use("/api/v1/news", newsRouter);
  app.use("/api/v1/admin/news", adminNewsRouter);
  app.use("/api/v1/peer-groups", peerGroupsRouter);
  app.use("/api/v1/admin/peer-metrics", adminPeerMetricsRouter);
  app.use("/api/v1/admin/results-scan", resultsScanRouter);
  app.use("/api/v1/admin/legacy-backfill", legacyBackfillRouter);
  app.use("/api/v1/admin/jobs", jobsRouter);

  return app;
};
