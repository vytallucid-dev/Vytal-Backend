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
import {
  listAccounts,
  createAccount,
  patchAccount,
  deleteAccount,
  linkAccount,
  unlinkAccount,
  listBrokerCatalog,
  transferHolding,
  transferAllHoldings,
} from "../controllers/me/accounts-controller.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";
import { getPortfolioSnapshot } from "../controllers/me/portfolio-snapshot-controller.js";
import { getScoreHistory } from "../controllers/me/score-history-controller.js";
import { getPortfolioNav } from "../controllers/me/portfolio-nav-controller.js";
import { getPortfolioTwr } from "../controllers/me/portfolio-twr-controller.js";
import { getPortfolioXirr } from "../controllers/me/portfolio-xirr-controller.js";
import { getPortfolioBenchmark } from "../controllers/me/portfolio-benchmark-controller.js";

export const mePortfolioRouter = Router();

// Portfolio accounts (the first-class unit) — auth-gated, IDOR-scoped. A user has ≥1.
// EVERY ACCOUNT BELONGS TO A BROKER (Step 5.5): the picker below is what they choose from.
// Declared BEFORE any /accounts/:id route so "brokers" can never be read as an account id.
mePortfolioRouter.get("/accounts/brokers", listBrokerCatalog);
mePortfolioRouter.get("/accounts", listAccounts);
// Creation REQUIRES a broker — a manual account is "my <broker> book, kept by hand".
mePortfolioRouter.post("/accounts", createAccount);
// Rename, and RETAG the broker (retag: manual + unbound only — a bound account's broker is a
// fact about its connection, not a label).
mePortfolioRouter.patch("/accounts/:id", patchAccount);
// manual → linked_live: bind a broker connection to THIS account (the user chooses it; §2.3).
// The connection's broker must MATCH the account's (409 otherwise), and a NON-EMPTY manual
// account requires confirm:true — linking REPLACES its hand-kept ledger with the broker's data
// (a linked account is broker-only; a mixed book double-counts the same stock).
// After linking, manual entry on this account is refused server-side.
mePortfolioRouter.post("/accounts/:id/link", linkAccount);
// linked_live → linked_stale: sever the broker feed. The holdings are FROZEN, not deleted —
// they keep their PHS weight and are disclosed as stale. Manual entry stays disabled.
// Reconnecting the same demat brings this same account back live (Step 4).
mePortfolioRouter.post("/accounts/:id/unlink", unlinkAccount);
// MOVE A POSITION (Step 6). The SOURCE decides the rule:
//   manual source → `symbol` names ONE holding; its FULL position (all lots) moves to any MANUAL
//     account, under ANY broker. If the destination already holds it, the two FIFO queues MERGE
//     (identical corporate actions are deduped first, or the replay would invent shares) and the
//     response reports realizedBefore→realizedAfter, because a merge can move that tax number.
//   linked source → the WHOLE account is rescued into a SAME-BROKER manual account and DELETED.
// Nothing is ever transferred INTO a linked account (the mirror stays faithful).
mePortfolioRouter.post("/accounts/:id/transfer", transferHolding);
// MOVE THE WHOLE ACCOUNT (Stage 2). Every position in a MANUAL source moves to a MANUAL destination
// in ONE transaction (all-or-nothing); `deleteSource` decides whether the emptied source is removed
// or kept. Broker → manual keeps its own rescue door (/transfer with a linked source); this is the
// manual → manual whole-account move, and the broker tag is irrelevant here.
mePortfolioRouter.post("/accounts/:id/transfer-all", transferAllHoldings);
// Delete. A still-BOUND broker account may pass `rescueToAccountId` to convert its holdings to
// manual holdings first (same core as the transfer above) instead of destroying them.
mePortfolioRouter.delete("/accounts/:id", deleteAccount);

mePortfolioRouter.post("/transactions", addTransaction);
mePortfolioRouter.get("/transactions", listTransactions);
mePortfolioRouter.patch("/transactions/:id", patchTransaction);
mePortfolioRouter.delete("/transactions/:id", deleteTransaction);

mePortfolioRouter.get("/holdings", listHoldings);

// The pre-computed Portfolio Health Score snapshot (read-only; the single source
// every portfolio surface renders — no client-side recompute).
mePortfolioRouter.get("/portfolio", getPortfolioSnapshot);

// The daily PHS-over-time series (Part A) — read-only over portfolio_score_history,
// date-ascending. The EOD/transaction rescore fills it via the …Tracked wrapper; this
// read recomputes nothing.
mePortfolioRouter.get("/score-history", getScoreHistory);

// The daily NAV (value-over-time) series — derived from the ledger × DailyPrice closes.
// Read-only, EOD-honest, first-buy → last close. Powers every value/return chart.
// Optional ?accountId=… scopes it to one OWNED account (404 on a foreign id); omitted ⇒ whole book.
mePortfolioRouter.get("/portfolio/nav", getPortfolioNav);

// The time-weighted return series (cash-flow-neutral, indexed to 100) + scalars. This
// is what the benchmark comparison uses — raw NAV rebased conflated deposits with return.
// Optional ?accountId=… scopes it to one OWNED account (404 on a foreign id); omitted ⇒ whole book.
mePortfolioRouter.get("/portfolio/twr", getPortfolioTwr);

// XIRR (money-weighted / internal rate of return) — the ledger's dated cashflows +
// current value, solved for the annual rate. The complement to TWR ("what did MY timing
// earn" vs "how did the picks do"); honest null on a degenerate book. Read-only.
mePortfolioRouter.get("/portfolio/xirr", getPortfolioXirr);

// The benchmark index series (Nifty 50) the value chart overlays — read-only over
// index_prices. The frontend carry-forward-aligns it to the NAV dates + rebases to 100.
// Optional ?accountId=… is validated (IDOR-safe) so an account chart's overlay pairs with the
// account's value/TWR line; the benchmark series itself is the same whatever the scope.
mePortfolioRouter.get("/portfolio/benchmark", getPortfolioBenchmark);
