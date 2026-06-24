// ─────────────────────────────────────────────────────────────
// ONE-TIME MIGRATION: TATAMOTORS demerger → TMCV + TMPV
//
// TATAMOTORS split into two listed NSE entities effective Oct 1 2025:
//   TMCV — Tata Motors Ltd (Commercial Vehicles), BSE 544569, new listing
//   TMPV — Tata Motors Passenger Vehicles Ltd, BSE 500570, ISIN INE155A01022
//
// This script:
//   1. Renames the existing TATAMOTORS stock row to TMCV IN-PLACE,
//      preserving the UUID so all relations (daily_prices, stock_prices,
//      fundamentals, shareholding_patterns, etc.) stay attached.
//   2. Creates a fresh TMPV row (new UUID, no historical data yet).
//
// After running this script:
//   - The shareholding pipeline will query NSE with symbol=TMCV and symbol=TMPV
//     and get real post-demerger filings.
//   - The bhavcopy pipeline will match NSE rows by symbol — TMCV/TMPV rows
//     in the bhavcopy will now find their DB counterparts.
//   - Run `tsx src/scripts/yahoo-price-backfill.ts --symbols TMPV` to
//     backfill TMPV prices from Yahoo.
//
// Idempotent: re-running is safe (checks before writing).
//
// Usage:
//   tsx src/scripts/migrate-tatamotors-demerger.ts
//   tsx src/scripts/migrate-tatamotors-demerger.ts --dry-run
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("─────────────────────────────────────────────────────");
  console.log("TATAMOTORS Demerger Migration — TMCV + TMPV");
  console.log(`dry-run: ${DRY_RUN}`);
  console.log("─────────────────────────────────────────────────────\n");

  // ── 1. Locate existing rows ──────────────────────────────────

  const [tata, tmcv, tmpv] = await Promise.all([
    prisma.stock.findUnique({ where: { symbol: "TATAMOTORS" } }),
    prisma.stock.findUnique({ where: { symbol: "TMCV" } }),
    prisma.stock.findUnique({ where: { symbol: "TMPV" } }),
  ]);

  // ── 2. Step A: rename TATAMOTORS → TMCV ─────────────────────

  if (!tata && !tmcv) {
    console.error(
      "ERROR: Neither TATAMOTORS nor TMCV found in the stocks table. " +
        "Nothing to migrate.",
    );
    process.exit(1);
  }

  if (tmcv) {
    console.log(
      `SKIP step A — TMCV already exists (id: ${tmcv.id}). Rename already applied.`,
    );
  } else if (tata) {
    console.log(`Found TATAMOTORS row: id=${tata.id}, name="${tata.name}"`);
    if (DRY_RUN) {
      console.log(
        `[dry-run] Would rename TATAMOTORS → TMCV (update name to "Tata Motors Ltd (Commercial Vehicles)")`,
      );
    } else {
      await prisma.stock.update({
        where: { id: tata.id },
        data: {
          symbol: "TMCV",
          name: "Tata Motors Ltd (Commercial Vehicles)",
        },
      });
      console.log(
        `✓ Renamed TATAMOTORS → TMCV (id ${tata.id} preserved — all relations intact)`,
      );
    }
  }

  // ── 3. Step B: insert fresh TMPV row ────────────────────────

  if (tmpv) {
    console.log(
      `SKIP step B — TMPV already exists (id: ${tmpv.id}).`,
    );
  } else {
    // Look up the automobile sector ID
    const sector = await prisma.sector.findFirst({
      where: { name: "automobile" },
      select: { id: true, name: true },
    });
    if (!sector) {
      console.error(
        'ERROR: Sector "automobile" not found. Run seed-nifty200.ts first.',
      );
      process.exit(1);
    }

    if (DRY_RUN) {
      console.log(
        `[dry-run] Would create TMPV stock (sectorId: ${sector.id}, isActive: true, industryType: non_financial)`,
      );
    } else {
      const created = await prisma.stock.create({
        data: {
          symbol: "TMPV",
          name: "Tata Motors Passenger Vehicles Ltd",
          sectorId: sector.id,
          exchange: "NSE",
          isActive: true,
          industryType: "non_financial",
        },
        select: { id: true },
      });
      console.log(`✓ Created TMPV (new id: ${created.id})`);
    }
  }

  // ── 4. Verification report ───────────────────────────────────

  if (!DRY_RUN) {
    const [finalTmcv, finalTmpv, stillTata] = await Promise.all([
      prisma.stock.findUnique({
        where: { symbol: "TMCV" },
        select: {
          id: true,
          symbol: true,
          name: true,
          isActive: true,
          _count: {
            select: {
              dailyPrices: true,
              shareholdingPatterns: true,
              fundamentals: true,
            },
          },
        },
      }),
      prisma.stock.findUnique({
        where: { symbol: "TMPV" },
        select: {
          id: true,
          symbol: true,
          name: true,
          isActive: true,
          _count: {
            select: {
              dailyPrices: true,
              shareholdingPatterns: true,
              fundamentals: true,
            },
          },
        },
      }),
      prisma.stock.findUnique({ where: { symbol: "TATAMOTORS" } }),
    ]);

    console.log("\n─── VERIFICATION ─────────────────────────────────────");

    if (stillTata) {
      console.error(
        `ERROR: TATAMOTORS row still exists (id: ${stillTata.id}) — rename did not complete`,
      );
    } else {
      console.log("✓ TATAMOTORS symbol: gone from DB");
    }

    if (finalTmcv) {
      console.log(`✓ TMCV: id=${finalTmcv.id}`);
      console.log(`        dailyPrices=${finalTmcv._count.dailyPrices}  shareholdingPatterns=${finalTmcv._count.shareholdingPatterns}  fundamentals=${finalTmcv._count.fundamentals}`);
    } else {
      console.error("ERROR: TMCV not found after migration");
    }

    if (finalTmpv) {
      console.log(`✓ TMPV: id=${finalTmpv.id}`);
      console.log(`        dailyPrices=${finalTmpv._count.dailyPrices}  shareholdingPatterns=${finalTmpv._count.shareholdingPatterns}  fundamentals=${finalTmpv._count.fundamentals}`);
    } else {
      console.error("ERROR: TMPV not found after migration");
    }

    console.log("\nNext steps:");
    console.log(
      "  1. tsx src/scripts/yahoo-price-backfill.ts --symbols TMPV   # backfill TMPV price history",
    );
    console.log(
      "  2. Trigger shareholding backfill for TMCV + TMPV via admin UI or ingest script",
    );
    console.log(
      "  3. tsx src/scripts/fill-current-market-cap.ts               # re-stamp marketCap for TMCV (now has correct symbol)",
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
