// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO NAV — the authenticated user's daily value-over-time series.
//
//   GET /api/v1/me/portfolio/nav                        full book (first buy → last close)
//   GET /api/v1/me/portfolio/nav?period=1Y              tail-sliced to the period (1M|6M|1Y|3Y|ALL)
//   GET /api/v1/me/portfolio/nav?accountId=…            scoped to ONE owned account (+ optional period)
//
// READ-ONLY, DERIVED: computed from the Transaction ledger × DailyPrice closes — no
// stored NAV field. EOD-honest (daily closes; latest point = last close). Starts at the
// first buy; a young book is honestly short (never a fabricated backfill). The frontend
// value/return charts read this; the benchmark (Nifty) overlay is a SEPARATE series and
// stays gated until an index feed exists — never faked here.
//
// Owner = req.authUser.userId (never the payload) — IDOR-proof. `accountId` (when present) is
// validated as the caller's own (resolveAccountScope → 404 on a foreign/unknown id); omitted ⇒
// whole-book, identical to today. The broker-gap disclosure scopes with it: a manual account
// yields ZERO gap, a linked account only its OWN connection's excluded holdings.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { computePortfolioNav } from "../../portfolio/nav/assemble.js";
import { brokerExcludedSummary } from "../../portfolio/history/live-value.js";
import { resolveAccountScope } from "./account-scope.js";

// Period → trailing days sliced off the tail (from the LAST point). ALL = full range.
// 4Y (1461d) is the ceiling on a BLENDED chart (R6): funds reach 4y, listed non-stocks ~2.5y, and
// neither should imply the full daily-equity depth — so "All" is dropped when non-stocks are held.
const PERIOD_DAYS: Record<string, number | null> = {
  "1M": 30,
  "6M": 182,
  "1Y": 365,
  "3Y": 1095,
  "4Y": 1461,
  ALL: null,
};

export const getPortfolioNav = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;

  // Optional account scope — validated as owned (404 on a foreign/unknown id). undefined ⇒ whole-book.
  const scope = await resolveAccountScope(req, res);
  if (!scope.ok) return;
  const accountId = scope.accountId;

  const requested = String(req.query.period ?? "ALL").toUpperCase();

  try {
    const nav = await computePortfolioNav(userId, accountId);

    // R6 — a blended/fund chart caps at 4Y and never serves "All": a 4-year store behind an "All"
    // button is a chart that isn't all. Stock-only books keep their full daily range.
    let period = requested in PERIOD_DAYS ? requested : nav.blended ? "4Y" : "ALL";
    if (nav.blended && (period === "ALL")) period = "4Y";

    // Server-side tail slice for the period selectors (full-from-first-buy is always
    // reachable via ALL). Honest-short: if history is younger than the window, the whole
    // series returns — never padded.
    let series = nav.series;
    const windowDays = PERIOD_DAYS[period];
    if (windowDays != null && series.length > 0) {
      const last = new Date(series[series.length - 1].date);
      const cutoff = new Date(last);
      cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      series = series.filter((p) => p.date >= cutoffStr);
    }

    // (Ruling C) A broker-linked book's series covers only the LEDGERED holdings; disclose the gap.
    // Scoped with `accountId`: a manual account → zero gap (no disclosure); a linked account → only
    // its own connection's excluded holdings; whole-book (no accountId) → the whole user's, as before.
    const broker = await brokerExcludedSummary(userId, accountId);

    return res.json({
      success: true,
      data: {
        series, // [{ date, value }] — trading-day points; the FINAL point is pinned LIVE
        meta: {
          period,
          accountId: accountId ?? null, // the scope this series is FOR (null ⇒ whole book) — additive
          blended: nav.blended, // true ⇒ non-stocks held → 4Y cap, no "All"
          maxRange: nav.blended ? "4Y" : "ALL",
          firstDate: nav.firstDate, // first buy's first trading day (full range)
          lastDate: nav.lastDate, // last point ("at last close" for history; the endpoint is live)
          points: series.length, // points in THIS response
          totalPoints: nav.points, // points in the full series
          symbolsWithoutPrice: nav.symbolsNoPrice, // held names with no close (contributed 0)
          // (Step 21) Held non-stocks with NO chartable series yet — named, never valued at 0.
          excludedFromSeries: nav.excludedFromSeries,
          // (Ruling C) What the ledgered series omits: broker-linked holdings shown in the overview.
          brokerHoldingsExcluded: broker.count > 0 ? broker : null,
          basis: "eod_close_live_endpoint", // history is EOD; the last point is the live overview value
          currency: "INR",
        },
      },
    });
  } catch (e) {
    console.error("[GET /me/portfolio/nav]", e);
    return res
      .status(500)
      .json({ success: false, error: "server_error", message: "Failed to build the NAV series" });
  }
};
