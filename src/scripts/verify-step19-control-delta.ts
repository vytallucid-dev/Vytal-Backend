// ═══════════════════════════════════════════════════════════════════════════
// WHY FP_CONTROL MOVED — and why that is CORRECT, not a break.
//
// The A/B control set is "no split AND not-IDCW AND not-implausible": a population Step 19 must not
// be able to touch, so a single moved byte can only mean a bug. FP_CONTROL went
// 47bd8e65124e1b7eacf40968a7d319f4 → 5fa370d5f720bb3d918a52d4f59ba786 across this fold, with the
// membership UNCHANGED at 5,359 schemes.
//
// THE CONTROL PREDICATE HAS A HOLE, AND IT IS THE SAME HOLE THE FIX CLOSED. It decides "is this a
// Growth plan?" with `plan_option NOT ILIKE '%growth%'` — and Nippon names the TIER "Growth Plan" and
// the OPTION "Bonus Option", so "growth plan + bonus option" MATCHES and a BONUS plan is admitted to
// the control set as though it were a Growth plan. The whole point of this fold is that a bonus plan
// is NOT a total-return series: a bonus issue steps its NAV down exactly like a split. So those
// schemes are now (correctly) inheriting from their real Growth twin, and the fingerprint moves.
//
// A fingerprint that moves when the code is RIGHT cannot tell you when the code is WRONG. So this
// script does the only thing that can rescue the proof: it enumerates EVERY control-set scheme the
// new code can legitimately move, and shows there is nothing else it could have been.
// ═══════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
let fails = 0;
const ok = (c: boolean, msg: string, detail = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${msg}${detail ? `\n       ${detail}` : ""}`);
  if (!c) fails++;
};

// The control set, VERBATIM from verify-step19-ab.ts.
const IMPLAUSIBLE = `(
     ma.omissions::text LIKE '%withheld_implausible%'
  OR ma.vol_1y > 1.0 OR ma.vol_3y > 1.0
  OR ma.max_drawdown_1y < -0.85 OR ma.max_drawdown_3y < -0.85 OR ma.max_drawdown_5y < -0.85
  OR ma.ret_3y_cagr < -0.6 OR ma.ret_5y_cagr < -0.6
  OR (   (i.category ILIKE '%liquid%' OR i.category ILIKE '%overnight%' OR i.category ILIKE '%money market%'
          OR i.scheme_name ILIKE '%liquid%' OR i.scheme_name ILIKE '%overnight%' OR i.scheme_name ILIKE '%money market%')
     AND (ma.ret_1m < -0.1 OR ma.ret_3m < -0.1 OR ma.ret_6m < -0.1
       OR ma.ret_1y < -0.1 OR ma.ret_3y_cagr < -0.1 OR ma.ret_5y_cagr < -0.1))
)`;
const CONTROL = `
  ma.scheme_code NOT IN (
    SELECT i2.amfi_scheme_code FROM instrument_corporate_events e
    JOIN instruments i2 ON i2.id = e.instrument_id
    WHERE e.event_type='split' AND i2.amfi_scheme_code IS NOT NULL)
  AND ma.scheme_code NOT IN (
    SELECT m.scheme_code FROM mf_family_members m
    JOIN mf_families f ON f.id = m.family_id
    WHERE f.asset_class='mutual_fund'
      AND coalesce(m.plan_option, m.scheme_name) NOT ILIKE '%growth%')
  AND ${IMPLAUSIBLE} IS NOT TRUE`;

console.log(`\n═══ WHY FP_CONTROL MOVED ═══`);

// ── 1. Membership is unchanged — nothing entered or left the set. ──
const size = (await q(`
  SELECT count(*)::int n FROM mf_analytics ma
  JOIN (SELECT DISTINCT ON (amfi_scheme_code) amfi_scheme_code code, category, scheme_name
        FROM instruments WHERE amfi_scheme_code IS NOT NULL AND asset_class IN ('mutual_fund','etf')
        ORDER BY amfi_scheme_code, isin) i ON i.code = ma.scheme_code
  WHERE ${CONTROL}`))[0];
ok(size.n === 5359, "the control set still holds EXACTLY the same 5,359 schemes — nothing entered, nothing left",
  `${size.n} schemes (a fingerprint over a DIFFERENT set of rows would answer nothing)`);

// ── 2. The ONLY control members the new code can move: BONUS plans. ──
// The control predicate admits them (they contain the word "growth"); the fold now correctly refuses
// to treat them as a total-return series, so they inherit from their real Growth twin.
const movers = await q(`
  SELECT ma.scheme_code, left(m.scheme_name, 56) nm, m.plan_option,
         round((ma.ret_1y*100)::numeric,2)::float8 r1, round((ma.ret_3y_cagr*100)::numeric,2)::float8 r3
  FROM mf_analytics ma
  JOIN (SELECT DISTINCT ON (amfi_scheme_code) amfi_scheme_code code, category, scheme_name
        FROM instruments WHERE amfi_scheme_code IS NOT NULL AND asset_class IN ('mutual_fund','etf')
        ORDER BY amfi_scheme_code, isin) i ON i.code = ma.scheme_code
  JOIN mf_family_members m ON m.scheme_code = ma.scheme_code
  WHERE ${CONTROL}
    AND coalesce(m.plan_option, m.scheme_name) ILIKE '%bonus%'
  ORDER BY ma.scheme_code`);
console.log(`\n  control-set members that are BONUS plans (the ONLY ones the fix can touch): ${movers.length}`);
for (const r of movers.slice(0, 12)) {
  console.log(`     ${r.scheme_code}  r1y=${r.r1 === null ? "NULL" : r.r1 + "%"}  r3y=${r.r3 === null ? "NULL" : r.r3 + "%"}  "${r.nm}"`);
}
if (movers.length > 12) console.log(`     … and ${movers.length - 12} more`);

// ── 3. And each one now carries EXACTLY its TIER-MATCHED Growth twin's figure. ──
//
// ⚠️  THE TIER IS THREE-VALUED (direct / regular / none), NOT A BOOLEAN — and the first cut of this
//     check got that wrong, collapsing `regular` and `none` into one bucket with an is_direct flag.
//     It then reported HSBC Short Duration's bonus plan as a MISMATCH. It is not one:
//
//         151062  "HSBC Short Duration Fund - Bonus"           tier=NONE   (AMFI never says which plan)
//         151065  "HSBC Short Duration Fund - Regular Growth"  tier=regular  r1y 5.21%
//         151067  "HSBC Short Duration Fund - Direct Growth"   tier=direct   r1y 5.53%
//
//     There is no tier=none Growth plan, so the bonus plan honest-NULLs — correctly. That 32bp gap
//     between 5.53% and 5.21% IS the expense ratio, and handing the bonus plan either figure would be
//     guessing which share class it belongs to when AMFI declined to say. The fold refuses. So must
//     this check.
const TIER = `CASE WHEN coalesce(m.plan_option,m.scheme_name) ILIKE '%direct%'  THEN 'direct'
                   WHEN coalesce(m.plan_option,m.scheme_name) ILIKE '%regular%' THEN 'regular'
                   ELSE 'none' END`;
const matched = (await q(`
  WITH mem AS (
    SELECT m.family_id, m.scheme_code,
           (coalesce(m.plan_option,m.scheme_name) ILIKE '%growth%'
            AND coalesce(m.plan_option,m.scheme_name) NOT ILIKE '%bonus%') AS true_growth,
           (coalesce(m.plan_option,m.scheme_name) ILIKE '%bonus%') AS is_bonus,
           ${TIER} AS tier,
           ma.ret_1y::float8 r1, ma.nav_points np
    FROM mf_family_members m
    JOIN mf_families f ON f.id=m.family_id AND f.asset_class='mutual_fund'
    JOIN mf_analytics ma ON ma.scheme_code=m.scheme_code),
  g AS (SELECT family_id, tier, max(r1) r1 FROM mem WHERE true_growth AND np > 0 GROUP BY 1,2)
  SELECT count(*)::int pairs,
         count(*) FILTER (WHERE b.r1 IS NOT DISTINCT FROM g.r1)::int agree
  FROM mem b JOIN g ON g.family_id=b.family_id AND g.tier=b.tier
  WHERE b.is_bonus`))[0];
ok(matched.pairs > 0 && matched.agree === matched.pairs,
  "EVERY bonus plan with a LIVE, TIER-MATCHED Growth twin now reports that twin's figure EXACTLY — " +
  "the bonus NAV (stepped down by every bonus issue) is no longer being served as a total return",
  `${matched.agree}/${matched.pairs} bonus plans match their tier-matched Growth twin to the last digit`);

// ── 4. Nothing ELSE in the control set could have moved. ──
//
// A control scheme has no split (so no rescale) and is not implausible (so no withhold). The only
// remaining way its bytes could move is the distribution pass — and that pass CANNOT REACH an ETF at
// all: `loadMfSchemeCodes()` fences it (`if (!mfCodes.has(c.schemeCode)) continue`). An ETF has one
// class of unit, its NAV retains everything, and it is already a total-return series.
//
// (The first cut of this check missed the fence and counted 255 ETFs as "reachable" — they carry a
// NULL plan_option, so a NOT ILIKE '%growth%' test trips on them. They are not reachable.)
const reachable = (await q(`
  SELECT count(*)::int n
  FROM mf_analytics ma
  JOIN (SELECT DISTINCT ON (amfi_scheme_code) amfi_scheme_code code, category, scheme_name
        FROM instruments WHERE amfi_scheme_code IS NOT NULL AND asset_class IN ('mutual_fund','etf')
        ORDER BY amfi_scheme_code, isin) i ON i.code = ma.scheme_code
  JOIN mf_family_members m ON m.scheme_code = ma.scheme_code
  JOIN mf_families f ON f.id = m.family_id AND f.asset_class = 'mutual_fund'   -- ETFs are FENCED OUT
  WHERE ${CONTROL}
    AND coalesce(m.plan_option, m.scheme_name) NOT ILIKE '%bonus%'
    AND coalesce(m.plan_option, m.scheme_name) NOT ILIKE '%growth%'`))[0];
ok(reachable.n === 0,
  "among MUTUAL FUNDS, control ∖ bonus contains NO non-Growth plan — so the distribution pass cannot " +
  "reach one of them, and the split rescale cannot either (they have no split event). ETFs in the set " +
  "are fenced out of the distribution pass entirely. There is no third way for a control scheme to move",
  `${reachable.n} MF control members reachable by the distribution pass other than the bonus plans`);

// ── 5. The named byte-identical controls, against their RECORDED pre-fix values. ──
const named = await q(`
  SELECT i.symbol,
         round((ma.ret_3y_cagr*100)::numeric,2)::float8 r3, round((ma.ret_5y_cagr*100)::numeric,2)::float8 r5,
         round((ma.vol_3y*100)::numeric,1)::float8 v3, round((ma.max_drawdown_3y*100)::numeric,1)::float8 dd3
  FROM mf_analytics ma JOIN instruments i ON i.amfi_scheme_code=ma.scheme_code
  WHERE i.symbol IN ('NIFTYBEES','SETFNIF50') AND i.asset_class='etf' ORDER BY i.symbol`);
const nb = named.find((x) => x.symbol === "NIFTYBEES");
ok(nb?.r3 === 8.84 && nb?.r5 === 10.31 && nb?.v3 === 13.1 && nb?.dd3 === -15.4,
  "NIFTYBEES is BYTE-IDENTICAL to its recorded pre-fix values — it HAS a real split (Dec-2019) but it " +
  "falls outside every window, so the rescale is code that does not execute",
  `ret_3y ${nb?.r3} (8.84) · ret_5y ${nb?.r5} (10.31) · vol_3y ${nb?.v3} (13.1) · maxDD ${nb?.dd3} (-15.4)`);

console.log(
  `\n  ⇒ FP_CONTROL moved for EXACTLY ONE reason: ${movers.length} bonus plans that the control ` +
  `predicate\n    wrongly counts as Growth (because "Growth Plan" is Nippon's TIER name) are now ` +
  `correctly\n    inheriting their real Growth twin's total return. Nothing else in the set can move.`);
console.log(`\n${fails === 0 ? "✅ THE MOVE IS FULLY ACCOUNTED FOR" : `❌ ${fails} UNEXPLAINED`}`);
await prisma.$disconnect();
process.exit(fails === 0 ? 0 : 1);
