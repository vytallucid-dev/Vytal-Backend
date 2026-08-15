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
  QUARTER_BRIEF: "quarter_brief",
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
  // ── Behaviour rollup reconcile (Phase 1) ───────────────────────
  // Nightly: recompute the distributional JSON (tabCounts / sectionExpandCounts) on behavior_rollup
  // from the raw attention_events, and back-fill/advance the safe stamps. Bounded by rollup size, not
  // traffic. Cumulative scalar counters (viewCount) stay on-write authoritative — see the handler for
  // why recompute-from-scratch would undercount once the 60-day attention prune arms.
  BEHAVIOR_ROLLUP_RECONCILE: "behavior_rollup_reconcile",
  // ── Relational L4 base rates (§3.5.1) ──────────────────────────
  // Nightly warm of the in-memory universe base-rate cache (how often each patternKey fires across the
  // in-force head snapshots). NO TABLE: every number is derived and recoverable by re-running the same
  // aggregate, so this job only spares the first reader of the day the cost. Safe to skip.
  BASE_RATES_WARM: "base_rates_warm",
  // ── Chat title generation (Stage 2) ────────────────────────────
  // ENQUEUED ON DEMAND (not a cron) after a CHAT-PAGE session's first exchange: a tiny model call writes
  // a 4–6 word title, replacing the provisional (truncated-first-message) title. NEVER overwrites a
  // titleSource='user' rename (checked before AND race-safely at the write). ⚠ On the free tier this
  // costs a FULL quota unit (the cap counts calls, not tokens) — acceptable for now.
  CHAT_TITLE_GENERATE: "chat_title_generate",
  CHAT_PROFILE_DISTILL: "chat_profile_distill",
  // ── The filing pass (step 6) ─────────────────────────────
  // FILING_RECOMPUTE — ENQUEUED BY THE WORKER HOOK, never by a cron. Recomputes the rules ONE ingestion
  // moved, for the stocks in THAT batch. Filing-keyed by construction: the payload carries the feeds
  // and the symbols, and both come from the ingestion result that triggered it.
  FILING_RECOMPUTE: "filing_recompute",
  // FILING_ROLLING_DAILY — the ONE clock-keyed exception, and it is a narrow one. P6 and H evaluate a
  // trailing 90-day window, so they can stop being true with NO new data: yesterday's deal leaves the
  // window tomorrow whether or not anything is ingested. Everything else in the pass is filing-keyed.
  FILING_ROLLING_DAILY: "filing_rolling_daily",
  // FILING_BACKFILL — all 22 rules, all 504 stocks. THE STANDING LAW (src/scoring/findings/rules/
  // BACKFILL-LAW.md): any change to a rule's logic or constants requires this, because a
  // filing-triggered row freezes until the next filing — up to eleven months for an annual rule.
  FILING_BACKFILL: "filing_backfill",
  // ── The daily operations health check (Part 3) ─────────────
  // Reads job history + the scheduler's own registry and answers, from data: which crons did
  // not fire in their window, what is stuck, which retention rules are erroring, which types
  // have gone silent, and the abandonment/reclaim rate per type. READ-ONLY over every table it
  // touches; its own job `result` IS the persisted report (no new table — see health/check.ts).
  JOB_HEALTH_CHECK: "job_health_check",
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

/** ONE (stock, quarter). Deliberately per-stock rather than a batch: a batch would collapse sixty
 *  different refusal reasons into one errorMessage, and 4b-5 needs them distinguishable. Restart
 *  safety comes from the fingerprint instead — a re-run skips anything already written, free. */
export interface QuarterBriefPayload {
  symbol: string;
  /** "FY27Q1". Omitted ⇒ the newest quarter on file. */
  periodKey?: string;
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
  /**
   * Discovery window width, in hours, for mode="universe" + discovery="ranged".
   *
   * ⚠ THIS FIELD EXISTED AND WAS DEAD. The cron passed `hoursBack: 6`; the handler destructured it
   *   and echoed it into the job result without ever passing it to the scanner, so every run
   *   re-read every symbol's ENTIRE filing history. It is live now. Omitted ⇒
   *   DEFAULT_DISCOVERY_WINDOW_HOURS (72).
   */
  hoursBack?: number;
  /**
   * How the universe scan finds work. Ignored for mode="symbol" (always per-symbol).
   *
   *   "ranged"     — ONE windowed, all-companies call to integrated-filing-results, filtered to the
   *                  active universe before any XBRL fetch. The recurring-cron path.
   *   "per_symbol" — one call per symbol, returning that symbol's whole history. Kept as the
   *                  fallback: use it if ranged discovery returns empty or the endpoint changes
   *                  shape, and for a deliberate full re-sweep.
   *
   * Default for mode="universe" is "ranged". mode="backfill" always uses "per_symbol" — a backfill
   * is explicitly asking for history, which a window cannot serve.
   */
  discovery?: "ranged" | "per_symbol";
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
/** Behaviour rollup reconcile — no input; the whole attention_events table IS the worklist. */
export interface BehaviorRollupReconcilePayload {}
/** Base-rate warm — no input; the whole in-force snapshot set IS the worklist. */
export interface BaseRatesWarmPayload {}
/** Filing recompute — the SCOPE, carried from the ingestion that triggered it. Both fields are
 *  required: a payload with no feeds would recompute all 22 rules, and one with no symbols would
 *  recompute the universe. Either would silently undo the whole point of a filing-keyed trigger. */
export interface FilingRecomputePayload {
  /** Which feeds moved — resolved from the triggering job type (filing/triggers.ts). */
  feeds: string[];
  /** The stocks in that ingestion batch. Never the universe. */
  symbols: string[];
  triggeredBy?: string;
  reason?: string;
}
/** The daily rolling-window pass — no input. Its worklist is "stocks with any insider or block-deal
 *  row", resolved by the handler, because that is the set whose window can move under them. */
export interface FilingRollingDailyPayload {}
/** The full backfill. Both fields optional: the law's default is everything. */
export interface FilingBackfillPayload {
  /** Restrict to these symbols — a targeted re-run, never the law's discharge. */
  symbols?: string[];
  /** Restrict to these feeds' rules — same caveat. */
  feeds?: string[];
  reason?: string;
}
/** Chat title generation — the ONE session whose title to (re)write from its first exchange. */
export interface ChatTitleGeneratePayload {
  sessionId: string;
}
/** Stage 5 · the nightly reader-profile distillation. All fields optional: the cron enqueues `{}` and the
 *  handler selects its own session set. `sessionId` targets one session (a manual retry / proof harness);
 *  `dryRun` distils and returns the profile WITHOUT writing it or advancing the watermark. */
export interface ChatProfileDistillPayload {
  sessionId?: string;
  dryRun?: boolean;
}
export interface RemindersDeliverDailyPayload {}
/** The daily health check. `windowHours` widens/narrows the cron-coverage lookback (default 24);
 *  `lookbackDays` sets the reliability window (default 7). Both exist so the validation harness can
 *  point the SAME code at a historical window without a second implementation. */
export interface JobHealthCheckPayload {
  windowHours?: number;
  lookbackDays?: number;
  /** ISO instant to treat as "now". Harness/backfill only; the cron never sets it. */
  asOf?: string;
}
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
  | { type: typeof JobTypes.QUARTER_BRIEF; data: QuarterBriefPayload }
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
  | { type: typeof JobTypes.BEHAVIOR_ROLLUP_RECONCILE; data: BehaviorRollupReconcilePayload }
  | { type: typeof JobTypes.BASE_RATES_WARM; data: BaseRatesWarmPayload }
  | { type: typeof JobTypes.FILING_RECOMPUTE; data: FilingRecomputePayload }
  | { type: typeof JobTypes.FILING_ROLLING_DAILY; data: FilingRollingDailyPayload }
  | { type: typeof JobTypes.FILING_BACKFILL; data: FilingBackfillPayload }
  | { type: typeof JobTypes.CHAT_TITLE_GENERATE; data: ChatTitleGeneratePayload }
  | { type: typeof JobTypes.CHAT_PROFILE_DISTILL; data: ChatProfileDistillPayload }
  | { type: typeof JobTypes.REMINDERS_DELIVER_DAILY; data: RemindersDeliverDailyPayload }
  | { type: typeof JobTypes.JOB_HEALTH_CHECK; data: JobHealthCheckPayload };

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
  [JobTypes.QUARTER_BRIEF]: { maxAttempts: 1 },
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
  // Rollup reconcile — a single idempotent recompute (INSERT…SELECT…ON CONFLICT). A retry just
  // recomputes the same rows from the same events; no benefit to auto-retry. One attempt.
  [JobTypes.BEHAVIOR_ROLLUP_RECONCILE]: { maxAttempts: 1 },
  // Base-rate warm — one read-only aggregate, no writes. A failure costs nothing (the read path
  // computes on demand and the previous snapshot keeps serving), so a retry buys nothing either.
  [JobTypes.BASE_RATES_WARM]: { maxAttempts: 1 },
  // The filing pass — all three are IDEMPOTENT (upsert on (stock, rule, period), prior-period
  // comparison read strictly earlier than what is being written), so a retry re-does the same work
  // rather than compounding it. One retry each: the failure mode worth retrying is a transient DB
  // blip mid-batch, and the batch is cheap enough to redo. The backfill gets one too — it is the
  // discharge of the standing law, and leaving the universe half-recomputed is the state it exists
  // to prevent.
  [JobTypes.FILING_RECOMPUTE]: { maxAttempts: 2 },
  [JobTypes.FILING_ROLLING_DAILY]: { maxAttempts: 2 },
  [JobTypes.FILING_BACKFILL]: { maxAttempts: 2 },
  // Chat title — a tiny cosmetic model call. NEVER auto-retry: a retry spends a second quota unit for a
  // cosmetic title, and a failed title just leaves the provisional (truncated-first-message) one in place.
  [JobTypes.CHAT_TITLE_GENERATE]: { maxAttempts: 1 },
  // Idempotent by watermark, so a retry is safe — but a failed night is cheap to skip; the next run resumes.
  [JobTypes.CHAT_PROFILE_DISTILL]: { maxAttempts: 1 },
  // Health check — pure reads. A failure means we have no report for the night, which is worth one
  // more try: the whole value of the thing is that it does not silently not run.
  [JobTypes.JOB_HEALTH_CHECK]: { maxAttempts: 2 },
};

// ── Restart policy per job type ──────────────────────────────
//
// WHAT THIS ANSWERS, AND WHY IT IS NOT `RETRY_POLICIES`. RETRY_POLICIES governs a job
// that RAN AND THREW: the handler produced an exception, the worker caught it, and
// `attempts < maxAttempts` decides whether to try again. This map governs a job that
// never got to throw — its worker vanished mid-run (SIGTERM, OOM, a redeploy, or the
// swallowed-terminal-write path at worker.ts's loop catch) and the row was left
// `running` with nobody behind it.
//
// ★ THE TWO PATHS ARE STRUCTURALLY DIFFERENT AND THAT IS THE POINT. The retry path is
//   reachable only from INSIDE runJob's try block; a killed process has no stack, so it
//   raises nothing and the retry never engages. Measured: instrument_corporate_actions
//   carries maxAttempts 2, set specifically so "a transient NSE blip must not leave
//   tonight's fold rescaling from a stale split table" — and on 11 Aug it sat dead for
//   2.74 days with attempts still at 1, because nothing threw. The reclaim path is
//   reached from OUTSIDE the job's own execution, by a later tick reading only DB state.
//   It needs no exception, no cooperation from the dead job, and no restart.
//
// "requeue" — safe to re-run from the very start. Row goes back to `pending`,
//             reclaim_count += 1, attempts UNTOUCHED (it was interrupted, not failed).
// "fail"    — NOT safe to auto-re-run. Row goes to `abandoned` with a stated reason so
//             it is visible, rather than silently repeating work nobody sanctioned.
//
// ⚠ THE DEFAULT IS "fail". `restartPolicyFor` returns "fail" for any type not in this
//   map, so an unrecognised row (a renamed type, a hand-inserted row) is surfaced rather
//   than re-run. The Record<JobType, …> below makes the map exhaustive at COMPILE time:
//   adding a JobType without declaring its restart policy will not build.
export type RestartPolicy = "requeue" | "fail";

export const RESTART_POLICIES: Record<JobType, RestartPolicy> = {
  // ── NOT SAFE TO AUTO-REQUEUE ───────────────────────────────
  // Deletes production data irreversibly. maxAttempts is already 1 by explicit policy
  // ("NEVER auto-retry … re-running is wasteful and muddies the audit"). Each delete is
  // individually idempotent, so this is a POLICY exclusion rather than a correctness one
  // — but a requeue would put a destructive pass back on the queue with no operator in
  // the loop, which is exactly what that policy exists to prevent.
  [JobTypes.RETENTION_PRUNE]: "fail",
  // "Retrying would only double-hit the broker's API" (RETRY_POLICIES, above). It also
  // does not NEED a requeue: the worklist is derived from lastSyncedAt, so the next
  // 30-minute firing picks up everything that fell behind. Failing it is strictly better
  // than requeuing it — the cron is unblocked either way, and the broker is hit once.
  [JobTypes.BROKER_POLL_SYNC]: "fail",
  // ── The 8 manual backfills ─────────────────────────────────
  // Operator-initiated, hours long, and driven by NO cron — so a stuck one blocks no
  // schedule and the "unblock the cron" argument for requeuing does not apply. Re-running
  // from zero is idempotent but re-spends hours of NSE crawl, and the operator who
  // started it is the right person to decide that. They land in `abandoned` with a reason.
  [JobTypes.DEALS_BACKFILL]: "fail",
  [JobTypes.EVENTS_BACKFILL]: "fail",
  [JobTypes.INSIDER_TRADES_BACKFILL]: "fail",
  [JobTypes.NEWS_BACKFILL]: "fail",
  [JobTypes.PRICE_BACKFILL]: "fail",
  [JobTypes.INDEX_PRICES_BACKFILL]: "fail",
  [JobTypes.SHAREHOLDING_BACKFILL]: "fail",
  [JobTypes.LEGACY_BACKFILL]: "fail",

  // ── SAFE TO REQUEUE ────────────────────────────────────────
  // ★ The 11 August job. NOT-NULL instrument_id + a real unique key, so a re-run collides
  //   and updates in place. This is the row that must come back on its own.
  [JobTypes.INSTRUMENT_CORPORATE_ACTIONS]: "requeue",
  // decideIngest skips any period that already has a real data row and logFetch upserts in
  // place → "zero duplicate rows" on a re-run (scheduler.ts). Expensive (p95 6.30h) but
  // correct, and it is the type with the worst measured abandonment rate (42.1%).
  [JobTypes.RESULTS_SCAN]: "requeue",
  // Compute-and-discard with the WRITE BARRIER AFTER EVERY WINDOW — a mid-run kill wrote
  // nothing, so a re-run starts clean rather than resuming a half-written table.
  [JobTypes.MF_ANALYTICS_DAILY]: "requeue",
  // Both re-read the last few trading days by design (self-healing) and upsert.
  [JobTypes.EOD_PRICES_DAILY]: "requeue",
  [JobTypes.INDEX_PRICES_DAILY]: "requeue",
  // One file = the whole universe, upserted on the ISIN spine.
  // ⚠ Each writes an mf_run_log row per run, so a reclaim leaves TWO log rows for one
  //   night. Cosmetic (the log stops being a run count); no analytics are doubled.
  [JobTypes.AMFI_NAV_DAILY]: "requeue",
  [JobTypes.ETF_NAV_DAILY]: "requeue",
  // The four udiff lanes: append-only prices + forward-only snapshot, and all four abort
  // BEFORE any write on a bad feed, so an interrupted run left a consistent table.
  [JobTypes.REIT_DAILY]: "requeue",
  [JobTypes.ETF_PRICES_DAILY]: "requeue",
  [JobTypes.GOVT_SECURITIES_DAILY]: "requeue",
  [JobTypes.CORPORATE_BONDS_DAILY]: "requeue",
  // Insert-with-dedupe (inserted/skipped counters on every one of these).
  [JobTypes.DEALS_DAILY_INGEST]: "requeue",
  [JobTypes.EVENTS_WEEKLY_INGEST]: "requeue",
  [JobTypes.EVENTS_DAILY_REFRESH]: "requeue",
  [JobTypes.SHAREHOLDING_QUARTERLY]: "requeue",
  [JobTypes.SHAREHOLDING_SMART_REFRESH]: "requeue",
  [JobTypes.INSIDER_TRADES_DAILY]: "requeue",
  // GUID-keyed dedupe. ⚠ Known ~1.4% GUID drift → a reclaim can add a handful of
  // duplicate news rows. Acceptable and not silent; the alternative is a dead news feed.
  [JobTypes.DAILY_NEWS_INGEST]: "requeue",
  [JobTypes.NSE_ANNOUNCEMENTS_INGEST]: "requeue",
  [JobTypes.GOOGLE_NEWS_INGEST]: "requeue",
  [JobTypes.NEWS_CONTENT_EXTRACTION]: "requeue",
  // Upsert on (stock, rule, period); the prior-period comparison reads STRICTLY EARLIER
  // rows, so a re-run cannot read its own last write and flip a standing state.
  [JobTypes.FILING_RECOMPUTE]: "requeue",
  [JobTypes.FILING_ROLLING_DAILY]: "requeue",
  // The discharge of the standing law. Its own note says leaving the universe
  // half-recomputed is the state it exists to prevent — so an interrupted one must resume.
  [JobTypes.FILING_BACKFILL]: "requeue",
  // Fingerprint pre-check → skip-identical; append-only supersede; one txn per PG.
  [JobTypes.PG_RESCORE]: "requeue",
  [JobTypes.PG_CASCADE_RESCORE]: "requeue",
  [JobTypes.FILL_CASCADE_RESCORE]: "requeue",
  [JobTypes.PRICES_REFETCH]: "requeue",
  // Fire + disarm happen in ONE transaction, so already-fired alerts are skipped.
  [JobTypes.ALERTS_EVAL_DAILY]: "requeue",
  // Dedupe on resolvedEventDate with a DB unique as the backstop.
  [JobTypes.REMINDERS_EVAL_DAILY]: "requeue",
  // ⚠ THESE TWO SEND EMAIL. `delivered=false` is the guard, and the send→flip crash window
  //   is covered by a stable per-event Idempotency-Key forwarded to Resend
  //   (alert-event:<id> / reminder-event:<id>). That dedup guarantee is RESEND'S, not
  //   ours, and is bounded by their key-retention window — a reclaim lands within
  //   minutes, comfortably inside it. Requeue is also the only option that gets the
  //   night's mail out at all; failing leaves users silently un-notified.
  [JobTypes.ALERTS_DELIVER_DAILY]: "requeue",
  [JobTypes.REMINDERS_DELIVER_DAILY]: "requeue",
  // Single INSERT…SELECT…ON CONFLICT.
  [JobTypes.BEHAVIOR_ROLLUP_RECONCILE]: "requeue",
  // No writes at all — a re-run cannot cost anything but one aggregate.
  [JobTypes.BASE_RATES_WARM]: "requeue",
  // Watermark-idempotent per session; an interruption re-spends at most one quota unit.
  [JobTypes.CHAT_PROFILE_DISTILL]: "requeue",
  // Race-safe updateMany / fingerprint skip. Cost of a re-run is 1 quota unit.
  [JobTypes.CHAT_TITLE_GENERATE]: "requeue",
  [JobTypes.QUARTER_BRIEF]: "requeue",
  // ON CONFLICT DO NOTHING + the DB's rolling-window trigger. This one IS cron-driven
  // (weekly-instrument-history-refresh), unlike the 8 manual backfills above.
  [JobTypes.INSTRUMENT_HISTORY_BACKFILL]: "requeue",
  [JobTypes.PEER_METRICS_COMPUTE_ALL]: "requeue",
  // Read-only over every table it touches; a re-run recomputes the same report from the same
  // history. The only cost of re-running is one more job row.
  [JobTypes.JOB_HEALTH_CHECK]: "requeue",
};

/**
 * The restart policy for a job row's `type`.
 *
 * Takes a raw string rather than a JobType because it is called with whatever is in the
 * database, which is not guaranteed to still be a declared type (a rename, a hand-inserted
 * row, a type deleted in a later deploy). Anything unrecognised is "fail" — surfaced, never
 * silently re-run.
 */
export function restartPolicyFor(type: string): RestartPolicy {
  return (RESTART_POLICIES as Record<string, RestartPolicy>)[type] ?? "fail";
}

// ── Cancellation capability per job type ─────────────────────
//
// ★ WHY THIS IS DATA AND NOT A DOCS PAGE. Cancellation in this system is COOPERATIVE: the
//   admin route sets cancel_requested, the worker's poller flips the row to CANCELLED and
//   calls abort(), and then — for most types — the handler keeps working to completion and
//   its result is silently discarded. A panel that renders one "Cancel" button for every
//   row is therefore telling the operator something untrue about most of them. The API
//   serves this map so the UI can disable, warn, or explain instead of pretending.
//
// TRACED, NOT INFERRED. Every "checkpointed" below was followed from the handler into the
// service to confirm the callback's `false` actually breaks the loop; the file:line is on
// the entry. The classification is deliberately pessimistic where a trace was ambiguous.
//
//   "checkpointed"  — the handler asks at a real mid-run checkpoint AND the service stops.
//                     A cancel takes effect at the next checkpoint (≤ one batch/symbol).
//   "signal_only"   — no checkpoint, but ctx.signal reaches the I/O, so abort() unwinds an
//                     in-flight request. Effective only while it is waiting on that call.
//   "preflight_only"— asked once before the work starts. Once running, it is "none".
//   "none"          — neither. cancel_requested is RECORDED and the job runs to completion.
//                     The row will read CANCELLED while the work is still happening.
export type CancellationSupport = "checkpointed" | "signal_only" | "preflight_only" | "none";

export const CANCELLATION_SUPPORT: Record<JobType, CancellationSupport> = {
  // ── checkpointed (traced end to end) ───────────────────────
  [JobTypes.PRICE_BACKFILL]: "checkpointed", // ingest-prices.ts:752 `if (!shouldContinue)`
  [JobTypes.INDEX_PRICES_BACKFILL]: "checkpointed", // ingest-indices.ts:360-363
  [JobTypes.EVENTS_BACKFILL]: "checkpointed", // ingest-events.ts:521-526
  [JobTypes.NEWS_BACKFILL]: "checkpointed", // ingest-news.ts:473-478
  [JobTypes.DAILY_NEWS_INGEST]: "checkpointed", // ingest-news.ts:266-271 + 473-478
  [JobTypes.NSE_ANNOUNCEMENTS_INGEST]: "checkpointed", // ingest-news.ts:266-271
  [JobTypes.GOOGLE_NEWS_INGEST]: "checkpointed", // ingest-news.ts:266-271
  [JobTypes.NEWS_CONTENT_EXTRACTION]: "checkpointed", // ingest-news.ts:473-478
  [JobTypes.INSIDER_TRADES_BACKFILL]: "checkpointed", // pit-jobs.ts:252-257 (+ signal at :230)
  [JobTypes.SHAREHOLDING_BACKFILL]: "checkpointed", // ingest-shareholding.ts:574-579 (+ :522)
  [JobTypes.SHAREHOLDING_QUARTERLY]: "checkpointed", // ingest-shareholding.ts:574-579
  [JobTypes.SHAREHOLDING_SMART_REFRESH]: "checkpointed", // ingest-shareholding.ts:574-579
  [JobTypes.PEER_METRICS_COMPUTE_ALL]: "checkpointed", // compute.ts:812-818
  [JobTypes.LEGACY_BACKFILL]: "checkpointed", // handler throws JobCancelledError from onProgress
  // One gate, between compute and the single write phase — a cancel means "do not persist".
  // Narrow, but real: it aborts the only thing that mutates.
  [JobTypes.PG_RESCORE]: "checkpointed", // pg-rescore.handler.ts:92
  [JobTypes.PG_CASCADE_RESCORE]: "checkpointed",
  [JobTypes.FILL_CASCADE_RESCORE]: "checkpointed",

  // ── signal_only ────────────────────────────────────────────
  [JobTypes.INSTRUMENT_HISTORY_BACKFILL]: "signal_only", // ctx.signal → runBackfill, no checkpoint
  // ⚠ THE WORST CASE IN THE TABLE, AND IT LOOKS LIKE THE BEST. results-scan.handler calls
  //   ctx.shouldCancel() three times — and every one of them only skips a PROGRESS WRITE
  //   (`if (await ctx.shouldCancel()) return;` inside onProgress), never the scan. ctx.signal
  //   reaches fetchFilingsInWindow, the up-front discovery call, and NOT the per-symbol XBRL
  //   loop that runs for hours (scan.ts:948). So a cancel on a running universe scan stops
  //   nothing once discovery is done — on a job whose p95 is 6.30h. Classified on what it
  //   DOES, not on the presence of the calls.
  [JobTypes.RESULTS_SCAN]: "signal_only",

  // ── preflight_only ─────────────────────────────────────────
  [JobTypes.PRICES_REFETCH]: "preflight_only", // checked once at handler:214, then never

  // ── none: the flag is recorded and nothing stops ───────────
  // ★ The two jobs in the 11 August incident are both here.
  [JobTypes.INSTRUMENT_CORPORATE_ACTIONS]: "none",
  [JobTypes.MF_ANALYTICS_DAILY]: "none",
  [JobTypes.EOD_PRICES_DAILY]: "none",
  [JobTypes.INDEX_PRICES_DAILY]: "none",
  [JobTypes.AMFI_NAV_DAILY]: "none",
  [JobTypes.ETF_NAV_DAILY]: "none",
  [JobTypes.REIT_DAILY]: "none",
  [JobTypes.ETF_PRICES_DAILY]: "none",
  [JobTypes.GOVT_SECURITIES_DAILY]: "none",
  [JobTypes.CORPORATE_BONDS_DAILY]: "none",
  [JobTypes.DEALS_BACKFILL]: "none",
  [JobTypes.DEALS_DAILY_INGEST]: "none",
  [JobTypes.EVENTS_WEEKLY_INGEST]: "none",
  [JobTypes.EVENTS_DAILY_REFRESH]: "none",
  [JobTypes.INSIDER_TRADES_DAILY]: "none",
  [JobTypes.QUARTER_BRIEF]: "none",
  [JobTypes.ALERTS_EVAL_DAILY]: "none",
  [JobTypes.ALERTS_DELIVER_DAILY]: "none",
  [JobTypes.REMINDERS_EVAL_DAILY]: "none",
  [JobTypes.REMINDERS_DELIVER_DAILY]: "none",
  [JobTypes.BROKER_POLL_SYNC]: "none",
  [JobTypes.RETENTION_PRUNE]: "none",
  [JobTypes.BEHAVIOR_ROLLUP_RECONCILE]: "none",
  [JobTypes.BASE_RATES_WARM]: "none",
  [JobTypes.FILING_RECOMPUTE]: "none",
  [JobTypes.FILING_ROLLING_DAILY]: "none",
  [JobTypes.FILING_BACKFILL]: "none",
  [JobTypes.CHAT_TITLE_GENERATE]: "none",
  [JobTypes.CHAT_PROFILE_DISTILL]: "none",
  [JobTypes.JOB_HEALTH_CHECK]: "none", // pure reads, seconds long — nothing to cancel
};

/** Cancellation capability for a raw type string. Unknown ⇒ "none" (never promise more). */
export function cancellationSupportFor(type: string): CancellationSupport {
  return (CANCELLATION_SUPPORT as Record<string, CancellationSupport>)[type] ?? "none";
}

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
