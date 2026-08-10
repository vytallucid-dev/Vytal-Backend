// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE READER'S EXPOSURE TO ONE POND — the read controller.
//
//   GET /api/v1/peer-group-exposure/:peerGroupId
//
// AUTH: behind `optionalAuth`. An ANONYMOUS reader is a valid caller — they get an empty map and the
// page renders no marks and no legend, which is the correct answer and not a 401. The owner, when
// present, is always `req.authUser.userId` — never a payload value, so a reader can never ask for
// someone else's positions.
//
// CACHING: `private, no-store`, the same ruling as the relational card and the results-season strip.
// The pond's own facts are public and cached; THIS response varies by who is asking and must never
// share a cache entry with them. It is a separate route for exactly that reason — see the service
// header for why the marks are not a field on the health payload.
//
// AN EMPTY MAP IS A 200. It is the ordinary answer for an anonymous reader and for the many signed-in
// readers who hold nothing in a given pond; a 404 would make the common case look like a failure.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { Request, Response } from "express";
import { buildPeerGroupExposure } from "../scoring/read/peer-group-exposure.service.js";

export const getPeerGroupExposure = async (req: Request, res: Response): Promise<Response> => {
  const raw = req.params.peerGroupId;
  const peerGroupId = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!peerGroupId) {
    return res
      .status(400)
      .json({ success: false, error: "validation_error", message: "peerGroupId is required" });
  }
  const userId = req.authUser?.userId ?? null; // null ⇒ anonymous (a valid caller — never a 401)

  try {
    const view = await buildPeerGroupExposure(userId, peerGroupId);
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({ success: true, data: view });
  } catch (e) {
    console.error("[GET /peer-group-exposure]", e);
    return res.status(500).json({
      success: false,
      error: "server_error",
      message: "Failed to resolve peer-group exposure",
    });
  }
};
