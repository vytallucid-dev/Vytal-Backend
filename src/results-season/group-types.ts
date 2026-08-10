// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PEER-GROUP RESULTS-SEASON BANNER — the shape that crosses to the frontend.
//
// A CONDITIONAL SECTION on the Peer Group Overview and Peer Group Health tabs: this group's results
// season is under way, and here is where it stands. The SECOND CONSUMER of src/results-season — not a
// second implementation. It reuses window.ts's arithmetic verbatim, the same `SentenceSegment` seam,
// the same server-built link discipline, and the same reader-position helpers.
//
// ── WHAT IS DIFFERENT FROM THE STOCK STRIP, AND WHY ────────────────────────────────────────────────
//  · THE WINDOW IS THE SEASON, NOT ONE DATE. T-7 of the EARLIEST member's date to T+7 of the LATEST.
//    Measured across the 13 scored ponds: the member-date spread runs 5–28 days, so the window runs
//    20–44 days (median 35). That is a month-long banner, which is why the progressive split below is
//    the CONTENT rather than decoration.
//  · THERE IS NO "COPY SET". A stock is scored or it is not, and the stock strip SELECTS a whole copy
//    set on that. A group is neither — it is `scoredCount of dueCount`, a number the sentence states.
//  · THE POSITION IS A PAIR OF COUNTS, not a chip. "Two are on your watchlist and one you hold" —
//    never names, never a position readout. Held takes precedence over watching PER MEMBER, the same
//    rule and the same helpers the stock strip routes on.
//
// ── THE SENTENCE IS COMPOSED HERE, NOT THERE ───────────────────────────────────────────────────────
// Same rule as every other sentence in the product. `segments` is the composed sentence already split
// at the one seam the frontend needs: the DATE, in the app's mono face. The frontend maps segments to
// spans — it never parses, never re-templates, never chooses a variant. `shortSegments` is the same
// facts in fewer words for widths below 640px, composed here and through the same gates.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { ReaderExposure, SentenceSegment, SentenceStock } from "./types.js";

export type { SentenceSegment, SentenceStock };

/**
 * ★ THE FOUR PROGRESSIVE STATES — the content of a month-long banner.
 *
 *   none_reported   the season is ahead: nothing filed yet
 *   partly          some in, TWO OR MORE still to come
 *   one_remaining   exactly one left, and the copy names it
 *   all_reported    the season closed
 *
 * ⚠ THE PRECEDENCE IS ORDERED, NOT INDEPENDENT. `reported === 0` wins over `remaining === 1`, so a
 * one-member season with nothing filed resolves `none_reported` ("the season is ahead") rather than
 * `one_remaining` ("that stock specifically") — which would name the only member as though the rest
 * had already been through. That ordering is what makes `one_remaining` imply `reported >= 1`, and
 * therefore `dueCount >= 2`, which the copy relies on.
 */
export type GroupSeasonState = "none_reported" | "partly" | "one_remaining" | "all_reported";

/**
 * ★ THE READER'S RELATIONSHIP TO ONE MEMBER — the capsule's marker.
 *
 * ⚠ AN ALIAS, NOT A SECOND UNION. `ReaderExposure` (types.ts) is THE app's exposure vocabulary and
 * the peer-group TABLES now wear the same marks off the same resolver — a reader must not have to
 * learn one set of shapes for the banner and another for the table under it. The name survives
 * because "capsule exposure" is what this payload's field is called; the type is the shared one.
 *
 * "both" IS ITS OWN STATE, not a precedence call. The stock strip resolves held-beats-watching
 * because it renders one chip for one stock and has to choose; a row of capsules does not, and
 * silently dropping the watchlist ring from a member the reader both holds and watches would be
 * hiding a fact the reader put there themselves.
 *
 * The row already carries reported-vs-pending, so this carries EXPOSURE ONLY — never a status, never
 * a valence. Held is not good and unheld is not bad.
 */
export type CapsuleExposure = ReaderExposure;

/** One member, as a capsule. Reported capsules carry a href; pending ones carry null — there is
 *  nothing to open, and Part 3 forbids inventing a control for it. */
export interface GroupSeasonCapsule {
  symbol: string;
  /** The company's catalogue name. Rendered only as the capsule's accessible label / hover title. */
  name: string;
  /** ISO yyyy-mm-dd. Never rendered raw — `dateText` carries the app's date voice. Telemetry. */
  date: string;
  /** "7 August" — composed here by `formatBannerDate`, the SAME voice as the stock strip. Sits on
   *  hover, not in the capsule face, which shows the ticker alone. */
  dateText: string;
  /** ★ WHICH DATE. "filing" for a reported member — the day the company actually published, which we
   *  hold — and "meeting" for a pending one. The stock strip's `dateBasis`, per capsule. */
  dateBasis: "meeting" | "filing";
  /** The server-built results href, or null when there is nothing filed to open. NEVER assembled on
   *  the frontend (the `ctx.appLinks` precedent). */
  href: string | null;
  /** The reader's relationship to this member — the marker the capsule wears. "none" on every capsule
   *  when the reader is anonymous, which is also exactly when the legend is absent. */
  exposure: CapsuleExposure;
}

export interface PeerGroupSeasonCounts {
  /** Members carrying a scheduled date THIS SEASON. The denominator for everything the copy says.
   *  ⚠ NOT the roster: Large-Cap Defense has 7 members and 5 dates, and a sentence that said "seven"
   *  would be counting two companies that are not part of this season at all. */
  due: number;
  /** Members with a stored filing for the season's period. The publication fact, not the calendar. */
  reported: number;
  /** `due - reported`. */
  remaining: number;
  /** Of the DUE members, how many carry a health snapshot. Stated because an unscored member's
   *  results change nothing on our side, and the reader should not infer otherwise from the count. */
  scored: number;
}

/**
 * ★ THE READER'S EXPOSURE, AS COUNTS ONLY. Never names, never a position readout, never a value.
 *
 * ⚠ EACH NUMBER COUNTS MARKERS, NOT MEMBERS, so a member the reader both holds and watchlists is
 * counted in BOTH — and the two numbers can therefore sum to more than the members involved. That is
 * deliberate and it is the only way the sentence can agree with what is drawn: each count means
 * exactly "how many capsules carry this mark". Derived by `exposureCounts` from the per-member
 * markers, never computed a second time. See the note there for the contradiction it removed.
 */
export interface PeerGroupSeasonExposure {
  held: number;
  watching: number;
}

export interface PeerGroupResultsSeasonBanner {
  state: GroupSeasonState;

  /** The reporting period end this season is OF, ISO yyyy-mm-dd (e.g. "2026-06-30"). The season's
   *  identity — the key a per-state dismissal would be stored against, and what separates one
   *  season's dates from the next when both fall inside the read band. */
  seasonKey: string;
  /** T-7 of the earliest member date. ISO. Telemetry / assertions; never rendered. */
  windowFrom: string;
  /** T+7 of the latest member date. ISO. */
  windowTo: string;

  counts: PeerGroupSeasonCounts;
  exposure: PeerGroupSeasonExposure;

  /** ★ A MEMBER FILED TODAY, OR IS SCHEDULED TODAY. Presence only — a marginally heavier rail and a
   *  filled icon chip, inside the SAME colour family. It is the group's form of the stock strip's
   *  "today" phases and carries the identical meaning: this is happening now. Never coloured, never
   *  stated in the sentence (the four states are the copy; this is the render). */
  activeToday: boolean;

  /** The full sentence — rendered at 640px and above. */
  sentence: string;
  segments: SentenceSegment[];
  /** The short sentence — below 640px. Same facts, fewer words; same gates. */
  shortSentence: string;
  shortSegments: SentenceSegment[];

  /** ★ ORDER CARRIES MEANING.
   *   `reported` DESCENDING by filing date — most recent first, so the row reads as a feed.
   *   `pending`  ASCENDING by scheduled date — the next reporter first, so it reads as a schedule.
   *  The whole ordered list crosses; the CAP is a render decision (what fits at 1080px) and the
   *  frontend collapses the remainder behind a count. The server states no cap — it would then have
   *  to know the viewport, which it does not. */
  reported: GroupSeasonCapsule[];
  pending: GroupSeasonCapsule[];

  /** The section's one control. Server-built path, exactly as the stock strip's is. */
  link: { label: string; href: string };
}

/**
 * Why a resolution produced no banner. Never rendered — the frontend renders nothing at all.
 * Typed so the verify harness can assert WHICH path fired rather than only that one did.
 */
export type PeerGroupSeasonSilence =
  /** No such peer group, or it has no active members. */
  | "unknown_group"
  /** Not one member carries an earnings row in the read band — there is no season to describe. */
  | "no_member_dates"
  /** A season exists but today is outside T-7…T+7 of it. The ordinary answer out of season, and the
   *  reason the section is conditional and unskeletoned. */
  | "outside_window"
  /** The five-table filing union threw. FAIL-CLOSED, the same ruling as the stock strip's gate 5:
   *  without it we cannot tell a reported member from a scheduled one, and the entire banner is
   *  built on that distinction. */
  | "filing_lookup_failed";

export type PeerGroupResultsSeasonResolution =
  | { banner: PeerGroupResultsSeasonBanner; silence: null }
  | { banner: null; silence: PeerGroupSeasonSilence };
