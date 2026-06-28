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
  aiHeadline: string | null; // latest earnings_analysis AiSummary headline, if any
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

export interface ResultsListData {
  reported: ReportedResultItem[];
  upcoming: UpcomingResultItem[];
  counts: {
    reported: number; // reported items returned
    upcoming: number; // upcoming items returned
    reportedThisWeek: number; // reported with filingDate within the last 7 days
  };
}
