// File: src/scoring/composite/types.ts
//
// SNAPSHOT-LEVEL COMPOSITE — shared types. The convergence point: blend the four
// pillar scores (Foundation src/scoring/pillars, Momentum src/scoring/pillars,
// Market src/scoring/market, Ownership src/scoring/ownership) into ONE Health
// Score, assign the label band, and assemble a complete ScoreSnapshot. One Health
// Score per stock per snapshot. DRY-RUN — commit nothing (real bars are Phase 6).
//
// The string-literal unions MIRROR the Prisma enums (Pillar, PillarState,
// LabelBand, WeightRedistributionReason, SnapshotType) so an assembled result maps
// onto a score_snapshots row with no cast — same DB-free discipline as the pillar
// layers.

export type Pillar = "foundation" | "momentum" | "market" | "ownership";
export type PillarState = "scored" | "unavailable_redistributed";
export type SnapshotType = "quarterly" | "live";

/** Mirrors schema enum `LabelBand`. */
export type LabelBand = "fragile" | "below_par" | "steady" | "healthy" | "pristine";

/** Mirrors schema enum `WeightRedistributionReason`. */
export type WeightRedistributionReason = "none" | "market_unavailable" | "missing_pillar" | "guardrail_suppression";

// ── One pillar's contribution to the composite ──────────────────────────────────
export interface PillarInput {
  pillar: Pillar;
  /** The pillar subtotal (0–100), or null when unavailable_redistributed. */
  subtotal: number | null;
  state: PillarState;
  /** Each pillar's own source period (Foundation FY, Momentum FYQ, Market price
   *  date, Ownership FYQ) — denormalised for provenance. */
  sourcePeriod: string;
  /** Resolved PillarScore FK for the snapshot. null in a dry-run plan (the pillar
   *  layers resolve it at the real write). */
  pillarScoreId?: string | null;
}

// ── The assembled composite (→ score_snapshots row) ─────────────────────────────
export interface CompositeResult {
  stockId: string;
  symbol: string;
  snapshotType: SnapshotType;
  periodKey: string; // quarterly: "FY26Q4"; live: "LIVE:<runId>"
  asOfDate: Date;

  /** scored = a real Health Score; unavailable = too few pillars survived to score
   *  (recorded, never a fabricated number / silent snapshot). */
  state: "scored" | "unavailable";

  composite: number | null; // FULL PRECISION (stored)
  compositeRounded: number | null; // nearest integer (display only)
  labelBand: LabelBand | null;
  labelText: string | null;
  bandMappingVersion: string; // the mapping VERSION that produced labelBand (cache-with-provenance)

  /** The weight set ACTUALLY APPLIED this snapshot (sums to 1.0 over surviving
   *  pillars; 0 for an unavailable pillar). Stored per snapshot — NOT assumed from
   *  the global constant. */
  appliedWeights: Record<Pillar, number>;
  redistributionReason: WeightRedistributionReason;

  survivingPillars: Pillar[];
  unavailablePillars: Pillar[];
  pillars: PillarInput[]; // all four inputs (for decomposition + the snapshot FKs)

  /** price-vs-business scalar = Market − (renormalized non-market blend); null when
   *  Market or all non-market pillars are unavailable. */
  divergence: number | null;

  unavailableReason: string | null;
  flags: string[];
}
