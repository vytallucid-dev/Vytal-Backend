// READ-ONLY recon part 2. No writes. Safe to delete.
import { prisma } from "../db/prisma.js";

const q = (sql: string) => prisma.$queryRawUnsafe(sql);
const show = (title: string, rows: unknown) => {
  console.log(`\n=== ${title} ===`);
  console.log(
    JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2),
  );
};

async function main() {
  show("results_scan — last 30d outcomes", await q(`
    SELECT status, COUNT(*)::int AS n,
           ROUND(((percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))/3600000.0)::numeric, 2) AS p95_h,
           ROUND((MAX(duration_ms)/3600000.0)::numeric, 2) AS max_h
    FROM background_jobs
    WHERE type='results_scan' AND created_at > now() - interval '30 days'
    GROUP BY status ORDER BY n DESC
  `));

  show("results_scan — abandoned rows: how long had they been running when reaped?", await q(`
    SELECT id, created_at, started_at, finished_at, progress,
           ROUND((EXTRACT(EPOCH FROM (finished_at - started_at))/3600.0)::numeric, 2) AS ghost_h
    FROM background_jobs
    WHERE type='results_scan' AND status='abandoned' AND created_at > now() - interval '30 days'
    ORDER BY created_at
  `));

  show("abandoned rows last 30d — grouped by finish instant (= boot times)", await q(`
    SELECT date_trunc('minute', finished_at) AS boot_minute,
           COUNT(*)::int AS n, string_agg(DISTINCT type, ', ') AS types,
           MIN(started_at) AS oldest_started
    FROM background_jobs
    WHERE status='abandoned' AND created_at > now() - interval '30 days'
    GROUP BY 1 ORDER BY 1
  `));

  // The 11 Aug window: what did the worker actually do between 11 Aug 19:00 and 14 Aug 12:00?
  show("EVERY job 11 Aug 19:00 → 14 Aug 13:00 (the stall window)", await q(`
    SELECT type, status, created_at, started_at, finished_at, progress,
           attempts, "triggeredBy"
    FROM background_jobs
    WHERE created_at >= '2026-08-11 19:00' AND created_at < '2026-08-14 13:00'
    ORDER BY created_at
  `));

  show("did instrument_corporate_actions rows exist for 12/13 Aug at all?", await q(`
    SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS n,
           string_agg(status, ',') AS statuses
    FROM background_jobs
    WHERE type='instrument_corporate_actions'
      AND created_at >= '2026-08-05' AND created_at < '2026-08-16'
    GROUP BY 1 ORDER BY 1
  `));

  show("progress distribution of ABANDONED rows (does progress prove liveness?)", await q(`
    SELECT type, progress, COUNT(*)::int AS n
    FROM background_jobs WHERE status='abandoned'
    GROUP BY 1,2 ORDER BY 1,2
  `));

  show("daily cron run counts per type, last 14d", await q(`
    SELECT type, date_trunc('day', created_at)::date AS day, COUNT(*)::int AS n
    FROM background_jobs
    WHERE created_at > now() - interval '14 days' AND "triggeredBy" LIKE 'cron:%'
    GROUP BY 1,2 ORDER BY 1,2
  `));

  show("distinct triggeredBy, 30d", await q(`
    SELECT "triggeredBy", COUNT(*)::int AS n
    FROM background_jobs WHERE created_at > now() - interval '30 days'
    GROUP BY 1 ORDER BY n DESC LIMIT 40
  `));

  show("table span + total rows", await q(`
    SELECT MIN(created_at) AS oldest, MAX(created_at) AS newest, COUNT(*)::int AS n
    FROM background_jobs
  `));

  show("background_jobs retention policy row", await q(`
    SELECT * FROM retention_policy WHERE table_name ILIKE '%background%'
  `));

  show("retention_policy columns", await q(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'retention_policy' ORDER BY ordinal_position
  `));

  show("retention_policy rows reporting a status error", await q(`
    SELECT * FROM retention_policy LIMIT 3
  `));

  // quarter_brief failure population — flagged, not in scope
  show("quarter_brief failures 30d — top error messages", await q(`
    SELECT LEFT("errorMessage", 90) AS err, COUNT(*)::int AS n
    FROM background_jobs
    WHERE type='quarter_brief' AND status='failed' AND created_at > now() - interval '30 days'
    GROUP BY 1 ORDER BY n DESC LIMIT 10
  `));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
