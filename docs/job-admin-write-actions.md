# Job admin write actions — DESIGN ONLY, nothing built

Retry, cancel, and arm/disarm-a-cron are writes to production jobs. This document is the
design; **no code in this repository implements any of it**, deliberately. The read-only
monitor API (`GET /api/v1/admin/jobs/{running,history,health}`) ships; the write half does
not.

---

## 1 · The audited path is not optional

There are already four writers that mutate operational state, and exactly **one** of them
records who did it.

| Writer | Audited? |
|---|---|
| `applyPolicyChange` (`controllers/admin/retention-controller.ts:98`) | **Yes** — policy UPDATE + `retention_policy_audit` INSERT in one transaction |
| `requestCancel` (`jobs/enqueue.ts:108`) | No — flips `cancel_requested` with no record of who |
| The two arming scripts (see the `RETENTION_CRON_ARMED` note in `scheduler.ts`) | No — `prisma.retentionPolicy.update` direct, so `retention_policy_audit` holds no row for the live arming of `daily_prices` |
| `triggerJob` (`scheduler.ts`) | No — enqueues with the cron's own `triggeredBy`, so a manual run is indistinguishable from a scheduled one |

There is **no DB trigger** on `retention_policy` (verified against `pg_trigger`: zero), so
audit coverage is a property of the code path and nothing else. A fifth unaudited writer is
therefore not a style problem — it is the difference between "we know who cancelled the
nightly prune" and "we do not".

**Design: one table, one helper, every write goes through it.**

```
model JobAdminAudit {
  id          String   @id @default(uuid())
  jobId       String?  @map("job_id")        // null for cron arm/disarm
  cronName    String?  @map("cron_name")     // null for per-job actions
  action      String                          // retry | cancel | arm_cron | disarm_cron
  jobType     String?  @map("job_type")
  beforeState Json?    @map("before_state")   // status/attempts/reclaimCount at the moment of the write
  afterState  Json?    @map("after_state")
  reason      String?  @db.Text               // REQUIRED for arm/disarm; optional for retry/cancel
  actedBy     String   @map("acted_by")       // req.authUser.userId — the TOKEN, never a payload field
  actedAt     DateTime @default(now()) @map("acted_at")
  @@index([actedAt(sort: Desc)])
  @@index([jobId])
  @@map("job_admin_audit")
}
```

Mirrors `RetentionPolicyAudit` on purpose: same `actedBy`-from-token rule, same
same-transaction discipline (`prisma.$transaction([update, auditInsert])` — the audit row
is written by the transaction that made the change, or neither happens).

---

## 2 · Retry

`POST /api/v1/admin/jobs/:id/retry` · `requireAdmin`

Re-enqueues a **terminal** job (`failed` / `abandoned` / `cancelled`) as a new row rather
than resurrecting the old one. A new row keeps the history honest: the failure that
prompted the retry stays visible with its error, and the retry has its own attempts budget.

- Refuses on `pending` / `running` (409) — the job is already going to run.
- Refuses when `RESTART_POLICIES[type] === "fail"` unless the caller passes
  `force: true` **and** a `reason`. `retention_prune` and `broker_poll_sync` are marked
  "fail" for stated reasons, and a panel button must not quietly overrule them.
- Copies `payload` and `type`; sets `triggeredBy: "admin_retry:<userId>"` so a manual
  re-run is never mistaken for a cron firing — the flaw `triggerJob` has today.
- Audit row: `action: "retry"`, `beforeState` = the terminal row's status/error,
  `afterState` = `{ newJobId }`.

## 3 · Cancel — and the part a panel must not lie about

`POST /api/v1/admin/jobs/:id/cancel` already exists (`jobs-controller.ts:133`). It needs the
audit wrapper, and the response needs to stop over-promising.

**⚠ Cancellation is cooperative, and for most job types it does nothing.** The audit is in
`CANCELLATION_SUPPORT` (`jobs/types.ts`), traced handler-into-service, and served on every
row by `GET /admin/jobs/running` and `GET /admin/jobs/history` as `cancellation`:

| Support | What a cancel actually does | Job types |
|---|---|---|
| **`checkpointed`** (17) | Stops at the next batch/symbol — genuinely cancellable | `price_backfill`, `index_prices_backfill`, `events_backfill`, `news_backfill`, `daily_news_ingest`, `nse_announcements_ingest`, `google_news_ingest`, `news_content_extraction`, `insider_trades_backfill`, `shareholding_backfill`, `shareholding_quarterly`, `shareholding_smart_refresh`, `peer_metrics_compute_all`, `legacy_backfill`, `pg_rescore`, `pg_cascade_rescore`, `fill_cascade_rescore` |
| **`signal_only`** (2) | Unwinds an in-flight HTTP call only; no checkpoint | `instrument_history_backfill`, **`results_scan`** |
| **`preflight_only`** (1) | Checked once before work starts; useless once running | `prices_refetch` |
| **`none`** (30) | **Nothing stops.** The row reads `cancelled` while the work runs to completion and its result is discarded | everything else — including **`instrument_corporate_actions`** and **`mf_analytics_daily`**, the two jobs in the 11 August incident, plus `retention_prune`, the three `filing_*` types, and all four udiff lanes |

**`results_scan` is the trap, and it looks like the opposite.** Its handler calls
`ctx.shouldCancel()` three times — and every one only skips a *progress write*
(`if (await ctx.shouldCancel()) return;` inside `onProgress`), never the scan. `ctx.signal`
reaches `fetchFilingsInWindow`, the up-front discovery call, and **not** the per-symbol XBRL
loop that runs for hours (`scan.ts:948`). So a cancel on a running universe scan — p95
**6.30h**, max 14.55h — stops nothing once discovery is done. A naive reader counting
`shouldCancel` occurrences would rank it among the *best*-covered handlers.

**What the panel must do with this:**
- `checkpointed` → normal Cancel button. After the click, show **"cancelling…"** until the
  row reaches a terminal status. Do not show "cancelled" on the 202.
- `signal_only` / `preflight_only` → Cancel enabled, with a warning naming the limit
  ("stops the current request; a scan already past discovery will run to completion").
- `none` → **disable the button**, or offer it only as "mark cancelled (the job will keep
  running)". Never render a plain Cancel.

The existing response message *"Cancellation requested. Will stop at next safe point."* is
false for 30 of 50 types and should be generated from `CANCELLATION_SUPPORT`, not hardcoded.

A genuine stop for a `none` type needs the handler to take `ctx.signal` — a per-handler
change, out of scope here and worth doing type by type, starting with `results_scan`
(longest-running) and `instrument_corporate_actions` (most operationally entangled).

## 4 · Arm / disarm a cron

`POST /api/v1/admin/crons/:name/{arm,disarm}` · `requireAdmin` · **`reason` required**

Today the only way to pause a scheduled job is a redeploy: `startScheduler()` registers from
a module-level array and `node-cron` tasks are never held. The filing backfill will need a
pause, and "redeploy to stop the ingest" is not an operational procedure.

Design — **a state table the scheduler consults at fire time, not task destruction:**

```
model CronState {
  name       String   @id
  disabled   Boolean  @default(false)
  disabledBy String?  @map("disabled_by")
  reason     String?  @db.Text
  updatedAt  DateTime @updatedAt @map("updated_at")
  @@map("cron_state")
}
```

The `register()` wrapper in `scheduler.ts` gains one read before `job.enqueue()`:

```ts
cron.schedule(job.schedule, async () => {
  const state = await cronStateFor(job.name);       // cached ~30s
  if (state?.disabled) {
    console.warn(`[Scheduler] ${job.name} SKIPPED — disabled by ${state.disabledBy}: ${state.reason}`);
    return;
  }
  ...
```

Why a gate rather than `task.stop()`:
- **It survives a restart.** A stopped in-memory task comes back armed on the next deploy —
  the worst possible behaviour for a pause someone set at 2am during an incident.
- **It is visible.** A row with `disabledBy` and `reason` answers "why has this not run?",
  which is precisely the question the 11 August stall could not answer.
- **The health check already understands it.** A disabled cron's missed firings would be
  reported as expected rather than as an incident — one join, no new detector.
- `RETENTION_CRON_ARMED` (a source constant) should fold into this table so there is one
  arming mechanism rather than two.

Audit: `action: "disarm_cron"`, `cronName`, `reason` (required), `actedBy` from the token.

---

## 5 · What is deliberately NOT designed here

- **No bulk retry/cancel.** One job, one click, one audit row.
- **No "retry all failed".** `quarter_brief` alone would enqueue 5,720 rows, of which 5,718
  are designed refusals that would refuse again.
- **No priority editing** — a panel that lets someone reorder the queue needs a story about
  starvation that this build does not have.
