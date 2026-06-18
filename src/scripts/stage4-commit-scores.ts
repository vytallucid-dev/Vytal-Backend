// STAGE 4 — COMMIT the FIRST COMPLETE HEALTH SCORES (real write) for all 11
// non-financial PGs. Foundation + Momentum (committed bars) + universal Market
// (cleaned prices) + Ownership → composite → ScoreSnapshot, with R1 red flags.
// One ScoringRun for the pass; per-PG transactions (each PG atomic); append-only +
// idempotent (get-or-create pillars by fingerprint, skip-identical snapshots).
//
//   npx tsx src/scripts/stage4-commit-scores.ts            (commits)
//
// Banking PG5/6/7 stay GATED (separate workstream). The 4 ex-data-blocked PGs
// (PG10/11/12/14) ARE in this commit (now full-4-pillar-scoreable).

import { prisma } from "../db/prisma.js";
import { computePgScores, ensureScaffold, finalizeRun, persistMember, type PgRef, type MemberWriteResult } from "../scoring/composite/score-pass.js";
import { snapshotInputsFingerprint } from "../scoring/composite/persist.js";

const PGS: PgRef[] = [
  { pgId: "PG1", seedKey: "pg1_it_services", pgName: "Large-Cap IT Services" },
  { pgId: "PG2", seedKey: "pg2_fmcg", pgName: "Large-Cap FMCG" },
  { pgId: "PG3", seedKey: "pg3_pharma", pgName: "Large-Cap Pharma" },
  { pgId: "PG4", seedKey: "pg4_auto_oem", pgName: "Large-Cap Auto OEMs" },
  { pgId: "PG8", seedKey: "pg8_power", pgName: "Large-Cap Power & Utilities" },
  { pgId: "PG9", seedKey: "pg9_metals", pgName: "Large-Cap Metals & Mining" },
  { pgId: "PG10", seedKey: "pg10_oil_gas", pgName: "Large-Cap Oil & Gas" },
  { pgId: "PG11", seedKey: "pg11_capital_goods", pgName: "Large-Cap Capital Goods & Industrial" },
  { pgId: "PG12", seedKey: "pg12_cement", pgName: "Large-Cap Cement" },
  { pgId: "PG13", seedKey: "pg13_consumer_durables", pgName: "Large-Cap Consumer Durables & Electrical" },
  { pgId: "PG14", seedKey: "pg14_defense", pgName: "Large-Cap Defense" },
];
const f = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));

async function tableCounts() {
  return {
    run: await prisma.scoringRun.count(), pillar: await prisma.pillarScore.count(), metric: await prisma.metricScore.count(),
    mktSub: await prisma.marketSubScore.count(), own: await prisma.ownershipScore.count(), flow: await prisma.ownershipFlowCategory.count(),
    snap: await prisma.scoreSnapshot.count(), rf: await prisma.redFlag.count(),
  };
}

async function main() {
  console.log("STAGE 4 — COMMIT FIRST COMPLETE HEALTH SCORES (all 11 non-financial PGs) — REAL WRITE\n");
  const before = await tableCounts();
  console.log(`  pre-commit score-table counts: ${JSON.stringify(before)}\n`);

  // One ScoringRun + spec + band-mapping for the whole pass (committed up front).
  const scaffold = await prisma.$transaction(async (tx) => ensureScaffold(tx as any, new Date()));
  console.log(`  ScoringRun ${scaffold.runId.slice(0, 8)}…  spec ${scaffold.specVersionId.slice(0, 8)}…  bandMapping ${scaffold.bandMappingVersionId.slice(0, 8)}…\n`);
  console.log(`  ${"PG".padEnd(5)} ${"scored".padEnd(7)} composite range   bands & per-stock`);
  console.log(`  ${"─".repeat(5)} ${"─".repeat(7)} ${"─".repeat(16)} ${"─".repeat(60)}`);

  let totalScored = 0, totalSkipped = 0, totalNoSnap = 0, totalR1 = 0;
  const r1Stocks: string[] = [];
  const noSnap: string[] = [];

  for (const ref of PGS) {
    const pg = await computePgScores(ref);
    const results = await prisma.$transaction(async (tx) => {
      const out: MemberWriteResult[] = [];
      for (const m of pg.members) out.push(await persistMember(tx as any, m, scaffold, pg.asOf, pg.peerGroupId, ref.pgId));
      return out;
    }, { timeout: 120000, maxWait: 20000 });

    const created = results.filter((r) => r.action === "created");
    const skipped = results.filter((r) => r.action === "skipped_identical");
    const noSnapHere = results.filter((r) => r.action === "unavailable_no_snapshot");
    const comps = created.map((r) => r.composite!).filter((x) => x != null);
    totalScored += created.length; totalSkipped += skipped.length; totalNoSnap += noSnapHere.length;
    for (const r of created) { if (r.r1Written) { totalR1++; r1Stocks.push(`${r.symbol}(${ref.pgId})`); } }
    for (const r of noSnapHere) noSnap.push(`${r.symbol}(${ref.pgId})`);

    const range = comps.length ? `${f(Math.min(...comps))}–${f(Math.max(...comps))}` : "—";
    const perStock = results.map((r) => r.action === "created" ? `${r.symbol} ${f(r.composite)}/${r.band}${r.marketState !== "scored" ? "*" : ""}${r.r1Written ? "⚑R1" : ""}` : `${r.symbol}:${r.action === "skipped_identical" ? "skip" : "no-snap"}`).join("  ");
    console.log(`  ${ref.pgId.padEnd(5)} ${`${created.length}/${pg.members.length}`.padEnd(7)} ${range.padEnd(16)} ${perStock}`);
  }

  await prisma.$transaction(async (tx) => finalizeRun(tx as any, scaffold.runId, totalScored, new Date()));

  // ── POST-COMMIT VERIFY ──
  const after = await tableCounts();
  console.log(`\n  post-commit counts: ${JSON.stringify(after)}`);
  console.log(`  committed: ${totalScored} Health Scores | ${totalSkipped} skipped-identical | ${totalNoSnap} no-snapshot (composite unavailable)`);
  console.log(`  R1 red flags written (${totalR1}): ${r1Stocks.join(", ") || "none"}`);
  if (noSnap.length) console.log(`  no-snapshot (composite unavailable, recorded — not scored): ${noSnap.join(", ")}`);

  // Idempotency: recompute one committed stock's snapshot fingerprint; it must equal the
  // stored one → a re-run would skip-identical (no duplicate). Read-only (writes nothing).
  const sample = await prisma.scoreSnapshot.findFirst({ where: {}, orderBy: { createdAt: "desc" }, select: { stockId: true, symbol: true, peerGroupId: true, inputsFingerprint: true } });
  let idem = "—";
  if (sample) {
    const owner = await prisma.peerGroup.findUnique({ where: { id: sample.peerGroupId }, select: { name: true } });
    const ownerRef = PGS.find((p) => p.pgName === owner?.name);
    if (ownerRef) {
      const pg = await computePgScores(ownerRef);
      const m = pg.members.find((x) => x.symbol === sample.symbol);
      if (m) { const fp = snapshotInputsFingerprint(m.composite); idem = fp === sample.inputsFingerprint ? `MATCH (${sample.symbol}) → re-run skips` : `DIFF (${sample.symbol})`; }
    }
  }
  console.log(`  idempotency (recompute fingerprint == stored): ${idem}`);

  // Banking + run provenance
  const run = await prisma.scoringRun.findUnique({ where: { id: scaffold.runId }, select: { status: true, stocksScored: true, specVersion: { select: { version: true } } } });
  console.log(`\n  ScoringRun: status=${run?.status} stocksScored=${run?.stocksScored} spec=${run?.specVersion.version}`);
  console.log(`  Banking PG5/PG6/PG7: NOT scored (gated — separate bank-data workstream).`);
  console.log(`\n  ${after.snap > before.snap ? "✓ FIRST COMPLETE HEALTH SCORES COMMITTED." : "✗ NO SNAPSHOTS WRITTEN — investigate"}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
