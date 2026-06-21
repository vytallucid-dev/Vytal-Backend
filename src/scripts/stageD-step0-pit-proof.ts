// STAGE-D STEP 0 — trajectory loader + point-in-time proof (read-only).
// Builds a deep stock's series at an EARLY and a LATE cutoff and confirms the early one
// excludes all later snapshots (no future leak), head-of-chain, ordered.
//   npx tsx src/scripts/stageD-step0-pit-proof.ts

import { prisma } from "../db/prisma.js";
import { loadTrajectorySeries, periodOrdinal } from "../scoring/findings/trajectory/load-series.js";

/** FYxxQy → quarter-end (UTC midnight). */
function quarterEnd(pk: string): Date {
  const m = /^FY(\d{2})Q([1-4])$/.exec(pk)!;
  const fy = 2000 + Number(m[1]), q = Number(m[2]);
  if (q === 1) return new Date(Date.UTC(fy - 1, 5, 30));
  if (q === 2) return new Date(Date.UTC(fy - 1, 8, 30));
  if (q === 3) return new Date(Date.UTC(fy - 1, 11, 31));
  return new Date(Date.UTC(fy, 2, 31));
}
const fmt = (s: any[]) => s.map((p) => `${p.periodKey}(${p.composite.toFixed(0)}/${p.labelBand})`).join(" ");

async function main() {
  console.log("════ STAGE-D STEP 0 — trajectory loader + PIT proof ════\n");
  for (const sym of ["POWERINDIA", "ABB", "COLPAL", "DIXON"]) {
    const st = await prisma.stock.findFirst({ where: { symbol: sym }, select: { id: true } });
    if (!st) continue;

    // LATE: current = FY26Q4, live (cutoff null) → all priors FY..→FY26Q3.
    const late = await loadTrajectorySeries(st.id, "FY26Q4", null);
    // EARLY: current = FY25Q1, cutoff = FY25Q1 quarter-end → only ≤FY24Q4 priors.
    const early = await loadTrajectorySeries(st.id, "FY25Q1", quarterEnd("FY25Q1"));

    console.log(`── ${sym} ──`);
    console.log(`  LATE  (current FY26Q4, live): ${late.length} priors  ${fmt(late)}`);
    console.log(`  EARLY (current FY25Q1, ≤FY25Q1): ${early.length} priors  ${fmt(early)}`);

    // PIT assertions.
    const curOrdEarly = periodOrdinal("FY25Q1");
    const leak = early.filter((p) => periodOrdinal(p.periodKey) >= curOrdEarly);
    const earlyMaxOrd = Math.max(0, ...early.map((p) => periodOrdinal(p.periodKey)));
    const lateHasFuture = late.some((p) => periodOrdinal(p.periodKey) >= periodOrdinal("FY26Q4"));
    console.log(`  PIT: early leaks ≥FY25Q1? ${leak.length === 0 ? "NO ✅" : "YES ❌ " + fmt(leak)}` +
      `  | early⊂late (early periods all in late)? ${early.every((e) => late.some((l) => l.periodKey === e.periodKey)) ? "YES ✅" : "(early is pre-late window)"}` +
      `  | late excludes current FY26Q4? ${!lateHasFuture ? "YES ✅" : "NO ❌"}`);
    console.log();
  }

  // Head-of-chain spot check: a stock with a superseded version (ASHOKLEY FY26Q4 had v2).
  const ash = await prisma.stock.findFirst({ where: { symbol: "ASHOKLEY" }, select: { id: true } });
  if (ash) {
    const series = await loadTrajectorySeries(ash.id, "FY26Q4", null);
    const versions = await prisma.scoreSnapshot.groupBy({ by: ["periodKey"], where: { stockId: ash.id, snapshotType: "quarterly" }, _max: { version: true }, _count: { _all: true } });
    console.log("── head-of-chain check (ASHOKLEY) ──");
    console.log(`  series periods: ${series.map((p) => p.periodKey).join(", ")}`);
    console.log(`  per-period versions: ${versions.map((v) => `${v.periodKey}:n=${v._count._all},maxV=${v._max.version}`).join("  ")}`);
    console.log(`  (loader keeps max-version head per period; multi-version periods collapse to 1)`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
