// BACKFILL VERIFICATION (read-only). Counts, per-stock period depth, FY26Q4-untouched
// check, and the exact count query from the task.
import { prisma } from "../db/prisma.js";

async function main() {
  const total = await prisma.scoreSnapshot.count();
  const periods = await prisma.scoreSnapshot.findMany({ distinct: ["periodKey"], select: { periodKey: true } });
  console.log(`score_snapshots total: ${total}`);
  console.log(`distinct periods: ${periods.map((p) => p.periodKey).sort().join(", ")}\n`);

  // ── The task's count query (top 10 stocks by snapshot count) ──
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT symbol, COUNT(*)::int AS n, array_agg(DISTINCT period_key ORDER BY period_key) AS periods
     FROM score_snapshots GROUP BY symbol ORDER BY 2 DESC LIMIT 10;`,
  );
  console.log("=== top 10 stocks by snapshot count ===");
  for (const r of rows) console.log(`  ${r.symbol.padEnd(12)} ${String(r.n).padStart(2)}  [${r.periods.join(", ")}]`);

  // ── periods-per-stock distribution ──
  const grp = await prisma.scoreSnapshot.groupBy({ by: ["symbol"], _count: true });
  const counts = grp.map((g) => g._count).sort((a, b) => a - b);
  const sum = counts.reduce((a, b) => a + b, 0);
  const median = counts.length % 2 ? counts[(counts.length - 1) / 2] : (counts[counts.length / 2 - 1] + counts[counts.length / 2]) / 2;
  console.log(`\n=== periods per stock (${grp.length} stocks) ===`);
  console.log(`  min=${counts[0]} median=${median} max=${counts[counts.length - 1]} mean=${(sum / counts.length).toFixed(1)} totalSnapshots=${sum}`);
  const hist = new Map<number, number>();
  for (const c of counts) hist.set(c, (hist.get(c) ?? 0) + 1);
  console.log(`  histogram (snaps→#stocks): ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join("  ")}`);

  // stocks with only 1 snapshot (FY26Q4 only — couldn't backfill any history)
  const onlyOne = grp.filter((g) => g._count === 1).map((g) => g.symbol).sort();
  console.log(`  stocks with ONLY FY26Q4 (no history backfilled): ${onlyOne.length ? onlyOne.join(", ") : "none"}`);

  // ── FY26Q4 untouched: all FY26Q4 rows must be version 1, supersedesId null ──
  const q4 = await prisma.scoreSnapshot.findMany({ where: { periodKey: "FY26Q4" }, select: { version: true, supersedesId: true } });
  const q4Bad = q4.filter((r) => r.version !== 1 || r.supersedesId !== null);
  console.log(`\n=== FY26Q4 integrity ===`);
  console.log(`  FY26Q4 rows: ${q4.length} | all version 1 & no supersede: ${q4Bad.length === 0 ? "YES ✓ (untouched)" : `NO ✗ (${q4Bad.length} altered)`}`);

  // ── all backfilled rows are version 1 ──
  const vDist = await prisma.scoreSnapshot.groupBy({ by: ["version"], _count: true });
  console.log(`  version distribution: ${vDist.map((v) => `v${v.version}:${v._count}`).join("  ")}`);

  // ── ScoringRuns ──
  const runs = await prisma.scoringRun.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, status: true, stocksScored: true, createdAt: true } });
  console.log(`\n=== recent ScoringRuns ===`);
  for (const r of runs) console.log(`  ${r.id.slice(0, 8)}… status=${r.status} stocksScored=${r.stocksScored} at=${r.createdAt.toISOString().slice(0, 19)}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
