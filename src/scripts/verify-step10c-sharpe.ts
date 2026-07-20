// STEP 10c — STEP 3 (verify): did ruling ③ actually work?
// Run AFTER the index backfill + the analytics fold. Read-only.
// npx tsx src/scripts/verify-step10c-sharpe.ts
import { prisma } from "../db/prisma.js";
import { checkPhsStructural, PHS_TEST_USERS } from "./phs-structural.js";

const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);
let fails = 0;
const check = (ok: boolean, m: string) => { if (!ok) fails++; console.log(`  ${ok ? "✅" : "❌"} ${m}`); };

// The STEP-1 BEFORE, recorded verbatim.
const BEFORE = {
  sharpe1y: 8251, sharpe3y: 0, sharpe5y: 0,
  sortino1y: 8094, sortino3y: 0,
  riskFreeTooShort: 30285,
  rfPoints: 250, rfYears: 1.04,
};

hdr("1. RISK-FREE DEPTH — before → after");
const rf = await prisma.$queryRawUnsafe<any[]>(`
  SELECT index_name, count(*) pts, min(date) mn, max(date) mx
  FROM index_prices WHERE index_name IN ('Nifty 1D Rate Index','Nifty 10 yr Benchmark G-Sec')
  GROUP BY 1 ORDER BY 1`);
for (const r of rf) {
  const yrs = (new Date(r.mx).getTime() - new Date(r.mn).getTime()) / (365.25 * 86400000);
  console.log(
    `  ${String(r.index_name).padEnd(30)} ${String(r.pts).padStart(5)} pts  ` +
      `${String(r.mn).slice(4, 15)} → ${String(r.mx).slice(4, 15)}  (${yrs.toFixed(2)} y)`,
  );
  if (r.index_name === "Nifty 1D Rate Index") {
    // ── THIS ASSERTION WAS STRICTER THAN THE FOLD IT IS TESTING, AND SO IT WAS WRONG. ──
    //
    // It read `yrs >= 5`. The series spans 1,820 days = 4.983 years, so it failed — by ONE DAY —
    // while every 5Y Sharpe in the table was computing perfectly well. The check was asserting
    // calendar arithmetic the fold does not use.
    //
    // The fold's ACTUAL rule (risk-free.ts, mirroring SchemeAcc.anchor) is the ANCHOR rule: the
    // series' oldest point must be no more than ANCHOR_TOLERANCE_DAYS (21) LATER than the horizon's
    // anchor date. That absorbs holiday clusters and a market that does not print on Jan 1 — and it
    // is why a 4.98-year series legitimately covers the 5-year horizon. The test now asserts the
    // rule the code actually applies, and would still catch the real regression it was written for
    // (a risk-free series that never got deepened at all — the 1.04y / 250-pt "before").
    //
    // Not a Step-18 change: index_prices is untouched by Group-3 (144,661 rows, unmoved). This
    // assertion was already failing on its own terms. See verify-step18-preexisting.ts.
    const ANCHOR_TOLERANCE_YEARS = 21 / 365.25;
    check(
      yrs >= 5 - ANCHOR_TOLERANCE_YEARS,
      `1D-Rate covers the 5Y horizon under the fold's anchor rule — ${yrs.toFixed(2)} y ` +
        `(was ${BEFORE.rfYears} y / ${BEFORE.rfPoints} pts)`,
    );
  }
}

hdr("2. ★ THE HEADLINE — Sharpe / Sortino coverage, before → after");
const cov = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(sharpe_1y) s1, count(sharpe_3y) s3, count(sharpe_5y) s5,
         count(sortino_1y) so1, count(sortino_3y) so3,
         count(*) FILTER (WHERE ret_3y_cagr IS NOT NULL AND vol_3y IS NOT NULL) can3,
         count(*) FILTER (WHERE ret_5y_cagr IS NOT NULL) can5
  FROM mf_analytics`);
const c = cov[0];
const row = (name: string, before: number, after: number, ceiling?: number) => {
  const jump = Number(after) - before;
  console.log(
    `  ${name.padEnd(12)} ${String(before).padStart(6)} → ${String(after).padStart(6)}` +
      `   ${jump >= 0 ? "+" : ""}${jump}` +
      (ceiling !== undefined ? `   (ceiling ${ceiling})` : ""),
  );
};
console.log(`  ${"metric".padEnd(12)} ${"before".padStart(6)}   ${"after".padStart(6)}   delta`);
row("sharpe_1y", BEFORE.sharpe1y, Number(c.s1));
row("sharpe_3y", BEFORE.sharpe3y, Number(c.s3), Number(c.can3));
row("sharpe_5y", BEFORE.sharpe5y, Number(c.s5), Number(c.can5));
row("sortino_1y", BEFORE.sortino1y, Number(c.so1));
row("sortino_3y", BEFORE.sortino3y, Number(c.so3), Number(c.can3));

check(Number(c.s3) > 0, `★ sharpe_3y went from 0 → ${c.s3} — ruling ③ WORKED`);
check(Number(c.s5) > 0, `★ sharpe_5y went from 0 → ${c.s5}`);
check(Number(c.so3) > 0, `★ sortino_3y went from 0 → ${c.so3}`);

// Every fund with the fund-side leg should now have Sharpe, EXCEPT the zero-dispersion ones.
const gap3 = Number(c.can3) - Number(c.s3);
console.log(`\n  funds with a 3Y return + 3Y vol but STILL no sharpe_3y: ${gap3}`);
console.log(`    (expected ≈ the zero-dispersion funds, whose Sharpe is UNDEFINED by design)`);

hdr("3. THE OMISSION LEDGER — before → after");
const om = await prisma.$queryRawUnsafe<any[]>(`
  SELECT v AS code, count(*) n
  FROM mf_analytics, LATERAL jsonb_each_text(omissions) AS kv(k, v)
  GROUP BY 1 ORDER BY 2 DESC`);
const byCode = new Map(om.map((o) => [o.code, Number(o.n)]));
const rfNow = byCode.get("risk_free_too_short") ?? 0;
console.log(`  risk_free_too_short : ${BEFORE.riskFreeTooShort} → ${rfNow}   (${rfNow - BEFORE.riskFreeTooShort})`);
check(rfNow < BEFORE.riskFreeTooShort, `★ risk_free_too_short DROPPED sharply`);
console.log(`\n  full ledger now:`);
for (const o of om) console.log(`    ${String(o.n).padStart(7)}  ${o.code}`);

// The REMAINING risk_free_too_short must be legitimately edge: funds whose horizon still
// out-reaches the index. With a 5y index and a 5y max horizon, some 5Y funds sit right at the
// boundary. Confirm they are edge, not a systemic miss.
hdr("4. THE REMAINING risk_free_too_short — edge, or a systemic miss?");
const rem = await prisma.$queryRawUnsafe<any[]>(`
  SELECT kv.k AS field, count(*) n
  FROM mf_analytics, LATERAL jsonb_each_text(omissions) AS kv(k, v)
  WHERE v = 'risk_free_too_short'
  GROUP BY 1 ORDER BY 2 DESC`);
if (rem.length === 0) {
  console.log(`  NONE remain — every horizon now has a risk-free leg. ✅`);
} else {
  for (const r of rem) console.log(`    ${String(r.n).padStart(6)}  ${r.field}`);
  const only5 = rem.every((r) => String(r.field).includes("5y"));
  check(only5, `remaining entries are ONLY on 5Y metrics — the boundary case, not a systemic miss`);
  if (!only5) console.log(`    ⚠️ entries on non-5Y metrics — investigate.`);
}

hdr("5. SPOT-CHECKS");
// (a) SBI Overnight — extreme-negative Sharpe is EXPECTED, not a bug.
const sbi = await prisma.mfAnalytics.findFirst({
  where: { schemeCode: "101206" },
  select: { ret1y: true, ret3yCagr: true, ret5yCagr: true, vol1y: true, vol3y: true,
            sharpe1y: true, sharpe3y: true, sharpe5y: true, sortino3y: true },
});
if (sbi) {
  console.log(`  SBI OVERNIGHT (101206) — a near-riskless fund:`);
  console.log(`    ret 1Y ${p(sbi.ret1y)}  3Y ${p(sbi.ret3yCagr)}  5Y ${p(sbi.ret5yCagr)}`);
  console.log(`    vol 1Y ${p(sbi.vol1y)}  3Y ${p(sbi.vol3y)}`);
  console.log(`    sharpe 1Y ${sbi.sharpe1y}  3Y ${sbi.sharpe3y}  5Y ${sbi.sharpe5y}`);
  check(sbi.sharpe3y !== null, `sharpe_3y COMPUTED (an extreme value here is expected — tiny excess ÷ tiny vol)`);
}

// (b) zero-dispersion funds must STILL be honest-empty (undefined, never fabricated).
const zd = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n FROM mf_analytics, LATERAL jsonb_each_text(omissions) AS kv(k, v)
  WHERE v = 'zero_dispersion'`);
console.log(`\n  zero_dispersion ledger entries: ${zd[0].n}  (were 213)`);
const zdSharpe = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n FROM mf_analytics
  WHERE (omissions ->> 'sharpe_1y') = 'zero_dispersion' AND sharpe_1y IS NOT NULL`);
check(Number(zdSharpe[0].n) === 0, `★ zero-dispersion funds stayed UNDEFINED — no fabricated Sharpe (${zdSharpe[0].n} violations)`);

// (c) THE ANCHOR COLUMNS — GONE, and that is now the thing being proven.
hdr("6. THE INCEPTION ANCHOR — dropped, not defended");
// This check used to assert that the fold's ON CONFLICT had not NULLed the 13,601 MF anchors. That
// invariant is retired along with the columns themselves.
//
// The anchors existed to feed ret_since_earliest_cagr, and that metric could not be computed honestly
// from the only source we have. AMFI's NAV history is RAW — neither split-adjusted nor total-return —
// and a span reaching back to its ~2009 floor is the WORST case for both corruptions, not an edge
// case: the further back the anchor, the more unit splits and IDCW payouts sit between it and today.
// NIFTYBEES read -11.19% a year "since 2019"; it had sub-divided 1:10, and the "return" was the split.
//
// Step 19 can repair 1Y/3Y/5Y because those windows are BOUNDED — every real NSE corporate action
// inside them can be enumerated and the series rescaled by the published ratio. A since-earliest span
// has no such bound. So the column went, and its anchors with it.
const cols = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*)::int n FROM information_schema.columns
  WHERE table_name = 'mf_analytics'
    AND column_name IN ('earliest_nav', 'earliest_nav_date', 'ret_since_earliest_cagr')`);
const last = await prisma.$queryRawUnsafe<any[]>(`SELECT max(computed_at) last FROM mf_analytics`);
console.log(`  last computed_at   : ${last[0].last?.toISOString?.() ?? last[0].last}`);
check(Number(cols[0].n) === 0,
  `★ earliest_nav / earliest_nav_date / ret_since_earliest_cagr are GONE from mf_analytics ` +
  `(${cols[0].n} still present) — a metric we cannot compute honestly should not be a column`);

hdr("7. BASELINE");
const st = await prisma.instrument.count({ where: { assetClass: "stock" } });
const mf = await prisma.instrument.count({ where: { assetClass: "mutual_fund" } });
const fp = await prisma.$queryRawUnsafe<any[]>(`
  SELECT md5(string_agg(id||':'||isin||':'||COALESCE(stock_id,'-'),'|' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class='stock'`);
check(st === 504, `504 stocks`);
check(mf === 17567, `17,567 MF rows`);
check(fp[0].fp === "da04f158478175140addfa3b6db045ed", `stock fingerprint unchanged`);

// ── WAS: check(phs === 66) / check(phs === 51). REMOVED — and NOT re-baselined to 67/50. ──────
//
// THE DRIFT IS RESOLVED, AND IT WAS NEVER A BUG. Traced end to end (probe-phs-drift-timeline.ts):
// the EOD price cron → hook:eod_prices_daily → pg_rescore → a new ScoreSnapshot per held stock →
// the PHS recomputes. It ran on 2026-07-10 (→ 66/51, the pair this file froze) and again on
// 2026-07-13 (→ 67/50). An ordinary price-driven rescore.
//
// AND THAT RESOLUTION IS EXACTLY WHAT CONDEMNS THE ASSERTION. The PHS is a LIVE, MARKET-DRIVEN
// OUTPUT — aman's own history reads 51→50→51→50 across 07-08…07-13 on nothing but price ticks. So
// the check was not STALE, it was MIS-SPECIFIED: it pinned a number the system is DESIGNED to move,
// which guarantees a red run on the next tick. Writing 67/50 in would buy one green run and break
// tomorrow. The fix is to stop pinning, not to re-pin.
//
// A Sharpe/analytics-integrity harness is not entitled to assert a user's health SCORE anyway — it
// is not a property of the fold this file verifies. It IS entitled to assert that the pipeline
// still WORKS. So: assemblePortfolio() → computePhs() must yield a non-null, in-range [0,100] score
// with a valid band. Machinery asserted; output reported, never pinned. Read-only — see
// phs-structural.ts, shared with verify-step9-amfi so the two cannot drift apart.
//
// (LOGGED, NOT FIXED: the 50↔51 flicker on tiny ticks is a real PRODUCT question about band-edge
//  damping / hysteresis in the score. Not a test defect, and out of scope here.)
console.log(`\n  ── PHS: STRUCTURAL check — the value is REPORTED, never asserted (it moves with the market) ──`);
for (const email of PHS_TEST_USERS) {
  const r = await checkPhsStructural(email);
  check(r.ok, `${email} — ${r.detail}`);
}

function p(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return `${(Number(v) * 100).toFixed(2)}%`;
}

console.log(`\n${fails === 0 ? "✅ RULING ③ VERIFIED END-TO-END" : `❌ ${fails} CHECK(S) FAILED`}`);
await prisma.$disconnect();
