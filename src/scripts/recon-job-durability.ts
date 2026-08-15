// READ-ONLY recon for the job-durability build. No writes. Safe to delete.
//   npx tsx src/scripts/recon-job-durability.ts
import { prisma } from "../db/prisma.js";

const q = (sql: string) => prisma.$queryRawUnsafe(sql);
const show = (title: string, rows: unknown) => {
  console.log(`\n=== ${title} ===`);
  console.log(
    JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2),
  );
};

async function main() {
  show("columns of background_jobs", await q(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'background_jobs' ORDER BY ordinal_position
  `));

  show("indexes on background_jobs", await q(`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'background_jobs'
  `));

  show("constraints on background_jobs", await q(`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'background_jobs'
  `));

  show("triggers on background_jobs", await q(`
    SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'background_jobs' AND NOT tgisinternal
  `));

  show("overall status counts, last 30d", await q(`
    SELECT status, COUNT(*)::int AS n
    FROM background_jobs WHERE created_at > now() - interval '30 days'
    GROUP BY status ORDER BY n DESC
  `));

  show("per-type outcome, last 30d", await q(`
    SELECT type,
           COUNT(*)::int                                                        AS total,
           COUNT(*) FILTER (WHERE status='succeeded')::int                      AS succeeded,
           COUNT(*) FILTER (WHERE status='failed')::int                         AS failed,
           COUNT(*) FILTER (WHERE status='abandoned')::int                      AS abandoned,
           COUNT(*) FILTER (WHERE status='cancelled')::int                      AS cancelled,
           COUNT(*) FILTER (WHERE status='running')::int                        AS still_running,
           COUNT(*) FILTER (WHERE status='pending')::int                        AS still_pending,
           ROUND(100.0 * COUNT(*) FILTER (WHERE status='abandoned') / NULLIF(COUNT(*),0), 1) AS abandon_pct
    FROM background_jobs WHERE created_at > now() - interval '30 days'
    GROUP BY type ORDER BY abandoned DESC, total DESC
  `));

  show("duration percentiles per type (succeeded, 60d) — for the reaper threshold", await q(`
    SELECT type, COUNT(*)::int AS n,
           ROUND(MIN(duration_ms)/1000.0)::int                                                AS min_s,
           ROUND((percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms))/1000.0)::int      AS p50_s,
           ROUND((percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))/1000.0)::int      AS p95_s,
           ROUND(MAX(duration_ms)/1000.0)::int                                                AS max_s,
           ROUND(MAX(duration_ms)/3600000.0, 2)                                               AS max_h
    FROM background_jobs
    WHERE status='succeeded' AND duration_ms IS NOT NULL AND created_at > now() - interval '60 days'
    GROUP BY type ORDER BY max_s DESC
  `));

  show("ALL-TIME max duration per type (any terminal status)", await q(`
    SELECT type, ROUND(MAX(duration_ms)/3600000.0, 3) AS max_h, COUNT(*)::int AS n
    FROM background_jobs WHERE duration_ms IS NOT NULL
    GROUP BY type ORDER BY max_h DESC LIMIT 15
  `));

  show("currently RUNNING rows (live state)", await q(`
    SELECT id, type, status, started_at, created_at, progress, "progressNote",
           attempts, max_attempts, "triggeredBy",
           ROUND(EXTRACT(EPOCH FROM (now() - started_at))/3600.0, 2) AS running_h
    FROM background_jobs WHERE status='running' ORDER BY started_at
  `));

  show("currently PENDING rows", await q(`
    SELECT id, type, created_at, priority, "triggeredBy",
           ROUND(EXTRACT(EPOCH FROM (now() - created_at))/3600.0, 2) AS pending_h
    FROM background_jobs WHERE status='pending' ORDER BY created_at LIMIT 30
  `));

  // ── THE 11 AUGUST INCIDENT ────────────────────────────────────────────────
  show("instrument_corporate_actions — every row, last 45d", await q(`
    SELECT id, status, created_at, started_at, finished_at,
           ROUND(duration_ms/1000.0)::int AS dur_s, attempts, max_attempts,
           "errorMessage", "triggeredBy", progress
    FROM background_jobs
    WHERE type='instrument_corporate_actions' AND created_at > now() - interval '45 days'
    ORDER BY created_at
  `));

  show("mf_analytics_daily — 8-16 Aug", await q(`
    SELECT id, status, created_at, started_at, finished_at,
           ROUND(duration_ms/1000.0)::int AS dur_s, result::text AS result_text
    FROM background_jobs
    WHERE type='mf_analytics_daily'
      AND created_at >= '2026-08-08' AND created_at < '2026-08-17'
    ORDER BY created_at
  `));

  show("results_scan — last 30d outcomes", await q(`
    SELECT status, COUNT(*)::int AS n,
           ROUND((percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))/3600000.0, 2) AS p95_h,
           ROUND(MAX(duration_ms)/3600000.0, 2) AS max_h
    FROM background_jobs
    WHERE type='results_scan' AND created_at > now() - interval '30 days'
    GROUP BY status ORDER BY n DESC
  `));

  show("results_scan — every row last 30d", await q(`
    SELECT id, status, created_at, started_at, finished_at,
           ROUND(duration_ms/3600000.0, 3) AS dur_h, attempts, max_attempts,
           progress, LEFT(COALESCE("errorMessage",''), 120) AS err
    FROM background_jobs
    WHERE type='results_scan' AND created_at > now() - interval '30 days'
    ORDER BY created_at
  `));

  // Did the ABANDONED rows all get their finished_at stamped at a boot instant?
  show("abandoned rows last 30d — grouped by finish instant (= boot times)", await q(`
    SELECT date_trunc('minute', finished_at) AS boot_minute,
           COUNT(*)::int AS n, string_agg(DISTINCT type, ', ') AS types
    FROM background_jobs
    WHERE status='abandoned' AND created_at > now() - interval '30 days'
    GROUP BY 1 ORDER BY 1
  `));

  // How long do jobs actually go without a progress write?
  show("progress-write coverage: succeeded rows that ended at progress<>100 (30d)", await q(`
    SELECT type, COUNT(*)::int AS n, MIN(progress)::int AS min_progress
    FROM background_jobs
    WHERE status='succeeded' AND created_at > now() - interval '30 days'
    GROUP BY type ORDER BY n DESC LIMIT 20
  `));

  // Cron coverage: how many runs per type per day over the last 14 days
  show("daily run counts per type, last 14d (cron-coverage baseline)", await q(`
    SELECT type, date_trunc('day', created_at)::date AS day, COUNT(*)::int AS n
    FROM background_jobs
    WHERE created_at > now() - interval '14 days'
      AND "triggeredBy" LIKE 'cron:%'
    GROUP BY 1,2 ORDER BY 1,2
  `));

  show("distinct triggeredBy values, 30d", await q(`
    SELECT "triggeredBy", COUNT(*)::int AS n
    FROM background_jobs WHERE created_at > now() - interval '30 days'
    GROUP BY 1 ORDER BY n DESC LIMIT 40
  `));

  show("oldest + newest row in the table (retention window)", await q(`
    SELECT MIN(created_at) AS oldest, MAX(created_at) AS newest, COUNT(*)::int AS n
    FROM background_jobs
  `));

  // retention_policy status errors (3a input)
  show("retention_policy columns", await q(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'retention_policy' ORDER BY ordinal_position
  `));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
