// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// REGISTRY 2 of 4 — THREE-LENS FACES (LM1–8 metric · LP1–6 pillar).
//
// ── ★ REFERENCED IN PLACE. NOTHING IS COPIED HERE. ────────────────────────────────────────────────
// The verbatim faces already live backend-side at scoring/lens-patterns/catalog.ts, transcribed from
// Vytal_Three_Lens_Pattern_Library_v1.md and protected on every build by no-forward-guard.ts. Copying
// them into the catalogue would create the second home this whole exercise exists to eliminate — so
// this module IMPORTS them and adapts the shape. Edit the library, not this file.
//
// (The frontend carries a duplicate transcription in lib/findings/descriptions.ts — LM_CATALOG /
// LP_CATALOG. That duplicate is one of the things Stage 6 deletes; the backend original is the one
// that survives, which is why it is the one referenced.)
//
// ── ★ 1e · HOW A RUNTIME-COMPOSED KEY MAPS BACK TO A FACE ─────────────────────────────────────────
// Lens findings do NOT have static keys. lens-findings.ts composes them per firing:
//
//     metric-level   `lens_${face.id.toLowerCase()}_${metricKey}`   → lens_lm3_NII, lens_lm7_CASA
//     pillar-level   `lens_${face.id.toLowerCase()}_${pillar}`      → lens_lp2_foundation
//
// so the key set is (loud faces × every metric that has ever fired) — unbounded, and no static list
// can enumerate it. THE CATALOGUE THEREFORE KEYS ON THE FACE ID, NEVER ON THE COMPOSED KEY. There are
// exactly 14 faces and there always will be exactly 14; the suffix is an INSTANCE coordinate (which
// metric, which pillar), not an identity.
//
// Two independent ways back, and they agree:
//   STRUCTURAL  the key's own shape — `^lens_(lm\d|lp\d)_` → group 1 uppercased. Works on a census
//               payload, which carries no evidence at all. This is the one the read layer uses.
//   EVIDENTIAL  evidence.lens carries the face id verbatim ("LM3"), and evidence.label carries the
//               face label. Works per-stock, where evidence exists.
// `faceIdOfLensKey` below is the structural one, and it is the only place that transform lives.
//
// ── ONLY FOUR OF THE FOURTEEN EVER COMPOSE A KEY ──────────────────────────────────────────────────
// LM3/LM7/LP2/LP5 escalate to top-level finding cards. The other ten are "loud at the extremes, quiet
// in the middle" — they never become findings, but they DO render as per-stock pillar-breakdown pills,
// so they need copy exactly as much. All fourteen are registered; `escalates` records which is which.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { LM_CATALOG, LP_CATALOG, type CatalogFace } from "../scoring/lens-patterns/catalog.js";
import { FAMILY_DOESNT_MEAN, LENS_DOESNT_MEAN } from "./stock-findings.js";
import type { LensFaceEntry, Registry } from "./types.js";

/** The closed face vocabulary. Fourteen, by construction — §2 metric faces + §3 pillar faces. */
export const LENS_FACE_IDS = [
  "LM1", "LM2", "LM3", "LM4", "LM5", "LM6", "LM7", "LM8",
  "LP1", "LP2", "LP3", "LP4", "LP5", "LP6",
] as const;

export type LensFaceId = (typeof LENS_FACE_IDS)[number];

/** The four that escalate to a finding card (databank §5.2) — the only ids that ever appear inside a
 *  composed `lens_*` key. The other ten stay pillar-breakdown pills. */
const ESCALATING: ReadonlySet<string> = new Set(["LM3", "LM7", "LP2", "LP5"]);

/**
 * The face's interpretive boundary, RESOLVED. Ported unchanged from the frontend's `lensDoesntMean`:
 * prefer the pattern-library face's own "Doesn't mean" (LM1–8 all have one); fall back to the
 * family-level lens boundary for the escalating ids (LP2/LP5, whose face line the databank left
 * blank); then to the generic pattern boundary. Never empty — every lens card carries one.
 */
function resolveDoesntMean(face: CatalogFace): string {
  if (face.doesntMean) return face.doesntMean;
  return LENS_DOESNT_MEAN[face.id.toLowerCase()] ?? FAMILY_DOESNT_MEAN.E;
}

function faceOf(id: LensFaceId): CatalogFace {
  const face = LM_CATALOG[id] ?? LP_CATALOG[id];
  // Unreachable while LENS_FACE_IDS mirrors the library — asserted in verify-catalogue.ts §3 so the
  // mirror can never silently drift out of sync with the source it is supposed to mirror.
  if (!face) throw new Error(`[catalogue] lens face ${id} is missing from the pattern library`);
  return face;
}

/** THE REGISTRY. Total over LensFaceId; label + read are the library's strings, untouched. */
export const LENS_FACES: Registry<LensFaceId, LensFaceEntry> = Object.freeze(
  Object.fromEntries(
    LENS_FACE_IDS.map((id) => {
      const face = faceOf(id);
      const entry: LensFaceEntry = {
        registry: "lens_face",
        key: id,
        name: face.label,
        description: face.read,
        tone: face.tone,
        fieldVerdict: face.fieldVerdict,
        escalates: ESCALATING.has(id),
        doesntMean: resolveDoesntMean(face),
      };
      return [id, entry];
    }),
  ) as Record<LensFaceId, LensFaceEntry>,
);

/**
 * ★ 1e — the composed key → face id transform, in ONE place.
 * `lens_lm3_NII` → "LM3" · `lens_lp5_foundation` → "LP5" · anything else → null.
 * The suffix (metricKey / pillar) is deliberately discarded: it is the instance coordinate, and the
 * copy is a property of the FACE.
 */
export function faceIdOfLensKey(key: string): LensFaceId | null {
  const m = /^lens_(lm[1-8]|lp[1-6])_/.exec(key);
  if (!m) return null;
  const id = m[1].toUpperCase() as LensFaceId;
  return id in LENS_FACES ? id : null;
}

/** True for any runtime-composed lens finding key. */
export const isLensKey = (key: string): boolean => faceIdOfLensKey(key) !== null;

/** Resolve a face by uppercase id (LM3 / LP2 / …). null for unknown ids. */
export function lensFace(idUpper: string): LensFaceEntry | null {
  return (LENS_FACES as Record<string, LensFaceEntry | undefined>)[idUpper] ?? null;
}

/** Resolve a face from a COMPOSED key (`lens_lm3_NII`). null when the key is not a lens key. */
export function lensFaceForKey(key: string): LensFaceEntry | null {
  const id = faceIdOfLensKey(key);
  return id ? LENS_FACES[id] : null;
}
