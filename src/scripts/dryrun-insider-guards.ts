// ─────────────────────────────────────────────────────────────
// DRY-RUN harness for the insider-trades guards.
//
// Predicate tests + reportIngestionError/dedup (sentinel cron "_dryrun_ins")
// + a real-data pass over the live insider_trades: the categorization +
// null-rate stay below threshold (no false-positives), and the future-date
// validity guard CATCHES the known future-dated rows (a parse quirk).
//
// Run:  npx tsx src/scripts/dryrun-insider-guards.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";
import {
  isFeedMalformed,
  checkBatchRate,
  checkFutureDate,
  TXN_OTHER_MAX,
  CAT_OTHER_MAX,
  CORE_NULL_MAX,
  VALUE_NULL_MAX,
} from "../ingestions/insider-trades/insider-guards.js";

const CRON = "_dryrun_ins";
const results: { ok: boolean; name: string; got?: unknown }[] = [];
function check(name: string, ok: boolean, got?: unknown) {
  results.push({ ok, name, got });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}
async function cleanup() {
  await prisma.ingestionError.deleteMany({ where: { cron: CRON } });
}

async function main() {
  await cleanup();
  const now = new Date();

  // ── 1. Predicates ──
  console.log("\n[1] Predicates");
  check("SHAPE {data:[]} → NOT malformed (legit quiet day)", isFeedMalformed({ data: [] }) === false);
  check("SHAPE {data:{}} → malformed (trap)", isFeedMalformed({ data: {} }) === true);
  check("SHAPE {data:null} → malformed", isFeedMalformed({ data: null }) === true);
  check("SHAPE {error:'x'} → malformed", isFeedMalformed({ error: "x" }) === true);
  check("SHAPE null response → not malformed (no-response, not shape)", isFeedMalformed(null) === false);
  check("SHAPE valid array → not malformed", isFeedMalformed({ data: [{ symbol: "X" }] }) === false);
  check("txn-other 5/30=17% → flagged (>10%, base 0.1%)", checkBatchRate(5, 30, TXN_OTHER_MAX) != null);
  check("txn-other 0/3040 → clean (base 0.1%)", checkBatchRate(3, 3040, TXN_OTHER_MAX) === null);
  check("cat-other 1461/3040=48% → clean (below 65%)", checkBatchRate(1461, 3040, CAT_OTHER_MAX) === null);
  check("cat-other 70/100=70% → flagged (>65%)", checkBatchRate(70, 100, CAT_OTHER_MAX) != null);
  check("MIN_BATCH: 5/12 → skipped (daily too small)", checkBatchRate(5, 12, TXN_OTHER_MAX) === null);
  check("null-rate core 3/40 → flagged (>5%)", checkBatchRate(3, 40, CORE_NULL_MAX) != null);
  check("null-rate value 1/100=1% → clean (base 1.3%)", checkBatchRate(1, 100, VALUE_NULL_MAX) === null);
  check("future date next month → flagged", checkFutureDate(new Date(now.getTime() + 40 * 86400_000), now) === true);
  check("future date yesterday → clean", checkFutureDate(new Date(now.getTime() - 86400_000), now) === false);

  // ── 2. report mapping + dedup ──
  console.log("\n[2] report mapping + dedup");
  await reportIngestionError({ source: "nse_pit", cron: CRON, guardType: "shape", targetTable: "InsiderTrade", severity: "critical", resolutionPath: "source_code", expected: "array", observed: "non-array data", runRef: "2026-06-19:daily" });
  const sh = await prisma.ingestionError.findFirst({ where: { cron: CRON, guardType: "shape" } });
  check("shape critical/source_code", sh?.severity === "critical" && sh?.resolutionPath === "source_code");
  await reportIngestionError({ source: "nse_pit", cron: CRON, guardType: "count", targetTable: "InsiderTrade", severity: "high", resolutionPath: "source_code", expected: "≥1/3", observed: "3 consecutive no_data", runRef: "2026-06-19:daily" });
  const c = await prisma.ingestionError.findFirst({ where: { cron: CRON, guardType: "count" } });
  check("streak count high/source_code", c?.severity === "high" && c?.resolutionPath === "source_code");
  const dArgs = { source: "nse_pit", cron: CRON, guardType: "null_rate" as const, targetTable: "InsiderTrade", targetField: "transactionType", severity: "medium" as const, resolutionPath: "source_code" as const, expected: "≤10%", observed: "40%", runRef: "x" };
  await reportIngestionError(dArgs);
  await reportIngestionError({ ...dArgs, observed: "45%" });
  const dup = await prisma.ingestionError.findMany({ where: { cron: CRON, guardType: "null_rate", targetField: "transactionType" } });
  check("dedup → 1 row occurrences 2", dup.length === 1 && dup[0]?.occurrences === 2, { len: dup.length, occ: dup[0]?.occurrences });
  await cleanup();
  check("cleanup clean", (await prisma.ingestionError.count({ where: { cron: CRON } })) === 0);

  // ── 3. REAL-DATA pass over live insider_trades ──
  console.log("\n[3] Real-data — predicates over live insider_trades");
  const rows = await prisma.insiderTrade.findMany({
    select: { transactionType: true, personCategory: true, securitiesTraded: true, tradeDate: true, holdingPctPost: true, tradeValueCr: true, intimationDate: true },
  });
  const n = rows.length;
  const txnOther = rows.filter((r) => r.transactionType === "other").length;
  const catOther = rows.filter((r) => r.personCategory === "other").length;
  const stNull = rows.filter((r) => r.securitiesTraded == null).length;
  const tdNull = rows.filter((r) => r.tradeDate == null).length;
  const hpNull = rows.filter((r) => r.holdingPctPost == null).length;
  const tvNull = rows.filter((r) => r.tradeValueCr == null).length;
  const futureDated = rows.filter((r) => r.intimationDate !== null && checkFutureDate(r.intimationDate, now)).length;
  console.log(`   rows=${n} | txnOther=${txnOther} (${(100 * txnOther / n).toFixed(1)}%) catOther=${catOther} (${(100 * catOther / n).toFixed(1)}%)`);
  console.log(`   nulls: securitiesTraded=${stNull} tradeDate=${tdNull} holdingPctPost=${hpNull} tradeValueCr=${tvNull} | futureDated=${futureDated}`);
  check("txn-other rate below 10% threshold", checkBatchRate(txnOther, n, TXN_OTHER_MAX) === null, `${txnOther}/${n}`);
  check("cat-other rate below 65% threshold", checkBatchRate(catOther, n, CAT_OTHER_MAX) === null, `${catOther}/${n}`);
  check("securitiesTraded null below threshold", checkBatchRate(stNull, n, CORE_NULL_MAX) === null);
  check("tradeDate null below threshold", checkBatchRate(tdNull, n, CORE_NULL_MAX) === null);
  check("holdingPctPost null below threshold", checkBatchRate(hpNull, n, CORE_NULL_MAX) === null);
  check("tradeValueCr null below threshold", checkBatchRate(tvNull, n, VALUE_NULL_MAX) === null);
  check("future-date guard: no future-dated rows remain (backfill applied)", futureDated === 0, futureDated);

  await cleanup();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await prisma.$disconnect();
  if (passed !== results.length) process.exit(1);
}
main().catch(async (e) => { console.error(e); process.exit(1); });
