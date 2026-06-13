# Vytal Backend — Complete Technical Documentation

> A deep, file-by-file reference for the **Vytal-Backend** (internal package name `invest-iq-backend`).
> This document explains the architecture, the database schema, every ingestion pipeline, the
> background-job engine, the REST API, the scheduler, and all supporting tooling.

---

## Table of Contents

1. [What This Backend Is](#1-what-this-backend-is)
2. [Technology Stack](#2-technology-stack)
3. [Project / Folder Structure](#3-project--folder-structure)
4. [Application Bootstrap & Server Lifecycle](#4-application-bootstrap--server-lifecycle)
5. [Configuration & Environment](#5-configuration--environment)
6. [Database Schema (Prisma / PostgreSQL)](#6-database-schema-prisma--postgresql)
7. [The Scheduler (Cron)](#7-the-scheduler-cron)
8. [Background Jobs System](#8-background-jobs-system)
9. [REST API — Routes & Controllers](#9-rest-api--routes--controllers)
10. [Market-Data Ingestion Pipelines](#10-market-data-ingestion-pipelines)
11. [Quarterly & Annual Results (XBRL) Pipeline](#11-quarterly--annual-results-xbrl-pipeline)
12. [Peer Metrics, Libraries, Seeds & Tooling](#12-peer-metrics-libraries-seeds--tooling)
13. [Cross-Cutting Conventions](#13-cross-cutting-conventions)
14. [Known Issues / TODOs Surfaced During Review](#14-known-issues--todos-surfaced-during-review)

---

## 1. What This Backend Is

Vytal-Backend is a **financial-market data ingestion and serving platform** for Indian equities
(primarily the **Nifty-200 universe** plus ~19 extra peer-benchmark stocks). It crawls public data
from **NSE**, **BSE**, **Google News**, and **Yahoo Finance**, normalizes it, derives analytical
metrics, stores everything in **PostgreSQL** (via Prisma), and exposes it through a versioned REST
API (`/api/v1/...`).

The platform tracks, per stock:

- **Fundamentals & quarterly results** parsed from NSE **XBRL** filings, split across five industry
  taxonomies (non-financial / Ind-AS, banking, NBFC, life insurance, general insurance).
- **Daily prices** (EOD OHLCV) + a live snapshot (returns, 52-week band, sparkline).
- **Block & bulk deals**, **corporate events** (earnings, dividends, splits, AGMs…),
  **shareholding patterns** (FII/DII/promoter/pledging), **insider trades** (SEBI PIT).
- **News & announcements** (NSE corporate filings + Google News) with full-text content extraction
  and a slot for AI-generated summaries.
- **Peer-group benchmarks** (median P/E, P/B; mean ROE, ROCE, margins, D/E, growth).

All recurring work runs through an in-process, database-backed **background-job queue** driven by a
**cron scheduler**. Heavy/long operations (backfills, universe scans) are enqueued as cancellable,
progress-reporting jobs.

> **Naming note:** the repo folder is `Vytal-Backend`; `package.json` still calls it
> `invest-iq-backend`, and some older seed code references an "InvestIQ" universe. Treat *Vytal* and
> *InvestIQ* as the same product at different naming stages.

---

## 2. Technology Stack

| Concern | Choice |
|---|---|
| Language / Runtime | **TypeScript** (ESM, `module: nodenext`, `target: esnext`), Node.js |
| Dev runner | `tsx watch` (`npm run dev`) |
| Web framework | **Express 5** |
| Security middleware | `helmet`, `cors` |
| ORM | **Prisma 7** with the **`@prisma/adapter-pg`** driver adapter over a `pg` Pool |
| Database | **PostgreSQL** |
| Validation | **Zod 4** |
| Scheduling | **node-cron** |
| HTTP (scraping) | Node built-in `https` (for cookie/header control) + `zlib` decompression |
| HTML/XML parsing | `cheerio`, `fast-xml-parser` |
| File parsing | `pdf-parse` (PDF text), `xlsx` (Excel), `csv-parse` (bhavcopy CSV), `adm-zip` (BSE zips) |
| Market data SDK | `yahoo-finance2` |
| File uploads | `multer` (memory storage) |
| Env | `dotenv` |

**NPM scripts** (`package.json`):

- `dev` → `tsx watch src/server.ts`
- `build` → `prisma generate && tsc`
- `start` → `node dist/server.js`
- `postinstall` → `prisma generate`

---

## 3. Project / Folder Structure

```
Vytal-Backend/
├── prisma/
│   ├── schema.prisma           # 1,815-line schema — all models live here
│   ├── migrations/             # 24 timestamped SQL migrations
│   └── migration_lock.toml
├── prisma.config.ts            # Prisma config — migrations use DIRECT_URL
├── tsconfig.json
├── package.json
├── .env / .env.example
└── src/
    ├── app.ts                  # Express app factory — mounts all routers
    ├── server.ts               # Entry point — boots app, worker, scheduler
    ├── config/
    │   └── env.ts              # Parsed env (PORT, DATABASE_URL, JWT_SECRET)
    ├── db/
    │   └── prisma.ts           # Shared PrismaClient (pg Pool + adapter)
    ├── generated/prisma/       # Generated Prisma client (gitignored)
    ├── lib/
    │   ├── client.ts           # nseClient — NSE cookie/session HTTP client
    │   ├── scheduler.ts        # node-cron registry → enqueues jobs
    │   ├── multer.ts           # Excel & ZIP upload configs (memory storage)
    │   └── seed.ts             # Legacy one-shot universe seed (150 stocks)
    ├── schema/
    │   └── schema.ts           # All Zod request-validation schemas
    ├── jobs/                   # Background-job engine
    │   ├── types.ts            # Job type registry + payloads + retry policies
    │   ├── enqueue.ts          # enqueueJob / listJobs / requestCancel / getJobById
    │   ├── worker.ts           # Polling worker (claim → run → finalize)
    │   ├── context.ts          # JobContext (progress, cancel, AbortSignal)
    │   ├── dispatcher.ts       # type → handler routing
    │   └── handlers/           # One handler per job type
    ├── routes/                 # Express routers (public + admin per domain)
    │   ├── ingestion/          # deals, prices, events, shareholding, insider,
    │   │                       #   news, peer-metrics, results-scan, legacy-backfill
    │   └── job-routes.ts       # /api/v1/admin/jobs
    ├── controllers/            # Route handlers (business logic per endpoint)
    │   ├── ingestion/
    │   └── jobs-controller.ts
    ├── ingestions/             # The data pipelines
    │   ├── block-deals/
    │   ├── corporate-events/
    │   ├── insider-trades/
    │   ├── news_and_announcements/
    │   ├── prices/             # + providers/ (nse-bhavcopy, bse-bhavcopy)
    │   ├── shareholdings/
    │   ├── peer-metrics/
    │   └── quaterly-results/   # (sic) the big XBRL pipeline
    │       ├── xbrl/           # extraction, contexts, taxonomy, per-industry parsers
    │       ├── ingesters/      # per-industry DB upsert + derived metrics
    │       ├── results/        # v3 discovery
    │       └── legacy/         # v2 backfill path
    ├── seed/
    │   ├── industry-types.ts   # Route-callable industry/fiscal-year refresh
    │   └── calendar-year-stocks.json
    └── scripts/                # CLI seeds & maintenance tools
```

> **Spelling note:** the directory is `quaterly-results` (missing the second "r"). This is the actual
> on-disk path — code imports depend on it.

---

## 4. Application Bootstrap & Server Lifecycle

**`src/app.ts`** exports `createApp()`, which builds the Express app:

- Global middleware (in order): `cors()`, `helmet()`, `express.json()`.
- Mounts every router under `/api/v1/...` (see the [mount table](#9-rest-api--routes--controllers)).
- There is **no multer/upload middleware** and **no auth middleware** registered globally; "admin"
  routers are admin by mount-path convention only.

**`src/server.ts`** is the process entry point:

1. `const app = createApp()`.
2. **Boots the job worker**: `jobWorker.start()` — *not awaited*; it runs forever in the background.
3. Registers a **`SIGTERM` handler** for graceful shutdown: stops accepting new jobs
   (`jobWorker.stop()`), waits 30 s for the in-flight job to finish, then `process.exit(0)`.
4. Adds a `GET /health` endpoint → `{ status: "ok" }`.
5. **Starts the cron scheduler only in production**: `if (process.env.NODE_ENV === "production") startScheduler();`.
6. `app.listen(env.PORT)` (default **4000**).

So in non-production environments the worker still runs (you can enqueue jobs via admin routes) but
cron jobs do **not** auto-fire.

---

## 5. Configuration & Environment

**`.env.example`** keys: `NODE_ENV`, `PORT`, `DATABASE_URL`, `DIRECT_URL`, `DATABASE_PASSWORD`,
`JWT_SECRET`, `REDIS_URL`.

**`src/config/env.ts`** exposes a small typed object:

```ts
export const env = {
  PORT: Number(process.env.PORT) || 4000,
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_SECRET: process.env.JWT_SECRET!,
};
```

> `REDIS_URL` and `DATABASE_PASSWORD` appear in `.env.example` but are not consumed by current code
> (the job queue is Postgres-backed, not Redis-backed — Redis is forward-looking). `JWT_SECRET` is
> parsed but no auth layer uses it yet.

**Two database connection strings** (the standard pooled/direct split for serverless Postgres):

- `DATABASE_URL` → used by the **runtime** Prisma client (`src/db/prisma.ts`), pooled.
- `DIRECT_URL` → used by **migrations** (`prisma.config.ts`), a direct non-pooled connection.

---

## 6. Database Schema (Prisma / PostgreSQL)

Defined entirely in `prisma/schema.prisma`. The generator outputs to `src/generated/prisma`
(gitignored). Provider is `postgresql`. Below is every model grouped by purpose. Monetary values are
in **₹ Crore** unless noted; ratios are stored as decimals (e.g. `0.15` = 15%) **except** where a
field is explicitly a percent (e.g. `netMargin`, `debtToEquity` for Ind-AS).

### 6.1 Core reference data

**`Sector`** (`sectors`) — pre-seeded sector list (Screener/NSE data doesn't carry sector).
- `id`, `name` (unique), `displayName`, `stockCount` (denormalized).
- `healthScoreWeightages` (JSONB), `thresholds` (JSONB) — config for a future health-score engine.
- Relations: `stocks[]`, `peerGroups[]`.

**`Stock`** (`stocks`) — one row per company, created on first ingest.
- `id`, `symbol` (unique, e.g. `TCS`), `name`, `sectorId?`, `exchange` (default `NSE`),
  `marketCapCategory?` (`large_cap`/`mid_cap`/`small_cap`), `isActive` (default true),
  `faceValue?`, `description?`.
- `industryType` enum **`IndustryType`** = `non_financial | banking | nbfc | life_insurance | general_insurance` (default `non_financial`). Drives which fundamentals/quarterly tables a stock uses.
- `fiscalYearEnd` enum **`FiscalYearEnd`** = `march | december` (default `march`). Handles calendar-year filers.
- Has **22 relations** — to every fundamentals/results table, prices, deals, events, shareholding,
  insider trades, news, AI summaries, peer-group memberships, and logs. `@@index([industryType])`.

### 6.2 Non-financial fundamentals & results

**`Fundamental`** (`fundamentals`) — **annual** fundamentals for non-financial (Ind-AS) companies, one
row per `(stockId, fiscalYear)`. Source: NSE Reg-33 Annual XBRL (Ind-AS taxonomy). ~90 columns:
- Filing metadata (`reportDate`, `filingDate`, `xbrlUrl`, `resultType`, `source`, `xbrlTaxonomy`).
- Full **P&L** (revenue, expenses, finance costs, depreciation, PBT, tax, net profit…).
- Full **Balance Sheet** (equity, current/non-current liabilities & assets, total debt/assets…).
- **Cash Flow Statement** (operating/investing/financing, capex, FCF, dividends/interest paid…).
- **Per-share** (basic/diluted EPS, face value, paid-up equity capital).
- **Derived ratios** (EBITDA, net/operating margin, net worth, BVPS, D/E, ROE, ROCE, interest
  coverage, receivables days, inventory/asset turnover) and **YoY growth** (revenue/profit/EPS).
- `extraMetrics` (JSON) forward-compat slot. `@@unique([stockId, fiscalYear])`.

**`QuarterlyResult`** (`quarterly_results`) — **quarterly** P&L for non-financial companies, one row
per `(stockId, quarter, fiscalYear)`. Compact P&L + operating/net margin + QoQ/YoY growth.
`@@unique([stockId, quarter, fiscalYear])`.

### 6.3 Industry-specific fundamentals & results (8 tables)

Each financial industry has an **annual fundamental** + a **quarterly result** table, modeled on the
relevant SEBI/Schedule-III/IRDAI structure:

- **`BankingFundamental`** / **`BankingQuarterlyResult`** — interest earned/expended, PPOP, provisions,
  asset quality (GNPA/NNPA absolute & %, PCR), capital adequacy (CET1/AT1/Tier-1), NIM, cost-to-income,
  credit cost, ROA/ROE, credit-deposit ratio. The quarterly table has an **`auditPending`** boolean —
  Q4 unaudited filings null out asset-quality/capital/profitability fields.
- **`NbfcFundamental`** / **`NbfcQuarterlyResult`** — interest income, fee & commission, fair-value
  gains, ECL/impairment, financial vs non-financial assets/liabilities, NIM, spread, credit cost,
  borrowings-to-equity, capital-to-assets (CRAR proxy). Quarterly is P&L-only (no BS).
- **`LifeInsuranceFundamental`** / **`LifeInsuranceQuarterlyResult`** — IRDAI two-account model:
  Policyholders' Revenue Account (premium income split first-year/renewal/single, commission, opex,
  benefits) + Shareholders' P&L; solvency & 13/25/37/49/61-month persistency ratios; new-business
  premium %, expense ratio.
- **`GeneralInsuranceFundamental`** / **`GeneralInsuranceQuarterlyResult`** — GI revenue account
  (gross/net written premium, premium earned, claims, commission, underwriting result); combined
  ratio, incurred-claim ratio, expenses-of-management ratio, net-retention ratio, solvency.

All eight share the filing-metadata header, per-share fields, `extraMetrics` JSON, and
`@@unique([stockId, fiscalYear])` or `@@unique([stockId, quarter, fiscalYear])`.

### 6.4 Prices

**`StockPrice`** (`stock_prices`) — **one snapshot row per stock** (`stockId` unique): current price,
market cap, today's OHLC, prevClose, dayChangePct, volume, 52-week high/low, 1m/3m/6m/1y returns,
`sparkline` (JSON array of last 30 closes), `priceDate`, `provider`.

**`DailyPrice`** (`daily_prices`) — **append-only** OHLCV history, one row per `(stockId, date)`.
Includes `isin`, `prevClose`, `volume` (BigInt), `tradedValue` (₹Cr), `provider`. Indexed
`[stockId, date(desc)]` for "latest N prices" queries.

### 6.5 Other market data

- **`BlockDeal`** (`block_deals`) — bulk/block deals, universe-filtered. `dealType` (bulk|block),
  `transactionType` (buy|sell), `quantity` (BigInt), `price`, `valueCr`. Dedup unique key
  `(stockId, dealDate, clientName, transactionType, quantity)`.
- **`CorporateEvent`** (`corporate_events`) — earnings, dividends, AGMs, board meetings, bonus, split,
  rights, buyback, record dates. `eventType`, `eventDate`, `exDate?`, `recordDate?`, `impactLevel`
  (high|medium|low), event-specific fields (`dividendAmount`, `bonusRatio`, `splitRatio`…). Upsert key
  `(stockId, eventType, eventDate)`. Denormalized `symbol`.
- **`ShareholdingPattern`** (`shareholding_patterns`) — append-only, one row per `(stockId, asOnDate)`.
  Promoter/public/employee-trust %, FII/DII/retail/others %, DII sub-breakdown (MF/insurance/banks-FIs),
  **pledging** (`promoterPledgedPct`, `promoterPledgedSharesPct`), and share counts for cross-validation.
- **`InsiderTrade`** (`insider_trades`) — SEBI PIT disclosures (Reg 7(2), 29, 30, 31). Person name &
  category, transaction type (buy/sell/pledge/…), securities pre/traded/post, holding % pre/post/delta,
  trade price & value (₹Cr), acquisition mode, `exchangeRef`. Dedup key
  `(stockId, personName, transactionType, tradeDate, securitiesTraded)`. Append-only.
- **`StockNews`** (`stock_news`) — NSE announcements + Google News. Source metadata, raw `headline`/
  `summary`, extracted `contentText` (+ `contentSource`, `contentTokens`), `pdfUrl`/`externalUrl`,
  classification (`category`, `sentiment`, `isHighImpact`), and an **extraction lifecycle**
  (`extractionStatus` ∈ not_applicable/pending/extracted/failed/skipped, `extractionAttempts`).
  Unique `(stockId, sourceId)`.
- **`AiSummary`** (`ai_summaries`) — Gemini-generated summaries linked many-to-many to `StockNews`.
  `summaryType`, `content` (markdown), `keyPoints` (JSON), model/cost metadata (tokens, cache hit),
  quality flags. Stored separately so raw content is never mutated and summaries are regenerable.

### 6.6 Peer groups

- **`PeerGroup`** (`peer_groups`) — named cluster of stocks within a sector (e.g. "Large-Cap Private
  Banks"). `buildOrder`, denormalized `stockCount`, and the **seven persisted benchmark averages**
  (`avgPeRatio`, `avgPbRatio`, `avgRoe`, `avgRoce`, `avgNetMargin`, `avgDebtToEquity`,
  `avgRevenueGrowth`) + `metricsUpdatedAt`. Unique `(sectorId, name)`.
- **`StockPeerGroup`** (`stock_peer_groups`) — many-to-many join. Unique `(stockId, peerGroupId)`.

### 6.7 Audit / log tables

Every ingestion domain writes an audit row to a dedicated log table (status, counts, duration, error):
`FundamentalIngestionLog`, `ResultFetchLog` (rich status enum: success / no_new_filing /
already_ingested / standalone_kept / upgraded / skipped / failed), `DealFetchLog`, `PriceFetchLog`,
`EventFetchLog`, `ShareholdingFetchLog`, `InsiderTradeFetchLog`, `NewsFetchLog`,
`PeerGroupComputationLog` (with a `computedSnapshot` JSON audit blob).

### 6.8 The job table

**`BackgroundJob`** (`background_jobs`) — the single table for all async work.
- Dispatch: `type`, `status` (default `pending`), `priority` (default 100, lower = sooner).
- I/O: `payload` (JSON), `result` (JSON), `errorMessage`, `errorStack`.
- Progress: `progress` (0–100), `progressNote`.
- Cancellation: `cancelRequested` (cooperative).
- Lifecycle: `createdAt`, `startedAt`, `finishedAt`, `durationMs`.
- Audit/retry: `triggeredBy`, `attempts`, `maxAttempts`.
- Status values: `pending | running | succeeded | failed | cancelled | abandoned`.
- Indexes tuned for the worker's "next pending job" query and the admin list view.

### 6.9 Migrations

24 migrations under `prisma/migrations/` chronicle the build-out (screener ingestion → block deals →
price data → corporate events → shareholding → insider trades → news + AI summary → peer groups →
quarterly results from NSE → background jobs → precision fixes → paid-up equity capital → fiscal
year end). They are the source of truth for applied DDL.

---

## 7. The Scheduler (Cron)

**`src/lib/scheduler.ts`** — registers recurring jobs with **node-cron**. The guiding principle:
**no ingestion function is ever called directly by cron** — each tick performs a *dedup check* then
*enqueues a job*, so every run is tracked, restart-safe, non-duplicating, and cancellable.

- `enqueueIfNotActive(jobType, payload, triggeredBy, priority)` — checks `listJobs` for an existing
  PENDING/RUNNING job of that type and **skips** if one is active; otherwise enqueues.
- `isResultsSeasonNow()` — gates the results scan to four earnings windows (Q1 Jul 15–Aug 25, Q2 Oct
  15–Nov 25, Q3 Jan 15–Feb 25, Q4/annual Apr 15–Jun 10). Off-season ticks are no-ops.
- `startScheduler()` (idempotent) registers all jobs; `triggerJob(name)` allows manual firing.

**All cron expressions are UTC** (IST = UTC + 5:30). Registered jobs:

| Name | Cron (UTC) | IST | Job type |
|---|---|---|---|
| daily-eod-prices | `0 11 * * 1-5` | 4:30 PM Mon–Fri | `EOD_PRICES_DAILY` (priority 50) |
| daily-block-deals | `0 14 * * 1-5` | 7:30 PM Mon–Fri | `DEALS_DAILY_INGEST` |
| weekly-events | `0 2 * * 0` | 7:30 AM Sun | `EVENTS_WEEKLY_INGEST` |
| daily-event-refresh | `30 2 * * 1-5` | 8:00 AM Mon–Fri | `EVENTS_DAILY_REFRESH` |
| quarterly-shareholding | `30 3 20 1,4,7,10 *` | 9:00 AM on the 20th of Jan/Apr/Jul/Oct | `SHAREHOLDING_QUARTERLY` |
| daily-shareholding-refresh | `0 4 * * 1-5` | 9:30 AM Mon–Fri | `SHAREHOLDING_SMART_REFRESH` |
| daily-insider-trades | `0 13 * * 1-5` | 6:30 PM Mon–Fri | `INSIDER_TRADES_DAILY` |
| daily-nse-news | `30 3 * * 1-5` | 9:00 AM Mon–Fri | `NSE_ANNOUNCEMENTS_INGEST` (days: 2) |
| daily-google-news | `0 4 * * 1-5` | 9:30 AM Mon–Fri | `GOOGLE_NEWS_INGEST` (days: 7) |
| news-extraction-worker | `30 4 * * 1-5` | 10:00 AM Mon–Fri | `NEWS_CONTENT_EXTRACTION` (batchSize: 50) |
| monthly-peer-metrics | `30 1 5 * *` | 7:00 AM on the 5th | `PEER_METRICS_COMPUTE_ALL` (priority 50) |
| results-scan | `0 */4 * * *` | every 4h | `RESULTS_SCAN` (only during earnings season; mode universe, hoursBack 6, priority 50) |

---

## 8. Background Jobs System

The backend runs a custom, database-backed background job system that lives **inside the API process**. It is a single-worker, polling queue built directly on top of the `backgroundJob` table — there is no external broker (Redis/SQS/BullMQ). Jobs are rows; the worker is a long-lived poll loop; cancellation, retries, progress, and abandonment recovery are all implemented in application code against that table.

Modules under `src/jobs/`:

| File | Responsibility |
|------|----------------|
| `types.ts` | Single source of truth — job type identifiers, payload types, retry policies, status constants. |
| `enqueue.ts` | Public API for scheduling, querying, and cancelling jobs. |
| `worker.ts` | The long-lived polling worker — claims, runs, retries, abandons, finalises jobs. |
| `context.ts` | `JobContext` factory — progress reporting, cancellation checks, `AbortSignal`, `JobCancelledError`. |
| `dispatcher.ts` | Routes a job's `type` string to its handler function. |
| `handlers/*` | One handler per job type — the actual work, calling into `src/ingestions/*`. |

### 8.1 Design constraints (operational caveats)

Two assumptions are baked into `worker.ts`:

- **Single worker only.** `claimNextJob` is a plain `findFirst` + `update`, which is *not* atomic
  across processes. Running two workers against the same DB will double-claim jobs. The code notes
  to upgrade to `SELECT ... FOR UPDATE SKIP LOCKED` before scaling out.
- **Worker is co-located with the API.** Booted once as a singleton (`jobWorker`) from `server.ts`.
  The module is self-contained so it can later split into a standalone process.

### 8.2 Job lifecycle / state machine

```
                    enqueueJob()
                        │
                        ▼
        ┌──────────► PENDING ──────────────────┐
        │ (retry)       │                       │ requestCancel() while PENDING
        │               │ worker claims         ▼
        │               ▼                    CANCELLED (terminal)
        │            RUNNING
        │           ╱   │   ╲
   handler throws  ╱    │    ╲ handler returns normally
   & canRetry ────╱     │     ╲──────► SUCCEEDED (terminal)
        │               │ cancelRequested detected
   handler throws &     ▼
   !canRetry        CANCELLED (terminal)
        ▼
     FAILED (terminal)

   Boot recovery: RUNNING past the abandon cutoff ──► ABANDONED (terminal)
```

- **PENDING** — created by `enqueueJob`, or a failed-but-retryable job moved back.
- **RUNNING** — claimed; `startedAt` set, `attempts` incremented.
- **SUCCEEDED** — handler returned; `result`, `durationMs`, `progress=100`, `finishedAt` recorded.
- **FAILED** — handler threw and no retry budget remains.
- **CANCELLED** — cancellation requested and honoured.
- **ABANDONED** — a RUNNING row found after a worker restart (process died mid-job). Never auto-retried.

### 8.3 Enqueueing — `enqueue.ts`

```ts
export async function enqueueJob<TData>(opts: {
  type: JobType; payload: TData; triggeredBy: string;
  priority?: number; maxAttempts?: number;
})
```

Looks up the default retry policy for the type, resolves `maxAttempts` (override `?? policy`),
inserts a PENDING row, returns the created job (callers hand `job.id` to the frontend, typically as
`202 Accepted` with a `statusUrl`). `triggeredBy` is a free-form provenance string (`"user:admin"`,
`"cron:daily-eod-prices"`, …).

Control helpers: `getJobById(id)`, `listJobs(filters)` (filters: `type`, `status` single/array,
`triggeredBy`, `since`; `limit` clamped ≤500; returns `{jobs, total}` ordered `createdAt desc`),
`requestCancel(id)` (PENDING → cancel outright; RUNNING → set `cancelRequested=true`; terminal → no-op).

### 8.4 The worker — `worker.ts`

A `JobWorker` class, exported as singleton `jobWorker`. Options: `pollIntervalMs` (default 3000),
`abandonAfterMs` (default 30 min).

- **`start()`** — guards double-start; runs `recoverAbandonedJobs()` first, then `void this.loop()`.
- **`stop()`** — sets `running=false`; loop exits *after* the current job (doesn't kill in-flight work).
- **`currentJob()`** — id of the currently executing job (or null).

**Poll loop**: claim next job → if none, sleep `pollIntervalMs` and retry → else run it. Any loop
error is caught, logged, and the loop continues — an unexpected error never kills the worker.

**`claimNextJob()`** — `findFirst` on PENDING ordered by **priority asc, then createdAt asc** (FIFO
within a priority), then `update` to RUNNING + `startedAt` + `attempts++`.

**`runJob(job)`**:
1. `getHandler(job.type)` — unknown type → immediately FAILED ("No handler registered…").
2. `makeJobContext(job.id, job.payload)` → `{ctx, abort}`; worker keeps `abort`.
3. Starts a 2 s **cancel poller** (see below).
4. `await handler(ctx)`.
5. On success → clear poller; if cancelled-mid-run, leave terminal state; else write SUCCEEDED via a
   **guarded `updateMany` with `where: {id, status: RUNNING}`** so a racing cancellation isn't overwritten.
6. On throw → classify (cancellation vs retryable vs terminal) and write the next status, again guarded.

### 8.5 Retries

Retry policy is per-type in `types.ts`. In the catch block:

```ts
const isCancellation = err instanceof JobCancelledError || err.name === "AbortError";
const canRetry = !isCancellation && job.attempts < job.maxAttempts;
const newStatus = isCancellation ? CANCELLED : canRetry ? PENDING : FAILED;
```

A retryable failure goes **back to PENDING** (with `finishedAt`/`durationMs` cleared) and is eligible
on the very next poll — **no backoff delay**. Cancellations never retry. Policy highlights:

| Job type(s) | maxAttempts | Rationale |
|---|---|---|
| All `*_backfill` (deals/events/insider/news/price), shareholding-backfill | 1 | Idempotent but wasteful / very long — don't double-run. |
| Network-bound dailies (EOD prices, deals, events, shareholding, insider, news ingests/extraction) | 2 | One retry on transient NSE/external failure. |
| `peer_metrics_compute_all` | 1 | Pure computation — wasteful to retry. |
| `results_scan`, `legacy_backfill` | 3 | NSE 5xx is transient; 3 attempts clears most. |

### 8.6 Cancellation (three mechanisms)

1. **Pre-run** — `requestCancel` on a PENDING job sets it straight to CANCELLED.
2. **Cancel poller (worker-side)** — for a RUNNING job, a `setInterval` fires every **2000 ms**; when
   it sees `cancelRequested`, it calls `abort()` (in-flight `fetch()`s holding `ctx.signal` throw
   `AbortError` immediately) and writes CANCELLED. A `cancelledMidRun` flag makes `runJob` suppress
   any later SUCCEEDED/FAILED write. This lets even handlers with no checkpoint be cancelled.
3. **Handler-driven** — batch handlers call `ctx.shouldCancel()` at safe points, either returning
   `!shouldCancel()` from a progress callback (service aborts its own loop) or throwing
   `JobCancelledError`. Both `JobCancelledError` and a native `AbortError` are treated as cancellation.

### 8.7 Abandonment recovery

`recoverAbandonedJobs()` runs once at `start()`: any RUNNING job whose `startedAt` is older than
`abandonAfterMs` (30 min) is marked **ABANDONED** with "Worker process died while job was running".
Abandoned jobs are **never auto-retried** — an operator decides whether to re-enqueue.

### 8.8 The JobContext — `context.ts`

```ts
interface JobContext<TPayload> {
  jobId: string;
  payload: TPayload;
  signal: AbortSignal;                                // pass to every fetch()
  reportProgress(percent: number, note?: string): Promise<void>;
  shouldCancel(): Promise<boolean>;
}
```

- **`signal`** threaded into every `fetch(url, {signal})`; aborting interrupts HTTP immediately.
- **`reportProgress`** — **throttled** DB writes: only writes when `percent === 100`, jumped ≥5
  points, or >500 ms since the last write. Write failures are swallowed (never break the handler).
- **`shouldCancel`** — fast path returns true instantly if the signal is already aborted (no DB
  round-trip); otherwise reads `cancelRequested`. DB errors fall back to `false`.

The codebase convention for progress callbacks is `(done, total, label)` mapped to a 1→99% bar,
returning a keep-going boolean.

### 8.9 The dispatcher — `dispatcher.ts`

A single `HANDLERS: Record<JobType, JobHandler>` maps every type to its handler (compile-time
guarantee that every declared type has a handler). `getHandler(type)` returns `null` for unknown
types (→ worker marks FAILED). Adding a job type = add to `types.ts` + implement handler + register
in `HANDLERS`.

### 8.10 Job type registry — `types.ts`

`JobTypes` is the magic-string-free registry; each has a payload interface unified into a
discriminated `JobPayload` union. Two groups:

**Backfill / one-off** (manual via admin routes): `DEALS_BACKFILL` `{days}`, `EVENTS_BACKFILL`
`{days}`, `INSIDER_TRADES_BACKFILL` `{fromDate,toDate}`, `NEWS_BACKFILL` `{days}`, `PRICE_BACKFILL`
`{days}`, `SHAREHOLDING_BACKFILL` `{quartersBack}`, `RESULTS_SCAN`
`{mode, symbol?, fromQeDate?, industries?, limit?, hoursBack?}`, `LEGACY_BACKFILL`
`{mode, symbol?, fromDate?, toDate?, industries?, limit?}`.

**Scheduled / recurring** (cron-enqueued, mostly empty `{}` payloads): `EOD_PRICES_DAILY`,
`DEALS_DAILY_INGEST`, `EVENTS_WEEKLY_INGEST`, `EVENTS_DAILY_REFRESH`, `SHAREHOLDING_QUARTERLY`,
`SHAREHOLDING_SMART_REFRESH`, `INSIDER_TRADES_DAILY`, `DAILY_NEWS_INGEST`, `NSE_ANNOUNCEMENTS_INGEST`
`{days}`, `GOOGLE_NEWS_INGEST` `{days}`, `NEWS_CONTENT_EXTRACTION` `{batchSize}`,
`PEER_METRICS_COMPUTE_ALL`.

> Some payload shapes (`ScreenerBulkIngestPayload`, `QuarterlyResultsScanPayload`,
> `QuarterlyBackfillUniversePayload`) are declared but **not** wired to a type/handler (legacy/forward-declared).

### 8.11 The handlers (step by step)

All handlers are thin orchestration wrappers: report initial progress, delegate to an ingestion
service, thread `ctx.signal`, wire a `(done,total,label)` progress/cancel callback, report 100%, and
return a JSON-serializable audit summary into the job's `result` column.

- **`daily-ingest-ops.handler.ts`** — `handleEodPricesDaily` (`runEodPriceIngest`),
  `handleDealsDailyIngest` (`runDailyDealIngest`), `handleEventsWeeklyIngest` (`runWeeklyEventIngest`),
  `handleEventsDailyRefresh` (`runDailyEventRefresh`), `handleShareholdingQuarterly`
  (`runQuarterlyShareholdingIngest`), `handleShareholdingSmartRefresh` (`runSmartShareholdingRefresh`),
  `handleInsiderTradesDaily` (`runDailyJob`).
- **`deals-backfill.handler.ts`** — `runBackfillDealIngest(days)`; returns counts + duration.
- **`events-backfill.handler.ts`** — `runEventBackfill(days, onProgress)`.
- **`insider-trades-backfill.handler.ts`** — `runManualFetch(from, to, onProgress, signal)`; aggregates
  per-chunk results.
- **`legacy-backfill.ts`** — `handleLegacyBackfill` (manual only). `symbol` → `backfillLegacySymbol`;
  `universe` → `backfillLegacyUniverse` (its onProgress **throws `JobCancelledError`** on cancel);
  returns a summary with `failedDetails` capped at 50.
- **`news-ingests.handler.ts`** — `handleDailyNewsIngest` is a **3-phase pipeline** with a partitioned
  progress bar (NSE 1→39%, Google 40→74%, extraction 75→99%); plus standalone NSE/Google/extraction/
  backfill handlers.
- **`peer-metrics-compute-all.handler.ts`** — `runManualPeerMetrics({scope:"all", onBatchComplete})`.
- **`price-backfill.handler.ts`** — `runPriceBackfill(days, onProgress)` (per-trading-day progress).
- **`results-scan.handler.ts`** — resets the NSE session first; `symbol` → `scanSymbol`; `universe`/
  `backfill` → `scanUniverse({delayMs:1500, …})` and **resets the NSE session every 3 symbols**.

---

## 9. REST API — Routes & Controllers

All routes are under `/api/v1`. Global middleware: `cors`, `helmet`, `express.json`. Each domain has a
**public** router (read-only `GET`) and an **admin** router (`POST` triggers/backfills), except
`results-scan`, `legacy-backfill`, and `jobs` (admin-only). "Admin" = mount-path convention; **no auth
middleware** exists yet (flagged as TODO in `job-routes.ts`).

**Response envelope**: success `{ success:true, data, pagination? }`; error
`{ success:false, error, details? }`. Validation failure → `400`; missing resource → `404`; unhandled
→ `500`; enqueued async job → `202` with `{ jobId, statusUrl }`.

**Mount table** (`src/app.ts`):

| Router | Prefix |
|---|---|
| dealsRouter / adminDealsRouter | `/api/v1/deals` · `/api/v1/admin/deals` |
| pricesRouter / adminPricesRouter | `/api/v1/prices` · `/api/v1/admin/prices` |
| eventsRouter / adminEventsRouter | `/api/v1/events` · `/api/v1/admin/events` |
| shareholdingRouter / adminShareholdingRouter | `/api/v1/shareholding` · `/api/v1/admin/shareholding` |
| insiderTradesRouter / adminInsiderTradesRouter | `/api/v1/insider-trades` · `/api/v1/admin/insider-trades` |
| newsRouter / adminNewsRouter | `/api/v1/news` · `/api/v1/admin/news` |
| peerGroupsRouter / adminPeerMetricsRouter | `/api/v1/peer-groups` · `/api/v1/admin/peer-metrics` |
| resultsScanRouter | `/api/v1/admin/results-scan` |
| legacyBackfillRouter | `/api/v1/admin/legacy-backfill` |
| jobsRouter | `/api/v1/admin/jobs` |

### 9.1 Deals

**Public** (`/api/v1/deals`):
- `GET /deal-logs` → `getDealLogs` — paginated `dealFetchLog` (filters `status`, `fetchType`, `page`, `limit`).
- `GET /:symbol` → `getDealsForSymbol` — block/bulk deals for a stock (filters `type`, `side`, `days`,
  pagination) + summary (`buyCount`, `sellCount`, `totalValueCr`). 404 if symbol unknown.

**Admin** (`/api/v1/admin/deals`):
- `POST /trigger` → `triggerDailyIngest` — runs `runDailyDealIngest()` **synchronously**.
- `POST /backfill` → `triggerBackfillIngest` — enqueues `DEALS_BACKFILL {days}` (1–90, default 90) → `202`.

### 9.2 Prices

**Public** (`/api/v1/prices`):
- `GET /price-logs` → `getPriceFetchLogs` (filters `status`, `provider`, pagination).
- `GET /:symbol` → `getDailyPricesForSymbol` — daily OHLCV history (newest first) + the live snapshot
  row (`days` 1–365, pagination).

**Admin** (`/api/v1/admin/prices`):
- `POST /trigger` → `triggerEodIngest` — `runEodPriceIngest(date?)` **synchronously** (optional `date`).
- `POST /backfill` → `triggerPriceBackfill` — enqueues `PRICE_BACKFILL {days}` (1–365, default 365).

### 9.3 Events

**Public** (`/api/v1/events`):
- `GET /calendar` → `getAllCalendarEvents` — upcoming events across the active universe (filters `days`
  1–90, `types` CSV, `sector` substring); returns both a date-keyed `calendar` map and a flat `events` array.
- `GET /event-logs` → `getEventLogs`.
- `GET /:symbol` → `getEventsBySymbol` — past or upcoming (`upcoming` flag, `days` ≤730).

**Admin** (`/api/v1/admin/events`):
- `POST /trigger` → `triggerWeeklyEventIngest` (sync, next 30 days).
- `POST /refresh` → `triggerDailyEventRefresh` (sync, next 7 days — catch reschedules).
- `POST /backfill` → `backfillEvents` — enqueues `EVENTS_BACKFILL {days}` (raw `parseInt`, default 365).

### 9.4 Shareholding

A `formatPattern()` helper JSON-serializes a pattern row (Decimals→float, BigInt→string, dates→`YYYY-MM-DD`).

**Public** (`/api/v1/shareholding`):
- `GET /shareholding-logs` → `getShareholdingLogs`.
- `GET /:symbol` → `getShareHoldingForStock` — history (most recent first) with **QoQ trend deltas**
  (`promoterQoQ`, `fiiQoQ`, `pledgedQoQ`); `quarters` ≤20.
- `GET /:symbol/latest` → `getLatestShareHoldingForStock`.

**Admin** (`/api/v1/admin/shareholding`):
- `POST /trigger` → enqueues `SHAREHOLDING_QUARTERLY`.
- `POST /smart-refresh` → enqueues `SHAREHOLDING_SMART_REFRESH` (only stocks whose earnings event was 7–21 days ago).
- `POST /backfill` → enqueues `SHAREHOLDING_BACKFILL` (`quarters`→`quartersBack`, ≤40).
- `POST /:symbol` → `triggerManualShareholdingIngestForStock` — **synchronous** single-stock run.

### 9.5 Insider trades

**Public** (`/api/v1/insider-trades`):
- `GET /insider-trade-logs` → `getInsiderTradeLogs`.
- `GET /:symbol` → `getInsiderTradesForSymbol` — PIT trades (filters `category`, `type`, `days`,
  pagination) + `buyCount`/`sellCount`/`pledgeCount`.

**Admin** (`/api/v1/admin/insider-trades`):
- `POST /trigger` → `runDailyJob()` **synchronously** (T and T-1).
- `POST /backfill` → enqueues `INSIDER_TRADES_BACKFILL` (body `months` 1–24 → computed `{fromDate, toDate}`).

### 9.6 News

**Public** (`/api/v1/news`):
- `GET /news-logs` → `getNewsFetchLogs`.
- `GET /feed/today` → `getTodayNewsFeed` — high-impact news in the last 24 h across the active universe (cap 50).
- `GET /:symbol` → `getNewsBySymbol` — per-stock feed (`type`, `highImpact`, `days`, `withContent`
  selects `contentText`).
- `GET /:symbol/:newsId` → `getNewsBySymbolAndId` — single item with full content + latest AI summary
  (looks up by `newsId` only; `:symbol` is ignored).

**Admin** (`/api/v1/admin/news`) — all **async** (`202`):
- `POST /trigger` → `DAILY_NEWS_INGEST`; `POST /trigger/nse` → `NSE_ANNOUNCEMENTS_INGEST {days=2}`;
  `POST /trigger/google` → `GOOGLE_NEWS_INGEST {days=7}`; `POST /extract` → `NEWS_CONTENT_EXTRACTION
  {batchSize=20}`; `POST /backfill` → `NEWS_BACKFILL {days≤365}`.

### 9.7 Peer metrics

A `fmt()` helper does null-safe Decimal→float.

**Public** (`/api/v1/peer-groups`):
- `GET /` → `getAllPeerGroupsList` (filters `sectorId`, `sectorName`; `hasMetrics` flag + 7 averages).
- `GET /:id` → `getSinglePeerGroupDetail`.
- `GET /:id/stocks` → `getALlStockInPeerGroupWithMetrics` — every member with its latest fundamentals,
  computing a **live P/E** (`currentPrice / eps`) with fallback to stored `peRatio`; sorted by revenue desc.

**Admin** (`/api/v1/admin/peer-metrics`):
- `POST /trigger` → `computePeerGroupMetrics` — `scope: all` enqueues `PEER_METRICS_COMPUTE_ALL`
  (`202`); `scope: sector|single` runs `runManualPeerMetrics(...)` **synchronously**.
- `GET /logs` → `getPeerMetricsLogs` — `peerGroupComputationLog` history (excludes the heavy
  `computedSnapshot`).

### 9.8 Results-scan (admin-only, v3 XBRL)

`/api/v1/admin/results-scan`:
- `POST /universe` → `enqueueUniverseScan` — `RESULTS_SCAN {mode: universe|backfill, fromQeDate?,
  industries?, limit?}`.
- `POST /symbol` → `enqueueSymbolScan` — `RESULTS_SCAN {mode: symbol, symbol}`.
- `POST /refresh-industry-types` → `runRefreshIndustryTypes` — **synchronous** `refreshIndustryTypes()`
  + `refreshFiscalYearEnds()` (`dryRun` optional).
- `GET /logs` → `getResultFetchLogs` (filters `symbol`, `status`, `source`, `hoursBack` default 48, pagination).
- `GET /stocks/:symbol/coverage` → `getStockCoverage` — counts rows in the industry-appropriate
  fundamentals/quarterly tables + `resultFetchLog` for the stock.

### 9.9 Legacy-backfill (admin-only, v2)

`/api/v1/admin/legacy-backfill`:
- `POST /universe` → `enqueueLegacyUniverseBackfill` — `LEGACY_BACKFILL {mode: universe, fromDate?,
  toDate?, industries?, limit?}`.
- `POST /symbol` → `enqueueLegacySymbolBackfill` — `LEGACY_BACKFILL {mode: symbol, symbol, fromDate?, toDate?}`.

### 9.10 Jobs (admin job tracking)

`/api/v1/admin/jobs` — the polling/inspection surface for every enqueued job. Delegates to
`getJobById`/`listJobs`/`requestCancel`. All responses **strip `payload`** (can be huge).
- `GET /active` → `listActiveJobs` (PENDING+RUNNING, lean).
- `GET /:id` → `getJob` (single job for polling; 404 if missing).
- `POST /:id/cancel` → `cancelJob`.
- `GET /` → `listJobsHandler` (filters `type`, `status` single/CSV, `triggeredBy`, `since`, pagination;
  validates `type`/`status` against `JobTypes`/`JobStatus`).

> `getJobFull` (returns the job *including* payload) is exported but not wired to any route.

### 9.11 Sync vs async triggers

These admin triggers run **synchronously** (`200` with raw result): deals `/trigger`, prices
`/trigger`, events `/trigger` + `/refresh`, insider-trades `/trigger`, shareholding `/:symbol`,
peer-metrics `/trigger` (scope sector/single), results-scan `/refresh-industry-types`. Everything else
that does heavy work enqueues a job and returns `202`.

---

## 10. Market-Data Ingestion Pipelines

Every ingestion domain shares a three-layer architecture: a **fetch layer** (NSE/BSE/Google), a
**parse/normalize layer**, and an **ingest layer** (universe-filter → dedup → upsert → write a
`*FetchLog` audit row). NSE-backed domains all route through the single shared cookie-managed
`nseClient` singleton; price/content-extraction use raw `https.get`.

### 10.1 Shared NSE session client — `src/lib/client.ts`

NSE rejects requests lacking a browser-like cookie set, so `NseClient` manufactures one.

- **Built on Node's `https`** (not axios/fetch) to read raw `Set-Cookie` headers; uses `zlib` to
  transparently decompress `br`/`gzip`/`deflate`. `HEADERS_BASE` impersonates Chrome 124 on Windows.
- **`initSession()`** — three-step warm-up: GET homepage → (sleep 1.5 s) GET `/market-data/block-deal`
  with an HTML Accept → (sleep 1.5 s) GET `/api/market-status`, merging cookies at each step.
- **Session TTL 8 min**; `sessionExpired()` forces re-init; `resetSession()` nulls the session (several
  pipelines call this every ~3 batches to dodge NSE's silent session drops).
- **`get<T>(path, signal?)`** — re-inits if expired; always `sleep(requestDelay=1500ms)` before the call
  (the global NSE rate governor); **retries once** on network/timeout (after re-init) and once on
  **401/403** (after refresh); throws on other ≥400 or non-JSON bodies.

Because it's a singleton, the 1.5 s delay and session are **shared process-wide** — even "parallel"
calls serialize through the per-request sleep.

### 10.2 Block & Bulk Deals (`block-deals/`)

- **Source**: NSE `/api/snapshot-capital-market-largedeal` (today's bulk+block+short) and
  `/api/historicalOR/bulk-block-short-deals` (historical, max **365 days**/request).
- **Parse (`deals.ts`)** — tolerant date parsing for both `DD-Mon-YYYY` and `DD-MMM-YYYY` casings; two
  transformers drop incomplete/`price≤0` records, strip null bytes, uppercase symbols, compute
  `valueCr = qty*price/1e7`, map BUY/SELL → `buy`/`sell`. `backfillDeals(daysBack≤365)` fetches bulk
  then block **sequentially** (NSE rate-limits), each try/caught independently.
- **Ingest (`ingest-deals.ts`)** — `loadUniverse()` builds `Map<symbol, stockId>` for active stocks;
  `insertDeals()` skips out-of-universe symbols and bulk-inserts via
  `createMany({skipDuplicates:true})` (dedup enforced by the `@@unique` constraint).
- **Jobs** — `runDailyDealIngest()` short-circuits if today's `daily` log is already `success`; else
  fetches, inserts, upserts a `dealFetchLog`. `runBackfillDealIngest(90)` is the same keyed on `backfill`.

### 10.3 Corporate Events (`corporate-events/`)

- **Source**: NSE `/api/corporates-corporateActions` (dividends/bonus/splits/rights/buybacks/AGMs) +
  `/api/event-calendar` (board meetings / results dates), only `series==="EQ"`.
- **Parse (`events.ts`)** — `parseSubject()` is a keyword classifier turning the free-text NSE subject
  into `{eventType, dividendAmount, dividendType, bonusRatio, splitRatio, impactLevel}` (regexes the
  rupee amount, ratios; assigns impact). `fetchAllEvents()` runs both endpoints in parallel and
  **dedups in memory** keyed `symbol|eventType|date`, preferring the richer record.
- **Ingest (`ingest-events.ts`)** — `upsertEvents()` does a `findUnique` on the
  `corporate_event_unique` key and **updates only when material fields changed** (exDate, recordDate,
  dividendAmount, description), else creates. Idempotent + reschedule-aware.
- **Jobs** — `runWeeklyEventIngest()` (next 30 days), `runDailyEventRefresh()` (next 7 days),
  `runEventBackfill(365)` walks backward in **30-day chunks** with 2 s sleeps and abort support.

### 10.4 Insider Trades — SEBI PIT (`insider-trades/`)

- **Source**: NSE `/api/corporates-pit` — all disclosures for a date range; universe filtering happens
  at parse time.
- **Fetch (`nse-pit-fetcher.ts`)** — `generateChunkRanges()` slices into **7-day** windows.
- **Parse (`pit-parser.ts`)** — robust date/bigint parsing; enum normalizers for person category,
  transaction type, security type, acquisition mode, regulation. `parseInsiderTradeRecord()` requires
  universe membership (else **filtered**, not skipped), computes `holdingPctDelta`, `tradeValueCr`,
  derived `tradePrice`. Returns `{records, skippedCount, filteredCount, totalRaw}`.
- **Ingest (`pit-ingester.ts`)** — inserts in **batches of 30** via `upsert` with **`update:{}`**
  (disclosures are immutable — existing rows just count as skipped). `wasDateFetchedSuccessfully()`
  lets the daily job skip done dates.
- **Jobs (`pit-jobs.ts`)** — `runDailyJob()` (today + yesterday, skips weekends/done dates),
  `runBackfillJob()` (argv months, 7-day chunks, **session reset every 3 chunks**),
  `runManualFetch(from, to, onProgress, signal)` (cancellable, progress callback).

### 10.5 News & Announcements (`news_and_announcements/`)

The most elaborate domain — a **two-phase** pipeline (fast insert, then async content extraction)
across three sources.

- **NSE announcements (`nse-announcements.ts`)** — `/api/corporate-announcements` via `nseClient`;
  builds absolute `nsearchives` PDF URLs; `detectHighImpact()` flags by category or headline keyword;
  marks `shouldExtract` for high-impact items with a PDF.
- **Google News (`google-news.ts`)** — `https.get` against the Google News RSS search (company
  suffixes stripped to improve hits); a minimal regex RSS parser pulls items; `parseTitle()` splits
  `"Headline - Publication"`; marks `shouldScrape`.
- **Content extractor (`content-extractor.ts`)** — drives Phase 2 with `PAYWALLED_DOMAINS` (never
  scraped — RSS snippet is best obtainable) and `FREE_DOMAINS` (scraped). `fetchBuffer()` manually
  follows redirects. **PDF extraction** (`extractPdfText`) lazily requires `pdf-parse`, extracts the
  **first 10 pages**, cleans, caps at **8000 chars (~2000 tokens)**. **Article scraping**
  (`extractArticleText`) uses cheerio with domain-specific selectors then a generic cascade, caps at
  **6000 chars (~1500 tokens)**, and **falls back to the RSS snippet** on failure/short output.
- **Ingest & orchestration (`ingest-news.ts`)** — Phase 1 `create`s rows, dedup via the unique
  constraint (`P2002` caught → `"skipped"`); sets `extractionStatus` at insert (paywalled Google items
  store the RSS snippet directly as `contentText`/`rss_snippet`/`skipped`). Daily jobs process the
  universe in **batches of 5** with **session resets every 3 batches** and inter-batch sleeps. Phase 2
  `runContentExtractionWorker(batchSize)` selects `extractionStatus="pending"` and
  `extractionAttempts<3`, extracts, writes `contentText`/`contentSource`/`contentTokens`, stamps
  `extractedAt`; on failure increments attempts and still stores the RSS snippet fallback.
- **Combined** — `runDailyNewsIngest()` runs NSE (2 days) + Google (7 days) then drains extraction;
  `runNewsBackfill(90)` re-runs NSE over a longer window then drains extraction in batches of 30.

### 10.6 EOD Prices — Provider Registry (`prices/`)

- **Provider abstraction (`providers/provider.ts`)** — the ingest layer talks only to
  `PriceProvider { fetchEod(date), ping() }`; the common DTO is `EodPrice`.
- **Registry & fallback (`registry.ts`)** — a factory map + `DEFAULT_CHAIN = ["nse-bhavcopy-csv",
  "bse-bhavcopy-csv"]`. `fetchWithFallback(date)` tries each provider in order, **returning the first
  with `prices.length>0`**, but short-circuits on a **"market likely closed"** signal (a holiday isn't a
  failure to fall back on). Throws an aggregated error if all fail.
- **NSE bhavcopy — primary (`providers/nse-bhavcopy.ts`)** — no key/session; downloads
  `sec_bhavdata_full_DDMMYYYY.csv`, parses with `csv-parse/sync`, keeps `SERIES==="EQ"`, converts
  `TURNOVER_LACS/100` → ₹Cr. **HTTP 404 = market closed** (returns the market-closed signal).
- **BSE bhavcopy — fallback (`providers/bse-bhavcopy.ts`)** — downloads a **ZIP** (date-dependent
  filename), unzips in memory with `adm-zip`, parses the CSV, matches on **ISIN** (BSE has no NSE symbol
  — stores company name as `symbol`).
- **Ingest (`ingest-prices.ts`)** — `insertDailyPrices()` appends via `createMany({skipDuplicates})`;
  `computeReturns()` runs **6 parallel queries** (nearest close ≤30/90/180/365 days, 52-week
  high/low aggregate, last-30-close sparkline); `updateSnapshots()` upserts `stockPrice` per stock
  (batches of 10). `runEodPriceIngest(date?)` guards re-runs, handles the market-closed case, upserts
  a `priceFetchLog`. `runPriceBackfill(365)` iterates weekdays with 500 ms spacing and abort support.

### 10.7 Shareholding Patterns — XBRL (`shareholdings/`)

- **Source**: NSE `/api/corporate-share-holdings-master` (index of filings) then the XBRL XML files on
  the static `nsearchives` host.
- **Dates (`shareholding-dates.ts`)** — `dateToQuarterFY()` maps a quarter-end date to Indian-FY labels.
- **Fetch (`shareholding-fetch.ts`)** — `fetchShareholdingIndex()` via `nseClient` (keeps `.xml` rows,
  carrying CSV-level promoter/public % for later validation); `fetchXbrlXml()` is a plain `https.get`
  (no session — static host).
- **Parse (`xbrl-parser.ts`)** — `parseXbrlShareholding()` handles SEBI LODR Reg-31 flat-XBRL using
  `fast-xml-parser` with **`isArray: () => true`** (critical — the same fact repeats per context).
  Builds a context→member map and a fact map, then resolves promoter/public/employee-trust %, FII
  (foreign institutions), DII (domestic, with MF/insurance/banks-FIs sub-breakdown), residual
  others/retail, share counts, and **pledging** (Table II encumbrance — absent values default to 0 per
  SEBI norms). Percentages rounded to 4 dp.
- **Ingest (`ingest-shareholding.ts`)** — `ingestShareholdingForStock(symbol, quartersBack)` fetches the
  index, takes the most recent N quarters, fetches+parses each XBRL (**preferring CSV-level promoter/
  public % when valid**), **upserts** on `stockId_asOnDate`, sleeps 800 ms between quarters, writes a
  `shareholdingFetchLog`.
- **Batch orchestration** — `runInBatches()` uses `Promise.allSettled` + a per-stock `Promise.race`
  timeout and **resets the NSE session every 3rd batch**. Jobs: `runQuarterlyShareholdingIngest()`
  (quartersBack 4), `runSmartShareholdingRefresh()` (only stocks with earnings 7–21 days ago,
  quartersBack 1), `runShareholdingBackfill(20)` (5-min/stock timeout).

---

## 11. Quarterly & Annual Results (XBRL) Pipeline

The most complex subsystem (`src/ingestions/quaterly-results/`). It ingests company results from NSE's
XBRL filings, parses them per industry taxonomy, derives analytical metrics, and upserts into per-
industry tables. Layers: **discovery → picking → parsing (taxonomy-dispatched) → deciding → ingesting**,
with a parallel **legacy** path for historical backfill.

### 11.1 Two XBRL generations

| | v3 (going-forward) | v2 (legacy backfill only) |
|---|---|---|
| Discovery endpoint | `/api/integrated-filing-results` | `/api/corporates-financial-results` |
| Namespace | `in-capmkt` / `in-capmkt-ent` | `in-bse-fin` |
| Coverage | Quarterly **and** Annual | Quarterly only |
| Industries | indas, banking, nbfc, li, gi | ind_as, banking only |
| Richness | P&L + BS + CFS + per-share | P&L only (~9 fields) |

End-to-end v3 flow for one symbol:

```
scanSymbol → fetchFilingsList → groupFilingsByPeriod → for each group:
  processGroup → pickBestFilingForQuarter → fetchXbrlFile → detectTaxonomy
              → industry check → parseQuarterly/parseAnnual → decideIngest
              → dispatchQuarterlyIngest/dispatchAnnualIngest → DB upsert
              → logFetch (ResultFetchLog at every decision)
```

### 11.2 Discovery (`results/discovery.ts`)

`fetchFilingsList(symbol, fiscalYearEnd)` hits the integrated-filing endpoint (one call returns all
quarterly + annual filings), filters to `"Integrated Filing- Financials"`, computes
`effectiveFilingDate = broadcast_Date ?? revised_Date ?? creation_Date`, and normalizes each into a
`NseFilingEntry` (preserving `consolidated`, `typeSub` Original/New/Revision, `audited`, and the raw
entry). `inferFilingType()` marks a filing **annual iff** its `qe_Date` month matches the stock's
fiscal-year-end month (`-MAR-` or `-DEC-`) — deliberately promoting both audited and unaudited
fiscal-year-end filings so insurer/NBFC `*_fundamental` tables get populated. `groupFilingsByPeriod()`
groups by `qeDate|filingType`.

### 11.3 XBRL extraction & contexts

- **`xbrl/extract.ts`** — regex extractors (`extractNumber`/`extractString`/`extractDate`) operate on
  the raw XBRL string (no DOM). **Unit-driven scaling**: `unitRef="INR"` ÷1e7 → ₹Crore; `pure` (ratios)
  and `shares` pass through. Values >1e15 or non-finite → null.
- **`xbrl/contexts.ts`** — four context refs (legacy BSE naming): `OneD` (current single period / Q4
  within an annual file), `FourD` (year-to-date / full year), `OneI` (end-of-period balance sheet),
  `PY_I` (prior year-end). Fiscal-boundary dates and the filing date are always in `OneD`.

### 11.4 Taxonomy detection & routing (`xbrl/taxonomy.ts`)

`detectTaxonomy(xml, url?)` reads the `in-capmkt-ent` namespace URL (`IntegratedFinance_<Banking|NBFC|
LI|GI|IndAS>`) with a filename fallback. `expectedTaxonomyForIndustry()` / `industryForTaxonomy()` tie
taxonomy to `Stock.industryType`. A **mismatch is a skip/error**, never silent misrouting.

### 11.5 Fiscal period derivation (`xbrl/parser-common.ts`)

`deriveFiscalPeriod(reportEnd, fyStart, fyEnd, filingType)` auto-detects the convention: `fyEnd` month
12 → calendar-year filer (Mar→Q1…Dec→Q4); else March-year filer (Jun→Q1…Mar→Q4). `fiscalYear` label =
`FY` + last two digits of `fyEnd`'s year; annual short-circuits to `{quarter:"Y", fiscalYear}`.
(`fiscal.ts` has an alternative months-elapsed variant; the parser-common version is the one used.)

### 11.6 Parser layer (`xbrl/parser*.ts`)

`parseQuarterly`/`parseAnnual` detect taxonomy, optionally enforce the expected industry, then `switch`
to the per-industry parser, returning a discriminated union tagged by taxonomy. Shared helpers:
`extractCommonPerShare`, `sumNullableTags` (sum across split tags, null only if all null). Per-industry:

- **Ind-AS (`parser-indas.ts`)** — compact quarterly P&L with fallback tag chains; rich annual (~70
  fields: full P&L + BS + CFS + per-share).
- **Banking (`parser-banking.ts`)** — Schedule-III P&L + GNPA/NNPA/CET1/AT1/ROA. **Q4 audit-gating**:
  if Q4 and GNPA-abs + NNPA-abs + CET1 + ROA are all zero/null, null out asset-quality/capital/
  profitability and set `auditPending=true`. Annual does no gating.
- **NBFC (`parser-nbfc.ts`)** — Schedule-III NBFC P&L; handles SEBI taxonomy typos (`FinanicalAssets`),
  payables summed across MSME/non-MSME.
- **Life Insurance (`parser-li.ts`)** — IRDAI two-account model; solvency + persistency ratios; derives
  `reinsuranceCeded = gross − net`; handles misspellings (`DefferedTax`, `IncomeFormInvestments`).
- **General Insurance (`parser-gi.ts`)** — GI revenue account + combined/loss/expense/retention ratios.

### 11.7 Picker & ingest decision (`picker.ts`)

`pickBestFilingForQuarter(candidates, industry)` — **consolidation preference**: non-financial prefers
**Consolidated**; all financial industries prefer **Standalone**. Tie-breaks by revision rank (Revision
> New > Original) then latest filing date. `decideIngest(...)` compares the picked filing to any
existing row and returns `ingest` (none exists) / `upgrade` (existing isn't preferred consolidation,
new one is) / `refresh` (same consolidation, newer filing date — a revision) / `skip`.

### 11.8 Scan flow (`scan.ts`)

`scanSymbol(symbol, opts)` loads the stock, discovers filings, applies a `fromQeDate` filter, groups,
and **processes groups oldest-first** (quarterly before annual on the same date) so QoQ/YoY/ROE-
averaging lookups see already-written prior rows. `processGroup()` picks, fetches the XBRL, enforces the
industry match, then for **annual** filings *also* attempts a **Q4** extraction from the same file's
`OneD` context (best-effort, non-fatal). `scanUniverse(opts)` iterates active stocks (industry/limit
filters) with a configurable inter-symbol delay (default 1500 ms) and aggregates per-symbol errors.
`logFetch()` upserts `ResultFetchLog` at every decision.

### 11.9 Ingesters (`ingesters/*`) + utils

Ten ingesters (one per industry × period) each compute derived metrics (often via prior-period/prior-
year lookups) and `upsert` keyed by the period's unique constraint, all tagged `xbrlTaxonomy:
"in_capmkt"`. `ingester-utils.ts` standardizes precision (`decimalRatio` 6 dp, `decimalPct`/
`decimalPerShare` 4 dp), null-safe `pctChange`, and `getPriorQuarter`/`decrementFY` for QoQ/YoY.
Representative derivations: Ind-AS annual computes `totalDebt`, `fcf = CFO − capex`, EBITDA, net worth,
**BVPS** (`netWorth / (paidUpEquity/faceValue)`), ROE on **average** equity, ROCE, turnover/coverage;
banking annual averages advances and interest-earning assets across years for credit cost & NIM; LI/GI
BVPS uses a **₹10 face-value fallback** (IRDAI norm) when the XBRL omits face value.

### 11.10 Legacy backfill path (`legacy/*`)

Manual-trigger-only (the `legacy_backfill` job) for pre-April-2025 quarters and disaster recovery.
- **`discovery-legacy.ts`** — hits the deprecated `/api/corporates-financial-results`; **its
  `fetchXbrlFile()` is the shared HTTPS XBRL fetcher imported by v3's `scan.ts`** (browser headers, 30 s
  timeout, one retry).
- **`parser-legacy-common.ts`** — parses the old `in-bse-fin` namespace (banking vs ind_as only,
  detected by tag presence); reuses the v3 `deriveFiscalPeriod`.
- **`adapter.ts`** — bridges v2 parsed output to the v3 dispatchable union, **routing by
  `Stock.industryType`** (because v2 classified NBFC/LI/GI as ind_as but they must land in the right
  v3 tables).
- **`backfill-legacy.ts`** — `backfillLegacyUniverse` (batches of 3, session reset every 3 batches) and
  `backfillLegacySymbol` (both Quarterly and Annual legs); each filing is parsed (v2) → adapted →
  dispatched to the **v3** ingesters with source tag `*_legacy`, logged to `ResultFetchLog`.

### 11.11 Top-level backfill (`backfill.ts`)

`backfillUniverse(opts)` and `backfillSymbols(symbols, opts)` are thin wrappers over `scanUniverse`/
`scanSymbol`, defaulting `fromQeDate` to **2025-04-01** (the v3 cutover) and `delayMs` to 1500.

### 11.12 Key cross-cutting decisions

- **Banking Q4 audit-gating** — null out audited fields + `auditPending` when a Q4 filing omits them.
- **Consolidation preference** — non-financial → Consolidated; financials → Standalone.
- **Annual ⇒ also Q4** — every Mar-31 annual file additionally yields a Q4 row (best-effort).
- **Chronological ingestion** — oldest-first so QoQ/YoY/averaging lookups find prior rows.
- **Unit-driven scaling** + **SEBI typo tolerance** + **industry mismatch guard**.

---

## 12. Peer Metrics, Libraries, Seeds & Tooling

### 12.1 Peer-Metrics computation engine

Split into a pure compute layer (`compute.ts`) and a service/orchestration layer
(`peer-metrics.service.ts`).

**Data & strategy** — per peer group, pulls latest-FY `fundamental` rows + current `stockPrice`. Uses
**median** for P/E and P/B (outlier-resistant) and **mean** for ROE/ROCE/margins/growth/coverage/
turnover; excludes nulls; requires **≥2 stocks** with data or the group is **skipped** (not failed).

**`compute.ts`** helpers: `median` (positive finite values only), `mean`, `round4`, `toNum`
(Decimal→number). `detectLatestFiscalYear()` picks the newest FY with data for ≥ half the group.
`computePeerGroupMetrics(peerGroupId)` computes **live P/E** (`price/eps`, fallback stored `peRatio`)
and **live P/B**, aggregates all averages, and persists the **seven headline averages** + 
`metricsUpdatedAt` to the `PeerGroup` row (operating margin / interest coverage / asset turnover are
computed and returned but **not** persisted to dedicated columns). `computeAllPeerGroupMetrics`
(ordered by `buildOrder`) and `computeSectorPeerGroupMetrics` add cooperative cancellation via a
`(done,total,label)=>Promise<boolean>` callback.

**`peer-metrics.service.ts`** — wraps compute with `peerGroupComputationLog` audit rows (including a
`computedSnapshot` JSON). Four triggers: `runScheduledPeerMetrics()` (monthly, all groups),
`runPostUploadPeerMetrics(stockId)` (only the affected group(s) after a results scan),
`runManualPeerMetrics({scope})` (admin: all/sector/single), `runPostSeedPeerMetrics()` (baseline).

### 12.2 Library utilities (`src/lib/`)

- **`client.ts`** — the `nseClient` singleton (documented in [§10.1](#101-shared-nse-session-client--srclibclientts)).
- **`multer.ts`** — two **memory-storage** instances: `upload` (Excel `.xlsx`/`.xls`, 10 MB, 1 file,
  MIME + extension fallback) and `zipUpload` (`.zip`, 50 MB). *(Not currently wired to any route.)*
- **`seed.ts`** — a standalone idempotent (upsert) seed for an **older** "InvestIQ" universe (7
  sectors, 27 peer groups, 150 stocks, with `marketCapCategory`). Distinct from the current Nifty-200
  scripts.

### 12.3 Prisma client setup — `db/prisma.ts`

Uses the **`@prisma/adapter-pg`** driver adapter over a `pg.Pool` (`keepAlive:true`,
`idleTimeoutMillis:30_000`, `max:5`). `prisma = new PrismaClient({ adapter })`. Imported everywhere as
`import { prisma } from "../db/prisma.js"`; `Prisma`/`PrismaClient` types come from the generated
client. All ESM imports use `.js` extensions (nodenext + `verbatimModuleSyntax`).

### 12.4 Zod schemas — `schema/schema.ts`

All request validation. Query schemas use `z.coerce.number()` + `.default(...)` so handlers get typed,
defaulted objects. Notable: `UploadBodySchema` (`symbol` regex permits `&`/`-` for `M&M`/`BAJAJ-AUTO`),
plus per-domain query/body schemas (`DealsQuerySchema`, `DailyPricesQuerySchema`, `CalendarQuerySchema`,
`InsiderTradesQuerySchema`, `NewsQuerySchema`, `ComputeBodySchema`, `PeerMetricsLogsQuerySchema`, and
the various `*LogsQuerySchema`/`*BackfillSchema`).

### 12.5 Seed & utility scripts (`src/scripts/` + `src/seed/`)

The **current Nifty-200 taxonomy**: 20 sectors, 200 stocks, 24 peer groups (14 core `buildOrder 1–14`
+ 10 alternate `101–110`).

- **Data modules** (no side effects): `sectors.seed.ts` (20 sectors + `SPREADSHEET_SECTOR_MAP`),
  `stocks.seed.ts` (200 stocks with a `verified` gate + rename notes), `extra-stocks.seed.ts` (19 peer
  benchmarks outside Nifty 200), `peer-groups.seed.ts` (24 groups; stocks may belong to multiple).
- **Runners** (idempotent upserts, run via `tsx`, `--dry-run` supported): `seed-nifty200.ts`
  (validates then upserts sectors + stocks, derives `industryType`, reports out-of-universe stocks),
  `seed-extra-stocks.ts`, `seed-peer-groups.ts`. **Run order**: nifty200 → extra-stocks → peer-groups.
- **Industry typing**: `industry-type-utils.ts` (`deriveIndustryType(symbol, sectorKey)` with a
  `SYMBOL_OVERRIDES` map taking priority over a sector heuristic), `refresh-industry-types.ts` (CLI
  recompute), and `src/seed/industry-types.ts` (the **route-callable** version: `refreshIndustryTypes()`
  + `refreshFiscalYearEnds()`, which sets `december` for symbols in `calendar-year-stocks.json`).
- **Backfill scripts**: `backfill-v3.ts` (CLI over the v3 results backfill: `--from`, `--limit`,
  `--industries`, `--symbols`), `yahoo-price-backfill.ts` (**5-year daily OHLCV from Yahoo Finance**
  into `daily_prices` append-only + `stock_prices` snapshot, `provider:"yahoo-finance"`, batched with
  per-IP rate limiting; flags `--years`, `--batch-size`, `--batch-delay`, `--symbols`, `--skip-existing`,
  `--dry-run`).
- **Audit / throwaway**: `audit-parser-tags.ts` (diffs XBRL tags vs parser `extract*` calls — surfaces
  data loss / null-producing tags), `test.ts` (scratch: one `nseClient.get` for TCS).

### 12.6 Build & tooling config

- **`tsconfig.json`** — `rootDir src`, `outDir dist`, `module nodenext`, `target esnext`, `strict`,
  `verbatimModuleSyntax`, `isolatedModules`, `esModuleInterop`, `skipLibCheck`.
- **`prisma.config.ts`** — `schema prisma/schema.prisma`, migrations path `prisma/migrations`,
  `datasource.url = DIRECT_URL` (migrations use the **direct** connection; runtime uses pooled
  `DATABASE_URL`).
- **`.gitignore`** — ignores `node_modules`, `.env`, `/dist`, and **`/src/generated/prisma`** (the
  generated client is regenerated, not committed — hence `postinstall: prisma generate`).

---

## 13. Cross-Cutting Conventions

- **Universe-first filtering** — every NSE pipeline loads active stocks into a `Map<symbol, stockId>`
  once per run and filters in memory; out-of-universe rows are counted as `skipped`/`filtered`.
- **Idempotent writes** — dedup is delegated to DB unique constraints:
  `createMany({skipDuplicates:true})` for append-only tables (deals, daily prices), explicit `upsert`
  for mutable/refreshable tables (events, price snapshot, shareholding, results), `upsert {update:{}}`
  for immutable rows (insider trades), and `P2002` catch for news.
- **Audit logs everywhere** — each domain writes a `*FetchLog`/computation-log row (status, counts,
  duration, error); several jobs read these to skip already-completed work.
- **Rate-limit discipline** — the shared `nseClient` enforces a 1.5 s per-request delay and 8-min
  session TTL; pipelines add inter-batch sleeps and `resetSession()` every ~3 batches to dodge NSE's
  silent session drops.
- **Everything heavy is a cancellable job** — cron never calls ingestion directly; backfills/scans
  enqueue progress-reporting, cancellable `BackgroundJob`s.
- **ESM + `.js` imports** — `verbatimModuleSyntax` requires explicit `import type` and `.js` extensions
  on relative imports throughout.

---

## 14. Known Issues / TODOs Surfaced During Review

These were noticed during the file-by-file read and are worth flagging (not necessarily bugs you must
fix, but things to be aware of):

- **No auth on "admin" routers** — admin is mount-path convention only; `job-routes.ts` flags real
  admin auth as a pre-public TODO. `JWT_SECRET` is parsed but unused.
- **Single-worker assumption** — `claimNextJob` isn't atomic across processes; running two workers will
  double-claim. Needs `SELECT … FOR UPDATE SKIP LOCKED` before horizontal scaling.
- **`getNewsBySymbolAndId` ignores `:symbol`** — looks up purely by `newsId`.
- **`getJobFull` exported but unrouted**; some multer configs (`upload`, `zipUpload`) are defined but
  unused; `REDIS_URL`/`DATABASE_PASSWORD` env keys are unused.
- **`seed-extra-stocks.ts`** sets `isActive:true` on create despite the data module's stated intent of
  `isActive:false` for peer-benchmark-only stocks — a likely bug.
- **Inconsistent pagination field naming** across domains (`pages` vs `totalPages`/`hasNext`/`hasPrev`
  vs `hasNextPage`/`hasPrevPage`).
- **Some admin bodies skip Zod** (events backfill `days`, news `days`/`batchSize`, shareholding
  `quarters`) — they use raw `parseInt` with clamps, so bad input silently falls back to defaults
  rather than returning `400`.
- **Peer-metrics extras not persisted** — operating margin, interest coverage, asset turnover, 3Y
  growth are computed/returned but have no dedicated `PeerGroup` columns.
- **Two parallel universe taxonomies** coexist — the older `lib/seed.ts` (150 stocks, friendly sector
  names) and the current Nifty-200 `scripts/` set (200 stocks, canonical sector keys). They are not
  interchangeable.
- **Directory spelling** — `src/ingestions/quaterly-results/` (missing an "r") is the real path.

---

*Generated by reading every file under `Vytal-Backend/` (schema, app/server, jobs, routes, controllers,
all ingestion pipelines, libraries, seeds, and config).*
