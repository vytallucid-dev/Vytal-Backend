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

/** The mapping IN FORCE. Stored on every snapshot (bandMappingVersionId) — the cache's
 *  provenance. Bump when the cut-points / labels / colours change. */
export const BAND_MAPPING_VERSION = "2026.2";

/** The superseded mapping. NOT an alternative configuration: 5,920 superseded snapshots are
 *  pinned to it, and `mapFor` resolves them against it so a 2024 quarter keeps the band it
 *  was actually published under. Nothing scores against it. */
export const LEGACY_BAND_MAPPING_VERSION = "2026.1";

export interface BandDef {
  band: LabelBand;
  label: string;
  colour: string; // display hex — structural, CN-8 (not fitted)
  min: number; // inclusive lower bound
  max: number | null; // exclusive upper bound; null = +∞
}

// ═══════════════════════════════════════════════════════════════════════════════════
// THE v2 BAND MAPPING — SAME FIVE BANDS, MOVED CUTS.
//
// ★ v2 DOES NOT INTRODUCE, RENAME OR RETIRE A BAND. The `weak / ordinary / good / strong`
//   vocabulary in the threshold work is the four-level GROUND-TRUTH GRADE scale the cuts are
//   derived against, not a product label set. And the reason the threshold file emits only
//   THREE cuts is that the method cuts between ADJACENT ground-truth grades and there are
//   four of them — an artefact of the derivation, not a finding that five bands are wrong.
//   A fifth cut was never testable by that method because no fifth truth grade exists.
//
// ★ WHY THE CUTS MOVE ANYWAY. v2 shifts the composite distribution down ~2.5 points
//   (median 70.1 -> 67.6). Holding 55/62/68/74 would re-label the book on release day:
//   Fragile 22 -> 59 rows, Below Par 97 -> 196, Pristine 277 -> 164. FRAGILE WOULD NEARLY
//   TRIPLE AND PRISTINE WOULD LOSE 40% OF ITS MEMBERS, NONE OF IT EARNED — a scoring-scale
//   shift presented to users as deterioration.
//
// ★ THESE CUTS ARE POPULATION-PRESERVING: a declared CONVENTION, not accuracy-derived. Each
//   sits at the percentile its live counterpart occupies today (1.9% / 10.4% / 36.5% /
//   75.7%), so the same share of the universe lands in each band and no user sees an
//   unearned downgrade. Only three of the four could be accuracy-derived even in principle.
//   The four-versus-five question goes to its own project once v2 is live and the trajectory
//   re-test has reported.
export const LABEL_BAND_MAP: BandDef[] = [
  { band: "fragile", label: "Fragile", colour: "#C0392B", min: -Infinity, max: 50 },
  { band: "below_par", label: "Below Par", colour: "#E67E22", min: 50, max: 58 },
  { band: "steady", label: "Steady", colour: "#F1C40F", min: 58, max: 65 },
  { band: "healthy", label: "Healthy", colour: "#27AE60", min: 65, max: 72 },
  { band: "pristine", label: "Pristine — fully priced", colour: "#2980B9", min: 72, max: null },
];

/** The SUPERSEDED cut-points, kept solely so a snapshot written under 2026.1 still resolves
 *  to the band it was published with. Read-only history; never scored against. */
export const LEGACY_LABEL_BAND_MAP: BandDef[] = [
  { band: "fragile", label: "Fragile", colour: "#C0392B", min: -Infinity, max: 55 },
  { band: "below_par", label: "Below Par", colour: "#E67E22", min: 55, max: 62 },
  { band: "steady", label: "Steady", colour: "#F1C40F", min: 62, max: 68 },
  { band: "healthy", label: "Healthy", colour: "#27AE60", min: 68, max: 74 },
  { band: "pristine", label: "Pristine — fully priced", colour: "#2980B9", min: 74, max: null },
];

/** The map in force for a band-mapping version. Unknown version => v1's, which is the only
 *  safe default: a snapshot pinned to a mapping we cannot resolve must not be re-banded. */
export function mapFor(version?: string): BandDef[] {
  return version === LEGACY_BAND_MAPPING_VERSION ? LEGACY_LABEL_BAND_MAP : LABEL_BAND_MAP;
}

/** Map a FULL-PRECISION composite to its band (lower-bound-inclusive). */
export function labelFor(composite: number, bandMappingVersion?: string): BandDef {
  const map = mapFor(bandMappingVersion);
  for (const b of map) {
    if (composite >= b.min && (b.max === null || composite < b.max)) return b;
  }
  // Unreachable (the map spans (−∞, +∞)); defensive.
  return map[0];
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

/** The whole number to SHOW for a composite, or null when none agrees with the stored band.
 *  ⚠ TAKES THE SNAPSHOT'S OWN MAPPING VERSION. The stored band is pinned to the mapping in
 *  force when it was written, so rounding it against a LATER map would be the exact drift
 *  this function exists to prevent. */
export function bandSafeScore(composite: number, storedBand: string, bandMappingVersion?: string): number | null {
  const band = mapFor(bandMappingVersion).find((b) => b.band === storedBand);
  if (!band) return null;
  const inBand = (v: number): boolean => v >= band.min && (band.max === null || v < band.max);
  for (const v of [Math.round(composite), Math.floor(composite), Math.ceil(composite)]) {
    if (inBand(v)) return v;
  }
  return null;
}

/** A composite as a reader sees it — whole where that agrees with its band, one decimal otherwise. */
export function scoreDisplay(composite: number, storedBand: string, bandMappingVersion?: string): string {
  const v = bandSafeScore(composite, storedBand, bandMappingVersion);
  return v === null ? composite.toFixed(1) : String(v);
}

/** The mapping serialized for BandMappingVersion.mapping (Json). */
export function bandMappingJson(version?: string): Record<string, { label: string; colour: string; range: [number | null, number | null] }> {
  const out: Record<string, { label: string; colour: string; range: [number | null, number | null] }> = {};
  for (const b of mapFor(version)) {
    out[b.band] = { label: b.label, colour: b.colour, range: [b.min === -Infinity ? null : b.min, b.max] };
  }
  return out;
}
