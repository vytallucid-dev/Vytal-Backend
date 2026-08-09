// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESULTS-SEASON BANNER — the read controller. A thin auth-context → service → envelope shell; the
// resolution and every gate live in src/results-season, not here.
//
//   GET /api/v1/results-season/stock/:stockId
//
// AUTH: behind `optionalAuth`. An ANONYMOUS reader is a valid caller (the third authored variant is
// theirs), never a 401. The owner, when present, is always `req.authUser.userId` — never a payload
// value, so a reader can never ask for someone else's position.
//
// SILENCE IS A 200. The service answers "no banner" far more often than "banner", and none of those
// answers is an error: `{ banner: null }` is the normal, expected body. A 404 would make the frontend
// treat the ordinary case as a failure. `silence` rides along as the REASON, so the operator and the
// verify harness can see WHICH gate fired; the frontend reads only `banner`.
//
// CACHING: per-reader, so `private, no-store` — the same ruling as the relational card. The response
// varies by who is asking even though the stock-side facts do not.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { Request, Response } from "express";
import { resolveResultsSeasonBanner } from "../results-season/service.js";
import { resolvePeerGroupResultsSeason } from "../results-season/group-service.js";

export const getResultsSeasonBanner = async (req: Request, res: Response): Promise<Response> => {
  const rawParam = req.params.stockId;
  const stockId = (Array.isArray(rawParam) ? rawParam[0] : rawParam)?.trim();
  if (!stockId) {
    return res
      .status(400)
      .json({ success: false, error: "validation_error", message: "stockId is required" });
  }
  const userId = req.authUser?.userId ?? null; // null ⇒ anonymous (a valid caller — never a 401)

  try {
    const resolution = await resolveResultsSeasonBanner(userId, stockId);
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({
      success: true,
      data: { banner: resolution.banner, silence: resolution.silence },
    });
  } catch (e) {
    console.error("[GET /results-season/stock]", e);
    return res.status(500).json({
      success: false,
      error: "server_error",
      message: "Failed to resolve the results-season banner",
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/v1/results-season/peer-group/:peerGroupId
//
// THE SECOND CONSUMER, ON THE SAME ROUTER. Everything the handler above documents holds here without
// restatement: `optionalAuth` (an anonymous reader gets the no-exposure variant, never a 401), the
// owner from the VERIFIED TOKEN and never a payload value, SILENCE IS A 200 (`{ banner: null }` is the
// ordinary body — 2 of the 13 scored ponds are out of season today), and `private, no-store` because
// the response varies by who is asking even though the pond-side facts do not.
//
// It is a second ROUTE rather than a second router for the same reason it is a second service file
// rather than a second module: this is another consumer of the results-season data, and the auth,
// caching and silence rulings are the ones already made — re-deciding them somewhere else is how two
// surfaces end up disagreeing about whether an anonymous reader is an error.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export const getPeerGroupResultsSeason = async (req: Request, res: Response): Promise<Response> => {
  const rawParam = req.params.peerGroupId;
  const peerGroupId = (Array.isArray(rawParam) ? rawParam[0] : rawParam)?.trim();
  if (!peerGroupId) {
    return res
      .status(400)
      .json({ success: false, error: "validation_error", message: "peerGroupId is required" });
  }
  const userId = req.authUser?.userId ?? null; // null ⇒ anonymous (a valid caller — never a 401)

  try {
    const resolution = await resolvePeerGroupResultsSeason(userId, peerGroupId);
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({
      success: true,
      data: { banner: resolution.banner, silence: resolution.silence },
    });
  } catch (e) {
    console.error("[GET /results-season/peer-group]", e);
    return res.status(500).json({
      success: false,
      error: "server_error",
      message: "Failed to resolve the peer-group results-season banner",
    });
  }
};
