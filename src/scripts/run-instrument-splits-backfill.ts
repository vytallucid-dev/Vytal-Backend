// ─────────────────────────────────────────────────────────────
// STEP 19 — the ONE-TIME ETF split backfill.
//
//   npx tsx src/scripts/run-instrument-splits-backfill.ts [SYMBOL ...]
//
// Sweeps the NSE-listed ETF universe for REAL, DATED unit splits and stores them. This is what lets
// the fold repair the 22 ETFs that are corrupted TODAY. The nightly job
// (daily-etf-corporate-actions) is what stops it happening again.
//
// Idempotent by construction — re-running writes the same rows over themselves.
// ─────────────────────────────────────────────────────────────
import "dotenv/config";
import { ingestInstrumentSplits } from "../ingestions/corporate-events/instrument-splits.js";
import { prisma } from "../db/prisma.js";

const symbols = process.argv.slice(2).filter(Boolean);

console.log("\n═══ ETF SPLIT BACKFILL — real NSE corporate actions only ═══");
if (symbols.length) console.log(`  scoped to: ${symbols.join(", ")}`);

const r = await ingestInstrumentSplits({
  symbols: symbols.length ? symbols : undefined,
  onProgress: async (done, total, label) => {
    if (done % 40 === 0 || done === total) console.log(`  … ${done}/${total}  (${label})`);
  },
});

console.log(`\n  symbols probed     : ${r.symbolsProbed}`);
console.log(`  ETFs WITH a split  : ${r.symbolsWithSplit}`);
console.log(`  split events found : ${r.splitsFound}`);
console.log(`  rows written       : ${r.splitsWritten}`);
console.log(`  RECONCILED         : ${r.reconciled}  (application day resolved to one of the first 4 prints on/after the ex-date → the fold WILL rescale)`);
console.log(`  UNRECONCILED       : ${r.unreconciled}  (we HAD the series; no candidate reconciled → honest refusal → withheld)`);
console.log(`  unresolved by FAULT: ${r.unresolvedByFault}  (we could not READ the series — retryable, NOT a refusal)`);
console.log(`  NSE fetch failures : ${r.fetchFailures}${r.fetchFailures ? "  ⚠️  those ETFs are NOT adjusted" : ""}`);
console.log(`  NAV fetch failures : ${r.seriesFetchFailures}${r.seriesFetchFailures ? "  ⚠️  splits held, prior reconciliation PRESERVED" : ""}`);
console.log(`  duration           : ${(r.durationMs / 1000).toFixed(0)}s`);

console.log("\n═══ WHAT LANDED — ex-date vs the day AMFI ACTUALLY applied it ═══");
const rows = await prisma.$queryRawUnsafe<any[]>(`
  SELECT e.symbol, e.ex_date::text AS ex_date, e.applied_date::text AS applied,
         e.split_factor::int AS factor,
         (e.applied_date - e.ex_date) AS lag_days
  FROM instrument_corporate_events e
  WHERE e.event_type = 'split'
  ORDER BY e.ex_date, e.symbol`);
let unrec = 0;
const byLag = new Map<number, number>();
for (const x of rows) {
  if (x.applied === null) {
    unrec++;
    console.log(`  ${String(x.symbol).padEnd(12)} ex=${x.ex_date} ×${x.factor}   ❌ UNRECONCILED → not adjusted`);
    continue;
  }
  const lag = Number(x.lag_days);
  byLag.set(lag, (byLag.get(lag) ?? 0) + 1);
  const tag = lag === 0 ? "applied ON the ex-date" : `applied ${x.applied}  ← ${lag} calendar day(s) late`;
  console.log(`  ${String(x.symbol).padEnd(12)} ex=${x.ex_date} ×${x.factor}   ${tag}`);
}
console.log(`\n  ${rows.length} split event(s): ${rows.length - unrec} reconciled · ${unrec} unreconciled.`);
console.log("  application lag (calendar days from the NSE ex-date to AMFI's first new-basis NAV):");
for (const lag of [...byLag.keys()].sort((a, b) => a - b)) {
  console.log(`    +${String(lag).padStart(2)}d  ${byLag.get(lag)}`);
}
console.log(`  ⇒ this is exactly why a FIXED boundary rule was wrong: AMFI does not use one.`);

await prisma.$disconnect();
process.exit(r.faults === 0 ? 0 : 1);
