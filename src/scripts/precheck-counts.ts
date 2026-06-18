// Read-only precondition counts: bars intact + score tables empty pre-commit.
import { prisma } from "../db/prisma.js";

async function main() {
  const bars = await prisma.metricBarSet.count();
  const prov = await prisma.barProvenance.count();
  const spec = await prisma.scoringSpecVersion.count();
  const run = await prisma.scoringRun.count();
  const snap = await prisma.scoreSnapshot.count();
  const pillar = await prisma.pillarScore.count();
  const metric = await prisma.metricScore.count();
  const mktSub = await prisma.marketSubScore.count();
  const rf = await prisma.redFlag.count();
  console.log("MetricBarSet rows :", bars);
  console.log("BarProvenance     :", prov);
  console.log("ScoringSpecVersion:", spec);
  console.log("ScoringRun        :", run);
  console.log("--- score tables (expect all 0 pre-commit) ---");
  console.log("ScoreSnapshot     :", snap);
  console.log("PillarScore       :", pillar);
  console.log("MetricScore       :", metric);
  console.log("MarketSubScore    :", mktSub);
  console.log("RedFlag           :", rf);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
