// Confirm the universe health endpoint output.
//   npx tsx src/scripts/confirm-universe-health.ts
import { buildUniverseHealthView } from "../scoring/read/universe-view.service.js";
import { prisma } from "../db/prisma.js";

const view = await buildUniverseHealthView();

console.log("\n=== AGGREGATE ===");
const a = view.aggregate!;
console.log(JSON.stringify({
  scoredCount: a.scoredCount,
  medianComposite: a.medianComposite,
  meanComposite: a.meanComposite,
  priorMedianComposite: a.priorMedianComposite,
  medianDrift: a.medianDrift,
  priorPeriodKey: a.priorPeriodKey,
  dispersion: a.dispersion,
  range: a.range,
  bandDistribution: a.bandDistribution,
  pillarMedians: a.pillarMedians,
  redFlagMemberCount: a.redFlagMemberCount,
  descriptor: a.descriptor,
  periodKey: view.periodKey,
  asOfDate: view.asOfDate,
  scoredUniverseSize: view.scoredUniverseSize,
}, null, 2));

console.log("\n=== 3 SAMPLE MEMBERS (HCLTECH, BHEL, TORNTPOWER) ===");
for (const sym of ["HCLTECH", "BHEL", "TORNTPOWER"]) {
  const m = view.members.find(x => x.symbol === sym);
  if (!m) { console.log(`  ${sym}: NOT IN UNIVERSE`); continue; }
  console.log(`\n${sym}:`);
  console.log(JSON.stringify({
    composite: m.composite, labelBand: m.labelBand,
    pillars: m.pillars,
    trajectoryMarker: m.trajectoryMarker, trajectoryDelta: m.trajectoryDelta,
    divergence: m.divergence,
    firedFlags: m.firedFlags, firedPatterns: m.firedPatterns,
    sector: m.sector,
  }, null, 2));
}

console.log("\n=== PATHOLOGY CENSUS (all) ===");
if (view.pathology.length === 0) {
  console.log("  (none — no flags or patterns in the universe cross-section)");
} else {
  for (const p of view.pathology) {
    console.log(`  [${p.kind}] ${p.key}  severity=${p.severity}  N=${p.memberCount}/${p.outOf}  reach=${p.reach}`);
    console.log(`    members: ${p.members.slice(0, 5).join(", ")}${p.members.length > 5 ? ` +${p.members.length - 5}` : ""}`);
  }
}

console.log("\n=== MOVERS (top 5 each) ===");
console.log("Risers:");
for (const m of view.movers.risers.slice(0, 5))
  console.log(`  ${m.symbol.padEnd(15)} +${m.delta}  ${m.fromPeriod} → ${m.toPeriod}`);
console.log("Slippers:");
for (const m of view.movers.slippers.slice(0, 5))
  console.log(`  ${m.symbol.padEnd(15)} ${m.delta}  ${m.fromPeriod} → ${m.toPeriod}`);

console.log("\n=== SINCE LAST WEEK ===");
const w = view.sinceLastWeek;
console.log(`  anchorDate: ${w.anchorDate}  newVersionCount: ${w.newVersionCount}`);
console.log(`  bandCrossings (${w.bandCrossings.length}):`);
for (const b of w.bandCrossings)
  console.log(`    ${b.symbol}  ${b.from} → ${b.to}  (${b.direction})`);
console.log(`  newFlags (${w.newFlags.length}):`);
for (const f of w.newFlags)
  console.log(`    ${f.symbol}  ${f.flagKey}  severity=${f.severity}`);
console.log(`  newDeteriorations (${w.newDeteriorations.length}):`);
for (const d of w.newDeteriorations)
  console.log(`    ${d.symbol}  Δ${d.delta}  ${d.fromComposite}→${d.toComposite}  ${d.fromBand}→${d.toBand}`);
console.log(`  newRecoveries (${w.newRecoveries.length}):`);
for (const r of w.newRecoveries)
  console.log(`    ${r.symbol}  Δ+${r.delta}  ${r.fromComposite}→${r.toComposite}  ${r.fromBand}→${r.toBand}`);
console.log(`  honestNote: ${w.honestNote.slice(0, 80)}...`);

await prisma.$disconnect();
