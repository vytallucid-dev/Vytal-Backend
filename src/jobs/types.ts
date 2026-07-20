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
  // WEEKLY CHART SERIES for HELD non-stock instruments (Step 21). single { instrumentId } on first
  // hold; refresh_all_held is the weekly cron. Idempotent (ON CONFLICT + rolling-window trigger).
  // Held-NOT-scored: not a switch arm in scoring-triggers.ts → never enqueues a rescore.
  INSTRUMENT_HISTORY_BACKFILL: "instrument_history_backfill",
  // ── Scheduled / recurring daily-operational jobs ───────────
  EOD_PRICES_DAILY: "eod_prices_daily",
  // Display-only daily index ingest (sibling of EOD_PRICES_DAILY; NOT scored —
  // not a switch arm in scoring-triggers.ts, so it never enqueues a PG rescore).
  INDEX_PRICES_DAILY: "index_prices_daily",
  // AMFI mutual-fund identity + current NAV (Step 9). ONE file → the whole MF universe.
  // Held-NOT-scored: not a switch arm in scoring-triggers.ts, so it never enqueues a rescore.
  AMFI_NAV_DAILY: "amfi_nav_daily",
  // ETF identity + current NAV (Step 13). THE SAME AMFI FILE, the 4 ETF sections Step 9 excluded,
  // plus the NSE ticker joined in by ISIN. Separate job (not a flag on AMFI_NAV_DAILY) so the two
  // passes fail, retry, log and get triaged independently: an NSE outage must never be able to
  // take the MF universe's nightly NAV refresh down with it.
  // Held-NOT-scored: not a switch arm in scoring-triggers.ts, so it never enqueues a rescore.
  ETF_NAV_DAILY: "etf_nav_daily",
  // REIT/InvIT identity + PRICE + distribution yield (Step 14). The NSE udiff BhavCopy (series
  // RR/IV) — the one NSE file that carries ISIN, series and close together, so a trust joins the
  // catalogue on the ISIN spine with no symbol-matching.
  //
  // UNLIKE the fund jobs, this one MUST run daily for a reason beyond freshness: a trust TRADES,
  // so `instrument_prices` gets a new close every session. A REIT whose price is a week old is a
  // REIT rendering a lie.
  // Held-NOT-scored: not a switch arm in scoring-triggers.ts, so it never enqueues a rescore.
  REIT_DAILY: "reit_daily",
  // ETF MARKET PRICES (Step 14.5) — the TRADED close of a listed fund, from the EQ-series rows of
  // the SAME udiff BhavCopy the trust lane reads. Step 13 gave every ETF a NAV; a NAV is what a
  // unit is WORTH, not what you can SELL it for, and a listed ETF trades at a premium/discount to
  // it. This job is what lets a held ETF be valued at a number the user could actually transact at.
  //
  // A SEPARATE job from REIT_DAILY (not a flag on it) for the same reason ETF_NAV_DAILY is separate
  // from AMFI_NAV_DAILY: the two must fail, retry and get triaged independently. An ETF pricing
  // problem must never be able to take REIT/InvIT IDENTITY down with it.
  // Held-NOT-scored: not a switch arm in scoring-triggers.ts, so it never enqueues a rescore.
  ETF_PRICES_DAILY: "etf_prices_daily",
  // GOVERNMENT SECURITIES (Step 15) — G-secs, T-bills, SDLs and Sovereign Gold Bonds, from the
  // SAME udiff BhavCopy (series GS / TB / SG / GB). Identity-only tier: no detail page, no
  // analytics, no yield curve — but they all TRADE, so they carry a real close and value correctly
  // through the instrument_prices lane with no read-path change at all.
  //
  // The series ALLOW-LIST is the fence that keeps this out of the corporate-bond step: the same
  // file carries ~40 corporate debt series, and every one is excluded by construction.
  // Held-NOT-scored: not a switch arm in scoring-triggers.ts, so it never enqueues a rescore.
  GOVT_SECURITIES_DAILY: "govt_securities_daily",
  // CORPORATE BONDS (Step 17) — NCDs, debentures, municipal green bonds. Identity + price, no
  // detail page, no analytics. The fence is NOT a series list (a series is a TRADING BOARD, not an
  // instrument type — fencing on it admits equity: the BL block-deal board carries BAYERCROP). It is
  // the ISIN's own security-type code, via ingestions/shared/isin-class.ts — the same module the
  // broker resolver uses to decide what an unknown holding is.
  // Held-NOT-scored: not a switch arm in scoring-triggers.ts, so it never enqueues a rescore.
  CORPORATE_BONDS_DAILY: "corporate_bonds_daily",
  // MF ANALYTICS (Step 10+11, Option B) — COMPUTE-AND-DISCARD. Streams the universe's 5-year
  // NAV history, folds it into per-scheme accumulators in memory, writes ~13,704 small rows of
  // derived analytics, and throws every raw NAV away. There is deliberately NO NAV-history
  // table: a persistent one measured ~26 M rows / ~2.5 GB against a 500 MB ceiling.
  // Held-NOT-scored: not a switch arm in scoring-triggers.ts → never enqueues a rescore.
  MF_ANALYTICS_DAILY: "mf_analytics_daily",
  // (REMOVED: MF_INCEPTION_WALK — the one-time earliest-NAV walk. It fed ret_since_earliest_cagr,
  // which was dropped: AMFI's raw NAV is neither split-adjusted nor total-return, so a span reaching
  // back to ~2009 is the WORST case for both corruptions and cannot be made correct from any source
  // we have. The walk, its handler, its anchors and its column are all gone.)
  // STEP 19 — ETF UNIT SPLITS, from NSE's real corporate actions.
  //
  // AMFI's NAV history is RAW: an ETF that sub-divides 1:10 has its NAV step down 90% overnight,
  // and everything folded from that series (returns AND vol/Sharpe/drawdown/beta/alpha) believes
  // the fund lost 90% in a day. This job stores the REAL, DATED split so the fold can rescale the
  // series before it computes anything.
  //
  // MUST RUN BEFORE MF_ANALYTICS_DAILY — the fold reads what this writes. See scheduler.ts.
  // Held-NOT-scored: not a switch arm in scoring-triggers.ts → never enqueues a rescore.
  INSTRUMENT_CORPORATE_ACTIONS: "instrument_corporate_actions",
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
  // CASA forward-cascade self-heal. Enqueued by the CASA admin write when a PAST
  // quarter is edited: PIT-rescore the bank's PG for [editedPeriod .. current],
  // live-rescore the current period (Option-1 split). A current-period edit degrades
  // to a single live rescore (no backward cascade). Idempotent (skip-identical).
  PG_CASCADE_RESCORE: "pg_cascade_rescore",
  // General fill forward-cascade self-heal. Enqueued by the raw-field fill write
  // (applyRawFieldEdit) when a PAST fundamentals/shareholding period is corrected:
  // re-derive runs on the edited row first, then rescore the stock's scored PG(s)
  // for [editedPeriod .. current] — PIT historical + live current (Option-1),
  // PG-type-agnostic (the banking cascade generalized). Idempotent (skip-identical).
  FILL_CASCADE_RESCORE: "fill_cascade_rescore",
  // Re-fetch the EOD bhavcopy for ONE date (the async wrap of the synchronous
  // runEodPriceIngest) — the "re-fetch the feed for this date" resolution action
  // offered alongside a manual price fill. Idempotent (upsert/skip-duplicates).
  PRICES_REFETCH: "prices_refetch",
  // ── User-created alerts: daily evaluation pass ─────────────
  // One pass over every ACTIVE user alert (price / health_band / finding): evaluate the
  // condition against current computed data, RECORD fires into alert_events, flip
  // (active, armed). Sends NOTHING (email is a later stage). Hung on the daily EOD cycle,
  // scheduled AFTER the EOD-price → PG-rescore cascade so band/findings reflect the day's
  // rescore. Read-only over computed data; idempotent (still-true condition = no-op).
  ALERTS_EVAL_DAILY: "alerts_eval_daily",
  // ── User-created alerts: daily email drain ─────────────────
  // Drains alert_events WHERE delivered=false: render + send each via Resend, flip
  // delivered=true on success. Scheduled just AFTER ALERTS_EVAL_DAILY so tonight's fires go
  // out tonight; drains the whole undelivered backlog, so it also retries prior failures.
  // Idempotent (delivered flag is the guard); a failed send is left for the next run.
  ALERTS_DELIVER_DAILY: "alerts_deliver_daily",
  // ── Event reminders: daily evaluation pass ─────────────────
  // One pass over every ACTIVE reminder: re-resolve the stock's nearest upcoming event of the
  // reminder's type (follows reschedules), fire (record an event_reminder_event) when today is
  // in the lead window, dedupe per occurrence. Sends NOTHING. Runs EVERY DAY (date-based
  // reminders must fire on weekends too, unlike price-driven alerts).
  REMINDERS_EVAL_DAILY: "reminders_eval_daily",
  // ── Event reminders: daily email drain ─────────────────────
  // Drains event_reminder_events WHERE delivered=false via the SAME Resend mailer alerts use.
  // Scheduled just AFTER REMINDERS_EVAL_DAILY; drains the whole backlog so it also retries
  // prior failures. Idempotent (delivered guard). Runs every day.
  REMINDERS_DELIVER_DAILY: "reminders_deliver_daily",
  // ── Broker auto-poll (Step 7) ──────────────────────────────
  // ONE sweep job per firing (not one per connection): it syncs every connection that is
  // enabled=true AND session_state='live' AND whose lastSyncedAt is older than the 2h cadence.
  // The cadence lives in that FILTER, not in per-connection timers — so the sweep self-dedups
  // (a connection synced 10 min ago is simply not selected), self-heals after downtime (a
  // connection missed for 6h is picked up on the next firing), and needs no scheduling state.
  // A DEAD session is not in the filter ⇒ it is not polled — and it is NEVER severed for it
  // (§2.5: token death is routine; the account stays linked_live and the user reconnects).
  BROKER_POLL_SYNC: "broker_poll_sync",
  // ── Retention pruner (config-driven, floored, dry-run-gated) ───
  // Reads the `retention_policy` table and prunes each managed table to its
  // configured window/depth, clamped UP to the per-table floor so it can never
  // delete below what scoring needs. Deletes production data irreversibly, so the
  // payload carries an explicit `dryRun` and the engine defaults to counting-only.
  // The cron passes dryRun:false ONLY after the first dry-run report is signed off.
  RETENTION_PRUNE: "retention_prune",
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

export interface InstrumentHistoryBackfillPayload {
  /** SINGLE mode — the one instrument to backfill (on first hold). */
  instrumentId?: string;
  /** REFRESH mode — omit instrumentId and set this to sweep the whole held non-stock book. */
  mode?: "single" | "refresh_all_held";
}

export interface PricesRefetchPayload {
  /** The trading date to re-fetch, ISO "YYYY-MM-DD". */
  dateIso: string;
  triggeredBy: string;
  reason?: string;
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

export interface PgCascadeRescorePayload {
  /** Logical PG id of the edited bank's peer group ("PG5" / "PG6"). */
  pgId: string;
  /** DB peer_groups.name (computePgScores resolves the roster by this). */
  pgName: string;
  /** Seed key for PgRef completeness ("pg5_private_banks"). */
  seedKey: string;
  /** The bank whose CASA was edited (the cascade trigger). */
  symbol: string;
  /** The edited period "FYxxQn" (e.g. "FY26Q2") — the cascade start; the handler
   *  determines the current period and builds [editedPeriod .. current]. */
  editedPeriod: string;
  /** Trigger source ("hook:casa_inject" / "manual"). */
  triggeredBy: string;
  /** Optional human-readable reason for the audit trail. */
  reason?: string;
}

export interface FillCascadeRescorePayload {
  /** The stock whose raw field was corrected (the cascade trigger). */
  symbol: string;
  /** Edited-period shape: annual rows map to a start quarter via reportDate;
   *  quarterly rows carry their own FYxxQy key. Stored JSON-serialisable. */
  editKind: "annual" | "quarter";
  /** ISO string when editKind="annual". */
  editReportDateIso?: string;
  /** FYxxQy key when editKind="quarter". */
  editPeriodKey?: string;
  /** Trigger source ("fill:<admin>"). */
  triggeredBy: string;
  /** Optional human-readable reason for the audit trail. */
  reason?: string;
  /** Test-only: persist the cascade in rolled-back txns (never set in production). */
  dryRun?: boolean;
}

// ── Daily operational payloads (no config — always "today") ──

export interface EodPricesDailyPayload {}
/** AMFI ingest takes no input — the file IS the worklist (one URL, whole universe). */
export interface AmfiNavDailyPayload {}
/** ETF ingest takes no input either — the same file, the complementary sections. */
export interface EtfNavDailyPayload {}
export interface ReitDailyPayload {}
export interface EtfPricesDailyPayload {}
export interface GovtSecuritiesDailyPayload {}
/** Corporate bonds take no input either — the same file, fenced on the ISIN. */
export interface CorporateBondsDailyPayload {}
/** The analytics fold takes no input — the catalogue IS the worklist, the window is derived. */
export interface MfAnalyticsDailyPayload {}
/** ETF corporate actions. No input: the NSE-listed fund catalogue IS the worklist. `symbols`
 *  narrows it for a targeted re-pull (one ETF just announced a split) or a verification run. */
export interface InstrumentCorporateActionsPayload {
  symbols?: string[];
}
export interface AlertsEvalDailyPayload {}
export interface AlertsDeliverDailyPayload {}
export interface RemindersEvalDailyPayload {}

/** The broker poll sweep takes no input — it derives its worklist from the connections table.
 *  `staleAfterMinutes` exists only so a harness can force the sweep to consider a just-synced
 *  connection without waiting two hours. Defaults to the 2h cadence. */
export interface BrokerPollSyncPayload {
  staleAfterMinutes?: number;
}

/** Retention pruner. `dryRun` MUST be explicit — there is no safe default at the
 *  payload layer for a job that deletes production data. The cron and every manual
 *  trigger pass it deliberately. */
export interface RetentionPrunePayload {
  dryRun: boolean;
}
export interface RemindersDeliverDailyPayload {}
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
  | { type: typeof JobTypes.INSTRUMENT_HISTORY_BACKFILL; data: InstrumentHistoryBackfillPayload }
  | { type: typeof JobTypes.EOD_PRICES_DAILY; data: EodPricesDailyPayload }
  | { type: typeof JobTypes.INDEX_PRICES_DAILY; data: IndexPricesDailyPayload }
  | { type: typeof JobTypes.AMFI_NAV_DAILY; data: AmfiNavDailyPayload }
  | { type: typeof JobTypes.ETF_NAV_DAILY; data: EtfNavDailyPayload }
  | { type: typeof JobTypes.REIT_DAILY; data: ReitDailyPayload }
  | { type: typeof JobTypes.ETF_PRICES_DAILY; data: EtfPricesDailyPayload }
  | { type: typeof JobTypes.GOVT_SECURITIES_DAILY; data: GovtSecuritiesDailyPayload }
  | { type: typeof JobTypes.CORPORATE_BONDS_DAILY; data: CorporateBondsDailyPayload }
  | { type: typeof JobTypes.MF_ANALYTICS_DAILY; data: MfAnalyticsDailyPayload }
  | { type: typeof JobTypes.INSTRUMENT_CORPORATE_ACTIONS; data: InstrumentCorporateActionsPayload }
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
  | { type: typeof JobTypes.PG_RESCORE; data: PgRescorePayload }
  | { type: typeof JobTypes.PG_CASCADE_RESCORE; data: PgCascadeRescorePayload }
  | { type: typeof JobTypes.FILL_CASCADE_RESCORE; data: FillCascadeRescorePayload }
  | { type: typeof JobTypes.PRICES_REFETCH; data: PricesRefetchPayload }
  | { type: typeof JobTypes.ALERTS_EVAL_DAILY; data: AlertsEvalDailyPayload }
  | { type: typeof JobTypes.ALERTS_DELIVER_DAILY; data: AlertsDeliverDailyPayload }
  | { type: typeof JobTypes.REMINDERS_EVAL_DAILY; data: RemindersEvalDailyPayload }
  | { type: typeof JobTypes.BROKER_POLL_SYNC; data: BrokerPollSyncPayload }
  | { type: typeof JobTypes.RETENTION_PRUNE; data: RetentionPrunePayload }
  | { type: typeof JobTypes.REMINDERS_DELIVER_DAILY; data: RemindersDeliverDailyPayload };

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
  [JobTypes.INSTRUMENT_HISTORY_BACKFILL]: { maxAttempts: 2 }, // idempotent → one retry for a transient mfapi/udiff blip
  // Daily operational — network-bound NSE/external calls; one retry on transient failure
  [JobTypes.EOD_PRICES_DAILY]: { maxAttempts: 2 },
  [JobTypes.INDEX_PRICES_DAILY]: { maxAttempts: 2 }, // network-bound NSE archive fetch

  // AMFI — network-bound single-file fetch; idempotent (upsert on the ISIN spine). One retry.
  [JobTypes.AMFI_NAV_DAILY]: { maxAttempts: 2 },
  // ETF — the same AMFI fetch plus the NSE ticker join; idempotent on the same spine. One retry.
  // The NSE leg cannot fail the job (it degrades to carry-forward), so a retry here is only ever
  // about AMFI itself — same risk profile as AMFI_NAV_DAILY.
  [JobTypes.ETF_NAV_DAILY]: { maxAttempts: 2 },
  // REIT/InvIT — one zip fetch, then 17 polite per-symbol corporate-action calls. The yield leg
  // cannot fail the job (it degrades to an honest NULL per trust), so a retry here is only ever
  // about the BhavCopy itself: a transient NSE blip, worth exactly one more attempt.
  [JobTypes.REIT_DAILY]: { maxAttempts: 2 },
  // ETF prices — one zip fetch, an ISIN join, two writes. Idempotent (append-only history +
  // forward-only snapshot), so a retry is free. Same transient-NSE-blip risk profile as the trust lane.
  [JobTypes.ETF_PRICES_DAILY]: { maxAttempts: 2 },
  // Government securities — one zip fetch per session, an allow-list filter, two idempotent writes.
  // Same transient-NSE-blip risk profile as the other two udiff lanes.
  [JobTypes.GOVT_SECURITIES_DAILY]: { maxAttempts: 2 },
  // Corporate bonds — one zip fetch per session, an ISIN-keyed fence, two idempotent writes.
  // Same transient-NSE-blip risk profile as the other udiff lanes.
  [JobTypes.CORPORATE_BONDS_DAILY]: { maxAttempts: 2 },
  // MF analytics — ~21 network windows over ~12 min, then a pure in-memory fold. Idempotent
  // (upsert on scheme_code; a re-run recomputes the same numbers from the same source). The
  // write barrier sits AFTER every window, so a mid-run failure wrote nothing and a retry starts
  // clean rather than resuming a half-written table. One retry.
  [JobTypes.MF_ANALYTICS_DAILY]: { maxAttempts: 2 },
  // ETF corporate actions — 327 light NSE calls. Idempotent (NOT-NULL instrument_id + a real unique
  // key, so a re-run collides and updates in place). Retry once: a transient NSE blip must not leave
  // tonight's fold rescaling from a stale split table.
  [JobTypes.INSTRUMENT_CORPORATE_ACTIONS]: { maxAttempts: 2 },
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
  // CASA cascade — DB-only, idempotent (each period skip-identical when unchanged). A
  // retry re-runs the whole [edited..current] range cleanly; already-applied periods
  // skip-identical, so a partial cascade self-completes on retry. 2 attempts.
  [JobTypes.PG_CASCADE_RESCORE]: { maxAttempts: 2 },
  // General fill cascade — DB-only, idempotent (skip-identical per period/member).
  // A retry re-runs the whole [edited..current] range cleanly; done periods
  // skip-identical, so a partial cascade self-completes on retry. 2 attempts.
  [JobTypes.FILL_CASCADE_RESCORE]: { maxAttempts: 2 },
  // Prices re-fetch — network-bound NSE bhavcopy fetch; idempotent (upsert). 2 attempts.
  [JobTypes.PRICES_REFETCH]: { maxAttempts: 2 },
  // Alerts eval — DB-only, idempotent (fire-once via the armed flag; a still-true
  // condition is a no-op). A retry after a transient DB error re-runs cleanly (each fire
  // is its own transaction; already-fired alerts are disarmed → skipped). 2 attempts.
  [JobTypes.ALERTS_EVAL_DAILY]: { maxAttempts: 2 },
  // Alerts deliver — the email drain. Idempotent (delivered=true guard; a re-run over an
  // already-drained log sends zero, and the per-event Resend Idempotency-Key covers the
  // send→flip crash window). A retry re-drains cleanly: sent events are skipped, only the
  // still-undelivered (previously-failed) ones are re-attempted. 2 attempts.
  [JobTypes.ALERTS_DELIVER_DAILY]: { maxAttempts: 2 },
  // Reminders eval — DB-only, idempotent (dedupe on resolvedEventDate; the DB unique is the
  // race backstop). A retry after a transient DB error re-runs cleanly (already-fired
  // occurrences dedupe → skipped). 2 attempts.
  [JobTypes.REMINDERS_EVAL_DAILY]: { maxAttempts: 2 },
  // Reminders deliver — the email drain, same shape/guarantees as ALERTS_DELIVER_DAILY
  // (delivered=true guard + per-event Idempotency-Key). 2 attempts.
  [JobTypes.REMINDERS_DELIVER_DAILY]: { maxAttempts: 2 },
  // A failed poll must NOT retry: the next sweep is 30 minutes away and will pick up exactly the
  // same connections (the filter is stateless). Retrying would only double-hit the broker's API.
  [JobTypes.BROKER_POLL_SYNC]: { maxAttempts: 1 },
  // Retention prune — DELETES production data. NEVER auto-retry: a retry after a
  // partial failure re-scans a table that was already partly pruned, and while each
  // delete is idempotent, re-running is wasteful and muddies the audit. One attempt;
  // a failure is surfaced and re-run deliberately on the next nightly tick.
  [JobTypes.RETENTION_PRUNE]: { maxAttempts: 1 },
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
