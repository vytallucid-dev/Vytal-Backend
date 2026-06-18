// ROSTER STATUS — a VISIBLE, queryable report of every non-financial PG's roster state:
// READY (corrected roster applied to the DB) vs GATED (correction blocked on stock-data
// ingestion). Mirrors the dispatch layer's banking gate: a gated PG is an EXPLICIT state,
// never a silent absence. Read-only.
//
//   npx tsx src/scripts/roster-status.ts
//
// A gated PG prints its status, the missing Stock-table symbols, its intended corrected
// roster, and the OLD (still-seeded) roster — so nothing downstream mistakes it for live.

import { prisma } from "../db/prisma.js";
import { PEER_GROUPS, ROSTER_PENDING_STOCK_DATA } from "./peer-groups.seed.js";

const NONFIN_KEYS = [
  "pg1_it_services", "pg2_fmcg", "pg3_pharma", "pg4_auto_oem", "pg8_power",
  "pg9_metals", "pg10_oil_gas", "pg11_capital_goods", "pg12_cement",
  "pg13_consumer_durables", "pg14_defense",
];

async function main() {
  console.log("ROSTER STATUS — non-financial PGs (source of truth: peer-groups.seed.ts; DB membership shown for READY)\n");
  console.log(`  gated status string = "${ROSTER_PENDING_STOCK_DATA}"\n`);

  const ready: string[] = [];
  const gated: string[] = [];

  for (const key of NONFIN_KEYS) {
    const pg = PEER_GROUPS.find((p) => p.key === key)!;
    if (pg.gated) {
      gated.push(key);
      console.log(`  ⛔ ${key.padEnd(24)} GATED — ${pg.gated.status}`);
      console.log(`     ${" ".repeat(21)} missing stocks : [${pg.gated.missingStocks.join(", ")}]`);
      console.log(`     ${" ".repeat(21)} intended roster: [${pg.gated.intendedRoster.join(", ")}]  (n=${pg.gated.intendedRoster.length})`);
      console.log(`     ${" ".repeat(21)} old (seeded)   : [${pg.stocks.join(", ")}]`);
      if (pg.gated.note) console.log(`     ${" ".repeat(21)} note: ${pg.gated.note}`);
    } else {
      ready.push(key);
      // Confirm DB membership == seed (the reconcile post-condition), surfaced here too.
      const dbPg = await prisma.peerGroup.findFirst({ where: { name: pg.name }, include: { stocks: { include: { stock: true } } } });
      const dbSyms = dbPg ? dbPg.stocks.map((s) => s.stock.symbol).sort() : [];
      const seedSyms = [...pg.stocks].sort();
      const match = dbSyms.length === seedSyms.length && seedSyms.every((s, i) => s === dbSyms[i]);
      console.log(`  ✅ ${key.padEnd(24)} READY  n=${seedSyms.length}  DB==seed: ${match ? "yes" : "NO ⚠"}  [${seedSyms.join(", ")}]`);
    }
  }

  console.log(`\n  ${"─".repeat(92)}`);
  console.log(`  READY (corrected, live-eligible): ${ready.length}  → ${ready.join(", ")}`);
  console.log(`  GATED (${ROSTER_PENDING_STOCK_DATA}): ${gated.length}  → ${gated.join(", ")}`);
  const allMissing = [...new Set(gated.flatMap((k) => PEER_GROUPS.find((p) => p.key === k)!.gated!.missingStocks))];
  console.log(`  Blocking stock-data ingestion of: [${allMissing.join(", ")}]`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
