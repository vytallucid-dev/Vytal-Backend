// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 10a — RESCORE EVERY SCORED PEER GROUP AT THE LIVE PERIOD.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage10-rescore-all.ts             # dry: compute + report, writes nothing
//   npx tsx src/scripts/stage10-rescore-all.ts --commit
//   npx tsx src/scripts/stage10-rescore-all.ts --only PG3
//
// ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
// Stages 1-9 wrote several hundred result rows, filled shareholding gaps, and corrected two defects
// that feed the scorer (the fiscal-year label that made decrementFY throw, and the intra-quarter
// ownership rows that damped promoter deltas for 27 stocks). Rescoring was deliberately deferred the
// whole time. Nothing downstream has recomputed against any of it.
//
// ── THIS IS THE HANDLER'S PATH, NOT A REIMPLEMENTATION ───────────────────────────────────────────
// Step for step it mirrors jobs/handlers/pg-rescore.handler.ts — compute with findings + guardrail,
// fingerprint pre-check against the LIVE (highest-version) snapshot, then one transaction per PG
// doing ensureScaffold → persistMember → finalizeRun. Versioning and supersession stay entirely
// inside persistMember, which is the only thing that knows how to chain them.
//
// ⚠ THE FINGERPRINT PRE-CHECK IS WHAT MAKES THIS SAFE TO RUN. A PG whose inputs did not move writes
//   NOTHING — no snapshots, no ScoringRun. Re-running is therefore free, and a rescore that finds
//   nothing is reported as a no-op rather than quietly creating a duplicate version of every row.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  computePgScores, ensureScaffold, finalizeRun, persistMember, requireFindingsEvaluated,
  type PgRef, type MemberWriteResult,
} from "../scoring/composite/score-pass.js";
import { snapshotInputsFingerprint } from "../scoring/composite/persist.js";

const COMMIT = process.argv.includes("--commit");
const ONLY = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;

/** The 13 peer groups that carry scores. Kept in one place with backfill-history.ts. */
export const SCORED_PGS: PgRef[] = [
  { pgId: "PG1", seedKey: "pg1_it_services", pgName: "Large-Cap IT Services" },
  { pgId: "PG2", seedKey: "pg2_fmcg", pgName: "Large-Cap FMCG" },
  { pgId: "PG3", seedKey: "pg3_pharma", pgName: "Large-Cap Pharma" },
  { pgId: "PG4", seedKey: "pg4_auto_oem", pgName: "Large-Cap Auto OEMs" },
  { pgId: "PG5", seedKey: "pg5_private_banks", pgName: "Large-Cap Private Banks" },
  { pgId: "PG6", seedKey: "pg6_psu_banks", pgName: "Large-Cap PSU Banks" },
  { pgId: "PG8", seedKey: "pg8_power", pgName: "Large-Cap Power & Utilities" },
  { pgId: "PG9", seedKey: "pg9_metals", pgName: "Large-Cap Metals & Mining" },
  { pgId: "PG10", seedKey: "pg10_oil_gas", pgName: "Large-Cap Oil & Gas" },
  { pgId: "PG11", seedKey: "pg11_capital_goods", pgName: "Large-Cap Capital Goods & Industrial" },
  { pgId: "PG12", seedKey: "pg12_cement", pgName: "Large-Cap Cement" },
  { pgId: "PG13", seedKey: "pg13_consumer_durables", pgName: "Large-Cap Consumer Durables & Electrical" },
  { pgId: "PG14", seedKey: "pg14_defense", pgName: "Large-Cap Defense" },
];

const f = (v: number | null | undefined, d = 1): string => (v == null ? "—" : v.toFixed(d));

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`STAGE 10a — LIVE RESCORE  ${COMMIT ? "*** COMMIT ***" : "(dry — computes and reports, writes nothing)"}`);
  console.log("=".repeat(104));

  const before = await prisma.scoreSnapshot.count();
  console.log(`  score_snapshots before: ${before}\n`);

  const pgs = ONLY ? SCORED_PGS.filter((p) => p.pgId === ONLY) : SCORED_PGS;
  let totalCreated = 0, totalSkipped = 0, totalNoSnap = 0, pgsChanged = 0, pgsNoop = 0;
  const moved: Array<{ sym: string; pg: string; from: number | null; to: number | null; band: string }> = [];

  for (const ref of pgs) {
    let pg;
    try {
      pg = await computePgScores(ref, { withFindings: true, withGuardrail: true });
    } catch (e) {
      console.log(`  ${ref.pgId.padEnd(5)} ${ref.pgName.padEnd(44)} COMPUTE FAILED: ${(e as Error).message.slice(0, 90)}`);
      continue;
    }

    // ── the pre-check: would ANY member actually write? ─────────────────────────────────────────
    const liveByStock = new Map<string, { version: number; composite: number | null }>();
    let anyChange = false;
    for (const m of pg.members) {
      if (m.composite.state !== "scored" || m.composite.composite === null) continue;
      const live = await prisma.scoreSnapshot.findFirst({
        where: { stockId: m.stockId, snapshotType: m.composite.snapshotType, periodKey: m.composite.periodKey },
        orderBy: { version: "desc" },
        select: { version: true, inputsFingerprint: true, composite: true },
      });
      if (live) liveByStock.set(m.stockId, { version: live.version, composite: live.composite === null ? null : Number(live.composite) });
      if (!live || live.inputsFingerprint !== snapshotInputsFingerprint(m.composite)) anyChange = true;
    }

    const scored = pg.members.filter((m) => m.composite.state === "scored" && m.composite.composite !== null);
    if (!anyChange) {
      pgsNoop++;
      totalSkipped += scored.length;
      console.log(`  ${ref.pgId.padEnd(5)} ${ref.pgName.padEnd(44)} no-op — ${scored.length} member(s) identical`);
      continue;
    }
    pgsChanged++;

    // record what moved, for the report
    for (const m of scored) {
      const prev = liveByStock.get(m.stockId);
      const to = m.composite.composite;
      if (!prev || prev.composite === null || Math.abs((prev.composite ?? 0) - (to ?? 0)) > 0.05)
        moved.push({ sym: m.symbol, pg: ref.pgId, from: prev?.composite ?? null, to, band: String(m.composite.labelBand) });
    }

    if (!COMMIT) {
      console.log(`  ${ref.pgId.padEnd(5)} ${ref.pgName.padEnd(44)} WOULD WRITE — ${scored.length} scored member(s)`);
      totalCreated += scored.length;
      continue;
    }

    const { results } = await prisma.$transaction(async (tx) => {
      const scaffold = await ensureScaffold(tx as never, pg.asOf, { runType: "quarterly", triggerType: "post_ingest" });
      const out: MemberWriteResult[] = [];
      for (const m of requireFindingsEvaluated(pg))
        out.push(await persistMember(tx as never, m, scaffold, pg.asOf, pg.peerGroupId, ref.pgId,
          pg.industry, pg.peerStats, { writeGuardrail: true, guardrail: pg.guardrail }));
      const createdN = out.filter((r) => r.action === "created").length;
      await finalizeRun(tx as never, scaffold.runId, createdN, new Date());
      return { results: out, runId: scaffold.runId };
    }, { timeout: 180_000, maxWait: 30_000 });

    const created = results.filter((r) => r.action === "created").length;
    const skipped = results.filter((r) => r.action === "skipped_identical").length;
    const noSnap = results.filter((r) => r.action === "unavailable_no_snapshot").length;
    totalCreated += created; totalSkipped += skipped; totalNoSnap += noSnap;
    console.log(`  ${ref.pgId.padEnd(5)} ${ref.pgName.padEnd(44)} created ${String(created).padStart(2)} · identical ${String(skipped).padStart(2)} · no-snapshot ${noSnap}`);
  }

  console.log(`\n  ── SUMMARY ──`);
  console.log(`  peer groups: ${pgsChanged} changed · ${pgsNoop} no-op`);
  console.log(`  members: ${COMMIT ? "created" : "would create"} ${totalCreated} · identical ${totalSkipped} · no-snapshot ${totalNoSnap}`);
  const after = await prisma.scoreSnapshot.count();
  console.log(`  score_snapshots: ${before} -> ${after} (+${after - before})`);

  if (moved.length) {
    console.log(`\n  ── COMPOSITES THAT MOVED (${moved.length}) ──`);
    for (const m of moved.sort((a, b) => Math.abs((b.to ?? 0) - (b.from ?? 0)) - Math.abs((a.to ?? 0) - (a.from ?? 0))).slice(0, 25))
      console.log(`     ${m.sym.padEnd(13)} ${m.pg.padEnd(5)} ${f(m.from)} -> ${f(m.to)}  (${m.band})`);
  } else console.log(`\n  no composite moved by more than 0.05.`);

  if (!COMMIT) console.log(`\n  dry run — re-run with --commit to write.\n`);
  await prisma.$disconnect();
}
// ⚠ ENTRY GUARD — this module EXPORTS `SCORED_PGS`, so importing it must not score anything.
//   Without this, `import { SCORED_PGS } from "./stage10-rescore-all.js"` ran a full LIVE rescore as
//   a side effect of reading a constant: two passes then interleaved, corrupting each other's
//   transaction context ("Transaction not found ... refers to an old closed transaction").
//   A module that both exports something and runs on import is a trap for its next caller.
if (process.argv[1]?.includes("stage10-rescore-all"))
  main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
