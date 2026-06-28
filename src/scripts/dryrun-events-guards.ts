// ─────────────────────────────────────────────────────────────
// DRY-RUN harness for the corporate-events guards (3 families).
//
// Predicate tests + reportIngestionError/dedup (sentinel cron "_dryrun_evt")
// + a real-data zero-FP pass over the live corporate_events: the RANGE
// predicates and the classification rates must stay clean on real data
// (the date/ordering invariants have zero historical violations; the
// record_date/dividend-no-amount/bonus-no-ratio rates sit below threshold).
//
// Run:  npx tsx src/scripts/dryrun-events-guards.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";
import {
  checkFetchFloor,
  checkBatchRate,
  checkDividendRange,
  checkEventDateImplausible,
  checkRecordBeforeEx,
  RECORD_DATE_MAX,
  DIV_NO_AMOUNT_MAX,
  BONUS_NO_RATIO_MAX,
} from "../ingestions/corporate-events/events-guards.js";

const CRON = "_dryrun_evt";
const results: { ok: boolean; name: string; got?: unknown }[] = [];
function check(name: string, ok: boolean, got?: unknown) {
  results.push({ ok, name, got });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}
const num = (d: { toNumber(): number } | null) => (d == null ? null : d.toNumber());
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
async function cleanup() {
  await prisma.ingestionError.deleteMany({ where: { cron: CRON } });
}

async function main() {
  await cleanup();
  const now = D("2026-06-27");

  // ── 1. Predicates ──
  console.log("\n[1] Predicates");
  check("COUNT 3 fetched → collapse", checkFetchFloor(3) === true);
  check("COUNT 52 fetched → clean", checkFetchFloor(52) === false);
  check("CLASS record_date 40/100 → flagged", checkBatchRate(40, 100, RECORD_DATE_MAX) != null);
  check("CLASS record_date 1/100 → clean (normal 0.9%)", checkBatchRate(1, 100, RECORD_DATE_MAX) === null);
  check("CLASS div-no-amount 10/100 → clean (normal 10.2%)", checkBatchRate(10, 100, DIV_NO_AMOUNT_MAX) === null);
  check("CLASS div-no-amount 40/100 → flagged (spike)", checkBatchRate(40, 100, DIV_NO_AMOUNT_MAX) != null);
  check("CLASS small batch n<20 → skipped", checkBatchRate(15, 18, RECORD_DATE_MAX) === null);
  check("RANGE dividend 512 → clean (real max)", checkDividendRange(512) === false);
  check("RANGE dividend 2500 → flagged", checkDividendRange(2500) === true);
  check("RANGE dividend 0 → flagged", checkDividendRange(0) === true);
  check("RANGE dividend null → clean", checkDividendRange(null) === false);
  check("RANGE date 2026 → clean", checkEventDateImplausible(D("2026-08-21"), now) === false);
  check("RANGE date 1999 → flagged", checkEventDateImplausible(D("1999-01-01"), now) === true);
  check("RANGE date now+5y → flagged", checkEventDateImplausible(D("2031-01-01"), now) === true);
  check("ORDER recordDate < exDate → flagged", checkRecordBeforeEx(D("2025-04-23"), D("2025-04-22")) === true);
  check("ORDER recordDate ≥ exDate → clean", checkRecordBeforeEx(D("2025-04-22"), D("2025-04-23")) === false);

  // ── 2. report mapping + dedup ──
  console.log("\n[2] report mapping + dedup");
  await reportIngestionError({ source: "nse_events", cron: CRON, guardType: "count", targetTable: "CorporateEvent", severity: "high", resolutionPath: "source_code", expected: "≥10", observed: "3 fetched", runRef: "events:weekly" });
  const c = await prisma.ingestionError.findFirst({ where: { cron: CRON, guardType: "count" } });
  check("count row high/source_code", c?.severity === "high" && c?.resolutionPath === "source_code");
  await reportIngestionError({ source: "nse_events", cron: CRON, guardType: "range", targetTable: "CorporateEvent", targetField: "dividendAmount", targetEntity: "X@dividend@2026-05-01", severity: "medium", resolutionPath: "admin_fill", expected: "(0,1000]", observed: "dividendAmount=2500", runRef: "events:weekly" });
  const rg = await prisma.ingestionError.findFirst({ where: { cron: CRON, guardType: "range" } });
  check("range div row medium/admin_fill", rg?.severity === "medium" && rg?.resolutionPath === "admin_fill");
  const dArgs = { source: "nse_events", cron: CRON, guardType: "null_rate" as const, targetTable: "CorporateEvent", targetField: "eventType", targetEntity: null, severity: "medium" as const, resolutionPath: "source_code" as const, expected: "≤10%", observed: "40%", runRef: "events:weekly" };
  await reportIngestionError(dArgs);
  await reportIngestionError({ ...dArgs, observed: "45%" });
  const dup = await prisma.ingestionError.findMany({ where: { cron: CRON, guardType: "null_rate" } });
  check("dedup → 1 row occurrences 2", dup.length === 1 && dup[0]?.occurrences === 2, { len: dup.length, occ: dup[0]?.occurrences });
  await cleanup();
  check("cleanup clean", (await prisma.ingestionError.count({ where: { cron: CRON } })) === 0);

  // ── 3. REAL-DATA zero-FP pass over live corporate_events ──
  console.log("\n[3] Real-data — predicates over live corporate_events");
  const rows = await prisma.corporateEvent.findMany({
    select: { eventType: true, eventDate: true, exDate: true, recordDate: true, dividendAmount: true, bonusRatio: true },
  });
  let divRangeFP = 0, dateFP = 0, orderFP = 0;
  let recordDateCount = 0, divCount = 0, divNoAmount = 0, bonusCount = 0, bonusNoRatio = 0;
  for (const r of rows) {
    if (r.eventType === "record_date") recordDateCount++;
    if (checkEventDateImplausible(r.eventDate, new Date())) dateFP++;
    if (checkRecordBeforeEx(r.exDate, r.recordDate)) orderFP++;
    if (r.eventType === "dividend") {
      divCount++;
      if (r.dividendAmount == null) divNoAmount++;
      else if (checkDividendRange(num(r.dividendAmount))) divRangeFP++;
    }
    if (r.eventType === "bonus") {
      bonusCount++;
      if (r.bonusRatio == null) bonusNoRatio++;
    }
  }
  console.log(`   rows=${rows.length} | divRangeFP=${divRangeFP} dateFP=${dateFP} orderFP=${orderFP}`);
  console.log(`   classification: record_date=${recordDateCount}/${rows.length} divNoAmount=${divNoAmount}/${divCount} bonusNoRatio=${bonusNoRatio}/${bonusCount}`);
  check("RANGE dividend zero-FP on real rows", divRangeFP === 0, divRangeFP);
  check("RANGE date zero-FP on real rows", dateFP === 0, dateFP);
  check("ORDER recordDate≥exDate holds (0 violations)", orderFP === 0, orderFP);
  check("CLASS record_date rate below threshold", checkBatchRate(recordDateCount, rows.length, RECORD_DATE_MAX) === null, `${recordDateCount}/${rows.length}`);
  check("CLASS dividend-no-amount rate below threshold", checkBatchRate(divNoAmount, divCount, DIV_NO_AMOUNT_MAX) === null, `${divNoAmount}/${divCount}`);
  check("CLASS bonus-no-ratio rate below threshold", checkBatchRate(bonusNoRatio, bonusCount, BONUS_NO_RATIO_MAX) === null, `${bonusNoRatio}/${bonusCount}`);

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
