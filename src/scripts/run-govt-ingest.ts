// ─────────────────────────────────────────────────────────────
// STEP 15 — the government-securities ingest, run once by hand.
//   npx tsx src/scripts/run-govt-ingest.ts
// Idempotent: a second run creates 0 catalogue rows and 0 price rows for the same sessions.
// ─────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { runGovtIngest } from "../ingestions/govt-securities/ingest-govt.js";

const r = await runGovtIngest();

console.log("\n═══ GOVERNMENT SECURITIES ═══");
console.log(`ok                : ${r.ok}${r.abortReason ? `  (${r.abortReason})` : ""}`);
console.log(`sessions read     : ${r.sessions.length}  (${r.sessions[0]} … ${r.priceDate})`);
console.log(`instruments       : ${r.instruments}   → ${r.gsec} gsec + ${r.sgb} sgb`);
console.log(`by series         : ${JSON.stringify(r.bySeries)}`);
console.log(`catalogue         : ${r.created} created, ${r.updated} updated`);
console.log(`instrument_prices : ${r.pricesInserted} inserted`);
console.log(`── attributes (parsed from the NAME — there is no coupon/maturity column) ──`);
console.log(`   coupon         : ${r.couponParsed}/${r.couponExpected}   (T-bills excluded — a discount instrument HAS no coupon)`);
console.log(`   maturity year  : ${r.maturityYearParsed}/${r.instruments}`);
console.log(`   exact maturity : ${r.maturityDateParsed}/${r.instruments}   (T-bills only — NOT in the feed for GS/SDL/SGB, and NOT invented)`);
console.log(`refused rows      : ${r.skipped.length}`);
for (const s of r.skipped) console.log(`   ✗ ${s.symbol || "(?)"} ${s.isin || ""} — ${s.why}`);
console.log(`faults            : ${JSON.stringify(r.errors)}`);
console.log(`bytes / duration  : ${r.bytes} / ${r.durationMs}ms`);

await prisma.$disconnect();
