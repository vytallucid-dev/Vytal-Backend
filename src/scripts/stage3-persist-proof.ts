// STAGE 3 — ONE-PG (PG9 + PG4) FULL WRITE → READ-BACK → ROLL-BACK PROOF.
// Proves the complete 4-pillar persist path end-to-end against the REAL DB, inside a
// single transaction, then ROLLS BACK to zero residue (commits nothing). Exercises the
// hard cases: full-4-pillar stocks, VEDL §14.4 Market-exclusion (3-pillar snapshot),
// ASHOKLEY R1 red flag, and the skip-identical no-op.
//
//   npx tsx src/scripts/stage3-persist-proof.ts
//
// GATE: this proof must pass before Stage 4 commits all 11 for real.

import { prisma } from "../db/prisma.js";
import { computePgScores, ensureScaffold, persistMember, type PgRef, type MemberWriteResult } from "../scoring/composite/score-pass.js";

const PGS: PgRef[] = [
  { pgId: "PG9", seedKey: "pg9_metals", pgName: "Large-Cap Metals & Mining" },
  { pgId: "PG4", seedKey: "pg4_auto_oem", pgName: "Large-Cap Auto OEMs" },
];
class Rollback extends Error {}
const f = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

async function tableCounts(db: any) {
  return {
    run: await db.scoringRun.count(), pillar: await db.pillarScore.count(), metric: await db.metricScore.count(),
    mktSub: await db.marketSubScore.count(), own: await db.ownershipScore.count(), flow: await db.ownershipFlowCategory.count(),
    snap: await db.scoreSnapshot.count(), rf: await db.redFlag.count(),
  };
}

async function main() {
  console.log("STAGE 3 — ONE-PG (PG9 + PG4) WRITE → READ-BACK → ROLL-BACK PROOF\n");
  const before = await tableCounts(prisma);
  console.log(`  baseline score-table counts: ${JSON.stringify(before)}\n`);

  // Compute both PGs read-only (the dry-run values we must reproduce on read-back).
  const computed: { ref: PgRef; pg: Awaited<ReturnType<typeof computePgScores>> }[] = [];
  for (const ref of PGS) computed.push({ ref, pg: await computePgScores(ref) });

  const checks: { name: string; ok: boolean; detail: string }[] = [];
  let insideCounts: any = null;
  let rolledBackOk = false;

  try {
    await prisma.$transaction(async (tx) => {
      const sc = await ensureScaffold(tx as any, new Date());
      const results = new Map<string, MemberWriteResult>();

      // ── WRITE both PGs ──
      for (const { ref, pg } of computed) {
        for (const m of pg.members) {
          const r = await persistMember(tx as any, m, sc, pg.asOf, pg.peerGroupId, ref.pgId);
          results.set(m.symbol, r);
        }
      }
      const created = [...results.values()].filter((r) => r.action === "created").length;
      console.log(`  WROTE (in-tx): ${created} snapshots created across PG9+PG4`);

      insideCounts = await tableCounts(tx);
      console.log(`  in-tx counts: ${JSON.stringify(insideCounts)}\n`);
      checks.push({ name: "rows written in-tx (pillars/metrics/market_subs/snapshots > 0)", ok: insideCounts.pillar > 0 && insideCounts.metric > 0 && insideCounts.mktSub > 0 && insideCounts.snap > 0, detail: `pillars=${insideCounts.pillar} metrics=${insideCounts.metric} market_subs=${insideCounts.mktSub} ownership=${insideCounts.own} flow=${insideCounts.flow} snapshots=${insideCounts.snap} red_flags=${insideCounts.rf}` });

      // helper: latest snapshot for a stock
      const allMembers = computed.flatMap((c) => c.pg.members);
      const snapFor = async (symbol: string) => {
        const m = allMembers.find((x) => x.symbol === symbol)!;
        return tx.scoreSnapshot.findFirst({ where: { stockId: m.stockId }, orderBy: { version: "desc" } });
      };

      // ── (1) FULL 4-PILLAR readback — TATASTEEL ──
      {
        const m = allMembers.find((x) => x.symbol === "TATASTEEL")!;
        const snap = await snapFor("TATASTEEL");
        const fps = snap ? [snap.foundationPillarId, snap.momentumPillarId, snap.marketPillarId, snap.ownershipPillarId] : [];
        const pillars = await tx.pillarScore.findMany({ where: { id: { in: fps } }, select: { id: true, pillar: true, pillarState: true } });
        const byId = new Map(pillars.map((p) => [p.id, p]));
        const fourResolve = !!snap && fps.every((id) => byId.has(id)) && byId.get(snap!.foundationPillarId)?.pillar === "foundation" && byId.get(snap!.momentumPillarId)?.pillar === "momentum" && byId.get(snap!.marketPillarId)?.pillar === "market" && byId.get(snap!.ownershipPillarId)?.pillar === "ownership";
        const compMatch = !!snap && Math.abs(Number(snap.composite) - (m.composite.composite ?? NaN)) < 1e-3;
        checks.push({ name: "(1) TATASTEEL snapshot references the right 4 pillar FKs", ok: fourResolve, detail: `F/M/Mkt/Own pillars resolve & typed correctly = ${fourResolve}` });
        checks.push({ name: "(1) TATASTEEL composite matches dry-run", ok: compMatch, detail: `stored ${f(Number(snap?.composite))} == computed ${f(m.composite.composite)} (band ${snap?.labelBand})` });

        const fMetrics = await tx.metricScore.findMany({ where: { pillarScoreId: snap!.foundationPillarId }, select: { metricKey: true, rawValue: true, l1Score: true, l2Score: true, l3Score: true, metricScore: true, l1Band: true } });
        const decomposable = fMetrics.length > 0 && fMetrics.every((x) => x.metricScore !== null) && fMetrics.some((x) => x.l1Score !== null && x.l2Score !== null);
        checks.push({ name: "(1) TATASTEEL Foundation MetricScores decomposable (L1/L2/L3 visible)", ok: decomposable, detail: `${fMetrics.length} metric rows; e.g. ${fMetrics[0]?.metricKey} L1=${f(Number(fMetrics[0]?.l1Score))} L2=${f(Number(fMetrics[0]?.l2Score))} L3=${fMetrics[0]?.l3Score == null ? "—" : f(Number(fMetrics[0]?.l3Score))} metric=${f(Number(fMetrics[0]?.metricScore))}` });

        const mSubs = await tx.marketSubScore.findMany({ where: { pillarScoreId: snap!.marketPillarId }, select: { subComponent: true, category: true, available: true, score: true, band: true } });
        const sevenScored = mSubs.length === 7 && mSubs.every((s) => s.available && s.score !== null && s.band !== null);
        checks.push({ name: "(1) TATASTEEL Market sub-components stored (7 rows, scored)", ok: sevenScored, detail: `${mSubs.length} rows; ${mSubs.map((s) => `${s.subComponent}=${f(Number(s.score), 0)}`).join(" ")}` });
      }

      // ── (2) §14.4 MARKET-EXCLUDED readback — VEDL ──
      {
        const snap = await snapFor("VEDL");
        const mktPillar = snap ? await tx.pillarScore.findUnique({ where: { id: snap.marketPillarId }, select: { pillar: true, pillarState: true, subtotal: true } }) : null;
        const mSubs = snap ? await tx.marketSubScore.findMany({ where: { pillarScoreId: snap.marketPillarId }, select: { available: true, reason: true } }) : [];
        const excluded = !!snap && mktPillar?.pillarState === "unavailable_redistributed" && Number(mktPillar.subtotal) === 0 && Number(snap.wMarket) === 0 && snap.weightRedistributionReason === "market_unavailable";
        const sevenExcl = mSubs.length === 7 && mSubs.every((s) => !s.available && !!s.reason);
        checks.push({ name: "(2) VEDL §14.4: Market pillar inert (state=unavailable_redistributed, subtotal 0, wMarket 0, reason market_unavailable)", ok: excluded, detail: `mktState=${mktPillar?.pillarState} mktSubtotal=${f(Number(mktPillar?.subtotal))} wMarket=${f(Number(snap?.wMarket))} reason=${snap?.weightRedistributionReason} composite=${f(Number(snap?.composite))} ${snap?.labelBand}` });
        checks.push({ name: "(2) VEDL all 7 Market sub-components stored as excluded (CN-6)", ok: sevenExcl, detail: `${mSubs.length} rows, all available=false with reason (e.g. "${mSubs[0]?.reason}")` });
      }

      // ── (3) R1 RED FLAG readback — ASHOKLEY ──
      {
        const snap = await snapFor("ASHOKLEY");
        const rf = snap ? await tx.redFlag.findFirst({ where: { snapshotId: snap.id, flagKey: "ownership_R1_pledge" }, select: { flagKey: true, severity: true, tier: true, triggeringValues: true, snapshotId: true } }) : null;
        const ok = !!rf && rf.snapshotId === snap!.id && rf.severity === "high";
        checks.push({ name: "(3) ASHOKLEY R1 red_flag persisted, linked to its snapshot", ok, detail: rf ? `flagKey=${rf.flagKey} severity=${rf.severity} tier=${rf.tier} triggering=${JSON.stringify(rf.triggeringValues).slice(0, 80)}…` : "no red_flag row found" });
      }

      // ── (4) SKIP-IDENTICAL — re-write TATASTEEL within the same tx ──
      {
        const m = computed[0].pg.members.find((x) => x.symbol === "TATASTEEL")!;
        const snapCountBefore = await tx.scoreSnapshot.count();
        const again = await persistMember(tx as any, m, await (async () => {
          // reuse the same scaffold by reading the in-tx run/spec/mapping
          const spec = (await tx.scoringSpecVersion.findFirst({ where: {}, orderBy: { createdAt: "desc" }, select: { id: true } }))!;
          const map = (await tx.bandMappingVersion.findFirst({ select: { id: true } }))!;
          const run = (await tx.scoringRun.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }))!;
          return { specVersionId: spec.id, runId: run.id, bandMappingVersionId: map.id };
        })(), computed[0].pg.asOf, computed[0].pg.peerGroupId, "PG9");
        const snapCountAfter = await tx.scoreSnapshot.count();
        checks.push({ name: "(4) skip-identical: re-writing TATASTEEL is a no-op (no duplicate snapshot)", ok: again.action === "skipped_identical" && snapCountAfter === snapCountBefore, detail: `action=${again.action}; snapshots ${snapCountBefore}→${snapCountAfter}` });
      }

      // ── ROLL BACK ──
      throw new Rollback("intentional rollback after read-back proof");
    }, { timeout: 120000, maxWait: 20000 });
  } catch (e) {
    if (e instanceof Rollback) rolledBackOk = true;
    else throw e;
  }

  // ── ZERO-RESIDUE: counts back to baseline ──
  const after = await tableCounts(prisma);
  const zeroResidue = JSON.stringify(after) === JSON.stringify(before);
  checks.push({ name: "(5) ROLLED BACK — zero residue (all score tables back to baseline)", ok: rolledBackOk && zeroResidue, detail: `rolledBack=${rolledBackOk}; after=${JSON.stringify(after)} == before=${JSON.stringify(before)}` });

  console.log("\nREAD-BACK + ROLLBACK CHECKS:");
  for (const c of checks) console.log(`  ${c.ok ? "✓ PASS" : "✗ FAIL"}  ${c.name}\n           ${c.detail}`);
  const allPass = checks.every((c) => c.ok);
  console.log(`\n  ${allPass ? "✓ STAGE-3 PROOF PASSES — full write path verified, rolled back clean. Stage-4 commit gate OPEN." : "✗ A CHECK FAILED — Stage-4 commit stays gated."}`);

  await prisma.$disconnect();
  if (!allPass) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
