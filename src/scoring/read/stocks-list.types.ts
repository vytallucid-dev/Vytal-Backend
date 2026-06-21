// File: src/scoring/read/stocks-list.types.ts
//
// Read-model contracts for the lean scored-stock LIST + the per-tool SCAN ranking.
// Both are thin reads over already-committed ScoreSnapshot rows (no scoring math).
//
//   • GET /api/stocks            → ScoredStockListItem[]   (typeahead + landing fallback)
//   • GET /api/stocks/scan?tool= → StockScanItem[]         (ranked "most-interesting journey")
//
// CONVENTIONS (mirror health-view.types):
//   • Every number is a JS number (Prisma Decimals converted at the edge).
//   • A field with no backing data is `null` with the key PRESENT — never omitted.
//   • Enum-ish fields are string unions matching the DB enums.

import type {
  LabelBand,
  TrajectoryMarker,
  DivergenceFlag,
  PillarKey,
  FlowTrendState,
} from "./health-view.types.js";

export interface SectorRef {
  key: string; // Sector.name
  displayName: string;
}

/** Divergence configuration TYPE — the asymmetric taxonomy (not all gaps mean the
 *  same thing). value = fundamentals ahead of price (robust); price_ahead = price
 *  ahead of fundamentals (masked caution); ownership = ownership diverging from the
 *  rest; mixed = two fundamental pillars apart; none = no notable gap. */
export type DivergenceConfig = "value" | "price_ahead" | "ownership" | "mixed" | "none";

/** Gap slope over the window — widening (tension growing) vs narrowing (converging). */
export type DivergenceDirection = "widening" | "narrowing" | "steady";

/** One lean row per SCORED stock — the in-force composite + band + identity.
 *  Lean by design: powers the name-switcher typeahead and the landing fallback. */
export interface ScoredStockListItem {
  symbol: string;
  name: string;
  sector: SectorRef | null;
  composite: number;
  band: LabelBand;
}

/** One lean row per stock in the FULL universe (scored + not-yet-scored) — the
 *  screener typeahead spans every tracked stock, not just the scored subset.
 *  `scored=false` rows carry null composite/band (no in-force snapshot yet); the
 *  detail surface answers them with the honest not-scored notice. */
export interface UniverseStockListItem {
  symbol: string;
  name: string;
  sector: SectorRef | null;
  scored: boolean;
  composite: number | null;
  band: LabelBand | null;
}

/** One row per scored stock, ranked by "most-interesting journey" for a tool's
 *  landing scan. `marker`/`delta`/`previousComposite` are null for a single-period
 *  (building-history) stock. `spark` is the recent in-force composite series
 *  (oldest→newest, ≤8 points) for the card's mini sparkline. */
export interface StockScanItem {
  symbol: string;
  name: string;
  sector: SectorRef | null;
  composite: number;
  band: LabelBand;
  periodKey: string;
  // ── the journey (last-2 composites + delta + marker) ──
  marker: TrajectoryMarker | null;
  delta: number | null;
  previousComposite: number | null;
  previousPeriodKey: string | null;
  // ── recent composite series for the mini chart (oldest→newest) ──
  spark: number[];
}

/** One row per scored stock for the DIVERGENCE landing scan, ranked by tension
 *  (flag tier, then gap magnitude). The spread is computed between the two pillars
 *  that are currently furthest apart; `spark` is that fixed pair's GAP over time. */
export interface DivergenceScanItem {
  symbol: string;
  name: string;
  sector: SectorRef | null;
  composite: number;
  band: LabelBand;
  periodKey: string;
  // ── the spread ──
  gap: number;
  flag: DivergenceFlag; // none | notable (≥15) | wide (≥25)
  config: DivergenceConfig;
  direction: DivergenceDirection;
  highPillar: PillarKey;
  lowPillar: PillarKey;
  previousGap: number | null;
  gapDelta: number | null;
  // ── the fixed pair's gap over time (oldest→newest) for the mini chart ──
  spark: number[];
}

/** The ownership "tell" — what's worth a look. pledge_r1 (R1 pledge red flag) is the
 *  loudest; then high pledging; then a one-sided institutional flow; then ordinary. */
export type OwnershipTell =
  | "pledge_r1"
  | "pledge_high"
  | "distribution"
  | "accumulation"
  | "rotation"
  | "flat";

/** One row per scored stock for the OWNERSHIP landing scan, ranked by tell. The tell
 *  is derived from the OBSERVED holding-split deltas (FII+DII change over the last two
 *  shareholding periods) plus pledging — the flow trend fields are null in the data.
 *  Pledge is derived from share counts (% of promoter holding). `spark` is the
 *  institutional share (FII+DII) over time (oldest→newest). */
export interface OwnershipScanItem {
  symbol: string;
  name: string;
  sector: SectorRef | null;
  composite: number;
  band: LabelBand;
  periodKey: string;
  tell: OwnershipTell;
  r1Fired: boolean;
  pledgedPctOfPromoter: number | null;
  instDelta: number | null; // (FII+DII) change over the last two periods
  fiiDelta: number | null;
  diiDelta: number | null;
  finalOwnership: number;
  spark: number[]; // institutional % (FII+DII) over time
}
