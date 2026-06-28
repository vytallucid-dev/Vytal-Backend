// File: src/controllers/compare-controller.ts
//
// GET /api/compare?a=SYMBOL1&b=SYMBOL2 → the ComparisonView (stock-vs-stock).
// Returned DIRECTLY (no {success,data} envelope) to match the frontend apiFetch
// contract, same as the per-stock health/fundamentals reads. Errors are { message }
// with the right status so React Query's error state fires.

import type { Request, Response } from "express";
import { buildComparisonView } from "../scoring/read/compare-view.service.js";

export const getComparison = async (req: Request, res: Response) => {
  try {
    const a = String(req.query.a ?? "").toUpperCase().trim();
    const b = String(req.query.b ?? "").toUpperCase().trim();
    if (!a || !b) {
      return res.status(400).json({ message: "both 'a' and 'b' query params are required" });
    }
    if (a === b) {
      return res.status(400).json({ message: "'a' and 'b' must be different symbols" });
    }

    const view = await buildComparisonView(a, b);
    if (!view) {
      return res
        .status(404)
        .json({ message: `One or both stocks not found in universe: ${a}, ${b}` });
    }

    return res.json(view);
  } catch (err) {
    console.error("[compare] error:", err);
    return res.status(500).json({ message: "Failed to build comparison" });
  }
};
