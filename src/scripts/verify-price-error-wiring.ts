// Self-cleaning wiring proof for Pass-3: a per-stock PRICE backfill failure routes
// into the SAME IngestionError surface /settings/ingestion-errors reads. Because 0
// of 281 actually failed, this confirms the "0 open" count is HONEST (nothing failed)
// rather than SILENT (failures not surfacing). Inserts one synthetic price failure
// via the real seam, reads it back through the UI-backend filter, then DELETES it.
//   npx tsx src/scripts/verify-price-error-wiring.ts
import { prisma } from "../db/prisma.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";

const CRON = "yahoo_price_backfill";
const TEST_ENTITY = "__PASS3_PRICE_WIRING_TEST__";

async function main() {
  const id = await reportIngestionError({
    source: "yahoo_finance", cron: CRON, guardType: "count", targetTable: "DailyPrice",
    targetEntity: TEST_ENTITY, severity: "high", resolutionPath: "source_code",
    expected: "≥1 daily price row from Yahoo (5yr, listing-bounded)",
    observed: "Yahoo returned 0 rows for __TEST__.NS",
    detail: "WIRING TEST — synthetic; deleted at end of script.", runRef: `${CRON}:pass3-wiring-test`,
  });
  console.log("1. inserted synthetic price failure, id:", id);

  const asUiSees = await prisma.ingestionError.findMany({
    where: { status: "open", cron: CRON }, orderBy: { lastSeenAt: "desc" },
    select: { id: true, cron: true, guardType: true, severity: true, targetTable: true, targetEntity: true, resolutionPath: true, status: true },
  });
  const found = asUiSees.find((r) => r.targetEntity === TEST_ENTITY);
  console.log("2. visible in /settings/ingestion-errors query:", found ? "✅ YES" : "❌ NO");
  if (found) console.log("   row:", JSON.stringify(found));

  const del = await prisma.ingestionError.deleteMany({ where: { targetEntity: TEST_ENTITY, runRef: `${CRON}:pass3-wiring-test` } });
  const residual = await prisma.ingestionError.count({ where: { targetEntity: TEST_ENTITY } });
  console.log("3. cleanup — deleted:", del.count, "| residual (MUST 0):", residual, residual === 0 ? "✅" : "❌");

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
