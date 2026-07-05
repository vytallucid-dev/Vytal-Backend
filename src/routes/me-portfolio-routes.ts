// ─────────────────────────────────────────────────────────────
// /api/v1/me — portfolio routes (transactions ledger + materialized holdings).
// Mounted behind requireAuth in app.ts alongside the onboarding meRouter (a SECOND
// router on the same base path — onboarding's me-routes.ts is untouched). Every
// handler derives the owner from req.authUser (never the payload).
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import {
  addTransaction,
  listTransactions,
  patchTransaction,
  deleteTransaction,
} from "../controllers/me/transactions-controller.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";
import { getPortfolioSnapshot } from "../controllers/me/portfolio-snapshot-controller.js";
import { getPortfolioNav } from "../controllers/me/portfolio-nav-controller.js";
import { getPortfolioTwr } from "../controllers/me/portfolio-twr-controller.js";
import { getPortfolioXirr } from "../controllers/me/portfolio-xirr-controller.js";
import { getPortfolioBenchmark } from "../controllers/me/portfolio-benchmark-controller.js";

export const mePortfolioRouter = Router();

mePortfolioRouter.post("/transactions", addTransaction);
mePortfolioRouter.get("/transactions", listTransactions);
mePortfolioRouter.patch("/transactions/:id", patchTransaction);
mePortfolioRouter.delete("/transactions/:id", deleteTransaction);

mePortfolioRouter.get("/holdings", listHoldings);

// The pre-computed Portfolio Health Score snapshot (read-only; the single source
// every portfolio surface renders — no client-side recompute).
mePortfolioRouter.get("/portfolio", getPortfolioSnapshot);

// The daily NAV (value-over-time) series — derived from the ledger × DailyPrice closes.
// Read-only, EOD-honest, first-buy → last close. Powers every value/return chart.
mePortfolioRouter.get("/portfolio/nav", getPortfolioNav);

// The time-weighted return series (cash-flow-neutral, indexed to 100) + scalars. This
// is what the benchmark comparison uses — raw NAV rebased conflated deposits with return.
mePortfolioRouter.get("/portfolio/twr", getPortfolioTwr);

// XIRR (money-weighted / internal rate of return) — the ledger's dated cashflows +
// current value, solved for the annual rate. The complement to TWR ("what did MY timing
// earn" vs "how did the picks do"); honest null on a degenerate book. Read-only.
mePortfolioRouter.get("/portfolio/xirr", getPortfolioXirr);

// The benchmark index series (Nifty 50) the value chart overlays — read-only over
// index_prices. The frontend carry-forward-aligns it to the NAV dates + rebases to 100.
mePortfolioRouter.get("/portfolio/benchmark", getPortfolioBenchmark);
