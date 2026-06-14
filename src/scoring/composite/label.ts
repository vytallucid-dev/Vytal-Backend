// File: src/scoring/composite/label.ts
//
// THE LABEL BAND — the SINGLE SOURCE for band → label → colour → range. The
// composite is mapped to one of five labels; the band is a CACHE-WITH-PROVENANCE
// (stored alongside the mapping VERSION that produced it) so a future re-band never
// makes history lie — re-deriving a band from (stored composite, mapping version)
// always reproduces it.
//
// BOUNDARY HANDLING (explicit): LOWER-BOUND-INCLUSIVE, upper-exclusive.
//   <55 Fragile | [55,62) Below Par | [62,68) Steady | [68,74) Healthy | ≥74 Pristine.
//   So 55 → Below Par, 62 → Steady, 68 → Healthy, 74 → Pristine.
//
// The label is derived from the FULL-PRECISION composite, NOT the rounded display
// value — so the stored band is always reproducible from the stored Decimal
// composite (a 54.7 composite is Fragile even though it DISPLAYS as 55). See FLAG.

import type { LabelBand } from "./types.js";

/** Bump when the band cut-points / labels / colours change. Stored on every
 *  snapshot (bandMappingVersionId) — the cache's provenance. */
export const BAND_MAPPING_VERSION = "2026.1";

export interface BandDef {
  band: LabelBand;
  label: string;
  colour: string; // display hex — structural, CN-8 (not fitted)
  min: number; // inclusive lower bound
  max: number | null; // exclusive upper bound; null = +∞
}

/** THE mapping. Ordered low→high, contiguous, lower-bound-inclusive. */
export const LABEL_BAND_MAP: BandDef[] = [
  { band: "fragile", label: "Fragile", colour: "#C0392B", min: -Infinity, max: 55 },
  { band: "below_par", label: "Below Par", colour: "#E67E22", min: 55, max: 62 },
  { band: "steady", label: "Steady", colour: "#F1C40F", min: 62, max: 68 },
  { band: "healthy", label: "Healthy", colour: "#27AE60", min: 68, max: 74 },
  { band: "pristine", label: "Pristine — fully priced", colour: "#2980B9", min: 74, max: null },
];

/** Map a FULL-PRECISION composite to its band (lower-bound-inclusive). */
export function labelFor(composite: number): BandDef {
  for (const b of LABEL_BAND_MAP) {
    if (composite >= b.min && (b.max === null || composite < b.max)) return b;
  }
  // Unreachable (the map spans (−∞, +∞)); defensive.
  return LABEL_BAND_MAP[0];
}

/** The mapping serialized for BandMappingVersion.mapping (Json). */
export function bandMappingJson(): Record<string, { label: string; colour: string; range: [number | null, number | null] }> {
  const out: Record<string, { label: string; colour: string; range: [number | null, number | null] }> = {};
  for (const b of LABEL_BAND_MAP) {
    out[b.band] = { label: b.label, colour: b.colour, range: [b.min === -Infinity ? null : b.min, b.max] };
  }
  return out;
}
