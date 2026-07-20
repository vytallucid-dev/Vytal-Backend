// Run the nightly analytics fold once (MF + ETF, Step 10/11 + 13), and print what it did.
//   npx tsx src/scripts/run-mf-analytics.ts [windowDays]
//
// `windowDays` exists ONLY for a throttled AMFI. It changes nothing about the result — the windows
// just partition the same 5-year range into smaller REQUESTS. A 90-day window is ~59 MB, which at
// AMFI's clamped 0.09 MB/s needs ~655 s and blows the 600 s per-window cap; a 30-day window is
// ~20 MB (~220 s) and gets through. Same bytes, same rows, same numbers — it simply stops asking
// for more than one request can carry. Omit it for production.
import "dotenv/config";
import { runMfAnalytics } from "../ingestions/amfi/mf-analytics.js";
import { prisma } from "../db/prisma.js";

const windowDays = process.argv[2] ? Number(process.argv[2]) : undefined;
if (windowDays !== undefined && (!Number.isInteger(windowDays) || windowDays < 5 || windowDays > 90)) {
  console.error(`windowDays must be an integer in 5–90 (got ${process.argv[2]})`);
  process.exit(2);
}
if (windowDays) console.log(`\n[throttle mode] ${windowDays}-day windows — same data, smaller requests.`);

// LIVE PROGRESS. A 4-hour all-or-nothing job that prints nothing until it exits is a black box —
// you cannot tell a run that is 80% done from one that died an hour ago. Each line is flushed as it
// happens, so `tail -f` on the log is an honest progress bar with a real ETA.
const t0 = Date.now();
let doneBytes = 0;

const r = await runMfAnalytics({
  ...(windowDays ? { windowDays } : {}),
  onWindow: (p) => {
    if (p.phase === "retry") {
      console.log(
        `  ⚠️  [${p.index}/${p.total}] ${p.from}→${p.to}  attempt ${p.attempt} FAILED (${p.error}) — retrying`,
      );
      return;
    }
    if (p.phase === "done") {
      doneBytes += p.bytes ?? 0;
      const secs = (p.ms ?? 0) / 1000;
      const mbps = (p.bytes ?? 0) / 1e6 / Math.max(secs, 0.001);
      const elapsed = (Date.now() - t0) / 1000;
      const perWindow = elapsed / p.index;
      const etaMin = ((p.total - p.index) * perWindow) / 60;
      console.log(
        `  ✓ [${p.index}/${p.total}] ${p.from}→${p.to}  ` +
          `${((p.bytes ?? 0) / 1e6).toFixed(1)} MB in ${secs.toFixed(0)}s (${mbps.toFixed(2)} MB/s)  ` +
          `· total ${(doneBytes / 1e6).toFixed(0)} MB · elapsed ${(elapsed / 60).toFixed(0)}m · ETA ~${etaMin.toFixed(0)}m`,
      );
    }
  },
});

console.log("\n═══ ANALYTICS FOLD (mutual_fund + etf) ═══");
console.log(`  ok                 : ${r.ok}${r.abortReason ? `  (${r.abortReason})` : ""}`);
console.log(`  as-of date         : ${r.asOfDate}`);
console.log(`  windows / bytes    : ${r.windows} / ${(r.bytes / 1e6).toFixed(0)} MB`);
console.log(`  rows folded        : ${r.rowsFolded.toLocaleString()}`);
console.log(`  schemes folded     : ${r.schemesFolded.toLocaleString()}`);
console.log(`  analytics written  : ${r.analyticsWritten.toLocaleString()}`);
console.log(`  ranked             : ${r.ranked.toLocaleString()}`);
console.log(`  risk-free          : ${r.riskFreeIndex} (covers ${r.riskFreeCovers.join(", ") || "nothing"})`);
console.log(`── GROUP-3 (benchmark-relative) ──`);
console.log(`  benchmark series   : ${r.benchmarkIndices} loaded from index_prices (READ-ONLY — nothing pulled, nothing written)`);
console.log(`  schemes benchmarked: ${r.benchmarked}   ·   with a 1Y beta: ${r.betaComputed}`);
console.log(`  unpaired returns   : ${r.unpairedReturns.toLocaleString()}   (fund moves the benchmark could not be honestly aligned to — REFUSED, never zero-filled)`);
console.log(`── STEP 19 (raw AMFI NAV is neither split-adjusted nor total-return) ──`);
console.log(`  split-adjusted     : ${r.splitAdjusted} schemes rescaled from REAL, dated NSE corporate actions`);
console.log(`                       (${r.navsRescaled.toLocaleString()} NAV points divided by a cumulative split factor)`);
console.log(`  IDCW inherited     : ${r.idcwInherited.toLocaleString()} plans took their TIER-MATCHED Growth twin's total return`);
console.log(`  IDCW honest-NULL   : ${r.idcwHonestNull.toLocaleString()} plans have no usable Growth twin → withheld (idcw_nav_not_total_return)`);
console.log(`  dead twins skipped : ${r.deadTwinsSkipped} Growth plans passed over — NO NAV in the window (a dormant duplicate`);
console.log(`                       scheme code is not a total-return source; it used to WIN the twin race and hand out NULLs)`);
console.log(`  AMBIGUOUS twins    : ${r.ambiguousTwins} (family, tier) slots where 2+ LIVE Growth plans DISAGREE → withheld, never coin-flipped`);
console.log(`  WITHHELD implaus.  : ${r.withheldImplausible.toLocaleString()} metric windows across ${r.withheldImplausibleSchemes.toLocaleString()} schemes`);
console.log(`                       (physically impossible values — WITHHELD, never "corrected". No split inferred.)`);
console.log(`  window retries     : ${r.windowRetries}  (transport failures re-fetched; a window is folded ATOMICALLY, so a retry cannot double-count)`);
console.log(`  faults             : ${r.faults}  (malformed NAVs ${r.malformedNavs}, out-of-order ${r.outOfOrderRows}, out-of-range ${r.outOfRange})`);
console.log(`  duration           : ${(r.durationMs / 1000).toFixed(0)}s`);

await prisma.$disconnect();
