// ─────────────────────────────────────────────────────────────
// /api/v1/peer-group-exposure — the reader's own positions inside one pond, for the marks the
// peer-group tables wear.
//
//   GET /api/v1/peer-group-exposure/:peerGroupId
//
// ★ ITS OWN MOUNT, and for the same reason the results-season router has one. It is NOT under
// /api/v1/me/* (an anonymous reader is a valid caller, not a 401) and NOT under /api/peer-groups
// (that router is public and cacheable by pond id; this response is per-reader and `no-store`).
// Hanging a per-reader response off a public router means re-deciding auth and caching on a router
// whose rulings are the opposite of the ones this needs.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { getPeerGroupExposure } from "../controllers/peer-group-exposure-controller.js";

export const peerGroupExposureRouter = Router();

peerGroupExposureRouter.get("/:peerGroupId", getPeerGroupExposure);
