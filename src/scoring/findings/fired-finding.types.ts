// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FIRED-FINDING SHAPE — a LEAF module, and the leaf-ness is the point.
//
// ★ WHY THIS IS NOT IN types.ts, WHERE IT USED TO LIVE.
//
// `types.ts` carries a type-only import of the generated Prisma client (`IndustryType`). That is
// perfectly correct there — it is erased at compile time and costs nothing at runtime. But
// scripts/verify-build-gate-hygiene.ts walks each build gate's import graph WITHOUT distinguishing
// type-only edges, deliberately: an `import type` that a later edit turns into a value import would
// otherwise pull the DB client into a build gate with nothing to catch it.
//
// So any module a BUILD GATE imports must not reach `types.ts`. `coalesce.ts` is imported by two
// gates (verify-coalescing.ts and verify-copy-register.ts) and needs exactly one type from it — the
// fired-finding shape — so that shape lives here, in a module that imports nothing at all.
//
// ⚠ ONE DEFINITION, RE-EXPORTED — NOT A COPY. `types.ts` re-exports these, so every existing import
// site is unchanged and there is no second declaration to drift. Copying the interface instead would
// have created exactly the divergence this catalogue's totality checks exist to prevent.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { StockFindingKey } from "../../catalogue/stock-findings.js";

export type FindingKind = "red_flag" | "pattern";

/** File 1 §5E — the three mandatory pattern display states. */
export type FindingDisplayState = "active" | "pending_data_integration" | "dampened";

/** A RULE's inherent good/bad classification, published as a rule property (Family N Amendment §1).
 *  Distinct from a fired instance's {@link FiredFinding.direction}: a rule has a polarity even when it
 *  does not fire, and a rule may FIRE with a null direction yet still be `neutral` polarity (e.g.
 *  F2's mix-shift). Family N is `positive`. */
export type Polarity = "positive" | "negative" | "neutral";

/** Amendment §2.4 temporal class. `CONDITION` = a standing fact about the COMPANY that does not age
 *  out on a clock (all of Family N). `EVENT` = a dated occurrence. A semantic marker only. */
export type TemporalClass = "CONDITION" | "EVENT";

/**
 * ★ THE ONE NAMESPACE NO STATIC LIST CAN ENUMERATE. Three-lens findings compose their key at runtime
 * — `lens_${faceId}_${metricKey}` — one key per (lens × metric) combination that has ever fired.
 */
export type LensComposedKey = `lens_${string}`;

/** What may go on the wire as a finding key: a catalogued stock finding or a composed lens key —
 *  never a free string. A typo does not compile. */
export type FiredFindingKey = StockFindingKey | LensComposedKey;

/**
 * The emit shape every rule returns. ONE finding = one card. `evidence` is the JSON the UI reads to
 * build the verdict sentence (it MUST carry the real breaching stat). The persist layer maps
 * `evidence` → RedFlag.triggeringValues (red_flag) or ScorePattern.evidence (pattern).
 */
export interface FiredFinding {
  kind: FindingKind;
  /** RedFlag.flagKey (red flags) or ScorePattern.patternKey (patterns). A rule takes this from its own
   *  catalogue entry (`ENTRY.key`), never from a re-typed literal. */
  key: FiredFindingKey;
  /** Red flags: "critical". Patterns: the family-native severity token — E-patterns use
   *  red/amber/green, structural cards use high/medium/low/recovery. */
  severity: string;
  /** Pattern polarity (positive/negative); null/absent for red flags. */
  direction?: "positive" | "negative" | null;
  /** Pattern effective score impact. Null for red flags AND for the structural cards, which carry no
   *  §5E magnitude. A dampened pattern stores the HALVED value. */
  magnitude?: number | null;
  displayState?: FindingDisplayState; // patterns; defaults "active"
  /** RULE polarity, published on the fired instance (Amendment §1). */
  polarity?: Polarity;
  /** Amendment §2.4 temporal class. Not persisted — an in-code legibility marker. */
  temporalClass?: TemporalClass;
  /** UI-facing evidence JSON — the breaching stat(s) for the verdict sentence. */
  evidence: Record<string, unknown>;
}
