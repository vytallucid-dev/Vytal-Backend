// Self-cleaning wiring proof: a per-stock shareholding failure routes into the
// SAME IngestionError surface the /settings/ingestion-errors UI reads. Inserts one
// synthetic failure via the real reportIngestionError seam, reads it back through
// the exact filter listIngestionErrors uses, then DELETES it (leaves no residue).
//   npx tsx src/scripts/verify-shareholding-error-wiring.ts
import { prisma } from "../db/prisma.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";
import { SHAREHOLDING_CRON } from "../ingestions/shareholdings/shareholding-guards.js";

const TEST_ENTITY = "__PASS1_WIRING_TEST__";

async function main() {
  // 1. INSERT via the real seam (same call my backfill makes on a hard failure).
  const id = await reportIngestionError({
    source: "nse_shareholding_xbrl", cron: SHAREHOLDING_CRON, guardType: "count",
    targetTable: "ShareholdingPattern", targetEntity: TEST_ENTITY, severity: "high",
    resolutionPath: "source_code",
    expected: "≥1 shareholding filing ingested for this stock",
    observed: "ingest failed before any filing landed",
    detail: "WIRING TEST — synthetic; deleted at end of script.",
    runRef: `${SHAREHOLDING_CRON}:pass1-wiring-test`,
  });
  console.log("1. inserted synthetic failure, id:", id);

  // 2. READ BACK exactly as the UI backend (listIngestionErrors) would: default
  //    filter is status:"open"; it lists newest-first. Confirm ours is present.
  const asUiSees = await prisma.ingestionError.findMany({
    where: { status: "open", cron: SHAREHOLDING_CRON },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, cron: true, guardType: true, severity: true, targetTable: true, targetEntity: true, resolutionPath: true, status: true },
  });
  const found = asUiSees.find((r) => r.targetEntity === TEST_ENTITY);
  console.log("2. visible in /settings/ingestion-errors query:", found ? "✅ YES" : "❌ NO");
  if (found) console.log("   row:", JSON.stringify(found));

  // 3. CLEANUP — delete the synthetic row so nothing lingers.
  const del = await prisma.ingestionError.deleteMany({ where: { targetEntity: TEST_ENTITY, runRef: `${SHAREHOLDING_CRON}:pass1-wiring-test` } });
  console.log("3. cleanup — deleted synthetic rows:", del.count);

  const residual = await prisma.ingestionError.count({ where: { targetEntity: TEST_ENTITY } });
  console.log("   residual test rows (MUST be 0):", residual, residual === 0 ? "✅" : "❌");

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
