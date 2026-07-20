// STEP 10c — STEP 2: FIRE THE APPROVED RISK-FREE BACKFILL.
//
// This is EXACTLY what POST /api/v1/admin/indices/backfill {"days":1825} does:
//   enqueueJob({ type: INDEX_PRICES_BACKFILL, payload: { days }, triggeredBy: "user:admin" })
// …then the worker resolves the handler and runs it. No server is up, so we drive the same
// enqueue → dispatcher → handler path directly. Same code, same job row, same audit trail.
//
// npx tsx src/scripts/verify-step10c-backfill.ts
import { prisma } from "../db/prisma.js";
import { enqueueJob } from "../jobs/enqueue.js";
import { getHandler } from "../jobs/dispatcher.js";
import { makeJobContext } from "../jobs/context.js";
import { JobTypes } from "../jobs/types.js";

const DAYS = 1825; // ruling ③ — 5 years, so 3Y/5Y Sharpe/Sortino have a risk-free leg

const before = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n, pg_total_relation_size('index_prices') b,
         (SELECT count(*) FROM index_prices WHERE index_name='Nifty 1D Rate Index') rf
  FROM index_prices`);
console.log(`BEFORE: index_prices ${before[0].n} rows, ${(Number(before[0].b) / 1e6).toFixed(1)} MB`);
console.log(`        "Nifty 1D Rate Index": ${before[0].rf} points`);

const job = await enqueueJob({
  type: JobTypes.INDEX_PRICES_BACKFILL,
  payload: { days: DAYS },
  triggeredBy: "user:admin",
});
console.log(`\nenqueued INDEX_PRICES_BACKFILL job ${job.id} (days=${DAYS})`);

const handler = getHandler(JobTypes.INDEX_PRICES_BACKFILL);
if (!handler) { console.error("NO HANDLER"); process.exit(1); }

const { ctx } = makeJobContext(job.id, { days: DAYS });
const t0 = Date.now();

try {
  const result = await handler(ctx as any);
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: { status: "succeeded", finishedAt: new Date(), result: JSON.parse(JSON.stringify(result ?? {})) },
  });
  console.log(`\n✅ backfill COMPLETED in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
} catch (err) {
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: { status: "failed", finishedAt: new Date(), errorMessage: (err as Error).message },
  });
  console.error(`\n❌ backfill FAILED: ${(err as Error).message}`);
  await prisma.$disconnect();
  process.exit(1);
}

const after = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n, pg_total_relation_size('index_prices') b,
         pg_size_pretty(pg_total_relation_size('index_prices')) s
  FROM index_prices`);
console.log(`\nAFTER : index_prices ${after[0].n} rows, ${after[0].s}`);
console.log(`        added ${Number(after[0].n) - Number(before[0].n)} rows, ` +
  `+${((Number(after[0].b) - Number(before[0].b)) / 1e6).toFixed(1)} MB`);

const rf = await prisma.$queryRawUnsafe<any[]>(`
  SELECT index_name, count(*) pts, min(date) mn, max(date) mx
  FROM index_prices
  WHERE index_name IN ('Nifty 1D Rate Index','Nifty 10 yr Benchmark G-Sec')
  GROUP BY 1 ORDER BY 1`);
console.log(`\nRISK-FREE DEPTH AFTER:`);
for (const r of rf) {
  const yrs = (new Date(r.mx).getTime() - new Date(r.mn).getTime()) / (365.25 * 86400000);
  console.log(
    `  ${String(r.index_name).padEnd(30)} ${String(r.pts).padStart(5)} pts  ` +
      `${String(r.mn).slice(4, 15)} → ${String(r.mx).slice(4, 15)}  (${yrs.toFixed(2)} y)  ` +
      `${yrs >= 5 ? "✅ covers 5Y" : yrs >= 3 ? "⚠️ covers 3Y only" : "❌ still short"}`,
  );
}

console.log(`\nINDEX FETCH LOG (last 5):`);
const logs = await prisma.indexFetchLog.findMany({ orderBy: { indexDate: "desc" }, take: 5 });
for (const l of logs) {
  console.log(`  ${l.indexDate.toISOString().slice(0, 10)} ${l.status.padEnd(14)} fetched=${l.totalFetched} inserted=${l.totalInserted} skipped=${l.totalSkipped}`);
}
const byStatus = await prisma.$queryRawUnsafe<any[]>(
  `SELECT status, count(*) n FROM index_fetch_logs GROUP BY 1 ORDER BY 2 DESC`,
);
console.log(`\nINDEX FETCH LOG by status (all time):`);
for (const s of byStatus) console.log(`  ${String(s.status).padEnd(16)} ${s.n}`);

await prisma.$disconnect();
