// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE BRANCHES THAT ASK THE READER SOMETHING BACK — stage 9.
//
// ── ★ THE DEFECT THIS FILE EXISTS TO CLOSE ────────────────────────────────────────────────────────
// `clarify_subject` carried `chips: [{symbol, name}]`. `clarify_operation` carried `chips: string[]`.
// Both were built correctly, and BOTH WERE DISCARDED BY THE ONLY CALLER THAT MATTERS: `sendMessage`
// reads `sections` off a `composed` result and takes `line` off everything else, so a live turn that
// resolved three candidate companies rendered as one sentence of grey text and nothing to press.
//
// The browser pass found it as "no candidate controls". It is not a rendering bug — the render was
// never reached. Chips that live in a field nobody reads are chips that do not exist.
//
// ── ★ EVERY CHIP IS A QUESTION THE READER COULD HAVE TYPED ────────────────────────────────────────
// An ambiguous "how is HDFC doing" offers "How is HDFCBANK doing?", not "HDFCBANK" — the reader's own
// sentence with the ambiguity resolved, so pressing it is indistinguishable from having asked
// precisely in the first place. That is also why disambiguation needs no stored state: the chip
// carries the whole question, so nothing has to be remembered between turns.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { chipSection, type Chip } from "../section/kinds/anchor.js";
import { blockCopy } from "../catalogue/block-copy.js";
import type { AnySection, AnswerProse } from "./contract.js";
import type { RoutedTurn } from "../router/contract.js";

/** What every turn hands the transcript, whatever branch produced it. */
export interface Renderable {
  readonly sections: readonly AnySection[];
  readonly prose: AnswerProse;
}

/**
 * Rewrite the reader's own question with one mention replaced by a resolved company.
 *
 * ★ THE QUESTION IS PRESERVED, NOT REGENERATED. "how is HDFC doing" becomes "how is HDFCBANK doing",
 * so the follow-up is the same question about a company that exists. Building a fresh sentence from
 * the operation slot would quietly change what was asked — and the operation is exactly the slot we
 * are least confident in on the branches that land here.
 */
function substituteMention(raw: string, mention: string, symbol: string): string {
  const i = raw.toLowerCase().indexOf(mention.toLowerCase());
  if (i < 0) return `${raw} (${symbol})`;
  return raw.slice(0, i) + symbol + raw.slice(i + mention.length);
}

/** One chip per candidate company — the reader disambiguates and re-asks in a single tap. */
export function subjectChips(turn: RoutedTurn): Chip[] {
  const mention = turn.router.subjects[0]?.text ?? "";
  return turn.subjectChoices.slice(0, 6).map((c) => ({
    label: c.symbol,
    question: substituteMention(turn.raw, mention, c.symbol),
    surface: c.name,
  }));
}

/**
 * Chips for a question whose OPERATION we could not read.
 *
 * ★ THEY NAME THE COMPANY WHEN ONE RESOLVED. The old set was four fixed strings — "How is it doing
 * overall?" — and "it" is the one word a reader who typed a bare ticker has no way to bind. With a
 * subject in hand these become sendable questions; without one they stay generic, which is honest,
 * because there genuinely is no subject to name.
 */
export function operationChips(symbol: string | null): Chip[] {
  const s = symbol ?? "it";
  return [
    { label: "Overall", question: `How is ${s} doing?`, surface: "Whole company" },
    { label: "Health", question: `Why is ${s} scored the way it is?`, surface: "Health score" },
    { label: "Flagged", question: `What has been flagged on ${s}?`, surface: "Findings" },
    { label: "Ownership", question: `Who owns ${s}, and has that changed?`, surface: "Ownership tool" },
    { label: "History", question: `Show ${s} across its last eight quarters`, surface: "Quarterly results" },
  ];
}

/** Build the renderable half of a branch that asks something back. */
export function askBack(opening: string[], chips: readonly Chip[], close = ""): Renderable {
  return {
    sections: [chipSection(chips) as AnySection],
    prose: { opening, leads: { "NEXT:chips": "" }, after: {}, close },
  };
}

// `isAdviceShaped` moved to router/question-shape.ts — see that file for why (the router needs it
// to decide follow-up inheritance, and a router importing the composer inverts the layering).
export { isAdviceShaped } from "../router/question-shape.js";

export const DECLINE_ADVICE = () => blockCopy("decline_advice");
