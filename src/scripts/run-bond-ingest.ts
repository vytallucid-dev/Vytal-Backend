// ─────────────────────────────────────────────────────────────
// STEP 17 — the corporate-bond ingest, run once by hand.
//   npx tsx src/scripts/run-bond-ingest.ts
// Idempotent: a second run creates 0 catalogue rows and 0 price rows for the same sessions.
// ─────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { runBondIngest } from "../ingestions/corporate-bonds/ingest-bonds.js";

const r = await runBondIngest();

console.log("\n═══ CORPORATE BONDS / NCDs ═══");
console.log(`ok                : ${r.ok}${r.abortReason ? `  (${r.abortReason})` : ""}`);
console.log(`sessions read     : ${r.sessions.length}  (${r.sessions[0]} … ${r.priceDate})`);
console.log(`bonds (union)     : ${r.instruments}`);
console.log(`by ISIN sec-type  : ${JSON.stringify(r.bySecurityType)}   (07/08 = NCD/debenture · 24 = municipal green bond · A7 = extended roll)`);
console.log(`catalogue         : ${r.created} created, ${r.updated} updated`);
console.log(`instrument_prices : ${r.pricesInserted} inserted`);

console.log(`\n── attributes (parsed from the NAME — there is no coupon/maturity/rating column) ──`);
console.log(`   coupon         : ${r.couponParsed}/${r.couponExpected}   (incl. ${r.zeroCoupon} REAL zero-coupon bonds — 0 is a value, not a null)`);
console.log(`   maturity year  : ${r.maturityYearParsed}/${r.instruments}`);
console.log(`   exact maturity : ${r.maturityDateParsed}/${r.instruments}   (only where the name spells a full date — NEVER invented)`);
console.log(`   issuer         : ${r.issuerResolved}/${r.instruments}   (resolved BY JOIN on the ISIN issuer stem — never parsed from the name)`);
console.log(`   credit rating  : 0/${r.instruments}   ← NOT SOURCEABLE. Honest-null, with a reason. Never inferred, never defaulted.`);

console.log(`\n── the fence (rows on an unclaimed board that were NOT loaded, and why) ──`);
if (Object.keys(r.excluded).length === 0) console.log(`   (none)`);
for (const [why, n] of Object.entries(r.excluded).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(4)} × ${why}`);
}
console.log(`   → these are EXCLUSIONS, not faults: we know exactly what each one is. The equity rows here`);
console.log(`     are the BAYERCROP class of bug that a series-only fence would have loaded as bonds.`);

if (r.unrecognised.length) {
  console.log(`\n── ⚠ UNRECOGNISED ISIN security-types (FAULTED, not dropped) ──`);
  for (const u of r.unrecognised) {
    console.log(`   type "${u.securityType}"  ${u.isin}  ${(u.symbol || "—").padEnd(14)} "${u.name}"`);
  }
  console.log(`   → NOT loaded and NOT guessed. If the name describes debt, add the code to DEBT_TYPES`);
  console.log(`     in ingestions/shared/isin-class.ts. This is how "24" (the municipal green bonds) was`);
  console.log(`     caught instead of being silently dropped.`);
}

console.log(`\nrefused rows      : ${r.skipped.length}`);
for (const s of r.skipped) console.log(`   ✗ ${s.symbol || "(?)"} ${s.isin || ""} — ${s.why}`);
console.log(`faults            : ${JSON.stringify(r.errors)}`);
console.log(`bytes / duration  : ${r.bytes} / ${r.durationMs}ms`);

await prisma.$disconnect();
