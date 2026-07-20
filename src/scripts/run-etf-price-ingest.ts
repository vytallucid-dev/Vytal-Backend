// ─────────────────────────────────────────────────────────────
// STEP 14.5 — the ETF market-price ingest, run once by hand.
//   npx tsx src/scripts/run-etf-price-ingest.ts
// Idempotent: a second run inserts 0 price rows for the same sessions.
// ─────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { runEtfPriceIngest } from "../ingestions/etf-prices/ingest-etf-prices.js";

const r = await runEtfPriceIngest();

console.log("\n═══ ETF MARKET PRICES ═══");
console.log(`ok                : ${r.ok}${r.abortReason ? `  (${r.abortReason})` : ""}`);
console.log(`sessions read     : ${r.sessions.join(", ")}   (newest = ${r.priceDate})`);
console.log(`catalogued ETFs   : ${r.catalogued}`);
console.log(`priced from NSE   : ${r.matched}`);
console.log(`not NSE-listed    : ${r.unlisted}   (honest NULL last_price → they fall back to AMFI NAV)`);
console.log(`instrument_prices : ${r.pricesInserted} inserted`);
console.log(`snapshots advanced: ${r.snapshotsUpdated}`);
console.log(`faults            : ${JSON.stringify(r.errors)}`);
console.log(`bytes / duration  : ${r.bytes} / ${r.durationMs}ms`);

await prisma.$disconnect();
