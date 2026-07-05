// READ-ONLY Stage 1c final verification. Isolates the 281 NEW stocks (CSV ∖ the
// original-224 snapshot) and reports: sector coverage (0 null), shareholding
// landing (total_shares present / pending / zero-filing), firewall (0 scoreable),
// and the IngestionError surface (what shows in /settings/ingestion-errors).
//   npx tsx src/scripts/verify-nifty500-pass1-final.ts <csv> <original224.txt>
import { prisma } from "../db/prisma.js";
import fs from "fs";

async function main() {
  const csvPath = process.argv[2];
  const origPath = process.argv[3];
  const csvSymbols = fs.readFileSync(csvPath, "utf8").trim().split(/\r?\n/).slice(1)
    .map((l) => { const p = l.split(","); return p[p.length - 3].trim(); });
  const original = new Set(fs.readFileSync(origPath, "utf8").trim().split(",").map((s) => s.trim()));
  const newSymbols = csvSymbols.filter((s) => !original.has(s));

  const news = await prisma.stock.findMany({
    where: { symbol: { in: newSymbols } },
    select: {
      symbol: true, isActive: true, sectorId: true,
      sector: { select: { name: true } },
      peerGroups: { select: { peerGroupId: true } },
      scoreSnapshots: { select: { id: true } },
      shareholdingPatterns: { select: { id: true }, take: 1 },
      _count: { select: { shareholdingPatterns: true } },
    },
  });

  console.log(`=== Stage 1c FINAL VERIFY — new set n=${newSymbols.length} (found in DB: ${news.length}) ===`);

  // 1. sector coverage
  const nullSector = news.filter((s) => s.sectorId == null);
  console.log(`\n[1] SECTOR COVERAGE`);
  console.log(`  new stocks with a sector : ${news.length - nullSector.length}/${news.length}`);
  console.log(`  new stocks null sector   : ${nullSector.length}  ${nullSector.length ? "❌ " + nullSector.map((s) => s.symbol).join(",") : "✅"}`);

  // 2. firewall
  const inPg = news.filter((s) => s.peerGroups.length > 0);
  const scored = news.filter((s) => s.scoreSnapshots.length > 0);
  const inactive = news.filter((s) => !s.isActive);
  console.log(`\n[2] FIREWALL (display-only, never scored)`);
  console.log(`  in any peer group (MUST 0)   : ${inPg.length}  ${inPg.length ? "❌" : "✅"}`);
  console.log(`  with a ScoreSnapshot (MUST 0): ${scored.length}  ${scored.length ? "❌" : "✅"}`);
  console.log(`  inactive (MUST 0)            : ${inactive.length}  ${inactive.length ? "❌" : "✅"}`);
  const orphanScored = await prisma.$queryRawUnsafe<{ n: number }[]>(`
    SELECT COUNT(*)::int as n FROM stocks s
    WHERE EXISTS (SELECT 1 FROM score_snapshots ss WHERE ss.stock_id=s.id)
      AND NOT EXISTS (SELECT 1 FROM stock_peer_groups spg WHERE spg.stock_id=s.id)`);
  console.log(`  universe-wide scored-but-no-PG (MUST 0): ${orphanScored[0].n}  ${orphanScored[0].n ? "❌" : "✅"}`);

  // 3. shareholding landing (total_shares = the Pass-2 tiering input)
  const withShp = news.filter((s) => s._count.shareholdingPatterns > 0);
  const noShp = news.filter((s) => s._count.shareholdingPatterns === 0);
  // of those with rows, how many have a non-null total_shares on the latest filing
  const withTotalShares = await prisma.$queryRawUnsafe<{ n: number }[]>(`
    SELECT COUNT(DISTINCT s.id)::int as n FROM stocks s
    JOIN shareholding_patterns sp ON sp.stock_id=s.id
    WHERE s.symbol = ANY($1::text[]) AND sp.total_shares IS NOT NULL AND sp.total_shares > 0`, newSymbols);
  console.log(`\n[3] SHAREHOLDING (serves Pass-2 tiering + display)`);
  console.log(`  new stocks with >=1 filing   : ${withShp.length}/${news.length}`);
  console.log(`  new stocks with total_shares : ${withTotalShares[0].n}/${news.length}`);
  console.log(`  new stocks with 0 filings    : ${noShp.length}  ${noShp.length ? "→ " + noShp.map((s) => s.symbol).join(",") : ""}`);

  // 4. IngestionError surface
  const openTotal = await prisma.ingestionError.count({ where: { status: "open" } });
  const shpOpen = await prisma.ingestionError.count({ where: { status: "open", cron: "shareholding_ingest" } });
  const shpAll = await prisma.ingestionError.count({ where: { cron: "shareholding_ingest" } });
  console.log(`\n[4] INGESTION-ERROR SURFACE (/settings/ingestion-errors)`);
  console.log(`  open (all crons)                 : ${openTotal}`);
  console.log(`  shareholding_ingest — open       : ${shpOpen}`);
  console.log(`  shareholding_ingest — all-time   : ${shpAll}`);
  if (shpAll > 0) {
    const rows = await prisma.ingestionError.findMany({
      where: { cron: "shareholding_ingest" },
      select: { guardType: true, severity: true, status: true, targetField: true, targetEntity: true, occurrences: true },
      orderBy: { lastSeenAt: "desc" }, take: 25,
    });
    console.log(`  sample rows:`);
    for (const r of rows) console.log(`    [${r.status}/${r.severity}] ${r.guardType} ${r.targetField ?? ""} ${r.targetEntity ?? ""} ×${r.occurrences}`);
  }

  const total = await prisma.stock.count();
  console.log(`\nuniverse total: ${total} stocks`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
