// Run the AMFI MF ingest once and print the outcome.  npx tsx src/scripts/run-amfi-ingest.ts
import { prisma } from "../db/prisma.js";
import { runAmfiNavIngest } from "../ingestions/amfi/ingest-amfi.js";

const t0 = Date.now();
const r = await runAmfiNavIngest();
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n═══ AMFI ingest — ok=${r.ok} (${secs}s) ═══`);
if (!r.ok) console.log(`  ABORTED: ${r.abortReason}`);
console.log(`  fetched            : ${(r.bytes / 1024).toFixed(0)} KB`);
console.log(`  scheme rows        : ${r.totalRows}`);
console.log(`  ETF rows excluded  : ${r.otherClassRows}   (MF pass — ETFs load via etf_nav_daily, Step 13)`);
console.log(`  MF rows            : ${r.classRows}`);
console.log(`  absent-plan cells  : ${r.honestEmptySkips}   ← honest-empty: skipped, NO error`);
console.log(`  candidates         : ${r.candidates}`);
console.log(`  created            : ${r.created}`);
console.log(`  updated            : ${r.updated}`);
console.log(`  active / stale     : ${r.activeRows} / ${r.staleRows}   (newest NAV ${r.maxNavDate})`);
console.log(`  faults recorded    : validity=${r.errors.validity} uniqueness=${r.errors.uniqueness} shape=${r.errors.shape} count=${r.errors.count}`);

await prisma.$disconnect();
