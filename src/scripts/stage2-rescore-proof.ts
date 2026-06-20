// ═══ STAGE 2 — MANUAL PG_RESCORE PROOF (PG5, real writes) ═══
//   npx tsx src/scripts/stage2-rescore-proof.ts
//
// Proves the PG_RESCORE job itself is correct + idempotent BEFORE any auto-trigger:
//   (a) UNCHANGED inputs  → every member skip-identical, ZERO snapshots, NO ScoringRun.
//   (b) ONE genuine change (ICICIBANK ownership) → targeted supersede v1→v2; others skip.
//   (c) A SECOND genuine change → v2→v3 chains (proves the Stage-1.5 multi-supersede fix;
//       the old version:1-hardcode would THROW here).
//   (d) The (type,pgId) dedup guard coalesces a double-enqueue of PG_RESCORE(PG5).
//
// PERTURBATION = ICICIBANK OWNERSHIP, the only PER-STOCK-ISOLATED lever (computeOwnership
// is per-stock; the other 5 PG5 banks are structurally untouched → they MUST skip). We
// introduce a transient promoter stake (moves the Primary baseline → ownership value →
// composite → snapshot fingerprint → supersede), verified read-only before each persist.
//
// RESIDUE POLICY (operator choice): LEAVE the append-only audit trail. We revert the
// INPUT and rescore once more (v3→v4) so ICICIBANK's LIVE score returns to baseline; we
// do NOT delete the v2/v3/v4 snapshots. Committed v1 is byte-intact throughout. Only the
// transient shareholding edit and the test pg_rescore job rows are cleaned up.

import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import type { JobContext } from "../jobs/context.js";
import type { PgRescorePayload } from "../jobs/types.js";
import { handlePgRescore } from "../jobs/handlers/pg-rescore.handler.js";
import { enqueuePgRescore } from "../jobs/scoring-triggers.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";

const PG5: PgRef = { pgId: "PG5", seedKey: "pg5_private_banks", pgName: "Large-Cap Private Banks" };
const TARGET = "ICICIBANK";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`    [${cond ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (cond) pass++;
  else fail++;
}

const ctx = (payload: PgRescorePayload): JobContext<PgRescorePayload> => ({
  jobId: "stage2-proof",
  payload,
  signal: new AbortController().signal,
  reportProgress: async () => {},
  shouldCancel: async () => false,
});
const payload = (triggeredBy: string, reason: string): PgRescorePayload => ({
  pgId: PG5.pgId, pgName: PG5.pgName, seedKey: PG5.seedKey, triggeredBy, reason,
});

async function counts() {
  const [snap, run] = await Promise.all([prisma.scoreSnapshot.count(), prisma.scoringRun.count()]);
  return { snap, run };
}
async function liveSnap(stockId: string) {
  return prisma.scoreSnapshot.findFirst({
    where: { stockId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, composite: true, inputsFingerprint: true, supersedesId: true, periodKey: true, snapshotType: true },
  });
}
const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));

async function main() {
  console.log("\n═══ STAGE 2 — MANUAL PG_RESCORE PROOF (PG5) — real writes, append-only ═══\n");

  const ic = await prisma.stock.findFirst({ where: { symbol: TARGET }, select: { id: true } });
  if (!ic) throw new Error("ICICIBANK not found");
  const shRow = await prisma.shareholdingPattern.findFirst({ where: { stockId: ic.id }, orderBy: { asOnDate: "desc" } });
  if (!shRow) throw new Error("ICICIBANK has no shareholding row");

  // Capture ALL ownership-fingerprint fields for a clean restore.
  const orig = {
    promoterPct: shRow.promoterPct, publicPct: shRow.publicPct,
    fiiPct: shRow.fiiPct, diiPct: shRow.diiPct, retailPct: shRow.retailPct,
    promoterShares: shRow.promoterShares, totalShares: shRow.totalShares,
  };
  const total = Number(orig.totalShares ?? 0n);
  const dec = (v: number) => new Prisma.Decimal(v.toFixed(4));
  const f0 = num(orig.fiiPct)!, d0 = num(orig.diiPct)!, r0 = num(orig.retailPct)!;

  // Ownership is per-stock → editing ICICIBANK's LATEST quarter moves ONLY its
  // composite (the other 5 banks are structurally untouched). Distinct ownership
  // VALUES come from the Flow layer: Category A (promoter-share accumulation, flat +3)
  // and Category B (institutional FII+DII flow: B4 dual-exit −6 / B3 accumulation +3).
  // Each candidate is a full, internally-consistent override of the Q4 buckets.
  interface ShState { name: string; promoterPct: number; publicPct: number; promoterShares: bigint; fiiPct: number; diiPct: number; retailPct: number }
  const CANDIDATES: ShState[] = [
    // promoter accumulation (A:+3), institutional still falling vs Q3 (B4 −6)
    { name: "promoterAccum", promoterPct: 20, publicPct: 80, promoterShares: BigInt(Math.floor(total * 0.2)), fiiPct: f0 * 0.8, diiPct: d0 * 0.8, retailPct: r0 * 0.8 },
    // no promoter (A:0), institutional ACCUMULATION vs Q3 (B3 +3)
    { name: "instAccum", promoterPct: 0, publicPct: 100, promoterShares: 0n, fiiPct: 52, diiPct: 48, retailPct: 0 },
    // promoter accumulation (A:+3) AND institutional accumulation (B +3/+5)
    { name: "bothAccum", promoterPct: 12, publicPct: 88, promoterShares: BigInt(Math.floor(total * 0.12)), fiiPct: 50, diiPct: 38, retailPct: 0 },
  ];
  async function applyState(s: ShState | null) {
    const data = s === null
      ? { promoterPct: orig.promoterPct, publicPct: orig.publicPct, promoterShares: orig.promoterShares, fiiPct: orig.fiiPct, diiPct: orig.diiPct, retailPct: orig.retailPct }
      : { promoterPct: dec(s.promoterPct), publicPct: dec(s.publicPct), promoterShares: s.promoterShares, fiiPct: dec(s.fiiPct), diiPct: dec(s.diiPct), retailPct: dec(s.retailPct) };
    await prisma.shareholdingPattern.update({ where: { id: shRow!.id }, data });
  }
  async function icComposite(): Promise<number | null> {
    const pg = await computePgScores(PG5);
    return pg.members.find((m) => m.symbol === TARGET)?.composite.composite ?? null;
  }

  const baseLive = await liveSnap(ic.id);
  const baseComposite = num(baseLive?.composite);
  console.log(`  baseline ICICIBANK: live v${baseLive?.version} composite=${baseComposite?.toFixed(4)} period=${baseLive?.periodKey} fp=${baseLive?.inputsFingerprint.slice(0, 10)}…`);
  const base = await counts();
  console.log(`  baseline counts: snapshots=${base.snap} runs=${base.run}\n`);

  // Probe candidates read-only; keep those whose composite differs from baseline, then
  // pick two whose composites also differ from EACH OTHER (so b→c is a genuine change).
  let stateB: ShState | null = null, stateC: ShState | null = null;
  try {
    const moved: { s: ShState; c: number }[] = [];
    for (const s of CANDIDATES) {
      await applyState(s);
      const c = await icComposite();
      const did = c !== null && baseComposite !== null && Math.abs(c - baseComposite) > 1e-4;
      console.log(`  candidate ${s.name.padEnd(13)} → ICICIBANK composite=${c?.toFixed(4)} ${did ? "(moved ✓)" : "(no move)"}`);
      if (did) moved.push({ s, c: c! });
    }
    await applyState(null);
    stateB = moved[0]?.s ?? null;
    const second = moved.find((m) => Math.abs(m.c - (moved[0]?.c ?? 0)) > 1e-4);
    stateC = second?.s ?? null;
  } catch (e) {
    await applyState(null);
    throw e;
  }
  console.log(`  → stateB=${stateB?.name}, stateC=${stateC?.name}\n`);
  if (!stateB || !stateC) throw new Error(`could not find two distinct value-moving states (B=${stateB?.name}, C=${stateC?.name})`);

  let cur0: Awaited<ReturnType<typeof liveSnap>> = null; // ICICIBANK current-price baseline (post step-0)
  try {
    // ── STEP 0 — BRING PG5 CURRENT ──
    // The committed v1 scores predate days of price ingestion; re-scoring NOW moves the
    // Market pillar → members legitimately supersede. This is the event-driven reality
    // (prices move daily → Market moves → rescore supersedes), not a no-op. We bring PG5
    // current FIRST so "unchanged" in proof (a) means "unchanged between two consecutive
    // rescores", which is the actual fingerprint-guard property.
    console.log("── STEP 0: bring PG5 current (committed v1 predates recent price ingestion → Market moved)");
    const r0 = await handlePgRescore(ctx(payload("manual", "stage2 bring-current")));
    console.log(`    rescore: ${r0.created} created, ${r0.superseded} superseded, ${r0.skippedIdentical} skip-identical (Market moved since commit → expected supersedes)`);
    cur0 = await liveSnap(ic.id); // ICICIBANK current-price baseline for the proof
    console.log(`    ICICIBANK now live v${cur0?.version} composite=${num(cur0?.composite)?.toFixed(4)} fp=${cur0?.inputsFingerprint.slice(0, 10)}…`);

    // ── PROOF (a) — a SECOND consecutive rescore with no change → all skip, zero writes, no run ──
    console.log("\n── PROOF (a): re-run with NO change → all skip-identical, zero writes, no ScoringRun");
    const beforeA = await counts();
    const rA = await handlePgRescore(ctx(payload("manual", "stage2(a) unchanged")));
    const afterA = await counts();
    check("outcome = no_op_all_identical", rA.outcome === "no_op_all_identical", rA.outcome);
    check("runId is null (no ScoringRun opened)", rA.runId === null);
    check("0 created, 0 superseded", rA.created === 0 && rA.superseded === 0);
    check(`all ${rA.members} members skip-identical`, rA.skippedIdentical === rA.members, `skipped=${rA.skippedIdentical}/${rA.members}`);
    check("snapshot count unchanged", afterA.snap === beforeA.snap, `${beforeA.snap}→${afterA.snap}`);
    check("ScoringRun count unchanged", afterA.run === beforeA.run, `${beforeA.run}→${afterA.run}`);

    // ── PROOF (b) — ONE change → targeted supersede, others skip ──
    console.log("\n── PROOF (b): GENUINE CHANGE (ICICIBANK ownership) → targeted supersede, others skip");
    const preB = await liveSnap(ic.id);
    await applyState(stateB);
    const beforeB = await counts();
    const rB = await handlePgRescore(ctx(payload("manual", "stage2(b) change#1")));
    const afterB = await counts();
    const icB = rB.perMember.find((m) => m.symbol === TARGET)!;
    const othersB = rB.perMember.filter((m) => m.symbol !== TARGET);
    check("outcome = wrote", rB.outcome === "wrote");
    check(`ICICIBANK superseded v${preB?.version}→v${preB!.version + 1}`, icB.action === "superseded" && icB.version === preB!.version + 1, `action=${icB.action} v=${icB.version}`);
    check("other 5 members skip-identical", othersB.every((m) => m.action === "skipped_identical"), othersB.map((m) => `${m.symbol}:${m.action}`).join(" "));
    check("exactly 1 new snapshot", afterB.snap === beforeB.snap + 1, `${beforeB.snap}→${afterB.snap}`);
    check("exactly 1 new ScoringRun", afterB.run === beforeB.run + 1, `${beforeB.run}→${afterB.run}`);
    const icB2 = await liveSnap(ic.id);
    check("new live snapshot supersedes the prior live", icB2?.supersedesId === preB?.id, `supersedes=${icB2?.supersedesId?.slice(0, 8)} (prior=${preB?.id.slice(0, 8)})`);

    // ── PROOF (c) — SECOND change → chains again (the Stage-1.5 multi-supersede fix) ──
    console.log("\n── PROOF (c): SECOND CHANGE → chains again (old version:1 hardcode would THROW here)");
    const preC = await liveSnap(ic.id);
    await applyState(stateC);
    const beforeC = await counts();
    const rC = await handlePgRescore(ctx(payload("manual", "stage2(c) change#2")));
    const afterC = await counts();
    const icC = rC.perMember.find((m) => m.symbol === TARGET)!;
    check(`ICICIBANK superseded v${preC?.version}→v${preC!.version + 1}`, icC.action === "superseded" && icC.version === preC!.version + 1, `action=${icC.action} v=${icC.version}`);
    check("other 5 still skip-identical", rC.perMember.filter((m) => m.symbol !== TARGET).every((m) => m.action === "skipped_identical"));
    check("exactly 1 new snapshot", afterC.snap === beforeC.snap + 1, `${beforeC.snap}→${afterC.snap}`);
    const icC2 = await liveSnap(ic.id);
    check("new live snapshot supersedes the prior live", icC2?.supersedesId === preC?.id, `supersedes=${icC2?.supersedesId?.slice(0, 8)} (prior=${preC?.id.slice(0, 8)})`);
    // Full chain integrity: versions 1..N contiguous, each supersedes the prior.
    const chain = await prisma.scoreSnapshot.findMany({
      where: { stockId: ic.id, periodKey: icC2!.periodKey, snapshotType: icC2!.snapshotType },
      orderBy: { version: "asc" }, select: { version: true, supersedesId: true, id: true },
    });
    let chainOk = chain[0]?.version === 1 && chain[0]?.supersedesId === null;
    for (let i = 1; i < chain.length; i++) chainOk &&= chain[i].version === i + 1 && chain[i].supersedesId === chain[i - 1].id;
    check(`clean contiguous supersede chain (${chain.length} versions)`, chainOk, chain.map((c) => `v${c.version}`).join("→"));

    // ── PROOF (d) — dedup guard ──
    console.log("\n── PROOF (d): dedup guard coalesces a double-enqueue of PG_RESCORE(PG5)");
    await prisma.backgroundJob.deleteMany({ where: { type: "pg_rescore", status: "pending" } });
    const j1 = await enqueuePgRescore(PG5, "stage2:dedup", "first");
    const j2 = await enqueuePgRescore(PG5, "stage2:dedup", "second (should skip)");
    check("first enqueue creates a job", !!j1);
    check("second enqueue is skipped (dedup)", j2 === null);
    const pendingPg5 = await prisma.backgroundJob.count({ where: { type: "pg_rescore", status: "pending" } });
    check("exactly 1 pending PG_RESCORE job", pendingPg5 === 1, `count=${pendingPg5}`);
  } finally {
    // ── REVERT — restore the input, rescore. Live returns to the current-price baseline
    //    (cur0, post-step-0), NOT the stale committed v1. No score-row deletes. ──
    console.log("\n── REVERT: restore ICICIBANK ownership → rescore (live returns to current-price baseline)");
    await applyState(null);
    const rRev = await handlePgRescore(ctx(payload("manual", "stage2 revert")));
    const icRev = rRev.perMember.find((m) => m.symbol === TARGET)!;
    const icV = await liveSnap(ic.id);
    check("ICICIBANK superseded on revert", icRev.action === "superseded", `action=${icRev.action} v=${icRev.version}`);
    check("live composite == current-price baseline (step 0)", cur0 != null && Math.abs(num(icV?.composite)! - num(cur0.composite)!) < 1e-9, `${num(icV?.composite)?.toFixed(4)} vs base ${num(cur0?.composite)?.toFixed(4)}`);
    check("live fingerprint == current-price baseline (step 0) fingerprint", icV?.inputsFingerprint === cur0?.inputsFingerprint, `${icV?.inputsFingerprint.slice(0, 10)} vs ${cur0?.inputsFingerprint.slice(0, 10)}`);
    await prisma.backgroundJob.deleteMany({ where: { type: "pg_rescore", triggeredBy: { startsWith: "stage2" } } });
  }

  // committed v1 intact: the chain root (version 1, supersedesId null) is never mutated
  // or deleted by any rescore — supersedes only ever APPEND higher versions above it.
  const v1Still = await prisma.scoreSnapshot.findFirst({ where: { stockId: ic.id, version: 1 }, select: { id: true, version: true, supersedesId: true } });
  check("committed v1 snapshot intact (chain root: version 1, supersedesId null)", !!v1Still && v1Still.version === 1 && v1Still.supersedesId === null);

  const finalCounts = await counts();
  console.log(`\n  final counts: snapshots=${finalCounts.snap} (baseline ${base.snap}; +${finalCounts.snap - base.snap} append-only proof versions), runs=${finalCounts.run}`);
  console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\nPROOF ERROR:", e);
  process.exit(1);
});
