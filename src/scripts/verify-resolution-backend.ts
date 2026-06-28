// ─────────────────────────────────────────────────────────────
// Backend verify for the resolution UI (NET-ZERO).
//   [A] annotateFill (synthetic): fundamentals admin_fill → fillable; source_code
//       → annotated-not-fillable; prices → reFetchAvailable; batch-level → null.
//   [B] resolveErrorRowId: a real Fundamental entity → its row id.
//   [C] a REAL fill via applyRawFieldEdit on that row → {ok, jobId, cascade,
//       changed} → then REVERT (raw + re-derive), delete the cascade job(s) +
//       audit rows.
//   [D] prices re-fetch enqueue → PRICES_REFETCH job created → deleted.
// Run:  npx tsx src/scripts/verify-resolution-backend.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { annotateFill, resolveErrorRowId, fillMetaFor } from "../fill/error-resolution.js";
import { applyRawFieldEdit } from "../fill/raw-field-edit.js";
import { reDeriveRow } from "../fill/re-derive.js";
import { enqueueJob } from "../jobs/enqueue.js";
import { JobTypes } from "../jobs/types.js";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}

async function main() {
  // ── [A] annotateFill ──
  console.log("\n[A] annotateFill");
  const fund = annotateFill({ targetTable: "Fundamental", targetField: "revenue", targetEntity: "x@FY24@standalone", resolutionPath: "admin_fill", expected: "revenue > 0" });
  check("fundamentals admin_fill → fillable + ₹Cr unit", fund.fill?.fillable === true && fund.fill?.meta.unit === "₹ Cr", fund.fill);
  const src = annotateFill({ targetTable: "Fundamental", targetField: null, targetEntity: "x@FY24@standalone", resolutionPath: "source_code", expected: "array" });
  check("source_code → fill present but fillable=false (admin_fill gate)", src.fill?.fillable === false, src.fill);
  const price = annotateFill({ targetTable: "DailyPrice", targetField: "close", targetEntity: "RELIANCE", resolutionPath: "admin_fill", expected: "close in [1,200000]" });
  check("prices → reFetchAvailable + fillable + ₹ unit", price.reFetchAvailable === true && price.fill?.fillable === true && price.fill?.meta.unit === "₹", price);
  const batch = annotateFill({ targetTable: "DailyPrice", targetField: null, targetEntity: null, resolutionPath: "source_code", expected: "array" });
  check("batch-level (no entity) → reFetchAvailable false", batch.reFetchAvailable === false, batch);
  const shp = annotateFill({ targetTable: "ShareholdingPattern", targetField: "pct", targetEntity: "RELIANCE@2024-09-30", resolutionPath: "admin_fill", expected: "pct in [0,100]" });
  check("shareholding generic 'pct' → fillable + field-picker list + % bounds[0,100]", shp.fill?.fillable === true && shp.fill.fields.includes("fiiPct") && shp.fill.meta.bounds?.max === 100, shp.fill);
  check("fillMetaFor unknown table → null fill", annotateFill({ targetTable: "Nope", targetField: "x", targetEntity: "e", resolutionPath: "admin_fill", expected: "" }).fill === null);

  // ── [B] resolveErrorRowId on a real Fundamental ──
  console.log("\n[B] resolveErrorRowId (real Fundamental entity)");
  const target = await prisma.fundamental.findFirst({ where: { revenue: { not: null, gt: 0 } }, select: { id: true, stockId: true, fiscalYear: true, resultType: true } });
  if (!target) { console.log("  no Fundamental row — skipping B/C"); }
  let rowId: string | null = null;
  if (target) {
    const entity = `${target.stockId}@${target.fiscalYear}@${target.resultType}`;
    rowId = await resolveErrorRowId("Fundamental", entity, null);
    check("entity → the same row id", rowId === target.id, { rowId, expected: target.id });
    check("fillMetaFor(Fundamental, revenue).bounds.min === 0", fillMetaFor("Fundamental", "revenue").bounds?.min === 0);
  }

  // ── [C] a real fill (committed) → revert + cleanup ──
  if (target && rowId) {
    console.log("\n[C] real fill via applyRawFieldEdit (revert + cleanup)");
    const before = await prisma.fundamental.findUniqueOrThrow({ where: { id: rowId }, select: { revenue: true } });
    const jobs: string[] = [];
    try {
      const r = await applyRawFieldEdit({ table: "Fundamental", rowId, field: "revenue", newValue: before.revenue!.times(1.2).toNumber(), citation: "verify: e2e test source", editedBy: "verify" });
      check("fill ok + returned a cascade route", r.ok === true && (r.cascade === "general" || r.cascade === "banking"), r);
      check("fill returned a pollable jobId", typeof r.jobId === "string" && (r.jobId?.length ?? 0) > 0, r.jobId);
      check("re-derive changed ≥1 ratio (revenue moved margins/turnover)", Object.keys(r.reDerived?.changed ?? {}).length > 0, r.reDerived?.changed);
      if (r.jobId) jobs.push(r.jobId);
    } finally {
      // revert raw + re-derive, delete the enqueued cascade job + audit rows.
      await prisma.$transaction(async (tx) => {
        await tx.fundamental.update({ where: { id: rowId! }, data: { revenue: before.revenue } });
        await reDeriveRow(tx, "Fundamental", rowId!);
      });
      if (jobs.length) await prisma.backgroundJob.deleteMany({ where: { id: { in: jobs } } });
      await prisma.rawFieldEdit.deleteMany({ where: { targetRowId: rowId!, editedBy: "verify" } });
    }
    const restored = await prisma.fundamental.findUniqueOrThrow({ where: { id: rowId }, select: { revenue: true } });
    check("raw reverted to baseline (net-zero)", restored.revenue!.equals(before.revenue!));
    check("enqueued cascade job deleted", (await prisma.backgroundJob.count({ where: { id: { in: jobs } } })) === 0);
    check("audit rows cleaned", (await prisma.rawFieldEdit.count({ where: { targetRowId: rowId, editedBy: "verify" } })) === 0);
  }

  // ── [D] prices re-fetch enqueue → delete ──
  console.log("\n[D] prices re-fetch enqueue");
  const job = await enqueueJob({ type: JobTypes.PRICES_REFETCH, payload: { dateIso: "2026-06-26", triggeredBy: "verify", reason: "verify" }, triggeredBy: "verify" });
  check("PRICES_REFETCH job enqueued (pending, pollable)", job.type === JobTypes.PRICES_REFETCH && job.status === "pending");
  await prisma.backgroundJob.delete({ where: { id: job.id } });
  check("re-fetch test job deleted", (await prisma.backgroundJob.count({ where: { id: job.id } })) === 0);

  console.log(`\n=== resolution-backend ${pass}/${pass + fail} (net-zero) ===`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
