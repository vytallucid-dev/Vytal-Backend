// ─────────────────────────────────────────────────────────────
// JOB TYPE REGISTRY
//
// Single source of truth for:
//   - job type identifiers (no magic strings)
//   - payload type per job type
//   - retry policies per job type
//
// Adding a new job type means:
//   1. Add a string here
//   2. Add a payload type here
//   3. Implement the handler in src/jobs/handlers/
//   4. Register the handler in src/jobs/dispatcher.ts
// ─────────────────────────────────────────────────────────────

export const JobTypes = {
  // ── Backfill / one-off jobs ────────────────────────────────
  DEALS_BACKFILL: "deals_backfill",
  EVENTS_BACKFILL: "events_backfill",
  INSIDER_TRADES_BACKFILL: "insider_trades_backfill",
  NEWS_BACKFILL: "news_backfill",
  PRICE_BACKFILL: "price_backfill",
  // Display-only index history backfill (sibling of PRICE_BACKFILL; NOT scored).
  INDEX_PRICES_BACKFILL: "index_prices_backfill",
  // ── Scheduled / recurring daily-operational jobs ───────────
  EOD_PRICES_DAILY: "eod_prices_daily",
  // Display-only daily index ingest (sibling of EOD_PRICES_DAILY; NOT scored —
  // not a switch arm in scoring-triggers.ts, so it never enqueues a PG rescore).
  INDEX_PRICES_DAILY: "index_prices_daily",
  DEALS_DAILY_INGEST: "deals_daily_ingest",
  EVENTS_WEEKLY_INGEST: "events_weekly_ingest",
  EVENTS_DAILY_REFRESH: "events_daily_refresh",
  SHAREHOLDING_QUARTERLY: "shareholding_quarterly",
  SHAREHOLDING_SMART_REFRESH: "shareholding_smart_refresh",
  SHAREHOLDING_BACKFILL: "shareholding_backfill",
  INSIDER_TRADES_DAILY: "insider_trades_daily",
  DAILY_NEWS_INGEST: "daily_news_ingest",
  NSE_ANNOUNCEMENTS_INGEST: "nse_announcements_ingest",
  GOOGLE_NEWS_INGEST: "google_news_ingest",
  NEWS_CONTENT_EXTRACTION: "news_content_extraction",
  PEER_METRICS_COMPUTE_ALL: "peer_metrics_compute_all",
  RESULTS_SCAN: "results_scan",
  LEGACY_BACKFILL: "legacy_backfill",
  // ── Event-driven scoring ───────────────────────────────────
  // Recompute one peer group's Health Scores (PG-scoped). Enqueued by the
  // scoring-trigger layer after an ingestion job lands new data (prices → all
  // scored PGs; fundamentals/shareholding → only the affected PGs). Idempotent:
  // unchanged inputs skip-identical (no write); genuine change supersedes.
  PG_RESCORE: "pg_rescore",
} as const;

export type JobType = (typeof JobTypes)[keyof typeof JobTypes];

// ── Payload types ────────────────────────────────────────────

export interface ScreenerBulkIngestPayload {
  /** Base64-encoded ZIP buffer */
  zipBase64: string;
  /** Original filename for audit */
  zipFilename: string;
  sectorId?: string;
  concurrency?: number;
}

export interface DealsBackfillPayload {
  days: number;
}

export interface EventsBackfillPayload {
  days: number;
}

export interface InsiderTradesBackfillPayload {
  /** ISO date string e.g. "2025-01-01" */
  fromDate: string;
  toDate: string;
}

export interface DailyNewsIngestPayload {
  // no params — always fetches today's news
}

export interface NseAnnouncementsIngestPayload {
  days: number;
}

export interface GoogleNewsIngestPayload {
  days: number;
}

export interface NewsContentExtractionPayload {
  batchSize: number;
}

export interface NewsBackfillPayload {
  days: number;
}

export interface PeerMetricsComputeAllPayload {
  // no params — always computes all groups
}

export interface QuarterlyResultsScanPayload {
  hoursBack: number;
  dryRun: boolean;
  symbols?: string[];
}

export interface ResultsScanPayload {
  /**
   * "universe" — scan all active stocks (cron default)
   * "symbol"   — scan a single symbol (admin / alert)
   * "backfill" — full backfill since fromQeDate (manual)
   */
  mode: "universe" | "symbol" | "backfill";
  /** Required when mode="symbol". */
  symbol?: string;
  /** Required when mode="backfill". ISO date string. */
  fromQeDate?: string;
  /** Optional: filter to specific industries. */
  industries?: (
    | "non_financial"
    | "banking"
    | "nbfc"
    | "life_insurance"
    | "general_insurance"
  )[];
  /** Optional: cap on universe scans for testing. */
  limit?: number;
  /** Optional: hours-back filter for incremental universe scans. */
  hoursBack?: number;
}

export interface LegacyBackfillPayload {
  /**
   * "universe" — backfill all active stocks
   * "symbol"   — backfill a single symbol
   */
  mode: "universe" | "symbol";
  /** Required when mode="symbol". */
  symbol?: string;
  /** ISO date string. Only process filings with quarter-end >= fromDate. */
  fromDate?: string;
  /** ISO date string. Only process filings with quarter-end <= toDate. */
  toDate?: string;
  /** Filter by industry type. Omit for all. */
  industries?: (
    | "non_financial"
    | "banking"
    | "nbfc"
    | "life_insurance"
    | "general_insurance"
  )[];
  /** Cap the number of symbols. Useful for test runs. */
  limit?: number;
}

export interface QuarterlyBackfillUniversePayload {
  quarters: number;
  dryRun: boolean;
}

export interface PriceBackfillPayload {
  days: number;
}

export interface IndexBackfillPayload {
  days: number;
}

export interface IndexPricesDailyPayload {}

export interface PgRescorePayload {
  /** Logical PG id used as the bar-derivation path / scoring key, e.g. "PG5".
   *  NOT the DB peer_groups.id (a uuid). */
  pgId: string;
  /** DB peer_groups.name — computePgScores resolves the live roster by this. Must
   *  match the seed `name` verbatim (see scoring/composite/pg-registry.ts). */
  pgName: string;
  /** Seed key carried for PgRef completeness, e.g. "pg5_private_banks". */
  seedKey: string;
  /** Trigger source: the completed job type that caused this rescore (e.g.
   *  "eod_prices_daily"), or "manual" / "admin" for an operator-issued rescore. */
  triggeredBy: string;
  /** Optional human-readable reason for the audit trail. */
  reason?: string;
}

// ── Daily operational payloads (no config — always "today") ──

export interface EodPricesDailyPayload {}
export interface DealsDailyIngestPayload {}
export interface EventsWeeklyIngestPayload {}
export interface EventsDailyRefreshPayload {}
export interface ShareholdingQuarterlyPayload {}
export interface ShareholdingSmartRefreshPayload {}
export interface ShareholdingBackfillPayload {
  quartersBack: number;
}
export interface InsiderTradesDailyPayload {}

// Discriminated union — every payload tagged by its job type
export type JobPayload =
  | { type: typeof JobTypes.DEALS_BACKFILL; data: DealsBackfillPayload }
  | { type: typeof JobTypes.EVENTS_BACKFILL; data: EventsBackfillPayload }
  | {
      type: typeof JobTypes.INSIDER_TRADES_BACKFILL;
      data: InsiderTradesBackfillPayload;
    }
  | { type: typeof JobTypes.NEWS_BACKFILL; data: NewsBackfillPayload }
  | { type: typeof JobTypes.PRICE_BACKFILL; data: PriceBackfillPayload }
  | { type: typeof JobTypes.INDEX_PRICES_BACKFILL; data: IndexBackfillPayload }
  | { type: typeof JobTypes.EOD_PRICES_DAILY; data: EodPricesDailyPayload }
  | { type: typeof JobTypes.INDEX_PRICES_DAILY; data: IndexPricesDailyPayload }
  | { type: typeof JobTypes.DEALS_DAILY_INGEST; data: DealsDailyIngestPayload }
  | {
      type: typeof JobTypes.EVENTS_WEEKLY_INGEST;
      data: EventsWeeklyIngestPayload;
    }
  | {
      type: typeof JobTypes.EVENTS_DAILY_REFRESH;
      data: EventsDailyRefreshPayload;
    }
  | {
      type: typeof JobTypes.SHAREHOLDING_QUARTERLY;
      data: ShareholdingQuarterlyPayload;
    }
  | {
      type: typeof JobTypes.SHAREHOLDING_SMART_REFRESH;
      data: ShareholdingSmartRefreshPayload;
    }
  | {
      type: typeof JobTypes.SHAREHOLDING_BACKFILL;
      data: ShareholdingBackfillPayload;
    }
  | {
      type: typeof JobTypes.INSIDER_TRADES_DAILY;
      data: InsiderTradesDailyPayload;
    }
  | { type: typeof JobTypes.DAILY_NEWS_INGEST; data: DailyNewsIngestPayload }
  | {
      type: typeof JobTypes.NSE_ANNOUNCEMENTS_INGEST;
      data: NseAnnouncementsIngestPayload;
    }
  | { type: typeof JobTypes.GOOGLE_NEWS_INGEST; data: GoogleNewsIngestPayload }
  | {
      type: typeof JobTypes.NEWS_CONTENT_EXTRACTION;
      data: NewsContentExtractionPayload;
    }
  | {
      type: typeof JobTypes.PEER_METRICS_COMPUTE_ALL;
      data: PeerMetricsComputeAllPayload;
    }
  | { type: typeof JobTypes.RESULTS_SCAN; data: ResultsScanPayload }
  | { type: typeof JobTypes.LEGACY_BACKFILL; data: LegacyBackfillPayload }
  | { type: typeof JobTypes.PG_RESCORE; data: PgRescorePayload };

// ── Retry policy per job type ────────────────────────────────
// Conservative defaults. Most ingest jobs should NOT auto-retry —
// the second attempt usually does the same thing as the first.
// Network-bound jobs that talk to NSE benefit from one retry on
// transient failures.

export interface RetryPolicy {
  maxAttempts: number;
}

export const RETRY_POLICIES: Record<JobType, RetryPolicy> = {
  [JobTypes.DEALS_BACKFILL]: { maxAttempts: 1 }, // idempotent but wasteful to re-run
  [JobTypes.EVENTS_BACKFILL]: { maxAttempts: 1 },
  [JobTypes.INSIDER_TRADES_BACKFILL]: { maxAttempts: 1 },
  [JobTypes.NEWS_BACKFILL]: { maxAttempts: 1 }, // large batch — avoid double-fetch
  [JobTypes.PRICE_BACKFILL]: { maxAttempts: 1 },
  [JobTypes.INDEX_PRICES_BACKFILL]: { maxAttempts: 1 }, // display-only; idempotent but wasteful to re-run
  // Daily operational — network-bound NSE/external calls; one retry on transient failure
  [JobTypes.EOD_PRICES_DAILY]: { maxAttempts: 2 },
  [JobTypes.INDEX_PRICES_DAILY]: { maxAttempts: 2 }, // network-bound NSE archive fetch

  [JobTypes.DEALS_DAILY_INGEST]: { maxAttempts: 2 },
  [JobTypes.EVENTS_WEEKLY_INGEST]: { maxAttempts: 2 },
  [JobTypes.EVENTS_DAILY_REFRESH]: { maxAttempts: 2 },
  [JobTypes.SHAREHOLDING_QUARTERLY]: { maxAttempts: 2 },
  [JobTypes.SHAREHOLDING_SMART_REFRESH]: { maxAttempts: 2 },
  [JobTypes.SHAREHOLDING_BACKFILL]: { maxAttempts: 1 }, // very long — never auto-retry
  [JobTypes.INSIDER_TRADES_DAILY]: { maxAttempts: 2 },
  [JobTypes.DAILY_NEWS_INGEST]: { maxAttempts: 2 },
  [JobTypes.NSE_ANNOUNCEMENTS_INGEST]: { maxAttempts: 2 },
  [JobTypes.GOOGLE_NEWS_INGEST]: { maxAttempts: 2 },
  [JobTypes.NEWS_CONTENT_EXTRACTION]: { maxAttempts: 2 },
  [JobTypes.PEER_METRICS_COMPUTE_ALL]: { maxAttempts: 1 }, // pure computation — wasteful to retry
  // v3 results scan — NSE 5xx is transient; 3 attempts clears most failures
  [JobTypes.RESULTS_SCAN]: { maxAttempts: 3 },
  // Legacy backfill — manual, network-bound; 3 attempts for transient NSE failures
  [JobTypes.LEGACY_BACKFILL]: { maxAttempts: 3 },
  // PG rescore — DB-only, idempotent (fingerprint + append-only supersede). The whole
  // per-PG write is one transaction, so a retry after a transient DB error re-runs
  // cleanly (rolled-back partial → nothing to undo). 2 attempts.
  [JobTypes.PG_RESCORE]: { maxAttempts: 2 },
};

// ── Job status constants ────────────────────────────────────

export const JobStatus = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
  ABANDONED: "abandoned",
} as const;

export type JobStatusValue = (typeof JobStatus)[keyof typeof JobStatus];
