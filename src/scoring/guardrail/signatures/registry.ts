// File: src/scoring/guardrail/signatures/registry.ts
//
// THE SIGNATURE REGISTRY. Declares the COMPLETE Phase-1 set (10 non-financial + the
// 5 banking variants the rulebook §4 table lists) so the gate is structurally aware
// of every signature, while exactly ONE is implemented now (A-2). The other entries
// are `built: false` placeholders carrying their category/tier/outcome/path so the
// gate routes correctly and a later build drops the implementation in WITHOUT
// touching the gate. (Per the prompt: build the structure so all signatures plug in;
// wire one.)

import type { Signature, SignatureKey, SignatureCategory, Tier, Outcome } from "../types.js";
import { a1StaleResults } from "./a1-stale-results.js";
import { a2MissingFields } from "./a2-missing-fields.js";
import { a3InsufficientHistory } from "./a3-insufficient-history.js";
import { a4Inactive } from "./a4-inactive.js";
import { b1ExceptionalGain } from "./b1-exceptional-gain.js";
import { b2ExceptionalLoss } from "./b2-exceptional-loss.js";
import { b3TaxDistortion } from "./b3-tax-distortion.js";
import { b4OtherIncome } from "./b4-other-income.js";
import { b5HoldcoExtraction } from "./b5-holdco-extraction.js";
import { c1StructuralStep } from "./c1-structural-step.js";
import { c2ShareCount } from "./c2-share-count.js";

/** A registry entry. `signature` is set only when `built`. `defaultOutcome` is the
 *  rulebook's primary outcome (documentation; the live signature decides per firing). */
export interface SignatureDescriptor {
  key: SignatureKey;
  category: SignatureCategory;
  tier: Tier;
  defaultOutcome: Outcome;
  /** Pillars this signature runs for. Banking variants run for "banking" only and
   *  non-financial B-1…B-4 run for "non_financial" only (§2B routing). Category A &
   *  C-2 run for both. */
  paths: ("non_financial" | "banking")[];
  built: boolean;
  signature?: Signature;
}

const BOTH: ("non_financial" | "banking")[] = ["non_financial", "banking"];
const NONFIN: ("non_financial" | "banking")[] = ["non_financial"];
const BANK: ("non_financial" | "banking")[] = ["banking"];

export const SIGNATURE_REGISTRY: SignatureDescriptor[] = [
  // ── Category A (data integrity) — run for ALL paths ──
  { key: "A-1", category: "A", tier: "auto", defaultOutcome: "O5", paths: BOTH, built: true, signature: a1StaleResults }, // O5 hold; >2Q → O6 remove
  { key: "A-2", category: "A", tier: "auto", defaultOutcome: "O2", paths: BOTH, built: true, signature: a2MissingFields },
  { key: "A-3", category: "A", tier: "auto", defaultOutcome: "O3", paths: BOTH, built: true, signature: a3InsufficientHistory }, // doc "O2" = lens fallback → surfaced as O3 (see file)
  { key: "A-4", category: "A", tier: "auto", defaultOutcome: "O6", paths: BOTH, built: true, signature: a4Inactive }, // detect-auto, removal operator-confirm
  // ── Category B (non-financial accounting distortion) — non_financial ONLY (§2B) ──
  { key: "B-1", category: "B", tier: "auto", defaultOutcome: "O2", paths: NONFIN, built: true, signature: b1ExceptionalGain },
  { key: "B-2", category: "B", tier: "auto", defaultOutcome: "O2", paths: NONFIN, built: true, signature: b2ExceptionalLoss },
  { key: "B-3", category: "B", tier: "auto", defaultOutcome: "O3", paths: NONFIN, built: true, signature: b3TaxDistortion }, // O3; O2 on band-flip
  { key: "B-4", category: "B", tier: "auto", defaultOutcome: "O3", paths: NONFIN, built: true, signature: b4OtherIncome }, // O3; O2 on band-flip
  { key: "B-5", category: "B", tier: "review", defaultOutcome: "O3", paths: BOTH, built: true, signature: b5HoldcoExtraction }, // REVIEW; applies to promoter-group NBFCs too
  // ── Category C (structural) — built against the proven O4 consumer ──
  { key: "C-1", category: "C", tier: "review", defaultOutcome: "O4", paths: BOTH, built: true, signature: c1StructuralStep }, // O4+O3; bank asset-base variant shares the key (reads advances/deposits — not built)
  { key: "C-2", category: "C", tier: "auto", defaultOutcome: "O1", paths: BOTH, built: true, signature: c2ShareCount }, // bonus/split → O1 auto; rights → O3 review (dynamic result.tier)
];

/** The descriptors for signatures that should RUN for a stock on `path` and are
 *  built. (Banking B-Bank variants reuse the B-* / C-1 keys with bank detection — a
 *  later build swaps the implementation by path; the gate filtering is path-aware.) */
export function applicableBuiltSignatures(path: "non_financial" | "banking"): SignatureDescriptor[] {
  return SIGNATURE_REGISTRY.filter((d) => d.built && d.paths.includes(path));
}

/** Coverage summary for the audit/flags: built vs declared. */
export function registryCoverage(): { built: SignatureKey[]; declared: SignatureKey[] } {
  return {
    built: SIGNATURE_REGISTRY.filter((d) => d.built).map((d) => d.key),
    declared: SIGNATURE_REGISTRY.filter((d) => !d.built).map((d) => d.key),
  };
}
