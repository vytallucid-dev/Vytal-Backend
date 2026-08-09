// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESULTS-SEASON BANNER — the shape that crosses to the frontend.
//
// A CONDITIONAL strip on the Stock Overview and Stock Health pages: results are coming, arrived today,
// or landed recently. Absent outside the window, absent when there is no scheduled date, and absent
// whenever a sentence would state something we cannot check. Silence is still a common output.
//
// ── THE SENTENCE IS COMPOSED HERE, NOT THERE ───────────────────────────────────────────────────────
// Same rule as every other sentence in the product. `segments` is the composed sentence already split
// at the one place the frontend needs a seam: the DATE, which wears the app's mono face like every
// other date. The frontend maps segments to spans — it never parses, never re-templates, never chooses
// a variant. `sentence` is the same text joined, for the copy gate to scan.
//
// ── TWO FORMS, ONE DECISION ────────────────────────────────────────────────────────────────────────
// `segments` is the full sentence; `shortSegments` is the same facts in fewer words, for widths below
// 640px where the full form ran to five and six lines. BOTH are composed here and BOTH pass the same
// gates — the frontend picks by breakpoint, never by rewriting.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Where the reader stands relative to the results. Structural — the frontend varies PRESENCE by this
 * (a marginally stronger rail, a filled icon chip on the two "today" phases), never colour.
 *
 * ── ★ FOUR PHASES, AND THE FILING DECIDES THE PAST ─────────────────────────────────────────────────
 *   before       no filing for the period, meeting T+1…T+7
 *   day_of       no filing for the period, meeting today — so the score is definitionally still on
 *                the previous quarter, which is what makes that claim safe without any gate
 *   filed_today  a filing for the period landed TODAY
 *   after        a filing landed earlier, OR the meeting has passed with nothing filed (gate 5 picks
 *                the wording between those two)
 *
 * `filed_today` exists because the alternative was silence. A stock that reported this morning is the
 * single most interesting state this banner has, and it used to render nothing.
 */
export type ResultsSeasonPhase = "before" | "day_of" | "filed_today" | "after";

/** What the CALENDAR alone says, before the filing is consulted. `filed_today` is unreachable from a
 *  date — it requires a filing — so the calendar's vocabulary is deliberately narrower. */
export type CalendarPhase = "before" | "day_of" | "after";

/** The reader's position on this object. `held` takes precedence over `watching` (Part 1). */
export type ReaderPosition = "held" | "watching" | "none";

/**
 * ★ WHICH COPY SET THE SENTENCE COMES FROM — the fourth reader-state.
 *
 *  "scored"   — the stock carries a health score, so the sentence may say what the filing bears on it.
 *  "unscored" — no snapshot exists (355 of 504 active stocks). A results date is a fact about the
 *               COMPANY, not about our coverage, so the strip still fires; but every clause about
 *               "the score on this page", the pillars, ingestion and staleness is removed, because on
 *               an unscored stock each of them would assert something that does not exist.
 */
export type ResultsSeasonCopySet = "scored" | "unscored";

/**
 * ★ THE READER'S RELATIONSHIP TO ONE NAMED OBJECT — THE app's exposure vocabulary, declared once.
 *
 * This module is PURE (no imports at all), which is why the union lives here rather than beside the
 * resolver: every surface that draws a marker can name the type without dragging a Prisma client into
 * its import graph. The resolver is `resolveReaderExposure` in src/relational/reader-exposure.ts, and
 * `CapsuleExposure` in group-types.ts is an alias of this — one union, one set of marks, one legend.
 *
 * "both" IS ITS OWN STATE, never a precedence call: a reader who both holds and watchlists a company
 * put both facts there themselves, and silently dropping one would be hiding it.
 */
export type ReaderExposure = "none" | "held" | "watching" | "both";

/**
 * ★ A STOCK NAMED INSIDE A SENTENCE — the segment that renders as a CAPSULE, not as prose.
 *
 * ── WHY A SEGMENT TYPE AND NOT A STRING ────────────────────────────────────────────────────────────
 * "Only Petronet LNG Ltd is left, on 12 August" read as prose: the company disappeared into the
 * sentence while the identical company, one row below, was a bordered capsule with the reader's own
 * exposure marker on it. Two renderings of one object, and only one of them looked like an object.
 *
 * So a named member crosses as STRUCTURE — the same four facts the capsule row carries — and the
 * frontend draws the SAME capsule from it. The sentence is still composed here; what changes is that
 * one of its pieces is a thing rather than a word.
 *
 * ⚠ `text` IS THE TICKER, and the invariant is `text === symbol`. Two reasons, both measured: the
 *   capsule row below shows tickers, so a sentence showing "Petronet LNG Ltd" and a row showing
 *   "PETRONET" made the reader match them by eye; and `sentence` (the joined form the copy gate scans)
 *   has to be the string a reader actually sees, which is now the ticker.
 */
export interface SentenceStock {
  /** The ticker — and the segment's own `text`. */
  symbol: string;
  /** The company's catalogue name. The capsule's accessible label / hover title, never its face. */
  name: string;
  /** The reader's relationship to this member — the marker the capsule wears. */
  exposure: ReaderExposure;
  /** The server-built results href, or null where the company has not reported and there is nothing
   *  filed to open. NEVER assembled on the frontend (the `ctx.appLinks` precedent). */
  href: string | null;
}

/**
 * One piece of the composed sentence.
 *   · plain      — text alone
 *   · `mono`     — a DATE, in the app's mono face
 *   · `stock`    — a NAMED MEMBER, drawn as the capsule the rows below use
 * Exactly one of `mono` / `stock` is ever set; a plain segment sets neither.
 */
export interface SentenceSegment {
  text: string;
  mono?: boolean;
  stock?: SentenceStock;
}

/** The app-internal route the strip's one control opens. The SERVER builds the path — the frontend
 *  never assembles a href from parts (the `ctx.appLinks` seam precedent). */
export interface ResultsSeasonLink {
  label: string;
  href: string;
}

export interface ResultsSeasonBanner {
  phase: ResultsSeasonPhase;
  /** Rendered only as a chip ("Held" / "Watching"); "none" renders no chip. */
  position: ReaderPosition;
  copySet: ResultsSeasonCopySet;

  /** The scheduled board-meeting date, ISO yyyy-mm-dd. Never rendered raw — `segments` carries the
   *  formatted form. Present for telemetry / test assertions. */
  eventDate: string;
  /** "12 August" — composed here, in the app's date voice. Null on BOTH "today" phases, whose
   *  sentences say "today" and carry no date. */
  dateText: string | null;
  /** ★ WHICH DATE `dateText` NAMES. "filing" once results are in our hands — that is when they were
   *  published, and we hold the real value, so inferring it from the calendar would be a downgrade.
   *  "meeting" before anything is filed. Not rendered; it stops `eventDate` and `dateText` from
   *  quietly disagreeing for anyone reading the payload. */
  dateBasis: "meeting" | "filing";

  /** ★ DID WE SEE THE FILING? Drives which post-result sentence is composed (Part 2, constraint 1).
   *  true  — a filing row for the period exists, so "results were published" is a fact we hold.
   *  false — the scheduled date has passed and nothing has landed; the copy says "were scheduled for"
   *          and makes no publication claim. Applies to BOTH copy sets. */
  publicationConfirmed: boolean;

  /** The full sentence — rendered at 640px and above. */
  sentence: string;
  segments: SentenceSegment[];
  /** The short sentence — rendered below 640px. Same facts, fewer words. */
  shortSentence: string;
  shortSegments: SentenceSegment[];

  link: ResultsSeasonLink;

  /** ★ THE PILLAR SET THE FILING ACTUALLY FEEDS, and the sentence is composed FROM it — not merely
   *  recorded beside it. Momentum reads `quarterly_results`; Foundation reads the ANNUAL `fundamentals`
   *  table, which only a Q4/annual filing writes. Empty on the unscored set, which names no pillar. */
  pillarsAtStake: ("foundation" | "momentum")[];
}

/**
 * Why a resolution produced no banner. Never rendered — the frontend renders nothing at all. Kept as
 * a typed value so the verify harness can assert WHICH path fired rather than only that one did.
 *
 * ⚠ THREE REASONS HAVE BEEN DELETED, AND EACH DELETION IS A RULING:
 *   · `not_scored`               — being unscored SELECTS a copy set; it does not silence.
 *   · `score_already_reflects_it`— whether our score has caught up is a fact about US. It is not the
 *                                  banner's subject and must not decide whether the banner appears.
 *   · `filing_already_landed`    — a stock that filed today is the most interesting state there is;
 *                                  it now has its own phase rather than being hidden.
 * A reason that can no longer be produced would be a lie about what this resolver can do, so none of
 * them survives as a dead enum member.
 */
export type ResultsSeasonSilence =
  /** No earnings row for this stock inside T-7…T+7. */
  | "no_scheduled_date"
  /** ⚠ UNREACHABLE BY CONSTRUCTION and kept as defence in depth: `loadStockFacts` already restricts
   *  the query to ±WINDOW_DAYS and `phaseFor` uses the SAME constant, so a row that came back from
   *  that query cannot fall outside the window. It survives only so that widening one without the
   *  other fails loudly here instead of resolving a phase for a date months away. */
  | "outside_window"
  /** The filing lookup itself failed. Fail-CLOSED: without it we cannot tell "were published" from
   *  "were scheduled for", and gate 5 exists precisely to keep those apart. */
  | "filing_lookup_failed"
  /** No such stock, or it is not active. */
  | "unknown_stock";

export type ResultsSeasonResolution =
  | { banner: ResultsSeasonBanner; silence: null }
  | { banner: null; silence: ResultsSeasonSilence };
