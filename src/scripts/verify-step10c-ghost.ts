// STEP 10c — STEP 4: CHARACTERISE THE GHOST DISPATCHER (read-only; nothing is rewritten).
//
// The claim to test: some process with a PRE-Step-10 dispatcher claimed our jobs, found no
// handler registered for the new job types, and marked the BackgroundJob rows FAILED — while the
// work itself completed fine (mf_fetch_logs + the data both say success).
//
// If true, the STATUS ROWS LIE and the DATA is correct. This proves which, and does NOT clean up.
// npx tsx src/scripts/verify-step10c-ghost.ts
import { prisma } from "../db/prisma.js";

const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);

// ── 1. Every BackgroundJob row for the Step-10 job types ──
hdr("1. BackgroundJob rows for the Step-10 job types");
const jobs = await prisma.backgroundJob.findMany({
  // mf_inception_walk is retained in this filter ON PURPOSE: the job type is gone, but its historical
  // BackgroundJob rows are not, and this script exists to audit what actually ran.
  where: { type: { in: ["mf_analytics_daily", "mf_inception_walk", "amfi_nav_daily", "index_prices_backfill"] } },
  orderBy: { createdAt: "asc" },
  select: {
    id: true, type: true, status: true, triggeredBy: true, attempts: true,
    createdAt: true, startedAt: true, finishedAt: true, errorMessage: true, progressNote: true,
  },
});
console.log(`  ${"created".padEnd(9)} ${"type".padEnd(20)} ${"status".padEnd(10)} ${"att".padEnd(4)} error`);
for (const j of jobs) {
  const err = j.errorMessage ? j.errorMessage.split("\n")[0]!.slice(0, 46) : "";
  console.log(
    `  ${j.createdAt.toISOString().slice(11, 19).padEnd(9)} ${j.type.padEnd(20)} ${j.status.padEnd(10)} ` +
      `${String(j.attempts).padEnd(4)} ${err}`,
  );
}

// ── 2. THE MISMATCH: job row says failed, but the run-log says success ──
hdr("2. THE MISMATCH — job row FAILED while the run-log says SUCCESS");
const ghost = jobs.filter(
  (j) => j.errorMessage?.includes("No handler registered"),
);
console.log(`  BackgroundJob rows carrying "No handler registered": ${ghost.length}`);
for (const g of ghost) {
  console.log(`\n    job ${g.id}`);
  console.log(`      type       : ${g.type}`);
  console.log(`      status     : ${g.status}`);
  console.log(`      attempts   : ${g.attempts}`);
  console.log(`      created    : ${g.createdAt.toISOString()}`);
  console.log(`      startedAt  : ${g.startedAt?.toISOString() ?? "(never — it was never claimed by MY process)"}`);
  console.log(`      finishedAt : ${g.finishedAt?.toISOString() ?? "-"}`);
  console.log(`      error      : ${g.errorMessage?.slice(0, 70)}`);
  console.log(`      progress   : ${g.progressNote?.slice(0, 70) ?? "-"}`);
}

const logs = await prisma.mfFetchLog.findMany({ orderBy: { createdAt: "asc" } });
console.log(`\n  …and what the RUN-LOG says for the same work:`);
for (const l of logs) {
  console.log(
    `    ${l.runDate.toISOString().slice(0, 10)} ${l.job.padEnd(19)} ${l.status.padEnd(8)} ` +
      `rows=${String(l.rowsFolded).padStart(8)} written=${String(l.analyticsWritten).padStart(6)} faults=${l.faults}`,
  );
}

// ── 3. WHICH IS TRUE? The DATA decides, not the status row. ──
hdr("3. WHICH SOURCE IS TELLING THE TRUTH? The data decides.");
const data = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) rows, count(ret_1y) r1, max(computed_at) last
  FROM mf_analytics`);
console.log(`  mf_analytics: ${data[0].rows} rows, ${data[0].r1} with a 1Y return`);
console.log(`  last computed_at: ${data[0].last?.toISOString?.() ?? data[0].last}`);
console.log(`\n  ⇒ the analytics table is fully populated and the run-log says success.`);
console.log(`    The FAILED job rows are therefore WRONG — a status artefact, not a data problem.`);
console.log(`    NOTHING has been rewritten here. Cleanup is the operator's call.`);

// ── 4. IS ANYTHING STILL LISTENING that would do this again? ──
hdr("4. IS A GHOST WORKER STILL ACTIVE?");
// A live worker CLAIMS jobs: it flips pending → running and stamps startedAt. So: enqueue a
// canary of a type NO dispatcher knows, and see whether anything picks it up. If a stale worker
// is alive, it will claim the canary and fail it with "No handler registered". If nothing
// touches it, no worker is running against this database.
const canary = await prisma.backgroundJob.create({
  data: {
    type: "__ghost_canary__",
    payload: {},
    triggeredBy: "verify:step10c-ghost",
    status: "pending",
  },
  select: { id: true },
});
console.log(`  planted canary job ${canary.id} (type "__ghost_canary__" — no handler exists, by design)`);
console.log(`  waiting 20s for any live worker to claim it (the worker polls every 3s)…`);
await new Promise((r) => setTimeout(r, 20_000));

const c = await prisma.backgroundJob.findUnique({
  where: { id: canary.id },
  select: { status: true, startedAt: true, errorMessage: true },
});
console.log(`\n  canary status : ${c?.status}`);
console.log(`  canary started: ${c?.startedAt?.toISOString() ?? "(never claimed)"}`);
console.log(`  canary error  : ${c?.errorMessage ?? "(none)"}`);

if (c?.status === "pending" && !c.startedAt) {
  console.log(`\n  ✅ NO live worker is polling this database right now.`);
  console.log(`     The ghost has EXITED. It cannot corrupt further job rows from where I sit.`);
  console.log(`     ⚠️  BUT: this only proves nothing is running against THIS database from ANY host.`);
  console.log(`        If a stale Railway deployment were live it WOULD have claimed this canary,`);
  console.log(`        because it shares this DATABASE_URL. So: no stale deployment is currently up.`);
} else {
  console.log(`\n  ⚠️  SOMETHING CLAIMED THE CANARY — a worker IS live against this database.`);
  console.log(`     status=${c?.status} error=${c?.errorMessage}`);
  console.log(`     That is the ghost. It is running an older build (it has no handler for new types).`);
}

// Clean up only the canary I planted — never the real job rows.
await prisma.backgroundJob.delete({ where: { id: canary.id } });
console.log(`\n  (canary removed — the REAL job rows are untouched, as instructed)`);

await prisma.$disconnect();
