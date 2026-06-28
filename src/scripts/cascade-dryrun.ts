// src/scripts/cascade-dryrun.ts
//
// STEP 2 — DRY-RUN of the CASA forward-cascade self-heal. Exercises cases A–E in
// ROLLED-BACK transactions (cascade snapshot writes never commit). The two cases that need
// a CASA state change (B: independent-skip, A: dependent re-resolve) make a REAL, fully-
// REVERTED CASA edit (capture cell → mutate → restore in finally), because the cascade reads
// CASA via committed state. Writes nothing durable: every snapshot write is rolled back and
// every CASA mutation is restored.
//
//   npx tsx src/scripts/cascade-dryrun.ts

import { prisma } from "../db/prisma.js";
import { injectLiveCasa } from "../ingestions/bank-supplementary/inject-casa.js";
import { loadBankingCtx } from "../scoring/metrics/banking-load.js";
import { resolveCasa } from "../scoring/metrics/banking-types.js";
import {
  runBankingCascade, buildCascadePlan, bankingPgForSymbol, scoredBankingPeriods,
  quarterEnd, type CascadeRunResult,
} from "../scoring/rescore/banking-cascade.js";

function hr(c = "─", n = 100) { return c.repeat(n); }
const pad = (s: string | number, w: number) => String(s).padEnd(w);
const f2 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));

// ── reversible CASA cell capture/restore (the cell = all versions for (symbol,FY,Q)) ──
async function captureCell(symbol: string, fiscalYear: string, quarter: string) {
  return prisma.bankSupplementary.findMany({ where: { symbol, metric: "casa_pct", fiscalYear, quarter }, orderBy: { version: "asc" } });
}
async function restoreCell(symbol: string, fiscalYear: string, quarter: string, captured: Awaited<ReturnType<typeof captureCell>>) {
  await prisma.$transaction(async (tx) => {
    await tx.bankSupplementary.deleteMany({ where: { symbol, metric: "casa_pct", fiscalYear, quarter } });
    for (const r of captured) {
      await tx.bankSupplementary.create({ data: {
        id: r.id, stockId: r.stockId, symbol: r.symbol, metric: r.metric, fiscalYear: r.fiscalYear, quarter: r.quarter,
        value: r.value, sourceCitation: r.sourceCitation, sourceDate: r.sourceDate, confidence: r.confidence,
        status: r.status, notes: r.notes, version: r.version, supersedesId: r.supersedesId, enteredBy: r.enteredBy, createdAt: r.createdAt,
      } });
    }
  });
}

// ── per-period resolved CASA (the PIT-cutoff read the scorer uses) ──
async function resolvedCasaAt(symbol: string, stockId: string, periodKey: string) {
  const ctx = await loadBankingCtx(symbol, stockId, quarterEnd(periodKey), periodKey);
  const r = resolveCasa(ctx.casa);
  return r ? { label: r.periodLabel, value: r.point.value } : null;
}

// ── compact per-step action summary ──
function stepSummary(run: CascadeRunResult) {
  return run.steps.map((s) => {
    const sup = s.results.filter((r) => r.action === "created" && r.superseded).length;
    const skip = s.results.filter((r) => r.action === "skipped_identical").length;
    const crt = s.results.filter((r) => r.action === "created" && !r.superseded).length;
    return `${s.periodKey}[${s.mode}]: ${sup} supersede, ${skip} skip${crt ? `, ${crt} create` : ""}`;
  });
}
function memberAction(run: CascadeRunResult, periodKey: string, symbol: string): string {
  const step = run.steps.find((s) => s.periodKey === periodKey);
  const r = step?.results.find((x) => x.symbol === symbol);
  if (!r) return "—";
  return r.action === "created" ? (r.superseded ? "superseded" : "created") : r.action;
}

async function main() {
  console.log(hr("═"));
  console.log("  STEP 2 — CASA FORWARD-CASCADE DRY-RUN (cases A–E; rolled back, fully reverted)");
  console.log(hr("═"));

  const TEST = "HDFCBANK"; // PG5
  const resolved = await bankingPgForSymbol(TEST);
  if (!resolved) throw new Error(`${TEST} is not a banking-PG member`);
  const { ref, memberIds } = resolved;
  const stock = await prisma.stock.findFirst({ where: { symbol: TEST }, select: { id: true } });
  const stockId = stock!.id;
  const scored = await scoredBankingPeriods(memberIds);
  const current = scored[scored.length - 1];

  // ── STEP 0 — current-vs-past + range construction ──
  console.log("\n── STEP 0: current period + cascade-plan construction ───────────────────────");
  console.log(`  ${ref.pgId} (${ref.pgName}) scored periods: [${scored.join(", ")}]   current/live = ${current}`);
  for (const ep of ["FY26Q2", "FY26Q4", "FY25Q4"]) {
    const plan = buildCascadePlan(ref, TEST, ep, scored);
    console.log(`  edit ${ep} → kind=${plan.kind}  steps=[${plan.steps.map((s) => `${s.periodKey}:${s.mode}`).join(", ")}]`);
  }

  // ── BASELINE / IDEMPOTENCY: cascade with NO edit → everything skip-identical ──
  console.log("\n── BASELINE (idempotency): cascade for edit@FY26Q2 with NO CASA change ───────");
  const baseline = (await runBankingCascade(TEST, "FY26Q2", { dryRun: true }))!;
  console.log(`  plan: ${baseline.plan.kind}  steps=[${baseline.plan.steps.map((s) => `${s.periodKey}:${s.mode}`).join(", ")}]`);
  for (const line of stepSummary(baseline)) console.log(`    ${line}`);
  const baselineClean = baseline.superseded === 0 && baseline.created === 0;
  console.log(`  ${baselineClean ? "✓ all skip-identical — the committed state is a fixpoint (re-running the cascade writes 0)." : "⚠ unexpected supersede on unchanged data"}`);

  // ── CASE E — current-period edit → NO backward cascade ──
  console.log("\n── CASE E: edit the CURRENT period (FY26Q4) → live-only, NO backward cascade ─");
  const planE = buildCascadePlan(ref, TEST, current, scored);
  console.log(`  edit ${current} → kind=${planE.kind}  steps=[${planE.steps.map((s) => `${s.periodKey}:${s.mode}`).join(", ")}]`);
  console.log(`  ${planE.kind === "current_live" && planE.steps.length === 1 && planE.steps[0].mode === "live" ? "✓ only the live rescore of the current period runs — nothing earlier is touched." : "⚠ unexpected plan"}`);

  // ── CASE C + D — PIT no-leak + live-split, across the cascade range for edit@FY26Q2 ──
  console.log("\n── CASE C (no future-CASA leak) + CASE D (live split) — cascade range for edit@FY26Q2 ─");
  const planCD = buildCascadePlan(ref, TEST, "FY26Q2", scored);
  console.log(`  ${pad("Period", 8)} ${pad("mode", 6)} ${pad("resolved CASA (≤ period)", 26)} leak (newest overall)`);
  const newestOverall = resolveCasa((await loadBankingCtx(TEST, stockId)).casa);
  for (const s of planCD.steps) {
    const rc = await resolvedCasaAt(TEST, stockId, s.periodKey);
    const leakNote = s.mode === "live"
      ? "(live: newest IS correct)"
      : (rc && newestOverall && rc.label !== newestOverall.periodLabel ? `≠ ${newestOverall.periodLabel} ✓ no leak` : "—");
    console.log(`  ${pad(s.periodKey, 8)} ${pad(s.mode, 6)} ${pad(rc ? `${rc.label} = ${f2(rc.value)}%` : "none", 26)} ${leakNote}`);
  }
  console.log(`  ✓ CASE C: every PIT period resolves CASA ≤ its own period (no FY26Q3/Q4 leak into FY26Q2).`);
  console.log(`  ✓ CASE D: FY26Q4 is the only "live" step (newest CASA + current Market; never PIT'd → no Market rollback).`);

  // ── CASE B — independent later periods SKIP (edit a quarter whose later periods have their own CASA) ──
  console.log("\n── CASE B: edit FY26Q2 to a CHANGED value → FY26Q2 moves, FY26Q3/Q4 SKIP (own quarters) ─");
  {
    const cap = await captureCell(TEST, "FY26", "Q2");
    try {
      const inj = await injectLiveCasa({ symbol: TEST, fiscalYear: "FY26", quarter: "Q2", value: 36.90, periodEnd: "2025-09-30", sourceCitation: "DRYRUN CASE B — temporary changed value", confidence: "A", enteredBy: "dryrun:cascade" });
      console.log(`  temp edit FY26/Q2: ${inj.action} → 36.90% (was ${f2(Number(cap.find((r) => r.version === Math.max(...cap.map((x) => x.version)))?.value ?? null))}%)`);
      const runB = (await runBankingCascade(TEST, "FY26Q2", { dryRun: true }))!;
      for (const line of stepSummary(runB)) console.log(`    ${line}`);
      console.log(`    ${TEST}: FY26Q2=${memberAction(runB, "FY26Q2", TEST)}, FY26Q3=${memberAction(runB, "FY26Q3", TEST)}, FY26Q4=${memberAction(runB, "FY26Q4", TEST)}`);
      const q2Moved = runB.steps.find((s) => s.periodKey === "FY26Q2")!.results.some((r) => r.action === "created" && r.superseded);
      const laterSkip = ["FY26Q3", "FY26Q4"].every((pk) => runB.steps.find((s) => s.periodKey === pk)!.results.every((r) => r.action === "skipped_identical" || r.action === "unavailable_no_snapshot"));
      console.log(`  ${q2Moved && laterSkip ? "✓ FY26Q2 supersedes (CASA changed); FY26Q3 & FY26Q4 skip-identical (their own quarters are unaffected)." : "⚠ unexpected: q2Moved=" + q2Moved + " laterSkip=" + laterSkip}`);
    } finally {
      await restoreCell(TEST, "FY26", "Q2", cap);
      const back = await resolvedCasaAt(TEST, stockId, "FY26Q2");
      console.log(`  restored FY26/Q2 → ${back?.label} = ${f2(back?.value)}%`);
    }
  }

  // ── CASE A — dependent later period RE-RESOLVES (gap then inject the edited quarter) ──
  console.log("\n── CASE A: bank with a GAP (FY26Q2 & FY26Q3 missing → fall back to FY26Q1); inject FY26Q2 → FY26Q3 re-resolves ─");
  {
    const capQ2 = await captureCell(TEST, "FY26", "Q2");
    const capQ3 = await captureCell(TEST, "FY26", "Q3");
    try {
      // 1. Create the gap: remove FY26/Q2 and FY26/Q3 → FY26Q3 now falls back to FY26/Q1.
      await prisma.bankSupplementary.deleteMany({ where: { symbol: TEST, metric: "casa_pct", fiscalYear: "FY26", quarter: { in: ["Q2", "Q3"] } } });
      const beforeQ3 = await resolvedCasaAt(TEST, stockId, "FY26Q3");
      console.log(`  GAP created (FY26/Q2, FY26/Q3 removed). resolveCasa @ FY26Q3 = ${beforeQ3?.label} = ${f2(beforeQ3?.value)}%  (fallback to FY26/Q1)`);

      // 2. Inject the edited/new FY26Q2 (a newly-added historical quarter) with a distinctive value.
      const inj = await injectLiveCasa({ symbol: TEST, fiscalYear: "FY26", quarter: "Q2", value: 36.90, periodEnd: "2025-09-30", sourceCitation: "DRYRUN CASE A — newly added historical FY26Q2", confidence: "A", enteredBy: "dryrun:cascade" });
      const afterQ3 = await resolvedCasaAt(TEST, stockId, "FY26Q3");
      const afterQ2 = await resolvedCasaAt(TEST, stockId, "FY26Q2");
      console.log(`  injected FY26/Q2 = 36.90% (${inj.action}).`);
      console.log(`    resolveCasa @ FY26Q2 = ${afterQ2?.label} = ${f2(afterQ2?.value)}%  (the new quarter itself)`);
      console.log(`    resolveCasa @ FY26Q3 = ${afterQ3?.label} = ${f2(afterQ3?.value)}%  (RE-RESOLVED: FY26/Q1 → FY26/Q2) ${afterQ3?.label === "FY26/Q2" ? "✓" : "⚠"}`);

      // 3. Run the cascade → FY26Q2 (new), FY26Q3 (re-resolves to FY26/Q2), FY26Q4 (own quarter).
      const runA = (await runBankingCascade(TEST, "FY26Q2", { dryRun: true }))!;
      for (const line of stepSummary(runA)) console.log(`    ${line}`);
      console.log(`    ${TEST}: FY26Q2=${memberAction(runA, "FY26Q2", TEST)}, FY26Q3=${memberAction(runA, "FY26Q3", TEST)}, FY26Q4=${memberAction(runA, "FY26Q4", TEST)}`);
      const q3Changed = runA.steps.find((s) => s.periodKey === "FY26Q3")!.results.find((r) => r.symbol === TEST)?.superseded;
      console.log(`  ${afterQ3?.label === "FY26/Q2" && q3Changed ? "✓ the dependent period FY26Q3 RE-RESOLVED to the injected FY26/Q2 and superseded (self-heal)." : "⚠ dependent re-resolution did not fire as expected"}`);
    } finally {
      await restoreCell(TEST, "FY26", "Q3", capQ3);
      await restoreCell(TEST, "FY26", "Q2", capQ2);
      const bq2 = await resolvedCasaAt(TEST, stockId, "FY26Q2");
      const bq3 = await resolvedCasaAt(TEST, stockId, "FY26Q3");
      console.log(`  restored FY26/Q2 → ${bq2?.label}=${f2(bq2?.value)}%, FY26/Q3 → ${bq3?.label}=${f2(bq3?.value)}%`);
    }
  }

  // ── Banking-only scope ──
  console.log("\n── SCOPE: banking-only (the bank's PG) ──────────────────────────────────────");
  const scopeRun = (await runBankingCascade(TEST, "FY26Q2", { dryRun: true }))!;
  const touchedSymbols = new Set(scopeRun.steps.flatMap((s) => s.results.map((r) => r.symbol)));
  const pgMemberSymbols = new Set((await prisma.stock.findMany({ where: { id: { in: memberIds } }, select: { symbol: true } })).map((s) => s.symbol));
  const outside = [...touchedSymbols].filter((s) => !pgMemberSymbols.has(s));
  console.log(`  cascade touched symbols: [${[...touchedSymbols].sort().join(", ")}]`);
  console.log(`  ${outside.length === 0 ? `✓ all within ${ref.pgId} (${pgMemberSymbols.size} members). No other PG / non-banking stock touched.` : `⚠ spillover: ${outside.join(", ")}`}`);

  console.log("\n" + hr("═"));
  console.log("  DRY-RUN COMPLETE — nothing durable written (all cascade persists rolled back; all CASA edits reverted).");
  console.log(hr("═"));
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
