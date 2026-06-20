// BACKFILL peer statistics (μ/σ/N) for EXISTING score snapshots that were written
// before the write path persisted them. APPEND-ONLY + IDEMPOTENT.
//
// APPROACH (recommended — see task Step 2):
//   • COMPUTE from the already-stored member raw values (NOT a re-run of the engine):
//     for each (PG, period, metric) we take every in-force MetricScore.rawValue whose
//     scoreState='scored' AND includedInPeerStats=true and feed it to the SAME
//     computePeerStats() the scorer uses. This reproduces EXACTLY the distribution that
//     produced the committed l2Scores — zero drift, point-in-time perfect (it uses the
//     exact values that were point-in-time when scored). The §5.3.1 anchor-lift is
//     recomputed from the stored l1Scores via the same decideLift531().
//   • LINK append-only: we WRITE new score_peer_stats rows; we DO NOT touch existing
//     MetricScore rows (setting their FK would be an in-place update → forbidden in this
//     append-only layer). The read assembler resolves these by natural key
//     (peerGroupId, asOfDate, metricKey) when the MetricScore FK is null. New scores
//     (write-path fix) carry the FK directly.
//
// SUPPRESSION SEAM (Step 0 invariant): a peer-excluded value is excluded from μ/σ
// because we filter on includedInPeerStats=true — the exact flag the scorer sets from
// the SuppressionDirective. A suppressed metric (own-excluded) has no row at all
// (row-absence), so it is naturally absent from the aggregation.
//
//   npx tsx src/scripts/backfill-peer-stats.ts                         (DRY, all PG/period)
//   npx tsx src/scripts/backfill-peer-stats.ts --pg PG11 --period FY26Q4   (DRY, one slice)
//   npx tsx src/scripts/backfill-peer-stats.ts --commit                (WRITES)

import { prisma } from "../db/prisma.js";
import { computePeerStats, decideLift531 } from "../scoring/metric-scoring/peer-stats.js";

const COMMIT = process.argv.includes("--commit");
const argOf = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const ONLY_PG = argOf("--pg"); // barPath, e.g. "PG11"
const ONLY_PERIOD = argOf("--period"); // e.g. "FY26Q4"
const SHOW = Number(argOf("--show") ?? "8");

const num = (d: any): number => (d == null ? 0 : typeof d.toNumber === "function" ? d.toNumber() : Number(d));
const ymd = (d: Date) => d.toISOString().slice(0, 10);

interface MsRow { metricKey: string; rawValue: number; l1Score: number | null; includedInPeerStats: boolean; pillar: string }

async function main() {
  console.log(`PEER-STATS BACKFILL — compute-from-stored, append-only — ${COMMIT ? "REAL WRITE (--commit)" : "DRY (no --commit)"}`);
  if (ONLY_PG || ONLY_PERIOD) console.log(`  filter: ${ONLY_PG ? `PG=${ONLY_PG} ` : ""}${ONLY_PERIOD ? `period=${ONLY_PERIOD}` : ""}`);
  const before = await prisma.peerStatsSnapshot.count();
  console.log(`  pre-backfill score_peer_stats rows: ${before}\n`);

  // All committed snapshots (optionally filtered). Reduce to in-force (max version per
  // stock+period), then group by (peerGroupId, periodKey).
  const snaps = await prisma.scoreSnapshot.findMany({
    where: { ...(ONLY_PG ? { barPath: ONLY_PG } : {}), ...(ONLY_PERIOD ? { periodKey: ONLY_PERIOD } : {}) },
    select: { id: true, stockId: true, symbol: true, peerGroupId: true, barPath: true, periodKey: true, version: true, asOfDate: true, runId: true, foundationPillarId: true, momentumPillarId: true },
  });

  // in-force: highest version per (stockId, periodKey)
  const inForce = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) {
    const k = `${s.stockId}|${s.periodKey}`;
    const cur = inForce.get(k);
    if (!cur || s.version > cur.version) inForce.set(k, s);
  }

  // group by (peerGroupId, periodKey)
  const groups = new Map<string, (typeof snaps)[number][]>();
  for (const s of inForce.values()) {
    const k = `${s.peerGroupId}|${s.periodKey}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }

  let totalWouldWrite = 0, totalExisting = 0, groupCount = 0;
  const sortedKeys = [...groups.keys()].sort();

  for (const gk of sortedKeys) {
    const members = groups.get(gk)!;
    const ref = members[0];
    const peerGroupId = ref.peerGroupId;
    const barPath = ref.barPath;
    const periodKey = ref.periodKey;
    // asOfDate / runId for the identity: all members of a (PG, period) share asOfDate;
    // runId is the period's run. Use the in-force ref's (and note if non-uniform).
    const asOfDate = ref.asOfDate;
    const runId = ref.runId;
    const mixedRun = members.some((m) => m.runId !== runId);
    const mixedAsOf = members.some((m) => ymd(m.asOfDate) !== ymd(asOfDate));

    // Load all foundation+momentum MetricScores for these members in one query.
    const pillarIds = members.flatMap((m) => [m.foundationPillarId, m.momentumPillarId]);
    const ms = (await prisma.metricScore.findMany({
      where: { pillarScoreId: { in: pillarIds }, scoreState: "scored" },
      select: { metricKey: true, rawValue: true, l1Score: true, includedInPeerStats: true, pillar: true },
    })).map((r): MsRow => ({ metricKey: r.metricKey, rawValue: num(r.rawValue), l1Score: r.l1Score == null ? null : num(r.l1Score), includedInPeerStats: r.includedInPeerStats, pillar: r.pillar }));

    // aggregate per metricKey over includedInPeerStats=true (the suppression seam)
    const byKey = new Map<string, { vals: number[]; l1s: number[]; pillar: string }>();
    for (const r of ms) {
      if (!r.includedInPeerStats) continue;
      const e = byKey.get(r.metricKey) ?? { vals: [], l1s: [], pillar: r.pillar };
      e.vals.push(r.rawValue);
      if (r.l1Score != null) e.l1s.push(r.l1Score);
      byKey.set(r.metricKey, e);
    }

    const rows = [...byKey.entries()].map(([metricKey, e]) => {
      const ps = computePeerStats(e.vals);
      const lift = decideLift531(e.l1s);
      return { metricKey, pillar: e.pillar, mean: ps.mean, stdDev: ps.stdDev, sampleN: ps.sampleN, anchorLiftFired: lift.fired };
    }).sort((a, b) => a.metricKey.localeCompare(b.metricKey));

    groupCount++;
    // count existing vs to-write (idempotency)
    let existingHere = 0, toWrite = 0;
    for (const row of rows) {
      const exists = await prisma.peerStatsSnapshot.findFirst({ where: { peerGroupId, metricKey: row.metricKey, runId, asOfDate }, select: { id: true } });
      if (exists) existingHere++; else toWrite++;
    }
    totalExisting += existingHere; totalWouldWrite += toWrite;

    const flags = `${mixedRun ? " ⚠mixed-runId" : ""}${mixedAsOf ? " ⚠mixed-asOf" : ""}`;
    console.log(`  ${barPath.padEnd(5)} ${periodKey}  members:${members.length}  metrics:${rows.length}  asOf:${ymd(asOfDate)}  run:${runId.slice(0, 8)}…  write:${toWrite} exist:${existingHere}${flags}`);

    // show μ/σ/N for the first SHOW metrics (dry insight)
    if (ONLY_PG || ONLY_PERIOD || groupCount <= 1) {
      for (const row of rows.slice(0, SHOW))
        console.log(`        ${row.metricKey.padEnd(8)} [${row.pillar.slice(0, 4)}]  μ=${row.mean.toFixed(3)}  σ=${row.stdDev.toFixed(3)}  N=${row.sampleN}  lift531=${row.anchorLiftFired}`);
    }

    if (COMMIT && toWrite > 0) {
      await prisma.$transaction(async (tx) => {
        for (const row of rows) {
          const exists = await tx.peerStatsSnapshot.findFirst({ where: { peerGroupId, metricKey: row.metricKey, runId, asOfDate }, select: { id: true } });
          if (exists) continue;
          await tx.peerStatsSnapshot.create({
            data: {
              peerGroupId, barPath, metricKey: row.metricKey, runId, asOfDate,
              mean: row.mean, stdDev: row.stdDev, sampleN: row.sampleN,
              anchorLiftFired: row.anchorLiftFired, anchorLiftRule: row.anchorLiftFired ? "rule_5_3_1" : null,
            },
          });
        }
      }, { timeout: 120000, maxWait: 20000 });
    }
  }

  const after = await prisma.peerStatsSnapshot.count();
  console.log(`\n  groups (PG×period): ${groupCount}`);
  console.log(`  ${COMMIT ? "WROTE" : "WOULD WRITE"}: ${totalWouldWrite} peer-stats rows | already-present: ${totalExisting}`);
  console.log(`  score_peer_stats: ${before} → ${after}${COMMIT ? "" : " (unchanged — dry)"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
