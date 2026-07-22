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
