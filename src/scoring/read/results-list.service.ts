// File: src/scoring/read/results-list.service.ts
//
// THE page assembler for GET /api/v1/results — the cross-stock earnings feed, served one
// scroll page at a time, in two REAL halves:
//
//   • REPORTED  — the latest filed quarterly result per active stock, read straight
//                 from the five per-family quarterly_results tables (the same dense
//                 source the Fundamentals view serves). Deduped to the family's
//                 preferred basis (consolidated for non-financials; standalone for
//                 banks/insurers), then the most-recent period per stock.
//   • UPCOMING  — corporate_events of eventType "earnings" across the active universe:
//                 real board-meeting/result dates, honest "pending" (no numbers yet).
//
// The whole reduction lives in results-feed.cache.ts (it needs every row of five tables
// before anything can be ordered, so it cannot be a per-page query). What happens HERE is
// per-request and cheap: filter the cached half, slice the requested page off it by keyset,
// and hand back an opaque cursor for the next one.
//
// ── WHY KEYSET AND NOT OFFSET ──────────────────────────────────────────────────────────
// The cache rebuilds under the reader (5-minute TTL). An offset cursor resolves against a
// list that may have grown a row at the top since page 1, which silently repeats the card
// that got pushed across the boundary. A keyset cursor names the last row the reader
// actually SAW — "everything ordered after this filing date + symbol" — so a rebuild
// mid-scroll can add or drop rows without ever duplicating or skipping one on screen.
//
// UNITS: money is ₹ Crore; growth + headline-margin fields are already percent at the
// source (normalised in the cache). NO market-reaction and NO estimate-relative
// "beat/miss" — both are absent from the data. Every number is real or honest-null.

import { getResultsFeedRows } from "./results-feed.cache.js";
import type {
  ReportedResultItem,
  UpcomingResultItem,
  ResultsFeedKind,
  ResultsFeedPage,
  ResultsOverview,
} from "./results-list.types.js";

const DAY_MS = 86_400_000;

/** Top-growers strip size on the Results landing. */
const TOP_GROWERS = 10;

const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The upcoming window, resolved per REQUEST rather than per cache build. The slot is built
 *  once and served for up to five minutes, so a build that straddles midnight would otherwise
 *  keep yesterday's earnings dates in an "upcoming" feed. Both ends are re-derived here. */
function upcomingWindow(days: number): { from: string; to: string } {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  return { from: ymd(midnight.getTime()), to: ymd(midnight.getTime() + days * DAY_MS) };
}

/* ------------------------------------------------------------------ cursors */

/** A cursor is just the sort key of the last row on the page, base64url'd so no caller is
 *  tempted to construct one. Decoding a malformed cursor yields null → the request is served
 *  as an unpaged first page rather than as an error; a stale link should show the feed, not a 400. */
const encodeCursor = (date: string, symbol: string): string =>
  Buffer.from(`${date}|${symbol}`, "utf8").toString("base64url");

function decodeCursor(raw: string | undefined): { date: string; symbol: string } | null {
  if (!raw) return null;
  try {
    const [date, symbol] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!date || !symbol) return null;
    return { date, symbol };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ filters */

const matches = (q: string, symbol: string, name: string, sector: string | null): boolean =>
  symbol.toLowerCase().includes(q) ||
  name.toLowerCase().includes(q) ||
  (sector ?? "").toLowerCase().includes(q);

export interface ResultsFeedOpts {
  /** Which half to page (default "reported"). */
  feed?: ResultsFeedKind;
  /** Free-text match over symbol / name / sector. */
  q?: string;
  /** Reported only: keep results filed within the last `days` (the "This week" chip sends 7). */
  days?: number;
  /** Reported only: keep results whose stock carries a health score. */
  scoredOnly?: boolean;
  /** Upcoming only: look-ahead window in days (default 60). */
  upcomingDays?: number;
  /** Page size (default 12). */
  limit?: number;
  /** Opaque cursor from the previous page. Omit for the first page. */
  cursor?: string;
}

/* ------------------------------------------------------------------- paging */

export async function buildResultsFeed(opts: ResultsFeedOpts = {}): Promise<ResultsFeedPage> {
  const { feed = "reported", q, days, scoredOnly, upcomingDays = 60, limit = 12, cursor } = opts;
  const rows = await getResultsFeedRows();
  const term = q?.trim().toLowerCase();
  const after = decodeCursor(cursor);

  if (feed === "upcoming") {
    // The cached half runs a year ahead; the request's window is a filter over it.
    const { from, to } = upcomingWindow(upcomingDays);

    const all = rows.upcoming.filter(
      (u) =>
        u.eventDate >= from &&
        u.eventDate <= to &&
        (!term || matches(term, u.symbol, u.name, u.sector)),
    );
    // Ascending feed: "after the cursor" is a LATER date, or the same date and a later symbol.
    const rest = after
      ? all.filter(
          (u) =>
            u.eventDate > after.date || (u.eventDate === after.date && u.symbol > after.symbol),
        )
      : all;
    const items = rest.slice(0, limit);
    const last = items[items.length - 1];
    const hasMore = rest.length > items.length;
    return {
      feed,
      items,
      total: all.length,
      cursor: hasMore && last ? encodeCursor(last.eventDate, last.symbol) : null,
      hasMore,
    };
  }

  const since =
    days != null ? new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10) : null;

  const all = rows.reported.filter(
    (r) =>
      (since == null || r.filingDate >= since) &&
      (!scoredOnly || r.healthScore != null) &&
      (!term || matches(term, r.symbol, r.name, r.sector)),
  );
  // Descending feed: "after the cursor" is an EARLIER filing, or the same day and a later symbol.
  const rest = after
    ? all.filter(
        (r) => r.filingDate < after.date || (r.filingDate === after.date && r.symbol > after.symbol),
      )
    : all;
  const items = rest.slice(0, limit);
  const last = items[items.length - 1];
  const hasMore = rest.length > items.length;
  return {
    feed,
    items,
    total: all.length,
    cursor: hasMore && last ? encodeCursor(last.filingDate, last.symbol) : null,
    hasMore,
  };
}

/* ----------------------------------------------------------------- overview */

const mean = (vals: (number | null)[]): number | null => {
  const real = vals.filter((v): v is number => v != null);
  if (real.length === 0) return null;
  return Math.round((real.reduce((a, b) => a + b, 0) / real.length) * 100) / 100;
};

/**
 * Whole-feed context for the Results landing — header stats, filter-chip counts, top growers.
 *
 * Separate from the pages ON PURPOSE. These numbers describe the ENTIRE feed, so folding them
 * into page 1 would make them look page- or filter-dependent and would recompute them on every
 * scroll. Read once per visit; both halves come off the same cached rows the pages slice.
 */
export async function buildResultsOverview(upcomingDays = 60): Promise<ResultsOverview> {
  const rows = await getResultsFeedRows();

  const weekAgo = ymd(Date.now() - 7 * DAY_MS);
  const { from, to } = upcomingWindow(upcomingDays);

  // `.filter()` copies, so the sort below never touches the shared cached array.
  const topGrowers = rows.reported
    .filter((r) => r.profitYoy != null)
    .sort((a, b) => (b.profitYoy ?? 0) - (a.profitYoy ?? 0))
    .slice(0, TOP_GROWERS);

  return {
    counts: {
      reported: rows.reported.length,
      reportedThisWeek: rows.reported.filter((r) => r.filingDate >= weekAgo).length,
      scored: rows.reported.filter((r) => r.healthScore != null).length,
      upcoming: rows.upcoming.filter((u) => u.eventDate >= from && u.eventDate <= to).length,
    },
    averages: {
      revenueYoy: mean(rows.reported.map((r) => r.revenueYoy)),
      profitYoy: mean(rows.reported.map((r) => r.profitYoy)),
    },
    topGrowers,
  };
}

export type { ReportedResultItem, UpcomingResultItem };
