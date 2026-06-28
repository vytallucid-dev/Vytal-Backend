// ─────────────────────────────────────────────────────────────
// NEWS & ANNOUNCEMENTS detection guards (pure, no I/O).
//
// The 9th cron — STRUCTURALLY a two-source cron. NSE filings (session
// JSON) and Google RSS (hand-parsed XML) break INDEPENDENTLY, so the
// guards are SPLIT BY SOURCE and source-labelled (news_nse / news_google)
// so a flag names WHICH source died.
//
// THE GAP THESE CLOSE: the per-stock fetch loop swallows every error
// (console.warn), and the outer try/catch only fails on universe-load /
// scaffold throws — so a fully-dead source is logged `status="success"`
// with inserted=0, indistinguishable from a quiet day. Evidence is
// swallowed per-stock, so all four guards are RUN-LEVEL: the loop
// accumulates counters, evaluated once before newsFetchLog.create.
//
// Display-only cron (no pillar reads stock_news) → detection-only.
//
// ── NSE filings (2 guards) ──
//   SHAPE response-array (CRITICAL) — the object-where-array trap at
//     nse-announcements.ts (`if (!Array.isArray(data)) return []`). A
//     renamed/changed envelope yields silent 0 announcements. Empty-but-
//     array = legit quiet symbol → NOT flagged (holiday-immune).
//   SHAPE field-presence (HIGH) — rows arrive but seq_id/desc/an_dt are
//     renamed, so `.filter(r => r.seq_id && r.desc && r.an_dt)` drops all
//     → silent 0. Distinct from the envelope trap (array present).
//   COUNT is N/A for NSE: the 2-day dedup window legitimately yields
//     near-zero NEW rows on a quiet day (a real inserted=1 day observed),
//     so a volume floor would false-flag.
//
// ── Google RSS (2 guards) ──
//   SHAPE source-alive (HIGH) — 200-but-not-RSS (consent/captcha/HTML
//     block page → 0 `<item>` silently) OR every fetch threw (403/block).
//     The real Google-block risk. Holiday-immune (RSS isn't market-gated).
//   COUNT aggregate-zero (HIGH) — feeds were valid RSS but universe-wide
//     0 items parsed → search-query semantics changed. Valid here (unlike
//     NSE) because Google HAS a reliable non-zero floor (~22/run observed,
//     never 0 across 224 stocks × 7-day window); per-stock count stays
//     N/A (sparse). Fires only when SHAPE source-alive did NOT (some valid
//     RSS arrived) so the two never double-report.
//
// NULL-RATE / RANGE / future-date: N/A both sources — parsers pre-validate
// (always-present fields 0% null; structurally-absent fields 100% null by
// design; 0% future-dated). SHAPE-per-source is the honest set.
// ─────────────────────────────────────────────────────────────

export const NEWS_NSE_CRON = "news_nse";
export const NEWS_NSE_SOURCE = "nse";
export const NEWS_GOOGLE_CRON = "news_google";
export const NEWS_GOOGLE_SOURCE = "google_rss";

// ── runRef builders (mirror the NewsFetchLog.fetchType identity) ──
export const nseRunRef = (d: Date) => `${d.toISOString().slice(0, 10)}:nse_daily`;
export const googleRunRef = (d: Date) =>
  `${d.toISOString().slice(0, 10)}:google_news_daily`;

// ── Source-shape helper (fetcher + dry-run share this) ──
/** True if the body is RSS/Atom-shaped (vs an HTML consent/captcha page). */
export function looksLikeRss(body: string): boolean {
  return /<rss[\s>]|<feed[\s>]|<channel[\s>]|<item[\s>]/i.test(body);
}

// ── Run-level counters accumulated in the fetch loop ──
export interface NseRunStats {
  /** Responses actually returned by nseClient.get (throws excluded). */
  responsesReceived: number;
  /** Of those, how many were NOT arrays (the envelope trap). */
  nonArrayResponses: number;
  /** Total raw array elements seen across array responses. */
  rawRowsSeen: number;
  /** Raw rows that passed the seq_id+desc+an_dt required-field filter. */
  passedFilter: number;
}

export interface GoogleRunStats {
  /** Stocks we attempted to fetch (includes throws). */
  stocksAttempted: number;
  /** Fetches that returned a 200 body (throws excluded). */
  responsesReceived: number;
  /** Of those, how many bodies were NOT RSS-shaped. */
  nonRssBodies: number;
  /** Items parsed across all valid feeds (pre-dedup). */
  itemsParsed: number;
}

// ── NSE predicates ───────────────────────────────────────────

/** CRITICAL: every response we got back was non-array → envelope shape broke. */
export function nseShapeBreach(s: NseRunStats): boolean {
  return s.responsesReceived > 0 && s.nonArrayResponses === s.responsesReceived;
}

/** HIGH: rows arrived but none passed the required-field filter → field rename. */
export function nseFieldPresenceBreach(s: NseRunStats): boolean {
  return s.rawRowsSeen > 0 && s.passedFilter === 0;
}

// ── Google predicates ────────────────────────────────────────

/** HIGH: source dead — every fetch threw, or every 200 body was non-RSS. */
export function googleSourceDeadBreach(s: GoogleRunStats): boolean {
  if (s.stocksAttempted > 0 && s.responsesReceived === 0) return true; // all threw (block)
  return s.responsesReceived > 0 && s.nonRssBodies === s.responsesReceived; // all non-RSS
}

/**
 * HIGH: valid RSS arrived but universe-wide 0 items → query semantics changed.
 * Excludes the all-non-RSS case (that's source-dead) so the two never both fire.
 */
export function googleAggregateZeroBreach(s: GoogleRunStats): boolean {
  return (
    s.responsesReceived > 0 &&
    s.nonRssBodies < s.responsesReceived &&
    s.itemsParsed === 0
  );
}
