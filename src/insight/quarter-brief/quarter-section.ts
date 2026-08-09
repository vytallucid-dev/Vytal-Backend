// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SECTION 1 — THE QUARTER. Every metric the family files, including the ones that did not move.
//
// ── ★ WHY "INCLUDING THE ONES THAT DID NOT MOVE" IS THE HEADLINE ─────────────────────────────────
// "Steady at 18.2%" is information, and its absence is a large part of why the shipped card reads
// thin. A card that mentions a margin only when it moved teaches the reader that silence means
// nothing happened — when in fact silence meant nobody checked. Every manifest metric present in the
// data appears here, with its movement or with the fact that it held.
//
// ── THREE RULES FOR "DID IT MOVE", ONE PER UNIT ──────────────────────────────────────────────────
//   money    — MONEY_STEADY_PCT (3%), which IS verdict.ts's LINE_MATERIAL_PCT. Deliberately not a
//              second threshold: a line reading "steady" on a card whose badge says the quarter moved
//              would contradict itself inside one view.
//   ratio    — that metric's OWN p25 band, from the manifest. A single shared floor calls 57.6% of
//              bank GNPA readings and 75% of general-insurance solvency readings unchanged.
//   multiple — an absolute move in times-over. Percentage points are a category error on a multiple.
//
// ── ⚠ SUPPRESSION IS STATED, NEVER SILENT ────────────────────────────────────────────────────────
// A metric outside its manifest bounds is withheld WITH ITS REASON, and the reason is surfaced into
// the card's gaps. The live case is SBILIFE's five persistency ratios, stored at roughly one
// hundredth of their true value: withheld, and the reader is told they were withheld. A metric that
// silently vanished would read as a metric the company does not report.
//
// ── WHAT THIS MODULE DOES NOT DECIDE ─────────────────────────────────────────────────────────────
// Nothing about the takeaway, the driver, the verdict or the peers. It answers one question —
// "what did this family file this quarter, and what does each figure mean" — and stops.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { metricGloss, type MetricKey } from "../../catalogue/quarter-metrics.js";
import { changeFact, QOQ_REF, YOY_REF } from "./change.js";
import { combinedRatioPlain, marginPct, money, moneyLoss, pointMove, times } from "./format.js";
import {
  manifestFor,
  toDisplayValue,
  valueOf,
  withinBounds,
  type AnyFamilyQuarter,
  type MetricSpec,
} from "./manifest.js";

/** ONE metric, as the reader meets it. Every string here is a candidate for the model to reproduce
 *  verbatim, so each one is rendered exactly once, here. */
export interface MetricLine {
  key: MetricKey;
  /** From the gloss catalogue — never the filed column's name. */
  label: string;
  meaning: string;
  doesntMean: string;
  /** The canonical rendering. The ONLY string the model may reproduce for this figure. */
  display: string;
  /** The DISPLAY-unit number behind it (fractions already multiplied). Feeds the grounding allowlist. */
  value: number;
  /** How it moved, in the reader's words, or the statement that it held. Null when nothing to compare. */
  movement: string | null;
  /** True ⇔ inside this metric's steady band. Null when there is no comparison period. */
  steady: boolean | null;
  /** The same figure said in words, where the bare number means nothing on its own. */
  plain?: string;
  /** A fall is the favourable direction — carried so a renderer cannot supply its own (wrong) reading. */
  lowerIsBetter: boolean;
  /** ★ STAGE 1 — WHERE THIS FIGURE SITS, as a clause with no subject ("the lowest of the 5 companies
   *  in its peer group that have filed this quarter").
   *
   *  ⚠ ATTACHED AFTER THIS MODULE HAS RUN, by anchors.ts, from fact-block.ts. The peer half of an
   *  anchor needs a database read and this module is pure; and `movement` carries a COPY of the same
   *  clause so that every renderer and the fact text pick it up with no change of their own. This
   *  field exists for provenance — which metric got an anchor, and from which source — not so that a
   *  second renderer can compose its own sentence out of it. */
  anchor?: string;
  /** Which source the anchor came from. Read by story.ts, which drops a metric's Stage-2 peer
   *  COMPARISON when its Stage-1 anchor already carries the same counts — one peer statement per
   *  metric. Never rendered. */
  anchorSource?: "peer" | "history_level" | "history_move";
}

/** A metric withheld because it was outside the range where it means what its gloss says. */
export interface SuppressedMetric {
  key: MetricKey;
  label: string;
  /** The reader's words, from the manifest. Surfaced into gaps — never dropped. */
  reason: string;
}

export interface QuarterSection {
  lines: MetricLine[];
  suppressed: SuppressedMetric[];
  /** Metrics the family declares but did not file this quarter. Distinct from suppressed: absent is
   *  "the company did not report it", suppressed is "it reported something that cannot be read". */
  notReported: MetricKey[];
}

/** THE canonical rendering for one metric's value, by scale. One figure, one string. */
function renderValue(spec: MetricSpec, displayValue: number): string {
  switch (spec.scale) {
    case "money":
      return displayValue < 0 ? moneyLoss(displayValue) : money(displayValue);
    case "multiple":
      return times(displayValue);
    // `fraction` has already been multiplied into percent by toDisplayValue; both render the same way.
    case "percent":
    case "fraction":
      return marginPct(displayValue);
  }
}

/** ★ NEVER CLAIM A MOVE YOU CANNOT SHOW. Ratios render to one decimal and multiples to two, so a
 *  delta below half of that last place ROUNDS TO ZERO on the page.
 *
 *  ⚠ FOUND IN THE FIRST STAGE-2 RENDER, and it is not cosmetic. Banking's return-on-assets carries a
 *  0.03pp steady band — correctly, because the metric genuinely moves that little — so a 0.04pp move
 *  cleared the band, was called a move, and printed "up 0.0 percentage points against the same quarter
 *  last year". The reader is shown a number that says nothing changed and a sentence that says
 *  something did. Whichever they believe, we told them the other.
 *
 *  The floor is therefore the DISPLAY's, not the metric's, and it is deliberately applied AFTER the
 *  steady band rather than folded into it: the band answers "is this material", this answers "can we
 *  render it". A metric whose band is finer than its precision needs both. */
const displayFloor = (spec: MetricSpec): number => (spec.scale === "multiple" ? 0.005 : 0.05);

/** Movement for a RATIO or MULTIPLE, in its own unit. Money lines go through `changeFact` instead,
 *  because only they have the zero/negative-base problem that rule 3 exists for. */
function ratioMovement(spec: MetricSpec, current: number, prior: number, reference: string): string {
  const delta = toDisplayValue(spec, current) - toDisplayValue(spec, prior);
  const band = spec.steadyBand ?? 0;
  if (Math.abs(delta) < band || Math.abs(delta) < displayFloor(spec)) {
    return `steady at ${renderValue(spec, toDisplayValue(spec, current))} ${reference}`;
  }
  const direction = delta > 0 ? "up" : "down";
  const size = spec.scale === "multiple" ? times(Math.abs(delta)) : pointMove(delta);
  return `${direction} ${size} ${reference}`;
}

/** Drop a movement's opening repeat of the value printed beside it. Exact prefix only — nothing here
 *  reformats, rounds or rewrites, so a movement that does NOT open with the value is returned
 *  untouched and a future change.ts wording cannot be silently mangled by it. */
function stripLeadingValue(movement: string | null, value: string): string | null {
  if (!movement || !movement.startsWith(value)) return movement;
  const rest = movement.slice(value.length);
  // ⚠ BOTH SEPARATORS. `moneyAgainst` uses ", against …" when the two periods point the same way and
  // "; the year before, …" when they REVERSED — and the reversal is the case the sentence exists for,
  // so a strip that only knew the comma would leave the stutter on exactly the interesting rows.
  const m = /^(?:, |; )/.exec(rest);
  return m ? rest.slice(m[0].length) : movement;
}

/** One metric line, or null when the family did not file it, or a suppression when it filed
 *  something outside the range where the gloss is true. */
function buildLine(
  spec: MetricSpec,
  current: AnyFamilyQuarter,
  comparison: AnyFamilyQuarter | null,
  reference: string,
): { line: MetricLine } | { suppressed: SuppressedMetric } | { notReported: true } {
  const raw = valueOf(current, spec.key);
  if (raw === null) return { notReported: true };

  // ⚠ THE MEANING CHECK, not an arithmetic one. Everything it rejects divided correctly.
  if (!withinBounds(spec, raw)) {
    return {
      suppressed: {
        key: spec.key,
        label: metricGloss(spec.key).label,
        reason: spec.outOfRangeReason ?? "the reported figure is outside the range this measure can take",
      },
    };
  }

  const gloss = metricGloss(spec.key);
  const displayValue = toDisplayValue(spec, raw);

  // The comparison is only usable when the PRIOR figure is also inside its bounds. Comparing against a
  // value we refused to print would produce a movement the reader cannot check against anything.
  const priorRaw = comparison ? valueOf(comparison, spec.key) : null;
  const priorUsable = priorRaw !== null && withinBounds(spec, priorRaw);

  let movement: string | null = null;
  let steady: boolean | null = null;

  if (priorUsable) {
    if (spec.scale === "money") {
      const c = changeFact(`${spec.key}.change`, raw, priorRaw, reference, gloss.label.toLowerCase());
      // ⚠⚠ THE VALUE IS ALREADY PRINTED BESIDE THIS, SO A MOVEMENT THAT OPENS WITH IT STUTTERS —
      // FOUND BY RENDERING TTML, and it predates this stage:
      //
      //   "Net profit: a ₹72 crore loss — a ₹72 crore loss, against a ₹325 crore loss in the same
      //    quarter last year"
      //
      // Two of changeFact's kinds name BOTH absolutes by design (`both_loss` and `large_move`), which
      // is right for a caller that has no value column of its own — story.ts renders exactly those
      // strings into "Net profit stood at …" and needs the figure in them. This caller does have one.
      // So the repeat is stripped HERE, where the duplication exists, rather than by weakening a
      // string a second consumer depends on.
      movement = stripLeadingValue(c?.display ?? null, renderValue(spec, displayValue));
      // `little changed` is changeFact's own sub-0.5% wording; the 3% steady band is a wider, separate
      // judgement and is computed here rather than inferred from that string.
      steady =
        priorRaw > 0 && raw > 0 ? Math.abs(((raw - priorRaw) / priorRaw) * 100) < 3 : null;
    } else {
      movement = ratioMovement(spec, raw, priorRaw, reference);
      // Same two floors, in the same order, so the flag and the sentence can never disagree.
      const d = Math.abs(displayValue - toDisplayValue(spec, priorRaw));
      steady = d < (spec.steadyBand ?? 0) || d < displayFloor(spec);
    }
  }

  return {
    line: {
      key: spec.key,
      label: gloss.label,
      meaning: gloss.meaning,
      doesntMean: gloss.doesntMean,
      display: renderValue(spec, displayValue),
      value: displayValue,
      movement,
      steady,
      lowerIsBetter: spec.lowerIsBetter ?? false,
      // The combined ratio is the one metric whose bare percentage means nothing to this reader.
      ...(spec.key === "combinedRatio" ? { plain: combinedRatioPlain(displayValue) } : {}),
    },
  };
}

/**
 * Build Section 1 for one quarter.
 *
 * `comparison` is the period every movement is measured against — the year-ago quarter where one is on
 * file, else the previous quarter. YoY is preferred because a single quarter against the one before it
 * is seasonality as often as it is performance.
 */
export function buildQuarterSection(
  current: AnyFamilyQuarter,
  comparison: AnyFamilyQuarter | null,
  comparisonIsYearAgo: boolean,
): QuarterSection {
  const reference = comparisonIsYearAgo ? YOY_REF : QOQ_REF;
  const lines: MetricLine[] = [];
  const suppressed: SuppressedMetric[] = [];
  const notReported: MetricKey[] = [];

  for (const spec of manifestFor(current.family)) {
    const out = buildLine(spec, current, comparison, reference);
    if ("line" in out) lines.push(out.line);
    else if ("suppressed" in out) suppressed.push(out.suppressed);
    else notReported.push(spec.key);
  }

  return { lines, suppressed, notReported };
}
