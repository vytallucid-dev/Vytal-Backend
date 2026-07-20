// ═══════════════════════════════════════════════════════════════
// STEP 18 — GATE 3 VERIFY. Group-3 benchmark analytics, against the LIVE table.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
const rule = (s: string) => console.log("\n" + "═".repeat(92) + "\n" + s + "\n" + "═".repeat(92));
let PASS = 0, FAIL = 0;
const ok = (c: boolean, label: string, detail = "") => {
  c ? PASS++ : FAIL++;
  console.log(`   ${c ? "✓" : "✗✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};

// ═══════════════════════════════════════════════════════════════
rule("1 · BYTE-IDENTICAL (UN-WAIVABLE) — adding beta/alpha CANNOT move a return or a Sharpe");
// ═══════════════════════════════════════════════════════════════
// ══ THE PROOF LIVES IN verify-step18-ab.ts, AND IT HAS TO. ══
// The FIRST attempt at this gate compared the live table against a fingerprint captured before the
// fold ran — and the hash moved. That proved nothing either way: `as_of_date` is PER-SCHEME and
// advances with AMFI, so a moved hash is equally consistent with "Group-3 perturbed the fold" (a
// bug — stop) and "AMFI published a new day since I looked" (irrelevant). verify-step13-fold-ab.ts
// says exactly this about the assetClasses option; Step 18 walked into it anyway.
//
// The honest form is an A/B on IDENTICAL INPUTS: fold twice in one run, same AMFI data, same
// catalogue, Group-3 OFF then ON, and compare every prior column. That is verify-step18-ab.ts, and
// this is the fingerprint it produced — the SAME value from both arms.
const AB_MD5 = "0e1782464ebe7c087d54f24cc8234d9a";
const BASE_ROWS = 14041;

const now = (await q(`SELECT count(*)::int n, md5(string_agg(
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
    ',' ORDER BY scheme_code)) fp FROM mf_analytics`))[0];

console.log(`   A/B fingerprint (Group-3 OFF, and ON — the SAME value): ${AB_MD5}`);
console.log(`   live table now                                        : ${now.fp}`);
ok(now.n === BASE_ROWS, `row count UNCHANGED (${BASE_ROWS})`);
ok(
  now.fp === AB_MD5,
  `★ every prior metric is BYTE-IDENTICAL with Group-3 wired into the fold`,
  `returns (6 horizons) · vol · Sharpe · Sortino · drawdown · rolling · bucket · all 3 ranks · percentiles`,
);
console.log(`
   WHY THIS IS THE STRONG FORM: both arms of the A/B streamed the SAME 9.2M NAV rows through the
   SAME accumulators, differing in ONE variable — whether SchemeAcc.push also folded the paired
   benchmark returns. Had the paired fold corrupted the return chain, the order guard or the nested
   windows, the two hashes would differ. They are the same 32 characters.`);

// ═══════════════════════════════════════════════════════════════
rule("2 · STORAGE — index_prices is READ-ONLY. Zero ingestion, zero bloat.");
// ═══════════════════════════════════════════════════════════════
const idx = (await q(`SELECT count(*)::int rows, count(DISTINCT index_name)::int idx FROM index_prices`))[0];
ok(idx.rows === 144661, `index_prices row count UNMOVED (144,661)`, `${idx.rows.toLocaleString()}`);
ok(idx.idx === 167, `index_prices index count UNMOVED (167)`, `${idx.idx}`);
const db = (await q(`SELECT pg_size_pretty(pg_database_size(current_database())) s,
                            pg_size_pretty(pg_total_relation_size('mf_analytics')) mf`))[0];
console.log(`   DB ${db.s} · mf_analytics ${db.mf}`);
console.log(`   → Group-3 pulled NOTHING. All 14 benchmarks were already present; the fold only READ them.`);

// ═══════════════════════════════════════════════════════════════
rule("3 · COVERAGE — who got a benchmark, and who is honestly null (and why)");
// ═══════════════════════════════════════════════════════════════
const cov = (await q(`
  SELECT count(*)::int total,
         count(*) FILTER (WHERE benchmark_index IS NOT NULL)::int benched,
         count(*) FILTER (WHERE beta_1y IS NOT NULL)::int beta1,
         count(*) FILTER (WHERE beta_3y IS NOT NULL)::int beta3,
         count(*) FILTER (WHERE beta_5y IS NOT NULL)::int beta5,
         count(*) FILTER (WHERE alpha_1y IS NOT NULL)::int alpha1,
         count(*) FILTER (WHERE tracking_error_1y IS NOT NULL)::int te1
    FROM mf_analytics`))[0];
console.log(`   of ${cov.total} scheme rows:`);
console.log(`     with a benchmark : ${cov.benched}  (${((cov.benched / cov.total) * 100).toFixed(1)}%)`);
console.log(`     beta 1Y / 3Y / 5Y: ${cov.beta1} / ${cov.beta3} / ${cov.beta5}`);
console.log(`     alpha 1Y         : ${cov.alpha1}`);
console.log(`     tracking-error 1Y: ${cov.te1}`);
ok(cov.benched > 4000, `a substantial benchmarked population`, `${cov.benched}`);
ok(cov.beta1 > 0 && cov.beta1 <= cov.benched, `beta only ever computed where a benchmark exists`);

console.log(`\n   HOW the benchmark was chosen (the confidence signal on every row):`);
console.log(J(await q(`SELECT benchmark_via, count(*)::int n FROM mf_analytics WHERE benchmark_via IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`)));

console.log(`\n   WHY the nulls are null — the honest-empty ledger, top reasons:`);
const reasons = await q(`
  SELECT omissions->>'benchmark' AS reason, count(*)::int n
    FROM mf_analytics WHERE omissions->>'benchmark' IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
for (const r of reasons) console.log(`     ${String(r.n).padStart(5)}  ${r.reason}`);
const noReason = (await q(`
  SELECT count(*)::int n FROM mf_analytics
   WHERE benchmark_index IS NULL AND omissions->>'benchmark' IS NULL AND omissions->>'_all' IS NULL`))[0];
ok(noReason.n === 0, `★ EVERY benchmark-less row carries a REASON — no unexplained null`, `${noReason.n} unexplained`);

// ═══════════════════════════════════════════════════════════════
rule("4 · RULING 2 — credit-bearing debt is HONEST-NULL, never benchmarked to a G-Sec index");
// ═══════════════════════════════════════════════════════════════
const credit = await q(`
  SELECT i.category, count(*)::int n,
         count(*) FILTER (WHERE a.benchmark_index IS NOT NULL)::int benched
    FROM mf_analytics a JOIN instruments i ON i.amfi_scheme_code = a.scheme_code
   WHERE i.category ~* '(Corporate Bond|Credit Risk|Banking and PSU|Liquid Fund|Money Market|Low Duration|Ultra Short)'
   GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
let leak = 0;
for (const c of credit) {
  leak += c.benched;
  console.log(`   ${String(c.n).padStart(5)} funds · ${c.benched} benchmarked · ${String(c.category).slice(0, 62)}`);
}
ok(leak === 0, `★ ZERO credit-bearing debt funds were given a benchmark — the credit spread is never reported as alpha`, `${leak} leaked`);

// And the gate that makes it structural:
const bankPsu = await q(`
  SELECT a.benchmark_index, count(*)::int n FROM mf_analytics a
    JOIN instruments i ON i.amfi_scheme_code = a.scheme_code
   WHERE i.scheme_name ~* 'Banking.*PSU.*Debt' GROUP BY 1`);
ok(
  bankPsu.every((r: any) => r.benchmark_index === null),
  `★ "Banking & PSU DEBT Fund" was NOT swept into Nifty Bank by the sector matcher`,
  J(bankPsu),
);

// ═══════════════════════════════════════════════════════════════
rule("5 · HAND-CALC — an index fund vs the index it tracks. beta ≈ 1, tracking-error small.");
// ═══════════════════════════════════════════════════════════════
const trackers = await q(`
  SELECT i.scheme_name, a.benchmark_index, a.benchmark_via,
         a.beta_1y::text b1, a.tracking_error_1y::text te1, a.alpha_1y::text al1, a.beta_3y::text b3
    FROM mf_analytics a JOIN instruments i ON i.amfi_scheme_code = a.scheme_code
   WHERE a.benchmark_via = 'name' AND a.beta_1y IS NOT NULL
     AND i.scheme_name ~* 'Index Fund' AND i.scheme_name ~* 'Direct'
     AND a.benchmark_index IN ('Nifty 50','Nifty 100','Nifty 500','Nifty Midcap 150')
   ORDER BY abs(a.beta_1y - 1) ASC LIMIT 10`);
console.log(`   ${"fund".padEnd(52)} ${"benchmark".padEnd(18)} ${"beta1y".padStart(8)} ${"TE 1y".padStart(9)} ${"alpha1y".padStart(9)}`);
for (const t of trackers) {
  console.log(
    `   ${String(t.scheme_name).slice(0, 51).padEnd(52)} ${String(t.benchmark_index).padEnd(18)} ` +
      `${Number(t.b1).toFixed(4).padStart(8)} ${Number(t.te1).toFixed(5).padStart(9)} ${Number(t.al1 ?? 0).toFixed(4).padStart(9)}`,
  );
}
const betas = trackers.map((t: any) => Number(t.b1));
const nearOne = betas.filter((b: number) => Math.abs(b - 1) < 0.05).length;
ok(nearOne >= Math.min(5, betas.length), `★ index funds show beta ≈ 1 vs the index they track`, `${nearOne}/${betas.length} within ±0.05`);
const tes = trackers.map((t: any) => Number(t.te1));
ok(tes.every((t: number) => t < 0.05), `★ …and a SMALL tracking error (<5% annualised)`, `max ${Math.max(...tes).toFixed(5)}`);

// A HIGH-BETA fund must read > 1.
const high = await q(`
  SELECT i.scheme_name, a.benchmark_index, a.beta_1y::text b FROM mf_analytics a
    JOIN instruments i ON i.amfi_scheme_code = a.scheme_code
   WHERE a.beta_1y IS NOT NULL AND a.benchmark_index = 'Nifty 100'
   ORDER BY a.beta_1y DESC LIMIT 3`);
console.log(`\n   the HIGHEST-beta Large Cap funds (vs Nifty 100) — should exceed 1:`);
for (const h of high) console.log(`     ${Number(h.b).toFixed(4)}  ${String(h.scheme_name).slice(0, 62)}`);
ok(high.length > 0 && Number(high[0].b) > 1, `a high-beta fund reads > 1`, `${Number(high[0]?.b).toFixed(4)}`);

// Distribution sanity — a beta universe centred near 1, not near 0 or 3.
const dist = (await q(`
  SELECT round(avg(beta_1y),4)::text avg, round(min(beta_1y),4)::text min, round(max(beta_1y),4)::text max,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY beta_1y)::numeric,4)::text med
    FROM mf_analytics WHERE beta_1y IS NOT NULL`))[0];
console.log(`\n   beta_1y distribution across the whole benchmarked universe: ${J(dist)}`);
ok(Number(dist.med) > 0.5 && Number(dist.med) < 1.3, `★ the MEDIAN beta sits near 1 — the universe is sane`, `median ${dist.med}`);

// ── THE OUTLIER GUARD. The first full run shipped β = −13.23 on ICICI's Overnight Funds, measured
//    against the Nifty 1D Rate Index (annualised vol 0.22% — it IS the risk-free rate). cov/≈0 is a
//    division artefact, not a measurement. MIN_BENCHMARK_VOL now refuses it. This is the standing
//    assertion that it can never come back.
const absurd = await q(`
  SELECT i.scheme_name, a.benchmark_index, a.beta_1y::text b
    FROM mf_analytics a JOIN instruments i ON i.amfi_scheme_code = a.scheme_code
   WHERE a.beta_1y IS NOT NULL AND (a.beta_1y < -1 OR a.beta_1y > 3)
   ORDER BY abs(a.beta_1y) DESC LIMIT 5`);
ok(
  absurd.length === 0,
  `★ NO absurd beta survives (none < −1 or > 3) — the cash-benchmark division artefact is gone`,
  absurd.length ? J(absurd) : "was −13.23 before the MIN_BENCHMARK_VOL guard",
);

const cashNull = (await q(`
  SELECT count(*)::int n FROM mf_analytics
   WHERE benchmark_index = 'Nifty 1D Rate Index' AND beta_1y IS NULL
     AND omissions->>'beta_1y' = 'benchmark_no_market_risk'`))[0];
ok(
  cashNull.n > 0,
  `★ overnight funds get beta = NULL with the REASON "benchmark_no_market_risk"`,
  `${cashNull.n} funds — beta to the risk-free asset is undefined by construction, and we say so`,
);
const cashTe = (await q(`
  SELECT count(*)::int n FROM mf_analytics
   WHERE benchmark_index = 'Nifty 1D Rate Index' AND tracking_error_1y IS NOT NULL`))[0];
ok(cashTe.n > 0, `…while TRACKING ERROR still computes for them`, `${cashTe.n} — "does it follow the overnight rate?" IS answerable`);

// ═══════════════════════════════════════════════════════════════
rule("6 · TWO-HISTORY GATING — the fund AND the benchmark must both cover the horizon");
// ═══════════════════════════════════════════════════════════════
const gate = (await q(`
  SELECT count(*) FILTER (WHERE beta_1y IS NOT NULL AND beta_5y IS NULL)::int y1_not_y5,
         count(*) FILTER (WHERE omissions->>'beta_5y' = 'insufficient_history')::int young_fund,
         count(*) FILTER (WHERE omissions->>'beta_5y' = 'benchmark_too_short')::int short_bench,
         count(*) FILTER (WHERE omissions->>'beta_5y' = 'insufficient_paired_history')::int few_pairs
    FROM mf_analytics WHERE benchmark_index IS NOT NULL`))[0];
console.log(`   benchmarked funds with a 1Y beta but NO 5Y beta: ${gate.y1_not_y5}`);
console.log(`     ...because the FUND is too young       : ${gate.young_fund}`);
console.log(`     ...because OUR BENCHMARK series is short: ${gate.short_bench}`);
console.log(`     ...because too few pairs survived      : ${gate.few_pairs}`);
ok(
  gate.young_fund + gate.short_bench + gate.few_pairs > 0,
  `★ the two failure modes are recorded DISTINCTLY — "this fund is young" is never confused with "our index history is shallow"`,
);
console.log(`   → they demand OPPOSITE fixes: one is a fact about the fund, the other is a gap in OUR data.`);

// ═══════════════════════════════════════════════════════════════
rule("7 · ETFs — tracking-error vs the index they track");
// ═══════════════════════════════════════════════════════════════
const etf = (await q(`
  SELECT count(*)::int total,
         count(*) FILTER (WHERE a.benchmark_index IS NOT NULL)::int benched,
         count(*) FILTER (WHERE a.beta_1y IS NOT NULL)::int withbeta
    FROM mf_analytics a JOIN instruments i ON i.amfi_scheme_code = a.scheme_code
   WHERE i.asset_class = 'etf'`))[0];
console.log(`   ETFs: ${etf.total} rows · ${etf.benched} benchmarked · ${etf.withbeta} with a 1Y beta`);
const etfEx = await q(`
  SELECT i.symbol, a.benchmark_index, a.beta_1y::text b, a.tracking_error_1y::text te
    FROM mf_analytics a JOIN instruments i ON i.amfi_scheme_code = a.scheme_code
   WHERE i.asset_class='etf' AND a.beta_1y IS NOT NULL
   ORDER BY a.tracking_error_1y ASC LIMIT 6`);
console.log(`\n   the TIGHTEST-tracking ETFs (this is the number that matters for a passive fund):`);
for (const e of etfEx) {
  console.log(`     ${String(e.symbol ?? "—").padEnd(14)} vs ${String(e.benchmark_index).padEnd(24)} β=${Number(e.b).toFixed(4)}  TE=${(Number(e.te) * 100).toFixed(3)}%`);
}
ok(etf.benched > 100, `ETFs got benchmarks`, `${etf.benched}/${etf.total}`);
ok(
  etfEx.length > 0 && Number(etfEx[0].b) > 0.9 && Number(etfEx[0].b) < 1.1,
  `★ the tightest ETF tracks with beta ≈ 1`,
  `β=${Number(etfEx[0]?.b).toFixed(4)}`,
);

// ═══════════════════════════════════════════════════════════════
rule("8 · COMPUTE-AND-DISCARD — no raw benchmark series was persisted");
// ═══════════════════════════════════════════════════════════════
const tables = await q(`
  SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND (tablename ~* 'bench' OR tablename ~* 'nav_history' OR tablename ~* 'return_series')`);
ok(tables.length === 0, `★ NO benchmark/series table exists — nothing raw was persisted`, tables.length ? J(tables) : "compute-and-discard holds");

rule(FAIL === 0 ? `✓✓ GATE 3 PASS — ${PASS} checks, 0 failures` : `✗✗ GATE 3 FAIL — ${FAIL} of ${PASS + FAIL}`);
await prisma.$disconnect();
process.exit(FAIL === 0 ? 0 : 1);
