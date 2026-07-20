// Read-only. Which MF fingerprint is a DURABLE anchor, and which is only a tripwire?
//
// The MF row has two KINDS of column, and conflating them is what makes a harness cry wolf:
//   IDENTITY (the spine)  isin · amfi_scheme_code · scheme_name · fund_house · category ·
//                         plan_type · name · symbol · stock_id
//                         → moves ONLY if AMFI re-issues an identity. A move here is a REGRESSION.
//   THE NAV FEED          current_nav · nav_date · is_active
//                         → moves EVERY NIGHT, by design (that is the entire point of the cron).
//
// Both existing baselines (9a573df8… and 651f6ba0…) hash the NAV columns. So both are destined to
// go red the next time the AMFI cron runs — they are CURRENT-STATE TRIPWIRES, not invariants.
// This prints all three so the refreshed harness can anchor on the right one.
import { prisma } from "../db/prisma.js";
const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);

// (1) The Step-16 Gate-0 expression — the "9a573df8…" baseline the brief cites. NAV-INCLUSIVE.
const step16 = (await q(`
  SELECT count(*)::int n, md5(string_agg(isin||'|'||COALESCE(amfi_scheme_code,'')||'|'||COALESCE(scheme_name,'')||'|'||
    COALESCE(current_nav::text,'')||'|'||COALESCE(nav_date::text,''),'~' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class='mutual_fund'`))[0];

// (2) The Step-13 full-fidelity expression — the "651f6ba0…" baseline. ALSO NAV-inclusive.
const step13 = (await q(`
  SELECT count(*)::int n, md5(string_agg(
    isin || '|' || coalesce(symbol,'~') || '|' || name || '|' || coalesce(amfi_scheme_code,'~') || '|' ||
    coalesce(scheme_name,'~') || '|' || coalesce(fund_house,'~') || '|' || coalesce(category,'~') || '|' ||
    coalesce(plan_type,'~') || '|' || coalesce(current_nav::text,'~') || '|' ||
    coalesce(nav_date::text,'~') || '|' || is_active::text,
    ',' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class = 'mutual_fund'`))[0];

// (3) THE DURABLE ONE — identity only. Survives every nightly NAV refresh; still catches a lost
//     ISIN, a rewritten scheme code, a fabricated ticker, or an MF that acquired a stock_id.
const identity = (await q(`
  SELECT count(*)::int n, md5(string_agg(
    isin || '|' || coalesce(amfi_scheme_code,'~') || '|' || coalesce(scheme_name,'~') || '|' ||
    coalesce(fund_house,'~') || '|' || coalesce(category,'~') || '|' || coalesce(plan_type,'~') || '|' ||
    name || '|' || coalesce(symbol,'~') || '|' || coalesce(stock_id,'~'),
    ',' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class = 'mutual_fund'`))[0];

const WANT_16 = "9a573df845df745ffe74277aff455734";
const WANT_13 = "651f6ba0132b4dc0657e611bb9559969";

console.log(`(1) Step-16 Gate-0 expr (NAV-inclusive)  ${step16.n} rows  ${step16.fp}`);
console.log(`      baseline 9a573df8…  →  ${step16.fp === WANT_16 ? "✅ IDENTICAL — the MF spine has not moved" : "❌ MOVED"}`);
console.log(`(2) Step-13 full-fidelity (NAV-inclusive) ${step13.n} rows  ${step13.fp}`);
console.log(`      baseline 651f6ba0…  →  ${step13.fp === WANT_13 ? "✅ IDENTICAL" : "❌ MOVED"}`);
console.log(`(3) IDENTITY-ONLY (NAV columns excluded)  ${identity.n} rows  ${identity.fp}`);
console.log(`      ← the DURABLE anchor. Unmoved by the nightly NAV cron; still red on a real spine break.`);

// Prove claim (3) is not vacuous: the NAV columns really are live, and really are excluded.
const nav = (await q(`
  SELECT min(nav_date)::text mn, max(nav_date)::text mx, count(DISTINCT nav_date)::int days,
         count(*) FILTER (WHERE is_active)::int active, count(*) FILTER (WHERE NOT is_active)::int stale
  FROM instruments WHERE asset_class='mutual_fund'`))[0];
console.log(`\n  the NAV feed those two tripwires hash: nav_date ${nav.mn} → ${nav.mx} (${nav.days} distinct dates),`);
console.log(`  is_active ${nav.active} active / ${nav.stale} stale. EVERY ONE of these moves on the next AMFI run —`);
console.log(`  which is exactly why (1) and (2) are tripwires and (3) is the invariant.`);

await prisma.$disconnect();
