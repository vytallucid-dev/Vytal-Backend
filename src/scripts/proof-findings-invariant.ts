// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PROOF — THE SNAPSHOT-HAS-FINDINGS INVARIANT, EXERCISED AGAINST THE REAL DB, THEN ROLLED BACK.
//
// verify-findings-invariant.ts asserts the STATE the guards produce. This proves the GUARDS
// THEMSELVES bite, by trying to break each one and showing it refuses:
//
//   ① TYPE     — requireFindingsEvaluated() throws on a pass computed without withFindings.
//                (The compile-time half cannot be proven at runtime; it is proven by the fact that
//                 `persistMember(db, pg.members[0], …)` does not typecheck — tsc is the gate.)
//   ② RUNTIME  — persistMember refuses a member whose stamp was produced against a DIFFERENT
//                composite, so a stamp cannot be inherited by a version it did not evaluate.
//   ③ STORAGE  — score_snapshots_findings_evaluated_ck rejects an INSERT with a NULL witness, even
//                one issued in raw SQL that never touches persistMember at all.
//
// And it proves the HAPPY PATH: a real supersede writes its findings + not-covered rows onto the NEW
// version, with the witness stamped — the thing that was silently not happening.
//
// Everything runs inside ONE transaction that is ROLLED BACK. Zero residue; asserted at the end.
//
//   npx tsx src/scripts/proof-findings-invariant.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import {
  computePgScores, ensureScaffold, persistMember, requireFindingsEvaluated,
  SnapshotFindingsNotEvaluatedError, type EvaluatedMember, type PgRef,
} from "../scoring/composite/score-pass.js";
import { snapshotInputsFingerprint } from "../scoring/composite/persist.js";

const PG: PgRef = { pgId: "PG14", seedKey: "pg14_defense", pgName: "Large-Cap Defense" };
class Rollback extends Error {}

const checks: { name: string; ok: boolean; detail: string }[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

async function main() {
  console.log("════ PROOF — SNAPSHOT-HAS-FINDINGS INVARIANT (write → assert → ROLL BACK) ════\n");
  const before = {
    snap: await prisma.scoreSnapshot.count(),
    pat: await prisma.scorePattern.count(),
    rf: await prisma.redFlag.count(),
  };
  console.log(`  baseline: snapshots=${before.snap} patterns=${before.pat} red_flags=${before.rf}\n`);

  // ── COST MEASUREMENT (Part 5) — the same PG, with and without the findings hook ────────────────
  // ⚠ WALL-CLOCK HERE IS LATENCY-DOMINATED: this runs against a remote pooled Postgres over the
  //   public internet (~80 ms/round-trip measured), not from inside the worker's network. The
  //   MACHINE-INDEPENDENT number is the added ROUND-TRIP COUNT, reported alongside.
  let t = Date.now();
  const bare = await computePgScores(PG);
  const bareMs = Date.now() - t;
  t = Date.now();
  const pg = await computePgScores(PG, { withFindings: true, withGuardrail: true });
  const withMs = Date.now() - t;
  const n = pg.members.length;

  // Isolate the two DB loaders the hook adds, so the delta can be split into I/O vs rule CPU.
  const { loadTrajectorySeries } = await import("../scoring/findings/trajectory/load-series.js");
  const { loadBandTypicalProfiles } = await import("../scoring/findings/composition/band-typical.js");
  t = Date.now(); await loadBandTypicalProfiles(null); const btMs = Date.now() - t;
  t = Date.now();
  for (const m of pg.members) await loadTrajectorySeries(m.stockId, pg.periodKey, null);
  const trajMs = Date.now() - t;

  console.log(`  COST — ${PG.pgId} (${n} members)`);
  console.log(`    compute WITHOUT findings : ${bareMs} ms`);
  console.log(`    compute WITH findings    : ${withMs} ms   (delta ${withMs - bareMs} ms, ${((withMs - bareMs) / n).toFixed(0)} ms/member)`);
  console.log(`      of which band-typical  : ${btMs} ms (1 query/PG, scans every in-force head)`);
  console.log(`      of which trajectory    : ${trajMs} ms (1 query/member = ${n}; ${(trajMs / n).toFixed(0)} ms each)`);
  console.log(`      of which rule CPU      : ~${Math.max(0, withMs - bareMs - btMs - trajMs)} ms (no I/O)`);
  console.log(`    added DB round-trips     : 1 band-typical + 1 sector-class + 1 regime per PG, 1 trajectory per member = ${3 + n}`);
  console.log(`    added WRITES per created snapshot: 2 per fired finding + 2 per not-covered row (SELECT-then-INSERT)\n`);
  add("(0) the findings hook is what distinguishes the two passes",
    bare.members.every((m) => !m.findingsEval) && pg.members.every((m) => !!m.findingsEval),
    `bare: 0/${bare.members.length} stamped · withFindings: ${pg.members.filter((m) => m.findingsEval).length}/${n} stamped`);

  // ── ① THE NARROWING GATE REFUSES AN UNEVALUATED PASS ───────────────────────────────────────────
  let gateThrew = "";
  try { requireFindingsEvaluated(bare); }
  catch (e) { gateThrew = e instanceof SnapshotFindingsNotEvaluatedError ? "SnapshotFindingsNotEvaluatedError" : `WRONG TYPE: ${(e as Error).name}`; }
  add("① requireFindingsEvaluated throws on a pass computed without withFindings",
    gateThrew === "SnapshotFindingsNotEvaluatedError",
    gateThrew || "DID NOT THROW — the gate is not enforcing");

  let rolledBack = false;
  try {
    await prisma.$transaction(async (tx) => {
      const sc = await ensureScaffold(tx as never, pg.asOf, { runType: "quarterly", triggerType: "manual_api" });
      const members = requireFindingsEvaluated(pg).filter((m) => m.composite.state === "scored" && m.own && m.market);

      // ── FORCING A GENUINE SUPERSEDE ───────────────────────────────────────────────────────────
      // Run as-is, every member is skip-identical (nothing moved since the last rescore) and the
      // create path — the one that broke — is never reached. So we synthesise the exact event the
      // daily pass produces: a composite that moved. Nudging the composite changes the snapshot
      // fingerprint, which is precisely what a price move does, and drives persistMember down the
      // supersede branch. The fired set is the REAL one this pass evaluated; only the number moved.
      //
      // `restamp` re-derives the evaluation's fingerprint with the SAME helper the hook uses, i.e.
      // it models a genuine re-evaluation of the moved composite. `moveOnly` deliberately does NOT
      // — that is the stale stamp the runtime assertion has to catch.
      const moveOnly = (m: EvaluatedMember, by: number): EvaluatedMember =>
        ({ ...m, composite: { ...m.composite, composite: (m.composite.composite ?? 0) + by } });
      const restamp = (m: EvaluatedMember): EvaluatedMember =>
        ({ ...m, findingsEval: { ...m.findingsEval, inputsFingerprint: snapshotInputsFingerprint(m.composite) } });

      // ── HAPPY PATH: persist every member; findings land on the version just created ────────────
      const written: { m: EvaluatedMember; snapshotId: string | null; action: string }[] = [];
      for (const m of members.slice(0, members.length - 1)) {
        const moved = restamp(moveOnly(m, 0.17));
        const r = await persistMember(tx as never, moved, sc, pg.asOf, pg.peerGroupId, PG.pgId, pg.industry, pg.peerStats, { writeGuardrail: true, guardrail: pg.guardrail });
        written.push({ m: moved, snapshotId: r.snapshotId, action: r.action });
      }
      const created = written.filter((w) => w.action === "created");
      console.log(`  wrote (in-tx): ${created.length} created (superseded), ${written.length - created.length} skip-identical\n`);

      // Every CREATED snapshot must carry the witness, and its counts must match its own rows.
      const rows = await tx.scoreSnapshot.findMany({
        where: { id: { in: created.map((c) => c.snapshotId!).filter(Boolean) } },
        select: { id: true, symbol: true, version: true, findingsEvaluatedAt: true, findingsFiredCount: true, notCoveredCount: true },
      });
      add("② every snapshot this pass created carries the evaluation witness",
        rows.length > 0 && rows.every((r) => r.findingsEvaluatedAt !== null),
        `${rows.filter((r) => r.findingsEvaluatedAt !== null).length}/${rows.length} stamped`);

      let rowsOnNewVersion = 0, expected = 0;
      for (const c of created) {
        const pats = await tx.scorePattern.count({ where: { snapshotId: c.snapshotId! } });
        rowsOnNewVersion += pats;
        expected += (c.m.findings?.filter((f) => f.kind === "pattern").length ?? 0) + (c.m.notCoveredWriteRows?.length ?? 0);
      }
      add("② findings + not-covered rows are attached to the NEW version, not the superseded one",
        created.length > 0 && rowsOnNewVersion === expected,
        `${rowsOnNewVersion} pattern rows on the ${created.length} new head(s); expected ${expected}`);

      // A supersede must not leave the new head emptier than the one it replaced.
      const supersededEmpty: string[] = [];
      for (const c of created) {
        const snap = await tx.scoreSnapshot.findUnique({ where: { id: c.snapshotId! }, select: { supersedesId: true, symbol: true } });
        if (!snap?.supersedesId) continue;
        const prior = await tx.scorePattern.count({ where: { snapshotId: snap.supersedesId } });
        const now = await tx.scorePattern.count({ where: { snapshotId: c.snapshotId! } });
        if (prior > 0 && now === 0) supersededEmpty.push(`${snap.symbol} ${prior}→0`);
      }
      add("② no supersede produced a head that lost every pattern its predecessor had (the GLENMARK failure)",
        supersededEmpty.length === 0,
        supersededEmpty.length ? supersededEmpty.join(", ") : `${created.filter(Boolean).length} created head(s) checked`);

      // ── ② THE RUNTIME ASSERTION: a stamp from a DIFFERENT composite is refused ─────────────────
      // The held-back member, moved but NOT re-evaluated. This is the defect in miniature: findings
      // that belong to the previous version, riding along onto a new one. It must not be writable.
      const victim = moveOnly(members[members.length - 1], 0.17);
      let staleThrew = "";
      try { await persistMember(tx as never, victim, sc, pg.asOf, pg.peerGroupId, PG.pgId, pg.industry, pg.peerStats); }
      catch (e) { staleThrew = e instanceof SnapshotFindingsNotEvaluatedError ? "SnapshotFindingsNotEvaluatedError" : `WRONG TYPE: ${(e as Error).name}: ${(e as Error).message.slice(0, 70)}`; }
      add("② persistMember refuses a stamp produced against a DIFFERENT composite version",
        staleThrew === "SnapshotFindingsNotEvaluatedError",
        staleThrew || "DID NOT THROW — the version tie-in is not enforcing");

      // ── ③ THE STORAGE GUARD: raw SQL that bypasses persistMember entirely ─────────────────────
      // Clone a just-written row at an unused version with the witness NULLed. Nothing in the app
      // could issue this; a future write path that forgot the evaluation would.
      let ckRejected = created.length ? "" : "NO CREATED SNAPSHOT TO CLONE — check inconclusive";
      const src = created[0]?.snapshotId;
      if (src) {
        try {
          await tx.$executeRawUnsafe(`
            INSERT INTO score_snapshots (
              id, stock_id, symbol, snapshot_type, period_key, as_of_date, run_id, spec_version_id,
              version, supersedes_id, peer_group_id, bar_path, industry_path, composite, label_band,
              band_mapping_version_id, foundation_pillar_id, momentum_pillar_id, market_pillar_id,
              ownership_pillar_id, foundation_subtotal, momentum_subtotal, market_subtotal,
              ownership_subtotal, w_foundation, w_momentum, w_market, w_ownership,
              weight_redistribution_reason, divergence, inputs_fingerprint, findings_evaluated_at)
            SELECT gen_random_uuid()::text, stock_id, symbol, snapshot_type, period_key, as_of_date,
              run_id, spec_version_id, version + 5000, NULL, peer_group_id, bar_path, industry_path,
              composite, label_band, band_mapping_version_id, foundation_pillar_id, momentum_pillar_id,
              market_pillar_id, ownership_pillar_id, foundation_subtotal, momentum_subtotal,
              market_subtotal, ownership_subtotal, w_foundation, w_momentum, w_market, w_ownership,
              weight_redistribution_reason, divergence, inputs_fingerprint, NULL
            FROM score_snapshots WHERE id = $1`, src);
          ckRejected = "";
        } catch (e) {
          const msg = (e as Error).message;
          ckRejected = /findings_evaluated_ck/.test(msg) ? "rejected by score_snapshots_findings_evaluated_ck" : `OTHER ERROR: ${msg.slice(0, 90)}`;
        }
      }
      add("③ a raw INSERT with a NULL witness is rejected by the database, bypassing the app entirely",
        ckRejected === "rejected by score_snapshots_findings_evaluated_ck",
        ckRejected || "INSERT SUCCEEDED — the CHECK constraint is not enforcing");

      throw new Rollback();
    }, { timeout: 300_000, maxWait: 30_000 });
  } catch (e) {
    if (e instanceof Rollback) rolledBack = true;
    else throw e;
  }

  const after = { snap: await prisma.scoreSnapshot.count(), pat: await prisma.scorePattern.count(), rf: await prisma.redFlag.count() };
  add("(6) ROLLED BACK — zero residue",
    rolledBack && JSON.stringify(after) === JSON.stringify(before),
    `rolledBack=${rolledBack}; ${JSON.stringify(after)} == ${JSON.stringify(before)}`);

  console.log("\nCHECKS:");
  for (const c of checks) console.log(`  ${c.ok ? "✓ PASS" : "✗ FAIL"}  ${c.name}\n           ${c.detail}`);
  const allPass = checks.every((c) => c.ok);
  console.log(`\n  ${allPass ? "✓ ALL THREE GUARDS BITE. A snapshot cannot be committed without its findings." : "✗ A GUARD DID NOT HOLD."}`);
  await prisma.$disconnect();
  if (!allPass) process.exitCode = 1;
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
