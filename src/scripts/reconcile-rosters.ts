// ROSTER RECONCILE — reconcile the DB membership of the non-financial PGs to
// EXACTLY the corrected seed (peer-groups.seed.ts). Remove-capable; --commit-gated;
// per-PG post-check. The base seed-peer-groups.ts is ADDITIVE-ONLY and cannot remove
// a stale member or restructure a group; this is the remove-capable reconcile.
//
//   npx tsx src/scripts/reconcile-rosters.ts            # DRY (reports add/remove, no writes)
//   npx tsx src/scripts/reconcile-rosters.ts --commit   # apply the reconcile (authorized DB write)
//
// SCOPE:
//   • READY_KEYS (7) — corrected in a prior session. Re-run is a VERIFIED NO-OP: when
//     DB membership already == seed, ZERO writes are issued (the built-in
//     "ready-7 untouched" control).
//   • UNBLOCKED_KEYS (PG10/11/12) — corrections unblocked now that PETRONET/RAMCOCEM/
//     HONAUT are ingested. Standard membership reconcile (names unchanged in the DB).
//   • PG14 — STRUCTURAL re-key Insurance→Defense (operator decision: "promote A7"):
//     the existing (capital_goods_engineering,"Large-Cap Defense") row — formerly the
//     alternate a7_defense — is PROMOTED to buildOrder 14 and its members reconciled to
//     the Defense 7; the old (insurance,"Large-Cap Insurance") row is RETIRED (deleted,
//     which cascades its 6 memberships). Bars are decoupled (keyed by the logical
//     "PG14" string, no FK to peer_groups) so NO bar rows are touched.

import { prisma } from "../db/prisma.js";
import { PEER_GROUPS } from "./peer-groups.seed.js";

const READY_KEYS = [
  "pg1_it_services", "pg2_fmcg", "pg3_pharma", "pg4_auto_oem",
  "pg8_power", "pg9_metals", "pg13_consumer_durables",
] as const;

const UNBLOCKED_KEYS = ["pg10_oil_gas", "pg11_capital_goods", "pg12_cement"] as const;

const STANDARD_KEYS = [...READY_KEYS, ...UNBLOCKED_KEYS];

interface PgResult { key: string; name: string; before: string[]; after: string[]; added: string[]; removed: string[]; n: number; noop?: boolean; skipped?: string }

async function resolveStockIds(want: string[]): Promise<{ idBySym: Map<string, string>; unresolved: string[] }> {
  const stocks = await prisma.stock.findMany({ where: { symbol: { in: want } }, select: { id: true, symbol: true } });
  const idBySym = new Map(stocks.map((s) => [s.symbol, s.id]));
  return { idBySym, unresolved: want.filter((s) => !idBySym.has(s)) };
}

async function main() {
  const commit = process.argv.includes("--commit");
  console.log(`ROSTER RECONCILE — non-financial PGs  (mode=${commit ? "COMMIT" : "DRY"})\n`);

  const results: PgResult[] = [];
  let unresolvedAny = false;

  // ── Standard membership reconcile (READY 7 + UNBLOCKED 3) — matched by name ──
  for (const key of STANDARD_KEYS) {
    const seed = PEER_GROUPS.find((p) => p.key === key);
    if (!seed) { console.error(`  seed key ${key} missing — STOP`); process.exit(1); }
    const want = [...new Set(seed.stocks)];

    const { idBySym, unresolved } = await resolveStockIds(want);
    if (unresolved.length) { console.error(`  ${key}: UNRESOLVED symbols ${unresolved.join(",")} — STOP (not in Stock table)`); unresolvedAny = true; continue; }

    const pg = await prisma.peerGroup.findFirst({ where: { name: seed.name }, include: { stocks: { include: { stock: true } } } });
    if (!pg) { console.error(`  ${key}: PeerGroup "${seed.name}" not in DB — STOP`); process.exit(1); }

    const before = pg.stocks.map((s) => s.stock.symbol).sort();
    const wantSet = new Set(want);
    const toAdd = want.filter((s) => !before.includes(s));
    const toRemoveAssoc = pg.stocks.filter((s) => !wantSet.has(s.stock.symbol));
    const removedSyms = toRemoveAssoc.map((s) => s.stock.symbol).sort();
    const noChange = toAdd.length === 0 && toRemoveAssoc.length === 0;

    if (commit && !noChange) {
      for (const sym of toAdd) await prisma.stockPeerGroup.create({ data: { stockId: idBySym.get(sym)!, peerGroupId: pg.id } });
      for (const s of toRemoveAssoc) await prisma.stockPeerGroup.delete({ where: { id: s.id } });
      const count = await prisma.stockPeerGroup.count({ where: { peerGroupId: pg.id } });
      await prisma.peerGroup.update({ where: { id: pg.id }, data: { stockCount: count } });
      const after = await prisma.peerGroup.findFirst({ where: { id: pg.id }, include: { stocks: { include: { stock: true } } } });
      results.push({ key, name: seed.name, before, after: after!.stocks.map((s) => s.stock.symbol).sort(), added: toAdd.sort(), removed: removedSyms, n: count });
    } else {
      const after = noChange ? before : [...new Set([...before.filter((s) => wantSet.has(s)), ...toAdd])].sort();
      results.push({ key, name: seed.name, before, after, added: toAdd.sort(), removed: removedSyms, n: after.length, noop: noChange });
    }
  }

  // ── PG14 STRUCTURAL re-key: promote A7 Defense → core PG14, retire Insurance ──
  const defSeed = PEER_GROUPS.find((p) => p.key === "pg14_defense");
  if (!defSeed) { console.error("  seed key pg14_defense missing — STOP"); process.exit(1); }
  const wantDef = [...new Set(defSeed.stocks)];
  const { idBySym: defIds, unresolved: defUnresolved } = await resolveStockIds(wantDef);
  if (defUnresolved.length) { console.error(`  pg14_defense: UNRESOLVED symbols ${defUnresolved.join(",")} — STOP`); unresolvedAny = true; }

  const defSector = await prisma.sector.findFirst({ where: { name: defSeed.sectorKey }, select: { id: true } });
  const insSector = await prisma.sector.findFirst({ where: { name: "insurance" }, select: { id: true } });
  if (!defSector) { console.error(`  pg14_defense: sector "${defSeed.sectorKey}" not in DB — STOP`); process.exit(1); }

  // The existing Defense row (was alt A7) — matched by the real unique key (sectorId,name).
  const defRow = !defUnresolved.length
    ? await prisma.peerGroup.findUnique({ where: { sectorId_name: { sectorId: defSector.id, name: defSeed.name } }, include: { stocks: { include: { stock: true } } } })
    : null;
  // The Insurance row to retire.
  const insRow = insSector
    ? await prisma.peerGroup.findUnique({ where: { sectorId_name: { sectorId: insSector.id, name: "Large-Cap Insurance" } }, include: { stocks: { include: { stock: true } } } })
    : null;

  let pg14Report = "";
  if (!defUnresolved.length && defRow) {
    const beforeDef = defRow.stocks.map((s) => s.stock.symbol).sort();
    const wantDefSet = new Set(wantDef);
    const toAddDef = wantDef.filter((s) => !beforeDef.includes(s));
    const toRemoveDef = defRow.stocks.filter((s) => !wantDefSet.has(s.stock.symbol));
    const insMembers = insRow ? insRow.stocks.map((s) => s.stock.symbol).sort() : [];

    if (commit) {
      for (const sym of toAddDef) await prisma.stockPeerGroup.create({ data: { stockId: defIds.get(sym)!, peerGroupId: defRow.id } });
      for (const s of toRemoveDef) await prisma.stockPeerGroup.delete({ where: { id: s.id } });
      const count = await prisma.stockPeerGroup.count({ where: { peerGroupId: defRow.id } });
      await prisma.peerGroup.update({
        where: { id: defRow.id },
        data: { buildOrder: defSeed.buildOrder, displayName: defSeed.displayName, name: defSeed.name, stockCount: count },
      });
      if (insRow) await prisma.peerGroup.delete({ where: { id: insRow.id } }); // cascades its StockPeerGroup rows
      pg14Report =
        `  pg14_defense (PROMOTE A7→core, retire Insurance)\n` +
        `     defense row id=${defRow.id.slice(0, 8)} buildOrder ${defRow.buildOrder}→${defSeed.buildOrder}  n=${count}\n` +
        `     +add:[${toAddDef.sort().join(",") || "—"}]  -rm:[${toRemoveDef.map((s) => s.stock.symbol).join(",") || "—"}]\n` +
        `     retired Insurance row: ${insRow ? `${insRow.id.slice(0, 8)} (had [${insMembers.join(",")}]) — DELETED` : "not found (already gone)"}`;
    } else {
      const after = [...new Set([...beforeDef, ...toAddDef])].sort();
      pg14Report =
        `  pg14_defense (PROMOTE A7→core, retire Insurance)\n` +
        `     defense row buildOrder ${defRow.buildOrder}→${defSeed.buildOrder}; before=[${beforeDef.join(",")}] +add:[${toAddDef.sort().join(",") || "—"}] → [${after.join(",")}] (n=${after.length})\n` +
        `     would retire Insurance row: ${insRow ? `[${insMembers.join(",")}] — DELETE` : "not found"}`;
    }
  } else if (!defUnresolved.length) {
    console.error(`  pg14_defense: Defense PeerGroup (${defSeed.sectorKey},"${defSeed.name}") not in DB — STOP (expected the alt A7 row)`);
    process.exit(1);
  }

  if (unresolvedAny) { console.error(`\n  ✗ unresolved symbols — NOTHING written. Fix the seed/stock table first.`); await prisma.$disconnect(); process.exit(1); }

  // ── Report ──
  for (const r of results) {
    const flag = r.noop ? "  (no change — untouched)" : "";
    console.log(`  ${r.key.padEnd(24)} n=${r.n}  +add:[${r.added.join(",") || "—"}]  -rm:[${r.removed.join(",") || "—"}]${flag}`);
    if (!r.noop) console.log(`  ${" ".repeat(24)} → [${r.after.join(",")}]`);
  }
  console.log(pg14Report);

  // ── Post-condition checks ──
  if (commit) {
    let allMatch = true;
    for (const key of STANDARD_KEYS) {
      const seed = PEER_GROUPS.find((p) => p.key === key)!;
      const pg = await prisma.peerGroup.findFirst({ where: { name: seed.name }, include: { stocks: { include: { stock: true } } } });
      const have = new Set(pg!.stocks.map((s) => s.stock.symbol));
      const want = new Set(seed.stocks);
      const match = have.size === want.size && [...want].every((s) => have.has(s));
      if (!match) { allMatch = false; console.error(`  ✗ POST-CHECK FAIL ${key}: DB≠seed`); }
    }
    // PG14: defense row == 7, buildOrder 14; insurance row gone; no dup (sector,name)
    const defAfter = await prisma.peerGroup.findUnique({ where: { sectorId_name: { sectorId: defSector.id, name: defSeed.name } }, include: { stocks: { include: { stock: true } } } });
    const defHave = new Set(defAfter?.stocks.map((s) => s.stock.symbol) ?? []);
    const defWant = new Set(defSeed.stocks);
    const defMatch = !!defAfter && defHave.size === defWant.size && [...defWant].every((s) => defHave.has(s)) && defAfter.buildOrder === defSeed.buildOrder;
    if (!defMatch) { allMatch = false; console.error(`  ✗ POST-CHECK FAIL pg14_defense: roster/buildOrder mismatch`); }
    const insGone = insSector ? !(await prisma.peerGroup.findUnique({ where: { sectorId_name: { sectorId: insSector.id, name: "Large-Cap Insurance" } } })) : true;
    if (!insGone) { allMatch = false; console.error(`  ✗ POST-CHECK FAIL: Insurance row still present`); }
    console.log(`\n  ${allMatch ? "✓ POST-CHECK: standard PGs DB==seed; PG14 Defense=7 @bo14; Insurance retired." : "✗ POST-CHECK FAILED"}`);
  } else {
    console.log(`\n  DRY — nothing written. Re-run with --commit to apply.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
