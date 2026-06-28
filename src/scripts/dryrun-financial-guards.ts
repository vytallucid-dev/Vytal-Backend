// ─────────────────────────────────────────────────────────────
// DRY-RUN harness for the financial-industry (banking/NBFC/LI/GI) guards
// + the bank-supplementary CASA/Tier-1 band-check.
//
// Predicate tests + reportIngestionError/dedup (sentinel cron "_dryrun_fin")
// + a REAL-DATA pass over all 8 financial tables: SHAPE/SCALE/NPA produce
// ZERO false-positives; the solvency<1.0 guard CATCHES the known mis-parsed
// rows (real LI/GI solvency includes impossible 0.02/0.03) — that's correct,
// not a false-positive; CASA/Tier-1 stay inside their bands.
//
// Run:  npx tsx src/scripts/dryrun-financial-guards.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";
import {
  checkNpaHierarchy,
  checkSolvencyImplausible,
  checkBand,
  CASA_BAND,
  TIER1_BAND,
} from "../ingestions/quaterly-results/financial-guards.js";
import {
  checkPlContentless,
  checkScale,
  checkRevenueYoyAnomaly,
} from "../ingestions/quaterly-results/fundamentals-guards.js";

const CRON = "_dryrun_fin";
const results: { ok: boolean; name: string; got?: unknown }[] = [];
function check(name: string, ok: boolean, got?: unknown) {
  results.push({ ok, name, got });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}
const num = (d: { toNumber(): number } | null) => (d == null ? null : d.toNumber());
async function cleanup() {
  await prisma.ingestionError.deleteMany({ where: { cron: CRON } });
}

async function main() {
  await cleanup();

  // ── 1. Predicates ──
  console.log("\n[1] Predicates");
  check("SHAPE both-null", checkPlContentless(null, null) === true);
  check("SHAPE one present → clean", checkPlContentless(500, null) === false);
  check("SCALE bank assets 8.3M Cr → clean", checkScale(8_321_569) === false);
  check("SCALE ÷1e7 break → flagged", checkScale(5_000_000_000) === true);
  check("NPA nnpa>gnpa → flagged", checkNpaHierarchy(100, 50) === true);
  check("NPA nnpa≤gnpa → clean", checkNpaHierarchy(50, 100) === false);
  check("NPA null → clean (audit-pending safe)", checkNpaHierarchy(null, null) === false);
  check("solvency 0.03 → flagged (corruption)", checkSolvencyImplausible(0.03) === true);
  check("solvency 1.4× → clean (distress, not corruption)", checkSolvencyImplausible(1.4) === false);
  check("solvency 2.27× → clean", checkSolvencyImplausible(2.27) === false);
  check("CASA 8 → out of band", checkBand(8, CASA_BAND) === true);
  check("CASA 38 → in band", checkBand(38, CASA_BAND) === false);
  check("Tier-1 3 → out of band", checkBand(3, TIER1_BAND) === true);
  check("Tier-1 13.8 → in band", checkBand(13.8, TIER1_BAND) === false);
  check("primary YoY 355% → flagged", checkRevenueYoyAnomaly(355) === true);
  check("primary YoY 238% → clean", checkRevenueYoyAnomaly(238) === false);

  // ── 2. report mapping + dedup ──
  console.log("\n[2] report mapping + dedup");
  await reportIngestionError({ source: "nse_xbrl", cron: CRON, guardType: "shape", targetTable: "BankingFundamental", targetEntity: "x@FY26@standalone", severity: "critical", resolutionPath: "source_code", expected: "P&L", observed: "both null", runRef: "results:Y-FY26" });
  const sh = await prisma.ingestionError.findFirst({ where: { cron: CRON, guardType: "shape" } });
  check("shape critical/source_code", sh?.severity === "critical" && sh?.resolutionPath === "source_code");
  await reportIngestionError({ source: "admin_manual", cron: CRON, guardType: "range", targetTable: "BankSupplementary", targetField: "casa_pct", targetEntity: "HDFCBANK@FY26", severity: "medium", resolutionPath: "admin_fill", expected: "[15,60]%", observed: "8%", runRef: "banksupp:x" });
  const casa = await prisma.ingestionError.findFirst({ where: { cron: CRON, targetField: "casa_pct" } });
  check("CASA band row medium/admin_fill", casa?.severity === "medium" && casa?.resolutionPath === "admin_fill");
  const dArgs = { source: "nse_xbrl", cron: CRON, guardType: "range" as const, targetTable: "BankingFundamental", targetField: "npa", targetEntity: "DUP@FY26@standalone", severity: "medium" as const, resolutionPath: "source_code" as const, expected: "NNPA≤GNPA", observed: "nnpa=100 > gnpa=50", runRef: "x" };
  await reportIngestionError(dArgs);
  await reportIngestionError({ ...dArgs, observed: "nnpa=110 > gnpa=50" });
  const dup = await prisma.ingestionError.findMany({ where: { cron: CRON, targetField: "npa" } });
  check("dedup → 1 row occurrences 2", dup.length === 1 && dup[0]?.occurrences === 2, { len: dup.length, occ: dup[0]?.occurrences });
  await cleanup();
  check("cleanup clean", (await prisma.ingestionError.count({ where: { cron: CRON } })) === 0);

  // ── 3. REAL-DATA pass ──
  console.log("\n[3] Real-data — predicates over all 8 financial tables");
  // Banking (annual + quarterly): SHAPE/SCALE/NPA must be zero-FP
  const bf = await prisma.bankingFundamental.findMany({ select: { interestEarned: true, netProfit: true, totalAssets: true, nnpaAbsolute: true, gnpaAbsolute: true } });
  const bq = await prisma.bankingQuarterlyResult.findMany({ select: { interestEarned: true, netProfit: true, nnpaAbsolute: true, gnpaAbsolute: true } });
  let bShape = 0, bScale = 0, bNpa = 0;
  for (const r of [...bf, ...bq]) {
    if (checkPlContentless(num(r.interestEarned), num(r.netProfit))) bShape++;
    if (checkScale(num(r.interestEarned)) || checkScale(num((r as { totalAssets?: { toNumber(): number } }).totalAssets ?? null))) bScale++;
    if (checkNpaHierarchy(num(r.nnpaAbsolute), num(r.gnpaAbsolute))) bNpa++;
  }
  console.log(`   banking rows=${bf.length + bq.length}: shapeFP=${bShape} scaleFP=${bScale} npaViol=${bNpa}`);
  check("banking SHAPE zero-FP", bShape === 0, bShape);
  check("banking SCALE zero-FP", bScale === 0, bScale);
  check("banking NNPA≤GNPA holds (0 violations)", bNpa === 0, bNpa);

  // NBFC
  const nf = await prisma.nbfcFundamental.findMany({ select: { revenue: true, netProfit: true, totalAssets: true, loans: true } });
  const nq = await prisma.nbfcQuarterlyResult.findMany({ select: { revenue: true, netProfit: true } });
  let nShape = 0, nScale = 0;
  for (const r of [...nf, ...nq]) {
    if (checkPlContentless(num(r.revenue), num(r.netProfit))) nShape++;
    if (checkScale(num(r.revenue)) || checkScale(num((r as { totalAssets?: { toNumber(): number } }).totalAssets ?? null)) || checkScale(num((r as { loans?: { toNumber(): number } }).loans ?? null))) nScale++;
  }
  console.log(`   nbfc rows=${nf.length + nq.length}: shapeFP=${nShape} scaleFP=${nScale}`);
  check("nbfc SHAPE zero-FP", nShape === 0, nShape);
  check("nbfc SCALE zero-FP", nScale === 0, nScale);

  // Insurance (LI + GI): SHAPE/SCALE zero-FP; solvency<1.0 CATCHES the mis-parses
  const lf = await prisma.lifeInsuranceFundamental.findMany({ select: { grossPremiumIncome: true, netProfit: true, totalAssets: true, solvencyRatio: true } });
  const lq = await prisma.lifeInsuranceQuarterlyResult.findMany({ select: { grossPremiumIncome: true, netProfit: true, solvencyRatio: true } });
  const gf = await prisma.generalInsuranceFundamental.findMany({ select: { grossPremiumsWritten: true, netProfit: true, totalAssets: true, solvencyRatio: true } });
  const gq = await prisma.generalInsuranceQuarterlyResult.findMany({ select: { grossPremiumsWritten: true, netProfit: true, solvencyRatio: true } });
  let iShape = 0, iScale = 0, iSolv = 0;
  for (const r of [...lf, ...lq]) {
    if (checkPlContentless(num(r.grossPremiumIncome), num(r.netProfit))) iShape++;
    if (checkScale(num(r.grossPremiumIncome)) || checkScale(num((r as { totalAssets?: { toNumber(): number } }).totalAssets ?? null))) iScale++;
    if (checkSolvencyImplausible(num(r.solvencyRatio))) iSolv++;
  }
  for (const r of [...gf, ...gq]) {
    if (checkPlContentless(num(r.grossPremiumsWritten), num(r.netProfit))) iShape++;
    if (checkScale(num(r.grossPremiumsWritten)) || checkScale(num((r as { totalAssets?: { toNumber(): number } }).totalAssets ?? null))) iScale++;
    if (checkSolvencyImplausible(num(r.solvencyRatio))) iSolv++;
  }
  console.log(`   insurance rows=${lf.length + lq.length + gf.length + gq.length}: shapeFP=${iShape} scaleFP=${iScale} solvencyCaught=${iSolv}`);
  check("insurance SHAPE zero-FP", iShape === 0, iShape);
  check("insurance SCALE zero-FP", iScale === 0, iScale);
  check("solvency<1.0 CATCHES the known mis-parses (>0)", iSolv > 0, iSolv);

  // Bank supplementary: CASA/Tier-1 found rows stay inside their bands
  const supp = await prisma.bankSupplementary.findMany({ where: { status: "found" }, select: { metric: true, value: true } });
  let bandViol = 0;
  for (const r of supp) {
    const band = r.metric === "casa_pct" ? CASA_BAND : TIER1_BAND;
    if (checkBand(num(r.value), band)) bandViol++;
  }
  console.log(`   bank_supplementary found=${supp.length}: bandViol=${bandViol}`);
  check("CASA/Tier-1 real values within band (0 violations)", bandViol === 0, bandViol);

  await cleanup();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await prisma.$disconnect();
  if (passed !== results.length) process.exit(1);
}
main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
