// STAGE 4 — post-commit verification + cleanup of the empty idempotency-test run.
import { prisma } from "../db/prisma.js";

async function main() {
  const counts = {
    run: await prisma.scoringRun.count(), pillar: await prisma.pillarScore.count(), metric: await prisma.metricScore.count(),
    mktSub: await prisma.marketSubScore.count(), own: await prisma.ownershipScore.count(), flow: await prisma.ownershipFlowCategory.count(),
    snap: await prisma.scoreSnapshot.count(), rf: await prisma.redFlag.count(),
  };
  console.log("COMMITTED STATE:", JSON.stringify(counts));

  // Runs + how many snapshots/pillars each owns.
  const runs = await prisma.scoringRun.findMany({ select: { id: true, status: true, stocksScored: true, createdAt: true } });
  for (const r of runs) {
    const snaps = await prisma.scoreSnapshot.count({ where: { runId: r.id } });
    const pills = await prisma.pillarScore.count({ where: { runId: r.id } });
    console.log(`  run ${r.id.slice(0, 8)}… status=${r.status} stocksScored=${r.stocksScored} → owns ${snaps} snapshots, ${pills} pillars`);
  }

  // Delete the empty idempotency-test run (0 snapshots AND 0 pillars → childless).
  let deleted = 0;
  for (const r of runs) {
    const snaps = await prisma.scoreSnapshot.count({ where: { runId: r.id } });
    const pills = await prisma.pillarScore.count({ where: { runId: r.id } });
    if (snaps === 0 && pills === 0) { await prisma.scoringRun.delete({ where: { id: r.id } }); deleted++; console.log(`  → deleted empty run ${r.id.slice(0, 8)}…`); }
  }
  console.log(`  cleaned up ${deleted} empty run(s); ScoringRun now = ${await prisma.scoringRun.count()}`);

  // Band distribution over the committed Health Scores.
  const snaps = await prisma.scoreSnapshot.findMany({ select: { labelBand: true, weightRedistributionReason: true } });
  const bands = new Map<string, number>(); const reasons = new Map<string, number>();
  for (const s of snaps) { bands.set(s.labelBand, (bands.get(s.labelBand) ?? 0) + 1); reasons.set(s.weightRedistributionReason, (reasons.get(s.weightRedistributionReason) ?? 0) + 1); }
  console.log(`\n  band distribution (${snaps.length}): ${[...bands.entries()].map(([k, v]) => `${k}:${v}`).join("  ")}`);
  console.log(`  §14.4 redistribution reasons: ${[...reasons.entries()].map(([k, v]) => `${k}:${v}`).join("  ")}`);

  // Sample full decomposition: one committed stock (BAJAJ-AUTO) end-to-end.
  const snap = await prisma.scoreSnapshot.findFirst({ where: { symbol: "BAJAJ-AUTO" }, select: { id: true, composite: true, labelBand: true, foundationPillarId: true, momentumPillarId: true, marketPillarId: true, ownershipPillarId: true, wMarket: true } });
  if (snap) {
    const fm = await prisma.metricScore.count({ where: { pillarScoreId: snap.foundationPillarId } });
    const mm = await prisma.metricScore.count({ where: { pillarScoreId: snap.momentumPillarId } });
    const subs = await prisma.marketSubScore.count({ where: { pillarScoreId: snap.marketPillarId } });
    const own = await prisma.ownershipScore.findFirst({ where: { pillarScoreId: snap.ownershipPillarId }, select: { finalOwnership: true, baseline: true } });
    console.log(`\n  sample BAJAJ-AUTO: composite=${snap.composite} ${snap.labelBand}; F metrics=${fm} M metrics=${mm} MarketSubs=${subs} Own.final=${own?.finalOwnership} (baseline ${own?.baseline})`);
  }

  // VEDL §14.4 spot-check (committed)
  const vedl = await prisma.scoreSnapshot.findFirst({ where: { symbol: "VEDL" }, select: { composite: true, labelBand: true, wMarket: true, weightRedistributionReason: true, marketPillarId: true } });
  if (vedl) {
    const mp = await prisma.pillarScore.findUnique({ where: { id: vedl.marketPillarId }, select: { pillarState: true, subtotal: true } });
    const excl = await prisma.marketSubScore.count({ where: { pillarScoreId: vedl.marketPillarId, available: false } });
    console.log(`  VEDL §14.4 (committed): composite=${vedl.composite} ${vedl.labelBand} wMarket=${vedl.wMarket} reason=${vedl.weightRedistributionReason} | marketPillar state=${mp?.pillarState} subtotal=${mp?.subtotal}, ${excl}/7 subs excluded`);
  }

  // R1 (committed)
  const rf = await prisma.redFlag.findFirst({ where: { flagKey: "ownership_R1_pledge" }, select: { symbol: true, severity: true, snapshotId: true } });
  console.log(`  R1 red flag (committed): ${rf ? `${rf.symbol} severity=${rf.severity} → snapshot ${rf.snapshotId?.slice(0, 8)}…` : "none"}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
