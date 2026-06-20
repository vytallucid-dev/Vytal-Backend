// STAGE 4 — COMMIT banking Health Scores for PG5 (Private) + PG6 (PSU).
//   npx tsx src/scripts/bank-stage4-commit.ts            # DRY (reconcile plan + dry scores, no writes)
//   npx tsx src/scripts/bank-stage4-commit.ts --commit   # REAL WRITE (authorized)
//
// PHASE A — reconcile the PG5 roster to the bar-derivation cohort (remove
//   IDFCFIRSTB+YESBANK, add FEDERALBNK) so PG5 == the 6 private banks the committed
//   bars were derived from. peer_group_stocks write; idempotent (no-op if already done).
// PHASE B — commit PG5 + PG6 scores through the SAME 4-pillar orchestrator the 81
//   non-financial snapshots used (one banking ScoringRun; per-PG tx; append-only,
//   idempotent on inputsFingerprint). industryPath="banking"; PG6 uses inherited PG5 bars.

import { prisma } from "../db/prisma.js";
import { computePgScores, ensureScaffold, finalizeRun, persistMember, type PgRef, type MemberWriteResult } from "../scoring/composite/score-pass.js";
import { snapshotInputsFingerprint } from "../scoring/composite/persist.js";

const COMMIT = process.argv.includes("--commit");

const PG5: PgRef = { pgId: "PG5", seedKey: "pg5_private_banks", pgName: "Large-Cap Private Banks" };
const PG6: PgRef = { pgId: "PG6", seedKey: "pg6_psu_banks", pgName: "Large-Cap PSU Banks" };
const PG5_COHORT = ["HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "INDUSINDBK", "FEDERALBNK"];

const f = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));

async function counts() {
  return {
    run: await prisma.scoringRun.count(), pillar: await prisma.pillarScore.count(), metric: await prisma.metricScore.count(),
    mktSub: await prisma.marketSubScore.count(), own: await prisma.ownershipScore.count(),
    snap: await prisma.scoreSnapshot.count(), rf: await prisma.redFlag.count(),
  };
}

// ── PHASE A — reconcile PG5 roster to PG5_COHORT ─────────────────────────────────
async function reconcilePg5(): Promise<void> {
  const pg = await prisma.peerGroup.findFirst({ where: { name: PG5.pgName }, include: { stocks: { include: { stock: true } } } });
  if (!pg) throw new Error("PG5 peer group not found");
  const before = pg.stocks.map((s) => s.stock.symbol).sort();
  const want = new Set(PG5_COHORT);
  const toAdd = PG5_COHORT.filter((s) => !before.includes(s));
  const toRemove = pg.stocks.filter((s) => !want.has(s.stock.symbol));

  const stocks = await prisma.stock.findMany({ where: { symbol: { in: toAdd } }, select: { id: true, symbol: true } });
  const idBySym = new Map(stocks.map((s) => [s.symbol, s.id]));
  const unresolved = toAdd.filter((s) => !idBySym.has(s));
  if (unresolved.length) throw new Error(`PG5 reconcile: unresolved add symbols ${unresolved.join(",")}`);

  const noop = toAdd.length === 0 && toRemove.length === 0;
  console.log(`PHASE A — PG5 roster reconcile`);
  console.log(`  before: [${before.join(", ")}]`);
  console.log(`  +add:   [${toAdd.join(", ") || "—"}]   -remove: [${toRemove.map((s) => s.stock.symbol).join(", ") || "—"}]`);
  if (noop) { console.log(`  → already == cohort (no-op)\n`); return; }

  if (COMMIT) {
    for (const sym of toAdd) await prisma.stockPeerGroup.create({ data: { stockId: idBySym.get(sym)!, peerGroupId: pg.id } });
    for (const s of toRemove) await prisma.stockPeerGroup.delete({ where: { id: s.id } });
    const count = await prisma.stockPeerGroup.count({ where: { peerGroupId: pg.id } });
    await prisma.peerGroup.update({ where: { id: pg.id }, data: { stockCount: count } });
    const after = await prisma.peerGroup.findFirst({ where: { id: pg.id }, include: { stocks: { include: { stock: true } } } });
    const afterSyms = after!.stocks.map((s) => s.stock.symbol).sort();
    const match = afterSyms.length === PG5_COHORT.length && PG5_COHORT.every((s) => afterSyms.includes(s));
    console.log(`  → after:  [${afterSyms.join(", ")}]  (n=${count})  ${match ? "✓ == cohort" : "✗ MISMATCH"}\n`);
    if (!match) throw new Error("PG5 reconcile post-check failed");
  } else {
    console.log(`  → would become: [${PG5_COHORT.join(", ")}]  (DRY — not written)\n`);
  }
}

// ── PHASE B — commit PG5 + PG6 ───────────────────────────────────────────────────
async function main() {
  console.log(`\nSTAGE 4 — BANKING COMMIT (PG5 + PG6)   mode=${COMMIT ? "COMMIT (real write)" : "DRY"}\n`);
  const before = await counts();
  console.log(`  pre score-table counts: ${JSON.stringify(before)}\n`);

  await reconcilePg5();

  if (!COMMIT) {
    // DRY: score both (PG5 via cohort override since the DB roster isn't reconciled yet) and report.
    console.log(`PHASE B — dry scores (no write)`);
    for (const [ref, override] of [[PG5, PG5_COHORT], [PG6, undefined]] as const) {
      const pg = await computePgScores(ref, override ? { rosterOverride: override } : {});
      const line = pg.members.map((m) => `${m.symbol} ${f(m.composite.composite)}/${m.composite.labelBand}`).join("  ");
      console.log(`  ${ref.pgId} (${pg.industry}): ${line}`);
    }
    console.log(`\n  DRY — nothing written. Re-run with --commit to apply Phase A + Phase B.`);
    await prisma.$disconnect();
    return;
  }

  // One banking ScoringRun for the pass.
  const scaffold = await prisma.$transaction(async (tx) => ensureScaffold(tx as any, new Date()));
  console.log(`PHASE B — commit  (ScoringRun ${scaffold.runId.slice(0, 8)}…, spec ${scaffold.specVersionId.slice(0, 8)}…)`);

  let totalScored = 0, totalSkipped = 0, totalNoSnap = 0, totalR1 = 0;
  const r1Stocks: string[] = []; const noSnap: string[] = [];

  for (const ref of [PG5, PG6]) {
    const pg = await computePgScores(ref); // DB roster (PG5 now reconciled)
    const results = await prisma.$transaction(async (tx) => {
      const out: MemberWriteResult[] = [];
      for (const m of pg.members) out.push(await persistMember(tx as any, m, scaffold, pg.asOf, pg.peerGroupId, ref.pgId, pg.industry, pg.peerStats));
      return out;
    }, { timeout: 120000, maxWait: 20000 });

    const created = results.filter((r) => r.action === "created");
    const skipped = results.filter((r) => r.action === "skipped_identical");
    const noSnapHere = results.filter((r) => r.action === "unavailable_no_snapshot");
    const comps = created.map((r) => r.composite!).filter((x) => x != null);
    totalScored += created.length; totalSkipped += skipped.length; totalNoSnap += noSnapHere.length;
    for (const r of created) if (r.r1Written) { totalR1++; r1Stocks.push(`${r.symbol}(${ref.pgId})`); }
    for (const r of noSnapHere) noSnap.push(`${r.symbol}(${ref.pgId})`);

    const range = comps.length ? `${f(Math.min(...comps))}–${f(Math.max(...comps))}` : "—";
    const perStock = results.map((r) => r.action === "created" ? `${r.symbol} ${f(r.composite)}/${r.band}${r.marketState !== "scored" ? "*" : ""}${r.r1Written ? "⚑R1" : ""}` : `${r.symbol}:${r.action === "skipped_identical" ? "skip" : "no-snap"}`).join("  ");
    console.log(`  ${ref.pgId.padEnd(4)} ${`${created.length}/${pg.members.length}`.padEnd(6)} ${range.padEnd(14)} ${perStock}`);
  }

  await prisma.$transaction(async (tx) => finalizeRun(tx as any, scaffold.runId, totalScored, new Date()));

  // ── POST-COMMIT VERIFY ──
  const after = await counts();
  console.log(`\n  post counts: ${JSON.stringify(after)}`);
  console.log(`  committed: ${totalScored} banking Health Scores | ${totalSkipped} skipped-identical | ${totalNoSnap} no-snapshot`);
  console.log(`  R1 red flags (${totalR1}): ${r1Stocks.join(", ") || "none (banks zero-pledge → R1 inactive)"}`);
  if (noSnap.length) console.log(`  no-snapshot: ${noSnap.join(", ")}`);

  // Idempotency: recompute a committed banking snapshot's fingerprint == stored.
  const sample = await prisma.scoreSnapshot.findFirst({ where: { industryPath: "banking" }, orderBy: { createdAt: "desc" }, select: { stockId: true, symbol: true, peerGroupId: true, inputsFingerprint: true } });
  let idem = "—";
  if (sample) {
    const owner = await prisma.peerGroup.findUnique({ where: { id: sample.peerGroupId }, select: { name: true } });
    const ref = [PG5, PG6].find((p) => p.pgName === owner?.name);
    if (ref) { const pg = await computePgScores(ref); const m = pg.members.find((x) => x.symbol === sample.symbol); if (m) idem = snapshotInputsFingerprint(m.composite) === sample.inputsFingerprint ? `MATCH (${sample.symbol}) → re-run skips` : `DIFF (${sample.symbol})`; }
  }
  console.log(`  idempotency: ${idem}`);

  const bankingSnaps = await prisma.scoreSnapshot.count({ where: { industryPath: "banking" } });
  const totalSnaps = await prisma.scoreSnapshot.count();
  const pgCount = await prisma.scoreSnapshot.groupBy({ by: ["peerGroupId"], _count: { _all: true } });
  console.log(`\n  banking snapshots: ${bankingSnaps}   total snapshots (all PGs): ${totalSnaps}   distinct PGs with scores: ${pgCount.length}`);
  console.log(`  ${after.snap > before.snap ? "✓ BANKING HEALTH SCORES COMMITTED — banking ungated." : "✗ NO NEW SNAPSHOTS — investigate"}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
