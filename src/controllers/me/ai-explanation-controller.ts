// ═══════════════════════════════════════════════════════════════════════
// AI EXPLANATION — natural-language explanations of a stock's health, for the signed-in user.
//
//   POST /api/v1/me/stocks/:symbol/explanation
//
// Thin HTTP shell, exactly like portfolio-snapshot-controller: derive the owner from req.authUser
// (never the payload), normalise the symbol, call the seam, wrap in { success, data }.
//
// ⚠ POST, NOT GET, AND IT IS NOT A REST QUIBBLE. A cache miss here spends one unit of a 480/day
// GLOBAL budget and writes a row. A GET that does that is a GET a prefetcher, a retry, a crawler or
// a double-render can drain — and the drain is shared across every user, not just the one who
// triggered it. The verb is the cheapest available protection against accidental spend.
//
// ⚠ IT LIVES UNDER /api/v1/me, NOT /api/stocks, AND THAT IS ALSO FORCED: the explanation is written
// in the READER'S registered tone, so it needs an identity — and /api/stocks is mounted public.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { explainStockHealth } from "../../ai/explain/stock-health.js";
import { explainPortfolioHealth } from "../../ai/explain/portfolio-health.js";
import { insightStockHealth } from "../../ai/insight/stock-insight.js";

export const postStockExplanation = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
  if (!symbol) {
    return res.status(400).json({ success: false, error: "bad_request", message: "symbol is required" });
  }

  try {
    const data = await explainStockHealth(userId, symbol);
    // null ⇔ not in the universe — mirrors GET /api/stocks/:symbol/health's 404 exactly.
    if (!data) {
      return res.status(404).json({ success: false, error: "not_found", message: `Stock ${symbol} not found in universe` });
    }
    // NOTE: a quota-exhausted or guardrail-blocked result is a 200 with explanation:null and a
    // `state` — NOT an error status. The client renders its deterministic diagnosis either way, and
    // an error code would push a normal, expected budget state into a failure path on the frontend.
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[POST /me/stocks/:symbol/explanation]", e);
    return res
      .status(500)
      .json({ success: false, error: "server_error", message: "Failed to build explanation" });
  }
};

// ═══════════════════════════════════════════════════════════════════════
// STOCK HEALTH — STRUCTURED INSIGHT (the structured-JSON sibling of the prose explanation above).
//
//   POST /api/v1/me/stocks/:symbol/insight
//
// Same shell, same auth, same 404-on-unknown-symbol, same POST-not-GET reasoning (a cache miss spends
// one unit of the 480/day GLOBAL budget). The one difference is the body: `data` is a StockInsightResult
// ({ insight, sources }) rather than a prose result. Every non-clean path (quota/provider/guardrail)
// resolves to the deterministic-JSON fallback inside the seam, so this is a 200 with a payload whose
// `status`/`generatedBy` say which path served it — never an error status for a normal budget state.
// ═══════════════════════════════════════════════════════════════════════
export const postStockInsight = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
  if (!symbol) {
    return res.status(400).json({ success: false, error: "bad_request", message: "symbol is required" });
  }

  try {
    const data = await insightStockHealth(userId, symbol);
    if (!data) {
      return res.status(404).json({ success: false, error: "not_found", message: `Stock ${symbol} not found in universe` });
    }
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[POST /me/stocks/:symbol/insight]", e);
    return res
      .status(500)
      .json({ success: false, error: "server_error", message: "Failed to build insight" });
  }
};

// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO EXPLANATION — the caller's OWN book.
//
//   POST /api/v1/me/portfolio/explanation
//
// ⚠ NO PATH PARAM, AND NO 404 — the two differences from the stock handler, and both are structural
// rather than stylistic. The subject is `req.authUser.userId`, so there is nothing to normalise and
// nothing to validate (an unauthenticated request never reaches here; requireAuth owns that). And
// the resource ALWAYS EXISTS: a user's portfolio is not "missing" when it is empty, it is empty. So
// an empty book is a 200 with `state: "unavailable", reason: "empty_book"`, never a 404 — a 404 would
// tell a client that the endpoint is wrong when in fact the answer is "you hold nothing yet".
//
// POST for the same reason as the stock handler, and more so: a cache miss here spends from a
// 480/day GLOBAL budget, and unlike a stock explanation the generation warms a row only for THIS
// user — there is no cross-user amortisation to offset an accidental drain from a prefetcher or a
// double render.
// ═══════════════════════════════════════════════════════════════════════
export const postPortfolioExplanation = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;

  try {
    const data = await explainPortfolioHealth(userId);
    // Every outcome — declined, cached, generated, fallen back — is a 200 with a `state`. The client
    // reads `state` + `reason`; an error status would push normal, expected book states (an empty
    // portfolio, a spent budget) into a failure path on the frontend.
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[POST /me/portfolio/explanation]", e);
    return res
      .status(500)
      .json({ success: false, error: "server_error", message: "Failed to build portfolio explanation" });
  }
};
