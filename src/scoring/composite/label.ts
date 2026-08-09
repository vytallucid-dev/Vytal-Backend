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

// ═══ ★★ DISPLAY ROUNDING THAT CANNOT CONTRADICT THE BAND BESIDE IT ═══════════════════════════════
//
// The platform shows health scores WHOLE (the frontend's lib/format#roundScore is its one rounding
// place). Naive rounding is safe everywhere a score appears alone, and unsafe wherever it appears
// NEXT TO ITS BAND — because the cut points are published on the methodology page, so a reader can
// derive the band from the number they are shown.
//
// MEASURED over all 582 quarterly snapshots: `Math.round` lands in a different band than the stored
// one on 35 — 6.01%, one in sixteen. NTPC FY26Q4 is 67.74, stored Steady; rounded it is 68, and the
// published cut says 68 and above is Healthy. The card would print "68 · Steady".
//
// ⚠ THIS IS NOT AN ARTEFACT OF ROUNDING TO WHOLE. One decimal has the same defect, more rarely:
// MANKIND FY26Q1 is 67.95, prints "68.0", reads as Healthy. Precision was never the fix; AGREEMENT is.
//
// THE RULE: the displayed score never leaves its own band. Round to nearest; if that crosses the cut,
// step to the nearest whole number still inside the stored band. The display moves by at most one
// point, which a reader cannot check — where the alternative moves the BAND, which they can.
//
// ⚠ THE STORED BAND IS THE AUTHORITY, NOT labelFor(). A snapshot is pinned to the band mapping in
// force when it was written. If the mapping has since moved, no whole number inside today's map will
// agree with the stored band, and the honest answer is to stop rounding and print the figure as it
// is — never to bend the number or the label into agreement.
//
// ⚠ IT LIVES HERE, BESIDE THE MAP. Two callers need it (the brief's health section and the reader's
// own position section) and both must round identically; a copy in either would be a second opinion
// about where a band begins.

/** The whole number to SHOW for a composite, or null when none agrees with the stored band. */
export function bandSafeScore(composite: number, storedBand: string): number | null {
  const band = LABEL_BAND_MAP.find((b) => b.band === storedBand);
  if (!band) return null;
  const inBand = (v: number): boolean => v >= band.min && (band.max === null || v < band.max);
  for (const v of [Math.round(composite), Math.floor(composite), Math.ceil(composite)]) {
    if (inBand(v)) return v;
  }
  return null;
}

/** A composite as a reader sees it — whole where that agrees with its band, one decimal otherwise. */
export function scoreDisplay(composite: number, storedBand: string): string {
  const v = bandSafeScore(composite, storedBand);
  return v === null ? composite.toFixed(1) : String(v);
}

/** The mapping serialized for BandMappingVersion.mapping (Json). */
export function bandMappingJson(): Record<string, { label: string; colour: string; range: [number | null, number | null] }> {
  const out: Record<string, { label: string; colour: string; range: [number | null, number | null] }> = {};
  for (const b of LABEL_BAND_MAP) {
    out[b.band] = { label: b.label, colour: b.colour, range: [b.min === -Infinity ? null : b.min, b.max] };
  }
  return out;
}
