// ═══ STAGE 3 — CENTRAL TRIGGER POLICY PROOF ═══
//   npx tsx src/scripts/stage3-trigger-policy-proof.ts
//
// Drives maybeEnqueueRescoresForJob / triggerRescoreForSymbols directly with mock
// ingestion results to prove the routing the worker will use. Asserts on the
// deterministic TriggerOutcome RETURN VALUE (enqueued / deduped / pgIds / scope) — NOT on
// post-hoc DB queries — so it is correct even when a live server worker concurrently
// drains the queue. (If a worker IS live it will execute the enqueued rescores; that is
// the system working — idempotent + append-only — and is exactly the Stage-4 loop.)
//
//   • EOD_PRICES_DAILY (rows>0)       → ALL 13 scored PGs
//   • EOD_PRICES_DAILY (rows=0)       → nothing
//   • RESULTS_SCAN / SHAREHOLDING_*   → targeted PG(s), fanned out to all memberships
//   • dedup coalescing                → a PG already pending/running is skipped
//   • PG7 NBFC / unknown symbol       → dropped (not a scored PG)
//   • non-trigger job types           → null (no rescore-of-a-rescore loop)
//   • CASA path                       → routes to the bank's PG
//   • kill switch (env=false)         → null

import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { JobTypes } from "../jobs/types.js";
import { maybeEnqueueRescoresForJob, triggerRescoreForSymbols } from "../jobs/scoring-triggers.js";
import { SCORED_PGS } from "../scoring/composite/pg-registry.js";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`    [${cond ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (cond) pass++; else fail++;
}
const sorted = (a: string[]) => [...a].sort();
const eq = (a: string[], b: string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const ALL13 = SCORED_PGS.map((p) => p.pgId);
const clearPending = () => prisma.backgroundJob.deleteMany({ where: { type: "pg_rescore", status: "pending" } });

async function main() {
  console.log("\n═══ STAGE 3 — CENTRAL TRIGGER POLICY PROOF ═══\n");
  console.log(`  SCORING_TRIGGERS_ENABLED = ${env.SCORING_TRIGGERS_ENABLED}`);
  console.log(`  SCORED_PGS (${SCORED_PGS.length}) = [${ALL13.join(", ")}]  (PG7 NBFC excluded)\n`);
  await clearPending();

  // ── PRICES → all 13 ──
  console.log("── EOD_PRICES_DAILY with new rows → ALL 13 scored PGs");
  const tp = await maybeEnqueueRescoresForJob(JobTypes.EOD_PRICES_DAILY, [{ totalInserted: 250 }, { totalInserted: 0 }]);
  check("attempts all 13 (enqueued+deduped)", (tp?.enqueued ?? 0) + (tp?.deduped ?? 0) === 13, `enqueued=${tp?.enqueued} deduped=${tp?.deduped} scope=${tp?.scope}`);
  check("targeted exactly the 13 scored PGs (incl PG5/PG6, excl PG7)", !!tp && eq(tp.pgIds, ALL13), tp?.pgIds.join(","));
  await clearPending();

  // ── PRICES with no new rows → nothing ──
  console.log("\n── EOD_PRICES_DAILY with 0 new rows → no rescore");
  const tp0 = await maybeEnqueueRescoresForJob(JobTypes.EOD_PRICES_DAILY, [{ totalInserted: 0 }]);
  check("enqueued 0, scope=no-new-rows", tp0?.enqueued === 0 && tp0?.scope === "prices:no-new-rows");

  // ── RESULTS_SCAN targeted (HDFCBANK → PG5 only) ──
  console.log("\n── RESULTS_SCAN changedSymbols=[HDFCBANK] → PG5 only (targeted)");
  const tr = await maybeEnqueueRescoresForJob(JobTypes.RESULTS_SCAN, { changedSymbols: ["HDFCBANK"] });
  check("targeted PG5 only", !!tr && eq(tr.pgIds, ["PG5"]), `pgIds=${tr?.pgIds.join(",")}`);
  await clearPending();

  // ── RESULTS_SCAN no changes → nothing ──
  console.log("\n── RESULTS_SCAN changedSymbols=[] → no rescore");
  const trn = await maybeEnqueueRescoresForJob(JobTypes.RESULTS_SCAN, { changedSymbols: [] });
  check("enqueued 0", trn?.enqueued === 0, `scope=${trn?.scope}`);

  // ── SHAREHOLDING targeted (TCS → PG1) ──
  console.log("\n── SHAREHOLDING_QUARTERLY changedSymbols=[TCS] → PG1 only");
  const ts = await maybeEnqueueRescoresForJob(JobTypes.SHAREHOLDING_QUARTERLY, { changedSymbols: ["TCS"] });
  check("targeted PG1 only", !!ts && eq(ts.pgIds, ["PG1"]), `pgIds=${ts?.pgIds.join(",")}`);
  await clearPending();

  // ── DEDUP COALESCING: PG5 pending, then prices-all-13 → PG5 coalesced ──
  console.log("\n── DEDUP: enqueue PG5, then prices wants all 13 → PG5 coalesced (back-to-back, no worker gap)");
  await clearPending();
  await maybeEnqueueRescoresForJob(JobTypes.RESULTS_SCAN, { changedSymbols: ["HDFCBANK"] }); // PG5 now pending
  const tdup = await maybeEnqueueRescoresForJob(JobTypes.EOD_PRICES_DAILY, [{ totalInserted: 100 }]);
  check("prices still attempts all 13", !!tdup && eq(tdup.pgIds, ALL13), `pgIds.len=${tdup?.pgIds.length}`);
  check("PG5 coalesced → deduped ≥ 1, enqueued ≤ 12", (tdup?.deduped ?? 0) >= 1 && (tdup?.enqueued ?? 99) <= 12, `enqueued=${tdup?.enqueued} deduped=${tdup?.deduped}`);
  await clearPending();

  // ── PG7 NBFC / unknown symbol → dropped ──
  console.log("\n── RESULTS_SCAN changedSymbols=[BAJFINANCE (PG7 NBFC, gated)] → dropped");
  const tg = await maybeEnqueueRescoresForJob(JobTypes.RESULTS_SCAN, { changedSymbols: ["BAJFINANCE"] });
  check("enqueued 0 (PG7 not a scored PG)", tg?.enqueued === 0 && tg?.pgIds.length === 0, `scope=${tg?.scope}`);

  // ── NON-TRIGGER job types → null ──
  console.log("\n── Non-trigger job types → null (no-op)");
  check("PG_RESCORE → null (no rescore-of-a-rescore)", (await maybeEnqueueRescoresForJob(JobTypes.PG_RESCORE, {})) === null);
  check("DEALS_DAILY_INGEST → null", (await maybeEnqueueRescoresForJob(JobTypes.DEALS_DAILY_INGEST, {})) === null);
  check("PEER_METRICS_COMPUTE_ALL → null", (await maybeEnqueueRescoresForJob(JobTypes.PEER_METRICS_COMPUTE_ALL, {})) === null);

  // ── CASA path → routes to the bank's PG ──
  console.log("\n── CASA path: triggerRescoreForSymbols([ICICIBANK]) → PG5");
  const tc = await triggerRescoreForSymbols(["ICICIBANK"], "hook:casa_inject", "stage3 proof");
  check("targeted PG5", !!tc && eq(tc.pgIds, ["PG5"]), `pgIds=${tc?.pgIds.join(",")}`);
  await clearPending();

  // ── KILL SWITCH ──
  console.log("\n── KILL SWITCH: SCORING_TRIGGERS_ENABLED=false → null");
  (env as { SCORING_TRIGGERS_ENABLED: boolean }).SCORING_TRIGGERS_ENABLED = false;
  const tk = await maybeEnqueueRescoresForJob(JobTypes.EOD_PRICES_DAILY, [{ totalInserted: 999 }]);
  const tkc = await triggerRescoreForSymbols(["ICICIBANK"], "hook:casa_inject", "stage3 kill-switch");
  check("prices trigger → null when disabled", tk === null);
  check("CASA trigger → null when disabled", tkc === null);
  (env as { SCORING_TRIGGERS_ENABLED: boolean }).SCORING_TRIGGERS_ENABLED = true; // restore

  await clearPending();
  console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("PROOF ERROR:", e); process.exit(1); });
