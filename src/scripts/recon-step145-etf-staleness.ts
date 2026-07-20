// STEP 14.5 — GATE 0b. THE ETF NAV STALENESS QUESTION (read-only).
//
// Gate 0a: 318 of 337 ETFs carry a nav_date older than the newest (2026-07-12); the oldest is
// 2025-04-15. If we value a held ETF at a NAV that old and print it as "current value", we have
// done precisely the thing this codebase refuses to do — shown a stale price as a live one.
//
// So: HOW stale, actually? "One business day behind" is normal and fine. "Fifteen months behind"
// is a dead fund. The answer decides whether the ETF read needs a staleness gate.
import { prisma } from "../db/prisma.js";

const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));

console.log("── ETF nav_date histogram (how far behind the newest NAV date is each ETF?) ──");
console.log(
  J(
    await q(`
    WITH mx AS (SELECT max(nav_date) d FROM instruments WHERE asset_class='etf')
    SELECT (SELECT d FROM mx)::text AS newest_nav_date,
           (mx.d - i.nav_date) AS days_behind,
           count(*)::int AS etfs,
           count(*) FILTER (WHERE i.is_active)::int AS active
      FROM instruments i, mx
     WHERE i.asset_class='etf'
     GROUP BY 2, mx.d
     ORDER BY 2`),
  ),
);

console.log("\n── The same, bucketed ──");
console.log(
  J(
    await q(`
    WITH mx AS (SELECT max(nav_date) d FROM instruments WHERE asset_class='etf')
    SELECT CASE
             WHEN (mx.d - i.nav_date) <= 4  THEN 'a · within 4 days (normal — weekend/holiday lag)'
             WHEN (mx.d - i.nav_date) <= 30 THEN 'b · 5-30 days'
             WHEN (mx.d - i.nav_date) <= 90 THEN 'c · 1-3 months'
             ELSE                                'd · OVER 3 MONTHS (dead / delisted?)'
           END AS bucket,
           count(*)::int etfs,
           count(*) FILTER (WHERE i.is_active)::int active,
           min(i.nav_date)::text oldest
      FROM instruments i, mx
     WHERE i.asset_class='etf'
     GROUP BY 1 ORDER BY 1`),
  ),
);

console.log("\n── The genuinely stale ones — who are they? ──");
console.log(
  J(
    await q(`
    WITH mx AS (SELECT max(nav_date) d FROM instruments WHERE asset_class='etf')
    SELECT i.symbol, i.name, i.nav_date::text, i.current_nav::text, i.is_active
      FROM instruments i, mx
     WHERE i.asset_class='etf' AND (mx.d - i.nav_date) > 30
     ORDER BY i.nav_date
     LIMIT 12`),
  ),
);

console.log("\n── And the MF population, for the same question (Step 9 measured 44.8% stale) ──");
console.log(
  J(
    await q(`
    WITH mx AS (SELECT max(nav_date) d FROM instruments WHERE asset_class='mutual_fund')
    SELECT CASE
             WHEN (mx.d - i.nav_date) <= 4  THEN 'a · within 4 days'
             WHEN (mx.d - i.nav_date) <= 30 THEN 'b · 5-30 days'
             WHEN (mx.d - i.nav_date) <= 90 THEN 'c · 1-3 months'
             ELSE                                'd · OVER 3 MONTHS'
           END AS bucket,
           count(*)::int mfs,
           count(*) FILTER (WHERE i.is_active)::int active
      FROM instruments i, mx
     WHERE i.asset_class='mutual_fund'
     GROUP BY 1 ORDER BY 1`),
  ),
);

console.log("\n── is_active vs staleness: does is_active ALREADY encode 'this NAV is dead'? ──");
console.log(
  J(
    await q(`
    WITH mx AS (SELECT max(nav_date) d FROM instruments WHERE asset_class IN ('etf','mutual_fund'))
    SELECT i.asset_class::text ac, i.is_active,
           count(*)::int rows,
           min(i.nav_date)::text oldest_nav,
           max(i.nav_date)::text newest_nav
      FROM instruments i, mx
     WHERE i.asset_class IN ('etf','mutual_fund')
     GROUP BY 1,2 ORDER BY 1,2`),
  ),
);

await prisma.$disconnect();
