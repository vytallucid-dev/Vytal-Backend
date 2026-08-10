// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE RESULTS-SEASON COPY — composed here, rendered there.
//
// FOUR AXES, and every combination is authored rather than assembled from fragments at read time:
//   · phase        before | day_of | after
//   · position     held | watching | none          (held takes precedence over watching)
//   · copy set     scored | unscored               (the fourth reader-state)
//   · form         full (≥640px) | short (<640px)
// plus the publication branch inside `after`, and the pillar voice inside the scored set.
//
// ── ★ THE PILLAR VOICE IS COMPUTED, NOT ASSUMED ────────────────────────────────────────────────────
// `loadFoundationStandalone` (src/scoring/metrics/load.ts:29) selects from `fundamentals` — the ANNUAL
// table, no `quarter` column. `loadMomentumStandalone` (:76) selects from `quarterly_results`. The
// score-input manifest agrees. Measured: across the whole Jul–Aug 2026 season not one `fundamentals`
// row was written — every row carries a created_at from the 2026-07-09 backfill.
//
// So a Q1/Q2/Q3 filing moves MOMENTUM AND NOTHING ELSE, and only the Q4 board meeting — which carries
// the audited annual accounts — moves Foundation too. `pillarsAtStakeFor()` decides which, and this
// file speaks in whichever voice it returns. The original brief's wording survives EXACTLY where it is
// true (Q4); for the other three quarters the sentence names one pillar instead of two.
//
// ── ★ THE UNSCORED SET SAYS ONLY WHAT IS TRUE OF AN UNSCORED PAGE ──────────────────────────────────
// 355 of 504 active stocks carry no snapshot. The results date is still a fact about the company, so
// the strip fires — but every clause about "the score on this page", the pillars, ingestion and
// staleness is gone, because none of them has a referent there. What remains is the results fact and
// the reader's position. Gate 5's publication rule still applies: "were published" only where a filing
// exists, "were scheduled for" otherwise.
//
// ── WHAT THE GATE ENFORCES ─────────────────────────────────────────────────────────────────────────
//   · every authored sentence byte-identical, in both pillar voices and both copy sets — HARD FAIL
//   · scanForwardLanguage (the existing R2/R3 scan) over every full AND short form — HARD FAIL
//   · no promise of movement, no lag number, no instruction verb, no `expect` — HARD FAIL
//   · the unscored set names no score, no pillar, no ingestion, no staleness — HARD FAIL
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { PeriodDescriptor } from "./window.js";
import type {
  ReaderPosition,
  ResultsSeasonCopySet,
  ResultsSeasonPhase,
  SentenceSegment,
} from "./types.js";

/** The one seam: text, then the date in mono, then the rest. `date` null ⇒ a single plain segment
 *  (the day-of sentences say "today" and carry no date at all). */
function compose(lead: string, date: string | null, tail: string): SentenceSegment[] {
  if (date === null) return [{ text: lead + tail }];
  return [{ text: lead }, { text: date, mono: true }, { text: tail }];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PILLAR VOICE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Every clause that names a pillar, in both voices. Number agreement is baked into each string
 *  rather than patched on at the join — "Momentum are built from" is exactly the kind of seam a
 *  fragment-assembler produces and a reader notices. */
export interface PillarVoice {
  /** …That filing is what ___, so the reading on this page is likely to move… */
  builtFrom: string;
  /** ___, so the score here is likely to shift once it lands. */
  pillarCount: string;
  /** ___, so the health score on this page will be built on new numbers shortly after. */
  readsAccounts: string;
  /** Once the filing is out and the figures are in, ___ — the reading below… */
  scoredAgainst: string;
  /** …when it does, ___. */
  mostLikely: string;
  /** short form — Results are due 12 August — ___. */
  shortScoredFrom: string;
  /** short form — …___ once they're ingested. */
  shortLikely: string;
}

const MOMENTUM_ONLY: PillarVoice = {
  builtFrom: "Momentum is built from",
  pillarCount: "One of the four pillars is drawn straight from the quarterly filing",
  readsAccounts: "Momentum reads the quarterly accounts",
  scoredAgainst: "Momentum will be scored against them",
  mostLikely: "Momentum is the pillar most likely to move",
  shortScoredFrom: "Momentum is scored from that filing",
  shortLikely: "Momentum is likely to move",
};

const BOTH_PILLARS: PillarVoice = {
  builtFrom: "Foundation and Momentum are built from",
  pillarCount: "Two of the four pillars are drawn straight from the quarterly filing",
  readsAccounts: "Foundation and Momentum both read the quarterly accounts",
  scoredAgainst: "Foundation and Momentum will be scored against them",
  mostLikely: "Foundation and Momentum are the two pillars most likely to move",
  shortScoredFrom: "Foundation and Momentum are scored from that filing",
  shortLikely: "Foundation and Momentum are likely to move",
};

/** The voice for a pillar set. Two pillars ⇒ the annual-bearing Q4 filing; one ⇒ Q1/Q2/Q3. */
export function pillarVoice(pillars: readonly ("foundation" | "momentum")[]): PillarVoice {
  return pillars.includes("foundation") ? BOTH_PILLARS : MOMENTUM_ONLY;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FULL FORM — 640px and above
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * THE SCORED VOICE — and it now covers only TWO phases.
 *
 * ── ★ WHY `after` AND `filed_today` FELL OUT OF IT ─────────────────────────────────────────────────
 * The post-result sentences used to assert "the score on this page is still built on the previous
 * quarter". That is a claim about US, not about the results, and it is false the moment a rescore
 * runs — measured at p50 2.3 hours after ingest. Keeping it forced a gate that suppressed the banner
 * on nineteen stocks whose results had just landed, which is the exact reader this surface is for.
 *
 * The alternative was to make the clause conditional on the snapshot state. That was rejected: the
 * condition is the same check the deleted gate ran, so it keeps the identical correctness burden and
 * merely moves it from "whether to show" to "what to say" — where being wrong is visible rather than
 * silent. It also asks the reader to care about our queue depth, which is not their subject.
 *
 * So the post-result phases say what the results ARE and stop. That makes them identical to the
 * results-only voice, which is deliberate and asserted, not a coincidence.
 *
 * WHAT SURVIVES HERE IS SAFE BY CONSTRUCTION. `before` and `day_of` are reachable ONLY when no filing
 * for the period exists (the service routes a filing to `filed_today`/`after`), so "the reading below
 * is still the previous quarter's" cannot be false: the quarter it would need is not in the database.
 */
function fullScored(
  phase: ResultsSeasonPhase,
  position: ReaderPosition,
  dateText: string | null,
  publicationConfirmed: boolean,
  v: PillarVoice,
  period: PeriodDescriptor,
): SentenceSegment[] {
  // Post-result: no score clause at all. One voice, shared with the unscored set.
  if (phase === "after" || phase === "filed_today") {
    return fullResultsOnly(phase, position, dateText, publicationConfirmed, period);
  }

  if (phase === "before") {
    if (position === "held") {
      return compose(
        "You hold this one, and results are due on ",
        dateText,
        `. That filing is what ${v.builtFrom}, so the reading on this page is likely to move once the numbers are in.`,
      );
    }
    if (position === "watching") {
      // ⚠ "so expect the score here to shift" WAS the authored wording and is gone. Part 2 forbids
      //   promising movement in its own words, and `\bexpect\b` is a banned register term
      //   (verify-copy-register.ts rule 1 — "a forecast, not an observation").
      return compose(
        "This is on your watchlist and results are due on ",
        dateText,
        `. ${v.pillarCount}, so the score here is likely to shift once it lands.`,
      );
    }
    return compose(
      "Results are due on ",
      dateText,
      `. ${v.readsAccounts}, so the health score on this page will be built on new numbers shortly after.`,
    );
  }

  if (phase === "day_of") {
    // No date in any day-of sentence — "today" IS the date, and repeating it would be noise.
    const tail = `Once the filing is out and the figures are in, ${v.scoredAgainst} — the reading below is still the previous quarter's.`;
    if (position === "held") return compose(`Results are due today, and you hold this one. ${tail}`, null, "");
    if (position === "watching") return compose(`Results are due today on a name you're watching. ${tail}`, null, "");
    return compose(`Results are due today. ${tail}`, null, "");
  }

  // Unreachable: the two post-result phases returned at the top of this function, and `before` and
  // `day_of` both returned above. Kept so a new phase cannot silently fall through to nothing.
  throw new Error(`fullScored: unhandled phase ${phase}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNSCORED SET — the results fact, the reader's position, and WHAT WAS FILED.
//
// Every clause the scored set carries about the score, the pillars, ingestion or staleness is absent
// by construction, not by trimming: on a stock with no snapshot there is no score to be stale, no
// pillar to move, and no rescore to wait for.
//
// ── ★ THE SECOND CLAUSE NAMES THE FILING, NOT THE READER'S NEXT MOVE ───────────────────────────────
// The date alone was thin. What this set CAN honestly add is what the filing contains — a fact about
// the company and about a page we actually serve. It is written as a DESCRIPTION and never as an
// instruction: no "see", "check", "review", "look at", "head to". The link is the call to action; the
// sentence says what is there. The gate's instruction scan enforces exactly that.
//
// ── WHY "TOP LINE" AND NOT "REVENUE" ───────────────────────────────────────────────────────────────
// A filing lands in whichever of the five per-family tables matches the company, and the results page
// labels the first line differently for each — "Revenue" for an IndAS filer, "Interest earned" for a
// bank. Naming `revenue` would be wrong for the ~7% of the window that files under the banking
// taxonomy. "Top line" is what every family's first line IS, so it is true of all five.
//
// Verified populated, not assumed: for the June-2026 period every one of the 617 IndAS rows and all
// 47 banking rows carries a top line, a net profit AND a margin. The clause names three things we
// hold, not three things we hope for.
//
// ── THE QUARTER VARIES THE CLAUSE ──────────────────────────────────────────────────────────────────
// A Q4 board meeting approves the audited FULL-YEAR accounts alongside the March quarter, so its
// filing contains materially more than a Q1–Q3 one. That is a fact about the filing and stays true on
// an unscored stock, which is why this set may state it while still naming no pillar.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** The clause naming what the filing contains. `filed` is the publication tense, not the phase: the
 *  post-result branch may only say the figures ARE on the page once a filing exists (gate 5). */
function contentsClause(period: PeriodDescriptor, filed: boolean): string {
  const m = period.monthName;
  if (period.isAnnualBearing) {
    return filed
      ? `That filing carried the audited full-year accounts as well as the ${m} quarter, and both are on the results page.`
      : `A year-end filing carries the audited full-year accounts as well as the ${m} quarter, and both will be on the results page once they are filed.`;
  }
  return filed
    ? `The ${m}-quarter top line, profit and margins are on the results page.`
    : `The ${m}-quarter top line, profit and margins will be on the results page once they are filed.`;
}

/**
 * THE RESULTS-ONLY VOICE — the results fact, the reader's position, and what the filing contains.
 *
 * Serves the WHOLE unscored set, and both post-result phases of the scored set. That overlap is the
 * point: once results are out there is nothing score-specific left to say that is not either a
 * staleness claim (false within hours of a rescore) or a forecast (banned). So both sets converge on
 * one voice, and the gate asserts the convergence so it reads as a decision rather than an accident.
 */
function fullResultsOnly(
  phase: ResultsSeasonPhase,
  position: ReaderPosition,
  dateText: string | null,
  publicationConfirmed: boolean,
  period: PeriodDescriptor,
): SentenceSegment[] {
  // `filed` is true wherever a filing is KNOWN to exist — both post-result phases when gate 5 confirms
  // it. Everywhere else the clause speaks in the future, which claims nothing.
  const filed = (phase === "after" || phase === "filed_today") && publicationConfirmed;
  const tail = ` ${contentsClause(period, filed)}`;

  if (phase === "before") {
    if (position === "held") return compose("You hold this one, and results are due on ", dateText, `.${tail}`);
    if (position === "watching") return compose("This is on your watchlist and results are due on ", dateText, `.${tail}`);
    return compose("Results are due on ", dateText, `.${tail}`);
  }

  if (phase === "day_of") {
    if (position === "held") return compose(`Results are due today, and you hold this one.${tail}`, null, "");
    if (position === "watching") return compose(`Results are due today on a name you're watching.${tail}`, null, "");
    return compose(`Results are due today.${tail}`, null, "");
  }

  // ── filed_today ─────────────────────────────────────────────────────────────────────────────────
  // A filing for the period landed TODAY, so this phase only ever exists with publication confirmed —
  // the filing's own date is what put us here. No date in the sentence: "today" IS the date.
  if (phase === "filed_today") {
    if (position === "held") return compose(`Results came out today, and you hold this one.${tail}`, null, "");
    if (position === "watching") return compose(`Results came out today on a name you're watching.${tail}`, null, "");
    return compose(`Results came out today.${tail}`, null, "");
  }

  // ── after — gate 5's rule, the one check that survives, because it guards a claim about the WORLD
  //    (did this company report?) rather than a claim about our coverage. ─────────────────────────
  if (publicationConfirmed) {
    if (position === "held") return compose("Results were published on ", dateText, `, and you hold this one.${tail}`);
    if (position === "watching") return compose("Results came out on ", dateText, `, and you're watching this one.${tail}`);
    return compose("Results were published on ", dateText, `.${tail}`);
  }
  if (position === "held") return compose("Results were scheduled for ", dateText, `, and you hold this one.${tail}`);
  if (position === "watching") return compose("Results were scheduled for ", dateText, `, and you're watching this one.${tail}`);
  return compose("Results were scheduled for ", dateText, `.${tail}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SHORT FORM — below 640px
//
// Measured on the shipped Inter metrics: at 360px the paragraph is 266px wide, and seven of the nine
// full sentences ran to five or six lines. That is the sentence being too long for the width, so the
// fix is a shorter sentence — never a clamp, never an ellipsis. Same facts, fewer words.
//
// ★ THE POSITION CLAUSE IS KEPT FOR held AND watching, and that is load-bearing: without it the
//   watching and anonymous short forms would be the SAME STRING, and the reader-state distinction the
//   whole banner is built on would silently collapse at phone width. The chip above says "Watching",
//   but a chip is not a sentence.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** "You hold this. " / "You're watching this. " / "" — the short form's position opener. */
function shortOpener(position: ReaderPosition): string {
  if (position === "held") return "You hold this. ";
  if (position === "watching") return "You're watching this. ";
  return "";
}

function shortScored(
  phase: ResultsSeasonPhase,
  position: ReaderPosition,
  dateText: string | null,
  publicationConfirmed: boolean,
  v: PillarVoice,
  period: PeriodDescriptor,
): SentenceSegment[] {
  // Same split as the full form: post-result phases carry no score clause and share one voice.
  if (phase === "after" || phase === "filed_today") {
    return shortResultsOnly(phase, position, dateText, publicationConfirmed, period);
  }

  const open = shortOpener(position);
  if (phase === "before") {
    return compose(`${open}Results are due `, dateText, ` — ${v.shortScoredFrom}.`);
  }
  // day_of — reachable only with no filing, so the staleness half is true by construction.
  return compose(
    `${open}Results are due today — ${v.shortScoredFrom}; the reading below is last quarter's.`,
    null,
    "",
  );
}

/**
 * The short unscored form keeps ONE sentence, per the width brief — the contents ride in as a dashed
 * rider rather than a second sentence, which is what lets the whole thing stay inside four lines at
 * 360px. Wording is trimmed to match: "figures" rather than "top line, profit and margins", because
 * at 266px the enumeration costs a line and buys nothing the fuller form does not already say.
 */
function shortContentsRider(period: PeriodDescriptor, filed: boolean): string {
  const m = period.monthName;
  if (period.isAnnualBearing) {
    return filed
      ? ` — the ${m} quarter and the audited full-year accounts are on the results page.`
      : ` — the ${m} quarter and the audited full-year accounts.`;
  }
  return filed
    ? ` — the ${m}-quarter figures are on the results page.`
    : ` — the ${m}-quarter figures land on the results page once they are filed.`;
}

function shortResultsOnly(
  phase: ResultsSeasonPhase,
  position: ReaderPosition,
  dateText: string | null,
  publicationConfirmed: boolean,
  period: PeriodDescriptor,
): SentenceSegment[] {
  const open = shortOpener(position);
  const filed = (phase === "after" || phase === "filed_today") && publicationConfirmed;
  const rider = shortContentsRider(period, filed);

  if (phase === "before") return compose(`${open}Results are due `, dateText, rider);
  if (phase === "day_of") return compose(`${open}Results are due today${rider}`, null, "");
  if (phase === "filed_today") return compose(`${open}Results came out today${rider}`, null, "");
  if (publicationConfirmed) {
    const verb = position === "watching" ? "Results came out " : "Results were published ";
    return compose(`${open}${verb}`, dateText, rider);
  }
  return compose(`${open}Results were scheduled for `, dateText, rider);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface ComposedCopy {
  segments: SentenceSegment[];
  shortSegments: SentenceSegment[];
}

/**
 * Compose both forms for one combination.
 *
 * The two variation inputs are deliberately separate and each is read by exactly one set:
 *   · `pillars` — SCORED only. The unscored set names no pillar, so `[]` is the honest input there.
 *   · `period`  — UNSCORED only. It names what the filing contains; the scored set's clauses speak
 *                 about the score instead and never mention the period.
 * Both derive from the same meeting date, but they are different claims and are kept apart so one
 * cannot quietly start standing in for the other.
 */
export function composeCopy(
  phase: ResultsSeasonPhase,
  position: ReaderPosition,
  copySet: ResultsSeasonCopySet,
  dateText: string | null,
  publicationConfirmed: boolean,
  pillars: readonly ("foundation" | "momentum")[],
  period: PeriodDescriptor,
): ComposedCopy {
  if (copySet === "unscored") {
    return {
      segments: fullResultsOnly(phase, position, dateText, publicationConfirmed, period),
      shortSegments: shortResultsOnly(phase, position, dateText, publicationConfirmed, period),
    };
  }
  const v = pillarVoice(pillars);
  return {
    segments: fullScored(phase, position, dateText, publicationConfirmed, v, period),
    shortSegments: shortScored(phase, position, dateText, publicationConfirmed, v, period),
  };
}

/** The segments joined — for the copy gate, and any consumer that wants the plain text. */
export function joinSegments(segments: SentenceSegment[]): string {
  return segments.map((s) => s.text).join("");
}

/** The chip that sits before the sentence. "none" renders no chip at all. */
export function positionChipLabel(position: ReaderPosition): string | null {
  if (position === "held") return "Held";
  if (position === "watching") return "Watching";
  return null;
}

/** The strip's one control. The server builds the path so the frontend never assembles a href. */
export const LINK_LABEL = "Open results";
export function linkHref(symbol: string): string {
  return `/results/${encodeURIComponent(symbol)}?tab=snapshot`;
}
