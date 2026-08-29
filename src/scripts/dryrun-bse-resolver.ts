// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// S6.2a2 — RE-RESOLVE EVERY ACTIVE STOCK AGAINST BSE, AND NAME EVERY MISS.
//
// ⚠ THE UNRESOLVED SET IS A FIRST-CLASS OUTPUT. The JBCHEPHARM miss was silent: one stock happened
//   to be named by a probe and the resolver's 4,977-row master was never questioned. At cohort scale
//   a silent miss just looks like a stock with no BSE data. This script prints every one.
//
//   npx tsx src/scripts/dryrun-bse-resolver.ts
//
// READ-ONLY. One network call (the scrip master) plus one database read.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { BsePacer } from "../ingestions/quaterly-results/bse/bse-http.js";
import { fetchScripMaster, resolveAgainstMaster } from "../ingestions/quaterly-results/bse/bse-resolver.js";

const pacer = new BsePacer({ minSpacingMs: 1500 });

const stocks = await prisma.stock.findMany({
  where: { isActive: true },
  select: { symbol: true, isin: true, industryType: true, name: true },
  orderBy: { symbol: "asc" },
});
console.log(`active stocks in the universe: ${stocks.length}`);

const master = await fetchScripMaster(pacer);
const report = resolveAgainstMaster(stocks, master);

console.log(`\nBSE scrip master: ${report.masterSize} rows`);
console.log(`  status distribution: ${JSON.stringify(report.statusCounts)}`);
console.log(
  `\nRESOLVED   ${report.resolved.length} / ${stocks.length}  (${((100 * report.resolved.length) / stocks.length).toFixed(1)}%)`,
);

const byStatus: Record<string, number> = {};
for (const r of report.resolved) byStatus[r.bseStatus] = (byStatus[r.bseStatus] ?? 0) + 1;
console.log(`  resolved stocks by BSE status flag: ${JSON.stringify(byStatus)}`);
console.log(`  ⚠ status is ADVISORY — never used to include or exclude. See bse-resolver.ts.`);

const nonActive = report.resolved.filter((r) => r.bseStatus !== "Active");
if (nonActive.length) {
  console.log(`\n  ${nonActive.length} stock(s) resolved ONLY because we do not filter on status:`);
  for (const r of nonActive) {
    console.log(`     ${r.symbol.padEnd(14)} ${r.scripCode}  ${r.scripName}  [BSE says: ${r.bseStatus}]`);
  }
}

const ambiguous = report.resolved.filter((r) => r.ambiguous);
if (ambiguous.length) {
  console.log(`\n  ${ambiguous.length} stock(s) whose ISIN maps to more than one scrip (tie-broken deterministically):`);
  for (const r of ambiguous) console.log(`     ${r.symbol.padEnd(14)} -> ${r.scripCode} ${r.scripName} [${r.bseStatus}]`);
}

console.log(`\nUNRESOLVED ${report.unresolved.length} — NAMED IN FULL:`);
if (report.unresolved.length === 0) {
  console.log("  (none)");
} else {
  const bySymbol = new Map(stocks.map((s) => [s.symbol, s]));
  for (const u of report.unresolved) {
    const s = bySymbol.get(u.symbol);
    console.log(`  ${u.symbol.padEnd(14)} ${u.isin}  ${s?.industryType ?? "?"}  ${s?.name ?? ""}  — ${u.reason}`);
  }
}

// S6.2a3 — the three names from the Stage-5 probe, checked explicitly.
console.log("\nS6.2a3 — the three Stage-5 misses, re-checked:");
for (const sym of ["BSE", "CDSL", "JBCHEPHARM"]) {
  const hit = report.resolved.find((r) => r.symbol === sym);
  const miss = report.unresolved.find((u) => u.symbol === sym);
  if (hit) console.log(`  ${sym.padEnd(12)} RESOLVES -> ${hit.scripCode} ${hit.scripName} [BSE status: ${hit.bseStatus}]`);
  else if (miss) console.log(`  ${sym.padEnd(12)} genuinely absent from all ${report.masterSize} BSE equity rows — NSE-only listing`);
  else console.log(`  ${sym.padEnd(12)} not in the active universe`);
}

await prisma.$disconnect();
