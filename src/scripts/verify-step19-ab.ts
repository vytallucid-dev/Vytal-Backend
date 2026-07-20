// ─────────────────────────────────────────────────────────────────────────────
// STEP 19 — A/B FINGERPRINT.  npx tsx src/scripts/verify-step19-ab.ts before|after
//
// THE UN-WAIVABLE CLAIM: a fund with NO split and NO distribution problem has IDENTICAL metrics
// before and after Step 19. The split rescale is not "a no-op we assert" — for a scheme with no
// event it is code that DOES NOT EXECUTE (the scheme is not in the split map). This proves it.
//
// THE CONTROL SET is chosen so that a moved byte can only mean a bug:
//   · NO real split event  → the series rescale cannot have touched it
//   · NOT an IDCW plan     → distribution inheritance cannot have touched it
// Everything left MUST be byte-identical. Anything that legitimately moves (split ETFs, IDCW
// plans) is deliberately OUTSIDE this set — a fingerprint that moves for a correct reason cannot
// answer "did we break something?".
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const mode = process.argv[2];
if (mode !== "before" && mode !== "after") {
  console.error("usage: verify-step19-ab.ts before|after");
  process.exit(2);
}

// ── THE CONTROL SET ──
// A scheme belongs here ONLY if NONE of Step 19's three mechanisms can legitimately touch it. Each
// exclusion below removes a population that Step 19 is SUPPOSED to move — leaving a set where a
// single moved byte can only mean a bug.
//
//   (1) has a REAL split event      → the series rescale may touch it
//   (2) is a non-Growth MF plan     → distribution inheritance may touch it
//   (3) holds a PHYSICALLY IMPOSSIBLE value → the implausibility guard will withhold it
//
// (3) was very nearly missed, and it would have silently voided this whole proof: the guard fires on
// GROWTH MFs too (Navi Liquid Growth, UTI Liquid Growth, the wound-up Franklin funds), which (1) and
// (2) both let through. The fingerprint would have moved for an entirely CORRECT reason, and a
// fingerprint that moves when the code is right cannot tell you when the code is wrong.
//
// The bounds below are EXACTLY those in mf-implausible.ts. If they drift apart, this proof lies.
// ⚠️  THE EXCLUSION MUST SELECT THE SAME SCHEMES BEFORE AND AFTER, OR THE FINGERPRINT IS A LIE.
//
//     A first attempt tested implausibility BY VALUE only. That is correct BEFORE the fold — but
//     AFTER it, the guard has WITHHELD those very values (they are NULL now), so the schemes stop
//     looking implausible and RE-ENTER the control set. Membership went 5,359 → 5,397, and a
//     fingerprint over a different set of rows cannot answer "did anything move?".
//
//     So a scheme is excluded if it is implausible BY VALUE (how it looks before) **OR** it carries
//     the guard's reason code (how it looks after). Those pick out the same 5,359 schemes in both
//     states — which is the only way this comparison means anything.
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
  -- IS NOT TRUE, not NOT(...). Postgres is three-valued: a young fund has a NULL vol_3y, so the
  -- OR-chain evaluates to NULL, and NOT NULL is NULL — which WHERE treats as false and SILENTLY
  -- DROPS the row. That trap cut the control set from 5,397 to 1,802: the "proof" would have passed
  -- by quietly testing a third of the book. IS NOT TRUE maps NULL to true, which is what we mean.
  AND ${IMPLAUSIBLE} IS NOT TRUE`;

// `instruments` carries up to 2 ISINs per scheme code, so a naive join would DOUBLE-COUNT half the
// book inside string_agg and produce a hash that means nothing. One row per code, deliberately.
const FP = `
  WITH i AS (
    SELECT DISTINCT ON (amfi_scheme_code)
           amfi_scheme_code AS code, category, scheme_name
    FROM instruments
    WHERE amfi_scheme_code IS NOT NULL AND asset_class IN ('mutual_fund','etf')
    ORDER BY amfi_scheme_code, isin
  )
  SELECT count(*)::int n, md5(string_agg(
    ma.scheme_code || '|' || ma.nav_points::text || '|' ||
    coalesce(ma.ret_1m::text,'~') || coalesce(ma.ret_3m::text,'~') || coalesce(ma.ret_6m::text,'~') ||
    coalesce(ma.ret_1y::text,'~') || coalesce(ma.ret_3y_cagr::text,'~') || coalesce(ma.ret_5y_cagr::text,'~') || '|' ||
    coalesce(ma.vol_1y::text,'~') || coalesce(ma.vol_3y::text,'~') || '|' ||
    coalesce(ma.sharpe_1y::text,'~') || coalesce(ma.sharpe_3y::text,'~') || coalesce(ma.sharpe_5y::text,'~') ||
    coalesce(ma.sortino_1y::text,'~') || coalesce(ma.sortino_3y::text,'~') || '|' ||
    coalesce(ma.max_drawdown_1y::text,'~') || coalesce(ma.max_drawdown_3y::text,'~') || coalesce(ma.max_drawdown_5y::text,'~') || '|' ||
    coalesce(ma.roll_1y_n::text,'~') || coalesce(ma.roll_1y_min::text,'~') || coalesce(ma.roll_1y_max::text,'~') ||
    coalesce(ma.roll_1y_avg::text,'~') || coalesce(ma.roll_1y_pct_positive::text,'~') || '|' ||
    coalesce(ma.beta_1y::text,'~') || coalesce(ma.beta_3y::text,'~') || coalesce(ma.beta_5y::text,'~') ||
    coalesce(ma.alpha_1y::text,'~') || coalesce(ma.alpha_3y::text,'~') || coalesce(ma.alpha_5y::text,'~') ||
    coalesce(ma.tracking_error_1y::text,'~') || coalesce(ma.tracking_error_3y::text,'~') || coalesce(ma.tracking_error_5y::text,'~'),
    ',' ORDER BY ma.scheme_code)) AS fp
  FROM mf_analytics ma
  JOIN i ON i.code = ma.scheme_code
  WHERE ${CONTROL}`;

const [r] = await prisma.$queryRawUnsafe<any[]>(FP);
console.log(`\n═══ STEP 19 A/B — ${mode.toUpperCase()} ═══`);
console.log(`  control set (un-split AND not-IDCW) : ${r.n} schemes`);
console.log(`  FP_CONTROL = ${r.fp}`);

// The two named controls the ruling calls out.
const named = await prisma.$queryRawUnsafe<any[]>(`
  SELECT i.symbol,
         round((ma.ret_3y_cagr*100)::numeric,2) ret_3y,
         round((ma.ret_5y_cagr*100)::numeric,2) ret_5y,
         round((ma.vol_3y*100)::numeric,1) vol_3y,
         round((ma.max_drawdown_3y*100)::numeric,1) maxdd_3y,
         round(ma.sharpe_3y::numeric,2) sharpe_3y, round(ma.beta_3y::numeric,2) beta_3y
  FROM mf_analytics ma JOIN instruments i ON i.amfi_scheme_code=ma.scheme_code
  WHERE i.symbol IN ('NIFTYBEES','SETFNIF50') AND i.asset_class='etf' ORDER BY i.symbol`);
console.log("\n  named byte-identical controls (NIFTYBEES split 2019 = outside every window; SETFNIF50 never split):");
console.table(named);

await prisma.$disconnect();
