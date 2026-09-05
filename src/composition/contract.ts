// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CONTRACT 3 — `Composition`. Architecture spec §5.
//
// ── ⚠ ONE DELIBERATE DIVERGENCE FROM §5's SHAPE, AND THE REASON ───────────────────────────────────
// §5 declares `SectionSpec.resolver: ResolverId` — a STRING, looked up in a registry. §5.1 then asks
// the build to guarantee that (1) the id names a real resolver and (2) its output satisfies
// `PayloadFor<kind>`. A string cannot carry either guarantee: both become runtime lookups, and "a
// broken composition fails the build, not the user" degrades to "fails the user slightly earlier".
//
// So a section step is a TYPED BUILDER — a function returning `Section<K, P>`. The three guarantees
// then hold by construction rather than by gate:
//
//   1. the resolver is real          it is called, so a wrong name is a compile error
//   2. payload satisfies the kind    `Section<K, P>` is the return type
//   3. renderer ∈ RENDERERS[kind]    already enforced by `RendererFor<K>` (stage 3)
//
// The array stays ORDERED and declarative — the flow is still read off the file top to bottom — so
// §5.2 and the extensibility test are unaffected. Reported as a §5 correction, not absorbed.
//
// Guarantee 4 ("every reader-facing string is a registry key") is NOT enforced here and cannot be by
// types alone: a `string` is a `string`. It is enforced where it already is — the copy registers and
// `reasonPhrase`, which every section this repo ships routes its absent text through.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Coverage } from "../resolve/contract.js";
import type { Section, SectionKind } from "../section/contract.js";
import type { LensSlot, OperationSlot, RouterOutput, RoutedTurn } from "../router/contract.js";
import type { ToneDirective } from "../ai/tone.js";
import type { ProseLink } from "./vytal-routes.js";

/** Any built section, kind erased — what a composition returns and a transport serialises. */
export type AnySection = Section<SectionKind, unknown>;

/** What a composition is handed. No model, no prompt — a composition is deterministic by construction. */
export interface ComposeContext {
  readonly turn: RoutedTurn;
  /**
   * The FIRST STOCK subject's symbol, or `null`. A convenience projection of `turn.subjects` kept
   * because most compositions are single-stock by nature.
   *
   * ⚠ IT IS NOT "THE SUBJECT". A comparison has two and this shows one; a reader-only or
   * instrument-only turn has a subject while this is `null`. A composition that needs to know what
   * it is actually looking at reads `turn.subjects`.
   */
  readonly symbol: string | null;
  /**
   * The authenticated reader, when there is one. From the request — never from the model, never
   * parsed out of the question. `null` in an unauthenticated or offline composition, and every
   * reader-scoped read must treat that as "cannot answer", not as "empty book".
   */
  readonly reader: { readonly userId: string } | null;
  /** The reader's resolved tone. See §7.6 — a product preference, not a model decision. */
  readonly tone: ToneDirective;
}

/**
 * Whether this composition can answer this turn. Pure and synchronous over SLOTS — never over data,
 * because a predicate that reads the database has already paid for the composition it may reject.
 * Data-dependent gating belongs on the section (`when`) or the depth floor.
 */
export interface Predicate {
  readonly operation: readonly OperationSlot[];
  /**
   * Which lenses this family claims. Omitted ⇒ ANY lens, including none.
   *
   * ★ `null` IS A MEMBER, AND THAT IS A §5 AMENDMENT — RAISED, NOT ABSORBED (stage 5b).
   *
   * `lens: null` on a turn means the reader narrowed NOTHING — "how is TCS doing" against "how is
   * TCS's ownership". Before this, a predicate could say "only the ownership lens" but could not say
   * "only the un-narrowed question", because an omitted `lens` reads as "any". That is exactly the
   * distinction `orientation.company` is built on: its own header says a general question takes
   * `lens: null` and gets the whole company, and a narrowed one gets the specific family. Without
   * `null` as a member, registering it would have it swallow every `orient` turn including
   * `lens: "price"` — reproducing the conflation that header documents fixing.
   */
  readonly lens?: readonly (LensSlot | null)[];
  /** Minimum coverage tier of the resolved subject. */
  readonly minTier?: 0 | 1 | 2;
  /** Minimum quarters held. A composition that draws a trend declares one (§3.3). */
  readonly depthFloor?: number;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★ A THREE-WAY, AND IT REPLACES `requiresSubject: boolean` — §5 EXTENSION, PHASE 1 · BATCH 1.
   *
   * ⚠ THE BOOLEAN COULD SAY "I NEED A COMPANY" AND COULD NOT SAY "I AM THE ANSWER TO THE QUESTION
   *   THAT NAMES NONE", and OA needs exactly the second. The miss-log's one genuine reader row —
   *   *"what has changed in promoter holdings this quarter"* — resolves no subject by design: it is a
   *   question about the universe. `ownership.movers` answers it, and under the boolean it would have
   *   been written `requiresSubject: false`, which reads as "either" — so it would ALSO have claimed
   *   every ownership question that DID name a company, and answered "who owns TCS" with a market
   *   cross-section. That is §6.2's confident-wrong-artifact, arriving through the predicate.
   *
   * ⚠ AND ORDERING THE REGISTRY AROUND IT WAS THE ALTERNATIVE, AND IT IS THE WRONG ONE. Putting the
   *   subject-ful composition first works — it is skipped when no symbol resolved — and it makes the
   *   answer to a reader's question depend on the order of an array, with nothing in either
   *   composition saying so. A silent order dependency is precisely the class of defect this build
   *   keeps removing; the fix is for the predicate to be able to say what it means.
   *
   *   `required` a resolved subject is needed · `none` this composition is FOR the subjectless
   *   question · `any` either (the old `false`, now spelled).
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  readonly subject: "required" | "none" | "any";

  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★ A PURE GUARD OVER THE SENTENCE — §5 EXTENSION, PHASE 2 · BATCH 1. Same class of extension as
   *    `subject` in batch 1, and raised for the same reason: the predicate could not say what it
   *    meant.
   *
   * ⚠ TWO FAMILIES CAN SHARE EVERY SLOT AND STILL BE DIFFERENT ANSWERS. T · Trajectory and
   *   A · Attribution both claim `{orient, health, required}` — "how has TCS's score moved" and "why
   *   is TCS scored that way" are the same operation, the same lens and the same subject. Without
   *   this field, which one a reader got was decided by position in the `COMPOSITIONS` array, with
   *   nothing in either file saying so. Measured before this existed: "what is dragging TCS's score
   *   down" was answered with a phase chart and no decomposition.
   *
   * ★ IT IS STILL PURE AND SYNCHRONOUS, WHICH IS THE RULE THIS FIELD HAD TO NOT BREAK. The raw
   *   question is part of the TURN, not part of the data — reading it costs no query and cannot
   *   depend on what we hold. The prohibition in this interface's own header is on predicates that
   *   READ DATA, because a predicate that queries has already paid for the composition it may
   *   reject. This one reads a string the caller already has.
   *
   * ⚠ AND IT MUST COME FROM A TOTAL, SINGLE-HOME CLASSIFIER — see `router/question-shape.ts`. Two
   *   families guarding one boundary with two independent lambdas is two definitions of one rule,
   *   and the day they drift a question matches both or neither. `healthQuestion()` returns one of
   *   two values and each family tests for its own, so they are disjoint AND total by construction
   *   and the registry's order stops deciding anything. `verify-answer-invariants.ts` asserts that.
   *
   * Omitted ⇒ the family accepts any sentence its slots match, which is what every family before
   * this batch meant.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  /**
   * ⚠ IT TAKES THE SLOTS AS WELL AS THE SENTENCE, FROM PHASE 3 — because a guard that could only see
   *   the words blocked a route the words could not carry. PT's `findingsAsked` exists to stop the
   *   family over-claiming `explain`/`lookup` with no lens; applied to `list_findings` — an operation
   *   NOTHING else claims and which means "what has code flagged" — it blocked a bare "why" following
   *   a findings answer, which is exactly the referent MT is for. The sentence is "why" and carries no
   *   signal by design.
   *
   * ★ STILL PURE AND SYNCHRONOUS, AND STILL NOT A DATA READ. The router output is part of the turn.
   */
  readonly question?: (raw: string, router: RouterOutput) => boolean;
}

/** One assertion, run by the eval in the SAME file as the family it covers (§5.2). */
export interface Assertion {
  readonly name: string;
  /** Given the sections this composition produced, is it correct? Returns null on pass. */
  readonly check: (sections: readonly AnySection[]) => string | null;
}

export interface Composition {
  readonly id: string;
  readonly family: string;
  readonly when: Predicate;
  /** ORDERED. This is the flow.
   *  ★ RETURNS PROSE AS WELL AS SECTIONS. §4.5 makes the lead sentences and the conclusion part of the
   *  answer, not decoration a caller adds afterwards — a composition that returned only sections would
   *  leave every transport to re-derive the words, which is two homes for one voice (N-5). */
  readonly build: (ctx: ComposeContext) => Promise<ComposedAnswer>;
  /** ★ Trigger phrases. These feed the router AND the eval, so a family the router learns is a family
   *  the eval covers — in the same commit. ⚠ AUDIT BEFORE INGESTING: the question bank has stale
   *  entries (DX-01 claims four HDFC candidates; live there are three). An example is routing DATA. */
  readonly examples: readonly string[];
  readonly assertions: readonly Assertion[];
}

/**
 * ── ★ §4.3 AS AMENDED BY THE OPERATOR, 2026-08-30 (stage 9) ───────────────────────────────────────
 *
 * The original rule was "2–4 connective sentences", and it was built as **structure INSTEAD OF
 * prose**. The browser pass shows what that produces:
 *
 *     "Across the 84% of your book we can read, it comes out fragile."   …then a table.
 *
 * Nothing says why it is fragile, what fragile means here, or which holdings drag it. The reader is
 * handed a verdict and a grid and left to join them.
 *
 *   ★ **PROSE CARRIES THE REASONING; SECTIONS CARRY THE EVIDENCE. THEY INTERLEAVE.**
 *
 * A section is not a caption with a component under it. `leads` frames what is coming; `after` says
 * what it showed and why it matters. Together they are the argument, and the components are what the
 * argument is checkable against.
 *
 * ⚠ N-1 IS UNTOUCHED, AND THIS IS THE LINE THAT MOVES NOTHING. Every figure still comes from the
 *   digest and the model still writes no number. What changed is how MUCH the model is asked to say
 *   about figures it is shown but may not restate — not whether it may state them.
 */
export interface AnswerProse {
  readonly opening: readonly string[];
  /**
   * Keyed `KIND:renderer`, or `KIND:renderer#i` where `i` is the section's index.
   *
   * ⚠ THE INDEXED FORM EXISTS BECAUSE THE PLAIN ONE SILENTLY COLLIDES, AND THIS COMMENT USED TO
   *   CLAIM THE OPPOSITE — "so a family with two DECOMPOSITIONs can lead each one differently". It
   *   could not: two sections of the same kind and renderer produce the same key, so the second
   *   simply overwrote the first, and both then rendered under one sentence. Found live the moment
   *   the comparison grew a second `RELATIVE:opposed-bars` (stage 9), which is the first answer in
   *   the system to have two of anything.
   *
   *   The renderer resolves `KIND:renderer#i` first, then `KIND:renderer`, then `KIND` — so a
   *   composition that does not care keeps the short key and nothing else moves.
   */
  readonly leads: Record<string, string>;
  /**
   * ★ WHAT THE SECTION ABOVE SHOWED, AND WHY IT MATTERS — the second half of the amendment.
   *
   * Same keying as `leads`. Optional per section and deliberately so: a component that speaks for
   * itself needs no epilogue, and a paragraph after every single section is padding rather than
   * reasoning. It is for the ones where the figures carry a conclusion the reader would otherwise
   * have to derive.
   */
  readonly after: Record<string, string>;
  readonly close: string;
  /**
   * ★ WHERE THIS ANSWER CONTINUES INSIDE VYTAL — added at stage 12.
   *
   * Code-built from the same slots that chose the sections (composition/vytal-routes.ts) and
   * attached once, centrally, at the end of `composeTurn`. ⚠ NEVER MODEL-EMITTED: a model asked for
   * a link writes a plausible one, and a plausible dead link inside a correct answer is an invented
   * figure by another name.
   *
   * Optional, and absent on every row written before stage 12 — a replayed answer that predates it
   * renders exactly as it did.
   */
  readonly links?: readonly ProseLink[];
}

export interface ComposedAnswer {
  readonly sections: readonly AnySection[];
  readonly prose: AnswerProse;
  /**
   * ★ WHICH VARIANT OF ITS FAMILY THIS ANSWER IS — §5 EXTENSION, PHASE 1 · BATCH 1. Optional, so
   *   every composition written before it is unaffected.
   *
   * ⚠ IT EXISTS SO THE SPLIT IS MEASURABLE, WHICH IS THE ONLY REASON TO HAVE MADE ONE. OA answers
   *   four different questions under one lens (register · flow · dealing · pledging) chosen by a
   *   code-extracted focus, not by slots — so `Composition.id` is one string for four answers. With
   *   only the id, the miss-log and the /ask diagnostic cannot tell "OA answered the dealing
   *   question" from "OA answered the register question", and T-22 makes that log the thing that
   *   decides what gets built next. A split nobody can measure is a split nobody can check was right.
   *
   *   `compose.ts` prefers this over `Composition.id` when a family sets it. `families/reader.ts`
   *   already did the same thing by returning its own result shape; this is that, available to a
   *   composition that goes through the registry.
   */
  readonly variantId?: string;
}

/** Everything a turn produced. `missLogged` is true exactly when the generic path ran. */
export interface Composed {
  readonly compositionId: string;
  readonly sections: readonly AnySection[];
  readonly coverage: Coverage;
  readonly missLogged: boolean;
}
