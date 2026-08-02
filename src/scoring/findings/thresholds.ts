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

/**
 * K2 — the ORIGINAL pillar-gap spreads (File 1 §0/§5C).
 *
 * ⚠ SUPERSEDED. NOT THE CURRENT DIVERGENCE BANDS. The divergence family's live cuts are
 * findings/divergence/bands.ts (§1.1: aligned ≤7 · minor 8–11 never surfaces · material ≥12 ·
 * stretched ≥16 · extreme ≥25). These two constants are reachable ONLY from c1-divergence.ts,
 * c2-ownership-divergence.ts, c3-floor-trajectory-split.ts and c-over-time.ts — all four RETIRED and
 * unregistered since Phase 2, so nothing live reads them.
 *
 * They survive with their files, for the same reason those files survive: a retired rule's source is
 * kept as a record of what was tried. Do NOT import them into anything new — 15 is not the material
 * cut and has not been since Phase 2, which is exactly how the tool copy came to state a number the
 * engine no longer used.
 */
export const K2_NOTABLE = 15;
export const K2_WIDE = 25;

/** Native pillar zones (weak / strong marks), File 1 §0. For F1/C2/§2 (later stages). */
export const NATIVE_ZONES = {
  foundation: { weak: 60, strong: 72 },
  momentum: { weak: 54, strong: 75 },
  market: { weak: 50, strong: 74 },
  ownership: { weak: 60, strong: 72 },
} as const;
