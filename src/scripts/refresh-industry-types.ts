// ─────────────────────────────────────────────────────────────
// REFRESH INDUSTRY TYPES
//
// Standalone script to recompute Stock.industryType for all
// stocks in the DB based on their symbol + sector key.
//
// Run this:
//   - After seed-nifty200.ts or seed-extra-stocks.ts if you need
//     to backfill industryType on stocks that were seeded before
//     the v3 schema migration.
//   - Any time you update SYMBOL_OVERRIDES in industry-type-utils.ts.
//
// Usage:
//   tsx src/scripts/refresh-industry-types.ts
//   tsx src/scripts/refresh-industry-types.ts --dry-run
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { deriveIndustryType, type IndustryType } from "./industry-type-utils.js";

type IndustryCount = Record<IndustryType, number>;

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  try {
    console.log("─────────────────────────────────────────────");
    console.log("Refresh Industry Types");
    console.log(`  dryRun: ${dryRun}`);
    console.log("─────────────────────────────────────────────\n");

    const stocks = await prisma.stock.findMany({
      select: {
        id: true,
        symbol: true,
        industryType: true,
        sector: { select: { name: true } },
      },
    });

    console.log(`Found ${stocks.length} stocks in DB.\n`);

    let updated = 0;
    let unchanged = 0;

    const byIndustry: IndustryCount = {
      non_financial: 0,
      banking: 0,
      nbfc: 0,
      life_insurance: 0,
      general_insurance: 0,
    };

    const changes: { symbol: string; from: string; to: string }[] = [];

    for (const stock of stocks) {
      const derived = deriveIndustryType(stock.symbol, stock.sector?.name ?? null);
      byIndustry[derived]++;

      if (stock.industryType === derived) {
        unchanged++;
        continue;
      }

      changes.push({ symbol: stock.symbol, from: stock.industryType, to: derived });

      if (!dryRun) {
        await prisma.stock.update({
          where: { id: stock.id },
          data: { industryType: derived },
        });
      }

      updated++;
    }

    // Print changes
    if (changes.length > 0) {
      console.log(`Changes (${changes.length}):`);
      for (const c of changes) {
        const flag = dryRun ? "[dry-run] " : "";
        console.log(
          `  ${flag}${c.symbol.padEnd(16)} ${c.from.padEnd(20)} → ${c.to}`,
        );
      }
      console.log("");
    }

    console.log(`Results:`);
    console.log(`  Updated:    ${updated}`);
    console.log(`  Unchanged:  ${unchanged}`);
    console.log(`  Total:      ${stocks.length}`);
    console.log("");
    console.log(`Industry breakdown (target):`);
    console.log(`  non_financial:     ${byIndustry.non_financial}`);
    console.log(`  banking:           ${byIndustry.banking}`);
    console.log(`  nbfc:              ${byIndustry.nbfc}`);
    console.log(`  life_insurance:    ${byIndustry.life_insurance}`);
    console.log(`  general_insurance: ${byIndustry.general_insurance}`);

    if (dryRun) {
      console.log("\n[dry-run] No DB writes performed.");
    } else {
      console.log("\nDone.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
