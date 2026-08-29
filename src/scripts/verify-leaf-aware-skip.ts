// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ A LEAF MOVE DEFEATS THE SKIP; AN UNCHANGED STOCK STILL SKIPS — driven live, then ROLLED BACK.
//
//   npx tsx src/scripts/verify-leaf-aware-skip.ts [--pgs 3]
//
// ⚠ EVERYTHING RUNS INSIDE INTERACTIVE TRANSACTIONS THAT ALWAYS THROW AT THE END. Row counts are
//   re-read afterwards and compared, so "it rolled back" is measured, not asserted.
//
// ── THE TWO THINGS BEING PROVED ──────────────────────────────────────────────────────────────────
//  A. UNCHANGED STILL SKIPS. The skip-identical guard is what makes the daily rescore cheap and the
//     brief was explicit that breaking it is worse than the problem. So the skip rate is MEASURED,
//     not assumed, and reported per peer group.
//
//  B. A LEAF MOVE IS NO LONGER SKIPPABLE. The ideal stimulus is a raw value that moves a metric leaf
//     while leaving the pillar subtotal identical at 4dp. Constructing one from real data means
//     searching for offsetting metric moves, which is a hunt with no guarantee of a hit and no
//     bearing on what is being tested.
//
//     ⚠ SO THE STIMULUS IS SUBSTITUTED, DELIBERATELY, AND HERE IS WHY IT IS EQUIVALENT. The new gate
//       reads exactly five stored hashes and compares them to five recomputed ones. "A leaf moved"
//       reaches that gate ONLY as "the stored pillar fingerprint differs from the recomputed one".
//       Perturbing the STORED pillar fingerprint produces a byte-identical situation at the decision
//       point, while leaving the composite fingerprint untouched — which is precisely the case that
//       used to skip. What it does not prove is that some raw edit can produce that state; that is a
//       property of the metric algebra, argued in the score-pass comment, not of this gate.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  computePgScores, ensureScaffold, persistMember, requireFindingsEvaluated,
  type MemberWriteResult,
} from "../scoring/composite/score-pass.js";
import { SCORED_PGS } from "./stage10-rescore-all.js";

class Rollback extends Error {}
let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  if (ok) { console.log(`  ok    ${label}${detail ? `  — ${detail}` : ""}`); return; }
  failures++;
  console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
}
const arg = (f: string): string | null => {
  const i = process.argv.indexOf(f);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const N_PGS = Number(arg("--pgs") ?? 3);

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`VERIFY — leaf-aware skip, live then rolled back`);
  console.log("=".repeat(100));

  // ⚠ ROLLBACK IS VERIFIED BY ATTRIBUTION, NOT BY A GLOBAL ROW COUNT. A global count said this
  //   script leaked 94 rows; it had not. A DEPLOYED daily rescore writes to this same database at
  //   13:30 IST — MEASURED: 13 post_ingest runs at that hour on 2026-08-20, 21, 24, 25 and 26 — and
  //   it happened to fire mid-run. Counting rows a concurrent writer also creates cannot answer
  //   "did MY transaction commit". Tracking my own runIds can.
  const myRunIds: string[] = [];
  const sample = SCORED_PGS.slice(0, N_PGS);
  console.log(`\n  sample: ${sample.length} of ${SCORED_PGS.length} scored peer groups (--pgs to widen)\n`);

  let totChanged = 0, totUnchanged = 0, totNoSnap = 0;
  let s2Changed = 0, s2Unchanged = 0;
  let leafProofDone = false;

  for (const ref of sample) {
    const pg = await computePgScores(ref, { withFindings: true });
    try {
      await prisma.$transaction(async (tx) => {
        const sc = await ensureScaffold(tx as never, new Date(), { runType: "quarterly", triggerType: "manual_api" });
        myRunIds.push(sc.runId);

        // ── A. baseline pass: nothing in the raw data changed, so everything must skip ────────
        const out: MemberWriteResult[] = [];
        for (const m of requireFindingsEvaluated(pg)) {
          if (m.composite.state !== "scored" || m.composite.composite == null || !m.own || !m.market) {
            out.push({ action: "unavailable_no_snapshot" } as MemberWriteResult); continue;
          }
          out.push(await persistMember(tx as never, m, sc, pg.asOf, pg.peerGroupId, ref.pgId, pg.industry, pg.peerStats));
        }
        const changed = out.filter((r) => r.action === "created").length;
        const unchanged = out.filter((r) => r.action === "skipped_identical").length;
        const noSnap = out.filter((r) => r.action === "unavailable_no_snapshot").length;
        totChanged += changed; totUnchanged += unchanged; totNoSnap += noSnap;
        console.log(`  ${ref.pgId.padEnd(5)} ${ref.pgName.slice(0, 40).padEnd(40)} pass1 changed ${String(changed).padStart(3)} · unchanged ${String(unchanged).padStart(3)} · no-snap ${String(noSnap).padStart(3)}`);

        // ── A2. STEADY STATE. Pass 1 catches up whatever was stale; pass 2 immediately re-persists
        //    the SAME computed members against the heads pass 1 just wrote. Nothing about the inputs
        //    changed between them, so anything other than a near-total skip would mean the guard had
        //    been broken. Pass 1's rate answers "what does the one-time catch-up cost"; only pass 2
        //    answers "what does this cost every day", which is the question that was asked.
        for (const m of requireFindingsEvaluated(pg)) {
          if (m.composite.state !== "scored" || m.composite.composite == null || !m.own || !m.market) continue;
          const r2 = await persistMember(tx as never, m, sc, pg.asOf, pg.peerGroupId, ref.pgId, pg.industry, pg.peerStats);
          if (r2.action === "created") s2Changed++; else if (r2.action === "skipped_identical") s2Unchanged++;
        }

        // ── B. leaf proof, once: perturb a STORED pillar fingerprint and re-persist ───────────
        if (!leafProofDone) {
          const target = requireFindingsEvaluated(pg).find((m) =>
            m.composite.state === "scored" && m.composite.composite != null && m.own && m.market);
          if (target) {
            const live = (await tx.$queryRawUnsafe<Array<{ id: string; fpid: string; snap_fp: string; v: number }>>(
              `SELECT id, foundation_pillar_id fpid, inputs_fingerprint snap_fp, version v FROM score_snapshots
                WHERE stock_id=$1 AND snapshot_type::text=$2 AND period_key=$3 ORDER BY version DESC LIMIT 1`,
              target.stockId, target.composite.snapshotType, target.composite.periodKey))[0];
            if (live) {
              // move ONLY the stored leaf hash; the composite hash stays byte-identical
              await tx.$executeRawUnsafe(
                `UPDATE score_pillars SET inputs_fingerprint = $2 WHERE id = $1`,
                live.fpid, `LEAFMOVED-${live.fpid.slice(0, 20)}`);
              const after = await persistMember(tx as never, target, sc, pg.asOf, pg.peerGroupId, ref.pgId, pg.industry, pg.peerStats);
              const snapNow = (await tx.$queryRawUnsafe<Array<{ snap_fp: string }>>(
                `SELECT inputs_fingerprint snap_fp FROM score_snapshots WHERE id=$1`, live.id))[0];
              console.log("");
              check(snapNow.snap_fp === live.snap_fp,
                `leaf proof (${target.symbol} ${target.composite.periodKey}): the COMPOSITE fingerprint is unchanged`,
                "so the old guard would have skipped");
              check(after.action === "created",
                "with only a metric leaf moved, the pass RECOMPUTES instead of skipping",
                `action=${after.action}`);
              check(after.version === live.v + 1 && after.superseded === true,
                "the recompute supersedes rather than mutating (append-only chain intact)",
                `v${live.v} -> v${after.version}`);
              leafProofDone = true;
            }
          }
        }
        throw new Rollback("done");
      }, { timeout: 600_000, maxWait: 60_000 });
    } catch (e) {
      if (!(e instanceof Rollback)) { console.error(`\n  UNEXPECTED on ${ref.pgId}: ${String(e).slice(0, 700)}`); failures++; }
    }
  }

  // ── the numbers the brief asked to be measured, not assumed ─────────────────────────────────
  const evaluated = totChanged + totUnchanged;
  const s2Eval = s2Changed + s2Unchanged;
  console.log(`\n  ── COST (sample of ${sample.length} PGs) ──`);
  console.log(`  pass 1 (catch-up)     evaluated ${evaluated} · unchanged ${totUnchanged} · changed ${totChanged} · no-snapshot ${totNoSnap}`);
  console.log(`                        skip rate ${evaluated ? ((totUnchanged / evaluated) * 100).toFixed(1) : "—"}%`);
  console.log(`  pass 2 (steady state) evaluated ${s2Eval} · unchanged ${s2Unchanged} · changed ${s2Changed}`);
  console.log(`                        skip rate ${s2Eval ? ((s2Unchanged / s2Eval) * 100).toFixed(1) : "—"}%`);
  check(s2Eval > 0 && s2Unchanged === s2Eval,
    "STEADY STATE: with nothing changed, every member skips — the guard is intact",
    `${s2Unchanged}/${s2Eval}`);
  check(leafProofDone, "the leaf-move branch was actually exercised");

  console.log("");
  const leaked = myRunIds.length
    ? (await prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int n FROM score_snapshots WHERE run_id = ANY($1::text[])`, myRunIds))[0].n
    : 0;
  const runsLeft = myRunIds.length
    ? (await prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int n FROM score_runs WHERE id = ANY($1::text[])`, myRunIds))[0].n
    : 0;
  check(leaked === 0 && runsLeft === 0,
    `after rollback: none of this run's ${myRunIds.length} ScoringRun(s) or their snapshots survive`,
    `snapshots=${leaked} runs=${runsLeft}`);

  console.log(`\n${"=".repeat(100)}`);
  console.log(failures === 0 ? "  ALL CHECKS PASS — nothing was written" : `  ${failures} CHECK(S) FAILED`);
  console.log("=".repeat(100) + "\n");
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
