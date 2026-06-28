// ─────────────────────────────────────────────────────────────
// DRY-RUN harness for the fundamentals (Ind-AS) ingestion guards.
//
// Exercises the REAL predicates + the real reportIngestionError/dedup
// seam, plus a REAL-DATA zero-FP pass: it runs the predicates over every
// live `fundamentals` row and confirms they don't false-flag — including
// the critical check that a NULL balance sheet (24.4% of rows) is NOT
// flagged by the conditional BS-imbalance guard.
//
// Sentinel cron "_dryrun_fund" → cleanup only touches dry-run rows.
// Run:  npx tsx src/scripts/dryrun-fundamentals-guards.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";
import {
  checkPlContentless,
  classifyFailedRate,
  checkBatchNullRate,
  checkScale,
  checkRevenueNonPositive,
  checkBsImbalance,
  checkRevenueYoyAnomaly,
  CORE_NULL_MAX,
  BS_NULL_MAX,
} from "../ingestions/quaterly-results/fundamentals-guards.js";

const CRON = "_dryrun_fund";
const results: { ok: boolean; name: string; got?: unknown }[] = [];
function check(name: string, ok: boolean, got?: unknown) {
  results.push({ ok, name, got });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}
async function cleanup() {
  await prisma.ingestionError.deleteMany({ where: { cron: CRON } });
}
const num = (d: { toNumber(): number } | null) => (d == null ? null : d.toNumber());

async function main() {
  await cleanup();

  // ── 1. SHAPE / P&L content ──
  console.log("\n[1] SHAPE — both core P&L lines null ⇒ reject");
  check("both null → contentless", checkPlContentless(null, null) === true);
  check("revenue present → not contentless", checkPlContentless(100, null) === false);
  check("netProfit present → not contentless", checkPlContentless(null, 50) === false);

  // ── 2. SCALE (the ÷1e7 unit break) ──
  console.log("\n[2] SCALE — ÷1e7 unit break");
  check("real max 2.18M Cr → clean", checkScale(2_180_000) === false);
  check("500 Cr ×1e7 break → flagged", checkScale(5_000_000_000) === true);
  check("null → clean", checkScale(null) === false);

  // ── 3. REVENUE validity ──
  console.log("\n[3] Revenue validity");
  check("revenue -5 → flagged", checkRevenueNonPositive(-5) === true);
  check("revenue 0 → flagged", checkRevenueNonPositive(0) === true);
  check("revenue 100 → clean", checkRevenueNonPositive(100) === false);
  check("revenue null → clean (shape/null-rate handle null)", checkRevenueNonPositive(null) === false);

  // ── 4. BALANCE-SHEET (CONDITIONAL — the critical one) ──
  console.log("\n[4] BS imbalance — CONDITIONAL; null BS must NOT flag");
  check("balanced (1000 = 400+300+300) → clean", checkBsImbalance({ totalAssets: 1000, totalEquity: 400, currentLiabilities: 300, noncurrentLiabilities: 300 }) === null);
  check("10% off → flagged", (checkBsImbalance({ totalAssets: 1000, totalEquity: 400, currentLiabilities: 300, noncurrentLiabilities: 200 }) ?? 0) > 0.05);
  check("ALL-NULL BS → NOT flagged", checkBsImbalance({ totalAssets: null, totalEquity: null, currentLiabilities: null, noncurrentLiabilities: null }) === null);
  check("one component null → NOT flagged", checkBsImbalance({ totalAssets: 1000, totalEquity: null, currentLiabilities: 300, noncurrentLiabilities: 300 }) === null);

  // ── 5. CONTINUITY — revenue YoY only (NOT profit YoY) ──
  console.log("\n[5] Continuity — revenue YoY (profit YoY deliberately un-guarded)");
  check("revenue YoY 350% → flagged", checkRevenueYoyAnomaly(350) === true);
  check("revenue YoY 238% (max real) → clean", checkRevenueYoyAnomaly(238) === false);
  check("revenue YoY -400% → flagged (abs)", checkRevenueYoyAnomaly(-400) === true);
  check("revenue YoY null → clean", checkRevenueYoyAnomaly(null) === false);

  // ── 6. COUNT failedRate (provisional) ──
  console.log("\n[6] Count / failed-rate (provisional)");
  check("10/100 failed → clean (<25%)", classifyFailedRate(10, 100) === null);
  check("30/100 failed → high", classifyFailedRate(30, 100)?.severity === "high");
  check("5/10 failed → skipped (run too small)", classifyFailedRate(5, 10) === null);

  // ── 7. NULL-RATE batch ──
  console.log("\n[7] Null-rate (batch)");
  check("core 10/100 null → flagged", checkBatchNullRate(10, 100, CORE_NULL_MAX) != null);
  check("core 0/100 null → clean (normal 0%)", checkBatchNullRate(0, 100, CORE_NULL_MAX) === null);
  check("BS 30/100 null → clean (normal 24%)", checkBatchNullRate(30, 100, BS_NULL_MAX) === null);
  check("BS 60/100 null → flagged (spike)", checkBatchNullRate(60, 100, BS_NULL_MAX) != null);
  check("small batch n<30 → skipped", checkBatchNullRate(5, 20, CORE_NULL_MAX) === null);

  // ── 8. reportIngestionError mapping + dedup (sentinel cron) ──
  console.log("\n[8] report mapping + dedup");
  await reportIngestionError({ source: "nse_xbrl", cron: CRON, guardType: "shape", targetTable: "Fundamental", targetEntity: "x@FY26@standalone", severity: "critical", resolutionPath: "source_code", expected: "P&L present", observed: "both null", runRef: "results:Y-FY26" });
  const sh = await prisma.ingestionError.findFirst({ where: { cron: CRON, guardType: "shape" } });
  check("shape row critical/source_code", sh?.severity === "critical" && sh?.resolutionPath === "source_code");
  await reportIngestionError({ source: "nse_xbrl", cron: CRON, guardType: "range", targetTable: "Fundamental", targetField: "revenue", targetEntity: "x@FY26@standalone", severity: "medium", resolutionPath: "admin_fill", expected: "revenue>0", observed: "revenue=-5", runRef: "x" });
  const rg = await prisma.ingestionError.findFirst({ where: { cron: CRON, guardType: "range", targetField: "revenue" } });
  check("revenue range row medium/admin_fill", rg?.severity === "medium" && rg?.resolutionPath === "admin_fill");
  const dedupArgs = { source: "nse_xbrl", cron: CRON, guardType: "range" as const, targetTable: "Fundamental", targetField: "balanceSheet", targetEntity: "DUP@FY26@standalone", severity: "medium" as const, resolutionPath: "source_code" as const, expected: "≤5%", observed: "8% off", runRef: "x" };
  await reportIngestionError(dedupArgs);
  await reportIngestionError({ ...dedupArgs, observed: "9% off" });
  const dup = await prisma.ingestionError.findMany({ where: { cron: CRON, targetField: "balanceSheet" } });
  check("dedup → 1 row, occurrences 2", dup.length === 1 && dup[0]?.occurrences === 2, { len: dup.length, occ: dup[0]?.occurrences });
  await cleanup();
  check("cleanup removed all dry-run rows", (await prisma.ingestionError.count({ where: { cron: CRON } })) === 0);

  // ── 9. REAL-DATA zero-FP pass (predicates over every live fundamentals row) ──
  console.log("\n[9] Real-data zero-FP — run predicates over live fundamentals rows");
  const rows = await prisma.fundamental.findMany({
    select: { revenue: true, netProfit: true, totalAssets: true, totalEquity: true, currentLiabilities: true, noncurrentLiabilities: true, revenueGrowthYoy: true },
  });
  let shapeFP = 0, scaleFP = 0, revFP = 0, bsCheckable = 0, bsFlag = 0, contFlag = 0, bsNullNotFlagged = 0;
  for (const r of rows) {
    const revenue = num(r.revenue), netProfit = num(r.netProfit), totalAssets = num(r.totalAssets);
    if (checkPlContentless(revenue, netProfit)) shapeFP++;
    if (checkScale(revenue) || checkScale(netProfit) || checkScale(totalAssets)) scaleFP++;
    if (checkRevenueNonPositive(revenue)) revFP++;
    const bs = checkBsImbalance({ totalAssets, totalEquity: num(r.totalEquity), currentLiabilities: num(r.currentLiabilities), noncurrentLiabilities: num(r.noncurrentLiabilities) });
    if (totalAssets != null && num(r.totalEquity) != null && num(r.currentLiabilities) != null && num(r.noncurrentLiabilities) != null) bsCheckable++;
    if (bs != null) bsFlag++;
    if (num(r.totalEquity) == null && bs == null) bsNullNotFlagged++;
    if (checkRevenueYoyAnomaly(num(r.revenueGrowthYoy))) contFlag++;
  }
  console.log(`   rows=${rows.length} bsCheckable=${bsCheckable} | shapeFP=${shapeFP} scaleFP=${scaleFP} revFP=${revFP} bsFlag=${bsFlag} contFlag=${contFlag}`);
  check("SHAPE: zero false-positives on real rows", shapeFP === 0, shapeFP);
  check("SCALE: zero false-positives on real rows", scaleFP === 0, scaleFP);
  check("REVENUE≤0: zero false-positives on real rows", revFP === 0, revFP);
  check("BS-imbalance flags only a small tail (<2% of checkable)", bsFlag / Math.max(bsCheckable, 1) < 0.02, `${bsFlag}/${bsCheckable}`);
  check("BS-null rows NOT flagged (conditional works)", bsNullNotFlagged > 0, bsNullNotFlagged);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await prisma.$disconnect();
  if (passed !== results.length) process.exit(1);
}
main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
