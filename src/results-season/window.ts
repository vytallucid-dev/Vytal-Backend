// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE WINDOW — pure date arithmetic. No DB, no copy. Every function here is testable in isolation and
// the verify harness drives them directly rather than through a live row.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

// ⚠ FROM lib/ist-date.js, NOT from portfolio/phs/score-history.js — which re-exports the SAME
//   function but also imports `prisma`. Reaching it through there would give this pure-arithmetic
//   module (and the build gate that drives it) a DB-client import it has no use for.
import { istDateOnly } from "../lib/ist-date.js";
import type { CalendarPhase } from "./types.js";

/** T-7 … T+7. Asymmetric ends are deliberate: `before` is T-7…T-1, `after` is T+1…T+7, and the day
 *  itself is its own phase. */
export const WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's calendar day in IST, as a UTC-midnight Date — the same basis `@db.Date` columns store, and
 *  the same helper the PHS series uses. India observes no DST, so the fixed offset is exact. */
export function today(now: Date = new Date()): Date {
  return istDateOnly(now);
}

/** Whole days from `today` to `eventDate`. Positive ⇒ the future. Both must be UTC-midnight dates. */
export function daysOut(eventDate: Date, todayDate: Date): number {
  return Math.round((utcMidnight(eventDate).getTime() - todayDate.getTime()) / DAY_MS);
}

/** Normalise any Date to UTC midnight. `@db.Date` already arrives that way; a hand-built Date in a
 *  fixture may not, and a stray time component would round `daysOut` to the wrong day. */
export function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * The CALENDAR phase for a scheduled date, or null outside T-7…T+7 — silence, not an error.
 *
 * ⚠ THIS IS NOT THE FINAL PHASE. It knows only the date. `filed_today` cannot be derived from a
 * calendar at all — it requires a filing — and a filing also overrides `before`/`day_of`, because a
 * meeting still listed as upcoming while the results are already in our hands is a stale calendar
 * row, not a future event. The service applies that override; this function stays purely arithmetic.
 */
export function phaseFor(eventDate: Date, todayDate: Date): CalendarPhase | null {
  const d = daysOut(eventDate, todayDate);
  if (d === 0) return "day_of";
  if (d >= 1 && d <= WINDOW_DAYS) return "before";
  if (d <= -1 && d >= -WINDOW_DAYS) return "after";
  return null;
}

/**
 * Pick THE scheduled date when a stock has more than one earnings row in the window.
 *
 * ⚠ RESCHEDULE RESIDUE IS REAL AND IT IS IN THE DATA. The upsert key is
 * (stockId, eventType, eventDate), so a company that moves its board meeting leaves the OLD row
 * behind and gains a new one — measured live on NAUKRI (10 + 11 Aug), JUBLPHARMA (7 + 10 Aug) and
 * ICICIGI (15 + 17 Jul). Taking "the nearest date" would pick the stale one for two days and tell a
 * reader results had already passed while the company had simply moved them.
 *
 * The rule that survives that: if ANY date is today or ahead, take the EARLIEST of those (the next
 * one actually coming). Only when every candidate is behind us do we take the LATEST — the most
 * recent thing that happened.
 */
export function pickScheduledDate(dates: Date[], todayDate: Date): Date | null {
  if (dates.length === 0) return null;
  const norm = dates.map(utcMidnight).sort((a, b) => a.getTime() - b.getTime());
  const ahead = norm.filter((d) => d.getTime() >= todayDate.getTime());
  return ahead.length > 0 ? ahead[0] : norm[norm.length - 1];
}

/**
 * The calendar quarter-end the board meeting is reporting on: the last 31 Mar / 30 Jun / 30 Sep /
 * 31 Dec strictly before the meeting.
 *
 * ★ CALENDAR QUARTER-ENDS, NOT FISCAL ONES, AND THAT IS CORRECT. `report_date` is the PERIOD END, and
 * every FY27-Q1 row across all five family tables carries 2026-06-30 — including the handful of
 * companies on a Jan–Dec fiscal year, whose quarters still close on the calendar boundaries. Verified
 * against quarterly_results (591 rows), banking (47), nbfc (61), life (6) and general insurance (3):
 * one distinct report_date each. So this needs no per-company fiscal calendar.
 */
export function periodEndFor(eventDate: Date): Date {
  const d = utcMidnight(eventDate);
  const y = d.getUTCFullYear();
  const ends = [
    Date.UTC(y - 1, 11, 31),
    Date.UTC(y, 2, 31),
    Date.UTC(y, 5, 30),
    Date.UTC(y, 8, 30),
    Date.UTC(y, 11, 31),
  ];
  let pick = ends[0];
  for (const e of ends) if (e < d.getTime()) pick = e;
  return new Date(pick);
}

/**
 * ★ IS THIS THE ANNUAL-BEARING FILING? Only the Q4 board meeting (period ending 31 March for an
 * Apr–Mar company) carries the audited annual accounts, and `fundamentals` — the ONLY table Foundation
 * reads — is written from the annual, never from a quarter.
 *
 * MEASURED, NOT ASSUMED: `loadFoundationStandalone` selects from `fundamentals`;
 * `loadMomentumStandalone` selects from `quarterly_results` (src/scoring/metrics/load.ts). Across this
 * entire Jul–Aug season NOT ONE fundamentals row was written — every row in the table was created by
 * the 2026-07-09 backfill. So a Q1/Q2/Q3 filing moves Momentum and nothing else.
 */
export function pillarsAtStakeFor(eventDate: Date): ("foundation" | "momentum")[] {
  const pe = periodEndFor(eventDate);
  const isFiscalYearEnd = pe.getUTCMonth() === 2; // 31 March
  return isFiscalYearEnd ? ["foundation", "momentum"] : ["momentum"];
}

/**
 * WHAT THE FILING IS OF — the period the meeting reports on, in a form copy can name.
 *
 * `monthName` is the calendar month the period ENDS in ("June" for the quarter to 30 June), which is
 * how a reader refers to it — "the June quarter" — rather than "Q1 FY27", which is our vocabulary and
 * not theirs. `isAnnualBearing` is the same March test `pillarsAtStakeFor` runs, named separately
 * because the UNSCORED copy needs it while naming no pillar at all: a Q4 filing carries the audited
 * full year besides the quarter, and that is a fact about the FILING, not about our scoring.
 */
export interface PeriodDescriptor {
  /** "June" | "September" | "December" | "March" — the month the reported period ends in. */
  monthName: string;
  /** True for the 31 March period end: the audited full-year accounts ride with the quarter. */
  isAnnualBearing: boolean;
}

export function periodDescriptorFor(eventDate: Date): PeriodDescriptor {
  const pe = periodEndFor(eventDate);
  return {
    monthName: pe.toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" }),
    isAnnualBearing: pe.getUTCMonth() === 2, // 31 March
  };
}

/** "12 August" — the app's date voice for this strip: day + full month, no year (the whole window is
 *  within a fortnight, so the year would be noise). Composed on the SERVER like every other sentence
 *  fragment; the frontend only chooses the face it wears. */
export function formatBannerDate(d: Date): string {
  return utcMidnight(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
