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
  checkZeroedPnlBlock,
  checkBsImbalance,
  checkRevenueYoyAnomaly,
  YOY_BASE_MIN_CR,
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

  // ── 3. ZEROED P&L BLOCK (was "revenue <= 0" — see checkZeroedPnlBlock) ──
  console.log("\n[3] Zeroed P&L block — the CONJUNCTION, never the bare zero");
  check("every line 0 → flagged", checkZeroedPnlBlock({ revenue: 0, otherIncome: 0, expenses: 0, profitBeforeTax: 0, netProfit: 0 }) === true);
  check("★ revenue 0 with REAL expenses → CLEAN (the dormant holding company)", checkZeroedPnlBlock({ revenue: 0, otherIncome: 0, expenses: 0.37, profitBeforeTax: -0.37, netProfit: -0.19 }) === false);
  check("★ NEGATIVE revenue with a coherent P&L → CLEAN (Q4 = FY − 9M, revised down)", checkZeroedPnlBlock({ revenue: -209.6, otherIncome: 6.29, expenses: -233.71, profitBeforeTax: 30.4, netProfit: 30.4 }) === false);
  check("revenue 100 → clean", checkZeroedPnlBlock({ revenue: 100, otherIncome: 0, expenses: 0, profitBeforeTax: 0, netProfit: 0 }) === false);
  check("all null → clean (shape/null-rate handle null)", checkZeroedPnlBlock({ revenue: null, netProfit: null }) === false);
  check("only two lines present, both 0 → clean (too thin to call a block)", checkZeroedPnlBlock({ revenue: 0, netProfit: 0 }) === false);

  // ── 4. BALANCE-SHEET (CONDITIONAL — the critical one) ──
  console.log("\n[4] BS imbalance — CONDITIONAL; null BS must NOT flag");
  check("balanced (1000 = 400+300+300) → clean", checkBsImbalance({ totalAssets: 1000, totalEquity: 400, currentLiabilities: 300, noncurrentLiabilities: 300 }) === null);
  check("10% off → flagged", (checkBsImbalance({ totalAssets: 1000, totalEquity: 400, currentLiabilities: 300, noncurrentLiabilities: 200 }) ?? 0) > 0.05);
  check("ALL-NULL BS → NOT flagged", checkBsImbalance({ totalAssets: null, totalEquity: null, currentLiabilities: null, noncurrentLiabilities: null }) === null);
  check("one component null → NOT flagged", checkBsImbalance({ totalAssets: 1000, totalEquity: null, currentLiabilities: 300, noncurrentLiabilities: 300 }) === null);
  check("★ the filing's own Liabilities total WINS over the two-part reconstruction (RAYMOND FY25)",
    checkBsImbalance({ totalAssets: 4751.85, totalEquity: 3322.64, currentLiabilities: 59.84, noncurrentLiabilities: 18.96, totalLiabilities: 1429.21 }) === null);
  check("★ …and without it the same row still flags (the old, incomplete identity)",
    (checkBsImbalance({ totalAssets: 4751.85, totalEquity: 3322.64, currentLiabilities: 59.84, noncurrentLiabilities: 18.96 }) ?? 0) > 0.05);

  // ── 5. CONTINUITY — revenue YoY, WITH the materiality floor ──
  console.log("\n[5] Continuity — revenue YoY (profit YoY deliberately un-guarded)");
  check("revenue YoY 350% on a ₹100 Cr base → flagged", checkRevenueYoyAnomaly(350, 100) === true);
  check("revenue YoY 238% (max real) → clean", checkRevenueYoyAnomaly(238, 100) === false);
  check("revenue YoY -400% on a ₹100 Cr base → flagged (abs)", checkRevenueYoyAnomaly(-400, 100) === true);
  check("revenue YoY null → clean", checkRevenueYoyAnomaly(null, 100) === false);
  check("★ 28117% on a ₹0.03 Cr base → CLEAN (arithmetic, not evidence)", checkRevenueYoyAnomaly(28117, 0.03) === false);
  check(`★ 9349% on SRF's ₹37.78 Cr base → STILL FLAGGED (a real 100× mis-scale)`, checkRevenueYoyAnomaly(9349, 37.78) === true);
  check("base exactly at the floor → flagged", checkRevenueYoyAnomaly(400, YOY_BASE_MIN_CR) === true);
  check("★ base UNKNOWN (null) → flagged — an unseen base is not a small one", checkRevenueYoyAnomaly(400, null) === true);

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
    select: { revenue: true, netProfit: true, otherIncome: true, expenses: true, profitBeforeTax: true, totalAssets: true, totalEquity: true, currentLiabilities: true, noncurrentLiabilities: true, totalLiabilities: true, revenueGrowthYoy: true, netMargin: true, operatingMargin: true, profitGrowthYoy: true, roe: true, roce: true },
  });
  let shapeFP = 0, scaleFP = 0, revFP = 0, bsCheckable = 0, bsFlag = 0, contFlag = 0, bsNullNotFlagged = 0;
  let orphanDerived = 0; // a derived ratio surviving a P&L that is null — see the SHAPE check below
  for (const r of rows) {
    const revenue = num(r.revenue), netProfit = num(r.netProfit), totalAssets = num(r.totalAssets);
    if (checkPlContentless(revenue, netProfit)) {
      shapeFP++;
      // A P&L that is unavailable cannot leave a ratio behind that was computed FROM it.
      if (num(r.netMargin) != null || num(r.operatingMargin) != null || num(r.revenueGrowthYoy) != null ||
          num(r.profitGrowthYoy) != null || num(r.roe) != null || num(r.roce) != null) orphanDerived++;
    }
    if (checkScale(revenue) || checkScale(netProfit) || checkScale(totalAssets)) scaleFP++;
    if (checkZeroedPnlBlock({ revenue, netProfit, otherIncome: num(r.otherIncome), expenses: num(r.expenses), profitBeforeTax: num(r.profitBeforeTax) })) revFP++;
    const bs = checkBsImbalance({ totalAssets, totalEquity: num(r.totalEquity), currentLiabilities: num(r.currentLiabilities), noncurrentLiabilities: num(r.noncurrentLiabilities), totalLiabilities: num(r.totalLiabilities) });
    if (totalAssets != null && num(r.totalEquity) != null && num(r.currentLiabilities) != null && num(r.noncurrentLiabilities) != null) bsCheckable++;
    if (bs != null) bsFlag++;
    if (num(r.totalEquity) == null && bs == null) bsNullNotFlagged++;
    if (checkRevenueYoyAnomaly(num(r.revenueGrowthYoy))) contFlag++;
  }
  console.log(`   rows=${rows.length} bsCheckable=${bsCheckable} | shapeFP=${shapeFP} scaleFP=${scaleFP} revFP=${revFP} bsFlag=${bsFlag} contFlag=${contFlag}`);
  // SHAPE. This used to assert shapeFP === 0 — "revenue & netProfit are NEVER null, 0% historical".
  // That invariant was DELIBERATELY BROKEN, and by this programme: repair-zeroed-pnl-rows.ts nulled
  // the P&L on 19 rows whose filings zero-filled the column they were not reporting (HEROMOTOCO Q4
  // FY19 consolidated, MRF FY18, NTPC FY18 …). Those nulls are the CORRECT state — "unavailable",
  // which is what the filing says — so counting them as false positives would be asking the gate to
  // fail on a fix. What still has to hold is that the null is COHERENT: a row with no P&L must carry
  // no ratio derived from one, or a stale margin outlives its own inputs and reads as a measurement.
  check(
    "SHAPE: every contentless-P&L row is coherently null (no orphan derived ratio)",
    orphanDerived === 0,
    orphanDerived,
  );
  console.log(`   (contentless-P&L rows: ${shapeFP} — deliberately nulled by repair-zeroed-pnl-rows.ts)`);
  check("SCALE: zero false-positives on real rows", scaleFP === 0, scaleFP);
  check("ZEROED P&L BLOCK: zero false-positives on real rows", revFP === 0, revFP);
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
