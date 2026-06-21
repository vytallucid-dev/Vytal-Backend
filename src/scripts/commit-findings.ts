// COMMIT-FINDINGS — the DURABLE findings write. Attaches the full §5 catalog (R2-R6,
// C1/C2/C3/C-over-time, P1/P4-P8/P10-P13, B/D/G/I/F1/F2/H — dampened) to EVERY existing
// snapshot across the backfilled history, PIT-correct, append-only + idempotent, and
// corrects the 9 legacy R1 "high" rows → "critical" (delete-and-reinsert, user-ratified).
//
// WHY NOT persistMember: the snapshots already exist; persistMember would skip-identical
// (scores unchanged) and write nothing. This attaches findings to the EXISTING head
// snapshots via persistFindings — snapshots are NOT mutated (chain-roots intact); findings
// are NEW rows FK'd to them.
//
// PIT: each historical period scores with pointInTime (≤ quarter-end); FY26Q4 scores LIVE
// (matching how the committed FY26Q4 snapshots were originally scored). The trajectory
// loader / feed / metric cutoffs all already enforce ≤-period reads.
//
// IDEMPOTENT: persistFindings skips an existing (snapshotId, key); a second run writes 0.
// R1: after the first run no "high" rows remain → re-run corrects 0.
//
//   npx tsx src/scripts/commit-findings.ts            (DRY — plan only, writes nothing)
//   npx tsx src/scripts/commit-findings.ts --commit   (DURABLE write)

import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";
import { persistFindings } from "../scoring/findings/persist.js";

const COMMIT = process.argv.includes("--commit");
const PGS: PgRef[] = [
  ["PG1", "Large-Cap IT Services"], ["PG2", "Large-Cap FMCG"], ["PG3", "Large-Cap Pharma"], ["PG4", "Large-Cap Auto OEMs"],
  ["PG5", "Large-Cap Private Banks"], ["PG6", "Large-Cap PSU Banks"], ["PG8", "Large-Cap Power & Utilities"],
  ["PG9", "Large-Cap Metals & Mining"], ["PG10", "Large-Cap Oil & Gas"], ["PG11", "Large-Cap Capital Goods & Industrial"],
  ["PG12", "Large-Cap Cement"], ["PG13", "Large-Cap Consumer Durables & Electrical"], ["PG14", "Large-Cap Defense"],
].map(([pgId, pgName]) => ({ pgId, seedKey: "", pgName }));

const pkOrd = (pk: string) => { const m = /^FY(\d{2})Q([1-4])$/.exec(pk); return m ? Number(m[1]) * 4 + Number(m[2]) : 0; };
function quarterEnd(pk: string): Date {
  const m = /^FY(\d{2})Q([1-4])$/.exec(pk)!; const fy = 2000 + +m[1], q = +m[2];
  return q === 1 ? new Date(Date.UTC(fy - 1, 5, 30)) : q === 2 ? new Date(Date.UTC(fy - 1, 8, 30)) : q === 3 ? new Date(Date.UTC(fy - 1, 11, 31)) : new Date(Date.UTC(fy, 2, 31));
}

/** Delete-and-reinsert the legacy "high" R1 rows as "critical" (preserving FK + payload). */
async function correctR1(): Promise<number> {
  const high = await prisma.redFlag.findMany({ where: { flagKey: "ownership_R1_pledge", severity: "high" } });
  if (!COMMIT) return high.length;
  for (const r of high) {
    await prisma.$transaction(async (tx) => {
      await tx.redFlag.delete({ where: { id: r.id } });
      await tx.redFlag.create({ data: { snapshotId: r.snapshotId, symbol: r.symbol, asOfDate: r.asOfDate, flagKey: r.flagKey, severity: "critical", tier: r.tier, triggeringValues: (r.triggeringValues ?? undefined) as object | undefined, guardrailEventId: r.guardrailEventId } });
    });
  }
  return high.length;
}

async function periodsForPg(pgName: string): Promise<string[]> {
  const pg = await prisma.peerGroup.findFirst({ where: { name: pgName }, include: { stocks: { select: { stockId: true } } } });
  if (!pg) return [];
  const ids = pg.stocks.map((s) => s.stockId);
  const rows = await prisma.scoreSnapshot.findMany({ where: { stockId: { in: ids }, snapshotType: "quarterly" }, select: { periodKey: true }, distinct: ["periodKey"] });
  return rows.map((r) => r.periodKey).filter((pk) => /^FY\d{2}Q[1-4]$/.test(pk)).sort((a, b) => pkOrd(a) - pkOrd(b));
}

async function main() {
  console.log(`════ COMMIT-FINDINGS — ${COMMIT ? "DURABLE WRITE (--commit)" : "DRY (plan only)"} ════`);
  const before = { rf: await prisma.redFlag.count(), pat: await prisma.scorePattern.count() };
  console.log(`  before: score_red_flags=${before.rf}  score_patterns=${before.pat}\n`);

  const r1n = await correctR1();
  console.log(`  R1 "high"→"critical" (delete-reinsert): ${COMMIT ? "corrected" : "would correct"} ${r1n} rows\n`);

  let rf = 0, pat = 0, skip = 0, periods = 0, snapsTouched = 0, errs = 0;
  for (const ref of PGS) {
    const pks = await periodsForPg(ref.pgName);
    let pgRf = 0, pgPat = 0;
    for (const pk of pks) {
      let computed;
      try { computed = await computePgScores(ref, pk === "FY26Q4" ? { withFindings: true } : { withFindings: true, pointInTime: { quarterEnd: quarterEnd(pk), expectPeriodKey: pk } }); }
      catch (e) { errs++; continue; }
      periods++;
      const doWrite = async (tx: any) => {
        for (const m of computed!.members) {
          if (!m.findings?.length) continue;
          const snap = await tx.scoreSnapshot.findFirst({ where: { stockId: m.stockId, snapshotType: "quarterly", periodKey: pk }, orderBy: { version: "desc" }, select: { id: true, asOfDate: true } });
          if (!snap) continue;
          const res = await persistFindings(tx, snap.id, m.symbol, snap.asOfDate, m.findings);
          rf += res.redFlags; pat += res.patterns; skip += res.skippedExisting; pgRf += res.redFlags; pgPat += res.patterns;
          if (res.redFlags + res.patterns > 0) snapsTouched++;
        }
      };
      if (COMMIT) {
        await prisma.$transaction(doWrite, { timeout: 240000, maxWait: 30000 });
      } else {
        // DRY: count would-write (all findings; idempotency skip only matters on re-runs).
        for (const m of computed.members) {
          if (!m.findings?.length) continue;
          const snap = await prisma.scoreSnapshot.findFirst({ where: { stockId: m.stockId, snapshotType: "quarterly", periodKey: pk }, orderBy: { version: "desc" }, select: { id: true } });
          if (!snap) continue;
          for (const f of m.findings) { if (f.kind === "red_flag") { rf++; pgRf++; } else { pat++; pgPat++; } }
          snapsTouched++;
        }
      }
    }
    console.log(`  ${ref.pgId.padEnd(5)} ${pks.length} periods → ${COMMIT ? "wrote" : "would write"} redFlags=${pgRf} patterns=${pgPat}`);
  }

  const after = { rf: await prisma.redFlag.count(), pat: await prisma.scorePattern.count() };
  console.log(`\n  ${COMMIT ? "WROTE" : "WOULD WRITE"}: redFlags=${rf} patterns=${pat}  (skip-existing=${skip})  across ~${snapsTouched} snapshots, ${periods} (PG,period) passes, ${errs} errors`);
  console.log(`  score_red_flags: ${before.rf} → ${after.rf}   score_patterns: ${before.pat} → ${after.pat}${COMMIT ? "" : "  (unchanged — dry)"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
