// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO XIRR — the authenticated user's money-weighted (internal) rate of return.
//
//   GET /api/v1/me/portfolio/xirr    { xirrPct, state, method, currentValue, … }
//
// The MONEY-WEIGHTED complement to TWR. From the Transaction ledger we build the dated
// cashflows — each buy is capital OUT (−, at its actual price + fees), each sell/dividend
// is capital IN (+) — and add the current portfolio value as a final inflow "today" (the
// last close, the same EOD basis the rest of the book uses). XIRR is the annual rate that
// zeroes their discounted sum (portfolio/xirr.ts; Newton + bisection). READ-ONLY, DERIVED
// from ledger × current value — no store, nothing recomputed on the client.
//
// XIRR answers "what did MY timing/sizing earn"; TWR answers "how did the picks do". Both
// are served; the frontend labels them as DISTINCT measures. Degenerate books (one flow,
// no sign change, too-short span) return an honest null with a state — never a garbage %.
//
// Owner = req.authUser.userId (never the payload) — IDOR-proof, no id input.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import { computePortfolioNav } from "../../portfolio/nav/assemble.js";
import { computeXirr, type XirrCashflow } from "../../portfolio/xirr.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown): number => (v == null ? 0 : Number(v));

export const getPortfolioXirr = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;

  try {
    // Two reads, zero writes: the ledger (cashflows) + the NAV series (its last point is
    // the current value at last close — the terminal inflow).
    const [txns, nav] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId },
        orderBy: [{ tradeDate: "asc" }, { createdAt: "asc" }],
        select: { type: true, quantity: true, price: true, fees: true, tradeDate: true },
      }),
      computePortfolioNav(userId),
    ]);

    // Ledger → signed dated cashflows (actual economics, incl. fees). split/bonus move no
    // cash (pure lot reshapes) → skipped. dividend `price` carries the total ₹ amount.
    const flows: XirrCashflow[] = [];
    for (const t of txns) {
      const date = iso(t.tradeDate);
      const qty = num(t.quantity);
      const price = num(t.price);
      const fees = num(t.fees);
      if (t.type === "buy") {
        flows.push({ date, amount: -(qty * price + fees) }); // capital out
      } else if (t.type === "sell") {
        flows.push({ date, amount: qty * price - fees }); // capital in
      } else if (t.type === "dividend") {
        const amt = price - fees;
        if (amt !== 0) flows.push({ date, amount: amt }); // cash in
      }
    }

    // Terminal: current portfolio value at last close = the NAV series' last point (Σ held
    // × last close). A fully-exited book values at 0 — a no-op flow (the sells already
    // captured proceeds), so it's only added when there's live value to mark to market.
    const lastPoint = nav.series.length ? nav.series[nav.series.length - 1] : null;
    const currentValue = lastPoint ? lastPoint.value : null;
    if (lastPoint && lastPoint.value > 0) {
      flows.push({ date: lastPoint.date, amount: lastPoint.value });
    }

    const result = computeXirr(flows);

    return res.json({
      success: true,
      data: {
        xirrPct: result.xirrPct, // annualized, money-weighted — null on a degenerate book
        state: result.state, // ok | empty | single_cashflow | no_sign_change | insufficient_history | non_convergent
        method: result.method, // newton | bisection | null
        flowCount: result.flowCount, // dated cashflows solved (incl. the terminal value)
        currentValue, // ₹ terminal value at last close (null when no priced history)
        firstDate: result.firstDate, // first cashflow (the first buy)
        lastDate: result.lastDate, // terminal date (as-of last close)
        days: result.days, // span first → terminal
        meta: {
          basis: "money_weighted_xirr",
          terminalBasis: "eod_close",
          annualized: true, // XIRR is annual by construction — NOT the same figure as TWR
        },
      },
    });
  } catch (e) {
    console.error("[GET /me/portfolio/xirr]", e);
    return res
      .status(500)
      .json({ success: false, error: "server_error", message: "Failed to compute XIRR" });
  }
};
