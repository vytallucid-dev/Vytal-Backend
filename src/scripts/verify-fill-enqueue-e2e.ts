// ─────────────────────────────────────────────────────────────
// E2E — fill cascade ENQUEUE path (Item 1), NET-ZERO.
//   [A] triggerFillCascade ENQUEUES a FILL_CASCADE_RESCORE job (POST returns
//       immediately, never blocks); a second identical edit DEDUPS. Test jobs
//       cleaned up.
//   [B] handleFillCascadeRescore reconstructs the edit from the payload and runs
//       runGeneralCascade — same peer-wide supersede as the inline e2e, ASYNC.
//       (Run with dryRun → scores roll back; the committed edit is reverted.)
// Run:  npx tsx src/scripts/verify-fill-enqueue-e2e.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import type { JobContext } from "../jobs/context.js";
import type { FillCascadeRescorePayload } from "../jobs/types.js";
import { JobTypes } from "../jobs/types.js";
import { triggerFillCascade } from "../jobs/scoring-triggers.js";
import { handleFillCascadeRescore } from "../jobs/handlers/fill-cascade-rescore.handler.js";
import { reDeriveFundamentalAnnual } from "../fill/re-derive.js";
import { resolveEditedPeriod } from "../scoring/rescore/general-cascade.js";
import { buildCascadePlan, pkOrdinal, quarterEnd } from "../scoring/rescore/banking-cascade.js";
import { SCORED_PGS } from "../scoring/composite/pg-registry.js";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}
function mockCtx(payload: FillCascadeRescorePayload): JobContext<FillCascadeRescorePayload> {
  return { jobId: "e2e-fill", payload, signal: new AbortController().signal, reportProgress: async () => {}, shouldCancel: async () => false };
}
async function pgMemberIds(pgName: string) {
  const pg = await prisma.peerGroup.findFirst({ where: { name: pgName }, include: { stocks: { select: { stockId: true } } } });
  return (pg?.stocks ?? []).map((s) => s.stockId);
}
async function scoredPeriods(ids: string[]) {
  const rows = await prisma.scoreSnapshot.findMany({ where: { stockId: { in: ids }, snapshotType: "quarterly" }, select: { periodKey: true }, distinct: ["periodKey"] });
  return rows.map((r) => r.periodKey).filter((pk) => /^FY\d{2}Q[1-4]$/.test(pk)).sort((a, b) => pkOrdinal(a) - pkOrdinal(b));
}

async function main() {
  // Find a back-datable non-banking annual (same selection as the cascade e2e).
  let target: { symbol: string; rowId: string; reportDate: Date } | null = null;
  for (const ref of SCORED_PGS.filter((r) => r.pgId !== "PG5" && r.pgId !== "PG6")) {
    const ids = await pgMemberIds(ref.pgName);
    const periods = await scoredPeriods(ids);
    if (periods.length < 2) continue;
    const q0 = quarterEnd(periods[0]);
    const anns = await prisma.fundamental.findMany({ where: { stockId: { in: ids }, resultType: "standalone", revenue: { gt: 0 }, reportDate: { lte: q0 } }, select: { id: true, reportDate: true, stock: { select: { symbol: true } } }, orderBy: { reportDate: "desc" } });
    for (const an of anns) {
      const ep = resolveEditedPeriod({ kind: "annual", reportDate: an.reportDate }, periods);
      if (ep && buildCascadePlan(ref, an.stock.symbol, ep, periods).kind === "cascade") { target = { symbol: an.stock.symbol, rowId: an.id, reportDate: an.reportDate }; break; }
    }
    if (target) break;
  }
  if (!target) { console.log("INCONCLUSIVE — no back-datable target."); await prisma.$disconnect(); return; }
  console.log(`\nTarget: ${target.symbol} (annual reportDate ${target.reportDate.toISOString().slice(0, 10)})`);

  // ── [A] enqueue + dedup ──
  console.log("\n[A] triggerFillCascade enqueues + dedups (POST returns immediately)");
  const edit = { kind: "annual" as const, reportDate: target.reportDate };
  const created: string[] = [];
  const t1 = await triggerFillCascade(target.symbol, edit, "fill:e2e", "enqueue test");
  if (t1 == null) {
    console.log("   (SCORING_TRIGGERS_ENABLED is off — enqueue is env-gated; skipping [A] assertions)");
  } else {
    check("first call enqueued a FILL_CASCADE_RESCORE job", t1.enqueued === 1 && !!t1.jobId, t1);
    if (t1.jobId) {
      created.push(t1.jobId);
      const job = await prisma.backgroundJob.findUnique({ where: { id: t1.jobId } });
      const p = job?.payload as Partial<FillCascadeRescorePayload> | null;
      check("job payload carries symbol + editKind=annual + reportDate ISO", p?.symbol === target.symbol && p?.editKind === "annual" && p?.editReportDateIso === target.reportDate.toISOString(), p);
      check("job type is fill_cascade_rescore", job?.type === JobTypes.FILL_CASCADE_RESCORE);
    }
    const t2 = await triggerFillCascade(target.symbol, edit, "fill:e2e", "enqueue test (dup)");
    check("second identical call DEDUPS (no new job)", t2?.deduped === 1 && t2?.enqueued === 0, t2);
    if (t2?.jobId) created.push(t2.jobId);
    // cleanup test jobs
    await prisma.backgroundJob.deleteMany({ where: { id: { in: created } } });
    check("test jobs cleaned up", (await prisma.backgroundJob.count({ where: { id: { in: created } } })) === 0);
  }

  // ── [B] handler reconstructs edit + runs the cascade (dryRun, committed-then-reverted) ──
  console.log("\n[B] handleFillCascadeRescore → runGeneralCascade (async path, dryRun, net-zero)");
  const before = await prisma.fundamental.findUniqueOrThrow({ where: { id: target.rowId }, select: { revenue: true } });
  let result: Awaited<ReturnType<typeof handleFillCascadeRescore>> | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.fundamental.update({ where: { id: target!.rowId }, data: { revenue: before.revenue!.times(1.4) } });
      await reDeriveFundamentalAnnual(tx, target!.rowId);
    });
    const payload: FillCascadeRescorePayload = { symbol: target.symbol, editKind: "annual", editReportDateIso: target.reportDate.toISOString(), triggeredBy: "fill:e2e", reason: "enqueue e2e", dryRun: true };
    result = await handleFillCascadeRescore(mockCtx(payload));
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.fundamental.update({ where: { id: target!.rowId }, data: { revenue: before.revenue } });
      await reDeriveFundamentalAnnual(tx, target!.rowId);
    });
  }
  console.log(`   handler result: pgCount=${result?.pgCount} superseded=${result?.superseded} skipped=${result?.skippedIdentical} steps=${result?.periodsRescored}`);
  const pitPeerWide = (result?.perStep ?? []).some((s) => s.mode === "pit" && s.superseded >= 2);
  const liveRan = (result?.perStep ?? []).some((s) => s.mode === "live");
  check("handler ran the cascade and superseded peer-wide (≥1 pit step, ≥2 members)", pitPeerWide, result?.perStep);
  check("handler ran the live/current step", liveRan);
  check("handler superseded > 0 (same architecture as the inline 20-supersede e2e)", (result?.superseded ?? 0) > 0, result?.superseded);
  const restored = await prisma.fundamental.findUniqueOrThrow({ where: { id: target.rowId }, select: { revenue: true } });
  check("raw revenue restored (net-zero)", restored.revenue!.equals(before.revenue!));

  console.log(`\n=== fill-enqueue e2e ${pass}/${pass + fail} (jobs cleaned; scores never committed; raw restored) ===`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
