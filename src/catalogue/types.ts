// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CATALOGUE — ONE entry type, SEVERAL registries. (Stage 1)
//
// ── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────────────────────────────
// Every piece of static, rule-level product copy — the name of a finding, what it means, what it does
// NOT mean — had FOUR homes, and the two that mattered most were on the wrong side of the wire:
//
//   stock findings   FRONTEND ONLY (lib/findings/*, lib/n-family-copy.ts)  ← the chat cannot reach it
//   lens faces       backend (scoring/lens-patterns/catalog.ts)
//   PHS findings     backend (portfolio/phs/copy.ts)
//   guardrail sigs   NOWHERE — the copy did not exist at data level at all
//
// A backend chat asked "what does 'Accruals Divergence' mean?" could not answer from the product's own
// words, so it invented product limitations. That is the defect. This module is the one home; the
// frontend becomes a CONSUMER of it over HTTP.
//
// ── ★ ONE ENTRY TYPE, FOUR VARIANTS — AND THAT IS NOT A COMPROMISE ────────────────────────────────
// The four registries have genuinely DISTINCT key namespaces and DISTINCT shapes. A stock finding has
// a family and a Hub concern; a lens face has a tone and a field-verdict; a guardrail signature has a
// category; a PHS finding has a doesntMean-job and a lifetime. Flattening them would mean four fields
// optional on every entry — and an optional copy field is exactly the hole this module exists to close.
//
// So `CatalogueEntry` is ONE type: a DISCRIMINATED UNION on `registry`. Each variant declares exactly
// the copy its domain guarantees, ALL OF IT REQUIRED. There is no variant in which a description is
// optional, and no variant in which the boundary line is optional. A half-written entry does not
// typecheck — see verify-catalogue.ts §2 for the compiler proving it.
//
// ── THE ONE UNIVERSAL FIELD IS `doesntMean`, AND THE HOUSE ALREADY DECIDED THAT ───────────────────
// portfolio/phs/copy.ts: "REQUIRED. A finding without a Doesn't-mean does not ship — asserted in CI,
// not noticed in review." Every variant below inherits it from EntryBase, so that rule now spans all
// four registries rather than one.
//
// ── ⚠ WHY THE PHS VARIANT CARRIES NO `description` ────────────────────────────────────────────────
// Because PHS copy has none, and inventing one here would be authoring, not moving. `FINDING_COPY`
// carries `doesntMean` + `job`; a PHS finding's Read is COMPOSED in patterns.ts from live bindings and
// its label is a literal at each push site. The PHS registry therefore registers what PHS copy IS.
// Requiring a field the source does not have would force 40 fabricated sentences — the precise failure
// this module is built to prevent. Its own gate (scripts/verify-phs-copy.ts) is unchanged and still
// authoritative for that library.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { PatternFacts } from "./pattern-facts.js";

/** The four namespaces. A key is only ever meaningful WITHIN one of them — `LM3` is a lens face and
 *  `PC3` is a portfolio finding and neither is a stock finding, so they are never compared. */
export type RegistryId = "stock_finding" | "lens_face" | "guardrail_signature" | "phs_finding";

/**
 * Whether a catalogue key can still arrive on a payload — and therefore whether the Stage-6 CI check
 * may demand an emitter for it.
 *
 *   live            a rule/persist path emits it today. CI: entry ⇔ emitter, both directions.
 *   dormant         registered and copy-bearing, but not currently firing anywhere in the live data.
 *                   ★ COPY IS STILL MANDATORY. Historical rows carry the key and still render; a
 *                   dormant key with no copy is a title-only card on a page nobody thinks to check.
 *   synthesised     never emitted by any rule — composed by the READ layer (divergence_consolidated).
 *                   CI exempts it from the emitter check BY NAME, never by a wildcard.
 *   never_emitted   a real entry — real copy, real facts — that no rule and no read-layer composition
 *                   EVER produces as a fired finding. S1 (Aligned) is the one member: it is a tool
 *                   state the divergence tool reads directly (findings/divergence/aligned.ts), never
 *                   persisted to score_patterns. Distinct from `synthesised` (which IS composed, from
 *                   other findings, by the read layer) and from `dormant` (a registered rule that
 *                   COULD fire and simply hasn't recently) — S1 has no rule at all to fire it. The
 *                   emitter-reconciliation gate (verify-catalogue.ts §4) reads THIS FIELD to decide
 *                   whether a catalogued-but-unemitted key is explained, rather than hand-listing keys
 *                   itself — a status the gate did not know about would fail loud, not silently pass.
 *
 * RETIRED keys (P2 → R6, P3 → R1) are NOT a status: they are ABSENT. A deregistered rule cannot fire
 * again, so carrying copy for it would be carrying a lie. alerts/finding-catalog.ts takes the same
 * line — it recognises them only to refuse them.
 */
export type KeyStatus = "live" | "dormant" | "synthesised" | "never_emitted";

// ── stock findings (Master Spec XII–XIII · StockPage Rules Spec §5 · Family N Amendment) ───────────

/** File 1 §5 families A→I, plus N (Notable — constructive mirrors, display-only). */
export type FindingFamily = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "N";

/** Health Hub → Flags & Patterns bucketing. "trajectory" is the fourth bucket the structural
 *  cards (B/C/D/F/G/I) are assigned to so they reach the board instead of being orphaned. */
export type FindingConcern = "ownership" | "fundamentals" | "momentum" | "trajectory";

interface EntryBase<R extends RegistryId> {
  readonly registry: R;
  /** Identity WITHIN this registry's namespace. */
  readonly key: string;
  /** ★ THE ONE UNIVERSAL REQUIREMENT. The interpretive boundary — what the reader must not conclude.
   *  Never empty, never optional, in any registry. */
  readonly doesntMean: string;
}

export interface StockFindingEntry extends EntryBase<"stock_finding"> {
  /** Canonical display title. */
  readonly name: string;
  /** Static, rule-level: "what this pattern means". Renders on evidence-free surfaces (Hub census,
   *  peer-group pathology) where a per-stock verdict cannot. */
  readonly description: string;
  readonly family: FindingFamily;
  readonly concern: FindingConcern;
  readonly status: KeyStatus;
  /**
   * ★ THE FINDING-DEFINING FACTS — which pillars, what threshold, what the regime does, how many
   * decimals. See pattern-facts.ts for why they are declared rather than derived.
   *
   * ── ⚠ NEVER NULL. IT USED TO BE, FOR 35 OF THE 53. ───────────────────────────────────────────────
   * The old declaration was `PatternFacts | null`, non-null only for the studied divergence (S1,
   * D1–D7, S2) and trajectory (T1–T9) patterns. The reasoning was sound as far as it went — a red flag
   * has no pillar pair, no gap floor and no regime map, and inventing one would author a fact rather
   * than move it.
   *
   * But it read the absence too widely. R1 has no REGIME MAP; it does have two bars (50% of the
   * promoter holding, +10pp in a quarter) and a display precision, and those had nowhere to live —
   * so they sat as bare `export const`s in pledging.ts, and R1 shipped as the one rule of 53 with no
   * declared precision, stamping 51.367518980187285 where every sibling stamped a rounded number.
   *
   * So the shape is a union, not a nullable: {@link UnmeasuredFacts} carries what EVERY finding has,
   * and PatternFacts extends that with what only a STUDIED one has. Absence is still expressible —
   * an unmeasured record simply has no `evidenceStats` field to fill in — but it is now the absence
   * of a study, not the absence of a record.
   *
   * ⚠ The REGISTRY type narrows this per key (see stock-findings.ts's StockFindingRegistry): a rule
   * reading `STOCK_FINDINGS.divergence_S2_sticky_divergence.facts.gapFloor` gets a `number` with no
   * null-check, and `STOCK_FINDINGS.ownership_R1_pledge.facts.gapFloor` is a COMPILE ERROR while
   * `.facts.thresholds.pledgeRatioPct` is a `number`. That narrowing IS the compile-time binding;
   * this widened declaration is the shape a generic consumer sees.
   *
   * ⚠ PARTIALLY SERVED. serialise.ts narrows this to `{ pillarPair, basis, displayPrecision }`
   * (pattern-facts.ts's `ServedPatternFacts`) before the document is built — display geometry a chart
   * needs, never a threshold. Every gapFloor / movementFloor / evidencedTier / leg value /
   * sustainReadings / regimeMap / evidenceStats / thresholds bag is a scoring bar and stays
   * engine-side only.
   */
  readonly facts: PatternFacts | UnmeasuredFacts;
}

/**
 * ★ THE FACTS EVERY FINDING HAS, studied or not — the universal half of the record.
 *
 * Declared HERE rather than in finding-facts.ts because `StockFindingEntry` above references it and
 * finding-facts.ts imports this module's siblings; homing the interface with the entry it belongs to
 * keeps the catalogue's type graph acyclic. The VALUES (all 53 records) live in finding-facts.ts.
 */
export interface UnmeasuredFacts {
  /** THE only precision this finding's numbers are formatted at, unless a specific evidence key
   *  overrides it — see catalogue/evidence-facts.ts. */
  readonly displayPrecision: number;
  /**
   * The rule's own bars, by name: `{ pledgeRatioPct: 50, qoqRisePp: 10 }`.
   *
   * ⚠ A NAMED BAG rather than typed fields because the 35 unmeasured findings do not share a bar
   * SHAPE the way the studied families do — R4 fires on a debt multiple, N6 on a count of quarters,
   * H on a rupee value. See finding-facts.ts's header for why a union wide enough to type all of
   * them would be all-nullable and therefore worse than this.
   *
   * `{}` is a real record: P1 and P4 declare no bars of their own (both read the shared ownership
   * flow helpers, which own their materiality floors). It is not "we have not filled this in".
   */
  readonly thresholds: Readonly<Record<string, number>>;
}

export interface LensFaceEntry extends EntryBase<"lens_face"> {
  /** §4 faces-table label (VERBATIM) — the card name. */
  readonly name: string;
  /** §2/§3 "Read" face (VERBATIM) — this registry's description. */
  readonly description: string;
  /** §4 tone token (VERBATIM). */
  readonly tone: string;
  readonly fieldVerdict: "PG_WEAK" | "PG_STRONG" | null;
  /** Does this face escalate to a top-level finding card (LM3/LM7/LP2/LP5), or stay a quiet pillar-
   *  breakdown pill? Both need copy; only the loud four ever compose a `lens_*` finding key. */
  readonly escalates: boolean;
}

/**
 * ★ 0c · Is this signature actually evaluated? DERIVED from GUARDRAIL_BEHAVIOUR (`isEvaluable`),
 * never authored — the same discipline as `consequence` below.
 *
 *   active       the gate routes to it; it can fire and write its audit event.
 *   not_running  behaviour is `disabled`: it is skipped BEFORE evaluate() is called. It cannot fire,
 *                cannot write an event, and costs nothing. A-1, A-4 and C-2 are here today.
 *
 * ⚠ WHY THIS FIELD EXISTS AT ALL. Copy that describes a check as operating when the check is never
 * run is the same class of untruth as a methodology page describing nine pillars when four are
 * computed. The description says what the signature LOOKS FOR — which is true whether or not it runs.
 * This says whether it is looking.
 */
export type GuardrailStatus = "active" | "not_running";

export interface GuardrailSignatureEntry extends EntryBase<"guardrail_signature"> {
  readonly name: string;
  /**
   * ⚠ QUALITATIVE BY MANDATE — describes the SHAPE the signature detects, never the threshold that
   * detects it. Guardrail signatures catch gamed or distorted reporting; publishing "> 100% YoY with
   * OPM flat within ±3pp" tells a company exactly how to structure to stay under the bar.
   *
   * This is deliberately NOT the rule applied to the nine A/E finding descriptions that DO name their
   * trigger (pledge over half, D/E past 3×). Those bars sit on filed public data and cannot be gamed
   * by restructuring a disclosure. Do not harmonise the two.
   *
   * ★ 0a · SHAPE ONLY — NO CONSEQUENCE. What the detection DOES to a score is not authored here; see
   * `consequence`. A hand-written consequence clause is a claim about a live contract sitting in a
   * string nobody re-reads when the contract changes.
   */
  readonly description: string;
  /**
   * ★ 0b · GENERATED FROM GUARDRAIL_BEHAVIOUR AT READ TIME. Never authored, never stored.
   *
   * GUARDRAIL_BEHAVIOUR is already compile-total over SignatureKey and is already the single source
   * of truth for what a signature may do to a score — enforced structurally on the KEY, so a
   * signature cannot acquire suppression power by changing its own return value. Deriving the
   * sentence from it means the copy CANNOT disagree with the contract: the day B-1 moves back into
   * the suppress set, its sentence changes in the same commit, with nobody remembering to edit it.
   *
   * The authored alternative was tried and is exactly what 0a removed: eleven descriptions asserting
   * that readings "stand down" and comparisons are "withheld", written against a system whose
   * suppress set is EMPTY.
   */
  readonly consequence: string;
  /** ★ 0c · Derived from `isEvaluable`. See {@link GuardrailStatus}. */
  readonly status: GuardrailStatus;
  readonly category: "A" | "B" | "C";
}

export interface PhsFindingEntry extends EntryBase<"phs_finding"> {
  /** What the doesntMean sentence is FOR (phs/copy.ts's required classification, carried through). */
  readonly job: readonly string[];
  /** persisted → frozen into fired_findings with the book's snapshot.
   *  read_time → PD/PE6/PI: a fact about VYTAL or about a live value, never eligible for the snapshot. */
  readonly lifetime: "persisted" | "read_time";
}

/** THE entry type. One name, four shapes, zero optional copy fields in any of them. */
export type CatalogueEntry =
  | StockFindingEntry
  | LensFaceEntry
  | GuardrailSignatureEntry
  | PhsFindingEntry;

/** A registry is TOTAL over a closed key union: a key with no entry is a compile error, not a runtime
 *  blank. Same discipline as GUARDRAIL_BEHAVIOUR (scoring/guardrail/signatures/registry.ts) and
 *  DOESNT_MEAN (the family map) — both of which state it explicitly and both of which hold. */
export type Registry<K extends string, E extends CatalogueEntry> = Readonly<Record<K, E>>;
