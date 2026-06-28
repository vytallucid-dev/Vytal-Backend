// File: src/scoring/read/price-view.types.ts
//
// Read-model for the per-stock PRICE view — the factual price-performance data the
// Overview tab's §1 (price line) and §2 (Price Performance) render. This is a
// DISPLAY view: it states price facts and neutral benchmark comparisons. It carries
// NO verdict, NO "outperformer", NO trend judgement, NO valuation lens (no P/E, P/B,
// dividend yield) — just prices, returns, and the index lines for the user to read.
//
// It bundles three sources server-side so the tab makes one call and the sector→index
// mapping + honest-empty live in one place:
//   • the stock's own snapshot + daily close series (StockPrice + DailyPrice)
//   • the broad-market benchmark (Nifty 50) series + returns (IndexPrice)
//   • the stock's SECTOR index series + returns (IndexPrice, via the sector map)
//
// CONVENTIONS (mirror health-view / overview-view): plain JS numbers; a field with no
// backing data is `null` with the key PRESENT. Returns are PERCENT (e.g. 18.2 = +18.2%),
// computed consistently from each series so stock and index are apples-to-apples. A line
// (benchmark/sector) is `null` when unmapped or with no data; per-window returns are
// `null` when the series doesn't reach back far enough — never fabricated, never extrapolated.

/** Percent returns over standard trailing windows. Each is null when the backing
 *  series doesn't extend far enough to measure that window honestly. */
export interface PriceReturnSet {
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  r1y: number | null;
  r3y: number | null;
}

/** One daily close point (oldest→newest in a series). */
export interface PriceSeriesPoint {
  date: string; // YYYY-MM-DD
  close: number;
}

/** A comparison line — the benchmark (Nifty 50) or the stock's sector index. */
export interface IndexLine {
  indexName: string; // the IndexPrice.indexName (e.g. "Nifty 50", "Nifty IT")
  label: string; // friendly display label
  /** Daily closes, oldest→newest, windowed to ≤3Y. The frontend rebases to 100 at the
   *  selected period start; an empty array means no series (honest-empty the line). */
  series: PriceSeriesPoint[];
  returns: PriceReturnSet; // per-window % returns; null where coverage is too short
  coverageDays: number; // number of points available — lets the UI honest-empty long windows
}

export interface StockPriceView {
  symbol: string;
  name: string;
  /** false ⇔ no StockPrice/DailyPrice for this stock → §1 price line and §2 honest-empty. */
  hasPrice: boolean;
  asOfDate: string | null; // latest price date (YYYY-MM-DD)
  current: {
    price: number | null;
    dayChangePct: number | null; // PERCENT (snapshot fraction ×100)
    marketCap: number | null; // ₹ Cr (null when split-gated / no shares)
    week52High: number | null;
    week52Low: number | null;
    /** signed % distance from the 52W extremes: (price−high)/high×100 (≤0) and
     *  (price−low)/low×100 (≥0). Stated as current-state fact, no judgement. */
    pctFrom52WHigh: number | null;
    pctFrom52WLow: number | null;
  };
  stock: {
    series: PriceSeriesPoint[]; // daily closes, oldest→newest, windowed ≤3Y
    returns: PriceReturnSet;
    coverageDays: number;
  };
  benchmark: IndexLine | null; // Nifty 50; null only if the index has no rows at all
  sector: IndexLine | null; // mapped sector index; null when the sector has no mapping
}
