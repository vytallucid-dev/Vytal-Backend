// File: src/controllers/universe-health-controller.ts
//
// GET /api/universe/health → UniverseHealthView
// Returns the full-universe aggregate (all ~93 scored stocks) as a single
// ScopeAggregate + roster + pathology census + 7-day delta.

// ★ READS THROUGH THE CACHE (universe-view.cache.ts), not the builder directly. Two reasons, and the
// second is the one that matters: (1) the Hub paid 1.5s of builder on every page load; (2) the CHAT now
// reads the same universe, and a reader who sees "one divergence finding, 38 companies" on the Flags
// board and hears a different count from the chat seconds later has caught our two surfaces
// disagreeing. Sharing one cached snapshot makes them the same read, not two reads that agree.
// The cache holds exactly what this route already serves unauthenticated — it is not user-scoped and
// cannot become so (that function takes no arguments).

import type { Request, Response } from "express";
import { getUniverseHealthView } from "../scoring/read/universe-view.cache.js";

export const getUniverseHealth = async (_req: Request, res: Response) => {
  try {
    const view = await getUniverseHealthView();
    return res.json(view);
  } catch (err) {
    console.error("[universe/health] error:", err);
    return res.status(500).json({ message: "Failed to build universe health view" });
  }
};
