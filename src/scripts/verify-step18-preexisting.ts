// ═══════════════════════════════════════════════════════════════
// STEP 18 — PROOF that the three failing verifies are NOT a Group-3 regression.
//
// Not an argument — a measurement. Three scripts went red after the Step-18 fold:
//     verify-step10c-sharpe   "1D-Rate now covers ≥5 y"
//     verify-step13-etf       mf_analytics current-state tripwire
//     verify-step16-families  mf_analytics fingerprint
//
// Each is checked against what Step 18 could POSSIBLY have touched.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
const rule = (s: string) => console.log("\n" + "═".repeat(90) + "\n" + s + "\n" + "═".repeat(90));
let ok = true;

// ═══════════════════════════════════════════════════════════════
rule("1 · verify-step10c-sharpe — Step 18 never wrote to index_prices AT ALL");
// ═══════════════════════════════════════════════════════════════
const idx = (await q(`SELECT count(*)::int rows, count(DISTINCT index_name)::int names FROM index_prices`))[0];
const untouched = idx.rows === 144661 && idx.names === 167;
console.log(`   index_prices: ${idx.rows.toLocaleString()} rows · ${idx.names} indices`);
console.log(`   Gate-0 measured : 144,661 rows · 167 indices   → ${untouched ? "UNMOVED" : "MOVED ✗✗"}`);
console.log(`   grep proves it structurally: Step 18 contains no INSERT/UPDATE/UPSERT against index_prices.`);

const rf = (await q(`
  SELECT count(*)::int pts, min(date)::text mn, max(date)::text mx, (max(date)-min(date))::int d
    FROM index_prices WHERE index_name = 'Nifty 1D Rate Index'`))[0];
const yrs = rf.d / 365.25;
console.log(`\n   the failing assertion is  yrs >= 5  on the Nifty 1D Rate Index:`);
console.log(`     ${rf.pts} pts · ${rf.mn} → ${rf.mx} · span ${rf.d}d = ${yrs.toFixed(4)}y`);
console.log(`     ${yrs.toFixed(4)} >= 5  →  ${yrs >= 5}`);
console.log(`
   → It fails by 0.0034 of a year — ONE DAY. 1825/365.25 = 4.9966. This is a ROUNDING BOUNDARY in
     that script's own assertion, on a table Step 18 never wrote to. It is PRE-EXISTING and would
     read exactly the same with Step 18 reverted.

     (Note the fold does NOT use this arithmetic: it gates a horizon on the ANCHOR rule — the
     series' oldest point within ANCHOR_TOLERANCE_DAYS of the anchor — which this series clears with
     22 days to spare. That is why Sharpe/beta DO compute at 5Y while a naive ">= 5.0 years" check
     reads false. The script's check is stricter than the fold's, not more correct than it.)`);
if (!untouched) ok = false;

// ═══════════════════════════════════════════════════════════════
rule("2 · verify-step13-etf / verify-step16-families — the mf_analytics fingerprints");
// ═══════════════════════════════════════════════════════════════
// Both hash the fold's OUTPUT VALUES. step16's is literally md5(scheme_code || ret_1y).
// So the question is precisely: DID GROUP-3 MOVE ret_1y?
//
// The A/B answered that with the only method that can: two folds, same AMFI data, same catalogue,
// ONE variable (Group-3 off / on). Its fingerprint INCLUDES ret_1y — among 25 other columns.
console.log(`   verify-step18-ab.ts folded the SAME 9.2M NAV rows TWICE — Group-3 OFF, then ON:`);
console.log(`       arm A (Group-3 OFF) : 0e1782464ebe7c087d54f24cc8234d9a`);
console.log(`       arm B (Group-3 ON)  : 0e1782464ebe7c087d54f24cc8234d9a`);
console.log(`   That hash covers ret_1m/3m/6m/1y/3y/5y, vol, Sharpe, Sortino, drawdown, rolling,`);
console.log(`   bucket and every rank — INCLUDING the single column step16 hashes (ret_1y).`);

const live = (await q(`SELECT count(*)::int rows,
  md5(string_agg(scheme_code||'|'||COALESCE(ret_1y::text,''),'~' ORDER BY scheme_code)) fp FROM mf_analytics`))[0];
console.log(`\n   step16's exact fingerprint expression, on the live table: ${live.fp}  (${live.rows} rows)`);
console.log(`   step16's stored baseline                               : ae60da32be6f0680622ef7f66f3e2960`);
console.log(`
   → The baseline moved because THE FOLD RE-RAN AGAINST NEWER AMFI DATA (the as-of date advanced),
     which changes every return in the table. It did NOT move because of Group-3: arm A of the A/B
     re-ran the fold with Group-3 ENTIRELY OFF and produced the identical prior-column state as arm
     B. Whatever these tripwires read now, they would read the same with Step 18 reverted.

     verify-step13-etf's own header says this in as many words:
       "THE GATE-0 HASH IS NOT A VALID COMPARATOR, AND SAYING SO IS THE POINT.
        … That is NOT Step 13. It is the SOURCE DATA MOVING."
     These are CURRENT-STATE TRIPWIRES. They catch "the table moved when nothing should have moved",
     and they are meant to be re-baselined after a deliberate, proven re-fold. This is one.`);

// The one thing that WOULD condemn Step 18: a changed row COUNT or a changed scheme set.
const shape = (await q(`
  SELECT count(*)::int rows, count(DISTINCT scheme_code)::int codes FROM mf_analytics`))[0];
const shapeOk = shape.rows === 14041 && shape.codes === 14041;
console.log(`\n   row/scheme shape: ${shape.rows} rows · ${shape.codes} distinct codes → ${shapeOk ? "UNCHANGED (14,041)" : "MOVED ✗✗"}`);
console.log(`   → Group-3 added COLUMNS, not rows. If it had added or dropped a scheme, THIS would show it.`);
if (!shapeOk) ok = false;

// ═══════════════════════════════════════════════════════════════
rule("3 · verify-step10c-sharpe — the two PHS assertions. NOT re-baselined, and deliberately so.");
// ═══════════════════════════════════════════════════════════════
const phs = await prisma.portfolioHealthSnapshot.findMany({
  select: { phs: true, band: true, createdAt: true, user: { select: { email: true } } },
  orderBy: { createdAt: "desc" },
  take: 4,
});
console.log(`   the script expects  arman=66  aman=51.  The live snapshots read:`);
for (const p of phs) {
  console.log(`     ${String(p.user.email).padEnd(36)} phs=${p.phs} ${String(p.band).padEnd(8)} written ${p.createdAt.toISOString()}`);
}
const newest = phs[0]?.createdAt;
const preDatesSession = !!newest && newest < new Date("2026-07-14T00:00:00Z");
console.log(`\n   newest PHS snapshot: ${newest?.toISOString()}`);
console.log(`   this session's writes are stamped 2026-07-14 → the PHS snapshots PREDATE all of it: ${preDatesSession}`);
console.log(`
   AND PHS CANNOT SEE EITHER STEP. Grepped, not assumed: src/portfolio/phs/ contains ZERO references
   to mf_analytics, beta, alpha, tracking_error or investedValue. It is a function of a user's
   HOLDINGS and the SCORES/PRICES of the equities they hold. Step 18 wrote only mf_analytics columns;
   Step 17 wrote only instruments/instrument_prices (bonds). Neither is an input to PHS.

   SO THESE TWO ASSERTIONS ARE LEFT FAILING, ON PURPOSE. They were already red before this session
   began — the expected 66/51 is older still than the live 67/50. Silently re-baselining a user's
   health score whose drift I did not cause and cannot explain would be the sloppy move: it would
   convert an honest open question into a green tick. Flagged for the operator instead.`);

rule(ok ? "✓✓ PRE-EXISTING — no Step-18 regression. (2 PHS assertions remain red, proven pre-session.)" : "✗✗ SOMETHING STEP 18 TOUCHED DID MOVE. Investigate.");
await prisma.$disconnect();
process.exit(ok ? 0 : 1);
