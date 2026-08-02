// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CATALOGUE — the one home for static product copy, assembled.
//
// FOUR REGISTRIES, ONE ENTRY TYPE, NO FLATTENING:
//
//   stock_finding        35 keys   this module          MOVED from the frontend (Stage 1)
//   lens_face            14 ids    referenced in place  scoring/lens-patterns/catalog.ts
//   phs_finding          58 ids    referenced in place  portfolio/phs/copy.ts
//   guardrail_signature  11 keys   this module          NEWLY AUTHORED (Stage 2 — it existed nowhere)
//
// ⚠ ONE OF THE FOUR PLAYS BY AN OPPOSITE RULE ON NUMBERS. Nine stock-finding descriptions NAME their
// trigger bar and keep it; not one guardrail string contains a digit. That is not an inconsistency —
// finding bars read filed public disclosures and cannot be gamed, guardrail bars ARE the detector for
// gamed reporting. Both sides are enforced in verify-catalogue.ts §7. See guardrail-signatures.ts.
//
// ── WHAT THIS MODULE IS NOT ────────────────────────────────────────────────────────────────────────
// Not a scoring input. Not per-user. Not calibration. It carries product VOCABULARY — the words we
// have already published to readers on the stock page — and nothing that could be reverse-engineered
// into a metric bar, a pillar weight, a nativeZone bound or a peer formula. That boundary is asserted,
// not assumed: scripts/verify-catalogue.ts §5 scans every served string for leaked calibration.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { GUARDRAIL_SIGNATURES, GUARDRAIL_SIGNATURE_KEYS, guardrailSignature } from "./guardrail-signatures.js";
import { LENS_FACES, LENS_FACE_IDS, faceIdOfLensKey, isLensKey, lensFace, lensFaceForKey, type LensFaceId } from "./lens-faces.js";
import { PHS_FINDINGS, PHS_FINDING_IDS, phsFinding } from "./phs-findings.js";
import {
  FAMILY_DOESNT_MEAN,
  LENS_DOESNT_MEAN,
  STOCK_FINDINGS,
  STOCK_FINDING_KEYS,
  doesntMean,
  familyOf,
  findingConcern,
  findingDescription,
  findingFamily,
  findingName,
  type StockFindingKey,
} from "./stock-findings.js";
import type { CatalogueEntry, RegistryId } from "./types.js";

export * from "./types.js";
export * from "./divergence.js";
// Retirement: the suppression registry + the read-layer filters. Exported here so a consumer that
// already imports the catalogue does not need a second import path to drop retired rows.
export * from "./retired-findings.js";
export {
  STOCK_FINDINGS,
  STOCK_FINDING_KEYS,
  FAMILY_DOESNT_MEAN,
  LENS_DOESNT_MEAN,
  familyOf,
  findingName,
  findingDescription,
  findingConcern,
  findingFamily,
  doesntMean,
  type StockFindingKey,
};
export {
  LENS_FACES,
  LENS_FACE_IDS,
  faceIdOfLensKey,
  isLensKey,
  lensFace,
  lensFaceForKey,
  type LensFaceId,
};
export { PHS_FINDINGS, PHS_FINDING_IDS, phsFinding };
export { GUARDRAIL_SIGNATURES, GUARDRAIL_SIGNATURE_KEYS, guardrailSignature };
export { N_FAMILY_COPY, N_FAMILY_DOESNT_MEAN, type NFamilyStaticCopy } from "./n-family-copy.js";

/** The assembled catalogue. Registries stay SEPARATE — a lookup must name which namespace it means. */
export const CATALOGUE = {
  stock_finding: STOCK_FINDINGS,
  lens_face: LENS_FACES,
  phs_finding: PHS_FINDINGS,
  guardrail_signature: GUARDRAIL_SIGNATURES,
} as const;

/** All four registries. */
export const REGISTRY_IDS: readonly RegistryId[] = [
  "stock_finding",
  "lens_face",
  "phs_finding",
  "guardrail_signature",
];

/**
 * Resolve one entry by (registry, key). Deliberately requires the namespace: there is no
 * "just look it up everywhere" accessor, because `PC3` and `LM3` and a stock key are three different
 * kinds of thing and a cross-namespace hit would be a bug that reads like a feature.
 */
export function catalogueEntry(registry: RegistryId, key: string): CatalogueEntry | null {
  switch (registry) {
    case "stock_finding":
      return (STOCK_FINDINGS as Record<string, CatalogueEntry | undefined>)[key] ?? null;
    case "lens_face":
      return (LENS_FACES as Record<string, CatalogueEntry | undefined>)[key] ?? null;
    case "phs_finding":
      return (PHS_FINDINGS as Record<string, CatalogueEntry | undefined>)[key] ?? null;
    case "guardrail_signature":
      return (GUARDRAIL_SIGNATURES as Record<string, CatalogueEntry | undefined>)[key] ?? null;
  }
}

/**
 * Resolve copy for a key that arrived on a STOCK payload, wherever it came from. The one accessor
 * that spans the stock-side registries, because the read layer genuinely cannot tell in advance
 * whether `key` is a registry member or a runtime-composed lens key — that is the whole point of 1e.
 */
export function stockSideEntry(key: string): CatalogueEntry | null {
  const face = lensFaceForKey(key);
  if (face) return face;
  return (STOCK_FINDINGS as Record<string, CatalogueEntry | undefined>)[key] ?? null;
}

/** Total entry count across the assembled registries — the number the Stage-4 production check
 *  compares against, so "the endpoint returned the complete key set" is a number, not a vibe. */
export function catalogueSize(): Record<RegistryId, number> {
  return {
    stock_finding: STOCK_FINDING_KEYS.length,
    lens_face: LENS_FACE_IDS.length,
    phs_finding: PHS_FINDING_IDS.length,
    guardrail_signature: GUARDRAIL_SIGNATURE_KEYS.length,
  };
}
