// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SEASON WINDOW — pure date arithmetic over a GROUP of members. No DB, no copy.
//
// ★ IT DOES NOT RE-DERIVE ANYTHING window.ts ALREADY KNOWS. `WINDOW_DAYS`, `utcMidnight`,
// `pickScheduledDate` and `periodEndFor` are imported, not copied — so widening the stock strip's
// window widens this one, and the reschedule-residue rule (measured live on NAUKRI, JUBLPHARMA and
// ICICIGI) applies to every member here without being restated.
//
// WHAT IS GENUINELY NEW is the shape of the window itself. The stock strip's window is T-7…T+7 of ONE
// date. A group's is T-7 of the EARLIEST member date to T+7 of the LATEST — which is a different
// interval, not a parameterisation of the same one. Measured across the 13 scored ponds: member-date
// spreads of 5–28 days, so windows of 20–44 days (median 35).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { periodEndFor, utcMidnight, WINDOW_DAYS } from "./window.js";
import type { CapsuleExposure, GroupSeasonState, PeerGroupSeasonExposure } from "./group-types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The season's edges, in days, on each side. ★ THE SAME CONSTANT AS THE STOCK STRIP — imported, not
 *  a second 7. The two surfaces open and close on the same rule, and a reader who sees one appear
 *  should not find the other's rule is quietly a day wider. */
export const SEASON_EDGE_DAYS = WINDOW_DAYS;

/**
 * How far either side of today the member-date read must reach to see a whole season.
 *
 * ⚠ NOT A GUESS. The widest member-date spread measured across all 23 ponds is 33 days, and today can
 * sit at either edge of the T-7…T+7 window — so the furthest a same-season date can be from today is
 * 33 + 7 = 40. 45 is that, with headroom for a season wider than any seen. Reaching further is safe
 * because `groupIntoSeasons` separates the periods; reaching LESS would truncate a season and
 * mis-state its counts, which is the failure that matters.
 */
export const SEASON_SCAN_DAYS = 45;

/** One member's resolved place in the season. Built by the service; consumed by the arithmetic and
 *  the copy, neither of which touches a database. */
export interface SeasonMember {
  stockId: string;
  symbol: string;
  name: string;
  /** THE scheduled date, after `pickScheduledDate` has chosen among reschedule residue. */
  scheduledDate: Date;
  /** The day the company actually published, when we hold a filing for the season's period. */
  filedOn: Date | null;
  /** Does this member carry a health snapshot? An unscored member's results change nothing on our
   *  side, and the copy states the count rather than letting a reader assume all of them do. */
  scored: boolean;
  /** ★ THE READER'S RELATIONSHIP TO THIS MEMBER — the capsule's marker, and the ONE source the
   *  sentence's counts are derived from (see `exposureCounts`). Anonymous ⇒ "none" throughout. */
  exposure: CapsuleExposure;
}

/**
 * ★ THE SENTENCE'S COUNTS, DERIVED FROM THE MARKERS — one fact, one source.
 *
 * The sentence says "Two are on your watchlist and one you hold" and the capsules carry a mark each.
 * Those are two renderings of the SAME fact, and the way they drift apart is by being computed twice.
 * So they are computed once: this counts the MARKERS, and the service passes the result straight into
 * the copy. The gate asserts the identity directly against `capsuleFor`'s output.
 *
 * ⚠ A "both" MEMBER COUNTS IN BOTH NUMBERS, and that is the change the markers forced. The first
 * draft applied the stock strip's held-beats-watching precedence, so a member the reader held AND
 * watchlisted was counted only as held — which was fine while nothing was drawn per member, and
 * became a visible contradiction the moment the capsule started showing both marks: the sentence
 * would say "You hold one of them" beside a capsule wearing a watchlist ring. Counting per MARK makes
 * each number mean exactly "how many capsules carry this mark", which is what the reader can check.
 */
export function exposureCounts(members: readonly { exposure: CapsuleExposure }[]): PeerGroupSeasonExposure {
  return {
    held: members.filter((m) => m.exposure === "held" || m.exposure === "both").length,
    watching: members.filter((m) => m.exposure === "watching" || m.exposure === "both").length,
  };
}

export interface SeasonWindow {
  /** T-7 of the earliest member date. */
  from: Date;
  /** T+7 of the latest member date. */
  to: Date;
  /** The earliest member date itself — what "when it starts" names. */
  firstDate: Date;
  /** The latest member date itself. */
  lastDate: Date;
}

/** T-7 of the earliest … T+7 of the latest. Throws on an empty set rather than inventing an
 *  interval — the caller has already silenced on `no_member_dates` before reaching here. */
export function seasonWindowFor(dates: readonly Date[]): SeasonWindow {
  if (dates.length === 0) throw new Error("seasonWindowFor: no dates");
  const norm = dates.map(utcMidnight).sort((a, b) => a.getTime() - b.getTime());
  const firstDate = norm[0];
  const lastDate = norm[norm.length - 1];
  return {
    firstDate,
    lastDate,
    from: new Date(firstDate.getTime() - SEASON_EDGE_DAYS * DAY_MS),
    to: new Date(lastDate.getTime() + SEASON_EDGE_DAYS * DAY_MS),
  };
}

/** Is `todayDate` inside the window? Inclusive on both edges, matching `phaseFor`'s T-7 and T+7. */
export function insideWindow(w: SeasonWindow, todayDate: Date): boolean {
  return todayDate.getTime() >= w.from.getTime() && todayDate.getTime() <= w.to.getTime();
}

/**
 * Split members into SEASONS by the period each meeting reports on.
 *
 * ★ WHY THIS EXISTS AT ALL. The read band is ±45 days, which is wide enough to catch the tail of one
 * reporting season and the head of the next. Two seasons folded into one set would produce a window
 * spanning both and counts that mix a June quarter with a September one — the group equivalent of the
 * stale-calendar-row bug `pickScheduledDate` fixes per stock. `periodEndFor` is the SAME derivation
 * the stock strip uses to decide which quarter a meeting is about, so the two agree by construction.
 *
 * Keyed by ISO period end ("2026-06-30"), which is also the banner's `seasonKey`.
 */
export function groupIntoSeasons<T extends { scheduledDate: Date }>(
  members: readonly T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const m of members) {
    const key = periodEndFor(m.scheduledDate).toISOString().slice(0, 10);
    const bucket = out.get(key);
    if (bucket) bucket.push(m);
    else out.set(key, [m]);
  }
  return out;
}

/**
 * Choose THE season: the one whose window contains today. When more than one does — possible where a
 * late filer of one quarter overlaps an early filer of the next — the LATER period wins, because that
 * is the season currently under way and the earlier one is finishing, not starting.
 *
 * Returns null when today sits inside no season's window, which is `outside_window`: the ordinary
 * answer out of season, and the reason this section is conditional rather than skeletoned.
 */
export function pickSeason<T extends { scheduledDate: Date }>(
  seasons: Map<string, T[]>,
  todayDate: Date,
): { seasonKey: string; members: T[]; window: SeasonWindow } | null {
  const candidates: { seasonKey: string; members: T[]; window: SeasonWindow }[] = [];
  for (const [seasonKey, members] of seasons) {
    const window = seasonWindowFor(members.map((m) => m.scheduledDate));
    if (insideWindow(window, todayDate)) candidates.push({ seasonKey, members, window });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.seasonKey < b.seasonKey ? 1 : -1)); // later period end first
  return candidates[0];
}

/**
 * ★ THE STATE, AND ITS PRECEDENCE IS THE RULING.
 *
 * `reported === 0` is tested FIRST, so a one-member season with nothing filed resolves
 * `none_reported` — "the season is ahead" — and never `one_remaining`, which would name the only
 * member as though the rest had already been through. That ordering is what lets the copy assume
 * `one_remaining` implies at least one reporter, and therefore at least two dated members.
 */
export function seasonStateFor(reported: number, due: number): GroupSeasonState {
  if (reported === 0) return "none_reported";
  const remaining = due - reported;
  if (remaining === 0) return "all_reported";
  if (remaining === 1) return "one_remaining";
  return "partly";
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ ORDER CARRIES MEANING — and it lives here, in the pure module, so the build gate can assert it.
//
//   REPORTED   descending by FILING date. Most recent first, so the row reads as a FEED.
//   PENDING    ascending by SCHEDULED date. The next reporter first, so the row reads as a SCHEDULE.
//
// Ties break on the ticker in both. Without that the sort is not total, and two members who filed on
// the same day would swap places between renders for no reason a reader could account for — measured
// as real: nine of the thirteen scored ponds have at least two members sharing a date.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Filing day, normalised — the same IST calendar-day basis every date on this surface uses. */
function filedDay(m: SeasonMember): number {
  return utcMidnight(m.filedOn as Date).getTime();
}

/** The reported row: a feed. Returns a NEW array; the caller's order is never mutated. */
export function orderReported(members: readonly SeasonMember[]): SeasonMember[] {
  return members
    .filter((m) => m.filedOn !== null)
    .slice()
    .sort((a, b) => filedDay(b) - filedDay(a) || a.symbol.localeCompare(b.symbol));
}

/** The pending row: a schedule. Returns a NEW array. */
export function orderPending(members: readonly SeasonMember[]): SeasonMember[] {
  return members
    .filter((m) => m.filedOn === null)
    .slice()
    .sort(
      (a, b) =>
        utcMidnight(a.scheduledDate).getTime() - utcMidnight(b.scheduledDate).getTime() ||
        a.symbol.localeCompare(b.symbol),
    );
}
