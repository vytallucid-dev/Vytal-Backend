// ─────────────────────────────────────────────────────────────
// STEP 14 — the REIT/InvIT ingest, run once by hand.
//
//   npx tsx src/scripts/run-reit-ingest.ts            (identity + price + yield)
//   npx tsx src/scripts/run-reit-ingest.ts --no-yield (skip the 17 NSE corporate-action calls)
//
// Idempotent: a second run inserts 0 catalogue rows and 0 price rows for the same day.
// ─────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { runReitIngest } from "../ingestions/reits/ingest-reits.js";

const withYield = !process.argv.includes("--no-yield");

const r = await runReitIngest({ withYield });

console.log("\n═══ REIT / InvIT INGEST ═══");
console.log(`ok                : ${r.ok}${r.abortReason ? `  (${r.abortReason})` : ""}`);
console.log(`sessions read     : ${r.sessions.join(", ")}   (newest = ${r.priceDate})`);
console.log(`trusts (distinct) : ${r.trustRows}   → ${r.reits} REIT + ${r.invits} InvIT`);
console.log(`catalogue         : ${r.created} created, ${r.updated} updated`);
console.log(`instrument_prices : ${r.pricesInserted} inserted`);
console.log(
  `distribution yield: ${r.yieldsWritten} written, ${r.yieldsNull} honestly NULL` +
    (Object.keys(r.yieldNullReasons).length
      ? `  (${Object.entries(r.yieldNullReasons).map(([k, v]) => `${k}×${v}`).join(", ")})`
      : ""),
);
console.log(`refused rows      : ${r.skipped.length}`);
for (const s of r.skipped) console.log(`   ✗ ${s.symbol || "(?)"} ${s.isin || ""} — ${s.why}`);
console.log(`faults            : ${JSON.stringify(r.errors)}`);
console.log(`bytes / duration  : ${r.bytes} / ${r.durationMs}ms`);

await prisma.$disconnect();
