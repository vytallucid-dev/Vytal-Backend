// ─────────────────────────────────────────────────────────────────────────────
// PHS CONSTANTS — the A.13 single-source-of-truth table, VERBATIM.
// Status: DECLARED, NOT DERIVED (portfolio-spec 1.2). No portfolio corpus exists yet;
// every value is product judgment, not fitted. Recalibration = a clean version bump
// (CONSTANT_VERSION), never a silent edit. Do not infer, round, or substitute.
//
// AMENDMENT 1.2 — DECOUPLING (amends 1.1; base spec + 1.1 otherwise stands):
//  • Change 1 — Health loses the structure term. Health = Quality − 0.20×(100 − Signals).
//    No positional penalty of any kind enters the Health number. W_STRUCT is RETIRED.
//  • Change 2 — Construction = standalone Structure at FULL strength (S1–S5, raw). The
//    0.30× dampening that lived in the old blended composite is gone with the term.
//  • Change 3 — the coverage ceiling is RETIRED. Health shows TRUE, uncapped. The
//    mandatory coverage line + a "Provisional" tag below 40% do the honesty work.
//    CEIL_*, ceilingFor(), and C_EFF_RECOG_FACTOR are removed.
//  • Change 4/5 — pillarProfile + lensProfile (findings-character) read shapes. The lens
//    primary-nature classifier lives here (LENS_NATURE). Both characterize, never predict.
//
// AMENDMENT 1.1 (still in force):
//  • S1 single-position threshold is RELATIVE: max(15%, 1.5 × 100/N) (S1_FAIR_MULT).
//  • structure_tier (from N) + capital_tier (from total value) — COPY/STORAGE ONLY.
// ─────────────────────────────────────────────────────────────────────────────

export const CONSTANT_VERSION = "portfolio-spec 1.2";

// Master combine weight (A.2). (1.2 Change 1) ONLY Signals now enters the Health number;
// the Structure weight W_STRUCT is RETIRED — structure is a standalone read (Construction).
export const W_SIGNAL = 0.2; // Signals penalty weight in Health = Quality − W_SIGNAL×(100−Signals)

// Structure rules (A.6 / A.13) — thresholds are in PERCENT points; weights are fractions.
export const S1_THRESH = 15; // single-position: % FLOOR of the relative threshold (1.1)
export const S1_FAIR_MULT = 1.5; // (1.1 Change 1) × fair_share (=100/N); threshold = max(S1_THRESH, this × 100/N)
export const S1_RATE = 1.5; //   per percentage-point over the (relative) threshold
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

// (1.2 Change 3) The coverage ceiling is RETIRED — Health shows TRUE, uncapped. The
// honesty is carried by the mandatory coverage line + a "Provisional" tag below 40%
// coverage. CEIL_* / ceilingFor() / C_EFF_RECOG_FACTOR are removed; only the tag cut remains.
export const PROVISIONAL_BELOW = 0.4; // "Provisional" tag below this TRUE coverage (c)

// (1.2 Change 5) Lens primary-nature classifier — maps each three-lens pattern (LM1–LM8,
// LP1–LP6) to the ONE lens its information lives on, per the Three-Lens Library §2–§4:
//   • PEER  — field-verdicts / peer-convergence (the L1↔L2 tension is the headline)
//   • TREND — the L3 direction (self-improvement / deterioration) is the headline
//   • ABSOLUTE — the L1 standalone standing is the headline (all-agree or genuine weak)
// Used ONLY for the lensProfile findings-CHARACTER read — never score attribution.
export type LensNature = "absolute" | "peer" | "trend";
export const LENS_NATURE: Record<string, LensNature> = {
  // absolute — L1 standing is the story
  LM1: "absolute", // Compounding strength (all agree up)
  LM7: "absolute", // Triple fail (genuinely weak, not a field artifact)
  LM8: "absolute", // Field-masked quiet weak spot (anti-mask on absolute weakness)
  LP1: "absolute", // Broad strength
  // peer — the field-relative verdict is the story
  LM3: "peer", // Tallest in a sunken field (PG weak)
  LM4: "peer", // Exceptional field (PG strong)
  LM6: "peer", // Eroding lead — converging to field
  LP2: "peer", // Field-lifted (PG weak)
  LP3: "peer", // Field-suppressed (PG strong)
  // trend — the own-history direction is the story
  LM2: "trend", // Plateau at the top (self-deceleration)
  LM5: "trend", // Recovering off the floor
  LP4: "trend", // Improving breadth
  LP5: "trend", // Eroding breadth
  LP6: "trend", // Hollow pillar (strong but fading)
};

// (1.1 Change 2) Tier boundaries — STORAGE + Part B copy SELECTOR ONLY. HARD LOCK: no
// S-rule, pillar, ceiling, or formula may read these. They are pure functions of N and
// total value that nothing in the score touches, so the PHS is byte-identical with or
// without them. structure_tier from holding count N; capital_tier from total book value ₹.
export const STRUCT_TIER_BUILDING_MIN = 5; //   1–4 Starter · 5–7 Building · 8+ Established
export const STRUCT_TIER_ESTABLISHED_MIN = 8;
export const CAPITAL_TIER_MODEST_MAX = 200_000; //     < ₹2L Modest
export const CAPITAL_TIER_SUBSTANTIAL_MIN = 1_500_000; // > ₹15L Substantial; [₹2L, ₹15L] Moderate

// Bands (A.9) — lower bounds.
export const BAND_STRONG = 80;
export const BAND_STEADY = 65;
export const BAND_MIXED = 50;
export const BAND_FRAGILE = 35;
// below BAND_FRAGILE → Weak

/** (1.1 Change 1) Relative S1 threshold in PERCENT points for a book of N holdings:
 *  max(15% floor, 1.5 × fair_share), fair_share = 100/N. A thin book gets a higher bar
 *  before S1 bites, so thin breadth stays owned by S3/Neff (no S1/S3 double-charge). */
export function s1ThresholdPct(holdingCount: number): number {
  const fairShare = holdingCount > 0 ? 100 / holdingCount : 0;
  return Math.max(S1_THRESH, S1_FAIR_MULT * fairShare);
}

// (1.1 Change 2) Copy-only tier labels. Never read by the score — see the HARD LOCK note.
export type StructureTier = "Starter" | "Building" | "Established";
export type CapitalTier = "Modest" | "Moderate" | "Substantial";

/** Book-maturity tier from holding count N (COPY SELECTOR ONLY). */
export function structureTierOf(holdingCount: number): StructureTier {
  if (holdingCount >= STRUCT_TIER_ESTABLISHED_MIN) return "Established";
  if (holdingCount >= STRUCT_TIER_BUILDING_MIN) return "Building";
  return "Starter";
}

/** Capital tier from total book value in ₹ (COPY SELECTOR ONLY). Boundaries inclusive of
 *  Moderate: [₹2L, ₹15L] → Moderate; < ₹2L → Modest; > ₹15L → Substantial. */
export function capitalTierOf(totalValue: number): CapitalTier {
  if (totalValue > CAPITAL_TIER_SUBSTANTIAL_MIN) return "Substantial";
  if (totalValue >= CAPITAL_TIER_MODEST_MAX) return "Moderate";
  return "Modest";
}

/** Health Score (published integer) → band (A.9). Bands unchanged in 1.2. */
export function bandOf(health: number): "Strong" | "Steady" | "Mixed" | "Fragile" | "Weak" {
  if (health >= BAND_STRONG) return "Strong";
  if (health >= BAND_STEADY) return "Steady";
  if (health >= BAND_MIXED) return "Mixed";
  if (health >= BAND_FRAGILE) return "Fragile";
  return "Weak";
}
