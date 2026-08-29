// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 11 — POINT-IN-TIME RE-SCORE OF A PERIOD RANGE.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage11-pit-rescore.ts --from FY25Q4 --to FY26Q2            # dry
//   npx tsx src/scripts/stage11-pit-rescore.ts --from FY25Q4 --to FY26Q2 --commit
//
// ── WHY THIS IS NOT backfill-history.ts ──────────────────────────────────────────────────────────
// backfill-history is APPEND-ONLY: it skips any (stock, periodKey) that already exists, which is
// exactly right for filling holes and exactly wrong for correcting a period that was scored against
// data we have since fixed. This one lets persistMember do what it already knows how to do —
// supersede the live row, or skip when the fingerprint is unchanged.
//
// ── WHAT IT IS FOR ───────────────────────────────────────────────────────────────────────────────
// MEASURED: FY25Q4, FY26Q1 and FY26Q2 carry `momentum: unavailable_redistributed` for ~95% of scored
// stocks (90/95, 90/95, 102/107), while the periods on either side are clean. Those snapshots were
// written 2026-06-20, BEFORE the Stage 4-8 quarterly backfills. Recomputing FY25Q4 point-in-time
// today produces real momentum for every member (PG3 Pharma: subtotals 57.99-87.33), so the stored
// rows are simply stale — the data arrived after they were scored, and append-only never revisited
// them.
//
// ⚠ SUPERSEDES, NEVER OVERWRITES. Each corrected period becomes a NEW version chained to the old one,
//   so the stale score remains auditable rather than being silently rewritten.
//
// ⚠ UNSCREENED, LIKE ALL HISTORY. computePgScores is called WITHOUT withGuardrail — matching
//   backfill-history — because a screening seam mid-series reads as real company movement to the
//   trajectory rules. See the screenHistory note in score-pass.ts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  computePgScores, ensureScaffold, finalizeRun, persistMember, requireFindingsEvaluated,
  type MemberWriteResult,
} from "../scoring/composite/score-pass.js";
import { SCORED_PGS } from "./stage10-rescore-all.js";

const COMMIT = process.argv.includes("--commit");
const arg = (f: string): string | null => {
  const i = process.argv.indexOf(f);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].toUpperCase() : null;
};
const FROM = arg("--from") ?? "FY25Q4";
const TO = arg("--to") ?? "FY26Q2";
const ONLY = arg("--only");

const ord = (pk: string): number => { const m = /^FY(\d{2})Q([1-4])$/.exec(pk)!; return Number(m[1]) * 4 + Number(m[2]); };
const label = (o: number): string => `FY${String(Math.floor((o - 1) / 4)).padStart(2, "0")}Q${((o - 1) % 4) + 1}`;

/** Indian FYxxQy → quarter-end (midnight UTC). FY26Q3 → 2025-12-31. */
function quarterEnd(pk: string): Date {
  const m = /^FY(\d{2})Q([1-4])$/.exec(pk);
  if (!m) throw new Error(`bad periodKey ${pk}`);
  const fy = 2000 + Number(m[1]);
  const q = Number(m[2]);
  if (q === 1) return new Date(Date.UTC(fy - 1, 5, 30));
  if (q === 2) return new Date(Date.UTC(fy - 1, 8, 30));
  if (q === 3) return new Date(Date.UTC(fy - 1, 11, 31));
  return new Date(Date.UTC(fy, 2, 31));
}

async function main(): Promise<void> {
  const periods: string[] = [];
  for (let o = ord(FROM); o <= ord(TO); o++) periods.push(label(o));

  console.log(`\n${"=".repeat(104)}`);
  console.log(`STAGE 11 — PIT RE-SCORE ${FROM}..${TO} (${periods.length} period(s))  ${COMMIT ? "*** COMMIT ***" : "(dry)"}`);
  console.log("=".repeat(104));
  const before = await prisma.scoreSnapshot.count();
  console.log(`  score_snapshots before: ${before}\n`);

  let scaffold: Awaited<ReturnType<typeof ensureScaffold>> | null = null;
  if (COMMIT) {
    scaffold = await prisma.$transaction(async (tx) => ensureScaffold(tx as never, new Date(), { runType: "quarterly", triggerType: "post_ingest" }));
    console.log(`  ScoringRun ${scaffold.runId.slice(0, 8)}…\n`);
  }

  let created = 0, identical = 0, noSnap = 0, momFixed = 0;
  const pgs = ONLY ? SCORED_PGS.filter((p) => p.pgId === ONLY) : SCORED_PGS;

  for (const ref of pgs) {
    const per: string[] = [];
    for (const pk of periods) {
      let pg;
      try {
        pg = await computePgScores(ref, { withFindings: true, pointInTime: { quarterEnd: quarterEnd(pk), expectPeriodKey: pk } });
      } catch (e) { per.push(`${pk}:ERR(${(e as Error).message.slice(0, 36)})`); continue; }

      // how many members now have a REAL momentum pillar? that is the thing being repaired
      const withMom = pg.members.filter((m) => {
        const mp = (m as unknown as { mPillar?: { subtotal?: number | null } }).mPillar;
        return mp != null && mp.subtotal != null;
      }).length;
      momFixed += withMom;

      if (!COMMIT) { per.push(`${pk}:${withMom}mom`); continue; }

      const results = await prisma.$transaction(async (tx) => {
        const out: MemberWriteResult[] = [];
        for (const m of requireFindingsEvaluated(pg)) {
          if (m.composite.state !== "scored" || m.composite.composite == null) { out.push({ action: "unavailable_no_snapshot" } as MemberWriteResult); continue; }
          if (!m.own || !m.market) { out.push({ action: "unavailable_no_snapshot" } as MemberWriteResult); continue; }
          out.push(await persistMember(tx as never, m, scaffold!, pg.asOf, pg.peerGroupId, ref.pgId, pg.industry, pg.peerStats));
        }
        return out;
      }, { timeout: 180_000, maxWait: 30_000 });

      const c = results.filter((r) => r.action === "created").length;
      const s = results.filter((r) => r.action === "skipped_identical").length;
      const n = results.filter((r) => r.action === "unavailable_no_snapshot").length;
      created += c; identical += s; noSnap += n;
      per.push(`${pk}:+${c}/=${s}${n ? `/x${n}` : ""}`);
    }
    console.log(`  ${ref.pgId.padEnd(5)} ${ref.pgName.padEnd(44)} ${per.join("  ")}`);
  }

  console.log(`\n  ── SUMMARY ──`);
  if (COMMIT) {
    console.log(`  superseded/created ${created} · identical ${identical} · no-snapshot ${noSnap}`);
    await prisma.$transaction(async (tx) => finalizeRun(tx as never, scaffold!.runId, created, new Date()));
  } else {
    console.log(`  members with a real momentum pillar on recompute: ${momFixed}`);
  }
  const after = await prisma.scoreSnapshot.count();
  console.log(`  score_snapshots: ${before} -> ${after} (+${after - before})`);
  if (!COMMIT) console.log(`\n  dry run — re-run with --commit to supersede.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
