// ─────────────────────────────────────────────────────────────
// EXTRA STOCKS SEED SCRIPT
//
// Seeds 19 peer-benchmark stocks that are outside the Nifty 200
// universe. These stocks exist purely to support peer group
// metric computation (sector averages, Z-scores, etc.) and
// are NOT shown in the main screener.
//
// Run order:
//   1. seed-nifty200.ts       (sectors + universe stocks)
//   2. seed-extra-stocks.ts   (this script)
//   3. seed-peer-groups.ts    (peer groups + associations)
//
// Usage:
//   tsx prisma/seed-extra-stocks.ts
//   tsx prisma/seed-extra-stocks.ts --dry-run
//   tsx prisma/seed-extra-stocks.ts --allow-unverified
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { EXTRA_STOCKS } from "./extra-stocks.seed.js";
import { deriveIndustryType } from "./industry-type-utils.js";

interface Args {
  dryRun: boolean;
  allowUnverified: boolean;
}

function parseArgs(argv: string[]): Args {
  return {
    dryRun: argv.includes("--dry-run"),
    allowUnverified: argv.includes("--allow-unverified"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    console.log("─────────────────────────────────────────────");
    console.log("Extra Stocks Seed (Peer Benchmarks)");
    console.log("─────────────────────────────────────────────");
    console.log(`  Stocks: ${EXTRA_STOCKS.length}`);
    console.log(`  isActive: false (peer-benchmark-only)`);
    console.log(`  dryRun: ${args.dryRun}`);
    console.log("");

    // ── Pre-flight: unverified entries ────────────────────────
    const unverified = EXTRA_STOCKS.filter((s) => !s.verified);
    if (unverified.length > 0) {
      console.warn(`${unverified.length} stock(s) marked verified: false:`);
      for (const s of unverified) {
        console.warn(`   - ${s.symbol.padEnd(14)} ${s.name}`);
        console.warn(
          `     Verify at: https://www.nseindia.com/get-quotes/equity?symbol=${s.symbol}`,
        );
      }
      console.warn("");
      if (!args.allowUnverified) {
        console.error(
          "Refusing to run. Pass --allow-unverified once you have checked them.",
        );
        process.exit(1);
      }
    }

    // ── Pre-flight: sector existence check ───────────────────
    const sectors = await prisma.sector.findMany({
      select: { id: true, name: true },
    });
    const sectorIdByKey = new Map(sectors.map((s) => [s.name, s.id]));

    const missingSectorKeys = [
      ...new Set(EXTRA_STOCKS.map((s) => s.sectorKey)),
    ].filter((k) => !sectorIdByKey.has(k));

    if (missingSectorKeys.length > 0) {
      console.error(
        `Sector(s) not found in DB: ${missingSectorKeys.join(", ")}\n` +
          `Run seed-nifty200.ts first.`,
      );
      process.exit(1);
    }

    // ── Validate: no duplicate symbols in seed data ───────────
    const seen = new Set<string>();
    for (const s of EXTRA_STOCKS) {
      if (seen.has(s.symbol)) {
        console.error(`Duplicate symbol in seed data: ${s.symbol}`);
        process.exit(1);
      }
      seen.add(s.symbol);
    }

    // ── Upsert stocks ─────────────────────────────────────────
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const s of EXTRA_STOCKS) {
      const sectorId = sectorIdByKey.get(s.sectorKey)!;

      if (args.dryRun) {
        console.log(
          `   [dry-run] ${s.symbol.padEnd(14)} → ${s.sectorKey} (${s.peerContext})`,
        );
        continue;
      }

      const existing = await prisma.stock.findUnique({
        where: { symbol: s.symbol },
        select: { id: true, isActive: true },
      });

      const industryType = deriveIndustryType(s.symbol, s.sectorKey);

      if (existing) {
        // Stock already in DB — update name + sector + industryType but leave isActive as-is.
        // If it was in Nifty 200 (isActive: true), don't accidentally deactivate it.
        await prisma.stock.update({
          where: { id: existing.id },
          data: {
            name: s.name,
            sectorId,
            industryType,
            // Don't overwrite isActive — if it somehow ended up as true
            // (e.g. manual override), respect that.
          },
        });
        updated++;
      } else {
        await prisma.stock.create({
          data: {
            symbol: s.symbol,
            name: s.name,
            sectorId,
            exchange: "NSE",
            isActive: true,
            industryType,
          },
        });
        inserted++;
      }
    }

    if (args.dryRun) {
      console.log("\n[dry-run] No DB writes performed.");
      return;
    }

    console.log(
      `Done: ${inserted} inserted, ${updated} updated, ${skipped} skipped`,
    );
    console.log("");

    // ── Print result table ────────────────────────────────────
    const all = await prisma.stock.findMany({
      where: { symbol: { in: EXTRA_STOCKS.map((s) => s.symbol) } },
      select: {
        symbol: true,
        name: true,
        isActive: true,
        sector: { select: { displayName: true } },
      },
      orderBy: { symbol: "asc" },
    });

    console.log(
      `${"Symbol".padEnd(14)} ${"Active".padEnd(7)} ${"Sector".padEnd(32)} Name`,
    );
    console.log("─".repeat(90));
    for (const s of all) {
      console.log(
        `${s.symbol.padEnd(14)} ${String(s.isActive).padEnd(7)} ${(s.sector?.displayName ?? "—").padEnd(32)} ${s.name}`,
      );
    }

    console.log(`\nNext step: tsx prisma/seed-peer-groups.ts`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Extra stocks seed failed:", err);
  process.exit(1);
});
