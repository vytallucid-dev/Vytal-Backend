// ═══════════════════════════════════════════════════════════════
// STAGE 3 REPAIR — prevClose at the old backfill boundary.
//
//   PREVIEW:  npx tsx src/scripts/stage3-prevclose-repair.ts
//   EXECUTE:  npx tsx src/scripts/stage3-prevclose-repair.ts --confirm
//
// insertDailyPrices derives prevClose[i] = close[i-1] WITHIN the batch it is
// given, so the first row of any batch gets prevClose = null. That was correct
// when 2019-08-01 was genuinely the first bar a stock had. Now that Stage 3 has
// inserted earlier bars, those 372 boundary rows have a null prevClose with a
// real prior bar sitting right before them.
//
// This sets prevClose from the actual preceding bar, and ONLY where it is null —
// a row that already has a value (bhavcopy-sourced, or correctly chained) is
// never touched.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const CONFIRM = process.argv.includes("--confirm");

async function main(): Promise<void> {
  console.log(`\n=== STAGE 3 REPAIR — prevClose at the backfill boundary ===`);
  console.log(`  mode: ${CONFIRM ? "--confirm (LIVE WRITE)" : "PREVIEW"}\n`);

  const [before] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `WITH r AS (SELECT id, prev_close, lag(close) OVER (PARTITION BY stock_id ORDER BY date) prior
                FROM daily_prices)
     SELECT count(*) FILTER (WHERE prev_close IS NULL AND prior IS NOT NULL) AS fixable,
            count(*) FILTER (WHERE prev_close IS NULL) AS "nullTotal" FROM r`,
  );
  console.log(`  rows with null prevClose but a real prior bar: ${Number(before.fixable)}`);
  console.log(`  rows with null prevClose in total:             ${Number(before.nullTotal)}  (the rest are genuine first bars)`);

  if (Number(before.fixable) === 0) { console.log("\n  nothing to repair\n"); await prisma.$disconnect(); return; }

  const sample = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `WITH r AS (SELECT d.id, s.symbol, d.date::text dt, d.close,
                       lag(d.close) OVER (PARTITION BY d.stock_id ORDER BY d.date) prior, d.prev_close
                FROM daily_prices d JOIN stocks s ON s.id = d.stock_id)
     SELECT symbol, dt, close, prior FROM r WHERE prev_close IS NULL AND prior IS NOT NULL LIMIT 6`,
  );
  console.log(`\n  sample:`);
  for (const r of sample) console.log(`     ${String(r.symbol).padEnd(13)} ${r.dt}  close=${r.close}  prevClose null -> ${r.prior}`);

  if (!CONFIRM) {
    console.log(`\n  PREVIEW only — re-run with --confirm to write.\n`);
    await prisma.$disconnect();
    return;
  }

  // Update ONLY where prev_close IS NULL — never overwrite an existing value.
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE daily_prices d
     SET prev_close = r.prior
     FROM (SELECT id, lag(close) OVER (PARTITION BY stock_id ORDER BY date) prior
           FROM daily_prices) r
     WHERE d.id = r.id AND d.prev_close IS NULL AND r.prior IS NOT NULL`,
  );
  console.log(`\n  rows updated: ${updated}`);

  const [after] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `WITH r AS (SELECT prev_close, lag(close) OVER (PARTITION BY stock_id ORDER BY date) prior
                FROM daily_prices)
     SELECT count(*) FILTER (WHERE prev_close IS NULL AND prior IS NOT NULL) AS fixable,
            count(*) FILTER (WHERE prev_close IS NULL) AS "nullTotal" FROM r`,
  );
  console.log(`  remaining fixable: ${Number(after.fixable)} (must be 0)`);
  console.log(`  null prevClose total now: ${Number(after.nullTotal)} (genuine first bars only)\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
