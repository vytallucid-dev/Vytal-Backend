// ─────────────────────────────────────────────────────────────────────────────
// PHS CONSTANTS — the A.13 single-source-of-truth table, VERBATIM.
// Status: DECLARED, NOT DERIVED (portfolio-spec 1.0). No portfolio corpus exists yet;
// every value is product judgment, not fitted. Recalibration = a clean version bump
// (CONSTANT_VERSION), never a silent edit. Do not infer, round, or substitute.
// ─────────────────────────────────────────────────────────────────────────────

export const CONSTANT_VERSION = "portfolio-spec 1.0";

// Master combine weights (A.2)
export const W_STRUCT = 0.3; // Structure penalty weight
export const W_SIGNAL = 0.2; // Signals penalty weight

// Structure rules (A.6 / A.13) — thresholds are in PERCENT points; weights are fractions.
export const S1_THRESH = 15; // single-position: % threshold
export const S1_RATE = 1.5; //   per percentage-point over
export const S1_CAP = 25; //   per-holding cap

export const S2_THRESH = 40; // sector pile-up: % threshold
export const S2_RATE = 1.2; //   per percentage-point over
export const S2_CAP = 25; //   total cap
export const S2_UNKNOWN_KILL = 0.5; //   S2 not-evaluable if unknown-sector weight exceeds

export const S3_TARGET = 8; // breadth: Neff target
export const S3_RATE = 4.0; //   per unit of Neff below target
export const S3_CAP = 20; //   total cap

export const S4_THRESH = 25; // over-diversification: holding-count threshold
export const S4_RATE = 0.5; //   per holding over
export const S4_CAP = 8; //   total cap

export const S5_THRESH = 20; // unverified mega: small-unscored % threshold
export const S5_PER = 10; //   per such holding
export const S5_CAP = 20; //   total cap

// Signals base deductions (A.7 / A.13) — each multiplied by the holding's weight w_i.
export const SIG_DISTRESS = 120; // Health in Distress band (headline)
export const SIG_CRIT = 150; // Critical red flag (headline)
export const SIG_HIGH = 80; // High red flag / High-severity finding (headline)
export const SIG_MED = 30; // Medium red flag / Medium finding (headline)
export const SIG_LP5 = 50; // LP5 eroding breadth (breadth)
export const SIG_LP6 = 30; // LP6 hollow pillar (breadth)
export const SIG_HOLDING_CAP = 200; // per-holding Signals clamp (× weight)

// Coverage ceilings (A.8) — Infinity = "none".
export const CEIL_80 = Infinity; // c ≥ 0.80
export const CEIL_60 = 84; // 0.60 ≤ c < 0.80
export const CEIL_40 = 69; // 0.40 ≤ c < 0.60
export const CEIL_20 = 54; // 0.20 ≤ c < 0.40
export const CEIL_LOW = 44; // 0 < c < 0.20
export const PROVISIONAL_BELOW = 0.4; // Provisional label below this coverage

// Bands (A.9) — lower bounds.
export const BAND_STRONG = 80;
export const BAND_STEADY = 65;
export const BAND_MIXED = 50;
export const BAND_FRAGILE = 35;
// below BAND_FRAGILE → Weak

/** Coverage → ceiling on PHS (A.8). c=0 handled upstream (no PHS). */
export function ceilingFor(c: number): number {
  if (c >= 0.8) return CEIL_80;
  if (c >= 0.6) return CEIL_60;
  if (c >= 0.4) return CEIL_40;
  if (c >= 0.2) return CEIL_20;
  return CEIL_LOW; // 0 < c < 0.20
}

/** PHS (published integer) → band (A.9). */
export function bandOf(phs: number): "Strong" | "Steady" | "Mixed" | "Fragile" | "Weak" {
  if (phs >= BAND_STRONG) return "Strong";
  if (phs >= BAND_STEADY) return "Steady";
  if (phs >= BAND_MIXED) return "Mixed";
  if (phs >= BAND_FRAGILE) return "Fragile";
  return "Weak";
}
