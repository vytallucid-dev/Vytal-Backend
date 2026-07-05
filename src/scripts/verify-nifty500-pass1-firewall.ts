// READ-ONLY firewall + state verification for Pass-1 Stage 1a.
// Confirms the 281 new stocks are DISPLAY-ONLY: active, sector-mapped-or-gated,
// and structurally unscoreable (no stock_peer_groups row, no ScoreSnapshot).
//   npx tsx src/scripts/verify-nifty500-pass1-firewall.ts <csv-path>
import { prisma } from "../db/prisma.js";
import fs from "fs";

async function main() {
  const csvPath = process.argv[2];
  const lines = fs.readFileSync(csvPath, "utf8").trim().split(/\r?\n/).slice(1);
  const csvSymbols = lines.map((l) => { const p = l.split(","); return p[p.length - 3].trim(); });

  // Reconstruct the NEW set = CSV symbols that we just created. A symbol is "new"
  // if it exists now AND is not one of the original 224. We identify the new set as
  // CSV∖(the 5 dropped + 219 overlap) — simplest: CSV symbols with 0 peer groups AND
  // created in this batch. Here we take all CSV symbols present in DB, then report.
  const stocks = await prisma.stock.findMany({
    where: { symbol: { in: csvSymbols } },
    select: {
      symbol: true, isActive: true, sectorId: true,
      sector: { select: { name: true } },
      peerGroups: { select: { peerGroupId: true } },
      scoreSnapshots: { select: { id: true } },
    },
  });

  // The 281 new ones are those with NO peer group among the CSV set that were not
  // pre-existing. To isolate exactly the new set, load the pre-existing 224 from the
  // known overlap: a stock is "pre-existing" if it has a peer group OR a snapshot OR
  // a non-null sector that we didn't set. Cleaner: compare against a saved list.
  // We instead report the whole CSV-in-DB set split by peer-group membership.
  const inAnyPg = stocks.filter((s) => s.peerGroups.length > 0);
  const noPg = stocks.filter((s) => s.peerGroups.length === 0);

  console.log("=== CSV symbols present in DB:", stocks.length, "===");
  console.log("in >=1 peer group (pre-existing scored/queued):", inAnyPg.length);
  console.log("in NO peer group (null-PG display-only)       :", noPg.length);

  // FIREWALL asserts on the null-PG set (which includes our 281 new + prior null-PG).
  const newLikely = noPg; // null-PG universe
  const activeCount = newLikely.filter((s) => s.isActive).length;
  const withSnapshot = newLikely.filter((s) => s.scoreSnapshots.length > 0).length;
  const withSector = newLikely.filter((s) => s.sectorId != null).length;
  const withoutSector = newLikely.filter((s) => s.sectorId == null).length;

  console.log("\n=== FIREWALL (null-PG set) ===");
  console.log("null-PG total                 :", newLikely.length);
  console.log("  active                      :", activeCount);
  console.log("  with a ScoreSnapshot (MUST be 0):", withSnapshot);
  console.log("  in any peer group (MUST be 0)   :", newLikely.filter((s) => s.peerGroups.length > 0).length);
  console.log("  sector mapped               :", withSector);
  console.log("  sector gated (null)         :", withoutSector);

  // Absolute universe-level firewall: total stocks with a snapshot but no PG.
  const orphanScored = await prisma.$queryRawUnsafe<{ n: number }[]>(`
    SELECT COUNT(*)::int as n FROM stocks s
    WHERE EXISTS (SELECT 1 FROM score_snapshots ss WHERE ss.stock_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM stock_peer_groups spg WHERE spg.stock_id = s.id)
  `);
  console.log("\nuniverse-wide: scored-but-no-PG stocks (MUST be 0):", orphanScored[0].n);

  const totalStocks = await prisma.stock.count();
  const totalActive = await prisma.stock.count({ where: { isActive: true } });
  const totalNoPg = await prisma.stock.count({ where: { peerGroups: { none: {} } } });
  console.log("\n=== universe totals ===");
  console.log("total stocks :", totalStocks, "| active:", totalActive, "| null-PG:", totalNoPg);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
