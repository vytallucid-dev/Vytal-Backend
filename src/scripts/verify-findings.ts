// VERIFY-FINDINGS — post-commit checks: R1 high→critical, the finding distribution, and the
// UI-surface spot-check (a stock's §5 set now reads real findings off its snapshot).
//   npx tsx src/scripts/verify-findings.ts

import { prisma } from "../db/prisma.js";

async function main() {
  console.log("════ VERIFY FINDINGS (post durable write) ════\n");

  // ── R1 high→critical ──
  const r1 = await prisma.redFlag.groupBy({ by: ["severity"], where: { flagKey: "ownership_R1_pledge" }, _count: { _all: true } });
  console.log("R1 by severity:", JSON.stringify(r1.map((x) => ({ sev: x.severity, n: x._count._all }))));
  const r1high = r1.find((x) => x.severity === "high")?._count._all ?? 0;
  console.log(`  R1 "high" remaining (must be 0): ${r1high} ${r1high === 0 ? "✅" : "❌"}`);

  // ── totals + distribution ──
  const rf = await prisma.redFlag.count(), pat = await prisma.scorePattern.count();
  console.log(`\nscore_red_flags=${rf}  score_patterns=${pat}`);
  const rfByKey = await prisma.redFlag.groupBy({ by: ["flagKey"], _count: { _all: true } });
  console.log("  red flags by key:", rfByKey.map((x) => `${x.flagKey}:${x._count._all}`).join("  "));
  const patByKey = await prisma.scorePattern.groupBy({ by: ["patternKey"], _count: { _all: true } });
  console.log("  patterns by key:");
  for (const x of patByKey.sort((a, b) => b._count._all - a._count._all)) console.log(`     ${x.patternKey.padEnd(42)} ${x._count._all}`);
  const dampened = await prisma.scorePattern.count({ where: { displayState: "dampened" } });
  const byState = await prisma.scorePattern.groupBy({ by: ["displayState"], _count: { _all: true } });
  console.log(`  pattern displayState: ${byState.map((x) => `${x.displayState}:${x._count._all}`).join(", ")}  (dampened=${dampened})`);

  // ── UI-surface spot-check: a stock's §5 set off its FY26Q4 head snapshot ──
  console.log("\n── UI-surface spot-check (the read layer reads these off the snapshot) ──");
  for (const sym of ["GLENMARK", "DIXON", "ASHOKLEY", "HCLTECH"]) {
    const snap = await prisma.scoreSnapshot.findFirst({ where: { symbol: sym, snapshotType: "quarterly", periodKey: "FY26Q4" }, orderBy: { version: "desc" }, select: { id: true, composite: true, labelBand: true, redFlags: { select: { flagKey: true, severity: true } }, patterns: { select: { patternKey: true, severity: true, magnitude: true, displayState: true } } } });
    if (!snap) { console.log(`  ${sym}: no snapshot`); continue; }
    const n = snap.redFlags.length + snap.patterns.length;
    console.log(`  ${sym} (${Number(snap.composite).toFixed(1)}/${snap.labelBand}) — ${n} findings: ${[...snap.redFlags.map((r) => `${r.flagKey.replace(/^[a-z]+_/, "")}(${r.severity})`), ...snap.patterns.map((p) => p.patternKey.replace(/^[a-z]+_/, "") + (p.magnitude != null ? `[${p.magnitude}]` : "") + (p.displayState !== "active" ? `{${p.displayState}}` : ""))].join(", ") || "(none — empty/calm)"}`);
  }

  // ── history depth: findings exist across periods (not just FY26Q4) ──
  const byPeriod = await prisma.scorePattern.groupBy({ by: ["asOfDate"], _count: { _all: true } });
  console.log(`\n  patterns span ${byPeriod.length} distinct as-of dates (trajectory history populated)`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
