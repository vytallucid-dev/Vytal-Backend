// ─────────────────────────────────────────────────────────────
// NIFTY 200 SEED SCRIPT
//
// Idempotent. Safe to re-run. Upserts sectors, then stocks.
//
// Usage:
//   tsx prisma/seed-nifty200.ts                 # blocks if any unverified
//   tsx prisma/seed-nifty200.ts --allow-unverified
//   tsx prisma/seed-nifty200.ts --dry-run
//   tsx prisma/seed-nifty200.ts --report-only   # prints summary, no writes
//
// What it does:
//   1. Pre-flight: warns about any stocks with verified: false
//   2. Upserts all 20 sectors (idempotent on `name`)
//   3. Upserts all 200 stocks (idempotent on `symbol`)
//   4. Updates `Sector.stockCount` denormalised counter
//   5. Reports any stocks NOT in the seed but already in the DB
//      (so you know what's outside the universe)
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { SECTORS } from "./sectors.seed.js";
import { STOCKS } from "./stocks.seed.js";
import { deriveIndustryType } from "./industry-type-utils.js";

interface Args {
  allowUnverified: boolean;
  dryRun: boolean;
  reportOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  return {
    allowUnverified: argv.includes("--allow-unverified"),
    dryRun: argv.includes("--dry-run"),
    reportOnly: argv.includes("--report-only"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    console.log("─────────────────────────────────────────");
    console.log("Nifty 200 Seed Script");
    console.log("─────────────────────────────────────────");
    console.log(`  Sectors:  ${SECTORS.length}`);
    console.log(`  Stocks:   ${STOCKS.length}`);
    console.log(`  dryRun:   ${args.dryRun}`);
    console.log("");

    // ── Pre-flight: validate seed integrity ────────────────────
    const validation = validateSeed();
    if (!validation.ok) {
      console.error("Seed validation FAILED:");
      validation.errors.forEach((e) => console.error(`   - ${e}`));
      process.exit(1);
    }

    // ── Pre-flight: unverified entries ─────────────────────────
    const unverified = STOCKS.filter((s) => !s.verified);
    if (unverified.length > 0) {
      console.warn(`${unverified.length} stocks have verified: false:`);
      for (const s of unverified) {
        console.warn(`   - ${s.symbol.padEnd(14)} (${s.name})`);
      }
      console.warn("");
      console.warn(
        "These need manual verification against NSE before going live.",
      );
      console.warn("Run with --allow-unverified to seed them anyway.");
      console.warn("");

      if (!args.allowUnverified && !args.reportOnly) {
        console.error(
          "Refusing to run without --allow-unverified. Verify entries or pass the flag.",
        );
        process.exit(1);
      }
    }

    if (args.reportOnly) {
      console.log("--report-only: exiting before any DB write.");
      return;
    }

    // ── 1. Upsert sectors ─────────────────────────────────────
    console.log(`Upserting ${SECTORS.length} sectors...`);
    const sectorIdByKey = new Map<string, string>();

    for (const s of SECTORS) {
      if (args.dryRun) {
        console.log(`   [dry-run] would upsert sector "${s.name}"`);
        continue;
      }

      const sector = await prisma.sector.upsert({
        where: { name: s.name },
        create: {
          name: s.name,
          displayName: s.displayName,
        },
        update: {
          displayName: s.displayName,
        },
      });
      sectorIdByKey.set(s.name, sector.id);
    }

    if (!args.dryRun) {
      console.log(`Sectors upserted (${sectorIdByKey.size})`);
    }

    // ── 2. Upsert stocks ─────────────────────────────────────
    console.log(`\nUpserting ${STOCKS.length} stocks...`);

    let inserted = 0;
    let updated = 0;
    const stockIdsThisRun = new Set<string>();

    for (const stock of STOCKS) {
      const sectorId = args.dryRun
        ? "DRY_RUN"
        : sectorIdByKey.get(stock.sectorKey);
      if (!sectorId) {
        console.error(
          `Stock ${stock.symbol} has unknown sectorKey "${stock.sectorKey}". Skipping.`,
        );
        continue;
      }

      if (args.dryRun) {
        console.log(
          `   [dry-run] would upsert ${stock.symbol} → ${stock.sectorKey}`,
        );
        continue;
      }

      const existing = await prisma.stock.findUnique({
        where: { symbol: stock.symbol },
        select: { id: true, name: true, sectorId: true },
      });

      const industryType = deriveIndustryType(stock.symbol, stock.sectorKey);

      if (existing) {
        await prisma.stock.update({
          where: { id: existing.id },
          data: {
            name: stock.name,
            sectorId,
            isActive: true,
            industryType,
          },
        });
        stockIdsThisRun.add(existing.id);
        updated++;
      } else {
        // UPDATE-ONLY. stocks.isin is NOT NULL + UNIQUE, and this seed's data carries no
        // ISIN — so it cannot legitimately mint a stock. Fail loud rather than fabricate
        // an identifier or resurrect a defunct symbol. Add stocks via a purpose-built
        // script that sources ISIN from the current NSE list.
        throw new Error(
          `cannot seed ${stock.symbol}: not in the stocks table, and this seed has no ISIN to create it with. ` +
            `Add it via a purpose-built script that sources ISIN from the current NSE list, or drop it from stocks.seed.ts if it is defunct.`,
        );
      }
    }

    if (!args.dryRun) {
      console.log(`Stocks: ${inserted} inserted, ${updated} updated`);
    }

    // ── 3. Update denormalised stockCount per sector ──────────
    if (!args.dryRun) {
      console.log(`\nRefreshing sector stock counts...`);
      for (const [key, sectorId] of sectorIdByKey) {
        const count = await prisma.stock.count({
          where: { sectorId, isActive: true },
        });
        await prisma.sector.update({
          where: { id: sectorId },
          data: { stockCount: count },
        });
      }
      console.log(`Sector counts refreshed`);
    }

    // ── 4. Report any DB stocks NOT in this seed ──────────────
    if (!args.dryRun) {
      const seedSymbols = new Set(STOCKS.map((s) => s.symbol));
      const allStocks = await prisma.stock.findMany({
        where: { isActive: true },
        select: { symbol: true, name: true },
      });
      const outsideUniverse = allStocks.filter(
        (s) => !seedSymbols.has(s.symbol),
      );

      if (outsideUniverse.length > 0) {
        console.log(
          `\n${outsideUniverse.length} active stocks in DB are NOT in the Nifty 200 seed:`,
        );
        for (const s of outsideUniverse.slice(0, 20)) {
          console.log(`   - ${s.symbol.padEnd(14)} (${s.name})`);
        }
        if (outsideUniverse.length > 20) {
          console.log(`   ...and ${outsideUniverse.length - 20} more`);
        }
        console.log(
          `These were not modified. Decide whether to deactivate them separately.`,
        );
      }
    }

    console.log(`\nSeed complete.`);
  } finally {
    await prisma.$disconnect();
  }
}

// ─────────────────────────────────────────────────────────────
// Seed integrity validation — run before any DB write
// ─────────────────────────────────────────────────────────────

function validateSeed(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. No duplicate symbols
  const symbols = new Set<string>();
  for (const s of STOCKS) {
    if (symbols.has(s.symbol)) {
      errors.push(`Duplicate symbol: ${s.symbol}`);
    }
    symbols.add(s.symbol);
  }

  // 2. No duplicate sector keys
  const sectorKeys = new Set<string>();
  for (const s of SECTORS) {
    if (sectorKeys.has(s.name)) {
      errors.push(`Duplicate sector key: ${s.name}`);
    }
    sectorKeys.add(s.name);
  }

  // 3. Every stock's sectorKey exists in sectors
  for (const s of STOCKS) {
    if (!sectorKeys.has(s.sectorKey)) {
      errors.push(
        `Stock ${s.symbol} references unknown sectorKey "${s.sectorKey}"`,
      );
    }
  }

  // 4. Symbol format sanity (uppercase, no whitespace)
  for (const s of STOCKS) {
    if (s.symbol !== s.symbol.toUpperCase()) {
      errors.push(`Symbol ${s.symbol} should be uppercase`);
    }
    if (/\s/.test(s.symbol)) {
      errors.push(`Symbol "${s.symbol}" contains whitespace`);
    }
  }

  // 5. Expected count (201 after TATAMOTORS demerger split into TMCV + TMPV)
  if (STOCKS.length !== 201) {
    errors.push(`Expected 201 stocks, got ${STOCKS.length}`);
  }

  return { ok: errors.length === 0, errors };
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
