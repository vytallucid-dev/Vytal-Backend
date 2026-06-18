// One-off PG8 ROSTER CORRECTION — reconcile the DB membership to the corrected seed.
//
//   npx tsx src/scripts/fix-pg8-roster.ts            # DRY (reports only, no writes)
//   npx tsx src/scripts/fix-pg8-roster.ts --commit   # apply the reconcile
//
// The base seed (seed-peer-groups.ts) is ADDITIVE-ONLY: it can ADD TORNTPOWER but
// will NOT remove the wrongly-seeded ADANIGREEN. This script reconciles PG8 (and ONLY
// PG8) to exactly the symbol set in peer-groups.seed.ts: adds missing associations,
// removes stale ones, refreshes stockCount. Scoped to PG8 — touches no other PG.

import { prisma } from "../db/prisma.js";
import { PEER_GROUPS } from "./peer-groups.seed.js";

const PG8_KEY = "pg8_power";

async function main() {
  const commit = process.argv.includes("--commit");
  const seed = PEER_GROUPS.find((p) => p.key === PG8_KEY)!;
  const want = new Set(seed.stocks);

  const pg = await prisma.peerGroup.findFirst({
    where: { name: seed.name },
    include: { stocks: { include: { stock: true } } },
  });
  if (!pg) { console.error(`PG8 "${seed.name}" not in DB`); process.exit(1); }

  const haveSyms = pg.stocks.map((s) => s.stock.symbol).sort();
  console.log(`PG8 ROSTER RECONCILE  (mode=${commit ? "COMMIT" : "DRY"})`);
  console.log(`  desired (seed): [${[...want].sort().join(", ")}]  (n=${want.size})`);
  console.log(`  current (DB)  : [${haveSyms.join(", ")}]  (n=${haveSyms.length})`);

  const toAdd = [...want].filter((sym) => !haveSyms.includes(sym));
  const toRemove = pg.stocks.filter((s) => !want.has(s.stock.symbol));
  console.log(`  + add   : [${toAdd.join(", ") || "—"}]`);
  console.log(`  − remove: [${toRemove.map((s) => s.stock.symbol).join(", ") || "—"}]`);

  if (!commit) {
    console.log(`\n  DRY — nothing written. Re-run with --commit to apply.`);
    await prisma.$disconnect();
    return;
  }

  // Add missing (resolve stockId by symbol).
  for (const sym of toAdd) {
    const st = await prisma.stock.findFirst({ where: { symbol: sym }, select: { id: true } });
    if (!st) { console.error(`  stock ${sym} not in DB — run seed-extra-stocks first`); continue; }
    await prisma.stockPeerGroup.create({ data: { stockId: st.id, peerGroupId: pg.id } });
    console.log(`  + added ${sym}`);
  }
  // Remove stale (PG8 only).
  for (const s of toRemove) {
    await prisma.stockPeerGroup.delete({ where: { id: s.id } });
    console.log(`  − removed ${s.stock.symbol}`);
  }
  // Refresh count.
  const count = await prisma.stockPeerGroup.count({ where: { peerGroupId: pg.id } });
  await prisma.peerGroup.update({ where: { id: pg.id }, data: { stockCount: count } });

  const after = await prisma.peerGroup.findFirst({ where: { id: pg.id }, include: { stocks: { include: { stock: true } } } });
  console.log(`\n  AFTER: [${after!.stocks.map((s) => s.stock.symbol).sort().join(", ")}]  stockCount=${count}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
