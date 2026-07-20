// GATE 3 — END-TO-END through the REAL job path: enqueueJob → dispatcher → handler.
// Exactly what the cron and the admin trigger do. Proves the run-log + handler wiring too.
//   npx tsx src/scripts/verify-step10b-e2e.ts nav
//   npx tsx src/scripts/verify-step10b-e2e.ts analytics
//   npx tsx src/scripts/verify-step10b-e2e.ts inception [fromYear]
import { prisma } from "../db/prisma.js";
import v8 from "v8";
import { enqueueJob } from "../jobs/enqueue.js";
import { getHandler } from "../jobs/dispatcher.js";
import { makeJobContext } from "../jobs/context.js";
import { JobTypes, type JobType } from "../jobs/types.js";

const MB = (b: number) => (b / 1048576).toFixed(1);
const mode = process.argv[2] ?? "nav";

// (the `inception` mode is gone with MF_INCEPTION_WALK — see the drop migration)
const JOB: Record<string, { type: JobType; payload: unknown }> = {
  nav: { type: JobTypes.AMFI_NAV_DAILY, payload: {} },
  analytics: { type: JobTypes.MF_ANALYTICS_DAILY, payload: {} },
  "corporate-actions": { type: JobTypes.INSTRUMENT_CORPORATE_ACTIONS, payload: {} },
};

const spec = JOB[mode];
if (!spec) { console.error(`unknown mode: ${mode}`); process.exit(1); }

let peakHeap = 0, peakRss = 0;
const sampler = setInterval(() => {
  const m = process.memoryUsage();
  peakHeap = Math.max(peakHeap, m.heapUsed);
  peakRss = Math.max(peakRss, m.rss);
}, 100);

console.log(`heap_size_limit = ${MB(v8.getHeapStatistics().heap_size_limit)} MB (Railway Hobby: 8 GB/service)`);
console.log(`\n── enqueue ${spec.type} (the real path: enqueueJob → dispatcher → handler) ──`);

const job = await enqueueJob({ type: spec.type, payload: spec.payload, triggeredBy: "verify:step10b-e2e" });
console.log(`   job ${job.id}`);

const handler = getHandler(spec.type);
if (!handler) { console.error(`NO HANDLER REGISTERED for ${spec.type} — dispatcher wiring is broken`); process.exit(1); }
console.log(`   ✅ handler resolved from the dispatcher`);

const { ctx } = makeJobContext(job.id, spec.payload);
const t0 = Date.now();

let result: any;
try {
  result = await handler(ctx as any);
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: { status: "succeeded", finishedAt: new Date(), result: JSON.parse(JSON.stringify(result)) },
  });
} catch (err) {
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: { status: "failed", finishedAt: new Date(), errorMessage: (err as Error).message },
  });
  clearInterval(sampler);
  console.error(`\n❌ handler threw: ${(err as Error).message}`);
  await prisma.$disconnect();
  process.exit(1);
}
clearInterval(sampler);

console.log(`\n── result (${((Date.now() - t0) / 1000).toFixed(0)}s) ──`);
for (const [k, v] of Object.entries(result)) {
  if (typeof v === "object" && v !== null) continue;
  console.log(`   ${k.padEnd(22)} ${v}`);
}

console.log(`\n★ MEMORY`);
console.log(`   peak heapUsed : ${MB(peakHeap)} MB`);
console.log(`   peak RSS      : ${MB(peakRss)} MB`);
if (result.rowsFolded) {
  console.log(`   rows folded   : ${result.rowsFolded.toLocaleString()}`);
  console.log(`   ⇒ ${Math.round(result.rowsFolded / (peakHeap / 1048576)).toLocaleString()} NAV rows per MB of heap.`);
  console.log(`     As JS objects those rows would have cost ~${((result.rowsFolded * 60) / 1e9).toFixed(1)} GB.`);
}

console.log(`\n── RUN-LOG (mf_fetch_logs) — ruling ①a ──`);
const logs = await prisma.mfFetchLog.findMany({ orderBy: { createdAt: "desc" }, take: 4 });
for (const l of logs) {
  console.log(
    `   ${l.runDate.toISOString().slice(0, 10)}  ${l.job.padEnd(19)} ${l.status.padEnd(8)} ` +
      `schemes=${String(l.schemesProcessed).padStart(6)} rows=${String(l.rowsFolded).padStart(9)} ` +
      `written=${String(l.analyticsWritten).padStart(6)} faults=${l.faults} pulls=${l.pulls} ${l.durationMs}ms`,
  );
}

console.log(`\n── BackgroundJob row (the admin panel's "last run") ──`);
const bj = await prisma.backgroundJob.findUnique({
  where: { id: job.id },
  select: { type: true, status: true, triggeredBy: true, finishedAt: true, progressNote: true },
});
console.log(`   ${bj?.type} → ${bj?.status} (${bj?.triggeredBy})`);
console.log(`   ${bj?.progressNote}`);

await prisma.$disconnect();
