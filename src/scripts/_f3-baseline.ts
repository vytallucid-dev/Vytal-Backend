// ═══════════════════════════════════════════════════════════════
// F3 PRE-APPLY GATE + BASELINE. READ-ONLY.
//   1. background_jobs quiesce check against the DB CLOCK (same gate as the D1 delete)
//   2. full 40-policy dryRun:true baseline
//   3. full retention_policy row snapshot → JSON, for the F3b/F3f byte-identity diff
//   npx tsx src/scripts/_f3-baseline.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { runRetention } from "../retention/engine.js";

const OUT = process.env.F3_BASELINE_PATH ?? "./_f3-baseline.json";
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lpad = (s: unknown, n: number) => String(s).padStart(n);
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];

async function main() {
  // ── 1. QUIESCE GATE ─────────────────────────────────────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F3 GATE — background_jobs quiesce, measured against the DB clock           ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const [clock] = await raw(`SELECT now()::text AS db_now, current_setting('TIMEZONE') AS tz`);
  console.log(`  DB clock: ${clock.db_now}  (tz ${clock.tz})   host clock: ${new Date().toISOString()}`);

  const byStatus = await raw(`SELECT "status", count(*)::int AS n FROM background_jobs GROUP BY 1 ORDER BY 1`);
  console.log(`  background_jobs by status:`);
  for (const r of byStatus) console.log(`    ${pad(r.status, 14)} ${lpad(r.n, 6)}`);

  const live = await raw(
    `SELECT "id", "type", "status", "created_at"::text AS created, "started_at"::text AS started
       FROM background_jobs WHERE "status" IN ('pending','running') ORDER BY "created_at"`);
  const blocking = live.length;
  console.log(`\n  running/pending RIGHT NOW: ${blocking}`);
  for (const j of live) console.log(`    ⚠ ${j.id}  ${j.type}  ${j.status}  created=${j.created} started=${j.started ?? "-"}`);

  // The retention cron fires 21:30 UTC; make sure we are nowhere near it.
  const [win] = await raw(
    `SELECT date_part('hour', now() AT TIME ZONE 'UTC')::int AS h, date_part('minute', now() AT TIME ZONE 'UTC')::int AS m`);
  console.log(`  UTC now ${lpad(win.h, 2)}:${String(win.m).padStart(2, "0")} · nightly retention prune fires 21:30 UTC (lib/scheduler.ts:949)`);

  if (blocking > 0) {
    console.log(`\n  ✗ HOLD — ${blocking} job(s) running/pending. Not applying. Report and wait.`);
    await prisma.$disconnect();
    process.exit(2);
  }
  console.log(`  ✓ QUIESCED — zero running/pending jobs.`);

  // ── 2. BASELINE DRY-RUN ─────────────────────────────────────
  const t0 = new Date();
  const report = await runRetention({ dryRun: true });
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F3e BASELINE — full 40-policy dry-run, captured BEFORE the migration       ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(` startedAt=${report.startedAt}  ${report.durationMs} ms`);
  console.log(` totalMatched=${report.totalMatched}  totalDeleted=${report.totalDeleted} (MUST be 0)  clampsFired=${report.clampsFired}`);
  console.log(`  ${pad("table", 36)}${pad("mode", 16)}${lpad("matched", 9)}${lpad("deleted", 8)}${lpad("effective", 10)}${lpad("floor", 7)}${lpad("clamp", 7)}  gate`);
  for (const r of [...report.results].sort((a, b) => a.table.localeCompare(b.table))) {
    const gate = r.status === "skipped_disabled" ? "disabled" : r.armed ? "armed" : "held";
    console.log(
      `  ${pad(r.table, 36)}${pad(r.mode, 16)}${lpad(r.matched, 9)}${lpad(r.deleted, 8)}${lpad(r.effective ?? "-", 10)}${lpad(r.floor, 7)}${lpad(r.clamped ? "YES" : "no", 7)}  ${gate}${r.error ? "  ERROR: " + r.error : ""}`);
  }
  console.log(` policies=${report.results.length}  errors=${report.results.filter((r) => r.status === "error").length}  nonzero-matched=${report.results.filter((r) => r.matched > 0).length}`);

  // ── 3. FULL POLICY SNAPSHOT ─────────────────────────────────
  const policies = await prisma.retentionPolicy.findMany({ orderBy: { table: "asc" } });
  writeFileSync(OUT, JSON.stringify({
    capturedAt: t0.toISOString(),
    dbNow: clock.db_now,
    jobsRunningPending: blocking,
    report,
    policies: policies.map((p) => ({
      table: p.table, mode: p.mode, keep: p.keep, days: p.days, supersededDays: p.supersededDays,
      floor: p.floor, floorReason: p.floorReason, armed: p.armed, enabled: p.enabled,
      orderCol: p.orderCol, keyCols: p.keyCols, tsColumn: p.tsColumn, exceptWhere: p.exceptWhere,
    })),
  }, null, 2));
  console.log(`\n  snapshot of all ${policies.length} policy rows (incl. floor_reason) → ${OUT}`);
  console.log(`  (READ-ONLY: dryRun:true — zero mutating statements.)\n`);
  await prisma.$disconnect();
  process.exit(report.totalDeleted === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
