// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ANSWER SHAPE — the house style, as code rather than as review feedback.
//
// ── ★ WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
// The orientation family took seven rounds of design review to arrive at. Read back, only ONE of
// those rounds was about orientation: the rest were rules about how EVERY answer should read.
//
//   "not everything should be an artifact — prose carries the story, visuals show the shape"
//   "if something is empty, say it in words; do not show an empty component"
//   "no thresholds and weightings"
//   "some conclusion of all the data"
//   "suggestions should be proper — driven by what was actually found"
//
// Those are not orientation decisions. They are the product's voice. If the next family has to
// rediscover them in review, the review cost is paid 198 times and the answers drift apart in
// between — which is the same failure as two homes for one vocabulary (N-5), moved from data to copy.
//
// ★ SO THE SHAPE IS A BUILDER, NOT A CONVENTION. A family declares WHAT it can answer; this decides
//   HOW that reads. A family cannot forget the conclusion or ship an empty card, because it does not
//   author either.
//
// ── THE SHAPE, IN ORDER ───────────────────────────────────────────────────────────────────────────
//   COVERAGE      what this is based on, always, even when nothing is wrong           (N-6)
//   opening       who this is and the headline, in prose                              (§0.1)
//   [lead, block] one line of prose before each section, saying what it shows and why
//   conclusion    the synthesis — the only place the whole answer is pulled together
//   NEXT          follow-ups chosen by what was actually found, never a fixed list
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { AnySection, ComposedAnswer } from "./contract.js";
import type { Coverage } from "../resolve/contract.js";
import { nextSection, type NextSignals } from "../section/kinds/anchor.js";
import { coverageSection } from "../section/kinds/coverage.js";

/** One section plus the sentence that introduces it. `section: null` means the family had nothing to
 *  put here — the block is DROPPED, not rendered empty. That is the "no empty artifacts" rule, and it
 *  is enforced by the builder rather than remembered by the author. */
export interface Block {
  /** Said BEFORE the section — what is coming, and why it follows from the last one. */
  readonly lead: string;
  /**
   * ★ Said AFTER the section — what it showed and why it matters (§4.3 as amended, stage 9).
   *
   * Optional, and that is the design: a component that speaks for itself needs no epilogue, and a
   * paragraph under every card is padding rather than reasoning. Use it where the figures carry a
   * conclusion the reader would otherwise have to derive for themselves.
   */
  readonly after?: string;
  readonly section: AnySection | null;
}

export interface AnswerSpec {
  readonly coverage: Coverage;
  /** 1–3 sentences. The reader should be able to stop here and have an answer. */
  readonly opening: readonly string[];
  readonly blocks: readonly Block[];
  /** The synthesis. Required — an answer that stops at its last table has not been concluded. */
  readonly conclusion: string;
  readonly symbol: string;
  readonly signals: NextSignals;
}

export type Answer = ComposedAnswer;

/** Assemble. The order is not a parameter — that is the point of having a shape. */
export function buildAnswer(spec: AnswerSpec): Answer {
  const sections: AnySection[] = [coverageSection(spec.coverage) as AnySection];
  const leads: Record<string, string> = {};

  const after: Record<string, string> = {};
  for (const b of spec.blocks) {
    if (!b.section) continue; // ★ nothing to show → no card, and no lead for a card that is not there
    sections.push(b.section);
    /**
     * ═══════════════════════════════════════════════════════════════════════════════════════════════
     * ★★ THE INDEXED KEY, ALWAYS — AND THE PLAIN ONE SILENTLY COLLIDED UNTIL THIS BATCH.
     *
     * ⚠ THIS READ `leads[`${kind}:${renderer}`] = b.lead`, so a family with TWO sections of the same
     *   kind AND renderer overwrote the first with the second, and both then rendered under one
     *   sentence. `contract.ts#AnswerProse.leads` documented the indexed form as the fix and
     *   `families/reader.ts` hand-rolls it for its two alerts rails — but every family that goes
     *   through THIS builder was still colliding, because the builder could not produce the key its
     *   own contract described. No answer had two of anything until F's broad question grew a second
     *   `SERIES:statement-table`, which is how the collision surfaced.
     *
     * ★ `i` IS THE INDEX IN THE FINAL SECTION ARRAY, which is what the renderer resolves against:
     *   `KIND:renderer#i` → `KIND:renderer` → `KIND`. Indexing unconditionally is safe because the
     *   first lookup always hits, and it removes the class of bug rather than the instance — a
     *   "only index when it would collide" rule is one someone has to keep getting right.
     * ═══════════════════════════════════════════════════════════════════════════════════════════════
     */
    const key = `${b.section.kind}:${b.section.renderer}#${sections.length - 1}`;
    leads[key] = b.lead;
    // §4.3 as amended — what the block SHOWED, where the block carries a conclusion worth stating.
    if (b.after) after[key] = b.after;
  }
  sections.push(nextSection(spec.symbol, spec.signals) as AnySection);

  return {
    sections,
    prose: { opening: spec.opening, leads, after, close: spec.conclusion },
  };
}

// ── THE SHAPE ASSERTIONS. Every family inherits these; a family may add its own on top. ────────────
//
// ⚠ THESE RUN IN THE FAMILY'S OWN FILE (§5.2), so a family that breaks the house style fails its own
// eval in the commit that adds it — not in a design review three weeks later.
export const SHAPE_ASSERTIONS = [
  {
    name: "coverage is stated first, always (N-6)",
    check: (s: readonly AnySection[]) => (s[0]?.kind === "COVERAGE" ? null : `first section is ${s[0]?.kind}`),
  },
  {
    name: "the answer offers somewhere to go next",
    check: (s: readonly AnySection[]) =>
      s[s.length - 1]?.kind === "NEXT" ? null : "last section is not NEXT — the answer dead-ends",
  },
  {
    name: "no section renders with an empty payload (the no-empty-artifacts rule)",
    check: (s: readonly AnySection[]) => {
      const empty = s.filter((x) => x.kind !== "COVERAGE" && x.kind !== "CALLOUT" && x.payload === null);
      return empty.length === 0 ? null : `${empty.map((e) => e.kind).join(", ")} rendered with a null payload`;
    },
  },
  {
    name: "every section carries a non-empty digest (§4.3 rule 3)",
    check: (s: readonly AnySection[]) => {
      const bad = s.filter((x) => x.digest.groups.every((g) => g.lines.length === 0));
      return bad.length === 0 ? null : `${bad.length} section(s) produced an empty digest`;
    },
  },
  {
    name: "no digest leaf is a raw number (N-1)",
    check: (s: readonly AnySection[]) => {
      for (const sec of s) for (const g of sec.digest.groups) for (const l of g.lines)
        if (typeof (l as { value: unknown }).value !== "string") return `${sec.kind}: non-string digest value`;
      return null;
    },
  },
];
