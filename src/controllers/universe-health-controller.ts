// File: src/controllers/universe-health-controller.ts
//
// GET /api/universe/health → UniverseHealthView
// Returns the full-universe aggregate (all ~93 scored stocks) as a single
// ScopeAggregate + roster + pathology census + 7-day delta.

import type { Request, Response } from "express";
import { buildUniverseHealthView } from "../scoring/read/universe-view.service.js";

export const getUniverseHealth = async (_req: Request, res: Response) => {
  try {
    const view = await buildUniverseHealthView();
    return res.json(view);
  } catch (err) {
    console.error("[universe/health] error:", err);
    return res.status(500).json({ message: "Failed to build universe health view" });
  }
};
