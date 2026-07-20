// ═══════════════════════════════════════════════════════════════
// STEP 18 — THE A/B. The un-waivable byte-identical proof, done PROPERLY.
//
// THE FIRST ATTEMPT WAS NOT A PROOF, AND THE CODEBASE ALREADY KNEW WHY. Comparing the live table
// against a fingerprint captured before the fold ran cannot distinguish:
//     "Group-3 perturbed the fold"        (a bug — stop and fix it)
//     "AMFI revised a NAV since I looked" (nothing to do with me)
// The as-of date is per-scheme and advances with the source, so a moved hash proves nothing either
// way. verify-step13-fold-ab.ts says exactly this about the `assetClasses` option, and Step 18 has
// the same obligation.
//
// SO: fold TWICE, same day, same AMFI data, same catalogue — once with Group-3 OFF, once ON — and
// compare the PRIOR columns. Any difference is then unambiguously MINE.
//
// ~17 minutes. It is the only honest form of the claim.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { runMfAnalytics } from "../ingestions/amfi/mf-analytics.js";

const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
const rule = (s: string) => console.log("\n" + "═".repeat(92) + "\n" + s + "\n" + "═".repeat(92));

/** EVERY pre-existing metric column. If Group-3 moved any of them, this md5 moves. */
const FP = `SELECT count(*)::int n, md5(string_agg(
    scheme_code
    ||'|'||coalesce(as_of_date::text,'~')||'|'||coalesce(nav_points::text,'~')
    ||'|'||coalesce(ret_1m::text,'~')||'|'||coalesce(ret_3m::text,'~')||'|'||coalesce(ret_6m::text,'~')
    ||'|'||coalesce(ret_1y::text,'~')||'|'||coalesce(ret_3y_cagr::text,'~')||'|'||coalesce(ret_5y_cagr::text,'~')
    ||'|'||coalesce(vol_1y::text,'~')||'|'||coalesce(vol_3y::text,'~')
    ||'|'||coalesce(sharpe_1y::text,'~')||'|'||coalesce(sharpe_3y::text,'~')||'|'||coalesce(sharpe_5y::text,'~')
    ||'|'||coalesce(sortino_1y::text,'~')||'|'||coalesce(sortino_3y::text,'~')
    ||'|'||coalesce(max_drawdown_1y::text,'~')||'|'||coalesce(max_drawdown_3y::text,'~')||'|'||coalesce(max_drawdown_5y::text,'~')
    ||'|'||coalesce(roll_1y_n::text,'~')||'|'||coalesce(roll_1y_avg::text,'~')
    ||'|'||coalesce(rank_bucket,'~')||'|'||coalesce(rank_1y::text,'~')||'|'||coalesce(rank_3y::text,'~')||'|'||coalesce(rank_5y::text,'~')
    ||'|'||coalesce(pct_1y::text,'~'),
    ',' ORDER BY scheme_code)) fp FROM mf_analytics`;

rule("A · FOLD WITHOUT GROUP-3 (the control)");
const a = await runMfAnalytics({ benchmarks: false });
if (!a.ok) { console.log(`✗✗ control fold failed: ${a.abortReason}`); process.exit(1); }
const fpA = (await q(FP))[0];
console.log(`   ok · ${a.rowsFolded.toLocaleString()} rows folded · ${a.analyticsWritten} written · ${a.durationMs}ms`);
console.log(`   benchmarked: ${a.benchmarked} (expected 0)  ·  beta computed: ${a.betaComputed} (expected 0)`);
console.log(`   PRIOR-COLUMN md5: ${fpA.fp}   (${fpA.n} rows)`);

rule("B · FOLD WITH GROUP-3 (the treatment) — identical inputs, one nightly apart from A by nothing");
const b = await runMfAnalytics({ benchmarks: true });
if (!b.ok) { console.log(`✗✗ treatment fold failed: ${b.abortReason}`); process.exit(1); }
const fpB = (await q(FP))[0];
console.log(`   ok · ${b.rowsFolded.toLocaleString()} rows folded · ${b.analyticsWritten} written · ${b.durationMs}ms`);
console.log(`   benchmark series loaded: ${b.benchmarkIndices}  ·  schemes benchmarked: ${b.benchmarked}`);
console.log(`   beta computed: ${b.betaComputed}  ·  unpaired fund returns: ${b.unpairedReturns.toLocaleString()}`);
console.log(`   PRIOR-COLUMN md5: ${fpB.fp}   (${fpB.n} rows)`);

rule("THE VERDICT");
const same = fpA.fp === fpB.fp && fpA.n === fpB.n;
console.log(`   without Group-3 : ${fpA.fp}`);
console.log(`   with Group-3    : ${fpB.fp}`);
console.log("");
if (same) {
  console.log(`   ✓✓ BYTE-IDENTICAL. Every pre-existing metric — returns (6 horizons), volatility,`);
  console.log(`      Sharpe, Sortino, drawdown, rolling, bucket and all four ranks — is bit-for-bit`);
  console.log(`      the same with Group-3 wired into SchemeAcc.push as without it.`);
  console.log(`\n      This is the STRONG form: same AMFI data, same catalogue, same run, one variable.`);
  console.log(`      A moved hash here could ONLY have been mine. It did not move.`);
} else {
  console.log(`   ✗✗ THE FOLD MOVED. Group-3 perturbed a pre-existing metric. DO NOT SHIP.`);
  const diff = await q(`SELECT scheme_code FROM mf_analytics LIMIT 0`); // placeholder to keep shape
  void diff;
}

// Group-3 itself must be POPULATED in B and EMPTY in A — otherwise the A/B compared nothing.
const g3 = (await q(`SELECT count(*) FILTER (WHERE beta_1y IS NOT NULL)::int beta,
                            count(*) FILTER (WHERE benchmark_index IS NOT NULL)::int bench
                       FROM mf_analytics`))[0];
console.log(`\n   sanity: Group-3 IS populated after B — ${g3.beta} betas, ${g3.bench} benchmarks.`);
console.log(`   (If these were 0 the A/B would have compared two identical no-op runs and proved nothing.)`);

await prisma.$disconnect();
process.exit(same && g3.beta > 0 ? 0 : 1);
