// verify-results-scan-cadence.ts
// ─────────────────────────────────────────────────────────────
// Proves the results-scan cadence contract: DAILY year-round off-season, TWICE a day
// in-season. Exercises the REAL exported gate (resultsScanShouldEnqueue)
// at the cron's REAL firing hours — no hand-copied rule, so it can't drift from
// scheduler.ts.
//
// Pure logic (no DB / no NSE). Run: `npx tsx src/scripts/verify-results-scan-cadence.ts`
// ─────────────────────────────────────────────────────────────

import {
  isResultsSeasonNow,
  resultsScanShouldEnqueue,
  IN_SEASON_TICKS_UTC,
  OFF_SEASON_TICK_UTC,
} from "../lib/scheduler.js";

const HOUR = 3600_000;
const DAY = 86400_000;

// The cron expression is "0 */4 * * *" → it fires at these UTC hours only.
const CRON_TICK_HOURS = [0, 4, 8, 12, 16, 20];

// Walk a full year (2025, 365 days) at the cron's firing granularity. This spans
// all four season windows AND all four off-season gaps.
const YEAR_START = Date.UTC(2025, 0, 1);
const DAYS = 365;

function main(): void {
  let failures = 0;
  const fail = (msg: string) => {
    console.error(`  ✗ ${msg}`);
    failures++;
  };

  const enqueueTs: number[] = [];
  let inSeasonDays = 0;
  let offSeasonDays = 0;
  let offSeasonEnqueues = 0;
  let inSeasonEnqueues = 0;
  let deadGapDays = 0;

  for (let doy = 0; doy < DAYS; doy++) {
    const dayStart = YEAR_START + doy * DAY;
    // Windows are date-granular, so any intra-day sample gives the same answer;
    // noon is used purely to classify the day for the per-day expectation.
    const dayLabel = new Date(dayStart).toISOString().slice(0, 10);
    const inSeason = isResultsSeasonNow(new Date(dayStart + 12 * HOUR));

    const firedHours: number[] = [];
    for (const h of CRON_TICK_HOURS) {
      const tickTime = new Date(dayStart + h * HOUR);
      if (resultsScanShouldEnqueue(tickTime)) {
        firedHours.push(h);
        enqueueTs.push(tickTime.getTime());
      }
    }

    // (A) DAILY YEAR-ROUND: every single day must enqueue at least once.
    if (firedHours.length < 1) {
      deadGapDays++;
      fail(`${dayLabel}: NO enqueue — dead gap (this is the bug being fixed)`);
    }

    if (inSeason) {
      inSeasonDays++;
      inSeasonEnqueues += firedHours.length;
      // (B) IN-SEASON CADENCE: exactly the exported tick set (2/day, 12h apart).
      // Asserted against IN_SEASON_TICKS_UTC rather than a hand-copied literal, so this
      // gate cannot drift from the scheduler the way a hardcoded "6" did.
      const expected = [...IN_SEASON_TICKS_UTC].sort((a, b) => a - b);
      if (
        firedHours.length !== expected.length ||
        firedHours.some((h, i) => h !== expected[i])
      ) {
        fail(
          `${dayLabel} (in-season): expected [${expected}], got [${firedHours}]`,
        );
      }
    } else {
      offSeasonDays++;
      offSeasonEnqueues += firedHours.length;
      // (C) OFF-SEASON: exactly one enqueue/day, at 16:00 UTC.
      if (firedHours.length !== 1 || firedHours[0] !== OFF_SEASON_TICK_UTC) {
        fail(
          `${dayLabel} (off-season): expected exactly [16], got [${firedHours}]`,
        );
      }
    }
  }

  // (D) MAX LATENCY: the longest gap between consecutive enqueues over the whole
  // year must be ≤24h — i.e. a filing never waits more than ~a day.
  enqueueTs.sort((a, b) => a - b);
  let maxGapH = 0;
  let maxGapAfter = "";
  for (let i = 1; i < enqueueTs.length; i++) {
    const gapH = (enqueueTs[i] - enqueueTs[i - 1]) / HOUR;
    if (gapH > maxGapH) {
      maxGapH = gapH;
      maxGapAfter = new Date(enqueueTs[i - 1]).toISOString();
    }
  }
  if (maxGapH > 24 + 1e-6) {
    fail(`max enqueue gap ${maxGapH.toFixed(1)}h exceeds the 24h daily ceiling`);
  }

  // (E) SUPERSET INVARIANT: every off-season tick must also fire in-season, so crossing
  // the season boundary can only ADD runs, never silently move or drop one.
  if (!IN_SEASON_TICKS_UTC.includes(OFF_SEASON_TICK_UTC)) {
    fail(
      `in-season ticks [${IN_SEASON_TICKS_UTC}] do not include the off-season tick ` +
        `${OFF_SEASON_TICK_UTC} — the season boundary would drop a run`,
    );
  }

  // ── Report ──
  console.log("── results-scan cadence (year = 2025, cron '0 */4 * * *') ──");
  console.log(`  in-season days      : ${inSeasonDays}  → ${inSeasonEnqueues} enqueues (expect ${inSeasonDays * IN_SEASON_TICKS_UTC.length}, ${IN_SEASON_TICKS_UTC.length}/day @ ${IN_SEASON_TICKS_UTC.join("/")} UTC)`);
  console.log(`  off-season days     : ${offSeasonDays}  → ${offSeasonEnqueues} enqueues (expect ${offSeasonDays}, 1/day @ ${OFF_SEASON_TICK_UTC}:00 UTC)`);
  console.log(`  total enqueues/year : ${enqueueTs.length}`);
  console.log(`  days with 0 enqueue : ${deadGapDays}  (dead gaps — must be 0)`);
  console.log(`  max enqueue gap     : ${maxGapH.toFixed(1)}h (after ${maxGapAfter}) — ceiling 24h`);

  if (failures === 0) {
    console.log(
      `
✅ ALL ASSERTIONS PASS — scan enqueues every day year-round; in-season ` +
        `${IN_SEASON_TICKS_UTC.length}/day @ ${IN_SEASON_TICKS_UTC.join("/")} UTC; ` +
        `off-season 1/day @ ${OFF_SEASON_TICK_UTC}:00 UTC; max latency ≤24h.`,
    );
    process.exit(0);
  } else {
    console.error(`\n❌ ${failures} FAILURE(S).`);
    process.exit(1);
  }
}

main();
