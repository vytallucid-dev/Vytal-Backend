// File: src/scoring/market/types.ts
//
// MARKET PILLAR — shared types. The fourth pillar, RULE-BASED (band-scored), NOT
// three-lens. Four sub-components, each band-scored 0–100, equal-weighted (25%
// each) → Market pillar score. Price-data driven (DailyPrice). Does NOT touch
// Foundation / Momentum / Ownership; does NOT compute the snapshot composite.
//
// The band→score PATTERN is the same shape as Ownership flow-bands (a value →
// a discrete band → a score), but Market's cut-points are PER-PG (§10.4,
// score_market_band_sets) — the OPPOSITE of Ownership's UNIVERSAL flow bands
// (CN-1 note). The five-band anchor scores reuse the Lens-1 BAR_SCORE ladder
// {90,75,60,40,20} (structural, CN-8).
//
// The string-literal unions MIRROR the Prisma enums (MarketBand,
// MarketSubComponent, PillarState) so a result can be written onto a
// score_market_subs / score_pillars row with no cast — same DB-free discipline as
// lenses/types.ts and ownership/flow-bands.ts.

/** Mirrors schema enum `MarketSubComponent`. */
export type MarketSubComponent = "range_52w" | "vs_200dma" | "volatility_vs_sector" | "trend_4q";

/** Mirrors schema enum `MarketBand` — the five percentile bands. For sub-
 *  components 1–3 this is the DISTRIBUTIONAL bucket the raw value fell into (by
 *  value vs the PG cuts, ascending). For trend_4q (no distribution) it is reused
 *  as a QUALITY tier the categorical state maps to — see the FLAG in market.ts. */
export type MarketBand = "p0_p15" | "p15_p35" | "p35_p65" | "p65_p85" | "p85_p100";

/** Mirrors schema enum `PillarState`. */
export type PillarState = "scored" | "unavailable_redistributed";

/** Sub-component orientation. higher_better: a higher raw value scores higher
 *  (range position, vs-200DMA). lower_better: a lower raw value scores higher
 *  (volatility vs sector median). */
export type Orientation = "higher_better" | "lower_better";

/** 4-quarter trend structure — a CATEGORICAL state (sub-component 4), derived
 *  from the higher-highs/higher-lows pattern across four quarters. Discrete band,
 *  no continuous interpolation, capped at 90 (documented saturation exception). */
export type TrendStructure =
  | "trending_up"
  | "consolidating_up"
  | "range"
  | "consolidating_down"
  | "trending_down";

// ── Per-PG band cuts (§10.4) — read from score_market_band_sets in production ────
/** The four percentile cut-points for ONE sub-component of ONE peer group, in the
 *  sub-component's own RAW units (range position %, vs-200DMA %, vol ratio ×).
 *  Always ascending: p15 ≤ p35 ≤ p65 ≤ p85. */
export interface MarketBandCuts {
  p15: number;
  p35: number;
  p65: number;
  p85: number;
}

/** A per-PG band-set: cuts for sub-components 1–3 + a version + provenance. The
 *  trend_4q sub-component is categorical (no cuts) and carries only the version.
 *  PRODUCTION reads these per-PG from score_market_band_sets; here they are
 *  supplied (and the verification set is LOUDLY illustrative/throwaway). */
export interface MarketBandSet {
  peerGroupId: string;
  version: number;
  /** cuts per banded sub-component (range_52w, vs_200dma, volatility_vs_sector). */
  cuts: Partial<Record<MarketSubComponent, MarketBandCuts>>;
  /** Provenance note. For the verification fixture this LOUDLY says THROWAWAY. */
  note: string;
  /** Set when these are the illustrative test fixture, never real §10.4 cuts. */
  illustrative: boolean;
}

// ── One sub-component's scored result (→ score_market_subs row) ──────────────────
export interface MarketSubScoreResult {
  subComponent: MarketSubComponent;
  available: boolean;
  rawValue: number | null; // range pos % | vs-200DMA % | vol ratio × | trend net (encoded)
  orientation: Orientation;
  bandLanded: MarketBand | null; // distributional bucket (1–3) | quality tier (trend)
  bandScore: number | null; // 0–100, post-saturation
  saturated: boolean; // entered the 90→100 saturation region (never for trend)
  trendState: TrendStructure | null; // only set for trend_4q
  bandSetVersion: number | null; // the per-PG band-set version used (null for unavailable/trend-no-cuts)
  unavailableReason: string | null;
  notes: string[];
}

// ── The Market PillarScore contract (per stock per snapshot) ────────────────────
export interface MarketPillarResult {
  pillar: "market";
  stockId: string;
  symbol: string;
  snapshot: string; // e.g. price date "2026-06-12"
  pillarState: PillarState;
  subtotal: number | null; // 0–100 equal-weighted avg over present sub-components, or null
  unavailableReason: string | null;

  // present/dropped accounting (4 sub-components)
  totalSubs: number; // always 4
  presentCount: number;
  droppedCount: number;
  presentRatio: number;

  /** Per sub-component: raw value, band, score + the effective (renormalized)
   *  weight and contribution. Σ contribution = subtotal. */
  subScores: MarketSubScoreResult[];
  effectiveWeights: Partial<Record<MarketSubComponent, number>>; // PERCENT, present subs sum to 100
  contributions: Partial<Record<MarketSubComponent, number>>; // score-points

  flags: string[];
}
