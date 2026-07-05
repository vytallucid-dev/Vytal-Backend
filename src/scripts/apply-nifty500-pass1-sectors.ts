// ─────────────────────────────────────────────────────────────────────────────
// PASS 1 · Stage 1c — apply the architect-provided sector mappings to the 160
// gated (sectorId=NULL) new stocks. Validates HARD before writing:
//   • every assignSector is a real sector name
//   • no duplicate / missing symbols
//   • the JSON symbol set EXACTLY equals the DB's current null-sector set
//     (so we neither miss a gated stock nor touch anything already mapped)
// Only updates stocks currently sectorId=NULL (idempotent, never overwrites an
// existing mapping). NEVER touches stock_peer_groups (firewall preserved).
//
//   npx tsx src/scripts/apply-nifty500-pass1-sectors.ts <filled-json>            # dry-run
//   npx tsx src/scripts/apply-nifty500-pass1-sectors.ts <filled-json> --commit   # write
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import fs from "fs";

interface Row { symbol: string; name?: string; nseIndustry?: string; assignSector: string; }

async function main() {
  const jsonPath = process.argv[2];
  const commit = process.argv.includes("--commit");
  if (!jsonPath) { console.error("usage: apply-nifty500-pass1-sectors.ts <filled-json> [--commit]"); process.exit(1); }

  const rows: Row[] = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const sectors = await prisma.sector.findMany({ select: { id: true, name: true } });
  const sectorIdByName = new Map(sectors.map((s) => [s.name, s.id]));
  const validSectorNames = new Set(sectorIdByName.keys());

  // DB's current gated set = all stocks with sectorId NULL.
  const nullSectorStocks = await prisma.stock.findMany({ where: { sectorId: null }, select: { symbol: true } });
  const dbNullSet = new Set(nullSectorStocks.map((s) => s.symbol));

  const errors: string[] = [];

  // 1. row-level validation
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.symbol) { errors.push(`row with missing symbol: ${JSON.stringify(r)}`); continue; }
    if (seen.has(r.symbol)) errors.push(`duplicate symbol in JSON: ${r.symbol}`);
    seen.add(r.symbol);
    if (!r.assignSector || !validSectorNames.has(r.assignSector))
      errors.push(`${r.symbol}: invalid assignSector "${r.assignSector ?? "(empty)"}" (not one of ${sectors.length} sector names)`);
  }

  // 2. set-equality: JSON symbols must exactly equal DB null-sector set
  const jsonSet = new Set(rows.map((r) => r.symbol));
  const inJsonNotNull = [...jsonSet].filter((s) => !dbNullSet.has(s)); // already mapped OR not in DB
  const nullNotInJson = [...dbNullSet].filter((s) => !jsonSet.has(s));  // gated but no mapping provided
  if (inJsonNotNull.length) errors.push(`JSON has ${inJsonNotNull.length} symbols that are NOT currently null-sector (already mapped or absent): ${inJsonNotNull.join(", ")}`);
  if (nullNotInJson.length) errors.push(`DB has ${nullNotInJson.length} null-sector stocks with NO mapping in JSON: ${nullNotInJson.join(", ")}`);

  console.log(`=== Stage 1c apply — ${commit ? "COMMIT" : "DRY-RUN"} ===`);
  console.log(`JSON rows                 : ${rows.length}`);
  console.log(`DB null-sector stocks     : ${dbNullSet.size}`);

  // Distribution of assignments
  const dist = new Map<string, number>();
  for (const r of rows) dist.set(r.assignSector, (dist.get(r.assignSector) ?? 0) + 1);
  console.log(`\nassignSector distribution:`);
  for (const [sec, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${sec}`);

  if (errors.length) {
    console.log(`\n❌ VALIDATION FAILED (${errors.length}) — NOTHING WRITTEN:`);
    for (const e of errors) console.log(`  • ${e}`);
    process.exit(1);
  }
  console.log(`\n✅ validation passed: all ${rows.length} assignSector values valid; symbol set exactly matches the ${dbNullSet.size} gated stocks.`);

  if (!commit) { console.log(`\n(dry-run — no writes. Re-run with --commit to apply.)`); await prisma.$disconnect(); return; }

  // 3. apply — group symbols by target sector → ONE updateMany per sector (16
  //    queries, not 160), only where currently NULL (belt & suspenders, idempotent).
  //    Grouped keeps the tx small/fast even under concurrent load; timeout bumped.
  const symbolsBySector = new Map<string, string[]>();
  for (const r of rows) {
    if (!symbolsBySector.has(r.assignSector)) symbolsBySector.set(r.assignSector, []);
    symbolsBySector.get(r.assignSector)!.push(r.symbol);
  }
  // Batch (array) form: 16 grouped updateManys in one transaction — small + fast,
  // completes well inside the default timeout (the 160-single-update version did
  // not, hence the grouping). The array form takes no timeout option (that's
  // interactive-only); it isn't needed here.
  const res = await prisma.$transaction(
    [...symbolsBySector.entries()].map(([sec, syms]) => prisma.stock.updateMany({
      where: { symbol: { in: syms }, sectorId: null },
      data: { sectorId: sectorIdByName.get(sec)! },
    })),
  );
  const updated = res.reduce((s, u) => s + u.count, 0);
  console.log(`\nsectors applied (rows updated): ${updated} across ${symbolsBySector.size} sector groups`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
