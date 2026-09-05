// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// DP · DEPTH AND PROSE — the register layer. Phase 3.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ THE GAP THIS CLOSES: `ctx.tone` REACHES EVERY COMPOSITION AND NO FAMILY READS IT.
//
// Measured across the whole composer — the only consumers of `ToneDirective` are `planAnswer` (which
// injects `systemDirective` into the MODEL's prompt) and one memory card that displays the setting
// back to the reader. Every hand-authored family — F, OA, PG, T, A, M, PT — writes its prose at one
// fixed register, so a reader who set "simpler terms" got the identical sentences as one who set
// "technical". The preference was stored, resolved, threaded through four layers, and then dropped.
//
// ★ THE PROFILE PATH IS THE EXISTING ONE. `reader/profile.ts` already loads register and ledger and
//   resolves them through `ai/tone.ts#resolveTone` — the same function the opening path uses. Nothing
//   here adds a second read or a second definition (N-5); this consumes what already arrives.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// ── ★ WHAT A REGISTER MAY AND MAY NOT CHANGE ──────────────────────────────────────────────────────
//
//   MAY   which sentences appear, and whether a term carries a gloss
//   MAY   the order sentences are read in
//   NEVER a figure, a section, a payload, a renderer, or which facts are stated
//
// ⚠ DP-19 IS THE RULE, NOT AN EXAMPLE: "prose re-renders at `plain`; the chart, table and numbers are
//   untouched." This module takes `AnswerProse` and returns `AnswerProse`. It is applied AFTER the
//   composition has built its sections and cannot reach them — the artifact is untouched by
//   construction rather than by care.
//
// ── ⚠ AND IT DOES NOT REWRITE SENTENCES ───────────────────────────────────────────────────────────
// The tempting implementation is a simplifier: shorten clauses, swap long words. That is AUTHORING BY
// REGEX, and it would produce copy nobody wrote and no gate could check — against a codebase whose
// whole discipline is that every reader-facing string is authored once and registered. So the levers
// are SELECTION and GLOSSING, both of which only ever move or annotate text a person wrote.
//
// ── ★ THE TWO AXES DO DIFFERENT JOBS, WHICH IS WHY BOTH EXIST ─────────────────────────────────────
//
//   level  (plain | balanced | technical)   SIMPLER WORDS — glosses the jargon
//   depth  (concise | standard | deep)      FEWER WORDS   — drops the elaboration
//
// "Simpler terms" and "shorter" are different requests and the reader can make either. Collapsing
// them would mean a reader asking for plain English also loses half the answer, which is the "thinner
// rather than shorter" failure the brief names.
//
// ⚠ AND `plain` IS ABOUT THE WRITING, NEVER ABOUT THE READER. The labels describe output style. There
//   is no "beginner" here and there must not be: a professional asking for plain English is asking
//   about the prose, not confessing anything.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { ToneDirective } from "../ai/tone.js";
import type { AnswerProse } from "./contract.js";
import { CONCEPTS } from "../catalogue/concepts.js";

/**
 * ★ THE TERMS WORTH GLOSSING, AND THEY ARE READ FROM THE CONCEPT REGISTRY RATHER THAN LISTED HERE.
 *
 * M · Meta's registry is exactly a term → short-definition map, authored and gated. A second list of
 * "hard words" maintained beside it would be the duplicate vocabulary §7.1 exists to prevent — and it
 * would drift the moment a concept's wording changed.
 *
 * ⚠ ONLY CONCEPTS, NOT ALL FIVE VOCABULARIES. A gloss must be SHORT enough to sit in parentheses
 *   inside a sentence; a findings-catalogue description is a paragraph. Concepts carry a one-clause
 *   `partOf` and a name, which is the right size. The reader who wants the full definition asks for
 *   it and gets M's whole card.
 */
const GLOSSABLE: readonly { term: string; key: string; gloss: string }[] = Object.values(CONCEPTS)
  // ⚠ `inProse`, NEVER `aliases`. Aliases are what a reader TYPES; several of them are band VALUES
  //   that appear in our own sentences meaning something else entirely. See `ConceptEntry.inProse`.
  .flatMap((c) => c.inProse.map((t) => ({ term: t.toLowerCase(), key: c.key, gloss: c.gloss })))
  // ⚠ LONGEST TERM FIRST. "health score" must win over "score", or the specific phrase is glossed as
  //   the general one — the same specific-before-general rule `resolveDefinition` runs on.
  .sort((a, b) => b.term.length - a.term.length);

/**
 * ⚠ ONE GLOSS PER ANSWER, NOT ONE PER OCCURRENCE.
 *
 * Glossing every instance of "Foundation" in a four-paragraph answer produces a page of parentheses
 * and makes the prose harder, which is the opposite of what `plain` asked for. The first mention
 * carries it; every later one is now a term the reader has been told.
 */
function glossFirstMention(sentences: readonly string[], used: Set<string>): string[] {
  return sentences.map((s) => {
    const lower = ` ${s.toLowerCase()} `;
    for (const g of GLOSSABLE) {
      if (used.has(g.key)) continue;
      // ⚠ THE BOUNDARY IS A WHOLE WORD, NOT A SUBSTRING — but "the score in one bar" and "the score,"
      //   are both real sentences and only the first ends in a space. Trailing punctuation counts as
      //   a boundary; a letter does not, so "scores" and "scoreboard" still never match.
      let at = -1;
      for (const tail of [" ", ",", ".", ";", ":", ")", "—"]) {
        const i = lower.indexOf(` ${g.term}${tail}`);
        if (i >= 0 && (at < 0 || i < at)) at = i;
      }
      if (at < 0) continue;
      used.add(g.key);
      const start = at; // ` ` offset cancels the leading space we added
      const end = start + g.term.length;
      return `${s.slice(start, end)}`.length === 0 ? s : s.slice(0, end) + ` (${g.gloss})` + s.slice(end);
    }
    return s;
  });
}

/**
 * Apply the reader's register to an answer's prose.
 *
 * ★ TOTAL AND IDENTITY-PRESERVING AT THE DEFAULT. `balanced` + `standard` returns the prose unchanged,
 *   which is what every family produced before this existed — so adopting the layer changes nothing
 *   until a reader has actually set a preference.
 */
export function applyRegister(prose: AnswerProse, tone: ToneDirective): AnswerProse {
  let opening = [...prose.opening];
  let after = { ...(prose.after ?? {}) };

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ ANNOTATE FIRST, SELECT SECOND — AND THE FIRST DRAFT DID IT THE OTHER WAY ROUND.
  //
  // ⚠ `LEVEL_SPEC` COUPLES THE AXES: `aiLevel: "plain"` resolves to `depth: "concise"` as well. So a
  //   reader asking for plainer English also gets the shorter answer — which is right — and the
  //   first draft then trimmed to one sentence BEFORE glossing, leaving the gloss nothing to attach
  //   to. Measured: at `plain` the output carried no parenthesis at all, because every term worth
  //   glossing lived in a sentence that had just been dropped.
  //
  // ★ GLOSSING THE FULL SET FIRST MEANS THE SURVIVING SENTENCE KEEPS ITS ANNOTATION if it has a term,
  //   and the dropped ones take their glosses with them. Order is the whole fix.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  // ── LEVEL · SIMPLER WORDS ───────────────────────────────────────────────────────────────────────
  //
  // ⚠ `plain` ONLY — AND THE FIRST DRAFT GLOSSED ON THE DEFAULT. `resolveTone(null, null)` returns
  //   `jargon: "gloss"`, so a `jargon !== "assume"` test glossed EVERY anonymous answer in the
  //   system. That axis is an instruction to the MODEL about how to handle terms in generated text;
  //   it is not an instruction to parenthesise prose a person already wrote.
  //
  // ★ THE READER HAS TO HAVE ASKED. `level: "plain"` is the setting that says "simpler terms", and it
  //   is the only one that earns a parenthesis in someone else's sentence.
  if (tone.level === "plain") {
    const used = new Set<string>();
    opening = glossFirstMention(opening, used);
  }

  // ── DEPTH · FEWER WORDS ─────────────────────────────────────────────────────────────────────────
  //
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ `concise` DROPS THE EPILOGUES AND NOTHING ELSE — AND TWO EARLIER DRAFTS DROPPED MORE.
  //
  // ⚠ THE RULING IS "A `plain` ANSWER IS SHORTER, NOT THINNER", AND THINNER IS WHAT THE FIRST TWO
  //   DRAFTS PRODUCED. Both were caught on the Phase 3 verify run, on real answers:
  //
  //   · `opening.slice(0, 1)` — "how is TCS doing" opens with three sentences: what the business is,
  //     the quarter's revenue and growth, the full-year returns. Keeping only the first deleted
  //     ₹72,275 Cr, +13.9% and 49.0% on equity, and handed a beginner — the exact reader `plain`
  //     exists for — an identity sentence with no figures in it at all.
  //
  //   · KEEPING ONLY THE SENTENCES WITH A DIGIT IN THEM, which was the fix for the first and was
  //     wrong in a subtler way. It dropped T's epoch sentence ("we began scoring in January 2023, so
  //     FY23Q4 is the earliest reading that EXISTS — not the earliest we happen to hold") and OA's
  //     "institutional holding is unchanged on the previous filing". Neither carries a figure and
  //     both carry evidence; the epoch sentence exists precisely to stop the reader misreading 14
  //     quarters as all we could find, so dropping it re-created the misreading it was written for.
  //
  // ★ SO THE RULE IS THE CONTRACT'S OWN, NOT A HEURISTIC OF THIS LAYER'S. §4.3 marks exactly one
  //   thing optional — the per-section epilogue, "a component that speaks for itself needs no
  //   epilogue" — and that is the one thing `concise` removes. The opening, every LEAD and the
  //   conclusion are what §4.3's test reads ("read only the sentences: complete and true"), and a
  //   register is not licence to fail that test.
  //
  // ⚠ THIS LAYER SELECTS; IT NEVER WRITES. Genuinely shortening authored prose would mean rewriting
  //   someone's sentences by regex, which is the one thing this module refuses. Where a family's
  //   opening is already three tight sentences there is nothing honest left to cut, and the answer
  //   is the same at both registers — correctly. The `level` axis's real force is on MODEL-generated
  //   prose, through `tone.systemDirective`, which is `resolveTone`'s business and not this layer's.
  //
  // ★ `deep` ADDS NOTHING, DELIBERATELY, for the same reason: there is no extra prose to add that a
  //   family did not write, and inventing some would be that same authoring-by-regex.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (tone.depth === "concise") after = {};

  return { ...prose, opening, after };
}

/**
 * ★ THE SENTENCE OFFERING TO REMEMBER THE SETTING — DP-19's second half.
 *
 * ⚠ IT IS AN OFFER AND NOT A CONFIRMATION, because this layer does not write. A register applied to
 *   one answer is a rendering choice; persisting it is a change to the reader's profile and belongs
 *   to the ACTION path, where a write is a control the reader taps (§5.4). Saying "I have saved that"
 *   here would be a claim about a row nobody inserted.
 *
 * `null` at the default register — there is nothing to offer to remember.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ IT HAS NO CALL SITE TODAY, DELIBERATELY, AND THAT IS WORTH MORE THAN A WRONG ONE. The first
 *   wiring appended it in `compose.ts#withLinks`, where the tone comes from `loadReaderProfile` — that
 *   is, from `user_register`, ALREADY PERSISTED. So a reader who had set "plain" in their settings was
 *   told "say the word and I will keep answering this way" at the end of every answer they ever read:
 *   an offer to save what they had already saved, forever, as a permanent footer.
 *
 * ★ THE REAL CALL SITE IS THE TURN-LOCAL REGISTER — a reader saying "explain that more simply" and
 *   getting this turn re-rendered — which is DP's other half and is NOT BUILT. The offer is correct
 *   for that path and is kept, unwired, rather than deleted and re-derived later.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export function registerOffer(tone: ToneDirective): string | null {
  if (tone.level === "balanced" && tone.depth === "standard") return null;
  const what = tone.depth === "concise"
    ? "shorter answers"
    : tone.level === "plain"
      ? "plainer wording"
      : "this level of detail";
  return `That is the same answer written for ${what} — the figures and the charts above are unchanged. `
    + `Say the word and I will keep answering this way.`;
}
