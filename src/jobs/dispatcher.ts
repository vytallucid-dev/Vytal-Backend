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
import { handleFilingRecompute, handleFilingRollingDaily, handleFilingBackfill } from "./handlers/filing-pass.handler.js";
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
import { handleInstrumentHistoryBackfill } from "./handlers/instrument-history-backfill.handler.js";
import {
  handleIndexPricesDaily,
  handleIndexBackfill,
} from "./handlers/index-ingest.handler.js";
import { handleAmfiNavDaily } from "./handlers/amfi-ingest.handler.js";
import { handleEtfNavDaily } from "./handlers/etf-ingest.handler.js";
import { handleReitDaily } from "./handlers/reit-ingest.handler.js";
import { handleEtfPricesDaily } from "./handlers/etf-prices.handler.js";
import { handleGovtSecuritiesDaily } from "./handlers/govt-securities.handler.js";
import { handleCorporateBondsDaily } from "./handlers/corporate-bonds.handler.js";
import { handleMfAnalyticsDaily } from "./handlers/mf-analytics.handler.js";
import { handleInstrumentCorporateActions } from "./handlers/instrument-corporate-actions.handler.js";
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
import { handleAlertsEvalDaily } from "./handlers/alerts-eval.handler.js";
import { handleAlertsDeliverDaily } from "./handlers/alerts-deliver.handler.js";
import { handleRemindersEvalDaily } from "./handlers/reminders-eval.handler.js";
import { handleRemindersDeliverDaily } from "./handlers/reminders-deliver.handler.js";
import { handleBrokerPollSync } from "./handlers/broker-poll-sync.handler.js";
import { handleRetentionPrune } from "./handlers/retention-prune.handler.js";
import { handleBehaviorRollupReconcile } from "./handlers/behavior-rollup-reconcile.handler.js";
import { handleBaseRatesWarm } from "./handlers/base-rates-warm.handler.js";
import { handleChatTitleGenerate } from "./handlers/chat-title-generate.handler.js";
import { handleChatProfileDistill } from "./handlers/chat-profile-distill.handler.js";
import { JobTypes, type JobType } from "./types.js";

export type JobHandler<TPayload = any, TResult = any> = (
  ctx: JobContext<TPayload>,
) => Promise<TResult>;

import { handleQuarterBrief } from "./handlers/quarter-brief.handler.js";

const HANDLERS: Record<JobType, JobHandler> = {
  // Backfill / one-off
  [JobTypes.DEALS_BACKFILL]: handleDealsBackfill,
  [JobTypes.EVENTS_BACKFILL]: handleEventsBackfill,
  [JobTypes.INSIDER_TRADES_BACKFILL]: handleInsiderTradesBackfill,
  [JobTypes.NEWS_BACKFILL]: handleNewsBackfill,
  [JobTypes.PRICE_BACKFILL]: handlePriceBackfill,
  [JobTypes.INDEX_PRICES_BACKFILL]: handleIndexBackfill,
  [JobTypes.INSTRUMENT_HISTORY_BACKFILL]: handleInstrumentHistoryBackfill,
  [JobTypes.EOD_PRICES_DAILY]: handleEodPricesDaily,
  [JobTypes.INDEX_PRICES_DAILY]: handleIndexPricesDaily,
  [JobTypes.AMFI_NAV_DAILY]: handleAmfiNavDaily,
  [JobTypes.ETF_NAV_DAILY]: handleEtfNavDaily,
  [JobTypes.REIT_DAILY]: handleReitDaily,
  [JobTypes.ETF_PRICES_DAILY]: handleEtfPricesDaily,
  [JobTypes.GOVT_SECURITIES_DAILY]: handleGovtSecuritiesDaily,
  [JobTypes.CORPORATE_BONDS_DAILY]: handleCorporateBondsDaily,
  [JobTypes.MF_ANALYTICS_DAILY]: handleMfAnalyticsDaily,
  [JobTypes.INSTRUMENT_CORPORATE_ACTIONS]: handleInstrumentCorporateActions,
  [JobTypes.DEALS_DAILY_INGEST]: handleDealsDailyIngest,
  [JobTypes.FILING_RECOMPUTE]: handleFilingRecompute,
  [JobTypes.FILING_ROLLING_DAILY]: handleFilingRollingDaily,
  [JobTypes.FILING_BACKFILL]: handleFilingBackfill,
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
  [JobTypes.QUARTER_BRIEF]: handleQuarterBrief as JobHandler,
  [JobTypes.LEGACY_BACKFILL]: handleLegacyBackfill,
  [JobTypes.PG_RESCORE]: handlePgRescore,
  [JobTypes.PG_CASCADE_RESCORE]: handlePgCascadeRescore,
  [JobTypes.FILL_CASCADE_RESCORE]: handleFillCascadeRescore,
  [JobTypes.PRICES_REFETCH]: handlePricesRefetch,
  [JobTypes.ALERTS_EVAL_DAILY]: handleAlertsEvalDaily,
  [JobTypes.ALERTS_DELIVER_DAILY]: handleAlertsDeliverDaily,
  [JobTypes.REMINDERS_EVAL_DAILY]: handleRemindersEvalDaily,
  [JobTypes.REMINDERS_DELIVER_DAILY]: handleRemindersDeliverDaily,
  [JobTypes.BROKER_POLL_SYNC]: handleBrokerPollSync,
  [JobTypes.RETENTION_PRUNE]: handleRetentionPrune,
  [JobTypes.BEHAVIOR_ROLLUP_RECONCILE]: handleBehaviorRollupReconcile,
  [JobTypes.BASE_RATES_WARM]: handleBaseRatesWarm,
  [JobTypes.CHAT_TITLE_GENERATE]: handleChatTitleGenerate,
  [JobTypes.CHAT_PROFILE_DISTILL]: handleChatProfileDistill,
};

export function getHandler(type: string): JobHandler | null {
  return HANDLERS[type as JobType] ?? null;
}

export function getRegisteredTypes(): JobType[] {
  return Object.keys(HANDLERS) as JobType[];
}
