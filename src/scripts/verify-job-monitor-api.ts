// READ-ONLY smoke test for the job-monitor controllers: calls each handler with a stub
// req/res and asserts the payload shape a panel will depend on. No HTTP server, no writes.
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { listRunningJobs, getJobHistory, getLatestHealthCheck } from "../controllers/admin/job-monitor-controller.js";
import { getPipelineStatus } from "../controllers/pipelines-controller.js";
import { CANCELLATION_SUPPORT } from "../jobs/types.js";

let passed = 0, failed = 0; const failures: string[] = [];
const ok = (l: string, c: boolean, d = "") => { if (c) { passed++; console.log(`   ✅ ${l}${d?` — ${d}`:""}`);} else { failed++; failures.push(l); console.log(`   ❌ ${l}${d?` — ${d}`:""}`);} };
const head = (n: string) => console.log(`\n${"─".repeat(78)}\n${n}\n${"─".repeat(78)}`);

function stubRes() {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
}

async function main() {
  const before = await prisma.backgroundJob.count();

  head("GET /admin/jobs/running");
  const r1 = stubRes();
  await listRunningJobs({} as never, r1);
  ok("200 + success", r1.statusCode === 200 && r1.body.success === true);
  ok("has data.running and data.pending arrays", Array.isArray(r1.body.data.running) && Array.isArray(r1.body.data.pending));
  ok("meta carries the liveness thresholds a panel needs", typeof r1.body.meta.staleAfterMs === "number" && typeof r1.body.meta.heartbeatIntervalMs === "number",
     `staleAfterMs=${r1.body.meta.staleAfterMs} heartbeat=${r1.body.meta.heartbeatIntervalMs}`);
  ok("★ every running row carries ALIVE/STALE/unknown", r1.body.data.running.every((x: any) => ["alive","stale","unknown"].includes(x.liveness)),
     `${r1.body.data.running.length} running row(s): ${r1.body.data.running.map((x:any)=>`${x.type}=${x.liveness}`).join(", ") || "(none right now)"}`);
  ok("★ every running row carries its cancellation capability", r1.body.data.running.every((x: any) => typeof x.cancellation === "string"));
  console.log(`   pending: ${r1.body.data.pending.length}`);

  head("GET /admin/jobs/history?days=7");
  const r2 = stubRes();
  await getJobHistory({ query: { days: "7" } } as never, r2);
  ok("200 + success", r2.statusCode === 200 && r2.body.success === true);
  ok("rows carry abandon AND reclaim rate", r2.body.data.every((x: any) => typeof x.abandonRatePct === "number" && typeof x.reclaimRatePct === "number"));
  ok("rows carry duration percentiles", r2.body.data.every((x: any) => "p50" in x.durationMs && "p95" in x.durationMs));
  ok("rows carry cancellation + restartPolicy per type", r2.body.data.every((x: any) => x.cancellation && x.restartPolicy));
  const rs = r2.body.data.find((x: any) => x.type === "results_scan");
  ok("results_scan present with a real abandon rate", !!rs, rs ? `total=${rs.total} abandoned=${rs.abandoned} (${rs.abandonRatePct}%) p95=${rs.durationMs.p95}ms` : "");
  ok("★ retention note present so 'no history' is not read as 'never ran'", typeof r2.body.meta.retentionNote === "string");
  const bad = await (async () => { const r = stubRes(); await getJobHistory({ query: { days: "999" } } as never, r); return r; })();
  ok("rejects an out-of-range window", bad.statusCode === 400, `status=${bad.statusCode}`);

  head("GET /admin/jobs/health");
  const r3 = stubRes();
  await getLatestHealthCheck({} as never, r3);
  ok("200 + success even with no report yet", r3.statusCode === 200 && r3.body.success === true);
  ok("★ honest empty (data:null + a reason), not a 404", r3.body.data === null ? typeof r3.body.meta.reason === "string" : true,
     r3.body.data === null ? "no report yet — reason supplied" : "a report exists");

  head("GET /admin/pipelines — the surface that concealed 11 August");
  const r4 = stubRes();
  await getPipelineStatus({} as never, r4);
  ok("200 + success", r4.statusCode === 200 && r4.body.success === true);
  const cards = r4.body.data as any[];
  const mf = cards.find((c) => c.key === "mutual-funds");
  ok("the mutual-funds card exists", !!mf);
  ok("★ BACKWARD COMPATIBLE — the 4 fields the live frontend hook reads are all present",
     cards.every((c) => "key" in c && "lastRunAt" in c && "triggeredBy" in c && "status" in c));
  ok("★ the card is now broken out PER TYPE (one member can no longer vouch for another)",
     Array.isArray(mf.perType) && mf.perType.length === 5,
     mf.perType?.map((m: any) => `${m.type}=${m.status ?? "never"}`).join(", "));
  ok("★ ICA is visible as its own member, not folded into mf_analytics",
     mf.perType?.some((m: any) => m.type === "instrument_corporate_actions"));
  ok("★ in-flight work is reported (the old query could not return it)",
     typeof mf.inFlightCount === "number" && typeof mf.stalledCount === "number",
     `inFlight=${mf.inFlightCount} stalled=${mf.stalledCount}`);
  ok("every job-driven card carries perType", cards.filter((c) => !["ingestion-errors","casa"].includes(c.key)).every((c) => Array.isArray(c.perType)));

  head("CANCELLATION AUDIT — exposed per type");
  const counts = Object.values(CANCELLATION_SUPPORT).reduce<Record<string, number>>((a, v) => { a[v] = (a[v] ?? 0) + 1; return a; }, {});
  console.log(`   ${JSON.stringify(counts)}`);
  ok("★ results_scan is classified signal_only, NOT checkpointed", CANCELLATION_SUPPORT["results_scan"] === "signal_only");
  ok("★ the two 11-Aug jobs are classified 'none' — a cancel button on them would lie",
     CANCELLATION_SUPPORT["instrument_corporate_actions"] === "none" && CANCELLATION_SUPPORT["mf_analytics_daily"] === "none");
  ok("retention_prune is 'none' (a destructive job that cannot be stopped mid-run)", CANCELLATION_SUPPORT["retention_prune"] === "none");

  head("READ-ONLY PROOF");
  const after = await prisma.backgroundJob.count();
  ok("★ row count unchanged — this smoke test wrote NOTHING", before === after, `${before} → ${after}`);
  await prisma.$disconnect();
}
main().catch((e) => { failed++; failures.push(`ERROR: ${(e as Error).message}`); console.error(e); })
  .finally(() => {
    console.log(`\n${"═".repeat(78)}\nRESULT: ${passed} passed, ${failed} failed`);
    if (failures.length) { console.log("\nFailures:"); for (const f of failures) console.log(`  · ${f}`); }
    console.log("═".repeat(78));
    process.exit(failed === 0 ? 0 : 1);
  });
