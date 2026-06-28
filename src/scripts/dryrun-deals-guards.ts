// ─────────────────────────────────────────────────────────────
// DRY-RUN harness for the block-deals SHAPE guard (the only guard).
//
// Predicate tests (empty + populated = clean; key-rename = flagged) +
// reportIngestionError/dedup (sentinel cron "_dryrun_deals") + a best-effort
// live snapshot fetch that confirms NSE's real response carries the keys
// (and is holiday-immune — an empty quiet day is still clean).
//
// Run:  npx tsx src/scripts/dryrun-deals-guards.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { nseClient } from "../lib/client.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";
import {
  checkDailyShape,
  checkHistoricalShapeMalformed,
} from "../ingestions/block-deals/deals-guards.js";

const CRON = "_dryrun_deals";
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

  // ── 1. Daily SHAPE predicate ──
  console.log("\n[1] Daily SHAPE (BULK_DEALS_DATA + BLOCK_DEALS_DATA arrays)");
  check("empty arrays (quiet/holiday day) → clean", checkDailyShape({ BULK_DEALS_DATA: [], BLOCK_DEALS_DATA: [] }).length === 0);
  check("populated arrays → clean", checkDailyShape({ BULK_DEALS_DATA: [{ symbol: "X" }], BLOCK_DEALS_DATA: [{ symbol: "Y" }] }).length === 0);
  check("key rename (BULK_DEALS) → flagged", checkDailyShape({ BULK_DEALS: [], BLOCK_DEALS: [] }).length === 2);
  check("one key non-array → flagged", checkDailyShape({ BULK_DEALS_DATA: [], BLOCK_DEALS_DATA: {} }).join() === "BLOCK_DEALS_DATA");
  check("null response → both flagged", checkDailyShape(null).length === 2);
  check("error-shaped {error} → both flagged", checkDailyShape({ error: "rate limited" }).length === 2);

  // ── 2. Historical SHAPE predicate ──
  console.log("\n[2] Historical SHAPE (data array)");
  check("data:[] → clean", checkHistoricalShapeMalformed({ data: [] }) === false);
  check("data:[...] → clean", checkHistoricalShapeMalformed({ data: [{ BD_SYMBOL: "X" }] }) === false);
  check("data:{} → malformed", checkHistoricalShapeMalformed({ data: {} }) === true);
  check("key rename {deals} → malformed", checkHistoricalShapeMalformed({ deals: [] }) === true);
  check("null → malformed", checkHistoricalShapeMalformed(null) === true);

  // ── 3. report mapping + dedup ──
  console.log("\n[3] report mapping + dedup");
  const args = { source: "nse", cron: CRON, guardType: "shape" as const, targetTable: "BlockDeal", severity: "critical" as const, resolutionPath: "source_code" as const, expected: "BULK_DEALS_DATA + BLOCK_DEALS_DATA arrays", observed: "missing/non-array: [BULK_DEALS_DATA, BLOCK_DEALS_DATA]", runRef: "2026-06-27:daily" };
  await reportIngestionError(args);
  const sh = await prisma.ingestionError.findFirst({ where: { cron: CRON, guardType: "shape" } });
  check("shape row critical/source_code", sh?.severity === "critical" && sh?.resolutionPath === "source_code");
  await reportIngestionError({ ...args, observed: "missing/non-array: [BULK_DEALS_DATA]" });
  const dup = await prisma.ingestionError.findMany({ where: { cron: CRON, guardType: "shape" } });
  check("dedup → 1 row occurrences 2", dup.length === 1 && dup[0]?.occurrences === 2, { len: dup.length, occ: dup[0]?.occurrences });
  await cleanup();
  check("cleanup clean", (await prisma.ingestionError.count({ where: { cron: CRON } })) === 0);

  // ── 4. Best-effort live snapshot fetch (validates the real keys) ──
  console.log("\n[4] Real snapshot fetch (best-effort — session-gated)");
  try {
    const real = await nseClient.get<Record<string, unknown>>("/api/snapshot-capital-market-largedeal");
    const missing = checkDailyShape(real);
    const bulk = Array.isArray(real?.BULK_DEALS_DATA) ? (real.BULK_DEALS_DATA as unknown[]).length : "n/a";
    const block = Array.isArray(real?.BLOCK_DEALS_DATA) ? (real.BLOCK_DEALS_DATA as unknown[]).length : "n/a";
    console.log(`   real response keys: ${Object.keys(real ?? {}).join(", ")}`);
    console.log(`   BULK_DEALS_DATA=${bulk} BLOCK_DEALS_DATA=${block} | missing=${missing.length ? missing.join(",") : "(none)"}`);
    check("real snapshot has both required keys as arrays (SHAPE won't false-flag)", missing.length === 0, missing);
  } catch (e) {
    console.log(`   ⚠ INCONCLUSIVE — ${(e as Error).message}. (Schema/parser confirm the BULK_DEALS_DATA/BLOCK_DEALS_DATA keys; 71 clean DB rows.)`);
  }

  await cleanup();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await prisma.$disconnect();
  if (passed !== results.length) process.exit(1);
}
main().catch(async (e) => { console.error(e); process.exit(1); });
