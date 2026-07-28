// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — the read controller. A thin auth-context → service → envelope shell (§0: the resolution
// lives in the standalone service, NOT here and NOT in a card renderer).
//
//   GET /api/v1/relational/stock/:stockId   the reader-relative Overview card for one stock.
//
// AUTH: behind `optionalAuth`. `req.authUser` is set when a valid token was presented, else undefined —
// an ANONYMOUS reader is a valid caller (M9 Stranger, UO only, UG8), never a 401. The owner (when present)
// is always `req.authUser.userId`, never a payload value (IDOR-proof).
//
// CACHING: this response is PER-READER and must NEVER be cached stock-side. It is deliberately NOT under
// /api/stocks/* (which is public + cacheable by symbol) and NOT under /api/v1/me/* (anonymous is valid).
// The header below makes the no-store intent explicit so no proxy/browser caches a per-reader card.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { resolveRelationalState } from "../relational/service.js";

export const getRelationalStock = async (req: Request, res: Response): Promise<Response> => {
  const rawParam = req.params.stockId;
  const stockId = (Array.isArray(rawParam) ? rawParam[0] : rawParam)?.trim();
  if (!stockId) {
    return res.status(400).json({ success: false, error: "validation_error", message: "stockId is required" });
  }
  const userId = req.authUser?.userId ?? null; // null ⇒ anonymous (a valid caller — never a 401)

  try {
    const state = await resolveRelationalState(userId, stockId);
    if (!state) {
      return res.status(404).json({ success: false, error: "unknown_stock", message: "Not in the universe" });
    }
    // Per-reader, never cacheable stock-side.
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({ success: true, data: state });
  } catch (e) {
    console.error("[GET /relational/stock]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to resolve the relational card" });
  }
};
