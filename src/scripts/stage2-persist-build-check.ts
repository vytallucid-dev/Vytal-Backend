// STAGE 2 — leaf-persist BUILD CHECK (DRY-RUN; writes NOTHING). Exercises the whole
// persist path's COMPUTE + MAPPERS (composite/score-pass.ts → computePgScores, the
// pillar/metric/market/snapshot/R1 row mappers) on the two hard PGs:
//   • PG9 (VEDL Market-EXCLUDED → §14.4 3-pillar snapshot)
//   • PG4 (ASHOKLEY R1 pledge red flag)
// Builds every ready-to-persist row shape, prints samples, and asserts the score
// tables are UNCHANGED (the write gate stays shut until the Stage-3 proof passes).
//
//   npx tsx src/scripts/stage2-persist-build-check.ts

import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";
import { toPillarScoreRow, metricWeightColumnsByKey, completeMetricScoreRow } from "../scoring/pillars/persist.js";
import { toMetricScoreRow } from "../scoring/metric-scoring/persist.js";
import { toMarketPillarScoreRow, marketSubScoreRows } from "../scoring/market/persist.js";
import { toScoreSnapshotRow, toR1RedFlagRow, snapshotInputsFingerprint } from "../scoring/composite/persist.js";
import { buildOwnershipScoreData } from "../scoring/ownership/persist.js";
import type { Pillar } from "../scoring/composite/types.js";

const PGS: PgRef[] = [
  { pgId: "PG9", seedKey: "pg9_metals", pgName: "Large-Cap Metals & Mining" },
  { pgId: "PG4", seedKey: "pg4_auto_oem", pgName: "Large-Cap Auto OEMs" },
];
const short = (s: string | null | undefined, n = 14) => (s == null ? "—" : s.length > n ? s.slice(0, n) + "…" : s);

async function main() {
  const before = {
    run: await prisma.scoringRun.count(), pillar: await prisma.pillarScore.count(), metric: await prisma.metricScore.count(),
    mktSub: await prisma.marketSubScore.count(), own: await prisma.ownershipScore.count(), snap: await prisma.scoreSnapshot.count(), rf: await prisma.redFlag.count(),
  };

  console.log("STAGE 2 — LEAF-PERSIST BUILD CHECK (DRY-RUN; writes nothing)");
  console.log("  write order: SpecVersion+Run+BandMapping → PillarScore×4 (+Metric/MarketSub/Ownership children) → ScoreSnapshot → R1 RedFlag");
  console.log("  fingerprints: pillar = sha256(pillar,stock,sourcePeriod,state,metrics[]);  market = sha256(state,subtotal,7×subs);  snapshot = sha256(4 subtotals+states+weights+composite+versions)\n");

  for (const ref of PGS) {
    const pg = await computePgScores(ref);
    console.log("═".repeat(110));
    console.log(`${ref.pgId} ${ref.pgName} — ${pg.members.length} members  asOf ${pg.asOf.toISOString().slice(0, 10)}  periodKey ${pg.periodKey}`);

    const mktExcluded = pg.members.filter((m) => !m.market || m.market.state !== "scored").map((m) => m.symbol);
    const r1Stocks = pg.members.filter((m) => m.own && buildOwnershipScoreData(m.own).r1Fired).map((m) => m.symbol);
    console.log(`  Market-excluded (→ §14.4 3-pillar snapshot, wMarket=0): ${mktExcluded.length ? mktExcluded.join(", ") : "none"}`);
    console.log(`  R1 pledge red-flag firing: ${r1Stocks.length ? r1Stocks.join(", ") : "none"}`);

    for (const m of pg.members) {
      const comp = m.composite;
      const mkt = m.market;
      const mState = mkt ? mkt.state : "none";
      const tag = comp.state === "scored" ? `${comp.composite!.toFixed(1)} ${comp.labelBand}` : `UNAVAIL(${comp.unavailableReason})`;
      console.log(`  ${m.symbol.padEnd(11)} F=${m.fPillar.subtotal?.toFixed(1).padStart(5) ?? "  n/a"} M=${m.mPillar.subtotal?.toFixed(1).padStart(5) ?? "  n/a"} Mkt=${(mkt && mkt.state === "scored" ? mkt.subtotal!.toFixed(1) : "EXCL").padStart(5)} Own=${m.own?.finalOwnership.toFixed(1).padStart(5) ?? "  n/a"} → comp ${tag}  [mkt ${mState}, w=${(comp.appliedWeights.market * 100).toFixed(1)}%]`);
    }

    // ── Build ready-to-persist row shapes for one full-4-pillar stock + (if present) one excluded + one R1 ──
    const ctx = { runId: "(run fk)", specVersionId: "(spec fk)", asOfDate: pg.asOf };
    const full = pg.members.find((m) => m.market && m.market.state === "scored" && m.composite.state === "scored");
    if (full) {
      console.log(`\n  ── READY-TO-PERSIST ROW SHAPES — ${full.symbol} (full 4-pillar) ──`);
      const fRow = toPillarScoreRow(full.fPillar, { ...ctx, sourcePeriod: full.fPillar.snapshot });
      const weights = metricWeightColumnsByKey(full.fPillar);
      const sm = full.fMetrics.find((s) => s.scoreState === "scored") ?? full.fMetrics[0];
      const mRow = sm ? completeMetricScoreRow(toMetricScoreRow(sm, { pillarScoreId: "(F pillar fk)", peerStatsSnapshotId: null, metricBarSetId: full.fBarSetIds.get(sm.metricKey) ?? null }), weights) : null;
      console.log(`     score_pillars(F)  : subtotal=${fRow.subtotal} state=${fRow.pillarState} src=${fRow.sourcePeriod} fp=${short(fRow.inputsFingerprint)}`);
      if (mRow) console.log(`     score_metrics     : ${sm!.metricKey} raw=${mRow.rawValue} L1=${mRow.l1Score}/${mRow.l1Band} L2=${mRow.l2Score} L3=${mRow.l3Score} metric=${mRow.metricScore} barSetId=${short(mRow.metricBarSetId, 8)} effW=${mRow.effectiveWeight} contrib=${mRow.contribution}`);
      const mp = toMarketPillarScoreRow(full.market!, { stockId: full.stockId, symbol: full.symbol, runId: ctx.runId, specVersionId: ctx.specVersionId, asOfDate: ctx.asOfDate, sourcePeriod: full.marketSourcePeriod });
      const subs = marketSubScoreRows(full.market!);
      console.log(`     score_pillars(Mkt): subtotal=${mp.subtotal} state=${mp.pillarState} src=${mp.sourcePeriod} fp=${short(mp.inputsFingerprint)}`);
      console.log(`     score_market_subs : ${subs.map((s) => `${s.subComponent}[${s.category}]${s.available ? `=${s.score}/${s.band}${s.saturated ? "↑" : ""}${s.capped ? "©" : ""}` : `:excl(${short(s.reason, 10)})`}`).join("  ")}`);
      const od = buildOwnershipScoreData(full.own!);
      console.log(`     score_ownership   : baseline=${od.ownershipScore.baseline} pledgeAdj=${od.ownershipScore.pledgingAdjustment} primary=${od.ownershipScore.primarySubtotal} flowClamped=${od.ownershipScore.flowAdjustmentClamped} final=${od.ownershipScore.finalOwnership} r1Fired=${od.r1Fired}`);
      const snap = toScoreSnapshotRow(full.composite, { runId: ctx.runId, specVersionId: ctx.specVersionId, bandMappingVersionId: "(bandmap fk)", peerGroupId: pg.peerGroupId, barPath: ref.pgId, industryPath: "non_financial", pillarScoreIds: { foundation: "(F)", momentum: "(M)", market: "(Mkt)", ownership: "(Own)" } as Record<Pillar, string> });
      console.log(`     score_snapshots   : composite=${snap.composite} band=${snap.labelBand} w=[F${snap.wFoundation}/M${snap.wMomentum}/Mkt${snap.wMarket}/Own${snap.wOwnership}] reason=${snap.weightRedistributionReason} fp=${short(snapshotInputsFingerprint(full.composite))}`);
    }

    const excl = pg.members.find((m) => m.market && m.market.state !== "scored" && m.composite.state === "scored");
    if (excl) {
      console.log(`\n  ── §14.4 MARKET-EXCLUDED ROW SHAPE — ${excl.symbol} (3-pillar snapshot) ──`);
      const mp = toMarketPillarScoreRow(excl.market!, { stockId: excl.stockId, symbol: excl.symbol, runId: ctx.runId, specVersionId: ctx.specVersionId, asOfDate: ctx.asOfDate, sourcePeriod: "MARKET_EXCLUDED" });
      const subs = marketSubScoreRows(excl.market!);
      const snap = toScoreSnapshotRow(excl.composite, { runId: ctx.runId, specVersionId: ctx.specVersionId, bandMappingVersionId: "(bandmap fk)", peerGroupId: pg.peerGroupId, barPath: ref.pgId, industryPath: "non_financial", pillarScoreIds: { foundation: "(F)", momentum: "(M)", market: "(Mkt-inert)", ownership: "(Own)" } as Record<Pillar, string> });
      console.log(`     score_pillars(Mkt): subtotal=${mp.subtotal} (inert) state=${mp.pillarState}`);
      console.log(`     score_market_subs : ${subs.map((s) => `${s.subComponent}${s.available ? `=${s.score}` : ":excl"}`).join(" ")}  (all 7 stored — CN-6)`);
      console.log(`     score_snapshots   : composite=${snap.composite} band=${snap.labelBand} wMarket=${snap.wMarket} reason=${snap.weightRedistributionReason}  (marketPillarId still NOT NULL → references the inert pillar)`);
    }

    const r1 = pg.members.find((m) => m.own && buildOwnershipScoreData(m.own).r1Fired && m.composite.state === "scored");
    if (r1) {
      const od = buildOwnershipScoreData(r1.own!);
      const rf = toR1RedFlagRow("(snapshot fk)", r1.composite, od.r1TriggeringValues);
      console.log(`\n  ── R1 RED-FLAG ROW SHAPE — ${r1.symbol} ──`);
      console.log(`     score_red_flags   : flagKey=${rf.flagKey} severity=${rf.severity} tier=${rf.tier} triggering=${JSON.stringify(rf.triggeringValues)}`);
    }
    console.log("");
  }

  const after = {
    run: await prisma.scoringRun.count(), pillar: await prisma.pillarScore.count(), metric: await prisma.metricScore.count(),
    mktSub: await prisma.marketSubScore.count(), own: await prisma.ownershipScore.count(), snap: await prisma.scoreSnapshot.count(), rf: await prisma.redFlag.count(),
  };
  const unchanged = Object.keys(before).every((k) => (before as any)[k] === (after as any)[k]);
  console.log("═".repeat(110));
  console.log("COMMITS-NOTHING ASSERTION");
  console.log(`  runs ${before.run}→${after.run}  pillars ${before.pillar}→${after.pillar}  metrics ${before.metric}→${after.metric}  market_subs ${before.mktSub}→${after.mktSub}  ownership ${before.own}→${after.own}  snapshots ${before.snap}→${after.snap}  red_flags ${before.rf}→${after.rf}`);
  console.log(`  ${unchanged ? "✓ DRY-RUN: no score rows written — persist path built, gate still shut." : "✗ SOMETHING WAS WRITTEN — investigate"}`);

  await prisma.$disconnect();
  if (!unchanged) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
