// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE RESTATEMENT — what was screened on, in a sentence, generated FROM the validated tree.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THIS IS THE ACTUAL GUARD, AND VALIDATION IS NOT.
//
// A well-formed tree can still be the wrong reading. `(pharma OR banking) AND pledge>50` and
// `pharma OR (banking AND pledge>50)` both validate, both execute, and return different companies —
// nothing in the validator can tell them apart, because both are things a reader might have meant.
//
// ★ A READER CANNOT CHECK A NESTED CONDITION TREE. They can check a sentence. So the answer opens
//   with one, before the table, and it is the thing they are invited to disagree with.
//
// ── ⚠ GENERATED FROM THE STRUCTURE, NEVER WRITTEN BY THE MODEL ───────────────────────────────────
// If the model wrote both the tree and the sentence, the two could drift — the sentence describing
// what it meant while the tree did something else, and the reader would be checking the wrong
// artifact with complete confidence. Built here from the ACCEPTED tree, the sentence cannot lie about
// what ran: it is the same object, said twice.
//
// ── ★ WHAT IT CARRIES ────────────────────────────────────────────────────────────────────────────
//   the conditions as read · the basis · the population searched · the count
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { ScreenNode } from "./screen-grammar.js";
import type { LeafResult, Universe } from "../resolve/screen-evaluate.js";

const n = (x: number): string => x.toLocaleString("en-IN");

/**
 * ★ THE TREE, IN WORDS. Bracketing is made explicit wherever it could matter — an `or` nested inside
 *   an `and` is exactly the ambiguity this sentence exists to expose, so it gets parentheses rather
 *   than a comma.
 */
function say(node: ScreenNode, leaves: readonly LeafResult[], next: { i: number }, depth = 0): string {
  switch (node.op) {
    case "and": {
      const parts = node.nodes.map((x) => say(x, leaves, next, depth + 1));
      const joined = parts.length === 2 ? parts.join(" and ")
        : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
      return depth > 0 ? `(${joined})` : joined;
    }
    case "or": {
      const parts = node.nodes.map((x) => say(x, leaves, next, depth + 1));
      const joined = parts.length === 2 ? parts.join(" or ")
        : `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
      // ⚠ AN `or` INSIDE ANYTHING IS ALWAYS BRACKETED. It is the operator whose scope changes the
      //   answer, and the reader has to be able to see where it ends.
      return depth > 0 ? `(${joined})` : joined;
    }
    case "not":
      return `not ${say(node.node, leaves, next, depth + 1)}`;
    default:
      return leaves[next.i++]?.label ?? "a condition we could not name";
  }
}

const UNIVERSE_WORDS: Record<Universe, (size: number) => string> = {
  scored: (s) => `${n(s)} companies we score`,
  filed: (s) => `${n(s)} companies that have filed the figures`,
  findings: (s) => `${n(s)} companies the checks ran on`,
  sector: (s) => `${n(s)} companies with a sector on file`,
  peerGroup: (s) => `${n(s)} companies that are in a peer group`,
  priced: (s) => `${n(s)} companies we can price`,
  series: (s) => `${n(s)} companies with the quarters on file`,
};

export interface RestatementInput {
  readonly tree: ScreenNode;
  readonly leaves: readonly LeafResult[];
  readonly narrowest: {
    readonly universe: Universe; readonly size: number; readonly intersected: boolean;
    readonly words?: (size: number) => string;
  };
  readonly matched: number;
  /** Named by the reader, or resolved per company. */
  readonly basisRequested: "standalone" | "consolidated" | null;
  readonly basisSplit: { readonly standalone: number; readonly consolidated: number } | null;
  /** Set when the model's reading was refused and the AND-only extractor ran instead. */
  readonly fellBackBecause: string | null;
  /** Which sentence to use — see the note at the fallback branch. */
  readonly fellBackKind: "unavailable" | "refused" | null;
  /** ★ True only where the sentence carried an "or"/"not" the AND-only fallback could have lost. */
  readonly fallbackCouldDiffer?: boolean;
  /** ★ The reader's ranking, in words. `null` where they named none. */
  readonly order: { readonly label: string; readonly direction: "desc" | "asc" } | null;
  readonly limit: number | null;
}

/**
 * The paragraph that goes above the table. One sentence per fact, so a reader can disagree with a
 * specific one rather than with the whole thing.
 */
export function restate(input: RestatementInput): string[] {
  const out: string[] = [];

  // 1 · WHAT WAS SCREENED ON — the tree, in words.
  out.push(`Companies ${say(input.tree, input.leaves, { i: 0 })}.`);

  // 2 · BASIS. Only where a filed figure was actually read; a band-only screen has no basis.
  const filed = input.leaves.some((l) => l.universe === "filed");
  if (filed) {
    if (input.basisRequested) {
      out.push(`Read on the ${input.basisRequested} basis, because you asked for one.`);
    } else if (input.basisSplit && input.basisSplit.standalone > 0 && input.basisSplit.consolidated > 0) {
      out.push(
        `Read on the basis we default to for each company's industry — ${n(input.basisSplit.consolidated)} `
        + `consolidated and ${n(input.basisSplit.standalone)} standalone — and the column says which.`,
      );
    } else if (input.basisSplit && input.basisSplit.standalone + input.basisSplit.consolidated > 0) {
      // ⚠ AND ONLY WHERE A ROW WAS ACTUALLY READ. On an empty result both counts are zero and the
      //   ternary below fell through to "consolidated" — so "banks with gross NPA below 0.1%" said
      //   «Read on the consolidated basis» about no rows at all, while the same screen at 2% said
      //   standalone. A basis is a property of figures that were read, not a default to print.
      const only = input.basisSplit.standalone > 0 ? "standalone" : "consolidated";
      out.push(`Read on the ${only} basis.`);
    }
  }

  // 3 · THE POPULATION AND THE COUNT — the two numbers that make the result checkable.
  // ★ THE UNIVERSE WORD ONLY WHERE IT IS ACCURATE. Where the conditions spanned universes the honest
  //   sentence is the bare count — the intersection has no one-word name, and inventing one says
  //   something false about the book.
  // ★ AND A LEAF MAY NAME ITS OWN POPULATION. A trend's denominator is "companies with five quarters
  //   on file" — the depth floor said once, as the number's own description, rather than as a warning
  //   after it.
  out.push(
    input.narrowest.intersected
      ? `Searched ${n(input.narrowest.size)} companies; ${n(input.matched)} matched.`
      : `Searched ${(input.narrowest.words ?? UNIVERSE_WORDS[input.narrowest.universe])(input.narrowest.size)}; `
        + `${n(input.matched)} matched.`,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // 3b · ★★ THE ORDERING AND THE LIMIT, STATED — because a reader who asked for the top 10 by revenue
  //      and received the top 10 by health score CANNOT TELL. The ranking is invisible in a table:
  //      every row looks equally plausible whatever it was sorted on.
  //
  // ⚠ AND IT IS ONLY SAID WHERE THE READER ASKED. Announcing an ordering we chose would be presenting
  //   our own arrangement as their request — SC-12's ruling one step along.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (input.order) {
    const dir = input.order.direction === "asc" ? "lowest first" : "highest first";
    // ⚠ THE TRIM MUST CUT A BOUND, NOT A NAME. "distance below the 52-week high" contains the word
    //   "below", so the old pattern cut it to "distance" and the sentence read «Ranked by distance».
    //   A bound is a comparator word followed by something NUMERIC — requiring that leaves a field
    //   whose own name contains a comparator word intact.
    const noun = input.order.label
      .replace(/^(with|in|showing|labelled) /, "")
      .replace(/ (at least|above|at most|below|exactly) [^ ]*[\d₹∞].*$/, "");
    out.push(
      input.limit !== null
        ? `Showing the top ${n(input.limit)} by ${noun}, ${dir}.`
        : `Ranked by ${noun}, ${dir}.`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ THE "N COULD NOT BE CHECKED" SENTENCE WAS HERE AND HAS BEEN REMOVED — Operator's call, and it
  //    costs nothing, which is the part worth writing down.
  //
  //    It read: "233 companies could not be checked for showing Pledging Crisis and are in neither the
  //    matched set nor its complement." Every word true. What it did to a reader was different: a
  //    third qualifying sentence above a correct list reads as the product hedging, and the answer
  //    stops looking reliable long before anyone works out that it is.
  //
  // ★ AND THE THIRD STATE DOES NOT DEPEND ON IT, WHICH IS WHY THIS IS NOT A LOSS OF HONESTY. The
  //   evaluator never puts an unevaluable company in a leaf's `population` — see the header of
  //   `screen-evaluate.ts` — so the number in the sentence above ("Searched 2,057") ALREADY excludes
  //   them. The reader is told the denominator the check actually ran on; they are simply not
  //   lectured about the difference. The counts still reach the model in `digestTotals` and the
  //   coverage header still names the gap.
  //
  // ⚠ WHAT WOULD BE A REAL LOSS is the population arithmetic changing so that unchecked companies
  //   fall into the denominator. That is the thing to protect, and it is protected by construction
  //   rather than by prose.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  // 5 · ★ THE FALLBACK, SAID PLAINLY. A narrower reading honestly labelled beats a refusal — but only
  //      if the label is there.
  //
  // ⚠ AND THE SENTENCE DEPENDS ON WHY. "The parser was busy" is not the reader's problem and must not
  //   read as though they phrased something wrong; a refusal we can name IS worth naming. The first
  //   draft printed a truncated 429 JSON blob under a correct answer.
  // ⚠ AND ONLY WHERE IT COULD HAVE CHANGED THE ANSWER. The fallback is AND-only; on a sentence with
  //   no "or" and no "not" it produces the IDENTICAL set, and the disclosure is then a warning about
  //   nothing — the shape that makes a correct answer read as an unreliable one. Said on every
  //   fallback, it trained readers to distrust answers that were exactly right.
  if (input.fellBackBecause && input.fallbackCouldDiffer) {
    out.push(
      input.fellBackKind === "refused"
        ? `One note on how this was read: ${input.fellBackBecause}. It was screened with every `
          + `condition required together, which is narrower than "or" if that is what you meant.`
        : `This was read with the simpler of our two methods — ${input.fellBackBecause} — so every `
          + `condition was required together. If you meant "or", ask again in a moment.`,
    );
  }

  return out;
}

/**
 * ★ THE DROPPED CONDITION, STATED — the rule the question bank calls dropped-filter, and the worst
 *   item on the list before this batch.
 *
 * ⚠ "Pharma companies with revenue above 100cr" USED TO IGNORE "pharma" AND RETURN THE WHOLE MARKET —
 *   a wrong answer that looks right. Sector now filters (2,290 of 2,291 carry one), so the usual case
 *   is that nothing is dropped at all. This is for what remains: a condition we recognised as a
 *   condition and could not run.
 *
 * ★ AND IT BELONGS IN THE RESTATEMENT rather than under the table, because a reader who sees "pharma"
 *   missing from the sentence knows before reading a single row.
 */
export function dropped(conditions: readonly string[]): string | null {
  if (conditions.length === 0) return null;
  return conditions.length === 1
    ? `One thing in your question was not applied: ${conditions[0]}.`
    : `${conditions.length} things in your question were not applied: ${conditions.join("; ")}.`;
}
