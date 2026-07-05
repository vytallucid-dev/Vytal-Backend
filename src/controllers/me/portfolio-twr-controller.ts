// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO TWR — the authenticated user's time-weighted (cash-flow-neutral) return.
//
//   GET /api/v1/me/portfolio/twr    { series: {date,twrIndex}[], scalars, meta }
//
// The PERFORMANCE series: indexed to 100 at the first day, cash-flow-neutral (a deposit
// does NOT read as return). This is what the benchmark overlay compares against Nifty —
// raw-NAV-rebased conflated deposits with alpha. Read-only, DERIVED from ledger ×
// DailyPrice (no store). The raw ₹ NAV series stays a SEPARATE endpoint (the value chart).
//
// Owner = req.authUser.userId (never the payload) — IDOR-proof, no id input.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { computePortfolioTwr } from "../../portfolio/nav/assemble.js";

export const getPortfolioTwr = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  try {
    const twr = await computePortfolioTwr(userId);
    return res.json({
      success: true,
      data: {
        series: twr.series, // [{ date, twrIndex }] — indexed to 100 at the first day
        scalars: {
          totalTwrPct: twr.totalTwrPct, // cumulative TWR % (index − 100); the Performance headline
          annualizedPct: twr.annualizedPct, // CAGR of the index; null when span < ~30d
          days: twr.days,
          firstDate: twr.firstDate,
          lastDate: twr.lastDate,
        },
        meta: {
          basis: "twr_eod_close", // time-weighted, daily-linked, EOD closes
          indexedTo: 100,
          // XIRR (money-weighted) is a DIFFERENT, legitimate figure (it answers "what did MY
          // timing earn") — not this endpoint; TWR is the one for benchmark comparison.
        },
      },
    });
  } catch (e) {
    console.error("[GET /me/portfolio/twr]", e);
    return res
      .status(500)
      .json({ success: false, error: "server_error", message: "Failed to build the return series" });
  }
};
