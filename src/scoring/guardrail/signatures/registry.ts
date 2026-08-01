// File: src/scoring/guardrail/signatures/registry.ts
//
// THE SIGNATURE REGISTRY. Declares the COMPLETE Phase-1 set (10 non-financial + the
// 5 banking variants the rulebook §4 table lists) so the gate is structurally aware
// of every signature. ALL ELEVEN ARE BUILT (`built: true`) — A-1…A-4, B-1…B-5, C-1,
// C-2 each have a real implementation in ./; none is a placeholder.
//
// ⚠ WHAT `built` DOES NOT MEAN. `built: true` says an implementation exists and the
// gate will route to it. It says NOTHING about whether that signature is allowed to
// change a score. THAT is GUARDRAIL_BEHAVIOUR (below) — the live contract. Read the
// behaviour map, not `built`, to answer "can this signature move a number?".

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

// ═══════════════════════════════════════════════════════════════════════════════
// THE LIVE BEHAVIOUR CONTRACT — what a signature is ALLOWED to do to a score
// ═══════════════════════════════════════════════════════════════════════════════
//
// `built` (above) says an implementation exists. THIS says what it may do. The two
// are deliberately separate: a signature can be fully built, fire correctly, write
// its audit event — and still be structurally incapable of moving a number.
//
//   suppress  — full directive application. Its O2/O4 rows reach the suppression
//               predicate and change own-score and/or peer μ/σ.
//   annotate  — event written, directives DISCARDED. Cannot alter any score.
//   detect    — event + pending review written, directives DISCARDED. Cannot alter
//               any score. No workflow exists to resolve these; they accumulate as
//               a deliberate backlog (see docs — B-5/C-1 review workflow is not built).
//   disabled  — NOT EVALUATED AT ALL. Skipped before evaluate() is called, so it
//               cannot fire, cannot write an event, and costs nothing.
//
// ⚠ ENFORCEMENT IS STRUCTURAL, NOT BY TRUST. The filter runs on the SIGNATURE KEY
// (applyBehaviour, ../behaviour.ts) — NOT on the outcome a signature happens to
// return. If B-3 were changed tomorrow to return O2 instead of O3, it would STILL
// be incapable of suppressing, because "B-3" is not in the suppress set. A signature
// cannot silently acquire suppression power by changing its own return value; that
// requires editing this map, which is the point.
//
// TOTALITY: `Record<SignatureKey, …>` is exhaustive. Adding a member to the
// SignatureKey union without adding it here is a COMPILE ERROR ("Property 'X-1' is
// missing"), never a silent default. Same discipline as phs/copy.ts FINDING_COPY.
export type GuardrailBehaviour = "suppress" | "annotate" | "detect" | "disabled";

export const GUARDRAIL_BEHAVIOUR: Record<SignatureKey, GuardrailBehaviour> = {
  // ── SUPPRESS — may change scores ──
  //    EMPTY. Nothing suppresses today: the layer ships as detection + audit trail
  //    only, with provably zero score impact. See the A-2/B-1/B-2 notes below for
  //    why each was moved out, and what must exist before any of them moves back.
  //
  // ── ANNOTATE — event written, directives discarded, never a score change ──
  "A-2": "annotate", // Missing critical fields → O2 {F1,F2,F4,F7}. INERT BY CONSTRUCTION:
  //                    its affectedMetrics map is a SUBSET of the metrics that are already
  //                    uncomputable from the same null fields (verified against every null
  //                    guard in metrics/foundation.ts), so it can never suppress a
  //                    COMPUTABLE metric — the live dry run applied 4 directives and moved
  //                    0 composites. Its only live effect was leaking the raw string
  //                    "guardrail O2" into the health-tab caption and the LLM grounding
  //                    block (health-view.service.ts re-derives state from the mere
  //                    EXISTENCE of a directive row). Zero protection, non-zero blast
  //                    radius ⇒ annotate.
  "A-3": "annotate", // history depth: the engine ALREADY does the lens-3/baseline
  //                    fallback (wire.ts l3MinN, ownership/baseline.ts). Wiring the
  //                    suppression would DOUBLE-count it. Surface only.
  "B-1": "annotate", // Exceptional gain → O2 {F1,F2,M2,M4}. ⚠ MOVED OUT OF SUPPRESS after
  //                    the Stage-3 dry run: on HINDPETRO it suppressed M2 (scored), taking
  //                    Momentum to 2/5 present — through the §14.4 floor — which DELETED the
  //                    pillar, redistributed its 25% weight, and RAISED the composite
  //                    59.29→68.20 (below_par→healthy). A signature for catching inflated
  //                    profit upgraded the inflating stock. The principled fix is
  //                    floor-aware escalation to O5 Hold (A-2 already has that shape), but
  //                    O5 is a dead end — no orchestrator consumes hold/remove — so there
  //                    is no protection to escalate INTO. Do not restore to suppress until
  //                    O5 is real AND B-1/B-2 test the floor before emitting O2.
  "B-2": "annotate", // Exceptional loss → O2 {F2,M2,M4}. Same missing floor-guard as B-1;
  //                    fired on nothing live, so this is pre-emptive, not a fix.
  "B-3": "annotate", // returns O3 today; O2 needs bandFlipDetected (2nd pass, not built)
  "B-4": "annotate", // same forward-dependency as B-3
  // ── DETECT — event + pending review, never applied (no resolution workflow) ──
  "B-5": "detect", // review-tier by design; upheld would only ANNOTATE anyway
  "C-1": "detect", // review-tier; proposed O4 peer-only exclusion held pending ruling
  // ── DISABLED — never evaluated ──
  "A-1": "disabled", // no stored "expected filing date" exists; nothing valid to trigger on
  "A-4": "disabled", // no live isActive/price-gap screening decision taken yet
  "C-2": "disabled", // CorporateEvent.split_ratio is ~100% null for equities (events-guards.ts)
};

/** May this signature's directives reach the suppression predicate? */
export const canSuppress = (key: SignatureKey): boolean => GUARDRAIL_BEHAVIOUR[key] === "suppress";

/** Should this signature run at all? `disabled` ⇒ never evaluated (not evaluated-then-discarded). */
export const isEvaluable = (key: SignatureKey): boolean => GUARDRAIL_BEHAVIOUR[key] !== "disabled";

/** Keys grouped by behaviour — for the run log / audit reporting. */
export function behaviourGroups(): Record<GuardrailBehaviour, SignatureKey[]> {
  const out: Record<GuardrailBehaviour, SignatureKey[]> = { suppress: [], annotate: [], detect: [], disabled: [] };
  for (const [k, b] of Object.entries(GUARDRAIL_BEHAVIOUR) as [SignatureKey, GuardrailBehaviour][]) out[b].push(k);
  return out;
}
