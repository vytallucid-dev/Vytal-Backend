// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PEER-GROUP RESULTS-SEASON COPY — composed here, rendered there.
//
// FOUR STATES, and the progression between them is the CONTENT of a month-long banner rather than a
// decoration on it. Measured: the 13 scored ponds carry windows of 20–44 days (median 35), so a
// sentence that did not move as the season moved would be wallpaper by the second visit.
//
//   none_reported   the season is ahead — when it opens, and how many are due
//   partly          how many are in, how many remain, and when the next one reports
//   one_remaining   that stock specifically, and its date
//   all_reported    the season closed, and when the last one landed
//
// ── ★ EVERY STATE NAMES ITS SUBJECT IN THE FIRST CLAUSE — "POSTED RESULTS" ─────────────────────────
// The first draft counted members without naming what they had done: "Seven of the eight have
// reported" left the reader to supply "…results" from a page title. ONE verb phrase now carries the
// subject in every state and BOTH forms — `posted results` — so no sentence depends on its
// surroundings to be complete. `none_reported` already named it ("Results season … opens on"), and
// its behind-branch was moved from "Nothing has been filed" to "Nothing has been posted" so the verb
// is genuinely one verb rather than two that happen to mean the same thing.
//
// The short form uses the SIMPLE PAST — "Four of seven posted results" — rather than the perfect, the
// same compression it already applies elsewhere; the verb phrase is identical.
//
// The capsule row labels are deliberately NOT touched: "Reported" and "Still to come" sit under a
// sentence that has already named the subject, so they have nothing left to be ambiguous about.
//
// Each carries, WHERE APPLICABLE, two further clauses:
//   · the reader's exposure, AS COUNTS ONLY — "Two are on your watchlist and one you hold". Never a
//     name, never a position readout, never a value.
//   · the scoring consequence, on the HONEST pillar set. `loadFoundationStandalone` reads the ANNUAL
//     `fundamentals` table and `loadMomentumStandalone` reads `quarterly_results`
//     (src/scoring/metrics/load.ts), so a Q1–Q3 filing bears on Momentum ALONE and only the Q4
//     board meeting — which carries the audited annual accounts — reaches Foundation. The same
//     `pillarsAtStakeFor` derivation the stock strip runs decides which voice speaks here.
//     It also names how many members are SCORED, because an unscored member's results change nothing
//     on our side and a bare "nine of ten reported" would let a reader assume otherwise.
//
// ── ★ COUNTS ARE WORDS, DATES ARE MONO, MEMBERS ARE CAPSULES ───────────────────────────────────────
// Three kinds of segment, and each is a different kind of thing:
//   · plain    prose
//   · `mono`   a DATE — the invariant is still "a mono segment IS a date"
//   · `stock`  a NAMED MEMBER, drawn as the SAME capsule the rows below carry
//
// The third is new and it fixed a real mismatch. "Only Petronet LNG Ltd is left, on 12 August" put the
// company in prose while the identical company, one row down, was a bordered capsule with the reader's
// own exposure marker on it — one object rendered two ways, and only one of the two looked like an
// object. The `one_remaining` clause is THE ONLY PLACE ANY STATE NAMES A MEMBER (checked: the other
// three speak in counts), and both its forms now emit the ticker as structure.
//
// Counts stay spelled as words, which is also what the shipped stock copy already does ("One of the
// four pillars…"). Ponds are ≤10 members, so a word always exists; `countWord` falls back to a
// numeral above ten rather than inventing English for a size that cannot occur today.
//
// ── ★ THE AHEAD / BEHIND BRANCH, AND WHY IT IS NOT OPTIONAL ────────────────────────────────────────
// "The next on 11 August" is false if that date is behind us — which happens whenever a member's
// board meeting has passed and nothing has been filed. That is not hypothetical: the whole reason the
// stock strip carries gate 5 is that a scheduled date and a publication are different facts. So every
// clause that names a PENDING date branches on whether it is still ahead, and says "was scheduled
// for" when it is not. Same discipline, same reason.
//
// ── WHAT THE GATE ENFORCES ─────────────────────────────────────────────────────────────────────────
//   · every authored sentence byte-identical, in both quarter voices and both forms — HARD FAIL
//   · scanForwardLanguage (the existing R2/R3 scan) over every full AND short form — HARD FAIL
//   · the SHARED instruction / movement-promise / lag-number scans, the same lists the stock strip's
//     gate runs — HARD FAIL
//   · every mono segment IS a date, and no date is duplicated into a plain segment — HARD FAIL
//   · every state × reader-exposure × scoring combination is distinct where it must be — HARD FAIL
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { formatBannerDate, utcMidnight } from "./window.js";
import type { PeriodDescriptor } from "./window.js";
import { linkHref } from "./copy.js";
// ★ COUNTS-AS-WORDS MOVED OUT, AND IS RE-EXPORTED FROM HERE UNCHANGED. The three-lens separation
//   section composes sentences of the same shape over the same subject (members of one pond), so a
//   second WORDS array would be two homes for "is it 'seven' or '7'". Callers that imported
//   countWord/CountWord from this module still can — see src/lib/count-words.ts for the ruling.
import { countWord, CountWord } from "../lib/count-words.js";
import type {
  GroupSeasonCapsule,
  GroupSeasonState,
  SentenceSegment,
  SentenceStock,
} from "./group-types.js";
import type { SeasonMember } from "./group-window.js";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SEGMENT ASSEMBLY
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A piece of the sentence:
 *   · plain text
 *   · a DATE, which wears the mono face
 *   · a STOCK, which is drawn as the same capsule the rows below use
 *
 * ★ THE STOCK PIECE IS WHY THIS IS A THREE-WAY UNION. A named member used to arrive as a string and
 *   render as prose, which made the one company the sentence singles out the one company on the
 *   section that did NOT look like a company. It is structure now.
 */
type Piece = string | { date: string } | { stock: SentenceStock };

/**
 * Fold pieces into segments, merging adjacent text so the frontend never receives two plain spans in
 * a row. The stock strip's `compose()` takes exactly one date; a group sentence can name two (a
 * season that opens on one date and closes on another) and a member besides, so this generalises the
 * same seam rather than duplicating it with a second fixed arity.
 *
 * ⚠ ONLY PLAIN TEXT MERGES. A `mono` or `stock` segment ends the run, and text following one starts a
 *   new segment — otherwise a capsule's ticker would be swallowed into the prose around it.
 */
function assemble(pieces: readonly Piece[]): SentenceSegment[] {
  const out: SentenceSegment[] = [];
  for (const p of pieces) {
    if (typeof p === "string") {
      if (p === "") continue;
      const last = out[out.length - 1];
      if (last && !last.mono && !last.stock) last.text += p;
      else out.push({ text: p });
    } else if ("date" in p) {
      out.push({ text: p.date, mono: true });
    } else {
      // ★ `text` IS THE TICKER. The joined sentence has to be the string the reader actually sees,
      //   and what the capsule shows is the ticker — see SentenceStock's note on the invariant.
      out.push({ text: p.stock.symbol, stock: p.stock });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// NUMBER VOICE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** `countWord` / `CountWord` now live in src/lib/count-words.ts — one home, two surfaces. Re-exported
 *  here so every existing importer (and this module's own gate) keeps its import path. */
export { countWord, CountWord };

const isAre = (n: number): string => (n === 1 ? "is" : "are");
/** ⚠ NUMBER AGREEMENT, BAKED IN RATHER THAN PATCHED AT THE JOIN. "One of the eight HAVE reported" is
 *  exactly the seam a fragment-assembler produces and a reader notices — it shipped in the first
 *  draft and the gate now asserts against it. */
const hasHave = (n: number): string => (n === 1 ? "has" : "have");

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE INPUT
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface GroupCopyInput {
  state: GroupSeasonState;
  /** Members carrying a date this season — the denominator for every count in the copy. */
  due: number;
  reported: number;
  /** Of the DUE members, how many carry a health snapshot. */
  scored: number;
  /** Reader exposure, counts only. Held has already taken precedence over watching per member. */
  held: number;
  watching: number;
  /** What the filings are OF — the same descriptor the stock strip's unscored set reads. */
  period: PeriodDescriptor;
  /** "11 July" — the earliest member date. `none_reported` names it. */
  firstDateText: string;
  /** True when that earliest date is today or ahead. False ⇒ the season's first meeting has passed
   *  with nothing filed, and the copy must not say it "opens on" a date behind us. */
  firstIsAhead: boolean;
  /** "14 August" — the latest member date. `none_reported` names it. */
  lastDateText: string;
  /** "11 August" — the next PENDING member's date. Null only where no member is pending. */
  nextDateText: string | null;
  /** True when that pending date is today or ahead. */
  nextIsAhead: boolean;
  /** "7 August" — the most recent FILING date. Null only where nothing has been filed. */
  lastFiledDateText: string | null;
  /**
   * The single remaining member — `one_remaining` only, and THE ONLY STATE THAT NAMES A MEMBER.
   *
   * ★ IT ARRIVES AS A CAPSULE'S WORTH OF FACTS, not a name. Both forms render it as the same capsule
   *   the rows below carry: ticker face, the reader's exposure marker, and a link where the company
   *   has reported. `href` is null here in practice — the remaining member is PENDING by definition —
   *   but it is threaded rather than assumed, so the rule stays "linked iff filed" in one place.
   */
  lastOne: SentenceStock | null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE STATE CLAUSE — FULL FORM (640px and above)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

function fullState(i: GroupCopyInput): Piece[] {
  const remaining = i.due - i.reported;
  const m = i.period.monthName;

  if (i.state === "none_reported") {
    // ⚠ `due === 1` collapses first and last onto the same date; naming it twice would read as a
    //   rendering fault rather than as one member reporting once.
    if (i.due === 1) {
      return i.firstIsAhead
        ? ["Results season for this group opens on ", { date: i.firstDateText }, ", with one member due to report."]
        : [`Nothing has been posted for this group's ${m} quarter. Its one dated member was scheduled for `, { date: i.lastDateText }, "."];
    }
    const head: Piece[] = i.firstIsAhead
      ? ["Results season for this group opens on ", { date: i.firstDateText }, ". "]
      : [`Nothing has been posted for this group's ${m} quarter. `];
    return [...head, `${CountWord(i.due)} members have a date, the last of them on `, { date: i.lastDateText }, "."];
  }

  if (i.state === "partly") {
    const head = `${CountWord(i.reported)} of the ${countWord(i.due)} ${hasHave(i.reported)} posted results. `;
    return i.nextIsAhead
      ? [head, `${CountWord(remaining)} are still to come, the next on `, { date: i.nextDateText ?? "" }, "."]
      : [head, `${CountWord(remaining)} are still to come; the earliest of them was scheduled for `, { date: i.nextDateText ?? "" }, "."];
  }

  if (i.state === "one_remaining") {
    // Reachable only with `reported >= 1` (see `seasonStateFor`'s precedence), so `due >= 2` and the
    // "N of the M" head is always well-formed here.
    const head = `${CountWord(i.reported)} of the ${countWord(i.due)} ${hasHave(i.reported)} posted results. `;
    // ★ THE TICKER, AS A CAPSULE — in the FULL form too, which is the change.
    //
    //   "Only Petronet LNG Ltd is left" read as prose while the identical company sat one row below
    //   as a bordered capsule wearing the reader's own exposure marker. The full form used to differ
    //   from the short form here on purpose (the name at desktop width, the ticker at phone width);
    //   that difference is what made the sentence and the row look like two different kinds of thing,
    //   and it cost the reader a name-to-ticker match every time. Both forms now name the same object
    //   the same way, and the company NAME survives where it always belonged — on the capsule's
    //   accessible label and hover title, which `SentenceStock.name` carries.
    const who: Piece = i.lastOne ? { stock: i.lastOne } : "one member";
    return i.nextIsAhead
      ? [head, "Only ", who, " is left, on ", { date: i.nextDateText ?? "" }, "."]
      : [head, "Only ", who, " is left; it was scheduled for ", { date: i.nextDateText ?? "" }, "."];
  }

  // all_reported — everything is behind us by construction, so there is no ahead/behind branch.
  // ⚠ `due === 2` SAYS "BOTH", NOT "ALL TWO". No live pond has exactly two dated members today, but
  //   Large-Cap Defense already runs five dates out of seven members, so it is a matter of calendar
  //   coverage rather than of pond size — and "All two have posted results" is the kind of sentence a
  //   count-substituting composer ships and a reader never forgives.
  if (i.due === 1) return ["The group's one scheduled reporter posted results on ", { date: i.lastFiledDateText ?? "" }, "."];
  if (i.due === 2) return ["Both have posted results, the last on ", { date: i.lastFiledDateText ?? "" }, "."];
  return [`All ${countWord(i.due)} have posted results, the last on `, { date: i.lastFiledDateText ?? "" }, "."];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE EXPOSURE CLAUSE — COUNTS ONLY, IN BOTH FORMS
//
// ★ NEVER A NAME AND NEVER A VALUE. A count is a fact about the reader's relationship to the season;
//   a name or a position size is a fact about their book, which this section is not about and which
//   would put a portfolio readout on a public research page.
//
// ★ AND THE NUMBERS ARE THE MARKER COUNTS, arriving from `exposureCounts` over the same per-member
//   field the capsules draw from. A member that is both held and watchlisted is counted in both, so
//   "One is on your watchlist and one you hold" can describe one capsule wearing two marks — which is
//   what the reader sees. The alternative (held wins, as on the stock strip) would print "You hold one
//   of them" beside a visible watchlist ring, and a sentence contradicting the thing under it is worse
//   than a number that needs a legend to read.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

function fullExposure(held: number, watching: number): string {
  if (held > 0 && watching > 0) {
    return ` ${CountWord(watching)} ${isAre(watching)} on your watchlist and ${countWord(held)} you hold.`;
  }
  if (watching > 0) return ` ${CountWord(watching)} ${isAre(watching)} on your watchlist.`;
  if (held > 0) return ` You hold ${countWord(held)} of them.`;
  return "";
}

function shortExposure(held: number, watching: number): string {
  if (held > 0 && watching > 0) return ` ${CountWord(watching)} on your watchlist, ${countWord(held)} held.`;
  if (watching > 0) return ` ${CountWord(watching)} on your watchlist.`;
  if (held > 0) return ` You hold ${countWord(held)}.`;
  return "";
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SCORING CLAUSE — THE HONEST PILLAR SET, AND THE SCORED COUNT
//
// ★ THE PILLAR VOICE IS COMPUTED, NOT ASSUMED — the same measurement the stock strip's copy rests on.
//   `fundamentals` is the ANNUAL table and the only thing Foundation reads; across the whole Jul–Aug
//   2026 season not one row was written to it. So a Q1–Q3 filing bears on Momentum ALONE, and only a
//   Q4 board meeting — which approves the audited full year alongside the quarter — reaches both.
//
// ★ AND THE SCORED COUNT, because it is the difference between "nine companies reported" and "nine
//   readings moved". Within today's 13 scored ponds every member is scored, so this reads "all ten of
//   them are scored" everywhere — but the count is DERIVED, so the day the Nifty-500 firewall lets an
//   unscored member into a pond the sentence tells the truth without anyone editing it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

function scoredTail(scored: number, due: number): string {
  if (scored === due) {
    if (due === 1) return "the one member here is scored";
    if (due === 2) return "both of them are scored"; // never "all two of them"
    return `all ${countWord(due)} of them are scored`;
  }
  return `${countWord(scored)} of the ${countWord(due)} are scored`;
}

function shortScoredTail(scored: number, due: number): string {
  if (scored === due) {
    if (due === 1) return "it is scored";
    if (due === 2) return "both scored";
    return `all ${countWord(due)} scored`;
  }
  return `${countWord(scored)} of ${countWord(due)} scored`;
}

function fullScoring(i: GroupCopyInput): string {
  const m = i.period.monthName;
  if (i.scored === 0) {
    // No pillar is named, because none is computed for any member here. What IS true is stated.
    const filing = i.period.isAnnualBearing ? "year-end" : `${m}-quarter`;
    return ` None of them carries a health score, so a ${filing} filing changes nothing on our side.`;
  }
  // ⚠ THE CLAUSE IS DELIBERATELY SHORT, and that is a wallpaper decision rather than a style one.
  //   This half of the sentence is the SAME on every pond every day of a 20-to-44-day season, so
  //   every character of it is a character the reader re-reads without learning anything. The first
  //   draft ran 130; this states both facts — which pillar, and how many members are scored — in
  //   about 85, and the state clause in front of it is what carries the change.
  if (i.period.isAnnualBearing) {
    return ` A year-end filing carries the audited full year besides the ${m} quarter, so it bears on Foundation as well as Momentum; ${scoredTail(i.scored, i.due)}.`;
  }
  return ` Foundation reads the annual accounts, so a ${m}-quarter filing bears on Momentum alone; ${scoredTail(i.scored, i.due)}.`;
}

function shortScoring(i: GroupCopyInput): string {
  if (i.scored === 0) return " None of them is scored.";
  if (i.period.isAnnualBearing) {
    return ` The year-end filing feeds Foundation and Momentum; ${shortScoredTail(i.scored, i.due)}.`;
  }
  return ` Momentum reads the quarter; ${shortScoredTail(i.scored, i.due)}.`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE STATE CLAUSE — SHORT FORM (below 640px)
//
// Same facts, fewer words — never a clamp and never an ellipsis. The stock strip measured 266px of
// paragraph at a 360px viewport (~41 characters a line); this section carries a third clause the
// strip does not, so its ceiling is four lines of the state+exposure+scoring sentence with the two
// capsule rows below. The gate holds it to a measured character budget.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

function shortState(i: GroupCopyInput): Piece[] {
  const remaining = i.due - i.reported;

  if (i.state === "none_reported") {
    if (i.firstIsAhead) return ["Season opens ", { date: i.firstDateText }, ` — ${countWord(i.due)} due.`];
    return i.due === 1
      ? ["Nothing posted yet — one due, on ", { date: i.lastDateText }, "."]
      : [`Nothing posted yet — ${countWord(i.due)} due, the last on `, { date: i.lastDateText }, "."];
  }

  if (i.state === "partly") {
    const head = `${CountWord(i.reported)} of ${countWord(i.due)} posted results, ${countWord(remaining)} to come — `;
    return i.nextIsAhead
      ? [head + "next ", { date: i.nextDateText ?? "" }, "."]
      // "earliest", not "earliest was" — the dash rider is already past-tense by construction and the
      // four characters are a measured line at 266px. The FULL form keeps "was scheduled for".
      : [head + "earliest ", { date: i.nextDateText ?? "" }, "."];
  }

  if (i.state === "one_remaining") {
    // ★ THE TICKER, NOT THE COMPANY NAME — and now as a CAPSULE rather than as a word. The rendered
    //   text is byte-identical to what this form has always produced ("… — ZYDUSLIFE left, 11
    //   August."); what changed is that the ticker is its own segment, so the phone form draws the
    //   same object the desktop form does instead of two spellings of one decision.
    const head = `${CountWord(i.reported)} of ${countWord(i.due)} posted results — `;
    const who: Piece = i.lastOne ? { stock: i.lastOne } : "one";
    return i.nextIsAhead
      ? [head, who, " left, ", { date: i.nextDateText ?? "" }, "."]
      : [head, who, " left, was due ", { date: i.nextDateText ?? "" }, "."];
  }

  if (i.due === 1) return ["The one reporter posted results ", { date: i.lastFiledDateText ?? "" }, "."];
  if (i.due === 2) return ["Both posted results — last on ", { date: i.lastFiledDateText ?? "" }, "."];
  return [`All ${countWord(i.due)} posted results — last on `, { date: i.lastFiledDateText ?? "" }, "."];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface ComposedGroupCopy {
  segments: SentenceSegment[];
  shortSegments: SentenceSegment[];
}

/** Compose both forms for one resolved season. Three clauses in a fixed order — the state, the
 *  reader's exposure, the scoring consequence — because that is the order of decreasing generality
 *  and it keeps the sentence readable when the middle clause is absent (a stranger, or a reader with
 *  no exposure to this pond). */
export function composeGroupCopy(i: GroupCopyInput): ComposedGroupCopy {
  return {
    segments: assemble([...fullState(i), fullExposure(i.held, i.watching), fullScoring(i)]),
    shortSegments: assemble([...shortState(i), shortExposure(i.held, i.watching), shortScoring(i)]),
  };
}

/**
 * ★ ONE CAPSULE — the date voice and the server-built href, in the copy layer where both belong.
 *
 * A REPORTED capsule carries the FILING date (when the company actually published — the same ruling
 * as the stock strip's `dateBasis`) and a link. A PENDING one carries the SCHEDULED date and `null`:
 * there is nothing filed to open, and inventing a control for it would be a link to a 404.
 *
 * ⚠ THE LINK IS SAFE EVEN WHEN THE MEMBER IS UNSCORED, and that was measured rather than assumed.
 *   `/results/:symbol` 404s only when a stock has no filed quarterly result AT ALL
 *   (result-detail.service.ts) — scoring is irrelevant to it. Probed on six reported-but-unscored
 *   peer-group members (DLF, MOTHERSON, TITAN, SHRIRAMFIN, BERGEPAINT, CANFINHOME): every one
 *   returned a full 20-period page with `health.scored = false`. So no capsule needs suppressing.
 *
 * `linkHref` is the STOCK STRIP'S function, unmodified — one definition of "the results page for
 * this symbol", encoded once, used by both surfaces.
 */
export function capsuleFor(m: SeasonMember): GroupSeasonCapsule {
  const filed = m.filedOn ? utcMidnight(m.filedOn) : null;
  const date = filed ?? utcMidnight(m.scheduledDate);
  return {
    symbol: m.symbol,
    name: m.name,
    date: date.toISOString().slice(0, 10),
    dateText: formatBannerDate(date),
    dateBasis: filed ? "filing" : "meeting",
    href: filed ? linkHref(m.symbol) : null,
    // Straight through from the member — the marker and the sentence's counts read the SAME field,
    // so there is no second derivation for them to disagree about.
    exposure: m.exposure,
  };
}

/** The section's one control.
 *
 *  ★ IT IS THE FEED, NOT A MEMBER. Every reported capsule already opens its own results page, so a
 *  control that opened one of them would duplicate a capsule; and there is no group-scoped results
 *  route to point at (the feed's `q` filter is not read from the URL by the page). `/results` is the
 *  one destination that is true in every state and overclaims nothing. Built HERE, on the server, so
 *  the frontend never assembles a href — the same rule as the stock strip. */
export const GROUP_LINK_LABEL = "Open results feed";
export function groupLinkHref(): string {
  return "/results";
}
