// File: src/controllers/instrument-search-controller.ts
//
// GET /api/v1/instruments/search?q=&limit=&cursor=
//   → { results: InstrumentSearchResult[], hasMore: boolean, cursor: string|null }
//
// Public read (no auth), matching /api/stocks and /api/v1/mf: the frontend sends no tokens this
// phase and this is catalogue data, exactly as public as the stock/fund reads it sits beside.
// Returned DIRECTLY (no {success,data} envelope), same as the stock reads' apiFetch contract.
// Errors are { message } with the status the service chose (400 for a bad/absent/short q or a
// malformed cursor; 500 otherwise).

import type { Request, Response } from "express";
import {
  searchInstruments,
  InstrumentSearchError,
} from "../portfolio/instrument-search.js";

export const getInstrumentSearch = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? "");
    const rawLimit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor !== undefined ? String(req.query.cursor) : undefined;

    const result = await searchInstruments(q, { limit: rawLimit, cursor });
    return res.json(result);
  } catch (err) {
    if (err instanceof InstrumentSearchError) {
      return res.status(err.httpStatus).json({ message: err.message });
    }
    console.error("[instruments/search] error:", err);
    return res.status(500).json({ message: "Failed to search instruments" });
  }
};
