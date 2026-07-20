// ─────────────────────────────────────────────────────────────
// Is AMFI's history endpoint healthy, or still throttling us?
//
// Streams ONE 90-day window and measures throughput. A healthy window is ~59 MB in ~35 s
// (~1.7 MB/s). The throttled signature is a socket that stays open for many minutes while
// bytes trickle in — so this reports MB/s and first-byte latency, and gives up early.
//
//   npx tsx src/scripts/probe-amfi-history.ts
// ─────────────────────────────────────────────────────────────
import "dotenv/config";
import { streamHistoryWindow } from "../ingestions/amfi/amfi-history-source.js";
import { dayToIso } from "../ingestions/amfi/amfi-history-parse.js";

const HEALTHY_MBPS = 0.5; // a fifth of normal — anything below this is a throttle, not a slow day

// A recent 90-day window (the fold reads ~21 of these).
const today = Math.floor(Date.now() / 86_400_000);
const to = today - 1;
const from = to - 89;

console.log(`Probing ONE window: ${dayToIso(from)} → ${dayToIso(to)}`);
console.log(`(healthy ≈ 59 MB in ~35 s ≈ 1.7 MB/s; the throttle dribbles at a tiny fraction of that)\n`);

const t0 = Date.now();
let rows = 0;
let firstByteAt: number | null = null;

try {
  const r = await streamHistoryWindow(from, to, () => {
    if (firstByteAt === null) firstByteAt = Date.now();
    rows++;
  });
  const secs = (Date.now() - t0) / 1000;
  const mb = r.bytes / 1e6;
  const mbps = mb / secs;

  console.log(`  HTTP           : ${r.status}`);
  console.log(`  first row after: ${firstByteAt ? ((firstByteAt - t0) / 1000).toFixed(1) : "—"} s`);
  console.log(`  bytes          : ${mb.toFixed(1)} MB`);
  console.log(`  data rows      : ${r.dataRows.toLocaleString()}`);
  console.log(`  duration       : ${secs.toFixed(1)} s`);
  console.log(`  THROUGHPUT     : ${mbps.toFixed(2)} MB/s`);
  console.log("");
  if (mbps >= HEALTHY_MBPS) {
    console.log(`  ✅ HEALTHY — throttle has lifted. Safe to run the fold (~21 windows, ~12 min).`);
    process.exit(0);
  } else {
    console.log(`  ❌ STILL THROTTLED — ${mbps.toFixed(2)} MB/s is below the ${HEALTHY_MBPS} MB/s floor.`);
    console.log(`     A full fold would take ~${((59 * 21) / mbps / 60).toFixed(0)} min at this rate. Back off further.`);
    process.exit(1);
  }
} catch (e) {
  const secs = (Date.now() - t0) / 1000;
  console.log(`  ❌ WINDOW FAILED after ${secs.toFixed(0)} s: ${(e as Error).message}`);
  console.log(`     (the new total-duration cap is what turned this into a clean failure rather`);
  console.log(`      than an indefinite hang — that is the fix working)`);
  process.exit(1);
}
