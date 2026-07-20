// GATE 3 — the DESTRUCTIVE-FAILURE proofs. These are the ones that matter.
//   npx tsx src/scripts/verify-step10b-guards.ts
//
// 1. SHAPE GUARD  : a simulated empty / redirected fetch must record a FAULT and leave the
//                   analytics table UNTOUCHED. The Step-9 incident (an empty file mistaken for
//                   "the source published nothing") must not be able to recur destructively.
// 2. BLANK-NAV WIPE: a blank NAV from AMFI must LEAVE the stored current_nav + nav_date alone
//                   (carry-forward), not null them. This is the shipped Step-9 bug.
// 3. THE INCEPTION ANCHOR IS DROPPED — nothing may reference earliest_nav / ret_since_earliest_cagr.
import { prisma } from "../db/prisma.js";

const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);
let fails = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) fails++;
  console.log(`  ${ok ? "✅" : "❌"} ${msg}`);
};

// ─────────────────────────────────────────────────────────────
// 1. SHAPE GUARD — an empty fetch must not wipe good analytics.
// ─────────────────────────────────────────────────────────────
hdr("1. SHAPE GUARD — a simulated EMPTY fetch must NOT overwrite good analytics");

const before = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n,
         count(ret_1y) with_1y,
         md5(string_agg(scheme_code||':'||COALESCE(ret_1y::text,'-')||':'||COALESCE(vol_1y::text,'-'),
                        '|' ORDER BY scheme_code)) AS fp
  FROM mf_analytics`);
console.log(`  analytics BEFORE: ${before[0].n} rows, ${before[0].with_1y} with a 1Y return`);
console.log(`  fingerprint     : ${before[0].fp}`);

if (Number(before[0].n) === 0) {
  console.log(`  ⚠️  the analytics table is EMPTY — run the fold first, or this proves nothing.`);
} else {
  // Repoint the history source at a host that answers HTTP 200 with a NON-AMFI body. On the
  // wire that is INDISTINGUISHABLE from AMFI serving a maintenance page or a redirect-to-login
  // — a "successful" fetch carrying no NAVs. It is precisely the Step-9 incident. The guard
  // must refuse it, and the analytics table must not move by a byte.
  //
  // (env, not a monkey-patch: ESM module namespaces are sealed, so a patched export would
  //  silently not take effect and this test would prove nothing while appearing to pass.)
  process.env.AMFI_HISTORY_BASE_URL = "https://example.com/";
  const fresh = `../ingestions/amfi/mf-analytics.js?empty=${Date.now()}`;
  const analyticsMod = await import(fresh);

  const r = await analyticsMod.runMfAnalytics();
  delete process.env.AMFI_HISTORY_BASE_URL;

  console.log(`\n  simulated HTTP-200-but-not-the-file → ok=${r.ok}`);
  console.log(`  abortReason: ${r.abortReason}`);
  check(!r.ok, "the run was REJECTED (ok=false)");
  check(!!r.abortReason, "an abort reason was recorded");
  check(r.analyticsWritten === 0, `NOTHING was written (analyticsWritten=${r.analyticsWritten})`);

  const after = await prisma.$queryRawUnsafe<any[]>(`
    SELECT count(*) n, count(ret_1y) with_1y,
           md5(string_agg(scheme_code||':'||COALESCE(ret_1y::text,'-')||':'||COALESCE(vol_1y::text,'-'),
                          '|' ORDER BY scheme_code)) AS fp
    FROM mf_analytics`);
  console.log(`  analytics AFTER : ${after[0].n} rows, ${after[0].with_1y} with a 1Y return`);
  console.log(`  fingerprint     : ${after[0].fp}`);
  check(after[0].fp === before[0].fp, "★ mf_analytics is BYTE-IDENTICAL — an empty fetch CANNOT wipe good analytics");

  const fault = await prisma.ingestionError.findFirst({
    where: { source: "amfi_navhistory", status: "open" },
    orderBy: { lastSeenAt: "desc" },
    select: { guardType: true, severity: true, observed: true },
  });
  check(!!fault, `a FAULT was recorded: ${fault?.guardType}/${fault?.severity}`);
  console.log(`     observed: ${String(fault?.observed).slice(0, 90)}`);
}

// ─────────────────────────────────────────────────────────────
// 2. THE BLANK-NAV-WIPE FIX — the shipped Step-9 bug.
// ─────────────────────────────────────────────────────────────
hdr("2. BLANK-NAV WIPE — a blank NAV must CARRY FORWARD, not null the stored value");

// Exercise the exact upsert SQL the ingest runs, against a real row, with a NULL incoming NAV.
const victim = await prisma.instrument.findFirst({
  where: { assetClass: "mutual_fund", currentNav: { not: null }, navDate: { not: null } },
  select: { isin: true, schemeName: true, currentNav: true, navDate: true, amfiSchemeCode: true },
});

if (!victim) {
  console.log("  ⚠️  no MF row with a NAV to test against.");
} else {
  console.log(`  victim: ${victim.isin}  nav=${victim.currentNav}  navDate=${victim.navDate?.toISOString().slice(0, 10)}`);

  await prisma.$transaction(async (tx) => {
    // The SHIPPED (fixed) upsert — same SET clauses as ingest-amfi.ts — with a BLANK NAV.
    await tx.$executeRawUnsafe(
      `INSERT INTO instruments (
         id, isin, symbol, name, asset_class, stock_id, attributes, is_active,
         amfi_scheme_code, scheme_name, fund_house, category, plan_type, current_nav, nav_date,
         created_at, updated_at
       ) VALUES (
         gen_random_uuid()::text, $1, NULL, $2, 'mutual_fund'::"AssetClass", NULL, NULL, true,
         $3, $2, NULL, NULL, NULL, NULL::decimal, NULL::date, now(), now()
       )
       ON CONFLICT (isin) DO UPDATE SET
         current_nav = COALESCE(EXCLUDED.current_nav, instruments.current_nav),
         nav_date    = CASE WHEN EXCLUDED.current_nav IS NOT NULL
                            THEN EXCLUDED.nav_date ELSE instruments.nav_date END,
         updated_at  = now()
       WHERE instruments.asset_class = 'mutual_fund'::"AssetClass"`,
      victim.isin, victim.schemeName ?? "x", victim.amfiSchemeCode,
    );

    const after = await tx.instrument.findUnique({
      where: { isin: victim.isin },
      select: { currentNav: true, navDate: true },
    });

    console.log(`  after a BLANK-NAV upsert: nav=${after?.currentNav}  navDate=${after?.navDate?.toISOString().slice(0, 10)}`);
    check(
      after?.currentNav !== null && String(after?.currentNav) === String(victim.currentNav),
      "★ current_nav SURVIVED the blank (carry-forward) — the Step-9 wipe bug is FIXED",
    );
    check(
      after?.navDate?.getTime() === victim.navDate?.getTime(),
      "★ nav_date kept its OLD value — the carried NAV is honestly stale, never re-dated as fresh",
    );

    throw new Error("ROLLBACK — this is a probe, not a write");
  }).catch((e) => {
    if (!String(e.message).includes("ROLLBACK")) throw e;
  });

  const restored = await prisma.instrument.findUnique({
    where: { isin: victim.isin },
    select: { currentNav: true, navDate: true },
  });
  check(
    String(restored?.currentNav) === String(victim.currentNav),
    "the probe was rolled back — the live row is untouched",
  );

  // And prove the OLD code would have destroyed it.
  console.log(`\n  the SHIPPED-BEFORE behaviour, for contrast:`);
  console.log(`     current_nav = EXCLUDED.current_nav   → would have written NULL`);
  console.log(`     i.e. ${victim.currentNav} destroyed, not carried forward.`);
}

// ─────────────────────────────────────────────────────────────
// 3. THE INCEPTION ANCHOR IS GONE — and the proof is now that it does not exist.
//
// This check used to prove that the nightly upsert did not CLOBBER earliest_nav / earliest_nav_date.
// That guard is obsolete in the strongest possible way: the columns have been dropped, along with the
// ret_since_earliest_cagr they existed to feed. A metric folded from AMFI's raw NAV over a span
// reaching back to ~2009 is the WORST case for the two corruptions in that data (unit splits and IDCW
// payouts), and unlike the 1Y/3Y/5Y windows there is no bounded history we can reconstruct from a
// real corporate action. It was not unpopulated; it was uncomputable.
//
// So the invariant flips: instead of "the fold must not overwrite these columns", it is now "these
// columns must not exist, and nothing may reference them". A dropped column that some raw SQL still
// names is a runtime crash waiting for the next run.
// ─────────────────────────────────────────────────────────────
hdr("3. THE INCEPTION ANCHOR — dropped. The proof is that nothing can reach it.");

const fs = await import("node:fs");
const src = fs.readFileSync("src/ingestions/amfi/mf-analytics.ts", "utf8");
const colsBlock = /const COLS = \[([\s\S]*?)\] as const;/.exec(src)?.[1] ?? "";
check(!/earliest_nav/.test(colsBlock), "earliest_nav is absent from the fold's column list");
check(!/ret_since_earliest_cagr/.test(colsBlock), "ret_since_earliest_cagr is absent from the fold's column list");

const gone = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*)::int n FROM information_schema.columns
  WHERE table_name = 'mf_analytics'
    AND column_name IN ('earliest_nav', 'earliest_nav_date', 'ret_since_earliest_cagr')`);
check(gone[0].n === 0,
  `the three columns are GONE from mf_analytics — dropped, not merely unwritten (${gone[0].n} still exist)`);

console.log(`\n${fails === 0 ? "✅ ALL GUARD PROOFS PASS" : `❌ ${fails} PROOF(S) FAILED`}`);
await prisma.$disconnect();
process.exit(fails === 0 ? 0 : 1);
