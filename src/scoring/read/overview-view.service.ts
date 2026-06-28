// File: src/scoring/read/overview-view.service.ts
//
// THE per-stock editorial-overview assembler. Reads ONLY the hand-authored
// `stock_overviews` table (joined to the Stock for symbol/name). It computes
// nothing — no score, ratio, or verdict — it is a straight projection of the
// editorial row.
//
// Returns null ONLY when the symbol is unknown (→ controller 404). An
// existing-but-unauthored stock (Stock row present, no stock_overviews row)
// returns a HONEST-EMPTY view: hasProfile=false, editorial fields null/[].
// We never fabricate prose for a missing profile.

import { prisma } from "../../db/prisma.js";
import type { StockOverviewView } from "./overview-view.types.js";

/** The editorial row shape this view consumes (the `overview` relation on Stock). */
type OverviewRow = {
  industry: string;
  listedSince: number | null;
  coreBusiness: string;
  revenueModel: string;
  businessTags: string[];
} | null;

/** Pure assembly: (stock identity, editorial row | null) → the view. Kept separate
 *  from the DB read so the honest-empty (no-row) branch is unit-testable without
 *  mutating data. A null row honest-empties every editorial field. */
export function assembleOverviewView(
  stock: { symbol: string; name: string },
  overview: OverviewRow,
): StockOverviewView {
  if (!overview) {
    return {
      symbol: stock.symbol,
      name: stock.name,
      hasProfile: false,
      industry: null,
      listedSince: null,
      coreBusiness: null,
      revenueModel: null,
      businessTags: [],
    };
  }
  return {
    symbol: stock.symbol,
    name: stock.name,
    hasProfile: true,
    // The table columns are NOT NULL strings; a blank/whitespace value is treated
    // as absent so the UI honest-empties that field rather than rendering an empty box.
    industry: overview.industry?.trim() ? overview.industry : null,
    listedSince: overview.listedSince ?? null,
    coreBusiness: overview.coreBusiness?.trim() ? overview.coreBusiness : null,
    revenueModel: overview.revenueModel?.trim() ? overview.revenueModel : null,
    businessTags: Array.isArray(overview.businessTags) ? overview.businessTags : [],
  };
}

/**
 * Build the editorial-overview view for one stock. Returns null when the symbol
 * is unknown; an in-universe stock with no editorial row honest-empties.
 */
export async function buildOverviewView(symbol: string): Promise<StockOverviewView | null> {
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: {
      symbol: true,
      name: true,
      overview: {
        select: {
          industry: true,
          listedSince: true,
          coreBusiness: true,
          revenueModel: true,
          businessTags: true,
        },
      },
    },
  });
  if (!stock) return null;
  return assembleOverviewView({ symbol: stock.symbol, name: stock.name }, stock.overview ?? null);
}
