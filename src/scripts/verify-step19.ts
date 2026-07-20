// ─────────────────────────────────────────────────────────────────────────────
// STEP 19 — GATE 3 VERIFICATION.  npx tsx src/scripts/verify-step19.ts
//
//   1  BYTE-IDENTICAL (un-waivable): a fund with no split and no distribution problem is UNCHANGED.
//   2  SPLIT ETFs CORRECTED — and corrected to REALITY, checked against the fund's own index.
//   3  DOWNSTREAM FIXED: vol / Sharpe / Sortino / drawdown / beta / alpha, not just the return.
//      (This is the whole reason the fix went in the SERIES and not in the return's anchor.)
//   4  DISTRIBUTIONS: an IDCW plan takes its tier-matched Growth twin's figure — and that figure
//      is the TRUE one, not merely a different one.
//   5  HONEST-NULL where no real event exists — never inferred, never borrowed from a peer.
//   6  NO HEURISTIC: the adjustment reads real corporate-action rows only.
//   7  IDEMPOTENT: re-ingesting the splits writes no duplicates.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { parseSplitFactor } from "../ingestions/corporate-events/instrument-splits.js";

let failures = 0;
let pending = 0;
const assert = (name: string, cond: boolean, detail: string) => {
  console.log(`  ${cond ? "✅" : "❌"} ${name}\n       ${detail}`);
  if (!cond) failures++;
};
const q = <T = any>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);
const one = async <T = any>(s: string, ...p: unknown[]) => (await q<T>(s, ...p))[0]!;

// ─────────────────────────────────────────────────────────────────────────────
// HAS A STEP-19 FOLD ACTUALLY RUN?
//
// This gate exists to stop this harness LYING, and it is not hypothetical — it caught exactly that
// here. AMFI throttled the fold to 0.03 MB/s, it hit the total-duration cap and ABORTED BEFORE ANY
// WRITE (correctly). The table therefore still holds the PRE-Step-19 numbers. In that state,
// "NIFTYBEES is byte-identical" passes with a green tick — because NOTHING WROTE. That tick would be
// true as a statement about the bytes and false as a statement about what was tested, which is the
// most dangerous kind of green: it certifies a hole.
//
// So the run is CLASSIFIED first. Fold-dependent claims are only ASSERTED when they are a real test;
// otherwise they are reported PENDING — loudly, counted as UNPROVEN, and the harness exits non-zero.
//
// The tell: a Step-19 fold ALWAYS writes at least one of its two new omission codes (the
// implausibility guard fires on the Franklin/Navi/UTI rows; the distribution pass fires on the
// IDCW-only families). Zero of either ⇒ the new code has never touched this table.
// ─────────────────────────────────────────────────────────────────────────────
const foldRan = (await one(`
  SELECT count(*)::int n FROM mf_analytics
  WHERE omissions::text LIKE '%withheld_implausible%'
     OR omissions::text LIKE '%idcw_nav_not_total_return%'`)).n > 0;
const pend = (name: string, why: string) => {
  console.log(`  ⏳ PENDING (NOT PASSED) — ${name}\n       ${why}`);
  pending++;
};
/** A claim that can only be tested AFTER a Step-19 fold has written. Never green on an empty run. */
const assertFold = (name: string, cond: boolean, detail: string) => {
  if (!foldRan) {
    pend(name, `no Step-19 fold has written yet, so this proves NOTHING. Table currently reads: ${detail}`);
    return;
  }
  assert(name, cond, detail);
};
console.log(
  foldRan
    ? "\n[a Step-19 fold HAS run — the fold-dependent checks below are REAL tests]"
    : "\n[⚠️  NO Step-19 fold has run yet (AMFI throttled it; it aborted before any write). The\n" +
      "    fold-dependent checks below are NOT tests — the table still holds pre-Step-19 numbers.\n" +
      "    They are reported PENDING, not passed.]",
);

// ═══ 1 — THE SPLIT SPINE ════════════════════════════════════════════════════
console.log("\n═══ 1 — The split spine: REAL, DATED NSE events with evidence ═══");
const spine = await one(`
  SELECT count(*)::int events, count(DISTINCT instrument_id)::int etfs,
         count(*) FILTER (WHERE split_factor IS NULL)::int no_factor,
         count(*) FILTER (WHERE description IS NULL)::int no_evidence,
         count(*) FILTER (WHERE ex_date IS NULL)::int no_date
  FROM instrument_corporate_events WHERE event_type='split'`);
assert("every stored split carries a real factor, a real ex-date, and its NSE subject as evidence",
  spine.no_factor === 0 && spine.no_evidence === 0 && spine.no_date === 0,
  `${spine.events} split events across ${spine.etfs} ETFs · ${spine.no_factor} factorless · ${spine.no_evidence} without evidence · ${spine.no_date} undated`);

assert("the 7,433 EQUITY corporate_events rows are untouched — structurally (separate table)",
  (await one(`SELECT count(*)::int n FROM corporate_events`)).n === 7433,
  `corporate_events still holds ${(await one(`SELECT count(*)::int n FROM corporate_events`)).n} rows; Step 19 never ALTERed it`);

// The snap, re-derived from the stored evidence — so the factor is FALSIFIABLE, not asserted.
console.log("\n  the snap, re-derived from each row's own stored NSE subject:");
const snapCheck = await q(`
  SELECT symbol, split_factor::float8 AS stored, description
  FROM instrument_corporate_events WHERE event_type='split'
    AND description ~ '[0-9]{2,}\\.[0-9]' ORDER BY symbol LIMIT 5`);
let snapOk = true;
for (const r of snapCheck) {
  const p = parseSplitFactor(r.description);
  const ok = p !== null && p.factor === r.stored;
  if (!ok) snapOk = false;
  console.log(`       ${ok ? "✓" : "✗"} ${String(r.symbol).padEnd(11)} raw ${p?.rawFactor.toFixed(6)} → snapped ×${p?.factor}  (stored ×${r.stored})`);
}
assert("the SNAP is reproducible from the stored evidence (NSE's rounding normalised to the real integer ratio)",
  snapOk, "each factor re-derives from its own subject line");

// ═══ 2 — BYTE-IDENTICAL ═════════════════════════════════════════════════════
console.log("\n═══ 2 — BYTE-IDENTICAL: no split + not IDCW ⇒ UNCHANGED (un-waivable) ═══");
console.log("     (run verify-step19-ab.ts before/after for the fingerprint; the named controls follow)");
const controls = await q(`
  SELECT i.symbol,
         round((ma.ret_3y_cagr*100)::numeric,2)::float8 ret_3y,
         round((ma.ret_5y_cagr*100)::numeric,2)::float8 ret_5y,
         round((ma.vol_3y*100)::numeric,1)::float8 vol_3y,
         round((ma.max_drawdown_3y*100)::numeric,1)::float8 maxdd_3y,
         round(ma.sharpe_3y::numeric,2)::float8 sharpe_3y, round(ma.beta_3y::numeric,2)::float8 beta_3y
  FROM mf_analytics ma JOIN instruments i ON i.amfi_scheme_code=ma.scheme_code
  WHERE i.symbol IN ('NIFTYBEES','SETFNIF50') AND i.asset_class='etf' ORDER BY i.symbol`);
console.table(controls);
const nb = controls.find((c) => c.symbol === "NIFTYBEES");
assertFold("NIFTYBEES is UNCHANGED — it HAS a real split (19-Dec-2019) but it falls OUTSIDE the 5Y " +
  "window, so `exDay > day` is false for every streamed row and the rescale does not execute",
  nb?.ret_3y === 8.84 && nb?.ret_5y === 10.31 && nb?.vol_3y === 13.1 && nb?.maxdd_3y === -15.4,
  `ret_3y ${nb?.ret_3y} (was 8.84) · ret_5y ${nb?.ret_5y} (was 10.31) · vol_3y ${nb?.vol_3y} (was 13.1) · maxDD ${nb?.maxdd_3y} (was -15.4)`);

// ═══ 3 — SPLIT ETFs CORRECTED, AND CORRECTED TO REALITY ═════════════════════
console.log("\n═══ 3 — Split ETFs: the false catastrophe is GONE, and the number matches its index ═══");
console.log("  BEFORE (measured before this step):");
console.log("       HDFCPVTBAN  ret_3y -50.1%  vol_3y 134.0%  maxDD_3y -91.0%  alpha_3y -57.2%");
console.log("       PVTBANIETF  ret_3y -50.1%  vol_3y 133.7%  maxDD_3y -90.7%  alpha_3y -57.1%");
console.log("       NIFTYBETA   ret_3y -49.5%  vol_3y 133.7%  maxDD_3y -90.7%  alpha_3y -57.1%");
console.log("       HDFCNIF100  ret_3y -48.9%  vol_3y 134.5%  maxDD_3y -90.7%  alpha_3y -60.1%\n  AFTER:");
const fixed = await q(`
  SELECT i.symbol, e.ex_date::text ex_date, e.split_factor::float8 AS "×",
         round((ma.ret_3y_cagr*100)::numeric,1) ret_3y,
         round((ma.vol_3y*100)::numeric,1) vol_3y,
         round((ma.max_drawdown_3y*100)::numeric,1) maxdd_3y,
         round(ma.sharpe_3y::numeric,2) sharpe_3y,
         round(ma.beta_3y::numeric,2) beta_3y,
         round((ma.alpha_3y*100)::numeric,1) alpha_3y
  FROM mf_analytics ma
  JOIN instruments i ON i.amfi_scheme_code=ma.scheme_code AND i.asset_class='etf'
  JOIN instrument_corporate_events e ON e.instrument_id=i.id AND e.event_type='split'
  WHERE i.symbol IN ('HDFCPVTBAN','PVTBANIETF','NIFTYBETA','HDFCNIF100','LOWVOLIETF','HDFCNIFIT')
  ORDER BY i.symbol`);
console.table(fixed);

const sane = await one(`
  SELECT count(*)::int total,
         count(*) FILTER (WHERE ma.ret_3y_cagr < -0.25)::int still_neg,
         count(*) FILTER (WHERE ma.vol_3y > 0.6)::int absurd_vol,
         count(*) FILTER (WHERE ma.max_drawdown_3y < -0.60)::int absurd_dd
  FROM mf_analytics ma
  JOIN instruments i ON i.amfi_scheme_code=ma.scheme_code AND i.asset_class='etf'
  JOIN instrument_corporate_events e ON e.instrument_id=i.id AND e.event_type='split'
  WHERE ma.ret_1y > -0.05`);
assertFold("NO split-adjusted ETF still carries an impossible figure (no <-25% 3Y, no >60% vol, no <-60% drawdown)",
  sane.still_neg === 0 && sane.absurd_vol === 0 && sane.absurd_dd === 0,
  `${sane.total} split ETFs · ${sane.still_neg} still catastrophically negative · ${sane.absurd_vol} absurd vol · ${sane.absurd_dd} absurd drawdown`);

// GROUND TRUTH: a bank ETF must track its bank index. This is the "matches reality" test — the
// number is not merely different, it is RIGHT.
console.log("\n  GROUND TRUTH — a split-adjusted ETF vs its OWN index over the same window:");
const truth = await q(`
  SELECT i.symbol, ma.benchmark_index,
         round((ma.ret_3y_cagr*100)::numeric,2) etf_3y,
         round(ma.beta_3y::numeric,2) beta_3y,
         round((ma.alpha_3y*100)::numeric,2) alpha_3y,
         round((ma.tracking_error_3y*100)::numeric,2) te_3y
  FROM mf_analytics ma
  JOIN instruments i ON i.amfi_scheme_code=ma.scheme_code AND i.asset_class='etf'
  JOIN instrument_corporate_events e ON e.instrument_id=i.id AND e.event_type='split'
  WHERE ma.benchmark_index IS NOT NULL AND ma.beta_3y IS NOT NULL
  ORDER BY i.symbol LIMIT 8`);
console.table(truth);
const trackers = await one(`
  SELECT count(*)::int n, count(*) FILTER (WHERE ma.beta_3y BETWEEN 0.85 AND 1.15)::int tracking
  FROM mf_analytics ma
  JOIN instruments i ON i.amfi_scheme_code=ma.scheme_code AND i.asset_class='etf'
  JOIN instrument_corporate_events e ON e.instrument_id=i.id AND e.event_type='split'
  WHERE ma.beta_3y IS NOT NULL`);
assertFold("split-adjusted index ETFs now TRACK their index (beta_3y ≈ 1) — the number is right, not just different. " +
  "Before the fix their betas were distorted (HDFCNIF100 read 1.61) and alpha read -60%",
  trackers.tracking >= Math.floor(trackers.n * 0.7),
  `${trackers.tracking}/${trackers.n} split ETFs have beta_3y within 0.85–1.15 of their index`);

// ── 3b — THE ETFs RECOVERED BY WIDENING THE RECONCILIATION WINDOW ──────────
//
// The first cut tested only {D, D+1}. That was a GUESS at AMFI's application lag; the 63-split census
// MEASURED it as 0–3 PRINTS. 28 splits are applied 2–3 prints after the ex-date, so {D, D+1} could not
// reach them and they went unadjusted; 12 of those fall INSIDE the 5Y window and lost it to the guard.
//
// ⚠️  "RECOVERED" IS A LIST OF NAMES, NOT A LAG THRESHOLD — and that is not laziness, it is the only
//     correct definition. The old bound counted CALENDAR days; the real lag is in PRINTS. HDFCPVTBAN
//     (ex Fri 02-Feb-24, applied Mon 05-Feb-24) is +3 CALENDAR days but only +1 PRINT — the old rule
//     reconciled it to the intervening Saturday, which has no NAV and therefore rescales identically.
//     It was never broken. A `lag_days > 1` filter would sweep it in and quietly inflate this result.
//     These twelve are the ETFs the widening ACTUALLY recovered: previously unreconciled, and with the
//     split inside the 5Y window.
const RECOVERED = [
  "MON100", "BSE500IETF", "ABSLBANETF", "ABSLNN50ET", "BSLGOLDETF", "BSLNIFTY",
  "BSLSENETFG", "QGOLDHALF", "SETFGOLD", "MOLOWVOL", "MOMOMENTUM", "ITIETF",
];
console.log("\n  RECOVERED — split 2–3 PRINTS after the ex-date, inside the 5Y window, unreachable under {D, D+1}:");
const recovered = await q(`
  SELECT i.symbol, e.ex_date::text ex_date, e.applied_date::text applied,
         e.split_factor::int AS "×", ma.benchmark_index,
         round((ma.ret_5y_cagr*100)::numeric,2) ret_5y,
         -- vol_5y is NOT a stored column (it is computed for sharpe_5y and discarded — see
         -- mf-implausible.ts). Reaching for it here crashed this check with ColumnNotFound.
         round((ma.max_drawdown_5y*100)::numeric,1) maxdd_5y,
         round(ma.beta_5y::numeric,2) beta_5y,
         round(ma.sharpe_5y::numeric,2) sharpe_5y,
         ma.omissions->>'ret_5y_cagr' AS withheld_5y
  FROM instrument_corporate_events e
  JOIN instruments i ON i.id = e.instrument_id AND i.asset_class='etf'
  JOIN mf_analytics ma ON ma.scheme_code = i.amfi_scheme_code
  WHERE e.event_type='split' AND i.symbol = ANY($1::text[])
  ORDER BY i.symbol`, RECOVERED);
console.table(recovered);

// ⚠️  A MISSING 5Y IS NOT AUTOMATICALLY A FAILURE — IT DEPENDS ENTIRELY ON THE REASON.
//
//     The first cut of this check demanded all 12 report a 5Y, and went red because MOLOWVOL and
//     MOMOMENTUM do not. They launched in August 2022. They are not five years old. Their 5Y is NULL
//     with the reason `insufficient_history`, which is the honest-empty ledger doing its job — and a
//     harness that demands a number where none can honestly exist is asking the code to fabricate one.
//
//     What must NOT happen is a 5Y withheld as IMPLAUSIBLE. That is the signature of a botched
//     rescale (the boundary off by one manufactures a +900% spike and a -90% crash), and it is what
//     these very ETFs looked like before the window was widened. So: no `withheld_implausible`, and
//     every ETF old enough to have a 5Y must report one.
const rec = await one(`
  SELECT count(*)::int n,
         count(*) FILTER (WHERE e.applied_date IS NOT NULL)::int reconciled,
         count(*) FILTER (WHERE ma.ret_5y_cagr IS NOT NULL)::int has_5y,
         count(*) FILTER (WHERE ma.omissions->>'ret_5y_cagr' = 'withheld_implausible')::int withheld,
         count(*) FILTER (WHERE ma.ret_5y_cagr IS NULL
                            AND ma.omissions->>'ret_5y_cagr' = 'insufficient_history')::int too_young,
         count(*) FILTER (WHERE ma.beta_5y IS NOT NULL)::int has_beta,
         count(*) FILTER (WHERE ma.beta_5y BETWEEN 0.85 AND 1.15)::int tracking,
         count(*) FILTER (WHERE ma.max_drawdown_5y < -0.6 OR ma.ret_5y_cagr < -0.25)::int still_absurd
  FROM instrument_corporate_events e
  JOIN instruments i ON i.id = e.instrument_id AND i.asset_class='etf'
  JOIN mf_analytics ma ON ma.scheme_code = i.amfi_scheme_code
  WHERE e.event_type='split' AND i.symbol = ANY($1::text[])`, RECOVERED);
// The beta test is scoped to the ETFs that HAVE a beta: three of the twelve are GOLD ETFs
// (BSLGOLDETF, QGOLDHALF, SETFGOLD), and gold does not track an equity index — demanding beta ≈ 1 of
// them would be demanding the wrong thing. Their 5Y still has to be sane, which `still_absurd` covers.
assertFold("the RECOVERED ETFs' 5Y window is BACK and it is RIGHT — every one reconciled, NONE withheld as " +
  "implausible, every one old enough reports a 5Y (the rest say `insufficient_history`, which is honest), " +
  "the equity trackers among them have beta_5y ≈ 1 against their OWN index, and none carries an absurd " +
  "figure. A wrong boundary would show up here as a wrecked beta — so this, not the mere presence of a " +
  "number, is the test that the widened window found the TRUE application day",
  rec.n === RECOVERED.length && rec.reconciled === rec.n &&
    rec.withheld === 0 && rec.has_5y + rec.too_young === rec.n &&
    rec.still_absurd === 0 && rec.tracking >= Math.floor(rec.has_beta * 0.7),
  `${rec.reconciled}/${rec.n} reconciled · ${rec.has_5y} report a 5Y · ${rec.too_young} honestly too young ` +
  `(<5y old) · ${rec.withheld} WITHHELD as implausible · ` +
  `${rec.tracking}/${rec.has_beta} equity trackers have beta_5y 0.85–1.15 (3 of the 12 are GOLD — no equity ` +
  `beta) · ${rec.still_absurd} still absurd`);

// A split we could NOT reconcile is still honest-NULL — widening the window did not become "force a fit".
const unrec = await one(`
  SELECT count(*)::int n FROM instrument_corporate_events
  WHERE event_type='split' AND applied_date IS NULL`);
console.log(`\n       ${unrec.n} split(s) reconciled on NONE of the four candidates → still NOT adjusted, still withheld.`);

// ═══ 4 — DISTRIBUTIONS ══════════════════════════════════════════════════════
console.log("\n═══ 4 — Distributions: IDCW inherits its TIER-MATCHED Growth twin — the TRUE figure ═══");
const s109446 = await one(`
  SELECT m.scheme_code, m.plan_option, left(m.scheme_name,44) AS nm,
         round((ma.ret_3y_cagr*100)::numeric,2)::float8 ret_3y,
         ma.omissions->>'ret_3y_cagr' AS why
  FROM mf_family_members m JOIN mf_analytics ma ON ma.scheme_code=m.scheme_code
  WHERE m.scheme_code='109446'`);
const twin = await one(`
  SELECT m2.scheme_code, m2.plan_option, round((ma2.ret_3y_cagr*100)::numeric,2)::float8 ret_3y
  FROM mf_family_members m1
  JOIN mf_family_members m2 ON m2.family_id = m1.family_id
  JOIN mf_analytics ma2 ON ma2.scheme_code = m2.scheme_code
  WHERE m1.scheme_code='109446'
    AND coalesce(m2.plan_option,m2.scheme_name) ILIKE '%growth%'
    AND (coalesce(m2.plan_option,m2.scheme_name) ILIKE '%direct%') =
        (coalesce(m1.plan_option,m1.scheme_name) ILIKE '%direct%')
  LIMIT 1`);
console.log(`       IDCW  ${s109446.scheme_code} "${s109446.plan_option}" → ret_3y ${s109446.ret_3y}%  (was -7.80%)`);
console.log(`       GROWTH twin ${twin?.scheme_code} "${twin?.plan_option}" → ret_3y ${twin?.ret_3y}%`);
assertFold("scheme 109446 (IDCW) now reports its tier-matched Growth twin's TRUE return — it read -7.8% " +
  "against the twin's +11.5%, a 19.3pp lie caused purely by its own payouts",
  s109446.ret_3y !== null && twin?.ret_3y !== null && Math.abs(s109446.ret_3y - twin.ret_3y) < 0.01,
  `IDCW ${s109446.ret_3y}% === Growth twin ${twin?.ret_3y}%`);

// ⚠️  THE TIER IS THREE-VALUED (direct / regular / none) AND "GROWTH" EXCLUDES BONUS.
//
//     The first cut of this check got BOTH wrong, and it went red on a perfectly correct fold. It
//     grouped by a BOOLEAN `is_direct`, which lumps `regular` and `none` into one bucket, then took
//     max() across them. On Invesco India Low Duration:
//
//         tier=regular →  104722, 104723, 104728 (growth), 105024   all report 6.31%   ✓
//         tier=none    →  104725, 104726 (growth), 104729, 105025   all report 6.98%   ✓
//         tier=direct  →  120566, 120568, 120570 (growth), 120571   all report 7.24%   ✓
//
//     Every plan matches ITS OWN tier's Growth twin exactly. The old check compared the Regular plans
//     (6.31%) against max(6.31, 6.98) = 6.98% and called it a leak. That 67bp gap IS THE EXPENSE
//     RATIO — the exact thing tier-matching exists to preserve. A check that collapses the tiers
//     reproduces the very bug the ruling forbids, and then blames the code for not having it.
//
//     It also counted BONUS plans as Growth (/growth/ matches "growth plan + bonus option"), which is
//     the hole this fold closed.
const TIER = `CASE WHEN coalesce(m.plan_option,m.scheme_name) ILIKE '%direct%'  THEN 'direct'
                   WHEN coalesce(m.plan_option,m.scheme_name) ILIKE '%regular%' THEN 'regular'
                   ELSE 'none' END`;
const leak = await one(`
  WITH mem AS (
    SELECT m.family_id, m.scheme_code,
           (coalesce(m.plan_option,m.scheme_name) ILIKE '%growth%'
            AND coalesce(m.plan_option,m.scheme_name) NOT ILIKE '%bonus%') AS is_growth,
           ${TIER} AS tier,
           ma.ret_3y_cagr::float8*100 r3, ma.nav_points np
    FROM mf_family_members m
    JOIN mf_families f ON f.id=m.family_id AND f.asset_class='mutual_fund'
    JOIN mf_analytics ma ON ma.scheme_code=m.scheme_code),
  -- Only LIVE Growth plans are twins, and a slot whose live Growth plans DISAGREE is declined, so it
  -- offers no twin at all. Both are the fold's rules; the check must hold itself to them.
  g AS (SELECT family_id, tier, max(r3) g3, min(r3) lo, count(*)::int n
        FROM mem WHERE is_growth AND np > 0 GROUP BY 1,2)
  SELECT count(*)::int pairs,
         count(*) FILTER (WHERE abs(m.r3 - g.g3) > 0.01)::int mismatched
  FROM mem m JOIN g ON g.family_id=m.family_id AND g.tier=m.tier
  WHERE NOT m.is_growth AND m.r3 IS NOT NULL AND g.g3 IS NOT NULL
    -- an AMBIGUOUS slot (its live Growth plans disagree) offers NO twin, so there is nothing to match
    AND abs(g.g3 - g.lo) <= 0.5`);
assertFold("EVERY distributing plan matches its LIVE, TIER-MATCHED Growth twin exactly — the 3.9pp mean " +
  "/ 19.3pp max distribution leak is gone across the book, not just on the spot-check. Direct↔Direct, " +
  "Regular↔Regular, none↔none: the expense-ratio gap between tiers is PRESERVED, never averaged away",
  leak.mismatched === 0, `${leak.pairs} distributing plans checked · ${leak.mismatched} differ from their twin`);

const idcwNull = await one(`
  SELECT count(*)::int n FROM mf_analytics
  WHERE omissions->>'ret_3y_cagr' = 'idcw_nav_not_total_return'`);
assertFold("IDCW-only funds (no Growth sibling anywhere) are HONEST-NULL with a reason — never a price " +
  "return dressed up as a total return",
  idcwNull.n > 0, `${idcwNull.n} scheme codes honest-NULL with reason idcw_nav_not_total_return`);

// ═══ 5 — THE IMPLAUSIBILITY GUARD: it WITHHOLDS. It never corrects. ═════════
console.log("\n═══ 5 — What we could NOT source, we WITHHELD — we did not infer it ═══");

// BANKIETF: listed, but NSE publishes NO split. Its 5Y window is impossible (maxDD -90.8%); its
// 1Y and 3Y are perfectly good. The guard must take ONE window and leave the other two.
const bank = await one(`
  SELECT (SELECT count(*)::int FROM instrument_corporate_events e
          JOIN instruments i2 ON i2.id=e.instrument_id
          WHERE i2.symbol='BANKIETF' AND e.event_type='split') AS split_events,
         ma.ret_1y IS NOT NULL AS has_1y, ma.ret_3y_cagr IS NOT NULL AS has_3y,
         ma.ret_5y_cagr IS NOT NULL AS has_5y,
         ma.max_drawdown_5y IS NOT NULL AS has_dd5,
         round((ma.ret_3y_cagr*100)::numeric,1)::float8 r3,
         ma.omissions->>'ret_5y_cagr' AS why5
  FROM mf_analytics ma JOIN instruments i ON i.amfi_scheme_code=ma.scheme_code
  WHERE i.symbol='BANKIETF' AND i.asset_class='etf'`);
assertFold("BANKIETF: NSE publishes NO split for it, so it was NOT adjusted — we did not borrow the 1:10 " +
  "its peers all took. Its IMPOSSIBLE 5Y window (max drawdown was -90.8%) is WITHHELD, and its sound " +
  "1Y and 3Y windows SURVIVE",
  bank.split_events === 0 && bank.has_5y === false && bank.has_dd5 === false &&
    bank.has_1y === true && bank.has_3y === true && bank.why5 === "withheld_implausible",
  `0 split events · 5Y withheld (${bank.why5}) · 3Y kept (${bank.r3}%) · 1Y kept`);

const navi = await one(`
  SELECT count(*)::int rows,
         count(*) FILTER (WHERE ma.ret_5y_cagr IS NULL
                            AND ma.omissions->>'ret_5y_cagr'='withheld_implausible')::int w5,
         count(*) FILTER (WHERE ma.ret_3y_cagr IS NOT NULL)::int kept3
  FROM mf_analytics ma JOIN instruments i ON i.amfi_scheme_code=ma.scheme_code
  WHERE i.scheme_name ILIKE 'Navi Liquid%' AND i.asset_class='mutual_fund'`);
assertFold("Navi Liquid (UNLISTED — no exchange publishes its corporate actions, so it can NEVER be " +
  "adjusted): its impossible 5Y window (max drawdown -99% on a LIQUID fund) is WITHHELD, its 3Y kept",
  navi.w5 > 0 && navi.kept3 > 0, `${navi.rows} rows · ${navi.w5} with 5Y withheld · ${navi.kept3} with 3Y kept`);

const guard = await one(`
  SELECT count(DISTINCT scheme_code)::int schemes FROM mf_analytics
  WHERE omissions::text LIKE '%withheld_implausible%'`);
console.log(`\n       ${guard.schemes} schemes have at least one window withheld as physically impossible.`);

// THE UN-WAIVABLE ONE: nothing that was withheld may also carry an inferred CAUSE.
const inferred = await one(`
  SELECT count(*)::int n FROM mf_analytics WHERE omissions::text LIKE '%split_unadjustable%'`);
assert("NO row claims an inferred cause — the retired `split_unadjustable_no_source` (which ASSERTED " +
  "'a split happened we could not source') appears NOWHERE. The ledger says only what we can observe: " +
  "withheld, implausible",
  inferred.n === 0, `${inferred.n} rows naming an inferred cause`);

// Nothing that is still SHIPPED may be impossible.
const leftovers = await one(`
  SELECT count(*)::int n FROM mf_analytics
  WHERE vol_1y > 1.0 OR vol_3y > 1.0
     OR max_drawdown_1y < -0.85 OR max_drawdown_3y < -0.85 OR max_drawdown_5y < -0.85
     OR ret_3y_cagr < -0.6 OR ret_5y_cagr < -0.6`);
assertFold("NO physically-impossible value survives anywhere in the table — not a 134% volatility, not a " +
  "-99% drawdown, not a -60% multi-year CAGR. If we could not fix it from a real event, we did not ship it",
  leftovers.n === 0, `${leftovers.n} impossible values still present`);

// ═══ 6 — NO HEURISTIC: corrections come ONLY from real events ══════════════
console.log("\n═══ 6 — Every CORRECTION came from a real event; the guard only WITHHELD ═══");
const orphan = await one(`
  SELECT count(*)::int n FROM instrument_corporate_events
  WHERE event_type='split' AND (source <> 'nse' OR description IS NULL)`);
assert("every split row is sourced from NSE and carries its subject as evidence — none synthesised, " +
  "none inferred, none hand-entered",
  orphan.n === 0, `${orphan.n} rows without an NSE source + evidence`);

const adjusted = await one(`
  SELECT count(DISTINCT i.amfi_scheme_code)::int n
  FROM instrument_corporate_events e JOIN instruments i ON i.id = e.instrument_id
  WHERE e.event_type='split' AND i.amfi_scheme_code IS NOT NULL`);
console.log(`       ${adjusted.n} schemes CORRECTED — every one from a real, dated NSE corporate action.`);
console.log(`       ${guard.schemes} schemes WITHHELD — no cause claimed, no ratio derived, nothing corrected.`);

// ── 6b — THE RECONCILER, TESTED DIRECTLY. ─────────────────────────────────
//
// The census says the lag is 0–3 prints, so the candidate set is 4 prints wide. The danger of a WIDER
// window is that it stops being a reconciliation and becomes a SEARCH — "slide along until something
// fits". These cases prove it did not: the reconciler is fed synthetic series and must locate the step
// at each real lag, and must DECLINE — not stretch, not pick the closest — when the step is not at any
// of its four event-derived candidates.
console.log("\n═══ 6b — The reconciler itself: it LOCATES a known event, it does not SEARCH for one ═══");
const { reconcileAppliedDay } = await import("../ingestions/corporate-events/instrument-splits.js");

/** A synthetic series: flat at 100, dropping to 100/factor at `stepAtPrint` prints on/after the ex-date.
 *  Prints are consecutive days here; the reconciler locates prints, so day-vs-print never gets conflated. */
const synth = (stepAtPrint: number, factor: number, exDay = 20_000) => {
  const s = new Map<number, number>();
  for (let k = -4; k <= 10; k++) {
    const day = exDay + k;
    const printIdx = k; // print k on/after the ex-date, for k >= 0
    s.set(day, printIdx >= stepAtPrint ? 100 / factor : 100);
  }
  return s;
};
const EX = 20_000;
let reconOk = true;
for (const lag of [0, 1, 2, 3]) {
  const got = reconcileAppliedDay(synth(lag, 10, EX), EX, 10);
  const want = EX + lag;
  const ok = got === want;
  if (!ok) reconOk = false;
  console.log(`       ${ok ? "✓" : "✗"} step at print ${lag} (the MEASURED range) → resolved ${got === null ? "NULL" : `ex+${got - EX}`}, expected ex+${lag}`);
}
assert("the reconciler finds the application day at EVERY lag the census actually measured (0,1,2,3 prints)",
  reconOk, "a split AMFI applied 2 or 3 prints late — 28 of the 63, incl. NIFTYBEES — is now reachable");

// THE ONE THAT MUST DECLINE. A step at print 5 is outside the candidate set. A SEARCH would find it
// anyway; a reconciliation must not.
const beyond = reconcileAppliedDay(synth(5, 10, EX), EX, 10);
assert("a split whose step falls on NONE of the four candidates is DECLINED (null) — the widened window " +
  "is still a bounded reconciliation, not a scan. A step-search would have found this one; we refuse it, " +
  "the fund is left unadjusted, and its impossible windows are withheld",
  beyond === null, `step at print 5 (outside the measured range) → ${beyond === null ? "NULL — declined" : `WRONGLY resolved to ex+${beyond - EX}`}`);

// And the ratio is the EVENT's, never the data's: a series that steps by ×4 when NSE published ×10 is
// not "close enough" — it is unexplained, so it is declined.
const wrongRatio = reconcileAppliedDay(synth(1, 4, EX), EX, 10);
assert("a series whose step does NOT match the PUBLISHED ratio is DECLINED — the factor comes from NSE's " +
  "subject line, never from the shape of the NAV series",
  wrongRatio === null, `series steps ×4, event says ×10 → ${wrongRatio === null ? "NULL — declined" : "WRONGLY accepted"}`);

// ── GREP-GUARD: the source itself must contain no step-search. ─────────────
const { readFileSync } = await import("fs");
const src = readFileSync("src/ingestions/corporate-events/instrument-splits.ts", "utf8");
const body = src.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))   // strip comments — they DISCUSS the forbidden thing
  .join("\n");
// A step-search would have to (a) derive a ratio from the series, or (b) rank/minimise across days.
const banned = [/Math\.max\s*\(/, /Math\.min\s*\(/, /\bsort\s*\(/, /best|closest|largest|biggest|minimi[sz]e/i];
const hits = banned.filter((re) => re.test(body)).map(String);
assert("GREP-GUARD: the reconciliation path contains no ranking, no minimisation, no 'best fit' — the only " +
  "days it reads are the four derived from the event's own ex-date, and the only ratio it tests is the one " +
  "NSE published. Take the event away and this file has nothing to say",
  hits.length === 0, hits.length ? `FORBIDDEN CONSTRUCTS PRESENT: ${hits.join(", ")}` : "no ranking / minimisation / best-fit anywhere in the executable source");

// ═══ 7 — IDEMPOTENCY ═══════════════════════════════════════════════════════
console.log("\n═══ 7 — Idempotent ═══");
const before = (await one(`SELECT count(*)::int n FROM instrument_corporate_events`)).n;
const { ingestInstrumentSplits } = await import("../ingestions/corporate-events/instrument-splits.js");
const re = await ingestInstrumentSplits({ symbols: ["NIFTYBEES", "HDFCPVTBAN", "PVTBANIETF"] });
const after = (await one(`SELECT count(*)::int n FROM instrument_corporate_events`)).n;
assert("re-ingesting the same ETFs inserts NO duplicate rows (the NOT-NULL instrument_id makes the " +
  "unique key actually enforce — a nullable stock_id would have duplicated every row, every run)",
  before === after, `${before} rows → ${after} rows (re-ingested ${re.splitsFound} events, wrote ${re.splitsWritten} in place)`);

console.log(
  `\n${failures === 0 ? "✅ 0 FAILURES" : `❌ ${failures} FAILURE(S)`}` +
    (pending > 0
      ? `  ·  ⏳ ${pending} PENDING (NOT passed — blocked on a fold that AMFI's throttling has ` +
        `prevented from completing). Step 19 is NOT signed off until these run green.`
      : "  ·  nothing pending — Step 19 fully verified."),
);
await prisma.$disconnect();
// A PENDING item is NOT a pass. Exit non-zero so no operator can mistake this for a green run.
process.exit(failures === 0 && pending === 0 ? 0 : 1);
