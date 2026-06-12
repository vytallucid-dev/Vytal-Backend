// ─────────────────────────────────────────────────────────────
// PEER GROUPS SEED SCRIPT
//
// Fills PeerGroup and StockPeerGroup tables.
// All stocks must already exist in the DB before running this.
//
// Run order:
//   1. tsx prisma/seed-nifty200.ts        (sectors + 200 stocks)
//   2. tsx prisma/seed-extra-stocks.ts    (19 peer-benchmark stocks)
//   3. tsx prisma/seed-peer-groups.ts     ← this script
//
// Usage:
//   tsx prisma/seed-peer-groups.ts
//   tsx prisma/seed-peer-groups.ts --dry-run
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { PEER_GROUPS } from "./peer-groups.seed.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  try {
    console.log("─────────────────────────────────────────────");
    console.log("Peer Groups Seed");
    console.log("─────────────────────────────────────────────");
    console.log(`  Groups : ${PEER_GROUPS.length} (14 core + 10 alternate)`);
    console.log(`  dryRun : ${dryRun}`);
    console.log("");

    // ── Load sectors ──────────────────────────────────────────
    const sectors = await prisma.sector.findMany({
      select: { id: true, name: true },
    });
    const sectorIdByKey = new Map(sectors.map((s) => [s.name, s.id]));

    const missingSectors = [
      ...new Set(PEER_GROUPS.map((pg) => pg.sectorKey)),
    ].filter((k) => !sectorIdByKey.has(k));

    if (missingSectors.length > 0) {
      bail(
        `Sector(s) not found in DB: ${missingSectors.join(", ")}\n` +
          `Run seed-nifty200.ts first.`,
      );
    }

    // ── Load all stocks ───────────────────────────────────────
    const allStocks = await prisma.stock.findMany({
      select: { id: true, symbol: true },
    });
    const stockIdBySymbol = new Map(allStocks.map((s) => [s.symbol, s.id]));

    // ── Pre-flight: all symbols must exist ────────────────────
    const allSymbols = [...new Set(PEER_GROUPS.flatMap((pg) => pg.stocks))];
    const notFound = allSymbols.filter((sym) => !stockIdBySymbol.has(sym));

    if (notFound.length > 0) {
      bail(
        `${notFound.length} symbol(s) not found in DB:\n` +
          notFound.map((s) => `   - ${s}`).join("\n") +
          `\nRun seed-extra-stocks.ts first.`,
      );
    }

    console.log(
      `Pre-flight passed: all ${allSymbols.length} symbols found in DB.\n`,
    );

    // ── Upsert peer groups ────────────────────────────────────
    console.log(`Upserting peer groups...`);

    let pgInserted = 0;
    let pgUpdated = 0;
    const pgIdByKey = new Map<string, string>();

    for (const pg of PEER_GROUPS) {
      const sectorId = sectorIdByKey.get(pg.sectorKey)!;

      if (dryRun) {
        console.log(
          `   [dry] ${label(pg.buildOrder).padEnd(5)} "${pg.name}" ` +
            `→ ${pg.sectorKey} (${pg.stocks.length} stocks)`,
        );
        continue;
      }

      const existing = await prisma.peerGroup.findUnique({
        where: { sectorId_name: { sectorId, name: pg.name } },
        select: { id: true },
      });

      if (existing) {
        await prisma.peerGroup.update({
          where: { id: existing.id },
          data: { displayName: pg.displayName, buildOrder: pg.buildOrder },
        });
        pgIdByKey.set(pg.key, existing.id);
        pgUpdated++;
      } else {
        const created = await prisma.peerGroup.create({
          data: {
            name: pg.name,
            displayName: pg.displayName,
            sectorId,
            buildOrder: pg.buildOrder,
          },
          select: { id: true },
        });
        pgIdByKey.set(pg.key, created.id);
        pgInserted++;
      }
    }

    if (!dryRun) {
      console.log(`Peer groups: ${pgInserted} inserted, ${pgUpdated} updated`);
    }

    // ── Upsert stock-peer-group associations ──────────────────
    if (!dryRun) {
      console.log(`\nUpserting stock associations...`);

      let assocInserted = 0;
      let assocSkipped = 0;

      for (const pg of PEER_GROUPS) {
        const peerGroupId = pgIdByKey.get(pg.key)!;

        for (const symbol of pg.stocks) {
          const stockId = stockIdBySymbol.get(symbol)!;

          const exists = await prisma.stockPeerGroup.findUnique({
            where: { stockId_peerGroupId: { stockId, peerGroupId } },
            select: { id: true },
          });

          if (!exists) {
            await prisma.stockPeerGroup.create({
              data: { stockId, peerGroupId },
            });
            assocInserted++;
          } else {
            assocSkipped++;
          }
        }
      }

      console.log(
        `Associations: ${assocInserted} inserted, ${assocSkipped} already existed`,
      );
    }

    // ── Refresh stockCount ────────────────────────────────────
    if (!dryRun) {
      console.log(`\nRefreshing stockCount...`);
      for (const [, peerGroupId] of pgIdByKey) {
        const count = await prisma.stockPeerGroup.count({
          where: { peerGroupId },
        });
        await prisma.peerGroup.update({
          where: { id: peerGroupId },
          data: { stockCount: count },
        });
      }
    }

    // ── Print summary ─────────────────────────────────────────
    console.log(`\n${"─".repeat(62)}`);
    console.log(`${"   Peer Group".padEnd(52)} Stocks`);
    console.log("─".repeat(62));

    let totalStocks = 0;
    for (const pg of PEER_GROUPS) {
      const lbl = label(pg.buildOrder);
      console.log(`${lbl.padEnd(5)} ${pg.name.padEnd(47)} ${pg.stocks.length}`);
      totalStocks += pg.stocks.length;
    }

    console.log("─".repeat(62));
    console.log(`${"TOTAL".padEnd(52)} ${totalStocks}`);

    // Stock appearances > 1 (expected: HAL + BEL in PG11 + A7)
    const symbolCount = new Map<string, number>();
    for (const pg of PEER_GROUPS) {
      for (const sym of pg.stocks) {
        symbolCount.set(sym, (symbolCount.get(sym) ?? 0) + 1);
      }
    }
    const multiGroup = [...symbolCount.entries()].filter(([, c]) => c > 1);
    if (multiGroup.length > 0) {
      console.log(`\nStocks in multiple peer groups (expected):`);
      for (const [sym, count] of multiGroup) {
        console.log(`   ${sym} — ${count} groups`);
      }
    }

    console.log(`\nDone.`);
  } finally {
    await prisma.$disconnect();
  }
}

function label(buildOrder: number): string {
  return buildOrder >= 100 ? `A${buildOrder - 100}` : `PG${buildOrder}`;
}

function bail(msg: string): never {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
