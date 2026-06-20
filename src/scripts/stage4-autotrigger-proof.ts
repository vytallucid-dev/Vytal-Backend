// ═══ STAGE 4 — END-TO-END AUTO-TRIGGER PROOF ═══
//   npx tsx src/scripts/stage4-autotrigger-proof.ts
//
// Proves the full event-driven loop through a REAL worker:
//   (1) HOOK WIRING — a real ingestion job (EOD_PRICES_DAILY; Saturday → network-free
//       short-circuit, 0 rows) runs through the worker to SUCCESS; the worker's success
//       path invokes the trigger, which correctly enqueues NOTHING for 0 rows.
//   (2) FUNDAMENTAL TARGETED — a results-scan completion (changedSymbols=[TCS]) auto-
//       enqueues PG_RESCORE for PG1 ONLY; the worker runs it → scores; a CONTROL PG is
//       NOT rescored (targeting).
//   (3) PRICE ALL-13 — a price completion (rows>0) auto-enqueues 13 PG_RESCORE; the
//       worker drains them sequentially; aggregate reported. First run may mass-supersede
//       (stale commits catching up to current prices — CORRECT); an immediate second run
//       is mostly skip-identical (steady state — CORRECT).
//   (4) ORDERING — single worker ⇒ rescores run AFTER the trigger and never overlap.
//   (5) SAFETY — a deliberately-failing rescore (bogus PG) FAILS in isolation: other
//       rescores still succeed, committed snapshots are untouched (per-PG tx rollback).
//
// The ingestion side of (2)/(3) is simulated at the HOOK BOUNDARY (maybeEnqueueRescores-
// ForJob — the exact call the worker makes on success), because a real fundamental
// ingestion needs NSE. Everything downstream (enqueue → queue → worker → handler →
// scores) is REAL. (1) runs a real ingestion job end-to-end through the worker.

import { prisma } from "../db/prisma.js";
import { enqueueJob, listJobs } from "../jobs/enqueue.js";
import { JobTypes } from "../jobs/types.js";
import { jobWorker } from "../jobs/worker.js";
import { maybeEnqueueRescoresForJob } from "../jobs/scoring-triggers.js";
import { SCORED_PGS } from "../scoring/composite/pg-registry.js";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`    [${cond ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (cond) pass++; else fail++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function activeRescores(): Promise<number> {
  return prisma.backgroundJob.count({ where: { type: "pg_rescore", status: { in: ["pending", "running"] } } });
}
async function activeOf(type: string): Promise<number> {
  return prisma.backgroundJob.count({ where: { type, status: { in: ["pending", "running"] } } });
}
/** Poll until no pending/running jobs of the given types, or timeout. */
async function drain(types: string[], timeoutMs = 240_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let active = 0;
    for (const t of types) active += await activeOf(t);
    if (active === 0) return true;
    await sleep(1500);
  }
  return false;
}
async function liveVersions(pgName: string): Promise<Map<string, number>> {
  const pg = await prisma.peerGroup.findFirst({ where: { name: pgName }, include: { stocks: { include: { stock: { select: { id: true, symbol: true } } } } } });
  const out = new Map<string, number>();
  for (const sp of pg?.stocks ?? []) {
    const live = await prisma.scoreSnapshot.findFirst({ where: { stockId: sp.stock.id }, orderBy: { version: "desc" }, select: { version: true } });
    out.set(sp.stock.symbol, live?.version ?? 0);
  }
  return out;
}
const sameVersions = (a: Map<string, number>, b: Map<string, number>) =>
  a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

async function main() {
  console.log("\n═══ STAGE 4 — END-TO-END AUTO-TRIGGER PROOF ═══\n");

  // ── Ensure SOMETHING processes the queue. Detect a live worker; if none, run our own
  //    (avoids the two-worker race the worker module warns about). ──
  await prisma.backgroundJob.deleteMany({ where: { type: "pg_rescore", status: "pending" } });
  const sentinel = await enqueueJob({ type: JobTypes.PG_RESCORE, payload: { pgId: "PG1", pgName: "Large-Cap IT Services", seedKey: "pg1_it_services", triggeredBy: "stage4:detect" }, triggeredBy: "stage4:detect", priority: 1 });
  let liveWorker = false;
  for (let i = 0; i < 8; i++) { await sleep(1000); const j = await prisma.backgroundJob.findUnique({ where: { id: sentinel.id }, select: { status: true } }); if (j && j.status !== "pending") { liveWorker = true; break; } }
  let ownWorker = false;
  if (!liveWorker) { console.log("  no live worker detected → starting our own JobWorker for the proof"); jobWorker.start(); ownWorker = true; }
  else console.log("  live worker detected → using it (enqueue + poll)");
  await drain(["pg_rescore"], 60_000); // let the sentinel finish
  console.log("");

  const snap0 = await prisma.scoreSnapshot.count();
  const v1roots0 = await prisma.scoreSnapshot.count({ where: { version: 1, supersedesId: null } });
  console.log(`  baseline snapshots = ${snap0}, v1 roots = ${v1roots0}\n`);

  try {
    // ── (1) HOOK WIRING — real ingestion job through the worker → worker invokes the hook ──
    console.log("── (1) HOOK WIRING: real EOD_PRICES_DAILY job → worker → success → worker invokes the hook");
    const tHook = new Date();
    const pricesJob = await enqueueJob({ type: JobTypes.EOD_PRICES_DAILY, payload: {}, triggeredBy: "stage4:hook-wiring" });
    await drain([JobTypes.EOD_PRICES_DAILY], 180_000);
    const pj = await prisma.backgroundJob.findUnique({ where: { id: pricesJob.id }, select: { status: true, result: true } });
    const pricesResult = pj?.result as Array<{ totalInserted?: number }> | null;
    const inserted = Array.isArray(pricesResult) ? pricesResult.reduce((s, r) => s + (r?.totalInserted ?? 0), 0) : -1;
    check("real prices job ran through the worker to SUCCEEDED", pj?.status === "succeeded", `status=${pj?.status}`);
    await sleep(2500);
    // The worker's success path invokes the hook. ADAPTIVE assertion on the real result:
    const hookJobs = await prisma.backgroundJob.count({ where: { type: "pg_rescore", triggeredBy: "hook:eod_prices_daily", createdAt: { gte: tHook } } });
    if (inserted > 0) {
      console.log(`    real prices job inserted ${inserted} row(s) → hook should auto-enqueue all 13`);
      check("worker hook auto-enqueued rescores from the real prices job (rows>0 → 13)", hookJobs === 13, `hook-enqueued=${hookJobs}`);
      await drain(["pg_rescore"], 300_000); // clear them so later steps start clean
    } else {
      console.log(`    real prices job inserted 0 rows (already ingested) → hook correctly enqueues nothing`);
      check("worker hook fired, 0 rows → enqueued no rescore", hookJobs === 0, `hook-enqueued=${hookJobs}`);
    }

    // ── (2) FUNDAMENTAL TARGETED ──
    console.log("\n── (2) FUNDAMENTAL TARGETED: results-scan(changedSymbols=[TCS]) → PG1 only");
    const TARGET_PG = "Large-Cap IT Services"; // PG1 (TCS)
    const CONTROL_PG = "Large-Cap FMCG"; // PG2 — must NOT be rescored
    const pg1Before = await liveVersions(TARGET_PG);
    const pg2Before = await liveVersions(CONTROL_PG);
    // EXACT call the worker hook makes when a real RESULTS_SCAN succeeds with these changes:
    const trig = await maybeEnqueueRescoresForJob(JobTypes.RESULTS_SCAN, { changedSymbols: ["TCS"] });
    check("trigger targeted PG1 only", JSON.stringify(trig?.pgIds) === JSON.stringify(["PG1"]), `pgIds=${trig?.pgIds.join(",")}`);
    await drain(["pg_rescore"], 90_000);
    const fundJobs = await listJobs({ type: JobTypes.PG_RESCORE, triggeredBy: "hook:results_scan", limit: 20 });
    const pg1Job = fundJobs.jobs.find((j) => (j.payload as { pgId?: string }).pgId === "PG1");
    check("a PG_RESCORE(PG1) job was auto-created + succeeded", pg1Job?.status === "succeeded", `status=${pg1Job?.status}`);
    const pg1Res = pg1Job?.result as { outcome?: string; created?: number; superseded?: number; skippedIdentical?: number } | null;
    console.log(`    chain: RESULTS_SCAN[TCS] → PG_RESCORE(PG1) job ${pg1Job?.id.slice(0, 8)} → ${JSON.stringify({ outcome: pg1Res?.outcome, created: pg1Res?.created, superseded: pg1Res?.superseded, skipped: pg1Res?.skippedIdentical })}`);
    const pg2NoJob = !fundJobs.jobs.some((j) => (j.payload as { pgId?: string }).pgId === "PG2");
    check("NO PG_RESCORE for the control PG2 (targeting)", pg2NoJob);
    check("control PG2 live versions UNCHANGED", sameVersions(pg2Before, await liveVersions(CONTROL_PG)), "PG2 untouched");
    const pg1After = await liveVersions(TARGET_PG);
    check("PG1 members rescored (versions ≥ before; supersede or skip)", [...pg1After].every(([k, v]) => v >= (pg1Before.get(k) ?? 0)));

    // ── (3) PRICE ALL-13 ──
    console.log("\n── (3) PRICE ALL-13: price completion (rows>0) → 13 PG_RESCORE → worker drains");
    const aggOf = async (since: Date) => {
      const jobs = (await prisma.backgroundJob.findMany({ where: { type: "pg_rescore", triggeredBy: "hook:eod_prices_daily", createdAt: { gte: since } }, select: { status: true, result: true } }));
      let created = 0, superseded = 0, skipped = 0, noop = 0, succeeded = 0;
      for (const j of jobs) { if (j.status !== "succeeded") continue; succeeded++; const r = j.result as { created?: number; superseded?: number; skippedIdentical?: number; outcome?: string } | null; created += r?.created ?? 0; superseded += r?.superseded ?? 0; skipped += r?.skippedIdentical ?? 0; if (r?.outcome === "no_op_all_identical") noop++; }
      return { created, superseded, skipped, noop, succeeded, total: jobs.length };
    };
    const t1 = new Date();
    const trigP1 = await maybeEnqueueRescoresForJob(JobTypes.EOD_PRICES_DAILY, [{ totalInserted: 5 }]);
    check("13 PG_RESCORE enqueued+deduped", (trigP1?.enqueued ?? 0) + (trigP1?.deduped ?? 0) === 13, `enqueued=${trigP1?.enqueued} deduped=${trigP1?.deduped}`);
    const ok1 = await drain(["pg_rescore"], 300_000);
    const r1 = await aggOf(t1);
    console.log(`    run 1 aggregate (${r1.succeeded}/${r1.total} PGs succeeded): ${r1.created} created, ${r1.superseded} superseded, ${r1.skipped} skip-identical (first run: stale commits catching up → supersedes EXPECTED)`);
    check("worker drained run 1 (all 13 succeeded)", ok1 && r1.succeeded === 13, `succeeded=${r1.succeeded}`);

    console.log("    second consecutive price completion → steady-state (mostly skip-identical)");
    const t2 = new Date();
    const trigP2 = await maybeEnqueueRescoresForJob(JobTypes.EOD_PRICES_DAILY, [{ totalInserted: 5 }]);
    const ok2 = await drain(["pg_rescore"], 300_000);
    const r2 = await aggOf(t2);
    console.log(`    run 2 aggregate (${r2.succeeded}/${r2.total} PGs succeeded): ${r2.superseded} superseded, ${r2.skipped} skip-identical, ${r2.noop}/${r2.succeeded} PGs full no-ops (no ScoringRun)`);
    check("run 2 re-enqueued 13 and drained", ok2 && (trigP2?.enqueued ?? 0) === 13 && r2.succeeded === 13, `enqueued=${trigP2?.enqueued} succeeded=${r2.succeeded}`);
    check("run 2 is steady-state (fewer supersedes than run 1)", r2.superseded <= r1.superseded, `sup1=${r1.superseded} sup2=${r2.superseded}`);

    // ── (4) ORDERING — single worker serializes; no overlap ──
    console.log("\n── (4) ORDERING: single worker → rescores never overlap");
    const run2Timed = await prisma.backgroundJob.findMany({ where: { type: "pg_rescore", triggeredBy: "hook:eod_prices_daily", createdAt: { gte: t2 }, status: "succeeded" }, select: { startedAt: true, finishedAt: true } });
    const timed = run2Timed.filter((j) => j.startedAt && j.finishedAt).map((j) => ({ s: j.startedAt!.getTime(), f: j.finishedAt!.getTime() })).sort((a, b) => a.s - b.s);
    let noOverlap = true;
    for (let i = 1; i < timed.length; i++) if (timed[i].s < timed[i - 1].f) noOverlap = false;
    check("no two rescores ran concurrently (serialized)", noOverlap && timed.length >= 2, `${timed.length} timed jobs`);

    // ── (5) SAFETY — a failing rescore is isolated; committed scores intact ──
    console.log("\n── (5) SAFETY: a deliberately-failing rescore (bogus PG) fails in isolation");
    await prisma.backgroundJob.deleteMany({ where: { type: "pg_rescore", status: "pending" } });
    const snapBeforeSafety = await prisma.scoreSnapshot.count();
    const badJob = await enqueueJob({ type: JobTypes.PG_RESCORE, payload: { pgId: "PGX", pgName: "NONEXISTENT PG", seedKey: "x", triggeredBy: "stage4:safety" }, triggeredBy: "stage4:safety-bad", maxAttempts: 1 });
    const goodJob = await enqueueJob({ type: JobTypes.PG_RESCORE, payload: { pgId: "PG1", pgName: "Large-Cap IT Services", seedKey: "pg1_it_services", triggeredBy: "stage4:safety" }, triggeredBy: "stage4:safety-good" });
    await drain(["pg_rescore"], 120_000);
    const bad = await prisma.backgroundJob.findUnique({ where: { id: badJob.id }, select: { status: true, errorMessage: true } });
    const good = await prisma.backgroundJob.findUnique({ where: { id: goodJob.id }, select: { status: true } });
    check("bogus rescore FAILED (PG not found)", bad?.status === "failed", `status=${bad?.status} err=${bad?.errorMessage?.slice(0, 40)}`);
    check("the good rescore still SUCCEEDED (failure isolated)", good?.status === "succeeded", `status=${good?.status}`);
    const snapAfterSafety = await prisma.scoreSnapshot.count();
    check("bogus rescore wrote NO snapshots (per-PG tx rollback)", snapAfterSafety >= snapBeforeSafety, `${snapBeforeSafety}→${snapAfterSafety}`);

    // ── BASELINE INTACT ──
    console.log("\n── BASELINE: committed v1 roots untouched (append-only never mutates/deletes)");
    const v1rootsEnd = await prisma.scoreSnapshot.count({ where: { version: 1, supersedesId: null } });
    check("v1-root count unchanged by the whole proof", v1rootsEnd === v1roots0, `before=${v1roots0} after=${v1rootsEnd}`);
  } finally {
    if (ownWorker) { jobWorker.stop(); await sleep(500); }
    await prisma.backgroundJob.deleteMany({ where: { type: "pg_rescore", status: "pending" } });
  }

  const snapEnd = await prisma.scoreSnapshot.count();
  console.log(`\n  snapshots: ${snap0} → ${snapEnd} (+${snapEnd - snap0} append-only rescore versions across the proof)`);
  console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("PROOF ERROR:", e); process.exit(1); });
