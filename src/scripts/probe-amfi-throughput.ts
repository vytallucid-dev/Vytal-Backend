// ─────────────────────────────────────────────────────────────
// THE GATE. A cheap read-only throughput probe against AMFI's history endpoint.
//
//   npx tsx src/scripts/probe-amfi-throughput.ts
//
// Fires ONE small window (7 days — a few MB, ~2-4 s healthy) and measures MB/s. Writes NOTHING,
// touches no table. Its only job is to answer: is AMFI serving, or is it clamped?
//
// Healthy is ~1.7 MB/s (a 90-day / ~59 MB window in ~35 s). Throttled is the dribble that started
// all this: bytes still arriving, so the inactivity timeout never fires, but at a rate that turns a
// 35-second window into 15+ minutes. Below ~0.2 MB/s, do NOT fire a chunk — wait and re-probe.
// ─────────────────────────────────────────────────────────────
import "dotenv/config";
import { streamHistoryWindow, historyWindowUrl } from "../ingestions/amfi/amfi-history-source.js";
import { dayToIso } from "../ingestions/amfi/amfi-history-parse.js";

const HEALTHY_MBPS = 1.0; // conservative: the norm is ~1.7
const CLAMPED_MBPS = 0.2;

// A 7-day window ending a week back — small, recent, and certain to hold data.
const toDay = Math.floor(Date.now() / 86_400_000) - 7;
const fromDay = toDay - 6;

console.log(`\n═══ AMFI THROUGHPUT PROBE ═══`);
console.log(`  window : ${dayToIso(fromDay)} → ${dayToIso(toDay)}  (7 days)`);
console.log(`  url    : ${historyWindowUrl(fromDay, toDay)}`);

const t0 = Date.now();
let rows = 0;
try {
  const s = await streamHistoryWindow(fromDay, toDay, () => { rows++; });
  const secs = (Date.now() - t0) / 1000;
  const mbps = s.bytes / 1e6 / secs;

  console.log(`\n  status     : HTTP ${s.status}`);
  console.log(`  bytes      : ${(s.bytes / 1e6).toFixed(1)} MB`);
  console.log(`  rows       : ${rows.toLocaleString()}`);
  console.log(`  duration   : ${secs.toFixed(1)}s`);
  console.log(`  THROUGHPUT : ${mbps.toFixed(2)} MB/s`);

  if (s.bytes === 0) {
    console.log(`\n  ⚠️  EMPTY BODY — AMFI answered with nothing. Treat as clamped. DO NOT run a chunk.`);
    process.exit(1);
  }
  if (mbps < CLAMPED_MBPS) {
    console.log(`\n  ❌ CLAMPED (< ${CLAMPED_MBPS} MB/s). DO NOT run a chunk. Wait ~20-30 min and re-probe.`);
    process.exit(1);
  }
  if (mbps < HEALTHY_MBPS) {
    console.log(`\n  ⚠️  DEGRADED (${mbps.toFixed(2)} MB/s, healthy ~1.7). Borderline — prefer to wait.`);
    process.exit(1);
  }
  console.log(`\n  ✅ CLEAR (>= ${HEALTHY_MBPS} MB/s). Safe to run the next chunk.`);
  process.exit(0);
} catch (err) {
  console.log(`\n  ❌ PROBE FAILED: ${(err as Error).message}`);
  console.log(`  Treat as clamped. DO NOT run a chunk.`);
  process.exit(1);
}
