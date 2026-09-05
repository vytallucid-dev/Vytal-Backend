// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CALLOUT · nothing-found — §4.2: "We looked and found nothing notable" IS a finding.
//
// ★ OMITTING THE SECTION IS NOT THE SAME STATEMENT, AND THE DIFFERENCE IS THE WHOLE POINT. A card that
// disappears when there is nothing to say is read as "this was not checked". A card that says nothing
// was found is read as "this was checked and is clean" — which is what actually happened, and is the
// more useful of the two sentences. N-4 in its sharpest form: a component that vanishes when data is
// thin is a lie, not an empty state.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Coverage } from "../../resolve/contract.js";
import { digest, line, unchanged, type Section } from "../contract.js";

export interface CalloutItem {
  readonly label: string;
  readonly detail: string;
  readonly severity: "critical" | "high" | "medium" | "low";
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★ THE BOUNDARY ON WHAT THIS ITEM CLAIMS — added Phase 2 · Batch 2 for PT · Patterns.
   *
   * ⚠ IT IS THE LOAD-BEARING HALF AND MUST NOT RENDER AS A DISCLAIMER AT THE BOTTOM. Every one of the
   *   catalogue's 132 entries carries a `doesntMean` while only 74 carry a description — `EntryBase`
   *   makes it the single universal requirement across all four registries, which is the product
   *   saying, structurally, that the limit of a claim matters more than the claim's elaboration.
   *   A component can hold both side by side; a paragraph cannot.
   *
   * ⚠ NEVER DEFAULTED. An invented boundary reads exactly like an authored one and is not. Absent
   *   means the registry holds none for that key, and the renderer drops the line rather than filling
   *   it — which is visible, unlike a plausible sentence nobody wrote.
   *
   * Optional, so `divergence`, `top-drags` and `largest-movers` are untouched: a magnitude does not
   * claim anything and therefore has nothing to bound.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  readonly doesntMean?: string;
  // ⚠ CARRIED VERBATIM AND NEVER LABELLED HERE. Two registers live in this corpus — "≠ x ≠ y" and
  //   "a warning to investigate — NOT a prediction" — and `lib/findings/boundary.ts` already picks the
  //   right label from the shape. Labelling it "does not mean" inverts the second one outright.
  /** The constituent forms of a consolidated finding, named. Empty elsewhere. */
  readonly subForms?: readonly string[];
}

export interface CalloutPayload {
  readonly items: readonly CalloutItem[];
  /** What was looked for. Present on the empty case too — "nothing found" is only meaningful beside
   *  a statement of what was searched for. */
  readonly lookedFor: string;
  /**
   * ★ WHAT THE SET ITSELF IS, when the list alone would be read wrongly — added for PT.
   *
   * ⚠ AN EMPTY FINDINGS LIST IS THREE DIFFERENT FACTS and the reader cannot tell them apart from the
   *   list: the rules ran and raised nothing; the rules could not run; or we hold rows but no proof
   *   the run completed. `nothing-found` renders one sentence for an empty set, and this is where the
   *   set's own witness travels so that sentence is the true one.
   */
  readonly setNote?: string | null;
  /** How many exist in total, when the list is capped. `null` when the list is complete. */
  readonly totalAvailable?: number | null;
}

export function calloutSection(
  lookedFor: string,
  items: readonly CalloutItem[],
  coverage: Coverage,
  /**
   * ★ WHICH KIND OF CALLOUT THIS IS, when it is not the general one — added Phase 1 · Batch 2.
   *
   * ⚠ EVERY NON-EMPTY CALLOUT WAS `divergence`, AND PG's MOVERS ARE NOT DIVERGENCES. A divergence is
   *   two readings of one company disagreeing; "HCLTECH rose 4.2 points and INFY slipped 6.1" is a
   *   set of moves, which is what `largest-movers` has been in `RENDERERS.CALLOUT` for since the
   *   closed set was written. Emitting the wrong renderer id is not cosmetic: the id is the contract
   *   the frontend dispatches on and the harness asserts over, so a mover rendered as a divergence is
   *   a section claiming to be evidence of something it is not.
   *
   * ⚠ NO COUNT CHANGES. `largest-movers` was already declared and merely unimplemented — §4.1's own
   *   point that "an unimplemented renderer is a gap you can see". This closes one; it does not open
   *   a slot. `nothing-found` still wins on an empty set whatever is asked for, because "we looked and
   *   found nothing" is one statement however the looking was framed.
   */
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ `divergence` KEPT, AND THE PARAMETER IS NOW REQUIRED — F-4, AND THE BRIEF'S PREMISE (MINE) WAS
  //    WRONG. The verification pass reported this renderer as "drawn and emitted by nothing" and the
  //    ruling was to delete it. Deleting it turned out to be unsafe, and the compiler said so: EIGHT
  //    call sites relied on this default.
  //
  // ★ SEVEN OF THE EIGHT PASS A LITERAL `[]`, so they always take the `nothing-found` branch below and
  //   the default never mattered to them. THE EIGHTH DOES NOT. `families/generic.ts` — the
  //   fall-through family for a question no family claimed — passes `missing.map(...)`, a real list of
  //   the data families we do not hold for this subject. When that list is non-empty this renderer is
  //   what draws it, in production, today.
  //
  // ⚠ SO THE DEFECT WAS NEVER "UNREACHABLE". It was UNREACHED BY THE CORPUS: the harness never drove
  //   the generic family into its missing-data branch, so the pair was absent from the emitted set and
  //   looked dead. A renderer that only one fall-through path can produce is exactly the kind that
  //   rots — which is why the reverse check now exists (`verify-answer-invariants` C5) and why the
  //   matrix has a case that reaches this branch.
  //
  // ★ THE PARAMETER IS REQUIRED RATHER THAN DEFAULTED, which is the part of the ruling that survives.
  //   A default renderer is how one gets chosen by accident; every caller now names its own.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  renderer: "divergence" | "largest-movers" | "top-drags" | "findings",
  extra: { setNote?: string | null; totalAvailable?: number | null } = {},
): Section<"CALLOUT", CalloutPayload> {
  const empty = items.length === 0;
  return {
    kind: "CALLOUT",
    // The renderer is chosen by the DATA, and `nothing-found` is a real renderer with a real visible
    // state — not a null return that a caller has to notice and paper over.
    renderer: empty ? "nothing-found" : renderer,
    payload: { items, lookedFor, setNote: extra.setNote ?? null, totalAvailable: extra.totalAvailable ?? null },
    digest: digest(
      empty ? "Nothing notable found" : "What stands out",
      [
        {
          label: empty ? "Checked and clear" : "Findings",
          lines: empty
            ? [unchanged("Result", `We checked ${lookedFor} and found nothing notable to raise.`)]
            : items.map((i) => line(i.label, i.detail)),
        },
      ],
    ),
    coverage,
    interactions: [],
  };
}
