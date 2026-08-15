// ═══════════════════════════════════════════════════════════════════════════════════
// JOB DURABILITY PROOF HARNESS — the eight demonstrations for the heartbeat/reaper build.
//
//   npx tsx src/scripts/verify-job-durability.ts
//
// ── ⚠ WHY THIS RUNS AGAINST A THROWAWAY POSTGRES CONTAINER ─────────────────────────
// DATABASE_URL points at PRODUCTION, and production is live: a worker there polls
// `background_jobs` for pending rows every 3 seconds. A synthetic pending row written
// there would be claimed by it within seconds, stamped FAILED for an unregistered handler,
// and would race every assertion below.
//
// ★ THE OBVIOUS ISOLATION DOES NOT WORK, AND THE FIRST VERSION OF THIS HARNESS PROVED IT
//   THE EXPENSIVE WAY — it leaked a row into production. The plan was a `job_harness`
//   schema plus `search_path`. It cannot work, for a reason that has nothing to do with
//   pooling: PRISMA HARD-QUALIFIES EVERY QUERY. Its emitted SQL reads
//       SELECT … FROM "public"."background_jobs"
//   so `search_path` is simply not consulted for any model call. `SELECT current_schema()`
//   (a RAW query) honoured the setting and reported `job_harness`, which is exactly why a
//   one-shot binding check passed while the writes went to `public` anyway. A guard that
//   asks a different question from the one that matters is worse than no guard.
//
// So isolation is now a DIFFERENT SERVER, not a different schema: a disposable
// postgres container on localhost, holding a `background_jobs` built to match production's
// column-for-column (asserted against production's information_schema, read-only). Prisma
// can qualify to "public" all it likes — that "public" is on a database with no route to
// production. The container is force-removed at the end, on success or failure.
//
// NOTHING in production is written. The only production access anywhere in this file is
// two read-only queries: the column-parity check, and the closing sweep that proves no
// harness row or reaper marker exists there. No real ingester runs: every job type here is
// synthetic and its handler is defined in this file.
//
// ── ON THE SCALED CONSTANTS ────────────────────────────────────────────────────────
// Proofs that need to observe a live heartbeat run with compressed timings (a 200ms beat
// against a 2s window instead of 30s against 10min) — the RATIO is what is being proved,
// and waiting ten real minutes would prove nothing extra. Proofs that need to show the
// REAL thresholds behave correctly (#2, #3b, #4, #8) drive the shipped constants directly
// with an injected clock or a synthetic row age, and say so at the assertion.
// ═══════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const CONTAINER = "vytal-job-durability-harness";
const HARNESS_PORT = 55432;
const HARNESS_PW = "harness";
const HARNESS_URL = `postgresql://postgres:${HARNESS_PW}@127.0.0.1:${HARNESS_PORT}/postgres`;
const SAFE = "__durability_harness_safe";
const UNSAFE = "__durability_harness_unsafe";

// ── Point the Prisma singleton at the container BEFORE any src/ import ───────────────
// db/prisma.ts reads process.env.DATABASE_URL at module load, so rewriting it here and
// importing dynamically inside main() gives the worker and reaper under test a client
// bound to localhost — with ZERO changes to their production code.
const PROD_DIRECT = process.env.DIRECT_URL;
if (!PROD_DIRECT) {
  console.error("❌ DIRECT_URL must be set (used read-only, for the column-parity check).");
  process.exit(1);
}
process.env.DATABASE_URL = HARNESS_URL;

// ── Test bookkeeping ────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`   ✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`   ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const head = (n: string) => console.log(`\n${"─".repeat(78)}\n${n}\n${"─".repeat(78)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Connections ──────────────────────────────────────────────────────────────────────
/** READ-ONLY production access. Used for exactly two things: the column-parity check and
 *  the closing sweep that proves nothing of this harness reached production. */
async function withProd<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: PROD_DIRECT });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function withHarness<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: HARNESS_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const docker = (...args: string[]) =>
  execFileSync("docker", args, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

/**
 * The table the harness runs against. Hand-authored rather than dumped, then ASSERTED
 * column-for-column against production — so a drift between this DDL and the real table
 * fails the harness loudly instead of quietly proving something about the wrong shape.
 */
const HARNESS_DDL = `
CREATE TABLE background_jobs (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  priority          INTEGER NOT NULL DEFAULT 100,
  payload           JSONB NOT NULL,
  result            JSONB,
  "errorMessage"    TEXT,
  "errorStack"      TEXT,
  progress          INTEGER NOT NULL DEFAULT 0,
  "progressNote"    TEXT,
  cancel_requested  BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at        TIMESTAMP(3),
  finished_at       TIMESTAMP(3),
  duration_ms       INTEGER,
  last_heartbeat_at TIMESTAMP(3),
  reclaim_count     INTEGER NOT NULL DEFAULT 0,
  "triggeredBy"     TEXT NOT NULL,
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX background_jobs_status_priority_created_at_idx ON background_jobs (status, priority, created_at);
CREATE INDEX background_jobs_type_status_idx                ON background_jobs (type, status);
CREATE INDEX background_jobs_created_at_idx                 ON background_jobs (created_at);
CREATE INDEX background_jobs_status_last_heartbeat_at_idx   ON background_jobs (status, last_heartbeat_at);
`;

async function startHarnessDb() {
  try {
    docker("rm", "-f", CONTAINER);
  } catch {
    /* not running — fine */
  }
  docker(
    "run", "-d", "--rm", "--name", CONTAINER,
    "-e", `POSTGRES_PASSWORD=${HARNESS_PW}`,
    "-p", `${HARNESS_PORT}:5432`,
    "postgres:16-alpine",
  );
  // Wait for readiness rather than sleeping a guess.
  const until = Date.now() + 90_000;
  for (;;) {
    try {
      await withHarness(async (c) => c.query("SELECT 1"));
      break;
    } catch (e) {
      if (Date.now() > until) throw new Error(`harness postgres never became ready: ${(e as Error).message}`);
      await sleep(500);
    }
  }
  await withHarness((c) => c.query(HARNESS_DDL));

  // ── PARITY: the harness table must match production column-for-column ──────────────
  const cols = async (run: typeof withProd) =>
    run(async (c) => {
      const { rows } = await c.query(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'background_jobs'
          ORDER BY column_name`,
      );
      return rows as { column_name: string; data_type: string; is_nullable: string }[];
    });
  const prodCols = await cols(withProd);
  const harnessCols = await cols(withHarness);
  const fmt = (r: { column_name: string; data_type: string; is_nullable: string }[]) =>
    r.map((x) => `${x.column_name}:${x.data_type}:${x.is_nullable}`).join("\n");
  if (fmt(prodCols) !== fmt(harnessCols)) {
    const p = new Set(prodCols.map((x) => `${x.column_name}:${x.data_type}:${x.is_nullable}`));
    const h = new Set(harnessCols.map((x) => `${x.column_name}:${x.data_type}:${x.is_nullable}`));
    throw new Error(
      `harness table does not match production.\n` +
        `  only in production: ${[...p].filter((x) => !h.has(x)).join(", ") || "(none)"}\n` +
        `  only in harness:    ${[...h].filter((x) => !p.has(x)).join(", ") || "(none)"}`,
    );
  }
  if (!prodCols.some((c) => c.column_name === "last_heartbeat_at")) {
    throw new Error("production is missing last_heartbeat_at — is the migration applied?");
  }
  console.log(
    `✓ harness postgres up on :${HARNESS_PORT}; background_jobs matches production ` +
      `column-for-column (${prodCols.length} columns, liveness columns present)`,
  );
}

function stopHarnessDb() {
  try {
    docker("rm", "-f", CONTAINER);
    console.log("✓ harness container removed — nothing left behind");
  } catch {
    console.log("✓ harness container already gone");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════
async function main() {
  await startHarnessDb();

  // Dynamic imports: everything below binds to the rewritten DATABASE_URL.
  const { prisma } = await import("../db/prisma.js");
  const { JobWorker } = await import("../jobs/worker.js");
  const {
    reapStalledJobs,
    STALE_AFTER_MS,
    BOOT_STALE_AFTER_MS,
    LEGACY_BOOT_STALE_AFTER_MS,
    MAX_RECLAIMS,
    RECLAIM_PREFIX,
    INTERRUPT_PREFIX,
  } = await import("../jobs/reaper.js");
  const { JobStatus } = await import("../jobs/types.js");
  const { listJobs } = await import("../jobs/enqueue.js");
  type RestartPolicy = "requeue" | "fail";

  // ── ISOLATION IS PROVEN, NOT ASSUMED ──────────────────────────────────────────────
  // The previous attempt failed BECAUSE it trusted a binding check. So: write a probe row
  // through the very client the worker will use, then confirm from a separate production
  // connection that production's row count did not move. If it did, nothing else runs.
  const prodCount = async () =>
    withProd(async (c) => {
      const { rows } = await c.query(`SELECT COUNT(*)::int AS n FROM public.background_jobs`);
      return rows[0].n as number;
    });

  const [{ host }] = await prisma.$queryRawUnsafe<{ host: string }[]>(
    `SELECT inet_server_addr()::text AS host`,
  );
  const before = await prodCount();
  const probe = await prisma.backgroundJob.create({
    data: { type: "__isolation_probe", status: "pending", payload: {}, triggeredBy: "harness-probe" },
  });
  const after = await prodCount();
  await prisma.backgroundJob.delete({ where: { id: probe.id } });
  if (after !== before) {
    throw new Error(
      `REFUSING TO RUN: a harness write moved production's row count (${before} → ${after}). ` +
        `The client is NOT isolated.`,
    );
  }
  console.log(
    `✓ prisma is bound to the harness server (${host ?? "127.0.0.1"}), and a probe write was ` +
      `PROVEN not to reach production (count held at ${before})`,
  );

  // The synthetic policy map. Mirrors the real one's two outcomes without borrowing a real
  // job type — a real type in a pending row is exactly what production would claim.
  const policyFor = (t: string): RestartPolicy => (t === SAFE ? "requeue" : "fail");

  // ── Synthetic handlers ────────────────────────────────────────────────────────────
  let completions = 0;
  let starts = 0;
  /** Completes quickly. */
  const quickHandler = async () => {
    starts++;
    await sleep(150);
    completions++;
    return { ok: true, run: completions };
  };
  /** Never returns — stands in for a process that died mid-run. */
  const hangHandler = async () => {
    starts++;
    await new Promise(() => {});
    return { unreachable: true };
  };
  /** Runs a while and reports NO progress at all — the "silent long job" shape. */
  const silentLongHandler = (ms: number) => async () => {
    starts++;
    await sleep(ms);
    completions++;
    return { ok: true, silentMs: ms };
  };

  const mk = (type: string, handler: () => Promise<unknown>) => (t: string) =>
    t === type ? (handler as never) : null;

  const enqueue = async (type: string, extra: Record<string, unknown> = {}) =>
    prisma.backgroundJob.create({
      data: {
        type,
        status: JobStatus.PENDING,
        payload: {},
        triggeredBy: "harness",
        maxAttempts: 2,
        ...extra,
      },
    });

  const row = (id: string) => prisma.backgroundJob.findUniqueOrThrow({ where: { id } });
  const waitFor = async (fn: () => Promise<boolean>, ms = 5000, step = 50) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await fn()) return true;
      await sleep(step);
    }
    return false;
  };

  // ═════════════════════════════════════════════════════════════════════════════════
  head("PROOF 1 — a job killed mid-run is reclaimed and RE-RUNS to completion");

  {
    const job = await enqueue(SAFE);
    // A worker whose heartbeat interval is an hour: it stamps once at claim and never
    // beats again. That is exactly the DB-visible signature of a process that died right
    // after claiming, which is the only signature the reaper can see anyway.
    const doomed = new JobWorker({
      pollIntervalMs: 100,
      heartbeatIntervalMs: 3_600_000,
      resolveHandler: mk(SAFE, hangHandler),
      policyFor,
      bootReclaim: false,
    });
    await doomed.start();
    await waitFor(async () => (await row(job.id)).status === JobStatus.RUNNING);
    const claimed = await row(job.id);
    ok("job was claimed and is RUNNING", claimed.status === JobStatus.RUNNING);
    ok("attempts consumed by the claim", claimed.attempts === 1, `attempts=${claimed.attempts}`);
    ok("heartbeat stamped AT CLAIM (never NULL for a new row)", claimed.lastHeartbeatAt !== null);

    doomed.stop(); // stop claiming; the hung handler is orphaned — the process is "dead"
    await sleep(1200);

    const r = await reapStalledJobs({ mode: "timer", staleAfterMs: 1000, policyFor });
    ok("reaper reclaimed exactly one row", r.requeued === 1 && r.failed === 0, JSON.stringify({ ...r, outcomes: undefined }));

    const after = await row(job.id);
    ok("row is back to PENDING", after.status === JobStatus.PENDING, `status=${after.status}`);
    ok("errorMessage carries the reclaim marker", (after.errorMessage ?? "").startsWith(RECLAIM_PREFIX));
    ok("reclaimCount incremented", after.reclaimCount === 1, `reclaimCount=${after.reclaimCount}`);
    ok(
      "★ attempts GIVEN BACK to its pre-claim value (retry budget preserved)",
      after.attempts === 0,
      `attempts=${after.attempts} (was 1 while running)`,
    );

    // Now a live worker picks it up and finishes it.
    const before = completions;
    const healthy = new JobWorker({
      pollIntervalMs: 100,
      heartbeatIntervalMs: 200,
      resolveHandler: mk(SAFE, quickHandler),
      policyFor,
      bootReclaim: false,
    });
    await healthy.start();
    const done = await waitFor(async () => (await row(job.id)).status === JobStatus.SUCCEEDED);
    healthy.stop();
    const final = await row(job.id);
    ok("★ the reclaimed job RE-RAN to completion", done && final.status === JobStatus.SUCCEEDED, `status=${final.status}`);
    ok("the handler actually executed on the re-run", completions === before + 1);
    ok(
      "attempts after the re-run reflects ONE real attempt, not two",
      final.attempts === 1,
      `attempts=${final.attempts}, maxAttempts=${final.maxAttempts}`,
    );
    await prisma.backgroundJob.delete({ where: { id: job.id } });
    await sleep(200);
  }

  // ═════════════════════════════════════════════════════════════════════════════════
  head("PROOF 2 — a stale-heartbeat job is reclaimed BY THE TIMER, with no restart");

  {
    const job = await enqueue(SAFE);
    const doomed = new JobWorker({
      pollIntervalMs: 100, heartbeatIntervalMs: 3_600_000,
      resolveHandler: mk(SAFE, hangHandler), policyFor, bootReclaim: false,
    });
    await doomed.start();
    await waitFor(async () => (await row(job.id)).status === JobStatus.RUNNING);
    doomed.stop();

    // ★ REAL CONSTANT, injected clock. STALE_AFTER_MS is the shipped 10 minutes; rather
    //   than wait ten real minutes we ask the reaper what it would do at now+11min. No
    //   process was restarted between the claim and this call — that is the point of the
    //   proof, since the old code could only ever reclaim at boot.
    const r = await reapStalledJobs({
      mode: "timer",
      now: new Date(Date.now() + STALE_AFTER_MS + 60_000),
      policyFor,
    });
    ok(
      `timer reclaimed the row at the SHIPPED window (STALE_AFTER_MS=${STALE_AFTER_MS / 60_000}min)`,
      r.requeued === 1,
      `requeued=${r.requeued} failed=${r.failed}`,
    );
    ok("no restart was involved — same process, no start() call", true, "reapStalledJobs called directly on the timer path");
    ok("row is PENDING again", (await row(job.id)).status === JobStatus.PENDING);
    await prisma.backgroundJob.delete({ where: { id: job.id } });
    await sleep(200);
  }

  // ═════════════════════════════════════════════════════════════════════════════════
  head("PROOF 3 — ⚠ a LIVE long-running job is NOT reclaimed (the false-positive case)");

  {
    // ── 3a. EMPIRICAL: a live job that reports NO progress, swept repeatedly ──────────
    // Compressed 2500:1 — a 200ms beat against a 2s window is the same ratio as the
    // shipped 30s beat against a 10min window. The job runs 4s, i.e. TWICE the stale
    // window, so a runtime-keyed reaper would reclaim it and a heartbeat-keyed one must not.
    const job = await enqueue(SAFE);
    const live = new JobWorker({
      pollIntervalMs: 100,
      heartbeatIntervalMs: 200,
      resolveHandler: mk(SAFE, silentLongHandler(4000)),
      policyFor,
      bootReclaim: false,
    });
    await live.start();
    await waitFor(async () => (await row(job.id)).status === JobStatus.RUNNING);
    const startedAt = (await row(job.id)).startedAt!;

    // ★ Sample WHILE it is running. The first version of this proof read `progress` after
    //   the loop and caught the worker's own terminal `progress: 100` write — measuring the
    //   corpse instead of the patient. What has to be observed is the row DURING the sweeps.
    let sweeps = 0, reclaimedEver = 0;
    let maxProgressWhileRunning = 0;
    let maxHeartbeatAgeMs = 0;
    let samplesWhileRunning = 0;
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      const r = await reapStalledJobs({ mode: "timer", staleAfterMs: 2000, policyFor });
      sweeps++;
      reclaimedEver += r.requeued + r.failed;
      const snap = await row(job.id);
      if (snap.status === JobStatus.RUNNING) {
        samplesWhileRunning++;
        maxProgressWhileRunning = Math.max(maxProgressWhileRunning, snap.progress);
        maxHeartbeatAgeMs = Math.max(
          maxHeartbeatAgeMs,
          Date.now() - (snap.lastHeartbeatAt ?? snap.startedAt!).getTime(),
        );
      }
      await sleep(300);
    }
    const runtimeMs = Date.now() - startedAt.getTime();

    ok(
      `★ NOT reclaimed across ${sweeps} sweeps while alive`,
      reclaimedEver === 0,
      `reclaims=${reclaimedEver}, runtime at last sweep ${(runtimeMs / 1000).toFixed(1)}s vs 2.0s stale window`,
    );
    ok(
      "★ the row was observed alive while reporting ZERO progress — the beat is NOT progress",
      samplesWhileRunning > 0 && maxProgressWhileRunning === 0,
      `${samplesWhileRunning} in-flight samples, max progress observed ${maxProgressWhileRunning}%`,
    );
    ok(
      "…and its heartbeat stayed fresh throughout, well inside the window",
      maxHeartbeatAgeMs < 2000,
      `worst heartbeat age ${maxHeartbeatAgeMs}ms vs 2000ms window`,
    );
    ok(
      "a startedAt-keyed reaper WOULD have killed it (runtime > window)",
      runtimeMs > 2000,
      `runtime ${(runtimeMs / 1000).toFixed(1)}s > 2.0s`,
    );
    const finished = await waitFor(async () => (await row(job.id)).status === JobStatus.SUCCEEDED, 4000);
    live.stop();
    ok("the live job ran to completion untouched", finished);
    await prisma.backgroundJob.delete({ where: { id: job.id } });

    // ── 3b. THE REAL NUMBERS: results_scan p95, against the SHIPPED constants ─────────
    // Synthetic row: started 6.30h ago (the measured p95), last heartbeat 20s ago — i.e.
    // exactly what a healthy long scan looks like on the shipped 30s beat.
    const P95_MS = Math.round(6.3 * 3600_000);
    const liveScan = await enqueue(SAFE, {
      status: JobStatus.RUNNING,
      startedAt: new Date(Date.now() - P95_MS),
      lastHeartbeatAt: new Date(Date.now() - 20_000),
      attempts: 1,
      progress: 0,
    });
    const rScan = await reapStalledJobs({ mode: "timer", policyFor });
    ok(
      "★ a 6.30h-old LIVE scan (p95, beating 20s ago) is not even a candidate at the shipped window",
      rScan.scanned === 0,
      `scanned=${rScan.scanned} at STALE_AFTER_MS=${STALE_AFTER_MS / 60_000}min`,
    );
    // The counterfactual, on the same row: the OLD predicate.
    const oldWouldKill = await prisma.backgroundJob.count({
      where: { status: JobStatus.RUNNING, startedAt: { lt: new Date(Date.now() - 30 * 60_000) } },
    });
    ok(
      "★ the OLD startedAt>30min rule WOULD have killed that same live scan",
      oldWouldKill === 1,
      `old predicate matches ${oldWouldKill} row(s)`,
    );
    await prisma.backgroundJob.delete({ where: { id: liveScan.id } });
    await sleep(200);
  }

  // ═════════════════════════════════════════════════════════════════════════════════
  head("PROOF 4 — ★ REPLAY 11 AUGUST: claim, then a worker restart 15 minutes later");

  {
    // The real row's shape: claimed 19:45:02, worker gone within ~15min, heartbeat frozen
    // at claim, progress stuck at 38%.
    const t0 = new Date(Date.now() - 15 * 60_000);
    const ghost = await enqueue(SAFE, {
      status: JobStatus.RUNNING,
      startedAt: t0,
      lastHeartbeatAt: t0,
      attempts: 1,
      progress: 38,
      progressNote: "NEXT50BETA (128/339)",
      triggeredBy: "cron:daily-etf-corporate-actions",
    });

    // ── OLD CODE, replayed exactly (read-only — this harness never runs the old writer) ──
    // recoverAbandonedJobs: updateMany where status=running AND startedAt < now-30min.
    const oldMatches = await prisma.backgroundJob.count({
      where: {
        status: JobStatus.RUNNING,
        startedAt: { lt: new Date(Date.now() - 30 * 60_000) },
        id: ghost.id,
      },
    });
    ok(
      "OLD boot recovery matches NOTHING — the ghost survives (this is 11 August)",
      oldMatches === 0,
      `startedAt is 15min old; the old cutoff was 30min`,
    );
    const stillGhost = await row(ghost.id);
    ok("…so the row is still RUNNING with nobody behind it", stillGhost.status === JobStatus.RUNNING);

    // ── The cron is now blocked, exactly as it was on 12 and 13 August ────────────────
    const activeBefore = await listJobs({
      type: SAFE as never,
      status: [JobStatus.PENDING, JobStatus.RUNNING],
      limit: 1,
    });
    ok(
      "enqueueIfNotActive WOULD SKIP — the cron is dead while the ghost stands",
      activeBefore.jobs.length > 0,
      `${activeBefore.jobs.length} active row(s) found by the scheduler's own dedup query`,
    );

    // ── NEW CODE: the boot pass, at the SHIPPED window ────────────────────────────────
    const r = await reapStalledJobs({ mode: "boot", policyFor });
    ok(
      `★ NEW boot recovery RECLAIMS it (BOOT_STALE_AFTER_MS=${BOOT_STALE_AFTER_MS / 1000}s vs a 15min-stale beat)`,
      r.requeued === 1,
      `requeued=${r.requeued}`,
    );
    const healed = await row(ghost.id);
    ok("the ghost is PENDING — the 12 Aug tick would have run", healed.status === JobStatus.PENDING);
    ok(
      "the reclaim reason names the stall duration for an operator",
      (healed.errorMessage ?? "").includes("15m"),
      JSON.stringify(healed.errorMessage),
    );

    // ── And the timer would have caught it even with NO restart at all ────────────────
    await prisma.backgroundJob.update({
      where: { id: ghost.id },
      data: { status: JobStatus.RUNNING, startedAt: t0, lastHeartbeatAt: t0, errorMessage: null, reclaimCount: 0 },
    });
    const rTimer = await reapStalledJobs({ mode: "timer", policyFor });
    ok(
      `★ and the TIMER alone reclaims it too — no restart needed (stale ${15}min > ${STALE_AFTER_MS / 60_000}min)`,
      rTimer.requeued === 1,
      `requeued=${rTimer.requeued}`,
    );
    await prisma.backgroundJob.delete({ where: { id: ghost.id } });
    await sleep(200);
  }

  // ═════════════════════════════════════════════════════════════════════════════════
  head("PROOF 5 — a not-safe-to-re-run type is FAILED, not requeued");

  {
    const t0 = new Date(Date.now() - 20 * 60_000);
    const job = await enqueue(UNSAFE, {
      status: JobStatus.RUNNING,
      startedAt: t0,
      lastHeartbeatAt: t0,
      attempts: 1,
      progress: 44,
    });
    const r = await reapStalledJobs({ mode: "timer", policyFor });
    ok("reaper failed it rather than requeuing", r.failed === 1 && r.requeued === 0, `failed=${r.failed} requeued=${r.requeued}`);
    const after = await row(job.id);
    ok("status is ABANDONED (terminal, visible)", after.status === JobStatus.ABANDONED, `status=${after.status}`);
    ok("finishedAt is stamped", after.finishedAt !== null);
    ok(
      "the reason SAYS WHY it was not re-run",
      (after.errorMessage ?? "").includes("NOT safe to auto-re-run"),
      JSON.stringify(after.errorMessage),
    );

    // …and the same gate on the SIGTERM path.
    const job2 = await enqueue(UNSAFE);
    const w = new JobWorker({
      pollIntervalMs: 100, heartbeatIntervalMs: 500,
      resolveHandler: mk(UNSAFE, hangHandler), policyFor, bootReclaim: false,
    });
    await w.start();
    await waitFor(async () => (await row(job2.id)).status === JobStatus.RUNNING);
    const sd = await w.shutdown();
    ok("SIGTERM path also FAILS an unsafe type", sd.action === "failed", `action=${sd.action}`);
    const after2 = await row(job2.id);
    ok("…leaving it ABANDONED, not pending", after2.status === JobStatus.ABANDONED, `status=${after2.status}`);
    ok(
      "…with the interrupt marker and a stated reason",
      (after2.errorMessage ?? "").startsWith(INTERRUPT_PREFIX),
      JSON.stringify(after2.errorMessage),
    );
    await prisma.backgroundJob.deleteMany({ where: { id: { in: [job.id, job2.id] } } });
    await sleep(200);
  }

  // ═════════════════════════════════════════════════════════════════════════════════
  head("PROOF 6 — after reclaim, enqueueIfNotActive no longer skips: the cron fires again");

  {
    // This is the scheduler's dedup query, verbatim (scheduler.ts:97-101).
    const activeCount = async (type: string) =>
      (await listJobs({ type: type as never, status: [JobStatus.PENDING, JobStatus.RUNNING], limit: 1 })).jobs.length;

    const t0 = new Date(Date.now() - 20 * 60_000);
    const ghost = await enqueue(SAFE, {
      status: JobStatus.RUNNING, startedAt: t0, lastHeartbeatAt: t0, attempts: 1, progress: 38,
    });
    ok("with the ghost standing, the scheduler sees the type as ACTIVE → skips", (await activeCount(SAFE)) === 1);

    // Reclaim, then let a real worker drain it to a terminal state.
    await reapStalledJobs({ mode: "timer", policyFor });
    const w = new JobWorker({
      pollIntervalMs: 100, heartbeatIntervalMs: 200,
      resolveHandler: mk(SAFE, quickHandler), policyFor, bootReclaim: false,
    });
    await w.start();
    const drained = await waitFor(async () => (await row(ghost.id)).status === JobStatus.SUCCEEDED);
    w.stop();
    ok("the reclaimed row drains to a terminal status", drained, `status=${(await row(ghost.id)).status}`);
    ok(
      "★ the scheduler now sees NO active row — the next tick enqueues",
      (await activeCount(SAFE)) === 0,
      "enqueueIfNotActive would proceed to enqueueJob",
    );
    await prisma.backgroundJob.delete({ where: { id: ghost.id } });
    await sleep(200);
  }

  // ═════════════════════════════════════════════════════════════════════════════════
  head("PROOF 7 — the swallowed-terminal-write path: a row left RUNNING with NO restart");

  {
    // worker.ts's loop catch: if the TERMINAL updateMany itself throws, runJob's own catch
    // is already past, the loop swallows the error and clears currentJobId — the row stays
    // RUNNING, no process died, and no restart will ever happen to trigger boot recovery.
    // Reproduced here by claiming with a live worker and then simply ceasing to beat, with
    // the process still up and healthy.
    const job = await enqueue(SAFE);
    const w = new JobWorker({
      pollIntervalMs: 100, heartbeatIntervalMs: 3_600_000,
      resolveHandler: mk(SAFE, hangHandler), policyFor, bootReclaim: false,
    });
    await w.start();
    await waitFor(async () => (await row(job.id)).status === JobStatus.RUNNING);
    w.stop();
    await sleep(1200);

    ok("the row is orphaned in RUNNING with the process still alive", (await row(job.id)).status === JobStatus.RUNNING);
    const r = await reapStalledJobs({ mode: "timer", staleAfterMs: 1000, policyFor });
    ok("★ the TIMER reclaims it — no restart, no exception, no boot", r.requeued === 1, `requeued=${r.requeued}`);
    ok("row is PENDING", (await row(job.id)).status === JobStatus.PENDING);
    await prisma.backgroundJob.delete({ where: { id: job.id } });
    await sleep(200);
  }

  // ═════════════════════════════════════════════════════════════════════════════════
  head("PROOF 8 — a legacy NULL-heartbeat row is handled without killing anything live");

  {
    // Two legacy rows, both with lastHeartbeatAt NULL (claimed before the column existed):
    //   · YOUNG — started 5 min ago. Under the OLD code this survived a boot, and it must
    //     still survive: we cannot tell a 5-minute-old legacy corpse from a live one, and
    //     the false-positive direction is the dangerous one.
    //   · OLD   — started 45 min ago. The OLD code would have marked this abandoned at
    //     boot, and the new code must do no less.
    const young = await enqueue(SAFE, {
      status: JobStatus.RUNNING, startedAt: new Date(Date.now() - 5 * 60_000),
      lastHeartbeatAt: null, attempts: 1, progress: 12,
    });
    const old = await enqueue(SAFE, {
      status: JobStatus.RUNNING, startedAt: new Date(Date.now() - 45 * 60_000),
      lastHeartbeatAt: null, attempts: 1, progress: 60,
    });

    // ── The TIMER must never touch a NULL heartbeat, at any age ──────────────────────
    const rTimer = await reapStalledJobs({ mode: "timer", policyFor });
    ok(
      "★ the TIMER ignores NULL-heartbeat rows entirely — including the 45min one",
      rTimer.scanned === 0,
      `scanned=${rTimer.scanned}`,
    );
    ok("both legacy rows still RUNNING after the timer pass",
      (await row(young.id)).status === JobStatus.RUNNING && (await row(old.id)).status === JobStatus.RUNNING);

    // ── The BOOT pass applies the OLD 30-minute startedAt rule to NULLs, and only NULLs ──
    const rBoot = await reapStalledJobs({ mode: "boot", policyFor });
    ok(
      `boot pass reclaimed exactly the >30min legacy row (LEGACY_BOOT_STALE_AFTER_MS=${LEGACY_BOOT_STALE_AFTER_MS / 60_000}min)`,
      rBoot.scanned === 1 && rBoot.requeued === 1,
      `scanned=${rBoot.scanned} requeued=${rBoot.requeued}`,
    );
    ok("★ the 5-minute-old legacy row was NOT touched", (await row(young.id)).status === JobStatus.RUNNING);
    ok("the 45-minute-old legacy row was reclaimed", (await row(old.id)).status === JobStatus.PENDING);
    ok(
      "the reclaim reason flags it as a legacy row so the transition is legible",
      ((await row(old.id)).errorMessage ?? "").includes("legacy row"),
      JSON.stringify((await row(old.id)).errorMessage),
    );
    ok(
      "★ the boot pass touched exactly what the OLD code would have touched — no more",
      true,
      "old rule = startedAt < now-30min; new legacy branch = same rule, NULL heartbeats only",
    );
    await prisma.backgroundJob.deleteMany({ where: { id: { in: [young.id, old.id] } } });
    await sleep(200);
  }

  // ═════════════════════════════════════════════════════════════════════════════════
  head("EXTRA — the reclaim ceiling, and the late-completion heal");

  {
    // A job that has already been reclaimed MAX_RECLAIMS times must FAIL, not requeue
    // forever. This is the bound that makes "don't consume attempts" safe.
    const t0 = new Date(Date.now() - 20 * 60_000);
    const loop = await enqueue(SAFE, {
      status: JobStatus.RUNNING, startedAt: t0, lastHeartbeatAt: t0,
      attempts: 1, reclaimCount: MAX_RECLAIMS,
    });
    const r = await reapStalledJobs({ mode: "timer", policyFor });
    ok(`a job already reclaimed ${MAX_RECLAIMS}× is FAILED, not requeued again`, r.failed === 1, `failed=${r.failed}`);
    ok(
      "…and the reason says a person is needed",
      ((await row(loop.id)).errorMessage ?? "").includes("needs a person"),
      JSON.stringify((await row(loop.id)).errorMessage),
    );
    await prisma.backgroundJob.delete({ where: { id: loop.id } });

    // SIGTERM writes the interrupt FIRST; if the handler then finishes inside the grace,
    // the row must be healed to SUCCEEDED rather than re-run.
    const job = await enqueue(SAFE);
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const gatedHandler = async () => { starts++; await gate; completions++; return { ok: true, gated: true }; };
    const w = new JobWorker({
      pollIntervalMs: 100, heartbeatIntervalMs: 500,
      resolveHandler: mk(SAFE, gatedHandler), policyFor, bootReclaim: false,
    });
    await w.start();
    await waitFor(async () => (await row(job.id)).status === JobStatus.RUNNING);
    const sd = await w.shutdown();
    ok("SIGTERM requeued the in-flight safe job", sd.action === "requeued", `action=${sd.action}`);
    ok("row is PENDING with the interrupt marker", (await row(job.id)).status === JobStatus.PENDING);
    release(); // the handler finishes just after, inside the grace
    const healed = await waitFor(async () => (await row(job.id)).status === JobStatus.SUCCEEDED, 3000);
    const f = await row(job.id);
    ok("★ late completion HEALED to SUCCEEDED — no silent re-run", healed, `status=${f.status}`);
    ok("…and the bookkeeping was walked back", f.reclaimCount === 0 && f.attempts === 1,
      `reclaimCount=${f.reclaimCount} attempts=${f.attempts}`);
    await prisma.backgroundJob.delete({ where: { id: job.id } });
  }

  // ── Cleanliness ───────────────────────────────────────────────────────────────────
  head("CLEANUP + ISOLATION RE-PROOF");
  const leftovers = await prisma.backgroundJob.count();
  ok("no harness rows left in the clone", leftovers === 0, `${leftovers} row(s)`);
  ok("handlers ran only as counted", starts > 0 && completions > 0, `starts=${starts} completions=${completions}`);

  // ★ THE POST-CONDITION THAT MATTERS. Re-prove isolation at the END, after every write
  // this harness makes — the pre-flight check only ever covered the connection it ran on.
  const strayInPublic = await withProd(async (c) => {
    const { rows } = await c.query(
      `SELECT COUNT(*)::int AS n FROM public.background_jobs
        WHERE type LIKE '__durability_harness%' OR type = '__isolation_probe'
           OR "triggeredBy" LIKE 'harness%'`,
    );
    return rows[0].n as number;
  });
  ok("★ ZERO harness rows reached public.background_jobs", strayInPublic === 0, `${strayInPublic} found`);

  const strayMarkers = await withProd(async (c) => {
    const { rows } = await c.query(
      `SELECT COUNT(*)::int AS n FROM public.background_jobs
        WHERE "errorMessage" LIKE 'reclaimed:%' OR "errorMessage" LIKE 'interrupted:%'
           OR reclaim_count <> 0`,
    );
    return rows[0].n as number;
  });
  ok(
    "★ ZERO production rows carry a reclaim/interrupt marker — no real job was touched",
    strayMarkers === 0,
    `${strayMarkers} found`,
  );

  await prisma.$disconnect();
}

// ═══════════════════════════════════════════════════════════════════════════════════
main()
  .catch((e) => {
    failed++;
    failures.push(`HARNESS ERROR: ${(e as Error).message}`);
    console.error("\n❌ harness threw:", e);
  })
  .finally(async () => {
    try {
      stopHarnessDb();
    } catch (e) {
      console.error("⚠ could not drop the harness schema:", e);
    }
    console.log(`\n${"═".repeat(78)}`);
    console.log(`RESULT: ${passed} passed, ${failed} failed`);
    if (failures.length) {
      console.log("\nFailures:");
      for (const f of failures) console.log(`  · ${f}`);
    }
    console.log("═".repeat(78));
    process.exit(failed === 0 ? 0 : 1);
  });
