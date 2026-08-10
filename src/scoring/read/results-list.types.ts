// File: src/scoring/read/results-list.types.ts
//
// Read-model for the RESULTS LIST — the JSON shape returned by GET /api/v1/results.
// Two real, dense halves over one endpoint:
//   • reported ← the per-family quarterly_results tables (the latest filed result per
//     stock), joined with the stored filing metadata + headline numbers.
//   • upcoming ← corporate_events (eventType "earnings") across the active universe —
//     real board-meeting/result dates, honest "pending" (no numbers yet).
//
// CONVENTIONS (mirror fundamentals/price reads): plain JS numbers; a field with no
// backing data is `null` with the key PRESENT. Money is ₹ Crore; growth/margin are
// PERCENT (already canonical in the source columns — never fabricated, never an
// estimate-relative "beat/miss"). NO market-reaction here (needs the price window —
// that is the viewer's job, build #2).

/** One REPORTED quarterly result — the latest filed quarter for one stock, on its
 *  preferred basis (consolidated for non-financials; standalone for banks/insurers). */
export interface ReportedResultItem {
  symbol: string;
  name: string;
  sector: string | null; // sector displayName, null when unmapped
  industryType: string; // the family — "non_financial" | "banking" | …

  quarter: string; // "Q1" | "Q2" | "Q3" | "Q4"
  fiscalYear: string; // "FY26"
  periodLabel: string; // "Q2 FY26"
  reportDate: string; // YYYY-MM-DD (period end)
  filingDate: string; // YYYY-MM-DD (filed with NSE)
  resultType: string; // "consolidated" | "standalone"

  // Topline — family-appropriate (revenue / NII / net premium / gross premium).
  revenue: number | null; // ₹ Cr
  revenueLabel: string; // "Revenue" | "Net interest income" | "Net premium" | …
  revenueYoy: number | null; // % (null when the family has no topline-YoY column)
  revenueQoq: number | null; // %

  // Bottom line — every family.
  netProfit: number | null; // ₹ Cr
  profitYoy: number | null; // %
  profitQoq: number | null; // %

  // Headline margin — operating margin for non-financials, net margin for financials.
  margin: number | null; // %
  marginLabel: string; // "Op margin" | "Net margin"
  netMargin: number | null; // %

  xbrlUrl: string;

  // Honest extras — present only when a REAL backing row exists, else null.
  healthScore: number | null; // composite health score (0–100) when the stock is scored
}

/** One UPCOMING result — a real earnings/board-meeting date with no numbers yet. */
export interface UpcomingResultItem {
  symbol: string;
  name: string;
  sector: string | null;
  eventDate: string; // YYYY-MM-DD
  isConfirmed: boolean;
  description: string | null;
}

/** Which half of the feed a page request is paging over. One request = one half; the two
 *  are separate lists with separate orderings and therefore separate cursors. */
export type ResultsFeedKind = "reported" | "upcoming";

/** One PAGE of one half. `cursor` is opaque — hand it back verbatim to get the next page.
 *  `total` counts the whole set matching the query's filters, not the page. */
export interface ResultsFeedPage {
  feed: ResultsFeedKind;
  items: ReportedResultItem[] | UpcomingResultItem[];
  total: number;
  cursor: string | null; // null once the feed is exhausted
  hasMore: boolean;
}

/** Whole-feed context for the Results landing: the header stats, the filter-chip counts and
 *  the top-growers strip. Deliberately NOT part of a page — these describe the entire feed and
 *  must not shift as the reader scrolls or searches. */
export interface ResultsOverview {
  counts: {
    reported: number; // stocks with a filed result
    reportedThisWeek: number; // filingDate within the last 7 days
    scored: number; // reported AND carrying a health score
    upcoming: number; // earnings dates inside the default look-ahead window
  };
  /** Means across every reported result that HAS the figure (nulls excluded, never zero-filled).
   *  Null when not one result carries it. Percent. */
  averages: {
    revenueYoy: number | null;
    profitYoy: number | null;
  };
  /** Highest net-profit YoY first. Only results that actually report the figure. */
  topGrowers: ReportedResultItem[];
}
