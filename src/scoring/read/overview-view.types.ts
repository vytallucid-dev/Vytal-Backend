// File: src/scoring/read/overview-view.types.ts
//
// Read-model for the per-stock OVERVIEW view — the editorial "what this company
// is and does" content surfaced on the stock Overview tab's Identity section.
//
// This view is EDITORIAL-ONLY: it reads the hand-authored `stock_overviews` table
// and nothing else. It derives no score, ratio, or verdict. The Overview tab's
// other sections (price, health glance, standing, metrics, peers, ownership) fan
// out to their own existing endpoints (/health, /fundamentals, /ownership, price);
// this endpoint owns only the company profile.
//
// CONVENTIONS (mirror health-view / ownership-series): values are plain JS types;
// a field with no backing data is `null` (or `[]` for the tags list) with the key
// PRESENT. The whole view is HONEST-EMPTY when a stock has no `stock_overviews`
// row: `hasProfile` is false and every editorial field is null/empty — the UI
// renders a "company profile not yet available" state, never fabricated prose.

export interface StockOverviewView {
  symbol: string;
  name: string;
  /** true ⇔ a `stock_overviews` row exists for this stock. When false, every
   *  editorial field below is null/empty and the Identity section honest-empties. */
  hasProfile: boolean;
  industry: string | null; // sub-industry label (e.g. "Real Estate Development")
  listedSince: number | null; // year first listed (nullable even when a row exists)
  coreBusiness: string | null; // multi-paragraph prose — what the company does
  revenueModel: string | null; // multi-paragraph prose — how it makes money
  businessTags: string[]; // category chips; [] when no profile
}
