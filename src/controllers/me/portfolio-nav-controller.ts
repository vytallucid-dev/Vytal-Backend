// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO NAV — the authenticated user's daily value-over-time series.
//
//   GET /api/v1/me/portfolio/nav              full series (first buy → last close)
//   GET /api/v1/me/portfolio/nav?period=1Y    tail-sliced to the period (1M|6M|1Y|3Y|ALL)
//
// READ-ONLY, DERIVED: computed from the Transaction ledger × DailyPrice closes — no
// stored NAV field. EOD-honest (daily closes; latest point = last close). Starts at the
// first buy; a young book is honestly short (never a fabricated backfill). The frontend
// value/return charts read this; the benchmark (Nifty) overlay is a SEPARATE series and
// stays gated until an index feed exists — never faked here.
//
// Owner = req.authUser.userId (never the payload) — IDOR-proof, no id input.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { computePortfolioNav } from "../../portfolio/nav/assemble.js";

// Period → trailing days sliced off the tail (from the LAST close). ALL = full range.
const PERIOD_DAYS: Record<string, number | null> = {
  "1M": 30,
  "6M": 182,
  "1Y": 365,
  "3Y": 1095,
  ALL: null,
};

export const getPortfolioNav = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;

  const requested = String(req.query.period ?? "ALL").toUpperCase();
  const period = requested in PERIOD_DAYS ? requested : "ALL";

  try {
    const nav = await computePortfolioNav(userId);

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

    return res.json({
      success: true,
      data: {
        series, // [{ date, value }] — trading-day points
        meta: {
          period,
          firstDate: nav.firstDate, // first buy's first trading day (full range)
          lastDate: nav.lastDate, // last close ("at last close")
          points: series.length, // points in THIS response
          totalPoints: nav.points, // points in the full series
          symbolsWithoutPrice: nav.symbolsNoPrice, // held names with no close (contributed 0)
          basis: "eod_close",
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
