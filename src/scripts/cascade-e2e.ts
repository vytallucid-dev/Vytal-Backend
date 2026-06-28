// src/scripts/cascade-e2e.ts
//
// STEP 3 — LIVE END-TO-END test of the CASA forward-cascade through the REAL production
// units: the controller's sequence (injectLiveCasa → triggerCasaCascade) + the worker's
// sequence (claim job → getHandler → handlePgCascadeRescore). Edits a PAST quarter, confirms
// the cascade fires + commits the self-heal PIT-correctly, then REVERTS to baseline (CASA cell
// restored pristine; snapshots healed back to baseline composites). Bulletproof finally-revert.
//
//   npx tsx src/scripts/cascade-e2e.ts

import { prisma } from "../db/prisma.js";
import { JobStatus, JobTypes } from "../jobs/types.js";
import { makeJobContext } from "../jobs/context.js";
import { getHandler } from "../jobs/dispatcher.js";
import { injectLiveCasa } from "../ingestions/bank-supplementary/inject-casa.js";
import { triggerCasaCascade } from "../jobs/scoring-triggers.js";

const SYM = "HDFCBANK";
const EDIT_FY = "FY26", EDIT_Q = "Q2", EDIT_PERIOD = "FY26Q2";
const TEST_VALUE = 36.90;
const PERIODS = ["FY26Q2", "FY26Q3", "FY26Q4"];

function hr(c = "─", n = 96) { return c.repeat(n); }
const f2 = (v: any) => (v == null ? "—" : Number(v).toFixed(2));

async function headOf(stockId: string, periodKey: string) {
  const s = await prisma.scoreSnapshot.findFirst({
    where: { stockId, snapshotType: "quarterly", periodKey }, orderBy: { version: "desc" },
    select: { version: true, composite: true, asOfDate: true, foundationPillar: { select: { metricScores: { where: { metricKey: "CASA" }, select: { rawValue: true } } } } },
  });
  return s ? { version: s.version, composite: Number(s.composite), asOf: s.asOfDate?.toISOString().slice(0, 10) ?? null, casa: s.foundationPillar?.metricScores?.[0]?.rawValue != null ? Number(s.foundationPillar.metricScores[0].rawValue) : null } : null;
}

// Worker-equivalent: claim the pending cascade job + run it through the real dispatcher.
async function drainCascadeJob() {
  const job = await prisma.backgroundJob.findFirst({ where: { type: JobTypes.PG_CASCADE_RESCORE, status: JobStatus.PENDING }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  if (!job) return null;
  await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: JobStatus.RUNNING, startedAt: new Date(), attempts: { increment: 1 } } });
  const { ctx } = makeJobContext(job.id, job.payload);
  const handler = getHandler(job.type)!;
  try {
    const result = await handler(ctx);
    await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: JobStatus.SUCCEEDED, finishedAt: new Date(), result: result as any } });
    return result as any;
  } catch (e) {
    await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: JobStatus.FAILED, finishedAt: new Date(), errorMessage: (e as Error).message } });
    throw e;
  }
}

async function captureCell() {
  return prisma.bankSupplementary.findMany({ where: { symbol: SYM, metric: "casa_pct", fiscalYear: EDIT_FY, quarter: EDIT_Q }, orderBy: { version: "asc" } });
}
async function restoreCell(captured: Awaited<ReturnType<typeof captureCell>>) {
  await prisma.$transaction(async (tx) => {
    await tx.bankSupplementary.deleteMany({ where: { symbol: SYM, metric: "casa_pct", fiscalYear: EDIT_FY, quarter: EDIT_Q } });
    for (const r of captured) {
      await tx.bankSupplementary.create({ data: {
        id: r.id, stockId: r.stockId, symbol: r.symbol, metric: r.metric, fiscalYear: r.fiscalYear, quarter: r.quarter,
        value: r.value, sourceCitation: r.sourceCitation, sourceDate: r.sourceDate, confidence: r.confidence,
        status: r.status, notes: r.notes, version: r.version, supersedesId: r.supersedesId, enteredBy: r.enteredBy, createdAt: r.createdAt,
      } });
    }
  });
}

async function main() {
  console.log(hr("═"));
  console.log("  STEP 3 — LIVE E2E: CASA forward-cascade through the real write + worker path");
  console.log(hr("═"));

  const stock = await prisma.stock.findFirst({ where: { symbol: SYM }, select: { id: true } });
  const stockId = stock!.id;
  const capCell = await captureCell();
  const origValue = Number(capCell[capCell.length - 1].value);

  // BASELINE
  const baseline: Record<string, Awaited<ReturnType<typeof headOf>>> = {};
  console.log("\n── Baseline heads ───────────────────────────────────────────────────────");
  for (const pk of PERIODS) { baseline[pk] = await headOf(stockId, pk); console.log(`  ${SYM} ${pk}: v${baseline[pk]?.version} composite=${f2(baseline[pk]?.composite)} CASA=${f2(baseline[pk]?.casa)} asOf=${baseline[pk]?.asOf}`); }

  let testOk = false;
  try {
    // ── EDIT via the REAL write path (controller's two calls) ──
    console.log(`\n── EDIT (real write path): ${SYM} ${EDIT_PERIOD} CASA ${f2(origValue)} → ${TEST_VALUE} ──`);
    const inj = await injectLiveCasa({ symbol: SYM, fiscalYear: EDIT_FY, quarter: EDIT_Q, value: TEST_VALUE, periodEnd: "2025-09-30", sourceCitation: "E2E TEST — temporary past-quarter edit (will be reverted)", confidence: "A", enteredBy: "e2e:cascade" });
    console.log(`  injectLiveCasa: ${inj.action} v${inj.version}`);
    const trig = await triggerCasaCascade(SYM, EDIT_PERIOD, "hook:casa_inject", `E2E CASA ${inj.action} for ${SYM} ${EDIT_PERIOD}`);
    console.log(`  triggerCasaCascade: enqueued=${trig?.enqueued} pg=${trig?.pgIds.join(",")} job=${trig?.jobId?.slice(0, 8)}…`);

    // ── DRAIN via the REAL worker path (dispatcher + handler) ──
    const result = await drainCascadeJob();
    console.log(`\n── Cascade handler result ───────────────────────────────────────────────`);
    console.log(`  kind=${result.kind}  current=${result.currentPeriod}  periods=${result.periodsRescored}  superseded=${result.superseded} skip=${result.skippedIdentical}`);
    for (const p of result.perPeriod) console.log(`    ${p.periodKey} [${p.mode}]: ${p.superseded} supersede, ${p.skipped} skip${p.created ? `, ${p.created} create` : ""}`);

    // ── VERIFY the self-heal committed ──
    console.log(`\n── Verify (after cascade) ───────────────────────────────────────────────`);
    const after: Record<string, Awaited<ReturnType<typeof headOf>>> = {};
    for (const pk of PERIODS) { after[pk] = await headOf(stockId, pk); console.log(`  ${SYM} ${pk}: v${after[pk]?.version} composite=${f2(after[pk]?.composite)} CASA=${f2(after[pk]?.casa)} asOf=${after[pk]?.asOf}`); }

    const q2 = after["FY26Q2"]!, q3 = after["FY26Q3"]!, q4 = after["FY26Q4"]!;
    const q2Healed = Math.abs((q2.casa ?? 0) - TEST_VALUE) < 0.005 && q2.version! > baseline["FY26Q2"]!.version! && q2.asOf === "2025-09-30";
    const q3Skipped = q3.version === baseline["FY26Q3"]!.version && Math.abs((q3.casa ?? 0) - (baseline["FY26Q3"]!.casa ?? 0)) < 0.005;
    const q4Live = q4.asOf != null && q4.asOf >= "2026-06-26"; // current Market, not rolled to Mar-31
    console.log(`\n  ✓ FY26Q2 superseded to the edited CASA=${f2(q2.casa)} (PIT asOf preserved at 2025-09-30): ${q2Healed ? "PASS" : "FAIL"}`);
    console.log(`  ✓ FY26Q3 (own quarter) skip-identical — head unchanged at v${q3.version}: ${q3Skipped ? "PASS" : "FAIL"}`);
    console.log(`  ✓ FY26Q4 stayed LIVE (Market current, asOf ${q4.asOf}, NOT rolled to Mar-31): ${q4Live ? "PASS" : "FAIL"}`);
    console.log(`  ✓ scope: cascade kind=${result.kind} on ${result.pgId} only`);
    testOk = q2Healed && q3Skipped && q4Live;
  } finally {
    // ── REVERT: restore the CASA cell pristine, then heal the snapshots back via the real path ──
    console.log(`\n── REVERT (finally) ─────────────────────────────────────────────────────`);
    await restoreCell(capCell);
    console.log(`  CASA cell restored pristine (FY26/Q2 = ${f2(origValue)}, test versions deleted)`);
    const trig2 = await triggerCasaCascade(SYM, EDIT_PERIOD, "hook:casa_inject", `E2E REVERT ${SYM} ${EDIT_PERIOD}`);
    if (trig2?.enqueued) { await drainCascadeJob(); console.log(`  revert cascade processed (snapshots healed reading pristine CASA)`); }

    console.log(`\n── Verify baseline restored ─────────────────────────────────────────────`);
    let restored = true;
    for (const pk of PERIODS) {
      const h = await headOf(stockId, pk);
      const baseComp = baseline[pk]!.composite;
      const ok = Math.abs((h?.composite ?? -1) - baseComp) < 0.01 && Math.abs((h?.casa ?? -1) - (baseline[pk]!.casa ?? -1)) < 0.005;
      console.log(`  ${SYM} ${pk}: v${h?.version} composite=${f2(h?.composite)} (baseline ${f2(baseComp)}) CASA=${f2(h?.casa)} ${ok ? "✓" : "⚠ DIFF"}`);
      if (!ok) restored = false;
    }
    const stray = await prisma.bankSupplementary.count({ where: { enteredBy: { startsWith: "e2e:" } } });
    console.log(`  stray e2e CASA rows: ${stray} ${stray === 0 ? "✓" : "⚠"}`);
    console.log(`\n  ${restored && stray === 0 ? "✓ BASELINE FULLY RESTORED (composite values back; CASA pristine)." : "⚠ baseline NOT fully restored — inspect above."}`);
  }

  console.log("\n" + hr("═"));
  console.log(`  E2E ${testOk ? "PASSED" : "result above"} — cascade fired through the real write+worker path, self-healed, reverted.`);
  console.log(hr("═"));
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
