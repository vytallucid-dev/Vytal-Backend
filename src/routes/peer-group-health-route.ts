// File: src/routes/peer-group-health-route.ts
// ─────────────────────────────────────────────────────────────
// The peer-group aggregate read API (scoring snapshots, not ingestion metrics):
//   GET /api/peer-groups            — PeerGroupListItem[]  (index page cards)
//   GET /api/peer-groups/:id/health — PeerGroupHealthView  (the Health tab)
//
// Mounted at /api/peer-groups (NOT /api/v1) to match the read-API convention used
// by /api/stocks. The /api/v1/peer-groups ingestion-metrics router is separate.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import {
  getPeerGroupList,
  getPeerGroupHealth,
} from "../controllers/peer-group-health-controller.js";

export const peerGroupHealthRouter = Router();

peerGroupHealthRouter.get("/", getPeerGroupList);
peerGroupHealthRouter.get("/:id/health", getPeerGroupHealth);
