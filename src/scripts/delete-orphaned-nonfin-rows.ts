// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// DELETE ORPHANED NON-FINANCIAL ROWS — classification-hardening Task 2.
//
// The 5 stocks named in the task (ANGELONE, BAJAJHLDNG, NAM-INDIA, NUVAMA, UTIAMC) plus HDFCAMC
// (the 14th disagreement found by Task 1's validation pass and corrected the same way) each carry
// leftover rows in the non-financial Fundamental / QuarterlyResult tables — real numbers filed while
// each stock was still (wrongly) classified non_financial, now stranded there because every read
// path that matters dispatches on the stock's CURRENT industryType (nbfc for all six) and none of
// them read these tables for an nbfc-classified stock's own data (see the recon scripts run before
// this: recon-stale-nonfin-readpath.ts, recon-amc-pg-snapshots.ts, recon-results-feed-leak-check.ts,
// recon-pending-jobs-for-stale-stocks.ts — the diligence trail for "confirm no path reads them").
//
// Read-only by default. Pass --apply to actually delete.
//
//   npx tsx src/scripts/delete-orphaned-nonfin-rows.ts             (dry run — prints counts only)
//   npx tsx src/scripts/delete-orphaned-nonfin-rows.ts --apply     (deletes, prints counts removed)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

const SYMBOLS = ["ANGELONE", "BAJAJHLDNG", "NAM-INDIA", "NUVAMA", "UTIAMC", "HDFCAMC"];

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`════ DELETE ORPHANED NON-FINANCIAL ROWS (${apply ? "APPLY" : "DRY RUN"}) ════\n`);

  const stocks = await prisma.stock.findMany({
    where: { symbol: { in: SYMBOLS } },
    select: { id: true, symbol: true, industryType: true },
  });
  const bySymbol = new Map(stocks.map((s) => [s.symbol, s]));

  let totalFund = 0;
  let totalQr = 0;
  const perStock: { symbol: string; fund: number; qr: number }[] = [];

  for (const symbol of SYMBOLS) {
    const stock = bySymbol.get(symbol);
    if (!stock) {
      console.log(`  ${symbol.padEnd(12)} NOT FOUND — skipping`);
      continue;
    }
    if (stock.industryType === "non_financial") {
      // Safety valve: never delete a stock's ONLY data source. Every stock this script
      // targets must already be classified into a financial industry (its own nbfc/etc
      // tables are the live source) before its non-financial rows can be called orphaned.
      console.log(`  ${symbol.padEnd(12)} ⚠ SKIPPED — industryType is still non_financial (would delete its only data)`);
      continue;
    }

    const [fund, qr] = await Promise.all([
      prisma.fundamental.count({ where: { stockId: stock.id } }),
      prisma.quarterlyResult.count({ where: { stockId: stock.id } }),
    ]);
    perStock.push({ symbol, fund, qr });
    totalFund += fund;
    totalQr += qr;
    console.log(`  ${symbol.padEnd(12)} industryType=${stock.industryType.padEnd(10)} Fundamental=${fund}  QuarterlyResult=${qr}`);

    if (apply && (fund > 0 || qr > 0)) {
      const [delFund, delQr] = await Promise.all([
        prisma.fundamental.deleteMany({ where: { stockId: stock.id } }),
        prisma.quarterlyResult.deleteMany({ where: { stockId: stock.id } }),
      ]);
      console.log(`      deleted: Fundamental=${delFund.count}  QuarterlyResult=${delQr.count}`);
    }
  }

  console.log(`\n  TOTAL  Fundamental=${totalFund}  QuarterlyResult=${totalQr}  (${totalFund + totalQr} rows)`);
  console.log(apply ? "\n  ✅ Applied." : "\n  Dry run — no rows deleted. Re-run with --apply to delete.");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
