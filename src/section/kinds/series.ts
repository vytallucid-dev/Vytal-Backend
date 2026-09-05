// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SERIES · composite-spine — a price line with its benchmark laid over it.
// SERIES · stepped-filing-line — quarterly filings, which STEP rather than flow.
//
// ★ TWO RENDERERS BECAUSE THE UNDERLYING FACTS HAVE DIFFERENT SHAPES, NOT TWO STYLES OF ONE CHART.
//   A price exists on every trading day and a line between two points is a real claim about the days
//   between them. A quarterly figure exists on four dates a year and NOTHING is true between them —
//   drawing a smooth line across a quarter asserts a trajectory nobody filed. Hence the step.
//
// ⚠ THE DIGEST NEVER CARRIES THE SERIES. A model given 750 daily closes will average them, quote a
//   midpoint, or invent a trend line — every one of which is a number it computed (N-1). It gets the
//   endpoints, the window, and the moves that are already computed facts. The browser gets the points.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Coverage } from "../../resolve/contract.js";
import { digest, line, unchanged, withheld, type DigestLine, type Section } from "../contract.js";

/** One plotted point. `value` is the raw number for the browser; the digest never sees these. */
export interface SeriesPoint {
  readonly at: string;
  readonly value: number;
}

export interface SpinePayload {
  readonly label: string;
  readonly unit: "inr" | "pct" | "cr";
  readonly points: readonly SeriesPoint[];
  /** Laid over the primary line, same axis. `null` when no benchmark resolved — never an empty array,
   *  which a renderer would draw as a flat line at zero. */
  readonly overlay: { readonly label: string; readonly points: readonly SeriesPoint[] } | null;
  /** Named marks a reader can orient by. Empty is fine. */
  readonly markers: readonly { readonly at: string; readonly label: string }[];
  readonly windowLabel: string | null;
}

export function spineSection(
  input: {
    heading: string;
    label: string;
    unit: SpinePayload["unit"];
    points: readonly SeriesPoint[];
    overlay?: { label: string; points: readonly SeriesPoint[] } | null;
    markers?: readonly { at: string; label: string }[];
    windowLabel?: string | null;
    /** Already-computed facts about the series. Values are pre-formatted strings (N-1). */
    facts: readonly { label: string; value: string | null; absentPhrase: string }[];
  },
  coverage: Coverage,
): Section<"SERIES", SpinePayload> {
  const payload: SpinePayload = {
    label: input.label,
    unit: input.unit,
    points: input.points,
    overlay: input.overlay ?? null,
    markers: input.markers ?? [],
    windowLabel: input.windowLabel ?? null,
  };

  const lines: DigestLine[] = [];
  lines.push(
    input.points.length === 0
      ? withheld("Series", "no points held for this window")
      : line("Points held", `${input.points.length}${payload.windowLabel ? ` across ${payload.windowLabel}` : ""}`),
  );
  for (const f of input.facts) {
    lines.push(f.value === null ? withheld(f.label, f.absentPhrase) : line(f.label, f.value));
  }
  lines.push(
    payload.overlay
      ? line("Compared against", payload.overlay.label)
      : withheld("Compared against", "no benchmark resolved for this stock"),
  );

  return {
    kind: "SERIES",
    renderer: "composite-spine",
    payload,
    digest: digest(input.heading, [{ label: input.label, lines }]),
    coverage,
    interactions: input.points.length > 1 ? [{ id: "window", kind: "toggle", label: "Change the window" }] : [],
  };
}

/** One filed period. Every field is already a string — see the header's N-1 note. */
export interface FilingRow {
  readonly period: string;
  readonly cells: readonly { readonly label: string; readonly value: string | null; readonly absentPhrase: string }[];
}

export interface SteppedPayload {
  readonly columns: readonly string[];
  readonly rows: readonly FilingRow[];
  /** Raw numeric series per column, for the step chart. Parallel to `columns`. */
  readonly plots: readonly { readonly label: string; readonly points: readonly SeriesPoint[] }[];
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★ THREE FIELDS ADDED AT PHASE 1 · BATCH 1, AND THEY ARE PARAMETERS RATHER THAN A NEW RENDERER.
   *
   * OA's flow answer is the register at every filing date — one step per filing, which is precisely
   * what this renderer's own header says it is for ("a quarterly figure exists on four dates a year
   * and NOTHING is true between them"). It could not draw it, for three reasons that are all
   * parameter gaps rather than shape gaps:
   *
   *   · `unit`      — the axis was hardcoded to crore, so a holding percentage would have been
   *                   labelled "₹71.77 Cr". A renderer that formats one unit is a renderer with a
   *                   constant where a field belongs.
   *   · one plot    — it plotted `plots.find(p => p.points.length > 1)`, i.e. the FIRST usable series
   *                   and no others. A register has four classes and drawing one of them silently is
   *                   the vanishing-component lie: the reader sees a chart of promoter holding and has
   *                   no way to know FII, DII and retail were dropped.
   *   · `title`     — the heading was the literal string "The last N quarters", which is true of a
   *                   results series and false of a shareholding series (these are FILINGS, and some
   *                   companies file five in a year).
   *
   * ⚠ NONE OF THAT MAKES IT A DIFFERENT RENDERER. The shape — discrete observations that hold until
   *   the next one — is identical, and the step is the honesty rule in both cases. §4.1's test asks
   *   whether a new entry is "a variant that should have been a parameter", and here the answer was
   *   yes, so it is one. Adding `stepped-holding-line` beside this would have been the variant.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  readonly unit: "cr" | "pct";
  /** What the card is called. `null` ⇒ the renderer's own quarters wording, for existing callers. */
  readonly title: string | null;
  /** Why this steps rather than slopes, in the words of whatever is being stepped. */
  readonly stepNote: string | null;
}

export function steppedFilingSection(
  input: {
    heading: string;
    columns: readonly string[];
    rows: readonly FilingRow[];
    plots?: readonly { label: string; points: readonly SeriesPoint[] }[];
    /** Defaults to `cr`, which is what every caller before this batch meant. */
    unit?: SteppedPayload["unit"];
    title?: string | null;
    stepNote?: string | null;
  },
  coverage: Coverage,
): Section<"SERIES", SteppedPayload> {
  const payload: SteppedPayload = {
    columns: input.columns,
    rows: input.rows,
    plots: input.plots ?? [],
    unit: input.unit ?? "cr",
    title: input.title ?? null,
    stepNote: input.stepNote ?? null,
  };

  // ★ THE DIGEST IS ONE GROUP PER PERIOD, NOT ONE LINE PER CELL FLATTENED. A model reading
  //   "Revenue: ₹72,275 Cr" with no period attached will attach it to whichever period it last saw.
  const groups = input.rows.map((r) => ({
    label: r.period,
    lines: r.cells.map((c) => (c.value === null ? withheld(c.label, c.absentPhrase) : line(c.label, c.value))),
  }));

  return {
    kind: "SERIES",
    renderer: "stepped-filing-line",
    payload,
    digest: digest(
      input.heading,
      groups.length ? groups : [{ label: "Nothing filed", lines: [unchanged("Periods held", "no filings in this window")] }],
    ),
    coverage,
    interactions: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SERIES · value-line — a CONTINUOUS quantity over time. Ruled in at T-1b (§4.1 amendment).
//
// ★ WHY THE OTHER FOUR COULD NOT DRAW IT. `composite-spine` and `phase-shaded-spine` fix a 0–100 axis
//   because a score has a real floor and ceiling; auto-fitting one would exaggerate a small move.
//   Money has neither, so that axis is wrong for it. `stepped-filing-line` steps because a quarterly
//   figure is true on four dates and nothing is true between them — a portfolio's value is true every
//   day, and stepping it would assert the opposite. `statement-trend` is a table of filed lines.
//
// ★ NAMED FOR THE SHAPE, NOT THE FAMILY. A portfolio's value, an instrument's NAV and a market cap
//   over time are one renderer with a different unit. The unit is on the payload.
//
// ⚠ THE AXIS IS FITTED, AND THAT IS THE OPPOSITE RULE FROM THE SPINE ABOVE — deliberately. A book
//   moving between ₹4.1L and ₹4.3L on a zero-based axis is a flat line that hides the whole story;
//   the same fit applied to a 0–100 score would invent drama. Different quantity, different honesty.
//
// ⚠ THE DIGEST GETS ENDPOINTS AND COMPUTED MOVES, NEVER THE POINTS — the same N-1 rule as the spine.
//   A model handed 750 daily values will average them and quote a number nobody computed.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface ValueLinePayload {
  readonly label: string;
  /** `inr` money · `cr` crore · `pct` a percentage series. Drives formatting AND the axis. */
  readonly unit: "inr" | "pct" | "cr";
  readonly points: readonly SeriesPoint[];
  /** What the window covers, in words. `null` when the series is too short to characterise. */
  readonly windowLabel: string | null;
  /**
   * ★ THE AXIS IS FITTED TO THE DATA, NOT ZERO-BASED — see the header. Carried on the payload rather
   * than computed in the renderer so the digest and the chart cannot disagree about what was drawn.
   * `null` on an empty series: a renderer must show its absent state, never an axis over nothing.
   */
  readonly range: { readonly min: number; readonly max: number } | null;
}

export function valueLineSection(
  input: {
    heading: string;
    label: string;
    unit: ValueLinePayload["unit"];
    points: readonly SeriesPoint[];
    windowLabel?: string | null;
    /** Already-computed facts. Pre-formatted strings — the model never divides two of these (N-1). */
    facts: readonly { label: string; value: string | null; absentPhrase: string }[];
  },
  coverage: Coverage,
): Section<"SERIES", ValueLinePayload> {
  const values = input.points.map((p) => p.value);
  const payload: ValueLinePayload = {
    label: input.label,
    unit: input.unit,
    points: input.points,
    windowLabel: input.windowLabel ?? null,
    range: values.length ? { min: Math.min(...values), max: Math.max(...values) } : null,
  };

  const lines: DigestLine[] = [];
  if (input.points.length === 0) {
    // ⚠ AN EMPTY SERIES IS A SENTENCE, NOT A BLANK CHART (N-4). A book with no history yet is a real
    //   and common state — a new account — and it must not read as a failure to load.
    lines.push(withheld(input.label, "no history held for this book yet"));
  } else {
    const first = input.points[0]!;
    const last = input.points[input.points.length - 1]!;
    lines.push(line(`${input.label} · first point`, `${first.at}`));
    lines.push(line(`${input.label} · latest point`, `${last.at}`));
    lines.push(line(`${input.label} · points held`, String(input.points.length)));
  }
  for (const f of input.facts) {
    lines.push(f.value === null ? withheld(f.label, f.absentPhrase) : line(f.label, f.value));
  }

  return {
    kind: "SERIES",
    renderer: "value-line",
    payload,
    coverage,
    digest: digest(input.heading, [{ label: input.label, lines }]),
    interactions: input.points.length > 1 ? [{ id: "window", kind: "toggle", label: "Change the window" }] : [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SERIES · phase-shaded-spine — THE SIXTH RENDERER, IMPLEMENTED RATHER THAN ADDED.
//
// ★★ THE ANSWER TO "DOES TRAJECTORY NEED A SEVENTH SERIES RENDERER" IS **NO**, AND THE REASON IS THAT
//    THE SIXTH WAS RESERVED FOR EXACTLY THIS AND HAS BEEN WAITING SINCE THE SPEC WAS WRITTEN.
//
//    `phase-shaded-spine` has sat in `RENDERERS.SERIES` since stage 3, declared and unimplemented —
//    §4.1's own sentence, "an unimplemented renderer is a gap you can see", pointing straight at this
//    family. The `RENDERERS` header names it in the same breath as `composite-spine`: "composite-spine
//    and phase-shaded-spine are continuous by construction" and both "fix a 0-100 axis". The list does
//    not grow, the ceiling is not touched, and nothing here is a variant of anything.
//
// ── ★ WHY IT IS NOT A PARAMETER ON `composite-spine`, WHICH IS THE ONE ALTERNATIVE THAT LOOKED REAL ─
// `composite-spine`'s payload is `{ label, unit, points, overlay, markers, windowLabel }` and its job
// is ONE line against ANOTHER — a price against its benchmark. Its whole shape is comparison against
// an overlay. This draws one line against a BACKGROUND: five shaded band ranges behind the plot,
// segments over it, and dated marks under it. Adding `phases` and `bands` to `SpinePayload` would put
// two mutually exclusive readings of `overlay` behind one renderer id — exactly the narrowing-at-
// runtime that `statement-table`'s ruling rejected — and would leave every existing caller carrying
// four fields that mean nothing to it.
//
// ── ★ WHAT IT ADDS THAT NOTHING ELSE HAS: A SEGMENTED READING OF ITS OWN LINE ─────────────────────
// Every other SERIES renderer plots points and stops. This carries a SECOND, DERIVED structure over
// the same points — where the level changed, and what it was on either side. That structure is the
// answer to the question the family exists for ("when did it turn"), and no existing payload has
// anywhere to put a segment.
//
// ── ⚠ THE BANDS ARE TOKENS, NEVER COLOURS ─────────────────────────────────────────────────────────
// `LABEL_BAND_MAP` carries a display hex. It stays in the frontend's palette: a backend that emits
// `#C0392B` has made a theming decision in a resolver, and the dark-mode variant then has two homes.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** One plotted quarter. `pillars` may hold `null` — see the resolver's note on stored-zero subtotals. */
export interface PhasePoint {
  readonly at: string;
  readonly value: number;
  readonly band: string;
  readonly pillars: Readonly<Record<string, number | null>>;
}

/** A run of quarters the level held. `stepFromPrior` is `null` on the first — nothing precedes it. */
export interface PhaseSegment {
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly mean: number;
  readonly band: string;
  readonly bandLabel: string;
  readonly stepFromPrior: number | null;
  readonly periods: number;
}

/** A dated mark under the axis. `kind` chooses the glyph; it never chooses a colour. */
export interface PhaseEvent {
  readonly at: string;
  readonly kind: "fired" | "expired" | "redistribution" | "turn";
  readonly label: string;
  readonly detail: string | null;
}

export interface PhaseSpinePayload {
  readonly label: string;
  readonly points: readonly PhasePoint[];
  readonly phases: readonly PhaseSegment[];
  /** The shaded background — the published mapping, lowest first. Tokens and bounds, never colours. */
  readonly bands: readonly { readonly band: string; readonly label: string; readonly min: number | null; readonly max: number | null }[];
  readonly events: readonly PhaseEvent[];
  readonly windowLabel: string | null;
  /**
   * ★ WHICH SERIES THIS IS, ON THE CARD. Two series exist for every company — our score and its
   *   filings — and they have different lengths and different meanings. A line with no basis has told
   *   the reader something they cannot check.
   */
  readonly basisNote: string;
  /** How the phases were found, in one reader sentence. Renders under the chart, never as a tooltip. */
  readonly methodNote: string;
}

export function phaseSpineSection(
  input: {
    heading: string;
    label: string;
    points: readonly PhasePoint[];
    phases: readonly PhaseSegment[];
    bands: PhaseSpinePayload["bands"];
    events: readonly PhaseEvent[];
    windowLabel?: string | null;
    basisNote: string;
    methodNote: string;
    /** Already-computed facts (N-1). Values are pre-formatted strings; `null` renders the phrase. */
    facts: readonly { label: string; value: string | null; absentPhrase: string }[];
  },
  coverage: Coverage,
): Section<"SERIES", PhaseSpinePayload> {
  const payload: PhaseSpinePayload = {
    label: input.label,
    points: input.points,
    phases: input.phases,
    bands: input.bands,
    events: input.events,
    windowLabel: input.windowLabel ?? null,
    basisNote: input.basisNote,
    methodNote: input.methodNote,
  };

  const lines: DigestLine[] = [];
  // ⚠ THE POINTS THEMSELVES NEVER REACH THE DIGEST (N-2, and the header's rule for every series). A
  //   model handed fourteen composites will average them, quote a midpoint, or narrate a trend it
  //   computed. It gets the PHASES — which are already-computed facts with authored words — and the
  //   endpoints, and nothing else.
  lines.push(
    input.points.length === 0
      ? withheld("Readings", "no scored quarter in this window")
      : line("Readings held", `${input.points.length}${payload.windowLabel ? ` across ${payload.windowLabel}` : ""}`),
  );
  if (input.phases.length === 0) {
    lines.push(withheld("Phases", "too few readings to look for a change in level"));
  } else if (input.phases.length === 1) {
    // ★ RULE 3 — ONE PHASE IS A FINDING AND IT IS STATED AS ONE. Omitting the line because there is
    //   nothing to segment reads to the model as "we could not do this", and it writes around a gap
    //   that is really a flat reading.
    lines.push(unchanged("Phases", `one — the level did not settle anywhere new across the window`));
  } else {
    lines.push(line("Phases", `${input.phases.length}, oldest first`));
    for (const p of input.phases) {
      lines.push(line(
        `${p.fromLabel} to ${p.toLabel}`,
        `${p.periods} quarter${p.periods === 1 ? "" : "s"} averaging ${p.mean.toFixed(1)} — ${p.bandLabel}` +
        (p.stepFromPrior === null ? " (the opening run)"
          : `, ${p.stepFromPrior > 0 ? "up" : "down"} ${Math.abs(p.stepFromPrior).toFixed(1)} on the run before it`),
      ));
    }
  }
  for (const f of input.facts) {
    lines.push(f.value === null ? withheld(f.label, f.absentPhrase) : line(f.label, f.value));
  }

  return {
    kind: "SERIES",
    renderer: "phase-shaded-spine",
    payload,
    digest: digest(input.heading, [{ label: input.label, lines }]),
    coverage,
    interactions: input.points.length > 1 ? [{ id: "window", kind: "toggle", label: "Change the window" }] : [],
  };
}
