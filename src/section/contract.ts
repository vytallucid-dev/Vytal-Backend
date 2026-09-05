// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CONTRACT 2 — `Section`. Architecture spec §4.
//
// ── ★ WHY THIS STAGE IS THE ONE THAT CHANGES THE PRODUCT (§0.1) ───────────────────────────────────
// The reason the old layer read generic was not that a model free-formed the words. It is that a
// four-pillar decomposition DELIVERED AS SENTENCES is worse than the same decomposition delivered as
// a waterfall — the numbers were right and the shape was missing. Structure was the defect, not
// authorship. So the gain lands here, before any composition file or router exists.
//
// ── ★ N-2 IS STRUCTURAL HERE, NOT DOCUMENTARY ─────────────────────────────────────────────────────
// "Payload and digest never meet" is easy to write and easy to violate by accident, so the shapes are
// built so the violation does not typecheck:
//
//   · `DigestFragment`'s leaves are ALL `string`. There is no `number` anywhere in its type, at any
//     depth. A renderer that wants a figure in the digest must FORMAT it first — which is N-1 ("the
//     model never emits a number") enforced at the point where the number would otherwise survive.
//     A model handed "₹643 crore" cannot re-derive, re-round or re-scale it; a model handed 643 can.
//   · `payload` is generic per kind and never appears inside `digest`; `digest` is a closed string
//     tree and never appears inside `payload`. Neither contains the other, so neither can leak the
//     other by being passed along.
//
// This codebase already has the discipline in three places — `serializeVisibleMessages` vs
// `loadHistoryForModel`, `toolSpecs()` dropping the handler and the klass, tool `effects` forwarded
// to the result and never to prompt content. This formalises what those already do.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Coverage } from "../resolve/contract.js";

/**
 * ★ THE CLOSED SET (§4.1). Derived by decomposing all 198 question-bank entries; none required a
 * ninth — because all 198 were QUESTIONS.
 *
 * ── ★ "ACTION" IS THE NINTH, ADDED AT STAGE 6, AND RAISED RATHER THAN ABSORBED ────────────────────
 * The question bank contained no requests. Nine of the 33 chat tools were writes, and replacing
 * propose-confirm-execute with rendered affordances (§5.4) needs a section that carries a CONTROL:
 * an endpoint, a method, a body, and a label. Nothing in the other eight does.
 *
 * ⚠ IT IS NOT A VARIANT OF `NEXT`, AND THAT WAS THE TEMPTING WRONG ANSWER. `NEXT` offers chips —
 * navigation, where the worst case of a tap is a page the reader did not want. An ACTION control
 * CHANGES THE READER'S DATA. Filing a mutation as a fifth renderer of a navigation kind would put
 * the two behind one type, and the first person to write a generic `NEXT` renderer would render a
 * write as a link. §4.1's own rule — "if a list grows past six, someone built a variant that should
 * have been a parameter" — cuts the other way here: this is not a variant, it is a different thing.
 *
 * ★ THE INVARIANT THAT MAKES THE KIND SAFE: a section of this kind carries no figure the model
 * produced and no free text it wrote. Every field is either a constant, a code-resolved identifier,
 * or a value the reader typed — see `ActionPayload`.
 */
export type SectionKind =
  | "ANCHOR" | "DECOMPOSITION" | "RELATIVE" | "CALLOUT"
  | "SERIES" | "RAIL" | "COVERAGE" | "NEXT" | "ACTION";

/**
 * ★ RENDERERS ARE DECLARED PER KIND AND THE TYPE ENFORCES THE PAIRING. A `Section<"CALLOUT">` cannot
 * carry `renderer: "waterfall"` — that is a compile error, not a review catch.
 *
 * ⚠ IF A LIST GROWS PAST SIX, SOMEONE IS BUILDING A VARIANT THAT SHOULD HAVE BEEN A PARAMETER (§4.1).
 * The lists below are the spec's, verbatim. Entries not yet implemented are still declared, because
 * the closed set is the point: an unimplemented renderer is a gap you can see.
 */
export const RENDERERS = {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE NAMING RULE, WITH THREE WORKED EXAMPLES. A RENDERER IS NAMED FOR ITS SHAPE, NEVER FOR THE
  //    FAMILY THAT ASKED FOR IT FIRST.
  //
  //    The rule is stated at `value-line` below ("NAMED FOR THE SHAPE, NOT THE FAMILY"). It is easy
  //    to agree with and easy to break, because the first caller is the only caller you can see when
  //    you name the thing. Three cases, kept together so the rule has evidence rather than assertion:
  //
  //    ★ `set-table` — NAMED RIGHT THE FIRST TIME. It arrived for SC's screen results, and the
  //      obvious name was `screen-results`. It was named for its geometry instead — rows are
  //      entities, columns are measures — and by Phase 1 · Batch 2 it had FOUR callers, three of
  //      which matched nothing: a peer roster, a pond roster, and a frame-declined ranking. Under
  //      the obvious name every one of those would have been a screen result that was not a screen
  //      result. (⚠ The frontend still had `title="What matched"` hardcoded inside it, which is the
  //      same mistake one layer down and cost a batch to find — naming the type correctly does not
  //      protect the copy.)
  //
  //    ⚠ `margin-walk` → `bridge` — NAMED WRONG, RENAMED AT PHASE 2 · BATCH 2 ON THE OPERATOR'S
  //      RULING. It was declared for a P&L walk (revenue → gross → operating → net) and named for
  //      that family. The SHAPE is a bridge: a start value, signed steps, an end value. Phase 2 ·
  //      Batch 1 needed exactly that for a score CHANGE decomposition ("why did LT's score fall 19
  //      points") and could not use it, because putting a health chart under a P&L name would teach
  //      every later reader that the list is organised by family. A third caller is already visible —
  //      the Ownership pillar's own arithmetic is a bridge (baseline 75, pledging −2, flow +5 → 78).
  //      The rename costs no slot and closes the gap the previous batch raised.
  //
  //    ★ `defined-term` — NAMED AGAINST ITS SECOND CALLER ON PURPOSE (Phase 2 · Batch 2). It was
  //      built for M · Meta's concept lookup and `concept-card` was the obvious name. It is not:
  //      the same component answers "what does Sticky Divergence mean" out of the FINDINGS catalogue
  //      and "what does Return on Assets mean" out of the metric glosses. All three are one shape —
  //      a named thing, its parts, and the boundary on what it claims — so it is named for that.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // ★ `set-table` ADDED AT T-1b, RULED IN BY THE OPERATOR (§4.1 amendment). NOT a new kind: a screen
  //   result's headline object IS the match set, which is the question ANCHOR already answers and
  //   which `hero-set`'s own header already names. `hero-set` carries ONE figure per row; this carries
  //   several comparable columns, sorted, each row navigable. Both stay — a six-row watchlist with one
  //   score each does not want a table.
  //   ⚠ ROWS ARE ENTITIES, COLUMNS ARE MEASURES. A statement table (rows are LINE ITEMS, columns are
  //     PERIODS, nothing navigates) is a DIFFERENT renderer when F needs one — reserved: `statement-table`.
  //     Forcing that shape through this one is the strained parameter §4.1 warns about.
  //
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ `defined-term` ADDED AT PHASE 2 · BATCH 2. **THIS TAKES ANCHOR TO 6 OF 6, AND BOTH REMAINING
  //    LISTS ARE NOW CLOSED** — every kind except CALLOUT (4), RELATIVE (4) and RAIL (3) is at its
  //    ceiling. The next addition to ANCHOR, SERIES or DECOMPOSITION is an architecture question.
  //
  // ★ WHY IT IS AN ANCHOR. The kind's own rule is that a section holds the answer's HEADLINE OBJECT —
  //   `set-table`'s note above says a screen's headline object IS the match set. For "what does
  //   Foundation mean" the headline object is the definition itself; there is no company, no figure
  //   and no set for the other four to carry.
  //
  // ★ WHY IT IS ONE RENDERER AND NOT TWO. The brief asked for a concept's constituent structure and a
  //   pattern's claim-with-limits, and asked whether they are one thing. They are: a named thing, the
  //   parts it is made of, and the boundary on what it claims. A concept's parts are its metrics and
  //   their weights; a pattern's "parts" are the conditions it observed. Splitting them would give two
  //   renderers with one payload shape and force the composer to know which vocabulary answered
  //   BEFORE it could pick a renderer — which is the strained variant §4.1 warns about, inverted.
  //
  // ⚠ IT CARRIES `doesntMean` AS A FIRST-CLASS FIELD, NOT AS A TRAILING NOTE. The brief is explicit
  //   that this is the load-bearing half and must not read as a disclaimer at the bottom, and the
  //   catalogue agrees — 132 of 132 entries carry it while only 74 carry a description. A component
  //   can hold a claim and its limit side by side in a way prose cannot.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  ANCHOR: ["hero-scored", "hero-fundamental", "hero-dual", "hero-set", "set-table", "defined-term"],
  // ⚠ `ownership-split` ADDED AT STAGE 4c AND RAISED, NOT ABSORBED (§4.1). A shareholding register is
  //    parts-of-a-whole — the same question DECOMPOSITION answers — but none of the five existing
  //    renderers draws a share-of-total split. This takes the list to six, which §4.1 names as the
  //    point where a variant should have been a parameter; it is not a variant of a waterfall, it is
  //    a different geometry for a different whole. Flagged for the Operator.
  DECOMPOSITION: ["waterfall", "bridge", "dupont-tree", "condition-ladder", "ownership-split", "pillar-bars"],
  RELATIVE: ["peer-marker", "distribution-strip", "own-history-band", "opposed-bars"],
  // ★ `findings` ADDED AT PHASE 2 · BATCH 2 — 5 of 6, and the naming test was run before adding it.
  //   A findings census and a mover list are both "a short list of things worth raising", which argues
  //   for a parameter. They are drawn differently for a reason that is not cosmetic: a finding carries
  //   a BOUNDARY (`doesntMean`) that has to sit beside its claim rather than under it, and a mover has
  //   no boundary because a magnitude does not claim anything. Same kind, different geometry, so it
  //   earns an id. `CalloutItem` gains the field as an OPTIONAL one, which is what keeps `divergence`
  //   and `largest-movers` unchanged.
  CALLOUT: ["divergence", "top-drags", "largest-movers", "findings", "nothing-found"],
  // ★ `value-line` ADDED AT T-1b, RULED IN (§4.1 amendment). A CONTINUOUS quantity over time — money
  //   above all. The other four all assume otherwise: composite-spine and phase-shaded-spine fix a
  //   0–100 axis, stepped-filing-line steps because filings are discrete, statement-trend is
  //   per-period statement lines. Nothing drew a money series.
  //   ⚠ NAMED FOR THE SHAPE, NOT THE FAMILY. An instrument's NAV and a market cap over time are the
  //     same renderer with a different unit; `portfolio-value-line` would have been a variant.
  //     Portfolio HEALTH needs nothing new — a 0–100 score with bands IS `composite-spine`.
  //
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ `statement-table` ADDED AT PHASE 1 · BATCH 1 (F · FUNDAMENTALS). THIS TAKES SERIES TO 6 OF 6.
  //
  // ⚠ THE CEILING IS NOW REACHED, AND THE BRIEF ASKED FOR THE NEXT ADDITION TO EITHER LIST TO BE READ
  //   AS THE WARNING §4.1 MEANS IT TO BE. Stating it plainly rather than in a footnote: a SEVENTH
  //   SERIES renderer is an architecture question, not a build decision. Whoever needs one should
  //   expect to be asked which of these seven is the variant that should have been a parameter.
  //
  // ★ THE NAME WAS RESERVED FOR THIS SHAPE AT T-1b, and this is the shape that arrived. `set-table`'s
  //   own header stated the split it was named against: rows are ENTITIES and columns are MEASURES
  //   there; rows are LINE ITEMS and columns are PERIODS here, nothing navigates, and the column
  //   order is chronological rather than sortable.
  //
  // ★ WHY IT IS `SERIES` AND NOT `DECOMPOSITION`. A P&L IS a decomposition — revenue through to net
  //   profit — and that was the tempting answer. But every DECOMPOSITION renderer answers "what did
  //   each part contribute" at ONE point in time, and the question this answers is "show me the
  //   balance sheet", whose primary axis is time: the reader reads across the years and the line
  //   items are the rows. `DECOMPOSITION` is also already at 6 of 6, so it could not take one
  //   without going past the ceiling, and pushing it there to avoid pushing SERIES there would be
  //   filing a shape under the wrong question to keep a count down.
  //
  // ★ WHY IT IS NOT A PARAMETER ON `statement-trend`, WHICH IS THE ONE ALTERNATIVE THAT LOOKED REAL.
  //   `statement-trend` is one period against its two comparatives: its payload is
  //   `{ periodKey, quarterRows, annualFy, annualRows }` and each row carries `qoqPct`/`yoyPct`.
  //   Widening it to N periods does not add a field — it REPLACES the payload with a matrix, so one
  //   renderer id would carry two mutually exclusive payload shapes and the frontend would have to
  //   narrow between them at runtime. That destroys the one guarantee `RendererFor<K>` plus
  //   `PayloadFor<K>` exists to give (§5.1 guarantee 2), and a strained parameter is exactly what
  //   §4.1 warns against — the warning cuts both ways.
  //
  // ★ AND WHAT IT ADDS THAT NOTHING ELSE HAS: STATEMENT STRUCTURE. A filed statement is not a grid of
  //   numbers; some rows are SUBTOTALS of the rows above them and one is the bottom line. Neither
  //   `statement-trend` nor `stepped-filing-line` can express that, and it is the whole of what makes
  //   a statement readable rather than a list. `role: "line" | "subtotal" | "total"` is the payload
  //   field no existing renderer has anywhere to put.
  //
  // ⚠ IT DRAWS NO CHART, DELIBERATELY, WHERE THE OTHER FIVE ALL PLOT. A balance sheet is read, not
  //   traced; five lines of a balance sheet on one axis is a chart whose shape means nothing.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ PHASE 2 · BATCH 1 ADDED NOTHING TO EITHER LIST, AND THE BRIEF ASKED THAT THE ANSWER BE STATED.
  //
  // T · TRAJECTORY NEEDED NO SEVENTH `SERIES` RENDERER, BECAUSE THE SIXTH WAS RESERVED FOR IT AND HAD
  // BEEN WAITING SINCE STAGE 3. `phase-shaded-spine` has been declared and unimplemented in this list
  // from the day it was written — §4.1's own "an unimplemented renderer is a gap you can see",
  // pointing straight at this family — and the header above already paired it with `composite-spine`
  // ("both fix a 0–100 axis"). It is now built (`section/kinds/series.ts#phaseSpineSection`,
  // `components/sections/series-sections.tsx#PhaseShadedSpine`). The count does not move.
  //
  // A · ATTRIBUTION NEEDED NO SEVENTH `DECOMPOSITION` RENDERER EITHER, AND THAT ONE WAS A CLOSE CALL.
  // Its walk runs from a perfect 100 DOWN to the score rather than stacking parts UP to it, which
  // sounds like a different chart. It is not: it is the same picture — a total, bars that account for
  // it, an absent state for what could not be drawn — read in the other direction. `WaterfallPayload`
  // GAINS six fields (`basis`, `ceiling`, `gap`, `group`, `grain`, `groups`) and keeps every existing
  // one, which is the test `statement-table` was ruled in by: a variant REPLACES the payload, a
  // parameter extends it.
  //
  // ★ RAISED AT BATCH 1, RULED AND DONE AT BATCH 2 — `margin-walk` IS NOW `bridge`, and the change
  //   decomposition it was blocking is built (`section/kinds/decomposition.ts#bridgeSection`). The
  //   naming reasoning lives beside `set-table` above, where it is one of three worked examples
  //   rather than a footnote on one.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  SERIES: ["composite-spine", "stepped-filing-line", "statement-trend", "phase-shaded-spine", "value-line", "statement-table"],
  RAIL: ["event-rail", "filing-rail", "news-list"],
  COVERAGE: ["coverage-header"],
  NEXT: ["chips"],
  // ★ TWO, AND THE SPLIT IS THE SAFETY RULE, NOT A LAYOUT CHOICE (§5.4).
  //   `confirm-control` — the action is trivially reversible and carries NO fields the reader must
  //     check. One tap is the confirmation. Adding and removing a watchlist pin is the whole set.
  //   `prefilled-form`  — the action carries values ("10 TCS at 3200 last Tuesday"). The model's
  //     extraction populates the fields; the reader reads them, corrects them, and submits. A
  //     quantity or a price nobody looked at is exactly the write that must not happen on one tap.
  ACTION: ["confirm-control", "prefilled-form"],
} as const satisfies Record<SectionKind, readonly string[]>;

export type RendererFor<K extends SectionKind> = (typeof RENDERERS)[K][number];

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE DIGEST (§4.3) — the highest-risk object in the architecture.
//
// A thin digest produces generic prose, which is the exact failure this whole build escapes. The
// Quarter Brief learned that expensively and its four rules are inherited verbatim:
//
//   1. GROUPED IN NARRATIVE ORDER, NOT SCHEMA ORDER. `groups` is ordered as a person would say it.
//   2. DISPLAY STRINGS, NEVER RAW NUMBERS. Enforced by the types below — see the header.
//   3. EVERY RENDERED FIELD APPEARS, INCLUDING UNCHANGED ONES. Silence about a flat metric reads to a
//      model as absence, and it will write around the gap rather than say "this did not move".
//   4. ABSENT STATES APPEAR AS THEIR AUTHORED READER PHRASE, NEVER AS A GAP (N-4).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * One fact, already formatted. `state` is what stops rule 3 and rule 4 fighting each other: an absent
 * field must be PRESENT in the digest and marked, not omitted and not zero-filled.
 */
export interface DigestLine {
  readonly label: string;
  /** Display string. "₹643 crore", "flat", "72.4 pts". Never a stringified raw number the model could
   *  unpick back to a figure it then re-rounds. */
  readonly value: string;
  readonly state: "present" | "unchanged" | "absent";
}

/** A narrative group. `label` is how a person would introduce the block, not the schema's field name. */
export interface DigestGroup {
  readonly label: string;
  readonly lines: readonly DigestLine[];
}

/**
 * What the model is given for one section. ~50–150 tokens. Never rendered to a browser.
 *
 * ⚠ EVERY LEAF IS A STRING. That is the N-1 enforcement point and it is deliberate, not incidental.
 */
export interface DigestFragment {
  readonly heading: string;
  readonly groups: readonly DigestGroup[];
  /** Authored reader phrases for what could not be answered. Empty array, never absent, so a caller
   *  cannot confuse "nothing was withheld" with "nobody checked". */
  readonly withheld: readonly string[];
}

/** A client-side affordance. No round trip — sorting a table must not re-resolve the subject. */
export interface InteractionSpec {
  readonly id: string;
  readonly kind: "sort" | "toggle" | "drill";
  readonly label: string;
}

/**
 * ★ ONE RESOLVE, TWO OBJECTS.
 *
 * `payload` is fat and goes to the browser. `digest` is thin and goes to the model. `coverage` rides
 * on the section itself rather than being buried in either, because N-6 says coverage is STATED, not
 * discovered by collision — a reader must be able to see what was searched without opening a payload.
 */
export interface Section<K extends SectionKind, P> {
  readonly kind: K;
  readonly renderer: RendererFor<K>;
  readonly payload: P;
  readonly digest: DigestFragment;
  readonly coverage: Coverage;
  readonly interactions: readonly InteractionSpec[];
}

// ── BUILDERS. The only way to make a digest line, so the rules cannot be forgotten at a call site. ──

/** A fact we have. `value` must already be formatted — that is the caller's job and the whole point. */
export const line = (label: string, value: string): DigestLine => ({ label, value, state: "present" });

/** ★ A FACT THAT DID NOT MOVE. Rule 3: it appears anyway. Omitting it reads to the model as absence,
 *  and the model then writes around a gap that is really a flat reading — "no data on margins" where
 *  the truth is "margins did not move", which is a different and more useful sentence. */
export const unchanged = (label: string, value: string): DigestLine =>
  ({ label, value, state: "unchanged" });

/**
 * ★ A FACT WE DO NOT HAVE. Rule 4 + N-4.
 *
 * `phrase` is the AUTHORED reader phrase — `relational/coverage.ts#reasonPhrase` — never free text and
 * never the reason token. The model is handed the same words a reader would see, so it can quote the
 * absence instead of inventing a hedge for it.
 */
export const withheld = (label: string, phrase: string): DigestLine =>
  ({ label, value: phrase, state: "absent" });

/** Assemble. `withheld` collects the authored phrases so a composition can state coverage once. */
export function digest(
  heading: string,
  groups: readonly DigestGroup[],
): DigestFragment {
  const phrases: string[] = [];
  for (const g of groups) for (const l of g.lines) if (l.state === "absent") phrases.push(l.value);
  return { heading, groups, withheld: [...new Set(phrases)] };
}
