// ─────────────────────────────────────────────────────────────────────────────
// PASS 3 · Part A — 5yr Yahoo price backfill for the 281 new display-only stocks.
// Reuses the KNOWN-GOOD per-stock worker (backfillStock) from yahoo-price-backfill
// (listing-date-bounded, idempotent via daily_prices.skipDuplicates). Targets EXACTLY
// the new set (current DB symbols ∖ docs/original224_symbols.txt → reproducible).
//
// Closes the silent-gap: EVERY per-stock total failure (no Yahoo coverage / 0 rows /
// hard error) calls reportIngestionError → /settings/ingestion-errors. A failed symbol
// is never silently absent (expect an LTIM-class handful with no Yahoo coverage).
//
//   npx tsx src/scripts/backfill-nifty500-pass3-prices.ts [--years 5] [--dry-run] [--skip-existing]
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { backfillStock, toYahooTicker, type StockResult } from "./yahoo-price-backfill.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";
import fs from "fs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PRICE_CRON = "yahoo_price_backfill";

async function reportPriceFailure(symbol: string, observed: string) {
  await reportIngestionError({
    source: "yahoo_finance",
    cron: PRICE_CRON,
    guardType: "count",
    targetTable: "DailyPrice",
    targetEntity: symbol,
    severity: "high",
    resolutionPath: "source_code",
    expected: "≥1 daily price row from Yahoo (5yr, listing-bounded)",
    observed: observed.slice(0, 250),
    detail: `Pass-3 price backfill: Yahoo ticker ${toYahooTicker(symbol)} yielded no usable price history. ` +
      `Add a YAHOO_SYMBOL_OVERRIDES entry or an alternate source if this symbol should have prices.`,
    runRef: `${PRICE_CRON}:pass3`,
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const years = argv.includes("--years") ? parseInt(argv[argv.indexOf("--years") + 1], 10) : 5;
  const dryRun = argv.includes("--dry-run");
  const skipExisting = argv.includes("--skip-existing");

  const original = new Set(fs.readFileSync("docs/original224_symbols.txt", "utf8").trim().split(",").map((s) => s.trim()));
  const all = await prisma.stock.findMany({ select: { id: true, symbol: true }, orderBy: { symbol: "asc" } });
  const target = all.filter((s) => !original.has(s.symbol));
  console.log(`[Pass3-prices] targeting ${target.length} new stocks (DB ∖ original224), years=${years}, dryRun=${dryRun}, skipExisting=${skipExisting}`);
  if (target.length === 0) { console.log("nothing to do."); await prisma.$disconnect(); return; }

  const BATCH = 10, DELAY = 3000;
  const results: StockResult[] = [];
  for (let i = 0; i < target.length; i += BATCH) {
    const batch = target.slice(i, i + BATCH);
    console.log(`[Pass3-prices] batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(target.length / BATCH)}: ${batch.map((s) => s.symbol).join(", ")}`);
    for (const s of batch) {
      const r = await backfillStock(prisma as any, s.id, s.symbol, years, skipExisting, dryRun);
      results.push(r);
      const icon = r.status === "success" ? "✓" : r.status === "skipped" ? "⊘" : "✗";
      console.log(`  ${icon} ${r.symbol.padEnd(14)} ${r.rowsInserted} rows ${r.durationMs}ms${r.error ? "  ⚠ " + r.error.slice(0, 70) : ""}`);
      // SILENT-GAP FIX: any total failure (failed / no_data) → surface in the error UI.
      if (!dryRun && (r.status === "failed" || r.status === "no_data")) {
        await reportPriceFailure(r.symbol, r.error ?? "no data");
      }
    }
    if (i + BATCH < target.length) await sleep(DELAY);
  }

  const success = results.filter((r) => r.status === "success");
  const failed = results.filter((r) => r.status === "failed" || r.status === "no_data");
  const skipped = results.filter((r) => r.status === "skipped");
  console.log(`\n=== Pass3-prices done ===`);
  console.log(`targeted        : ${target.length}`);
  console.log(`success         : ${success.length}`);
  console.log(`failed (→ UI)   : ${failed.length}${failed.length ? " — " + failed.map((r) => r.symbol).join(", ") : ""}`);
  console.log(`skipped         : ${skipped.length}`);
  console.log(`rows inserted   : ${results.reduce((s, r) => s + r.rowsInserted, 0).toLocaleString()}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
