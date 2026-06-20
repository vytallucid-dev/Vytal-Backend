// READ-ONLY audit: version distribution, supersede chain integrity, resolver check.
//   npx tsx src/scripts/read-snapshot-audit.ts
import { prisma } from "../db/prisma.js";
const num = (d: unknown): number | null =>
  d == null ? null : typeof (d as { toNumber?: () => number }).toNumber === "function" ? (d as { toNumber: () => number }).toNumber() : Number(d);

async function main() {
  // Q1 — version distribution
  const byVer = await prisma.scoreSnapshot.groupBy({
    by: ["version"],
    where: { snapshotType: "quarterly", periodKey: "FY26Q4" },
    _count: { _all: true },
    orderBy: { version: "asc" },
  });
  console.log("── Q1: VERSION DISTRIBUTION (FY26Q4 quarterly) ─────────────────────");
  for (const r of byVer) console.log(`  v${r.version}: ${r._count._all} rows`);

  // distinct stocks with v>1 vs v1-only
  // In-force = highest version per stock (no supersededBy pointing at it)
  // Schema: supersedesId (this row supersedes that one); supersededBy = relation (who superseded this row)
  const allSnaps = await prisma.scoreSnapshot.findMany({
    where: { snapshotType: "quarterly", periodKey: "FY26Q4" },
    select: { stockId: true, symbol: true, version: true, createdAt: true, supersedesId: true, id: true,
      supersededBy: { select: { id: true } } },  // null ⇒ in-force; non-null ⇒ superseded
    orderBy: { version: "desc" },
  });
  const maxVerByStock = new Map<string, typeof allSnaps[number]>();
  for (const s of allSnaps) {
    if (!maxVerByStock.has(s.stockId)) maxVerByStock.set(s.stockId, s);
  }
  const rescored = [...maxVerByStock.values()].filter(s => s.version > 1);
  const v1only   = [...maxVerByStock.values()].filter(s => s.version === 1);
  console.log(`  Distinct stocks with v>1 (rescored): ${rescored.length}`);
  console.log(`  Distinct stocks still v1-only:        ${v1only.length}`);
  console.log(`  Sample rescored: ${rescored.slice(0,5).map(s=>`${s.symbol}(v${s.version})`).join(", ")}`);
  console.log(`  Sample v1-only:  ${v1only.slice(0,5).map(s=>s.symbol).join(", ")}`);

  // rescore window (createdAt of max-version rows)
  const createdAts = rescored.map(s => s.createdAt!).sort((a,b) => a.getTime()-b.getTime());
  if (createdAts.length) console.log(`  Rescore window: ${createdAts[0].toISOString()} → ${createdAts[createdAts.length-1].toISOString()}`);

  // Q1c — concrete before/after for HCLTECH (the one real C mover)
  console.log("\n── Q1c: BEFORE/AFTER for HCLTECH ───────────────────────────────────");
  const hclFull = await prisma.scoreSnapshot.findMany({
    where: { snapshotType: "quarterly", periodKey: "FY26Q4", symbol: "HCLTECH" },
    select: { version: true, composite: true, supersedesId: true, id: true, createdAt: true,
      supersededBy: { select: { id: true } },
      ownershipPillar: { select: { subtotal: true, ownershipScore: { select: { finalOwnership: true,
        flowCategories: { select: { category: true, categoryState: true, cappedSubScore: true } } } } } } },
    orderBy: { version: "asc" },
  });
  for (const s of hclFull) {
    const fc = s.ownershipPillar?.ownershipScore?.flowCategories ?? [];
    const c = fc.find(f => f.category === "C_insider");
    const d = fc.find(f => f.category === "D_block");
    const inForce = !s.supersededBy;
    console.log(`  v${s.version} composite=${num(s.composite)?.toFixed(2)} ownSubtotal=${num(s.ownershipPillar?.subtotal)?.toFixed(2)} finalOwn=${num(s.ownershipPillar?.ownershipScore?.finalOwnership)?.toFixed(2)} C=${c?.categoryState}(${num(c?.cappedSubScore)}) D=${d?.categoryState}(${num(d?.cappedSubScore)}) ${inForce?"IN-FORCE":"superseded"} supersedesId=${s.supersedesId ?? "—"} created=${s.createdAt?.toISOString().slice(0,19)}`);
  }

  // Q3 — supersede chain integrity
  console.log("\n── Q3: SUPERSEDE CHAIN INTEGRITY ────────────────────────────────────");
  const resccoredIds = new Set(rescored.map(s => s.stockId));
  // v1 rows for rescored stocks: should all have supersededBy non-null
  const v1OfRescored = allSnaps.filter(s => s.version === 1 && resccoredIds.has(s.stockId));
  const notChained = v1OfRescored.filter(s => !s.supersededBy);
  console.log(`  v1 rows for rescored stocks: ${v1OfRescored.length} — should all have supersededBy set`);
  console.log(`  Missing supersededBy (broken chain): ${notChained.length}${notChained.length ? " ← FLAG: " + notChained.map(s=>s.symbol).join(", ") : " ✓"}`);

  // Latest (max) version for each rescored stock: should have supersededBy = null (in-force)
  const latestOfRescored = await prisma.scoreSnapshot.findMany({
    where: { snapshotType: "quarterly", periodKey: "FY26Q4", stockId: { in: [...resccoredIds] }, version: { gt: 1 } },
    select: { stockId: true, symbol: true, version: true, supersedesId: true, supersededBy: { select: { id: true } } },
    orderBy: { version: "desc" },
  });
  const latestMap = new Map<string, typeof latestOfRescored[number]>();
  for (const s of latestOfRescored) { if (!latestMap.has(s.stockId)) latestMap.set(s.stockId, s); }
  const missingLink = [...latestMap.values()].filter(s => !s.supersedesId);
  const notInForce = [...latestMap.values()].filter(s => s.supersededBy);
  console.log(`  Latest v>1 rows with supersedesId set (points back): ${latestMap.size - missingLink.length}/${latestMap.size}${missingLink.length ? " ← FLAG: " + missingLink.map(s=>s.symbol).join(", ") : " ✓"}`);
  console.log(`  Latest v>1 rows that are themselves superseded (broken): ${notInForce.length}${notInForce.length ? " ← FLAG: " + notInForce.map(s=>s.symbol).join(", ") : " ✓"}`);

  // Q3 resolver simulation: MAX(version) per stock with no supersededBy = the in-force row
  console.log("\n── Q3: RESOLVER SIMULATION ──────────────────────────────────────────");
  // In-force = supersededBy is null, i.e. nothing points at them
  const inForceRows = allSnaps.filter(s => !s.supersededBy);
  const inForceByStock = new Map<string, typeof allSnaps[number]>();
  for (const s of inForceRows) inForceByStock.set(s.stockId, s);

  const rescoredSample = rescored[0];
  const v1Sample = v1only[0];
  for (const { label, sym } of [{ label: `rescored(${rescoredSample?.symbol})`, sym: rescoredSample?.symbol }, { label: `v1-only(${v1Sample?.symbol})`, sym: v1Sample?.symbol }]) {
    const entry = [...inForceByStock.values()].find(s => s.symbol === sym);
    console.log(`  ${label}: in-force row = v${entry?.version ?? "—"} supersedesId=${entry?.supersedesId ?? "—"} (supersededBy=${entry?.supersededBy ? "set←BROKEN" : "null=clean"})`);
  }

  // Any stock with >1 in-force row (would be a real resolver bug)
  const inForceCountByStock = new Map<string, number>();
  for (const s of inForceRows) inForceCountByStock.set(s.stockId, (inForceCountByStock.get(s.stockId) ?? 0) + 1);
  const dupes = [...inForceCountByStock.entries()].filter(([,n]) => n > 1);
  console.log(`  Stocks with >1 in-force row (resolver ambiguity): ${dupes.length}${dupes.length ? " ← FLAG: " + dupes.map(([id,n])=>`${id}×${n}`).join(", ") : " ✓"}`);

  // Q4 — scope
  console.log("\n── Q4: SCOPE + ERRORS ───────────────────────────────────────────────");
  console.log(`  Total in-force FY26Q4 snapshots: ${inForceRows.length}`);
  console.log(`  Rescore complete? Last v>1 row: ${createdAts.length ? createdAts[createdAts.length-1].toISOString() : "n/a"}`);

  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
