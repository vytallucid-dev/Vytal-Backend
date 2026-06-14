// File: src/scoring/market/illustrative-band-set.ts
//
// ⚠⚠ ILLUSTRATIVE / THROWAWAY per-PG Market band cuts — NOT real §10.4 cuts. ⚠⚠
// Hand-set so the Market wiring can be exercised end-to-end before Phase-6 builds
// the real per-PG percentile calibration into score_market_band_sets. The PRODUCTION
// path reads score_market_band_sets (per peerGroup, versioned) and returns null
// today. These exist for the SAME reason as the Lens-1 illustrative bars: to prove
// the mechanics, never to score anything for real. Do NOT promote to production.

import type { MarketBandSet } from "./types.js";

/** A loudly-labelled illustrative band-set for one PG. Cuts are in each sub-
 *  component's RAW units: range position %, vs-200DMA %, volatility RATIO ×. */
export function illustrativeMarketBandSet(peerGroupId: string): MarketBandSet {
  return {
    peerGroupId,
    version: 0, // version 0 == illustrative; real cuts start at 1
    illustrative: true,
    note: "THROWAWAY illustrative Market band cuts — hand-set, NOT §10.4 per-PG percentiles. Replace in Phase 6.",
    cuts: {
      // 52-week range position (% of range, 0–100). higher_better.
      range_52w: { p15: 30, p35: 45, p65: 62, p85: 80 },
      // position vs 200-DMA (% above/below). higher_better.
      vs_200dma: { p15: -8, p35: -2, p65: 4, p85: 10 },
      // 90-day volatility ÷ PG-median (×, median≈1.0). lower_better.
      volatility_vs_sector: { p15: 0.82, p35: 0.93, p65: 1.07, p85: 1.22 },
      // trend_4q is categorical — no cuts; the version is recorded for provenance.
    },
  };
}
