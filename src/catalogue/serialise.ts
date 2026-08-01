// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE WIRE DOCUMENT — what GET /api/v1/catalogue actually serves.
//
// ── WHAT IS SERVED, AND WHAT IS NOT ───────────────────────────────────────────────────────────────
//   SERVED      static product vocabulary. Names, descriptions, doesn't-means, the lens faces, the
//               Family-N static fields, the guardrail entries (shape + generated consequence/status),
//               and the two boundary maps a consumer needs to resolve a key the registries do not
//               carry (a composed lens key, or a key that reaches a payload before its copy lands).
//
//   NOT SERVED  VERDICTS. They are (evidence) => string functions — not JSON, and meaningless without
//               the instance they bind to. They ride the finding ROWS on the per-stock responses
//               (Stage 3). Serving a verdict here would mean serving a template with holes in it.
//
//   NOT SERVED  anything per-user, anything per-stock, anything calibrated. No metric bar, no pillar
//               weight, no nativeZone bound, no peer formula, no guardrail threshold. Asserted in CI
//               against THIS document's serialised bytes, not against the source modules — see
//               verify-catalogue-endpoint.ts.
//
// ── SEGMENTED BY REGISTRY, AND THAT IS THE POINT ──────────────────────────────────────────────────
// The four registries answer different questions for different subjects and no consumer needs all
// four. The alert picker needs 35 names; making it download the portfolio library and the guardrail
// layer to render a dropdown would be paying ~4× for nothing. So the document is addressable per
// registry, and there is a names-only projection for the picker specifically.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import { GUARDRAIL_SIGNATURES } from "./guardrail-signatures.js";
import { LENS_FACES } from "./lens-faces.js";
import { PHS_FINDINGS } from "./phs-findings.js";
import { FAMILY_DOESNT_MEAN, LENS_DOESNT_MEAN, STOCK_FINDINGS } from "./stock-findings.js";
import type { RegistryId } from "./types.js";

/** The registries a caller may address. */
export const SERVED_REGISTRIES = ["stock_finding", "lens_face", "phs_finding", "guardrail_signature"] as const;
export type ServedRegistry = (typeof SERVED_REGISTRIES)[number];

export const isServedRegistry = (s: string): s is ServedRegistry =>
  (SERVED_REGISTRIES as readonly string[]).includes(s);

/**
 * The two boundary maps. A consumer resolving `doesntMean(key)` for a key the registries do not carry
 * needs both: the LENS map for a runtime-composed `lens_<id>_<suffix>` key, and the FAMILY map as the
 * final fallback (it is total over A–I + N, so the resolution can never come up empty).
 *
 * Served on the FULL document and on the stock_finding segment — those are the two places a consumer
 * doing that resolution can be. Not on the phs / guardrail segments, which have no such resolution.
 */
export interface BoundaryMaps {
  /** Family letter → the mandatory boundary line. Total over A–I + N. */
  family: Record<string, string>;
  /** Lowercase face id (lm3 / lm7 / lp2 / lp5) → the escalating lens boundary. */
  lens: Record<string, string>;
}

const boundaries = (): BoundaryMaps => ({
  family: { ...FAMILY_DOESNT_MEAN },
  lens: { ...LENS_DOESNT_MEAN },
});

const REGISTRY_SOURCE: Record<ServedRegistry, () => Record<string, unknown>> = {
  stock_finding: () => STOCK_FINDINGS as unknown as Record<string, unknown>,
  lens_face: () => LENS_FACES as unknown as Record<string, unknown>,
  phs_finding: () => PHS_FINDINGS as unknown as Record<string, unknown>,
  guardrail_signature: () => GUARDRAIL_SIGNATURES as unknown as Record<string, unknown>,
};

export interface RegistryDocument {
  registry: RegistryId;
  count: number;
  entries: Record<string, unknown>;
  /** Present on stock_finding only — see BoundaryMaps. */
  boundaries?: BoundaryMaps;
}

export interface CatalogueDocument {
  /** Content hash of the served bytes. Changes on deploy only; drives the ETag. */
  version: string;
  registries: Record<ServedRegistry, RegistryDocument>;
  boundaries: BoundaryMaps;
  counts: Record<ServedRegistry, number>;
}

function registryDoc(registry: ServedRegistry): RegistryDocument {
  const entries = REGISTRY_SOURCE[registry]();
  const doc: RegistryDocument = {
    registry,
    count: Object.keys(entries).length,
    entries,
  };
  if (registry === "stock_finding") doc.boundaries = boundaries();
  return doc;
}

/** Stable content hash — the ETag and the document's own `version`. */
function hashOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

/**
 * The FULL document. Built once at module load: every input is a frozen module-level constant, so the
 * bytes cannot change between requests within a deploy. That is also what makes the ETag honest — a
 * hash recomputed per request over identical input would be the same hash at more cost.
 */
export const CATALOGUE_DOCUMENT: CatalogueDocument = (() => {
  const registries = Object.fromEntries(
    SERVED_REGISTRIES.map((r) => [r, registryDoc(r)]),
  ) as Record<ServedRegistry, RegistryDocument>;
  const counts = Object.fromEntries(
    SERVED_REGISTRIES.map((r) => [r, registries[r].count]),
  ) as Record<ServedRegistry, number>;
  const body = { registries, boundaries: boundaries(), counts };
  return { version: hashOf(body), ...body };
})();

/** One registry, addressable on its own. Carries the same `version` so a segmented consumer can tell
 *  whether it is holding pieces from two different deploys. */
export interface RegistrySegment extends RegistryDocument {
  version: string;
}

export const registrySegment = (registry: ServedRegistry): RegistrySegment => ({
  version: CATALOGUE_DOCUMENT.version,
  ...CATALOGUE_DOCUMENT.registries[registry],
});

/**
 * ★ THE ALERT-PICKER PROJECTION. `key → name`, nothing else.
 *
 * alerts.ts builds FINDING_OPTIONS at module-eval from the full name dictionary to populate a
 * dropdown. It has no use for descriptions, boundaries, families or concerns, and making a dropdown
 * pay for the whole catalogue is the kind of cost nobody notices until it is a bundle-size review.
 * This is ~1/17th of the full document.
 */
export interface NamesDocument {
  version: string;
  count: number;
  names: Record<string, string>;
}

export const stockFindingNames = (): NamesDocument => {
  const names = Object.fromEntries(
    Object.entries(STOCK_FINDINGS).map(([key, e]) => [key, e.name]),
  );
  return { version: CATALOGUE_DOCUMENT.version, count: Object.keys(names).length, names };
};

/** Serialised size of any served document, in bytes — for the size report and the CI budget. */
export const byteSize = (doc: unknown): number => Buffer.byteLength(JSON.stringify(doc), "utf8");
