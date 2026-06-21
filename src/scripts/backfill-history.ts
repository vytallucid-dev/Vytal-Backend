// BACKFILL — score ALL scoreable historical quarters for every stock, POINT-IN-TIME
// correct, append-only + idempotent, under ONE ScoringRun. Mirrors the validated
// FY26Q4 commit path (computePgScores → persistMember) but drives each historical
// period through the engine's point-in-time context (ComputeOpts.pointInTime): every
// raw input is restricted to reportDate/date ≤ the period's quarter-end, so no future
// data leaks backward. Bars are the current committed calibration (resolved at "now")
// — the model/bars are NOT changed (only the raw inputs are point-in-time).
//
// SAFETY:
//   • FY26Q4 is EXCLUDED from targets and any already-existing (stock, periodKey) is
//     SKIPPED before persist — the live FY26Q4 snapshots are never touched/superseded.
//   • Each backfilled snapshot is version 1 for its (stock, snapshotType, periodKey).
//   • Re-running is a no-op (existing periods skipped).
//   • Max depth per stock: each PG is scored at every distinct standalone quarter its
//     members have (banks go deep; thin non-fin stocks naturally get fewer).
//
//   npx tsx src/scripts/backfill-history.ts            (DRY — lists plan, writes nothing)
//   npx tsx src/scripts/backfill-history.ts --commit   (writes)

import { prisma } from "../db/prisma.js";
import { computePgScores, ensureScaffold, finalizeRun, persistMember, type PgRef, type MemberWriteResult } from "../scoring/composite/score-pass.js";

const COMMIT = process.argv.includes("--commit");
// --resume reuses the most recent ScoringRun (keeps the whole backfill under ONE run
// when an earlier attempt committed some PGs before stopping). Already-written periods
// are skipped, so resuming only fills the gaps.
const RESUME = process.argv.includes("--resume");

const NONFIN_PGS: PgRef[] = [
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
const BANK_PGS: PgRef[] = [
  { pgId: "PG5", seedKey: "pg5_private_banks", pgName: "Large-Cap Private Banks" },
  { pgId: "PG6", seedKey: "pg6_psu_banks", pgName: "Large-Cap PSU Banks" },
];
const BANK_IDS = new Set(["PG5", "PG6"]);
const EXCLUDE_PERIODS = new Set(["FY26Q4"]); // already committed live — never re-score

/** Indian FYxxQy → quarter-end Date (midnight UTC). FY26Q3 → 2025-12-31. */
function quarterEnd(periodKey: string): Date {
  const m = /^FY(\d{2})Q([1-4])$/.exec(periodKey);
  if (!m) throw new Error(`bad periodKey ${periodKey}`);
  const fy = 2000 + Number(m[1]);
  const q = Number(m[2]);
  if (q === 1) return new Date(Date.UTC(fy - 1, 5, 30));
  if (q === 2) return new Date(Date.UTC(fy - 1, 8, 30));
  if (q === 3) return new Date(Date.UTC(fy - 1, 11, 31));
  return new Date(Date.UTC(fy, 2, 31));
}
const pkOrdinal = (pk: string) => { const m = /^FY(\d{2})Q([1-4])$/.exec(pk)!; return Number(m[1]) * 4 + Number(m[2]); };

/** Distinct standalone quarterly periods across a PG's CURRENT roster members,
 *  oldest→newest, minus the excluded (live) periods. Max-depth target list. */
async function pgTargetPeriods(pgName: string, banking: boolean): Promise<string[]> {
  const pg = await prisma.peerGroup.findFirst({ where: { name: pgName }, include: { stocks: { select: { stockId: true } } } });
  if (!pg) return [];
  const ids = pg.stocks.map((s) => s.stockId);
  const rows = banking
    ? await prisma.bankingQuarterlyResult.findMany({ where: { stockId: { in: ids }, resultType: "standalone" }, select: { fiscalYear: true, quarter: true } })
    : await prisma.quarterlyResult.findMany({ where: { stockId: { in: ids }, resultType: "standalone" }, select: { fiscalYear: true, quarter: true } });
  const set = new Set<string>();
  for (const r of rows) { const pk = `${r.fiscalYear}${r.quarter}`; if (/^FY\d{2}Q[1-4]$/.test(pk) && !EXCLUDE_PERIODS.has(pk)) set.add(pk); }
  return [...set].sort((a, b) => pkOrdinal(a) - pkOrdinal(b));
}

const f = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));

async function main() {
  console.log(`HISTORICAL BACKFILL — point-in-time, append-only, max-depth — ${COMMIT ? "REAL WRITE (--commit)" : "DRY (no --commit)"}\n`);
  const beforeSnap = await prisma.scoreSnapshot.count();
  console.log(`  pre-backfill score_snapshots: ${beforeSnap}\n`);

  // ONE ScoringRun for the whole backfill (provenance). Created only in commit mode.
  // --resume reuses the latest run (to continue a partially-committed backfill).
  let scaffold: { specVersionId: string; runId: string; bandMappingVersionId: string } | null = null;
  if (COMMIT && RESUME) {
    const run = await prisma.scoringRun.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true, specVersionId: true } });
    const bm = await prisma.bandMappingVersion.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
    if (!run || !bm) throw new Error("--resume: no existing ScoringRun / BandMappingVersion to reuse");
    scaffold = { runId: run.id, specVersionId: run.specVersionId, bandMappingVersionId: bm.id };
    console.log(`  RESUMING ScoringRun ${scaffold.runId.slice(0, 8)}…  spec ${scaffold.specVersionId.slice(0, 8)}…\n`);
  } else if (COMMIT) {
    scaffold = await prisma.$transaction(async (tx) => ensureScaffold(tx as any, new Date()));
    console.log(`  ScoringRun ${scaffold.runId.slice(0, 8)}…  spec ${scaffold.specVersionId.slice(0, 8)}…\n`);
  }

  let totalCreated = 0, totalSkippedExisting = 0, totalNoSnap = 0, totalR1 = 0;
  const allPgs = [...NONFIN_PGS, ...BANK_PGS];

  for (const ref of allPgs) {
    const banking = BANK_IDS.has(ref.pgId);
    const periods = await pgTargetPeriods(ref.pgName, banking);
    if (!periods.length) { console.log(`  ${ref.pgId.padEnd(5)} no historical periods`); continue; }
    let pgCreated = 0, pgSkip = 0, pgNoSnap = 0;
    const perPeriod: string[] = [];

    for (const pk of periods) {
      const qe = quarterEnd(pk);
      let computed;
      try {
        computed = await computePgScores(ref, { withFindings: true, pointInTime: { quarterEnd: qe, expectPeriodKey: pk } });
      } catch (e) {
        perPeriod.push(`${pk}:ERR(${(e as Error).message.slice(0, 40)})`);
        continue;
      }

      const writeOne = async (tx: any) => {
        const out: { action: string; r1: boolean; composite: number | null }[] = [];
        for (const m of computed.members) {
          // SKIP any already-existing (stock, periodKey) — protects FY26Q4 & re-runs (append-only).
          const exists = await tx.scoreSnapshot.findFirst({ where: { stockId: m.stockId, snapshotType: "quarterly", periodKey: pk }, select: { id: true } });
          if (exists) { out.push({ action: "skipped_existing", r1: false, composite: null }); continue; }
          if (m.composite.state !== "scored" || m.composite.composite == null) { out.push({ action: "no_snapshot", r1: false, composite: null }); continue; }
          // A snapshot needs an Ownership pillar (and a Market pillar) row — both FKs are
          // NOT NULL. Point-in-time, a member may have NO shareholding (or no Market result)
          // as-of P (its history is shallower than its financials). That period genuinely
          // can't be persisted with a real Ownership pillar → record as no_snapshot, never
          // fabricate one. (persistMember would otherwise throw and abort the PG.)
          if (!m.own || !m.market) { out.push({ action: "no_snapshot", r1: false, composite: null }); continue; }
          const res: MemberWriteResult = await persistMember(tx, m, scaffold!, computed.asOf, computed.peerGroupId, ref.pgId, computed.industry, computed.peerStats, { writeFindings: true });
          out.push({ action: res.action, r1: res.r1Written, composite: res.composite });
        }
        return out;
      };

      let res: { action: string; r1: boolean; composite: number | null }[];
      if (COMMIT) {
        res = await prisma.$transaction(writeOne, { timeout: 180000, maxWait: 30000 });
      } else {
        // DRY: count what WOULD be written (no tx, read-only existence check via prisma).
        res = [];
        for (const m of computed.members) {
          const exists = await prisma.scoreSnapshot.findFirst({ where: { stockId: m.stockId, snapshotType: "quarterly", periodKey: pk }, select: { id: true } });
          if (exists) res.push({ action: "skipped_existing", r1: false, composite: null });
          else if (m.composite.state !== "scored" || m.composite.composite == null) res.push({ action: "no_snapshot", r1: false, composite: null });
          else if (!m.own || !m.market) res.push({ action: "no_snapshot", r1: false, composite: null });
          else res.push({ action: "would_create", r1: false, composite: m.composite.composite });
        }
      }

      const created = res.filter((r) => r.action === "created" || r.action === "would_create");
      pgCreated += created.length;
      pgSkip += res.filter((r) => r.action === "skipped_existing").length;
      pgNoSnap += res.filter((r) => r.action === "no_snapshot").length;
      totalR1 += res.filter((r) => r.r1).length;
      const comps = created.map((r) => r.composite!).filter((x) => x != null);
      perPeriod.push(`${pk}:${created.length}${comps.length ? `(${f(Math.min(...comps))}–${f(Math.max(...comps))})` : ""}`);
    }

    totalCreated += pgCreated; totalSkippedExisting += pgSkip; totalNoSnap += pgNoSnap;
    console.log(`  ${ref.pgId.padEnd(5)} ${banking ? "[bank]" : "      "} ${`+${pgCreated}`.padEnd(6)} skip:${String(pgSkip).padEnd(4)} no-snap:${String(pgNoSnap).padEnd(4)} | ${perPeriod.join("  ")}`);
  }

  if (scaffold) {
    // stocksScored = ALL snapshots owned by this run (incl. any committed in an earlier
    // attempt being resumed), not just this pass's new rows.
    const ownedByRun = await prisma.scoreSnapshot.count({ where: { runId: scaffold.runId } });
    await prisma.$transaction(async (tx) => finalizeRun(tx as any, scaffold!.runId, ownedByRun, new Date()));
  }

  const afterSnap = await prisma.scoreSnapshot.count();
  console.log(`\n  ${COMMIT ? "CREATED" : "WOULD CREATE"}: ${totalCreated} historical snapshots`);
  console.log(`  skipped-existing: ${totalSkippedExisting} | no-snapshot (composite unavailable): ${totalNoSnap} | R1 flags: ${totalR1}`);
  console.log(`  score_snapshots: ${beforeSnap} → ${afterSnap}${COMMIT ? "" : " (unchanged — dry)"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
