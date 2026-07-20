// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO TWR — the authenticated user's time-weighted (cash-flow-neutral) return.
//
//   GET /api/v1/me/portfolio/twr                 { series: {date,twrIndex}[], scalars, meta }
//   GET /api/v1/me/portfolio/twr?accountId=…     scoped to ONE owned account
//
// The PERFORMANCE series: indexed to 100 at the first day, cash-flow-neutral (a deposit
// does NOT read as return). This is what the benchmark overlay compares against Nifty —
// raw-NAV-rebased conflated deposits with alpha. Read-only, DERIVED from ledger ×
// DailyPrice (no store). The raw ₹ NAV series stays a SEPARATE endpoint (the value chart).
//
// Owner = req.authUser.userId (never the payload) — IDOR-proof. `accountId` (when present) is
// validated as the caller's own (resolveAccountScope → 404 on a foreign/unknown id); omitted ⇒
// whole-book, identical to today.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { computePortfolioTwr } from "../../portfolio/nav/assemble.js";
import { resolveAccountScope } from "./account-scope.js";

export const getPortfolioTwr = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  // Optional account scope — validated as owned (404 on a foreign/unknown id). undefined ⇒ whole-book.
  const scope = await resolveAccountScope(req, res);
  if (!scope.ok) return;
  const accountId = scope.accountId;
  try {
    const twr = await computePortfolioTwr(userId, accountId);
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
          basis: "twr_eod_close_live_endpoint", // daily-linked EOD; the final link uses the live value
          accountId: accountId ?? null, // the scope this series is FOR (null ⇒ whole book) — additive
          indexedTo: 100,
          blended: twr.blended, // true ⇒ non-stocks held → frontend caps the picker at 4Y (R6)
          maxRange: twr.blended ? "4Y" : "ALL",
          // (Step 21) Held non-stocks with NO chartable series yet — named, never valued at 0.
          excludedFromSeries: twr.excludedFromSeries,
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
