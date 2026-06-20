// File: src/scoring/read/scope-aggregate.ts
//
// THE ScopeAggregate PRIMITIVE — one reusable computation over a SET of in-force
// member snapshots. Every peer-group / sector / portfolio aggregate surface folds
// through this. It is PURE: it never queries — the caller resolves the in-force
// cross-section (supersede-aware, point-in-time) and hands in plain `ScopeMember`
// rows; this file only does the distribution arithmetic.
//
// Weighting is a PARAMETER. Only equal-weight is wired today; the Portfolio surface
// will later pass position weights via `ScopeMember.weight`. The signature is built
// for it now (weighted mean honours weights), but median/percentiles are unweighted
// until a weighted-median is genuinely needed — documented, not silently assumed.

import type { LabelBand, PillarKey } from "./health-view.types.js";

export const LABEL_BANDS: LabelBand[] = [
  "fragile",
  "below_par",
  "steady",
  "healthy",
  "pristine",
];
const PILLAR_KEYS: PillarKey[] = ["foundation", "momentum", "market", "ownership"];

/** One member's contribution to an aggregate. Built by the loader from an in-force
 *  snapshot — the primitive never reads the DB. */
export interface ScopeMember {
  stockId: string;
  symbol: string;
  composite: number;
  labelBand: LabelBand;
  /** The four pillar subtotals (denormalised on the snapshot). */
  pillars: Record<PillarKey, number>;
  firesAnyRedFlag: boolean;
  /** Aggregation weight. Equal-weight = 1 for every member (the only mode wired
   *  today). The Portfolio surface will pass position weights here later. */
  weight: number;
}

export type WeightingMode = "equal" | "weighted";

export interface ScopeDispersion {
  /** Population stdDev of composites (0 at n≤1 — never NaN). */
  stdDev: number;
  /** Inter-quartile range (p75 − p25). */
  iqr: number;
  p25: number;
  p75: number;
}

export interface ScopeAggregate {
  /** Members folded into the stats (the scored cross-section at the period). */
  scoredCount: number;
  weightingMode: WeightingMode;
  medianComposite: number;
  meanComposite: number;
  dispersion: ScopeDispersion;
  min: { symbol: string; composite: number } | null;
  max: { symbol: string; composite: number } | null;
  /** Raw composites ASCENDING — the substrate for the distribution strip. */
  composites: number[];
  /** Count per band — all 5 keys always present (0 when none). */
  bandDistribution: Record<LabelBand, number>;
  /** Median of each pillar's subtotal across members. */
  pillarMedians: Record<PillarKey, number>;
  /** Members firing ≥1 red flag (the attention census). */
  redFlagMemberCount: number;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Linear-interpolated percentile on an arbitrary-order numeric array. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

function emptyBands(): Record<LabelBand, number> {
  return { fragile: 0, below_par: 0, steady: 0, healthy: 0, pristine: 0 };
}

/**
 * Compute the aggregate over a set of members. Pure arithmetic — no fabrication:
 * an empty set returns a well-formed zero aggregate (scoredCount 0, null min/max,
 * all bands 0) so callers can null-guard on `scoredCount` rather than crash.
 *
 * @param weightingMode "equal" (default, only mode wired) | "weighted" (mean honours
 *   `ScopeMember.weight`; percentiles stay unweighted until a real need exists).
 */
export function computeScopeAggregate(
  members: ScopeMember[],
  weightingMode: WeightingMode = "equal",
): ScopeAggregate {
  if (members.length === 0) {
    return {
      scoredCount: 0,
      weightingMode,
      medianComposite: 0,
      meanComposite: 0,
      dispersion: { stdDev: 0, iqr: 0, p25: 0, p75: 0 },
      min: null,
      max: null,
      composites: [],
      bandDistribution: emptyBands(),
      pillarMedians: { foundation: 0, momentum: 0, market: 0, ownership: 0 },
      redFlagMemberCount: 0,
    };
  }

  const sorted = [...members].sort((a, b) => a.composite - b.composite);
  const compositeVals = sorted.map((m) => m.composite);

  // Weighted mean (equal-weight collapses to the simple mean).
  const totalW =
    weightingMode === "weighted"
      ? members.reduce((s, m) => s + m.weight, 0) || members.length
      : members.length;
  const meanComposite =
    weightingMode === "weighted"
      ? members.reduce((s, m) => s + m.composite * m.weight, 0) / totalW
      : compositeVals.reduce((s, v) => s + v, 0) / members.length;

  const p25 = percentile(compositeVals, 25);
  const p50 = percentile(compositeVals, 50);
  const p75 = percentile(compositeVals, 75);

  // Population variance about the mean — 0 at n=1, never NaN.
  const variance =
    compositeVals.reduce((s, v) => s + (v - meanComposite) ** 2, 0) / members.length;
  const stdDev = Math.sqrt(variance);

  const bandDistribution = emptyBands();
  for (const m of members) bandDistribution[m.labelBand] += 1;

  const pillarMedians = {} as Record<PillarKey, number>;
  for (const k of PILLAR_KEYS) {
    pillarMedians[k] = round2(percentile(members.map((m) => m.pillars[k]), 50));
  }

  return {
    scoredCount: members.length,
    weightingMode,
    medianComposite: round2(p50),
    meanComposite: round2(meanComposite),
    dispersion: { stdDev: round2(stdDev), iqr: round2(p75 - p25), p25: round2(p25), p75: round2(p75) },
    min: { symbol: sorted[0].symbol, composite: round2(sorted[0].composite) },
    max: {
      symbol: sorted[sorted.length - 1].symbol,
      composite: round2(sorted[sorted.length - 1].composite),
    },
    composites: compositeVals.map(round2),
    bandDistribution,
    pillarMedians,
    redFlagMemberCount: members.filter((m) => m.firesAnyRedFlag).length,
  };
}

// ── Character descriptor — TEMPLATED from the real numbers, never invented. ──────
// Level word = the band of the MEDIAN member (a real member's real band, not a cut
// we re-derive). Spread word = thresholded stdDev. Both inputs are surfaced raw on
// the response, so the string is pure convenience.

const BAND_WORD: Record<LabelBand, string> = {
  fragile: "fragile",
  below_par: "weak",
  steady: "steady",
  healthy: "healthy",
  pristine: "strong",
};

function spreadWord(stdDev: number): string {
  if (stdDev < 6) return "tight";
  if (stdDev < 12) return "varied";
  return "dispersed";
}

/**
 * Build the one-line descriptor (e.g. "healthy, tight"). Uses the band of the
 * median-composite member for the level word — a real datapoint, not a fabricated
 * cut. Returns null for an empty pond.
 */
export function describeScope(members: ScopeMember[], agg: ScopeAggregate): string | null {
  if (members.length === 0) return null;
  const sorted = [...members].sort((a, b) => a.composite - b.composite);
  const medianMember = sorted[Math.floor((sorted.length - 1) / 2)]; // lower-middle on ties
  return `${BAND_WORD[medianMember.labelBand]}, ${spreadWord(agg.dispersion.stdDev)}`;
}
