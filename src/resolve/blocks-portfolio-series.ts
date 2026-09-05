// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE READER'S BOOK OVER TIME — value, and health. T-1b finding 6.
//
// ★ REUSE, NOT RE-DERIVATION, AND THE REUSE IS AT THE SERVICE — NOT AT THE COMPONENT.
//   Stage 9's comparison lesson was that taking metrics from `buildComparisonView` beat re-deriving
//   them, because the second derivation is the one that is wrong. The faithful analogue here is the
//   backend read, not the React component:
//
//     value   `computePortfolioNav(userId)`  — src/portfolio/nav/assemble.ts, the SAME function
//             GET /me/portfolio/nav calls for the Overview tab's chart.
//     health  `portfolio_score_history`      — the SAME rows GET /me/score-history serves to
//             HealthHistoryChart, read the same way (date-ascending, nulls preserved).
//
//   ⚠ WHY NOT IMPORT THE CHART COMPONENTS THEMSELVES, WHICH WOULD HAVE BEEN LESS CODE.
//     `NavChart` and `HealthHistoryChart` fetch through their own hooks. A section renderer that
//     fetches breaks §4.2's rule that every renderer takes `Resolved<T>` and owns a visible absent
//     state: the payload and its `coverage` would describe data the component never used, and the
//     absent state a reader saw would be the hook's, not the answer's. The COMPUTATION is what must
//     not be duplicated, and it is not.
//
// ⚠ HEALTH NEEDS NO NEW RENDERER. A 0–100 score over time with bands is exactly `composite-spine`
//   (§4.1 amendment). Only the value line was new.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { computePortfolioNav } from "../portfolio/nav/assemble.js";
import { absent, resolved, type QueryCoverage, type Resolved } from "./contract.js";

export interface PortfolioSeriesPoint { readonly at: string; readonly value: number }

export interface PortfolioValueRead {
  readonly points: readonly PortfolioSeriesPoint[];
  readonly firstDate: string | null;
  readonly lastDate: string | null;
  /** True when the book holds funds as well as listed names — the series is then capped at 4Y. */
  readonly blended: boolean;
  /** Names carried in the book whose price history is missing, so the line is honest-short. */
  readonly symbolsNoPrice: readonly string[];
}

const NO_QUERY: QueryCoverage = { universeSearched: 0, depthFloor: null, excludedForDepth: 0, dropped: [] };

/** The book's value over time. `not_ingested` when the book has never been valued — a NEW account,
 *  which is a real state and not an error. */
export async function resolvePortfolioValueSeries(userId: string): Promise<Resolved<PortfolioValueRead>> {
  // ⚠ C-1, AND BOTH ARMS ARE REAL HERE. `computePortfolioNav` is typed to resolve to a result object,
  //   so `!nav` is the catch; `series.length === 0` is a book that has genuinely never been valued —
  //   a NEW account, which the header above already calls a real state and not an error. The single
  //   condition was collapsing the two, so a failed valuation read as "this book is new".
  let read = true;
  const nav = await computePortfolioNav(userId).catch(() => { read = false; return null; });
  if (!read || !nav) {
    return absent<PortfolioValueRead>("reader_read_failed", { subject: null, query: NO_QUERY });
  }
  if (nav.series.length === 0) {
    return absent<PortfolioValueRead>("not_ingested", { subject: null, query: NO_QUERY });
  }
  return resolved<PortfolioValueRead>(
    {
      points: nav.series.map((p) => ({ at: p.date, value: p.value })),
      firstDate: nav.firstDate,
      lastDate: nav.lastDate,
      blended: nav.blended,
      symbolsNoPrice: nav.symbolsNoPrice,
    },
    { subject: null, query: { ...NO_QUERY, universeSearched: nav.points } },
    ["portfolio_ledger"],
  );
}

export interface PortfolioHealthRead {
  readonly points: readonly PortfolioSeriesPoint[];
  readonly latest: number | null;
  readonly first: number | null;
}

/**
 * The book's health over time, from `portfolio_score_history`.
 *
 * ⚠ A NULL POINT IS SKIPPED, NEVER ZEROED — the same rule `HealthHistoryChart` states in its own
 *   header. A row written before a column existed carries null, and plotting it as 0 would draw a
 *   collapse that never happened.
 */
export async function resolvePortfolioHealthSeries(userId: string): Promise<Resolved<PortfolioHealthRead>> {
  // ⚠ NOT ONE OF THE NINE — it never swallowed anything, it simply threw. It is guarded here because
  //   the pair test found it: with the database unreachable, a reader's book question died in THIS
  //   call (via portfolioHealthBlock) before the book sentence two blocks below could be reached. Its
  //   sibling above now distinguishes a failed valuation from a new account; leaving this one to
  //   throw would mean a reader still gets a 500 rather than either sentence.
  let read = true;
  const rows = await prisma.portfolioScoreHistory.findMany({
    where: { userId },
    orderBy: { date: "asc" },
    select: { date: true, phs: true },
  }).catch(() => { read = false; return [] as { date: Date; phs: unknown }[]; });
  if (!read) return absent<PortfolioHealthRead>("reader_read_failed", { subject: null, query: NO_QUERY });
  const points = rows
    .filter((r) => r.phs != null)
    .map((r) => ({ at: r.date.toISOString().slice(0, 10), value: Number(r.phs) }));
  if (points.length === 0) {
    return absent<PortfolioHealthRead>("not_ingested", { subject: null, query: NO_QUERY });
  }
  return resolved<PortfolioHealthRead>(
    { points, latest: points[points.length - 1]!.value, first: points[0]!.value },
    { subject: null, query: { ...NO_QUERY, universeSearched: points.length } },
    ["portfolio_ledger"],
  );
}
