// File: src/scoring/findings/thresholds.ts
//
// LOCKED scales the findings engine reads (File 1 §0). These MATCH the committed engine
// (composite bands live in composite/label.ts; the read layer health-view.service.ts
// already hardcodes the same K2 + native zones). They are co-located here so the
// SCORING-layer findings engine does not depend on the read layer.
//
// FLAG: K2 + the native zones are now duplicated (here + health-view.service.ts). They
// agree today; a shared constants module would prevent future drift. Bands are NOT
// duplicated — those come from composite/label.ts (labelFor / LABEL_BAND_MAP), the single
// source, which the audit confirmed already matches File 1.

/** K2 — pillar-gap divergence spreads (File 1 §0/§5C). Pillar SCORE gaps, not price. */
export const K2_NOTABLE = 15;
export const K2_WIDE = 25;

/** Native pillar zones (weak / strong marks), File 1 §0. For F1/C2/§2 (later stages). */
export const NATIVE_ZONES = {
  foundation: { weak: 60, strong: 72 },
  momentum: { weak: 54, strong: 75 },
  market: { weak: 50, strong: 74 },
  ownership: { weak: 60, strong: 72 },
} as const;
