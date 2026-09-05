// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK COPY — every reader-facing sentence the fifteen stage-7 blocks can say when they have
// nothing to show. §7.2: a reader-facing string is a registry key, not a literal at a call site.
//
// ── ★ WHY THESE ARE HERE AND NOT NEXT TO THE CODE THAT SAYS THEM ──────────────────────────────────
// Fifteen blocks × an absent path each is fifteen chances to say "no data available" fifteen
// different ways, and the difference between "we do not hold this" and "this did not happen" is the
// difference N-4 exists to preserve. Collected, they can be read side by side and audited as a
// vocabulary; scattered, they are fifteen private opinions about the same reader.
//
// ── ★ THE ONE RULE EVERY SENTENCE HERE OBEYS ──────────────────────────────────────────────────────
// **An absence is either OURS or THE WORLD'S, and the sentence says which.** "No block deals are on
// file" is a fact about the market — deals genuinely did not happen. "We do not price this stock" is
// a fact about us. Collapsing them into "not available" hands the reader our gap as though it were
// the company's silence, which is the exact conflation §3.1 forbids one layer down in the data.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export const BLOCK_COPY = {
  // ── PRICE ─────────────────────────────────────────────────────────────────────────────────────
  price_none: "we hold no price history for this stock",
  price_no_benchmark: "no benchmark index resolved for this stock's sector",
  price_no_return: "the window does not reach back far enough to compute this",
  price_no_52w: "fewer than 52 weeks of prices held",

  // ── QUARTERLY SERIES ──────────────────────────────────────────────────────────────────────────
  quarters_none: "no quarterly results have been filed with us for this company",
  quarters_not_reported: "not reported in this quarter's filing",
  quarters_no_prior: "no earlier quarter held to compare against",

  // ── CORPORATE EVENTS ──────────────────────────────────────────────────────────────────────────
  // ⚠ THE WORLD'S ABSENCE, NOT OURS. Nothing scheduled is a real state a reader can act on.
  events_none: "nothing is scheduled or on record for this company in the window",
  events_undated: "the company has not disclosed a date for this yet",

  // ── OWNERSHIP EVENTS (insider · block/bulk) ───────────────────────────────────────────────────
  insider_none: "no insider transactions are on file for this stock in the last two years — an absence of disclosures is a real state, not missing data",
  deals_none: "no block or bulk deals are on file for this stock in the last two years — an absence of deals is a real state, not missing data",
  ownership_events_unscored: "we hold no ownership filings for this stock",

  // ── OWNERSHIP SERIES ──────────────────────────────────────────────────────────────────────────
  ownership_series_none: "no shareholding filings are held for this stock",
  ownership_series_thin: "only one filing is held, so there is no movement to read",
  ownership_undisclosed: "this class was not broken out in the filing",

  // ── PEERS ─────────────────────────────────────────────────────────────────────────────────────
  peers_none: "this stock is not assigned to a peer group",
  peers_too_few: "the peer group has too few members with data to average against",
  peers_no_index: "no sector index is mapped for this stock",

  // ── NEWS ──────────────────────────────────────────────────────────────────────────────────────
  news_none: "nothing about this company has been picked up in the window",
  news_external: "these are other people's headlines, not Vytal's own reading",

  // ── THE READER'S BOOK ─────────────────────────────────────────────────────────────────────────
  portfolio_empty: "your book is empty — no open positions are recorded against your account",
  // ⚠ THE TWIN OF THE LINE ABOVE, AND THE REASON IT NEEDED ONE. When the portfolio read returned
  // absent, the composition fell through to `portfolio_empty` and told a reader whose positions we
  // had FAILED TO READ that they hold nothing. Of every sentence in this file that is the worst one
  // to get wrong: it is about the reader's own money, it sounds checked, and it is unfalsifiable from
  // their side. OURS, and it says so.
  portfolio_read_failed:
    "we could not read your book just now — this is our side, and it does not mean your book is empty",
  portfolio_no_snapshot: "no health reading has been computed for this book yet",
  portfolio_unscored: "we do not score this holding",
  watchlist_empty: "you have not pinned anything to your watchlist yet",
  // ⚠ THE TWIN OF THE LINE ABOVE, for the same reason `portfolio_read_failed` exists. An empty
  // watchlist resolves `ok` and says so inside the set; a FAILED read produced no section at all
  // while the prose still opened "here is what you are watching" — promising a list we did not have.
  watchlist_read_failed:
    "we could not read your watchlist just now — this is our side, and it does not mean you have nothing pinned",
  relationship_not_held: "you do not hold this stock",
  relationship_no_book: "we hold no positions for you, so there is nothing to weigh this against",

  // ── NON-EQUITY INSTRUMENTS ────────────────────────────────────────────────────────────────────
  // ⚠ NEVER "not scored". A fund is not on the tier ladder at all (§3.7), and saying it is unscored
  //   implies it could be — which is a statement about a thing that does not exist.
  instrument_no_analytics: "we compute no performance analytics for this instrument",
  instrument_no_nav: "no recent NAV is held for this scheme",
  fund_window_short: "this scheme's NAV history does not reach back that far",

  // ── COMPARISON ────────────────────────────────────────────────────────────────────────────────
  compare_needs_two: "a comparison needs two companies and only one resolved",
  compare_not_comparable: "these two are not judged against the same peer set, so a side-by-side would compare different things",
  compare_missing_side: "we do not hold this figure for one of the two",

  // ── UNIVERSE · SCREEN ─────────────────────────────────────────────────────────────────────────
  screen_no_match: "no company in our coverage meets those conditions",
  screen_unknown_field: "we do not hold a comparable figure for that condition",
  universe_empty: "nothing in our coverage matches that slice",

  // ── F · THE FILED STATEMENTS (Phase 1 · Batch 1) ──────────────────────────────────────────────
  // ⚠ THE ANNUAL AND QUARTERLY ABSENCES ARE DIFFERENT SENTENCES BECAUSE THEY ARE DIFFERENT FACTS,
  //   and this is the measurement that made the split necessary: annual depth is a median of 2 years
  //   against 8 quarters quarterly, and 425 stocks reach five annual years against 1,868 reaching
  //   eight quarters. MANIPALHOS (measured: 1 quarter, 0 annual years) can answer a revenue question
  //   and cannot answer a balance-sheet one — one sentence for both would be false about one of them.
  annual_none: "no annual accounts have been filed with us for this company",
  annual_thin: "annual filings only reach back two years for most of what we cover, which is this universe's shape rather than this company's",
  statement_no_total: "the filing's own subtotal for this is not held, and adding the parts we do hold would not produce it",
  // ⚠ NOT "we do not score this" — the three financial families are not on the ladder yet at all.
  statement_unscored: "figures we hold and do not score — there is no health reading behind them, and this is the normal state for every NBFC and insurer we cover",

  // ── OA · OWNERSHIP (Phase 1 · Batch 1) ────────────────────────────────────────────────────────
  // ⚠ EVERY ONE OF THESE NAMES WHOSE ABSENCE IT IS. `pledge_*` sentences live in resolve/pledge.ts
  //   instead, because there they sit beside the measurement that justifies them and there is exactly
  //   one function that can emit them.
  ownership_snapshot_only: "we hold one filing for this company, so there is a register to show and no movement to read",
  ownership_no_promoter: "this company has no promoter holding — a widely-held register is a real state, not a missing class",
  ownership_movers_none: "no company in our coverage moved its promoter holding materially between its last two filings",
  ownership_series_bounded: "the register is shown at the filing dates we hold, and nothing is drawn between them",

  // ── WHEN WE ASK THE READER SOMETHING BACK (stage 9) ───────────────────────────────────────────
  // ⚠ EACH OF THESE IS A DIFFERENT SENTENCE ON PURPOSE. "I could not read your question", "you named
  //   a company and asked nothing" and "more than one company matches" were all being answered with
  //   one line — "I am not sure what you are asking about" — which blames the reader's phrasing in
  //   all three cases and is only accurate in the first.
  ask_bare_subject: "is a company, not yet a question — here is what I can tell you about it",
  ask_which_company: "more than one company matches that. Which did you mean?",
  // ★ THE ADVICE DECLINE. It says what we will not do and then does the useful thing, in one breath.
  //   A refusal on its own is the least useful true sentence available: the reader wanted to know
  //   whether the company is any good, and that part we can actually answer.
  decline_advice: "Whether to buy is yours to decide and depends on things we do not hold — what you already own, your horizon, your tax position. What we can do is show you what the company looks like on the figures.",
} as const;

export type BlockCopyKey = keyof typeof BLOCK_COPY;

/** The one accessor. A missing key is a compile error, not a blank sentence at render time. */
export const blockCopy = (k: BlockCopyKey): string => BLOCK_COPY[k];
