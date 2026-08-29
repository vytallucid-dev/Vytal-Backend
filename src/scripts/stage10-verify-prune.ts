// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 10d — DOES THE SUPERSEDE-CHAIN PRUNE ACTUALLY WORK NOW?
//
//   npx tsx src/scripts/stage10-verify-prune.ts             # dry: counts only, deletes nothing
//   npx tsx src/scripts/stage10-verify-prune.ts --live      # let the ARMED policy do its job
//
// ── WHY THIS EXISTS RATHER THAN A HAND-WRITTEN DELETE ────────────────────────────────────────────
// The cleanup this is checking is ALREADY IMPLEMENTED, armed, and scheduled: retention_policy carries
// `score_snapshots · supersede_chain · superseded_days 60 · floor 60`, and retention/engine.ts
// implements the whole cascade in the right order (null the chain pointer → delete snapshots, which
// CASCADEs score_patterns and SET-NULLs score_guardrail_events → delete orphan pillars → orphan
// peer_stats → orphan runs, RESTRICT-guarded so the database itself backstops).
//
// Writing a second delete path alongside that would be the actual mistake: two things that prune the
// same table, one of them not knowing about the cascade order. So this drives the REAL engine and
// only reports.
//
// ── WHAT WAS BROKEN ──────────────────────────────────────────────────────────────────────────────
// Every run failed with 23514 on `score_snapshots_findings_evaluated_ck`. That constraint was NOT
// VALID, which exempts existing rows from validation but STILL enforces on UPDATE — and the prune's
// first step updates legacy rows to null their chain pointer. The error was recorded inside the job
// result as {"table":"score_snapshots","status":"error"} while the job itself reported "succeeded",
// so 703 rows sat past their 60-day window unnoticed.
// Migration 20260826090000 scopes the constraint to the post-cutover era and makes it VALID.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { runRetention } from "../retention/engine.js";

const LIVE = process.argv.includes("--live");

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(96)}`);
  console.log(`STAGE 10d — supersede-chain prune  ${LIVE ? "*** LIVE ***" : "(dry — counts only)"}`);
  console.log("=".repeat(96));

  const before = await prisma.scoreSnapshot.count();
  const beforeOld = (await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
    WITH ranked AS (SELECT id, created_at, row_number() OVER (PARTITION BY stock_id, snapshot_type, period_key
                                                              ORDER BY version DESC, created_at DESC) rn
                      FROM score_snapshots)
    SELECT count(*)::int n FROM ranked WHERE rn > 1 AND created_at < now() - interval '60 days'`))[0].n;
  console.log(`\n  score_snapshots ${before} rows · ${beforeOld} superseded beyond the 60-day window\n`);

  const report = await runRetention({ dryRun: !LIVE });
  const mine = report.results.filter((r) => String(r.table).startsWith("score_"));

  console.log(`  ── score-layer policies ──`);
  for (const r of mine) {
    const head = `  ${String(r.table).padEnd(26)} ${String(r.mode).padEnd(16)} ${String(r.status).padEnd(8)}`;
    if (r.status === "error") { console.log(`${head} ⚠ ${String((r as { error?: string }).error).slice(0, 130)}`); continue; }
    console.log(`${head} matched ${String(r.matched).padStart(5)} · ${LIVE ? "deleted" : "would delete"} ${String(r.deleted).padStart(5)}` +
      `${r.held ? "  (HELD — armed=false)" : ""}`);
    const d = (r as { detail?: Record<string, unknown> }).detail;
    if (d) console.log(`     blast radius: ${JSON.stringify(d)}`);
  }

  const errored = mine.filter((r) => r.status === "error");
  const after = await prisma.scoreSnapshot.count();
  console.log(`\n  score_snapshots: ${before} -> ${after} (${after - before >= 0 ? "+" : ""}${after - before})`);
  console.log(`\n  ${errored.length === 0 ? "GATE PASSED — no score-layer policy errored" : `GATE FAILED — ${errored.length} policy error(s)`}`);
  if (!LIVE) console.log(`\n  dry run — re-run with --live to let the armed policy prune.\n`);
  await prisma.$disconnect();
  process.exit(errored.length ? 1 : 0);
}
main().catch(async (e) => { console.error(String(e).slice(0, 2500)); await prisma.$disconnect(); process.exit(1); });
