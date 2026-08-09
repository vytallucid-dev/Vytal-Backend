// File: src/controllers/result-detail-controller.ts
//
// GET /api/v1/results/:symbol[?period=FY26Q4] → the per-result viewer payload.
// v1 { success, data } envelope. 404 when the symbol is unknown OR the stock has no
// filed results yet (honest — nothing to view).
//
// ── ★ STAGE 5 · optionalAuth, NOT requireAuth ─────────────────────────────────────────────────
// This page is PUBLIC and stays public: an anonymous reader is a valid caller, not an error path.
// The token is read only so the brief's PERSONAL section can exist for a signed-in reader who
// holds or watches the stock. `req.authUser` is undefined for everyone else and the section is
// null — which costs zero queries, because buildPersonalSection returns on a null userId before
// touching the database. Same guard and same reasoning as the relational Overview card.
//
// ⚠ THE USER ID COMES FROM THE VERIFIED TOKEN, NEVER FROM THE REQUEST. No query parameter, no
// header, no body field can select whose holdings are described — that is the IDOR the relational
// controller documents and the rule is identical here.

import type { Request, Response } from "express";
import { buildResultDetail } from "../scoring/read/result-detail.service.js";

export const getResultDetail = async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
    if (!symbol) return res.status(400).json({ success: false, error: "symbol is required" });

    const period = req.query.period ? String(req.query.period).toUpperCase().trim() : undefined;

    const userId = req.authUser?.userId ?? null; // null ⇒ anonymous (a valid caller — never a 401)
    const data = await buildResultDetail(symbol, period, userId);
    if (!data) {
      return res.status(404).json({ success: false, error: `No results found for ${symbol}` });
    }
    return res.json({ success: true, data });
  } catch (err) {
    console.error("[results/:symbol] error:", err);
    return res.status(500).json({ success: false, error: "Failed to build result detail" });
  }
};
