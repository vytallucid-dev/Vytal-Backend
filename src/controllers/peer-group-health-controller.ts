// File: src/controllers/peer-group-health-controller.ts
//
// The peer-group aggregate READ API (returned DIRECTLY, no { success, data }
// envelope — matches the frontend apiFetch contract in lib/api/client.ts):
//   GET /api/peer-groups            → PeerGroupListItem[]   (index page)
//   GET /api/peer-groups/:id/health → PeerGroupHealthView   (Health tab)
//
// Distinct from the ingestion-metrics router at /api/v1/peer-groups (P/E, P/B
// averages); these serve the scoring aggregates over committed snapshots.

import type { Request, Response } from "express";
import {
  buildPeerGroupList,
  buildPeerGroupHealthView,
} from "../scoring/read/peer-group-view.service.js";

export const getPeerGroupList = async (_req: Request, res: Response) => {
  try {
    const list = await buildPeerGroupList();
    return res.json(list);
  } catch (err) {
    console.error("[peer-groups] list error:", err);
    return res.status(500).json({ message: "Failed to build peer-group list" });
  }
};

export const getPeerGroupHealth = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "").trim();
    if (!id) {
      return res.status(400).json({ message: "peer group id is required" });
    }
    const view = await buildPeerGroupHealthView(id);
    if (!view) {
      return res.status(404).json({ message: `Peer group ${id} not found` });
    }
    return res.json(view);
  } catch (err) {
    console.error("[peer-groups/:id/health] error:", err);
    return res.status(500).json({ message: "Failed to build peer-group health view" });
  }
};
