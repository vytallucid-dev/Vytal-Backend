// Step 13 — run the ETF identity + NAV + ticker ingest once, and print what it did.
import "dotenv/config";
import { runEtfNavIngest } from "../ingestions/amfi/ingest-amfi.js";
import { prisma } from "../db/prisma.js";

const r = await runEtfNavIngest();

console.log("\n═══ ETF INGEST (Step 13) ═══");
console.log(`  ok                 : ${r.ok}${r.abortReason ? `  (${r.abortReason})` : ""}`);
console.log(`  asset class        : ${r.assetClass}`);
console.log(`  bytes              : ${r.bytes.toLocaleString()}`);
console.log(`  total rows in file : ${r.totalRows}`);
console.log(`  MF rows excluded   : ${r.otherClassRows}   (ETF pass — MFs load via amfi_nav_daily)`);
console.log(`  ETF rows           : ${r.classRows}`);
console.log(`  honest-empty skips : ${r.honestEmptySkips}   ("-" ISIN cells — NOT faults)`);
console.log(`  candidates         : ${r.candidates}`);
console.log(`  created / updated  : ${r.created} / ${r.updated}`);
console.log(`  active / dormant   : ${r.activeRows} / ${r.staleRows}`);
console.log(`  dormancy flips     : ${r.dormancyFlips}`);
console.log(`  newest NAV date    : ${r.maxNavDate}`);
console.log(`  NSE tickers        : ${r.tickersResolved} resolved, ${r.tickersMissing} honestly NULL`);
console.log(`  errors             : shape=${r.errors.shape} count=${r.errors.count} validity=${r.errors.validity} uniqueness=${r.errors.uniqueness}`);

await prisma.$disconnect();
