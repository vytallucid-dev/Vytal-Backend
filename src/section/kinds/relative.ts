// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIVE · peer-marker | own-history-band | opposed-bars | distribution-strip
//
// ★ THE KIND ANSWERS ONE QUESTION: COMPARED WITH WHAT? Every renderer here places a subject against a
//   REFERENCE SET, and the whole risk of the kind is a reference that is not stated. "+8% against its
//   peers" is meaningless until you know whether that is six peers or forty, and over what window.
//   So `referenceLabel` and `referenceCount` are required on every payload and appear in the digest.
//
// ⚠ A COMPARISON WITH A REFERENCE OF ONE IS NOT A COMPARISON, and it renders as an absent state
//   rather than a bar. This is the §3.4 defect in its relative form: a single-member "peer average"
//   is the stock compared with itself, drawn as though it were a market.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Coverage } from "../../resolve/contract.js";
import { digest, line, unchanged, withheld, type DigestLine, type Section } from "../contract.js";

export type RelativeRenderer = "peer-marker" | "own-history-band" | "opposed-bars" | "distribution-strip";

/** One thing placed on the scale. `display` is pre-formatted; `value` drives the geometry. */
export interface RelativeMark {
  readonly label: string;
  readonly value: number | null;
  readonly display: string;
  /**
   * ★ THE QUALIFICATION ON THIS ONE MARK'S FIGURE — a partial window, a redistributed pillar, a
   *   reference that could not be measured for it. `null` on a mark whose figure needs no caveat.
   *
   * ⚠ IT USED TO BE GLUED ONTO `display`, AND `verify:ux` FOUND WHAT THAT COST at the two narrow
   *   viewports: *"+0.8 pts across the window — measured across the 12 quarters of 14 in which it
   *   could be scored"* sat in the value column, which is `whitespace-nowrap` and right-aligned
   *   because it holds NUMBERS. One sentence made the grid 662px wide inside a 346px panel, and the
   *   whole card scrolled sideways on mobile.
   *
   * ★ THE FIX IS A SEPARATE FIELD RATHER THAN A SHORTER SENTENCE. Dropping the caveat would have
   *   fixed the layout by quoting a partial-window figure under a whole-window label — the same
   *   quiet lie the caveat was written to prevent (N-4). A number column holds a number; the words
   *   that qualify it wrap under the label, where words are allowed to.
   */
  readonly note?: string | null;
  /** `subject` is the thing asked about; `reference` is what it is being measured against. */
  readonly role: "subject" | "reference" | "member";
  /**
   * ★ WHICH SIDE OF A PAIRED COMPARISON THIS MARK BELONGS TO — a categorical slot, 0-based.
   *
   * ⚠ `role` COULD NOT CARRY THIS, AND THE COMPARISON CHART WAS UNREADABLE BECAUSE OF IT. In a
   *   side-by-side the marks alternate A, B, A, B down four pillars and a composite — ten bars — and
   *   `role` says only "is this the thing asked about". So both composites drew in one colour and all
   *   eight pillar bars drew grey: the reader could tell WHICH MEASURE each bar was from its label,
   *   and could not tell WHICH COMPANY without reading every label in full. A comparison chart whose
   *   two sides look identical has not compared anything.
   *
   * ★ A SLOT INDEX, NOT A COLOUR. The renderer owns the palette (`SERIES_HUES`, validated for CVD
   *   separation); a payload naming a hex would put a colour decision in the composer, where the
   *   next person to change the design system would never find it. It also generalises: a three-way
   *   comparison is slot 2, with no contract change.
   *
   * Absent on every renderer that places ONE subject against a set — a peer marker has no sides.
   */
  readonly series?: number;
}

export interface RelativePayload {
  /**
   * ★ `cr` ADDED AT PHASE 1 · BATCH 1, AND IT IS A PARAMETER RATHER THAN A RENDERER (§4.1).
   *
   * ⚠ THERE WAS NO MONEY UNIT, so F's "revenue against its own filed range" had to pick between
   *   `count` — which renders ₹1.42 lakh crore as the bare number 142000 — and `pct`, which would
   *   suffix it with a percent sign. Both are a figure the reader cannot read; the second is a
   *   figure that is actively wrong. Every other unit here already answers "what does this number
   *   mean", and money was simply missing from the list.
   */
  readonly unit: "pct" | "pp" | "score" | "count" | "x" | "cr";
  readonly marks: readonly RelativeMark[];
  /** WHAT the subject is being compared with, in words. Never omitted. */
  readonly referenceLabel: string;
  /** HOW MANY things the reference is made of. `null` when the reference is not a set. */
  readonly referenceCount: number | null;
  readonly windowLabel: string | null;
  /** Bands for `distribution-strip` — a histogram of the universe, not of one subject. */
  readonly bands: readonly { readonly label: string; readonly count: number }[];
}

export function relativeSection(
  input: {
    renderer: RelativeRenderer;
    heading: string;
    unit: RelativePayload["unit"];
    marks: readonly RelativeMark[];
    referenceLabel: string;
    referenceCount?: number | null;
    windowLabel?: string | null;
    bands?: readonly { label: string; count: number }[];
    /** The sentence when the comparison cannot honestly be drawn. Registry copy. */
    unavailablePhrase?: string | null;
  },
  coverage: Coverage,
): Section<"RELATIVE", RelativePayload> {
  const count = input.referenceCount ?? null;
  // ★ THE GUARD. A reference set of fewer than two members cannot support a comparison, so the marks
  //   are dropped rather than drawn — see the header. `distribution-strip` is exempt: its reference
  //   is the band histogram, which carries its own counts.
  const usable = input.renderer === "distribution-strip" || count === null || count >= 2;
  const marks = usable ? input.marks : [];

  const payload: RelativePayload = {
    unit: input.unit,
    marks,
    referenceLabel: input.referenceLabel,
    referenceCount: count,
    windowLabel: input.windowLabel ?? null,
    bands: input.bands ?? [],
  };

  const lines: DigestLine[] = [];
  if (!usable) {
    lines.push(withheld("Comparison", input.unavailablePhrase ?? `only ${count} in the reference set — too few to compare against`));
  } else if (marks.length === 0 && payload.bands.length === 0) {
    lines.push(unchanged("Comparison", input.unavailablePhrase ?? "nothing to compare against was held"));
  } else {
    for (const m of marks) {
      lines.push(m.value === null ? withheld(m.label, "no value held for this one") : line(m.label, m.display));
    }
    for (const b of payload.bands) lines.push(line(b.label, `${b.count}`));
  }
  // ★ ALWAYS, EVEN ON THE EMPTY CASE. The reference is what makes any of the above a claim.
  lines.push(line("Compared against", count === null ? input.referenceLabel : `${input.referenceLabel} (${count})`));
  if (payload.windowLabel) lines.push(line("Window", payload.windowLabel));

  return {
    kind: "RELATIVE",
    renderer: input.renderer,
    payload,
    digest: digest(input.heading, [{ label: input.referenceLabel, lines }]),
    coverage,
    interactions: [],
  };
}
