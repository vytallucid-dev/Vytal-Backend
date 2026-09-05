// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FAMILY: M · META — "what does Foundation mean", "what is a phase", "what does Sticky Divergence mean".
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE §4.1 TEST, RUN A FIFTH TIME — AND THE ANSWER IS A FIFTH DIFFERENT ONE AGAIN.
//
//   F   one composition, focus as a parameter
//   OA  four compositions
//   PG  one composition, no parameter
//   T   one composition with a DATA branch inside it, announced to the reader by name
//   M   **one composition over FIVE SOURCES, and which one answered is a property of the ANSWER**
//
// The difference from T is real rather than cosmetic. T's branch is on what we HOLD about a company —
// a score exists or it does not. M's branch is on WHICH VOCABULARY the reader's word lives in, and the
// reader has no way of knowing that and should never need to. "What does divergence mean" could be the
// product concept or the `divergence_S2_sticky_divergence` finding; "what does ROCE mean" is a metric
// gloss. Five registries, one question, one answer — so the registries stay separate (§7.1, N-5) and
// the LOOKUP spans them, in `resolve/concept.ts`, which is the single place that knows the order.
//
// ⚠ FIVE COMPOSITIONS WAS THE ALTERNATIVE AND IT IS THE WRONG ONE. Each would claim the same slots and
//   differ only on which registry it happened to search, so which one answered would be decided by
//   position in `COMPOSITIONS` — the ordering hazard this build has now removed twice (`Predicate.
//   subject` in Phase 1 · Batch 1, `Predicate.question` in Phase 2 · Batch 1). A reader asking about a
//   term in two registries would get whichever composition was registered first.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// ── SECTION ORDER, AND WHY ────────────────────────────────────────────────────────────────────────
//   COVERAGE : coverage-header    only when a company is in play; a definition needs no coverage
//   ANCHOR   : defined-term       the term, its parts, its boundary, and the worked example INSIDE it
//   NEXT     : chips              the terms next to this one
//
// ★ ONE EVIDENCE SECTION, AND THAT IS THE RIGHT NUMBER. The brief: "A concept has parts, weights, and a
//   place in a whole… those are shapes, and they should be drawn." They are — all of them, in one
//   component, because a definition split across three cards is a definition the reader has to
//   reassemble. The worked example belongs INSIDE the component and is there.
//
// ── ★ ZERO MODEL TOKENS ON AN EXACT MATCH, AND THAT IS THE POINT ──────────────────────────────────
// §7.1 claims it; the previous batch proved why it matters when the daily budget ran out mid-build and
// a whole gate could not run. A subjectless definition here costs ONE map lookup and NO database query
// — the registries are frozen objects loaded with the module. This family reduces load rather than
// adding to it, which is a property worth asserting and is asserted (`verify-concepts.ts`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { generalHalf } from "./meta-general-half.js";
import { resolveDefinition } from "../../resolve/concept.js";
import { definedTermSection } from "../../section/kinds/defined-term.js";
import { coverageSection } from "../../section/kinds/coverage.js";
import { chipSection, type Chip } from "../../section/kinds/anchor.js";
import { definitionAsked } from "../../router/question-shape.js";
import type { AnySection, ComposedAnswer, Composition } from "../contract.js";

/**
 * ★ THE READER'S CURRENT COMPANY, FOR THE WORKED EXAMPLE — INHERITED, NEVER ASKED FOR.
 *
 * A definition question names no company by design, so `ctx.symbol` is null. But a reader asking "what
 * does Foundation mean" three turns into a conversation about TCS means Foundation *for TCS*, and the
 * example is what turns the definition into an answer. `turn.priorSubjects` is the context the router
 * already carries; nothing here parses a ticker out of the sentence.
 */
function exampleSubject(ctx: Parameters<Composition["build"]>[0]): string | null {
  if (ctx.symbol) return ctx.symbol;
  // `turn.context` is the router's own outgoing context and already merges the previous turn's
  // subjects — so this reads what the conversation is about without parsing the sentence for a ticker.
  const s = ctx.turn.context.subjects.find((x) => x.kind === "stock");
  return s && "symbol" in s ? s.symbol : null;
}

export const meta: Composition = {
  id: "meta.define",
  family: "meta",
  /**
   * ⚠ `subject: "none"` IS DOING REAL WORK HERE, NOT DOCUMENTING AN ABSENCE. `definitionAsked` returns
   *   true for "what is TCS's revenue" — correctly, it is a what-is question — and what makes that a
   *   DATA question rather than a definition is that it names a company. Excluding it structurally is
   *   better than teaching the router's word lists to detect company mentions, which would be a second
   *   and worse copy of resolver #1 (N-3).
   *
   * ⚠ AND IT CLAIMS THREE OPERATIONS, NOT JUST `explain`. Measured, "what does Foundation mean"
   *   arrives as `explain`, `lookup` or `orient` depending on the roll — and NOTHING in `COMPOSITIONS`
   *   claimed `explain` at all before this batch, so every one of them fell to the generic composition
   *   and rendered a single `nothing-found` card. A reader asking what a pillar means was shown an
   *   empty box.
   *
   * ⚠ `unresolved` CANNOT BE NAMED HERE AND IS HANDLED IN `compose.ts` STEP 2c INSTEAD. `Predicate.
   *   operation` is `OperationSlot[]` and `unresolved` is deliberately not one — §6.2's rule is that an
   *   unresolved operation gets CHIPS, never a handler, and step 2 enforces it before step 4 is
   *   reached. The lexical classifier answers `unresolved` for most definition questions, so without
   *   an override every one of them would be answered with "which of these did you mean?". The
   *   override follows the precedent step 2b already set for advice, and is narrow for the same
   *   reason: `definitionAsked` requires an explicit asking shape and the turn must resolve no
   *   company.
   */
  when: {
    operation: ["explain", "lookup", "orient"],
    subject: "none",
    question: definitionAsked,
  },
  examples: [
    "what does Foundation mean",
    "what is a phase",
    "what does Sticky Divergence mean",
    "explain the bands",
    "what is ROCE",
  ],
  build: async (ctx) => {
    const symbol = exampleSubject(ctx);
    const r = await resolveDefinition(ctx.turn.raw, symbol);

    if (!r.ok) {
      // ⚠ AN UNKNOWN TERM IS A STATEMENT ABOUT OUR VOCABULARY, NOT A SEARCH MISS. "No results" invites
      //   the reader to rephrase the same question indefinitely; naming what we DO define tells them
      //   where the edge is.
      return {
        // ⚠ NO COVERAGE HEADER. There is no company and no data — a coverage card over nothing is
        //   furniture asserting a scope that is not in question, and the same reasoning applies here
        //   as on the found-but-no-example arm below.
        sections: [
          definedTermSection(r, ctx.turn.raw) as AnySection,
          chipSection([
            { label: "The score", question: "What does the health score mean?", surface: "Methodology" },
            { label: "Foundation", question: "What does Foundation mean?", surface: "Methodology" },
            { label: "The labels", question: "What do the five labels mean?", surface: "Methodology" },
          ]) as AnySection,
        ],
        prose: {
          opening: [
            `That is not a term we define. We hold definitions for the checks we run, the readings we `
            + `take of each measure, the line items companies file, and the parts of the score itself — `
            + `so if the word came off one of our own cards, it is worth trying the exact wording there.`,
          ],
          leads: {},
          after: {},
          close: `The three below are the ones most people start with.`,
        },
      };
    }

    let d = r.data;

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★ THE GENERAL HALF — the model, for a measure nobody has authored.
    //
    // ⚠ SCOPED TO THE GENUINE GAP AND NOTHING MORE. All 109 glosses and 14 concepts are fully
    //   authored, so `needsGeneralHalf` is false for every one of them and the model never sees
    //   them. Where the house has written a definition it stands — the model does not paraphrase
    //   house judgement into something blander, and no `doesntMean` line is lost to it.
    //
    // ★ THE CODE HALF TRAVELS WITH THE ASK. `vytalBasis` is authored on the engine registry for the
    //   seven metrics whose basis is counter-intuitive, ROCE first among them, and the model is told
    //   not to contradict it. Guardrail (`prosePasses`) is inside `generalHalf`, not here.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    let modelWrote = false;
    if (d.needsGeneralHalf) {
      const half = await generalHalf(d.name, d.pillar, d.vytalBasis, ctx.tone, ctx.reader ?? null);
      if (half) {
        modelWrote = true;
        d = { ...d, description: half.meaning };
      }
    }

    const sections: AnySection[] = [];
    // ⚠ COVERAGE ONLY WHERE THERE IS SOMETHING TO COVER. N-6 asks that coverage be stated before a
    //   claim about data; a definition makes no claim about data, and a coverage header over a
    //   glossary entry would be furniture asserting a scope that is not in question. It appears
    //   exactly when a worked example puts a real company on the card.
    if (d.example) sections.push(coverageSection(r.coverage) as AnySection);
    // ⚠ THE CARD IS BUILT FROM `d`, NOT FROM `r` — and the first version of this got it wrong.
    //   `generalHalf` writes into the local `d`, but `definedTermSection` takes the whole `Resolved`
    //   envelope, so the card kept rendering `r.data.description`, which for a model-explained metric
    //   is the empty string. The live trace showed the giveaway: the CLOSE said "the description above
    //   is the general meaning" while the card above it was blank. The model had written and nothing
    //   carried it.
    sections.push(definedTermSection({ ...r, data: d }, ctx.turn.raw) as AnySection);

    const chips: Chip[] = d.seeAlso.map((x) => ({
      label: x.name,
      question: `What does ${x.name} mean?`,
      surface: "Methodology",
    }));
    if (d.example) {
      chips.unshift({
        label: d.example.symbol,
        question: `How is ${d.example.symbol} doing?`,
        surface: "Company",
      });
    }
    sections.push(chipSection(chips.slice(0, 4)) as AnySection);

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★ PROSE FRAMES AND CONCLUDES; THE CARD CARRIES THE DEFINITION. §4.3, and it was inverted.
    //
    // ⚠ THE OBSERVED ANSWER SAID THE SAME THING THREE TIMES: `opening` pushed `${name}. ${description}`
    //   and then `doesntMean` verbatim, the CARD rendered both again, and the close re-opened with
    //   "In short: <description's first sentence>. <doesntMean>". A reader met the boundary sentence
    //   twice in prose and once on the card.
    //
    // ★ SO THE OPENING SAYS WHAT KIND OF THING THIS IS AND WHERE IT SITS — which the card does NOT
    //   say — and the definition is left to the card, which exists to carry it.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    const opening: string[] = [];
    if (d.needsGeneralHalf && !modelWrote) {
      // ⚠ THE FALLBACK, AND IT NEVER DESCRIBES THE REGISTRY. The old one told the reader "we hold no
      //   written definition for it yet" and asked them to read the answer as a description of USE —
      //   a note to whoever maintains the catalogue, said out loud. This says the one true thing.
      opening.push(
        `${d.name} is one of the measures behind the health score${d.pillar ? `, in the ${d.pillar} pillar` : ""}, `
        + `and we cannot give you a plain-English explanation of it right now.`,
      );
      if (d.vytalBasis) opening.push(d.vytalBasis);
    } else if (d.needsGeneralHalf) {
      opening.push(
        `${d.name} is one of the measures behind the health score${d.pillar ? `, in the ${d.pillar} pillar` : ""}.`,
      );
      // ★★ VYTAL'S OWN BASIS IS PROSE, NOT A FOOTNOTE, and it is code's sentence verbatim. It is the
      //   half the model was told not to write, and the half that stops a textbook definition being
      //   read over a number computed a different way.
      if (d.vytalBasis) opening.push(d.vytalBasis);
    } else {
      opening.push(d.sourceSentence);
    }
    // ★ THE BOUNDARY IS THE SECOND SENTENCE, NOT THE LAST. §4.3's test is that the prose alone is a
    //   complete and true answer, and the limit of a claim is half of what makes it true.
    //
    // ⚠ IT IS PUSHED VERBATIM, WITH NO LEAD-IN. Two registers live in this corpus and a lead-in that
    //   fits one inverts the other — see the note at the foot of `section/kinds/defined-term.ts`.
    // ⚠ `doesntMean` IS NOT PUSHED HERE ANY MORE. The card renders it, and it appeared twice in prose
    //   besides. One statement, one place.
    if (d.partOf) opening.push(`It sits inside ${d.partOf}.`);

    const leads: Record<string, string> = {};
    const after: Record<string, string> = {};
    const termIdx = sections.findIndex((s) => s.renderer === "defined-term");
    const key = `ANCHOR:defined-term#${termIdx}`;
    leads[key] = d.parts.length
      ? `${d.name} is not one measure — it is made of parts, and it is worth seeing which.`
      + (d.example ? ` The figures beneath are ${d.example.symbol}'s own, as a worked example.` : "")
      : d.sourceSentence;
    if (d.parts.length) after[key] = d.sourceSentence;

    return {
      sections,
      prose: {
        opening,
        leads,
        after,
        // ★ A CONCLUSION, NOT A THIRD COPY. The old close restated the description's first sentence
        //   AND `doesntMean`, both of which the card above already carries.
        close: d.example
          ? `${d.example.symbol} above is what that looks like on a real company.`
          // ⚠ AND IT IS CONDITIONAL ON A BASIS ACTUALLY BEING THERE. The first version said "how
          //   Vytal computes it is stated separately" on EVERY model-written answer — including
          //   Asset Turnover, which has no authored basis and where nothing was stated separately.
          //   A sentence pointing at something that is not on the page is the same class of defect
          //   as the backlog narration it replaced.
          : modelWrote && d.vytalBasis
            // ★ THE READER IS TOLD WHICH HALF CAME FROM WHERE. The general explanation is general
            //   knowledge; the basis line is ours, and a reader comparing us with another source
            //   needs to know which sentence is which.
            ? `The description above is the general meaning of the measure; the line about how Vytal `
              + `computes it is ours, and the two can differ.`
            : modelWrote
              ? `That is the general meaning of the measure. We hold no note of our own on how it is `
                + `computed here, so read it as the ordinary definition.`
              : `That is the whole of what we mean by it here.`,
        // (the boundary closes the answer verbatim, for the same reason it opens it verbatim)
      },
    } satisfies ComposedAnswer;
  },
  assertions: [
    {
      name: "coverage is stated first whenever a real company is on the card (N-6)",
      check: (s) => {
        const term = s.find((x) => x.renderer === "defined-term");
        const p = term?.payload as { example?: unknown } | null;
        if (!p?.example) return null;
        return s[0]?.kind === "COVERAGE" ? null : `a worked example is drawn and the first section is ${s[0]?.kind}`;
      },
    },
    {
      name: "the boundary is carried, always",
      check: (s) => {
        const term = s.find((x) => x.renderer === "defined-term");
        if (!term) return "no defined-term section";
        const p = term.payload as { doesntMean?: string } | null;
        if (p === null) return null; // the honest-unknown arm
        return p.doesntMean && p.doesntMean.length > 20
          ? null
          : "a term is defined with no statement of what it does not mean";
      },
    },
    {
      name: "no registry key reaches a reader-facing string",
      check: (s) => {
        const term = s.find((x) => x.renderer === "defined-term");
        const p = term?.payload as { name?: string; description?: string; seeAlso?: { name: string }[] } | null;
        if (!p) return null;
        const KEYISH = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
        for (const v of [p.name, p.description, ...(p.seeAlso ?? []).map((x) => x.name)]) {
          if (typeof v === "string" && KEYISH.test(v.trim())) return `a raw key reached the payload: ${v}`;
        }
        return null;
      },
    },
    {
      name: "the answer offers somewhere to go next",
      check: (s) => (s[s.length - 1]?.kind === "NEXT" ? null : "last section is not NEXT — the answer dead-ends"),
    },
  ],
};
