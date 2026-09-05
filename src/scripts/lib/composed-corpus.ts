// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE COMPOSED CORPUS — what the three re-pointed gates scan, and the assertion that it is not empty.
//
// ── ★ THE FAILURE THIS FILE EXISTS TO PREVENT ─────────────────────────────────────────────────────
// `verify-number-grounding`, `verify-evaluative-tier` and `verify-filing-model-facing` built their
// corpora out of live chat-tool output. The tools die at the cut; a gate that then iterates an empty
// array does not fail — **it passes on nothing, and reports green.** §7.3 named that as the
// orphaned-gate failure mode and this codebase has produced it three times.
//
// So the corpus is built HERE, once, over the surface that replaced the tools — the composed answer —
// and `assertNonEmpty` is called before any assertion runs. A gate cannot accidentally skip it: it has
// no other way to get a corpus.
//
// ── ★ THREE SURFACES, BECAUSE THE THREE GATES ASK DIFFERENT QUESTIONS ─────────────────────────────
//   accessible  every word a reader gets, figures included  → number grounding
//   prose       ONLY the sentences a model wrote            → guardrail / evaluative tier
//   figures     every figure we STATE, as strings           → grounding's haystack
//
// Handing the guardrail gate the full text would have it scanning code-rendered band labels for model
// misbehaviour: every "Fragile" in a digest would read as an evaluative claim the model never made.
// The split is what keeps each gate testing the thing it is named for.
//
// ── ★ BOTH SUBJECT PATHS, ALWAYS (§3.5) ──────────────────────────────────────────────────────────
// The fixture list carries a healthy subject and a thin one. A gate proven on TCS alone has been run
// against half the contract and cannot say which half.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { route, lexicalClassifier } from "../../router/route.js";
import { composeTurn } from "../../composition/compose.js";
import { accessibleText, proseOnly, statedFigures } from "../../composition/accessible-text.js";
import { priceBlock } from "../../compose/blocks.js";
import type { AnySection } from "../../composition/contract.js";

export interface ComposedCase {
  readonly label: string;
  readonly question: string;
  readonly compositionId: string;
  readonly sections: readonly AnySection[];
  /** Everything the reader gets, figures included. */
  readonly accessible: string;
  /** ONLY the authored sentences. No figures. */
  readonly prose: string;
  /** Every figure the answer states, already formatted. */
  readonly figures: readonly string[];
  /** Every digest LABEL — "52-week range", "1-year return", "Scoring history". The product's own
   *  vocabulary, and the half of the answer that carries numbers as WORDS rather than as claims. */
  readonly labels: readonly string[];
}

/**
 * The questions the corpus is built from.
 *
 * ⚠ THE ROUTER IS LEXICAL HERE, NOT MODEL-BACKED, AND THAT IS DELIBERATE. A gate whose corpus depends
 * on a network call is a gate that goes green when the network is down (§6.5 measured the model at
 * 80–88% reproducibility besides). The lexical classifier is deterministic, so the corpus is the same
 * on every run and a diff in gate output means the PRODUCT changed.
 */
const QUESTIONS: readonly (readonly [string, string])[] = [
  ["healthy · whole company", "how is TCS doing"],
  ["healthy · ownership", "who owns TCS"],
  ["healthy · score", "why is TCS scored the way it is"],
  ["thin · whole company", "how is MOLBIO doing"],
  ["thin · ownership", "who owns MOLBIO"],
  ["healthy · financials", "tell me about RELIANCE financials"],
  ["bank · whole company", "how is HDFCBANK doing"],
];

let cached: ComposedCase[] | null = null;

export async function composedCorpus(): Promise<ComposedCase[]> {
  if (cached) return cached;

  // ★ THE PLANNER IS PINNED DETERMINISTIC FOR THE DURATION OF THE BUILD, AND THIS IS NOT A SHORTCUT.
  //   The router above is lexical; the PLANNER would still have called the model, which would make the
  //   corpus vary run to run (§6.5: 80–88% reproducible) and go dark when the network does. A gate
  //   whose corpus moves cannot tell "the product changed" from "the model rolled differently", and a
  //   gate that silently shrinks when the network is down is the empty-corpus failure by another door.
  //   `AI_PROVIDER=mock` is the planner's own documented switch to `deterministicPlan`.
  const savedProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "mock";
  try {
    return (cached = await build());
  } finally {
    if (savedProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = savedProvider;
  }
}

async function build(): Promise<ComposedCase[]> {
  const out: ComposedCase[] = [];
  for (const [label, question] of QUESTIONS) {
    const turn = await route(question, lexicalClassifier, null);
    const r = await composeTurn(turn, null);
    if (r.kind !== "composed") continue;
    out.push({
      label, question,
      compositionId: r.compositionId,
      sections: r.sections,
      accessible: accessibleText(r.sections, r.prose),
      prose: proseOnly(r.prose),
      figures: statedFigures(r.sections),
      labels: r.sections.flatMap((sec) => sec.digest?.groups.flatMap((g) => g.lines.map((l) => l.label)) ?? []),
    });
  }

  // ★ THE PRICE BLOCK IS ADDED DIRECTLY, NOT THROUGH A QUESTION, AND THE REASON IS STATED RATHER THAN
  //   HIDDEN. It is the only block carrying the label "52-week range", which
  //   `verify-number-grounding`'s vocabulary control needs in the haystack — and no phrasing reliably
  //   routes to it through the LEXICAL classifier, which is what this corpus deliberately uses. Adding
  //   it by hand keeps the corpus deterministic AND complete; routing to it would trade one for the
  //   other.
  const price = await priceBlock("TCS");
  if (price) {
    const prose = { opening: ["How the market has priced it."], leads: {}, after: {}, close: "" };
    out.push({
      label: "healthy · price (block, not routed)",
      question: "(direct)",
      compositionId: "block:price",
      sections: [price],
      accessible: accessibleText([price], prose),
      prose: proseOnly(prose),
      figures: statedFigures([price]),
      labels: price.digest.groups.flatMap((g) => g.lines.map((l) => l.label)),
    });
  }
  return out;
}

/**
 * ★ THE ASSERTION THAT MAKES A GREEN TICK MEAN SOMETHING.
 *
 * Called by every gate before it asserts anything. It fails LOUDLY — a thrown error, not a logged
 * warning — because the whole point is that a gate must not be able to report success over a corpus
 * that was never built.
 *
 * The floors are deliberately concrete rather than `> 0`: a corpus that collapsed from seven cases to
 * one is broken in a way that `length > 0` cannot see, and that is exactly how a gate keeps passing
 * while its coverage quietly drains away.
 */
export function assertNonEmpty(cases: readonly ComposedCase[], gate: string): void {
  const MIN_CASES = 4;
  const MIN_SECTIONS = 12;
  const MIN_CHARS = 2000;

  const sections = cases.reduce((a, c) => a + c.sections.length, 0);
  const chars = cases.reduce((a, c) => a + c.accessible.length, 0);
  const problems: string[] = [];
  if (cases.length < MIN_CASES) problems.push(`${cases.length} composed cases, floor is ${MIN_CASES}`);
  if (sections < MIN_SECTIONS) problems.push(`${sections} sections across the corpus, floor is ${MIN_SECTIONS}`);
  if (chars < MIN_CHARS) problems.push(`${chars} chars of reader-facing text, floor is ${MIN_CHARS}`);
  if (cases.every((c) => c.figures.length === 0)) problems.push("not one case states a figure");

  if (problems.length) {
    throw new Error(
      `[${gate}] EMPTY OR COLLAPSED CORPUS — this gate would have passed on nothing.\n` +
      problems.map((p) => `  · ${p}`).join("\n") +
      `\nA gate that iterates an empty corpus reports green while testing nothing (§7.3). Fix the corpus, never the floor.`,
    );
  }
  console.log(
    `  corpus: ${cases.length} composed answers · ${sections} sections · ${chars} chars · ` +
    `${cases.reduce((a, c) => a + c.figures.length, 0)} stated figures  [non-empty ✓]`,
  );
}
