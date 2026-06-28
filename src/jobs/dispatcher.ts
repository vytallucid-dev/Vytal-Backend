// ─────────────────────────────────────────────────────────────
// JOB DISPATCHER
//
// Maps a job's `type` string to its handler function.
// Each handler is a pure async function that:
//   - takes a JobContext (with payload + helpers)
//   - returns a JSON-serialisable result on success
//   - throws on failure
//
// Adding a new job type means:
//   1. Add the type + payload + retry policy in types.ts
//   2. Implement a handler under src/jobs/handlers/
//   3. Register it here in HANDLERS
// ─────────────────────────────────────────────────────────────

import type { JobContext } from "./context.js";
import { handleDealsBackfill } from "./handlers/deals-backfill.handler.js";
import { handleEventsBackfill } from "./handlers/events-backfill.handler.js";
import { handleInsiderTradesBackfill } from "./handlers/insider-trades-backfill.handler.js";
import {
  handleDailyNewsIngest,
  handleNseAnnouncementsIngest,
  handleGoogleNewsIngest,
  handleNewsContentExtraction,
  handleNewsBackfill,
} from "./handlers/news-ingests.handler.js";
import { handlePeerMetricsComputeAll } from "./handlers/peer-metrics-compute-all.handler.js";
import { handlePgRescore } from "./handlers/pg-rescore.handler.js";
import { handlePgCascadeRescore } from "./handlers/pg-cascade-rescore.handler.js";
import { handleFillCascadeRescore } from "./handlers/fill-cascade-rescore.handler.js";
import { handlePricesRefetch } from "./handlers/prices-refetch.handler.js";
import { handleResultsScan } from "./handlers/results-scan.handler.js";
import { handlePriceBackfill } from "./handlers/price-backfill.handler.js";
import {
  handleIndexPricesDaily,
  handleIndexBackfill,
} from "./handlers/index-ingest.handler.js";
import { handleLegacyBackfill } from "./handlers/legacy-backfill.js";
import {
  handleEodPricesDaily,
  handleDealsDailyIngest,
  handleEventsWeeklyIngest,
  handleEventsDailyRefresh,
  handleShareholdingQuarterly,
  handleShareholdingSmartRefresh,
  handleInsiderTradesDaily,
} from "./handlers/daily-ingest-ops.handler.js";
import { handleShareholdingBackfill } from "./handlers/shareholding-backfill.handler.js";
import { JobTypes, type JobType } from "./types.js";

export type JobHandler<TPayload = any, TResult = any> = (
  ctx: JobContext<TPayload>,
) => Promise<TResult>;

const HANDLERS: Record<JobType, JobHandler> = {
  // Backfill / one-off
  [JobTypes.DEALS_BACKFILL]: handleDealsBackfill,
  [JobTypes.EVENTS_BACKFILL]: handleEventsBackfill,
  [JobTypes.INSIDER_TRADES_BACKFILL]: handleInsiderTradesBackfill,
  [JobTypes.NEWS_BACKFILL]: handleNewsBackfill,
  [JobTypes.PRICE_BACKFILL]: handlePriceBackfill,
  [JobTypes.INDEX_PRICES_BACKFILL]: handleIndexBackfill,
  [JobTypes.EOD_PRICES_DAILY]: handleEodPricesDaily,
  [JobTypes.INDEX_PRICES_DAILY]: handleIndexPricesDaily,
  [JobTypes.DEALS_DAILY_INGEST]: handleDealsDailyIngest,
  [JobTypes.EVENTS_WEEKLY_INGEST]: handleEventsWeeklyIngest,
  [JobTypes.EVENTS_DAILY_REFRESH]: handleEventsDailyRefresh,
  [JobTypes.SHAREHOLDING_QUARTERLY]: handleShareholdingQuarterly,
  [JobTypes.SHAREHOLDING_SMART_REFRESH]: handleShareholdingSmartRefresh,
  [JobTypes.SHAREHOLDING_BACKFILL]: handleShareholdingBackfill,
  [JobTypes.INSIDER_TRADES_DAILY]: handleInsiderTradesDaily,
  [JobTypes.DAILY_NEWS_INGEST]: handleDailyNewsIngest,
  [JobTypes.NSE_ANNOUNCEMENTS_INGEST]: handleNseAnnouncementsIngest,
  [JobTypes.GOOGLE_NEWS_INGEST]: handleGoogleNewsIngest,
  [JobTypes.NEWS_CONTENT_EXTRACTION]: handleNewsContentExtraction,
  [JobTypes.PEER_METRICS_COMPUTE_ALL]: handlePeerMetricsComputeAll,
  [JobTypes.RESULTS_SCAN]: handleResultsScan,
  [JobTypes.LEGACY_BACKFILL]: handleLegacyBackfill,
  [JobTypes.PG_RESCORE]: handlePgRescore,
  [JobTypes.PG_CASCADE_RESCORE]: handlePgCascadeRescore,
  [JobTypes.FILL_CASCADE_RESCORE]: handleFillCascadeRescore,
  [JobTypes.PRICES_REFETCH]: handlePricesRefetch,
};

export function getHandler(type: string): JobHandler | null {
  return HANDLERS[type as JobType] ?? null;
}

export function getRegisteredTypes(): JobType[] {
  return Object.keys(HANDLERS) as JobType[];
}
