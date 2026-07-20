// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// STEP 13 â€” THE A/B THAT SETTLES THE UN-WAIVABLE CLAIM.
//
// THE PROBLEM. Gate 3 compared today's mf_analytics against a hash captured at Gate 0
// (cc56cefdâ€¦) and found it MOVED (â†’ 81cc37deâ€¦), same 13,704 scheme codes, different values.
// Two causes are consistent with that, and they demand OPPOSITE responses:
//
//   (a) STEP 13 PERTURBED THE MFs â€” admitting `etf` to the fold changed existing MF numbers.
//       That is a real bug and the step does not ship.
//   (b) THE SOURCE DATA MOVED â€” AMFI revised or late-published NAVs in the ~3 h between the
//       last nightly fold and this one. Then the MF rows SHOULD differ, the drift has nothing
//       to do with ETFs, and Step 13 is innocent.
//
// A hash captured hours ago cannot tell these apart. Only an A/B against IDENTICAL inputs can:
//
//   FOLD 1  classes = [mutual_fund, etf]   â†’ MF-subset fingerprint  X
//   FOLD 2  classes = [mutual_fund]        â†’ MF-subset fingerprint  Y
//   FOLD 3  classes = [mutual_fund, etf]   â†’ MF-subset fingerprint  Z   (restores the real state)
//
//   X === Y  â‡’ admitting `etf` changes NOTHING about the MF rows. Claim PROVEN. Any drift from
//              the Gate-0 hash is source-data movement, not Step 13.
//   X !== Y  â‡’ Step 13 perturbs the MFs. The step is BROKEN. Say so.
//   X === Z  â‡’ the fold is deterministic over this window, which is what makes X===Y meaningful
//              in the first place (without it, two equal hashes could be a coincidence and two
//              unequal ones could be noise).
//
// Runs 3 folds back-to-back (~7 min each). That is the price of proving it instead of asserting it.
//
//   npx tsx src/scripts/verify-step13-fold-ab.ts
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { runMfAnalytics } from "../ingestions/amfi/mf-analytics.js";

const GATE0 = "cc56cefdccf51aeed86c46d243d2d776";

/** The MF SUBSET of mf_analytics â€” byte-for-byte, every stored metric, computed_at excluded. */
const FP = `
  SELECT count(*)::int n, md5(string_agg(
    scheme_code || '|' || as_of_date::text || '|' || nav_points::text || '|' ||
    coalesce(window_from::text,'~') || coalesce(window_to::text,'~') || '|' ||
    coalesce(ret_1m::text,'~') || coalesce(ret_3m::text,'~') || coalesce(ret_6m::text,'~') ||
    coalesce(ret_1y::text,'~') || coalesce(ret_3y_cagr::text,'~') || coalesce(ret_5y_cagr::text,'~') ||
    coalesce(vol_1y::text,'~') || coalesce(vol_3y::text,'~') || '|' ||
    coalesce(sharpe_1y::text,'~') || coalesce(sharpe_3y::text,'~') || coalesce(sharpe_5y::text,'~') ||
    coalesce(sortino_1y::text,'~') || coalesce(sortino_3y::text,'~') || '|' ||
    coalesce(max_drawdown_1y::text,'~') || coalesce(max_drawdown_3y::text,'~') || coalesce(max_drawdown_5y::text,'~') || '|' ||
    coalesce(roll_1y_n::text,'~') || coalesce(roll_1y_min::text,'~') || coalesce(roll_1y_max::text,'~') ||
    coalesce(roll_1y_avg::text,'~') || coalesce(roll_1y_pct_positive::text,'~') || '|' ||
    coalesce(rank_bucket,'~') || coalesce(rank_bucket_size::text,'~') || '|' ||
    coalesce(rank_1y::text,'~') || coalesce(rank_3y::text,'~') || coalesce(rank_5y::text,'~') ||
    coalesce(pct_1y::text,'~') || coalesce(pct_3y::text,'~') || coalesce(pct_5y::text,'~') || '|' ||
    coalesce(omissions::text,'~'),
    ',' ORDER BY scheme_code)) AS fp
  FROM mf_analytics
  WHERE scheme_code IN (SELECT amfi_scheme_code FROM instruments WHERE asset_class = 'mutual_fund')`;

const mfFp = async () => (await prisma.$queryRawUnsafe<any[]>(FP))[0]!;

async function fold(label: string, classes: readonly ("mutual_fund" | "etf")[]) {
  process.stdout.write(`  ${label}  folding [${classes.join(", ")}] â€¦ `);
  const r = await runMfAnalytics({ assetClasses: classes });
  if (!r.ok) throw new Error(`fold FAILED: ${r.abortReason}`);
  const f = await mfFp();
  console.log(`${(r.durationMs / 1000).toFixed(0)}s Â· wrote ${r.analyticsWritten} Â· MF fp ${f.fp} (${f.n} rows)`);
  return f;
}

console.log("â•â•â• STEP 13 â€” FOLD A/B (does admitting `etf` perturb the MF rows?) â•â•â•\n");

const X = await fold("FOLD 1 ", ["mutual_fund", "etf"]);
const Y = await fold("FOLD 2 ", ["mutual_fund"]);
const Z = await fold("FOLD 3 ", ["mutual_fund", "etf"]);

console.log("\nâ”€â”€â”€ VERDICT â”€â”€â”€");
const inert = X.fp === Y.fp;
const deterministic = X.fp === Z.fp;

console.log(`  determinism   : fold1 === fold3 ?  ${deterministic ? "YES" : "NO"}   (${X.fp} vs ${Z.fp})`);
console.log(`  ETF inertness : fold1 === fold2 ?  ${inert ? "YES" : "NO"}   (${X.fp} vs ${Y.fp})`);
console.log(`  vs Gate-0     : ${X.fp === GATE0 ? "unchanged" : `MOVED (was ${GATE0})`}`);
console.log("");

if (!deterministic) {
  console.log("  âš ï¸  THE FOLD IS NOT DETERMINISTIC over this window â€” two identical runs disagree.");
  console.log("     That makes the A/B unreadable and is a fault in its own right. Investigate before");
  console.log("     trusting ANY fingerprint comparison.");
} else if (inert) {
  console.log("  âœ… PROVEN: admitting `etf` to the fold changes NOTHING about the 13,704 MF rows.");
  console.log("     Byte-for-byte identical MF output whether ETFs are in the fold or not, against");
  console.log("     the SAME inputs, minutes apart. The un-waivable claim HOLDS.");
  if (X.fp !== GATE0) {
    console.log("");
    console.log("     The drift from the Gate-0 hash is therefore NOT Step 13. It is source-data");
    console.log("     movement: AMFI revised/late-published NAVs between the last nightly fold and");
    console.log("     now, and the fold correctly recomputed on the new data. An MF-only fold");
    console.log("     TODAY produces the same drifted hash â€” which is exactly what fold 2 shows.");
  }
} else {
  console.log("  âŒ BROKEN: admitting `etf` to the fold CHANGES existing MF rows.");
  console.log("     Step 13's un-waivable claim FAILS. Do not ship. Diff the two folds' rows.");
}

await prisma.$disconnect();
process.exit(deterministic && inert ? 0 : 1);
