// File: src/scoring/market/bands.ts
//
// PURE band-scoring for Market sub-components 1–3 (the percentile-banded ones) +
// the v5.5.1 saturation that lifts the Excellent band 90→100. No DB, no price
// math — value + cuts + orientation → {band, score}. Sub-component 4 (trend) is
// categorical and scored in market.ts, not here.
//
// BANDS (DISTRIBUTIONAL, by raw value vs the PG's ascending cuts p15<p35<p65<p85):
//   v < p15 → p0_p15 ; v < p35 → p15_p35 ; v < p65 → p35_p65 ;
//   v < p85 → p65_p85 ; else → p85_p100.
// The band NAME is where the value sits in the PG distribution; the SCORE applies
// orientation. For higher_better the top distributional band is the best; for
// lower_better the BOTTOM distributional band (p0_p15) is the best — so a low-
// volatility stock lands in p0_p15 yet earns the top score (see the volatility
// FLAG in market.ts).
//
// BAND SCORES reuse the Lens-1 BAR_SCORE ladder {90,75,60,40,20} (structural,
// CN-8). Non-Excellent bands are DISCRETE (no within-band interpolation). Only the
// Excellent band saturates 90→100 (v5.5.1, positive-only).

import { BAR_SCORE, SCORE_MAX, clampScore } from "../lenses/types.js";
import type { MarketBand, MarketBandCuts, Orientation } from "./types.js";

/** Excellent anchor = 90; saturation can add up to this gap to reach the 100 cap. */
const SAT_GAP = SCORE_MAX - BAR_SCORE.excellent; // 10

/** Quality ladder by distributional band, for higher_better. Reuses BAR_SCORE. */
const BAND_SCORE_HIGHER: Record<MarketBand, number> = {
  p0_p15: BAR_SCORE.distress, // 20
  p15_p35: BAR_SCORE.concerning, // 40
  p35_p65: BAR_SCORE.acceptable, // 60
  p65_p85: BAR_SCORE.good, // 75
  p85_p100: BAR_SCORE.excellent, // 90
};

/** Saturation descriptor for the Excellent band (v5.5.1). */
export type SaturationKind =
  | { mode: "to_max"; max: number } // higher_better: p85 → a natural max (range position → 100%)
  | { mode: "band_width" } // higher_better: p85 → p85 + (p85−p65), one band-width
  | { mode: "band_width_below" } // lower_better: p15 → p15 − (p35−p15), one band-width
  | { mode: "none" }; // no saturation

export interface BandScoreResult {
  bandLanded: MarketBand;
  bandScore: number;
  saturated: boolean;
  note: string | null;
}

/** Distributional band: which ascending percentile bucket the value fell into. */
export function landBand(value: number, cuts: MarketBandCuts): MarketBand {
  if (value < cuts.p15) return "p0_p15";
  if (value < cuts.p35) return "p15_p35";
  if (value < cuts.p65) return "p35_p65";
  if (value < cuts.p85) return "p65_p85";
  return "p85_p100";
}

/** Base (pre-saturation) quality score for a distributional band under an
 *  orientation. lower_better flips the ladder (p0_p15 best). */
export function bandBaseScore(band: MarketBand, orientation: Orientation): number {
  if (orientation === "higher_better") return BAND_SCORE_HIGHER[band];
  // lower_better: mirror the band, then read the higher ladder
  const mirror: Record<MarketBand, MarketBand> = {
    p0_p15: "p85_p100",
    p15_p35: "p65_p85",
    p35_p65: "p35_p65",
    p65_p85: "p15_p35",
    p85_p100: "p0_p15",
  };
  return BAND_SCORE_HIGHER[mirror[band]];
}

/**
 * Score a banded sub-component value: distributional band → quality base score,
 * then v5.5.1 saturation 90→100 if the value is in the Excellent quality band.
 * Excellent = top distributional band (higher_better) or bottom (lower_better).
 */
export function scoreBanded(
  value: number,
  cuts: MarketBandCuts,
  orientation: Orientation,
  sat: SaturationKind,
): BandScoreResult {
  const bandLanded = landBand(value, cuts);
  const base = bandBaseScore(bandLanded, orientation);

  const isExcellent =
    orientation === "higher_better" ? bandLanded === "p85_p100" : bandLanded === "p0_p15";

  if (!isExcellent || sat.mode === "none") {
    return { bandLanded, bandScore: base, saturated: false, note: null };
  }

  // Saturation fraction in [0, …]; clamp the final score to [90, 100].
  let numerator: number;
  let denominator: number;
  if (sat.mode === "to_max") {
    numerator = value - cuts.p85;
    denominator = sat.max - cuts.p85;
  } else if (sat.mode === "band_width") {
    numerator = value - cuts.p85;
    denominator = cuts.p85 - cuts.p65;
  } else {
    // band_width_below (lower_better): distance BELOW p15, scaled by (p35−p15)
    numerator = cuts.p15 - value;
    denominator = cuts.p35 - cuts.p15;
  }

  if (denominator <= 0) {
    // Collapsed saturation scale → cannot interpolate; hold at the 90 anchor.
    return { bandLanded, bandScore: BAR_SCORE.excellent, saturated: false, note: "saturation scale collapsed (≤0) → held at 90" };
  }

  const frac = Math.max(0, numerator / denominator);
  const bandScore = clampScore(BAR_SCORE.excellent + SAT_GAP * frac);
  return { bandLanded, bandScore, saturated: bandScore > BAR_SCORE.excellent, note: null };
}

// ── Trend (categorical) quality-tier mapping — reuses the band ladder ────────────
import type { TrendStructure } from "./types.js";

/** Trend state → fixed sub-score (capped at 90, NO saturation — documented
 *  v5.5.1 exception) + the MarketBand quality tier it maps to (for storage). */
export function scoreTrend(state: TrendStructure): { bandScore: number; bandLanded: MarketBand } {
  switch (state) {
    case "trending_up":
      return { bandScore: BAR_SCORE.excellent, bandLanded: "p85_p100" }; // 90 — capped, never 100
    case "consolidating_up":
      return { bandScore: BAR_SCORE.good, bandLanded: "p65_p85" }; // 75
    case "range":
      return { bandScore: BAR_SCORE.acceptable, bandLanded: "p35_p65" }; // 60
    case "consolidating_down":
      return { bandScore: BAR_SCORE.concerning, bandLanded: "p15_p35" }; // 40
    case "trending_down":
      return { bandScore: BAR_SCORE.distress, bandLanded: "p0_p15" }; // 20
  }
}
