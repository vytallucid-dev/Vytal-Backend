// File: src/controllers/funds-controller.ts
//
// GET /api/v1/funds?q=&assetClass=&category=&fundHouse=&plan=&includeDormant=&sort=&cursor=&limit=
//   → { results: FamilyRow[], facets, total, hasMore, cursor, nullSortCount }
//
// Public read (no auth), same posture as /api/v1/mf and /api/v1/instruments/search. Returned
// DIRECTLY (no {success,data} envelope), matching instrument-search's contract — this endpoint is
// discovery's front door in exactly the same sense that one is the manual-entry picker's.
// Errors are { message } with the status the service chose (400 for a bad sort/assetClass/plan/
// cursor; 500 otherwise).

import type { Request, Response } from "express";
import { browseFunds, FundsQueryError, type FundsQuery, type PlanTier, type AssetClassFilter, type SortKey } from "../discovery/fund-discovery.js";

function toArray(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  const strs = arr.map(String).filter((s) => s.length > 0);
  return strs.length > 0 ? strs : undefined;
}

export const getFundsBrowse = async (req: Request, res: Response) => {
  try {
    const query: FundsQuery = {
      q: req.query.q !== undefined ? String(req.query.q) : undefined,
      assetClass: req.query.assetClass !== undefined ? (String(req.query.assetClass) as AssetClassFilter) : undefined,
      category: toArray(req.query.category),
      fundHouse: toArray(req.query.fundHouse),
      plan: req.query.plan !== undefined ? (String(req.query.plan) as PlanTier) : undefined,
      includeDormant: req.query.includeDormant !== undefined ? req.query.includeDormant === "true" : undefined,
      sort: req.query.sort !== undefined ? (String(req.query.sort) as SortKey) : undefined,
      cursor: req.query.cursor !== undefined ? String(req.query.cursor) : undefined,
      limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
    };

    const result = await browseFunds(query);
    return res.json(result);
  } catch (err) {
    if (err instanceof FundsQueryError) {
      return res.status(err.httpStatus).json({ message: err.message });
    }
    console.error("[funds] error:", err);
    return res.status(500).json({ message: "Failed to browse funds" });
  }
};
