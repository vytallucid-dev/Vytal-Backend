// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 1 — MAGNITUDE ANCHORS. Where a figure SITS, so the reader can tell whether it is big.
// PURE: no database, no I/O, no prisma.
//
// ── ★ THE GAP THIS CLOSES ────────────────────────────────────────────────────────────────────────
// Every figure on the card is correctly rendered, glossed and compared, and almost none of them tells
// the reader whether the number is LARGE. "Margin narrowed 4.8 percentage points" is precise and
// meaningless to someone who does not know whether 4.8 is a lot. That was named as the honest limit of
// the last build and it is what this file exists to fix.
//
// ── ★★ THE ANCHOR IS A POSITION. IT IS NEVER A JUDGEMENT (1b) ────────────────────────────────────
//   ✅ "the lowest of the 5 companies in its peer group that filed this quarter"
//   ✅ "the widest fall in the 16 year-on-year comparisons on file"
//   ❌ "remarkably low"   ❌ "disciplined lending"   ❌ "a strong indicator"
// The arithmetic IS the anchor. The adjective is a verdict, and this product does not make them. Every
// string below is a count, a rank position or a period name; there is no adjective in this file that
// is not a direction word, and generate.ts's evaluative tier would refuse a brief that added one.
//
// ── ⚠ TWO SOURCES, AND THEY ANSWER DIFFERENT QUESTIONS (1a) ──────────────────────────────────────
//   PEER CROSS-SECTION  where this value sits among same-family co-members who filed the SAME quarter.
//                       Answers "is this ordinary for a company of this kind". Does not depend on how
//                       much history we hold — which matters, because half the universe has six
//                       quarters. MEASURED coverage: banking 12/12 cards, non-financial 111/124,
//                       NBFC 9/12, insurers 0 (no insurance peer group exists).
//   OWN HISTORY         where it sits against this company's own range on file. Answers "is this
//                       unusual for THIS company". Available wherever the depth floor is met, which is
//                       the constraint the peer source does not have.
//
// ── ⚠⚠ AND THE DEPTH FLOOR IS THE BINDING CONSTRAINT, MEASURED (1d) ──────────────────────────────
// The universe is BIMODAL, not thin: median 6 quarters on file, p75 = 20. 78.5% of stocks have ≥6
// quarters, but only 39.1% have ≥8 — the split is the Nifty-500 expansion (six quarters each) against
// the original 224 (twenty each). On YoY PAIRS it is starker: median 2, and only 39.4% of stocks have
// three or more.
//
// So a move anchor is structurally unavailable on three fifths of the universe, and saying "the widest
// fall on file" off two comparisons would be the false-precision this whole feature exists to avoid.
// The floors below are set where the claim starts meaning something, the COUNT IS ALWAYS NAMED so the
// reader can weigh it, and above DEEP_HISTORY the earliest period is named too — a claim over sixteen
// comparisons is a different claim from one over five and the sentence says which it is.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { metricGloss, type MetricKey } from "../../catalogue/quarter-metrics.js";
import {
  MONEY_STEADY_PCT, manifestFor, specFor, toDisplayValue, valueOf, withinBounds,
  type AnyFamilyQuarter, type Family, type MetricSpec,
} from "./manifest.js";
import type { PeerCrossSection } from "./peer-shape.js";
import { MIN_PEERS_FILED } from "./peer-shape.js";
import type { MetricLine } from "./quarter-section.js";

// ── The floors ─────────────────────────────────────────────────────────────────────────────────────

/** Values on file before "the lowest on file" says anything. Six is the universe MEDIAN, which is
 *  deliberate: it is the point below which a stock is in the thin cohort rather than at its edge. */
export const HISTORY_MIN_LEVELS = 6;

/** Like-for-like comparisons on file before a MOVE extreme is claimed. Four, because three would let
 *  "the widest fall of the 3 comparisons on file" onto a card, and a superlative over three is a
 *  sentence that sounds stronger than the evidence under it. */
export const HISTORY_MIN_MOVES = 4;

/** At or above this, the sentence also NAMES THE EARLIEST PERIOD. Twelve comparisons is three years,
 *  which is where "on file" stops meaning "since we started collecting" to a reader. */
export const DEEP_HISTORY = 12;

/** ★ THE ANCHOR BUDGET (1c). Anchoring all 22 banking metrics produces a wall in which every line
 *  reads as equally important, which is the same failure the margin round-trip note was cut for. Four
 *  is one always-anchored metric plus the three biggest movers — enough that the reader meets an
 *  anchor where it matters and not so many that they stop reading them. */
export const MAX_ANCHORS_PER_CARD = 4;

/** A metric must move at least this many of its OWN steady bands to be anchored on movement. Two,
 *  because one band is merely "not steady" — the band is already calibrated per metric at p25 of the
 *  universe's year-on-year moves, so two of them is a move in the top quartile of that metric's own
 *  distribution rather than a threshold invented here. */
const MATERIAL_BANDS = 2;

/**
 * ★ THE METRICS THAT ALWAYS CARRY AN ANCHOR WHERE ONE CAN BE BUILT (1c).
 *
 * ONE per family, and the choice is the figure that defines that kind of company — the one a reader
 * comparing two of them would ask about first, whether or not it moved this quarter. A bank whose bad
 * loans did not move still needs the reader to know whether 1.17% is a lot.
 */
export const ANCHOR_ALWAYS = {
  non_financial: "operatingMargin",
  banking: "grossNpaRatio",
  nbfc: "netMargin",
  life_insurance: "persistencyRatio13Month",
  general_insurance: "combinedRatio",
} as const satisfies Record<Family, MetricKey>;

// ── One anchor ─────────────────────────────────────────────────────────────────────────────────────

export interface Anchor {
  key: MetricKey;
  /** Which source produced it. Carried so a corpus scan can tell peer coverage from history coverage. */
  source: "peer" | "history_level" | "history_move";
  /** Why the metric was selected. `always` fires whether or not it moved. */
  reason: "always" | "moved";
  /** ★ A CLAUSE, NOT A SENTENCE, AND IT HAS NO SUBJECT ON PURPOSE. It is appended to the metric's own
   *  movement line, directly under that metric's own value, so naming the figure again would print the
   *  label twice inside one row. */
  display: string;
}

// ── Rendering helpers ──────────────────────────────────────────────────────────────────────────────

const quartersPhrase = (n: number, earliest: string | null): string =>
  n >= DEEP_HISTORY && earliest ? `the ${n} quarters on file, going back to ${earliest}` : `the ${n} quarters on file`;

const comparisonsPhrase = (n: number, kind: string, earliest: string | null): string =>
  n >= DEEP_HISTORY && earliest
    ? `the ${n} ${kind} comparisons on file, going back to ${earliest}`
    : `the ${n} ${kind} comparisons on file`;

/** ★ NEVER CLAIM AN EXTREME YOU CANNOT SHOW. Ratios render to one decimal and multiples to two, so a
 *  series whose whole range is finer than that prints as the same number on every row — and "the
 *  lowest of the 8 quarters on file" beside eight identical figures is a claim the card refutes.
 *  Same floor, and the same argument, as quarter-section.ts's `displayFloor`. */
const rangeFloor = (spec: MetricSpec): number => (spec.scale === "multiple" ? 0.005 : 0.05);

// ── Source 1 · THE PEER CROSS-SECTION ──────────────────────────────────────────────────────────────

/**
 * Where this figure sits among co-members, or null.
 *
 * ⚠ LEVELS ONLY, AND MONEY IS EXCLUDED BY THE CALLER. "Revenue ₹15,548 crore — the largest of the 6"
 * ranks a peer group by company size, which the reader can already see and which says nothing about
 * the quarter. That is degenerate case 5 and it is the one that would have looked most like a feature.
 */
function peerAnchor(key: MetricKey, mine: number, cs: PeerCrossSection): Anchor["display"] | null {
  const theirs = cs.values[key] ?? [];
  if (theirs.length < MIN_PEERS_FILED) return null;

  const above = theirs.filter((v) => v > mine).length;
  const below = theirs.filter((v) => v < mine).length;
  const same = theirs.length - above - below;

  // DEGENERATE · every co-member reported exactly this figure. Nothing sits either side.
  if (above === 0 && below === 0) return null;

  // ⚠⚠ ONE SET, ONE COUNT, ONE PHRASE — FOUND BY RENDERING HDFCBANK'S CARD. The first version wrote
  // the extreme as "the lowest of the 6 companies in its peer group that have filed this quarter"
  // (co-members PLUS this bank) while the Stage-2 comparison beside it wrote "of the 5 companies in
  // its peer group that have filed this quarter" (co-members ONLY). Identical wording, two different
  // sets, two different numbers, on one card. Both forms now count CO-MEMBERS and say so the same way,
  // so a reader meeting both meets one group.
  //
  // ⚠ AND A TIE AT THE END IS NOT AN EXTREME. "Lower than all 5" is false when one of them reported the
  // same figure, and false in the direction that flatters. MEASURED: 1% of positions carry a tie —
  // rare, real, and it falls through to the count form rather than to a superlative.
  const n = theirs.length;
  const where = `in its peer group that have filed this quarter`;
  if (same === 0 && below === 0) return `lower than all ${n} companies ${where}`;
  if (same === 0 && above === 0) return `higher than all ${n} companies ${where}`;

  // Not an extreme (68% of positions, MEASURED). A COUNT, never a percentile: a percentile over four
  // co-members is a statistic with no distribution behind it — degenerate case 1.
  return above >= below
    ? `lower than ${above} of the ${n} companies ${where}`
    : `higher than ${below} of the ${n} companies ${where}`;
}

// ── Source 2 · OWN HISTORY ─────────────────────────────────────────────────────────────────────────

/** Every bounded DISPLAY-unit value for this metric up to and including the current quarter, with the
 *  period each came from. A value outside its manifest bounds is excluded — the card refused to print
 *  it, so it must not become the yardstick either (degenerate case 11). */
function levelSeries(
  spec: MetricSpec,
  rows: AnyFamilyQuarter[],
  idx: number,
): { periodKey: string; value: number }[] {
  const out: { periodKey: string; value: number }[] = [];
  for (let i = 0; i <= idx; i++) {
    const raw = valueOf(rows[i], spec.key);
    if (raw === null || !withinBounds(spec, raw)) continue;
    out.push({ periodKey: rows[i].periodKey, value: toDisplayValue(spec, raw) });
  }
  return out;
}

function historyLevelAnchor(spec: MetricSpec, rows: AnyFamilyQuarter[], idx: number): string | null {
  const series = levelSeries(spec, rows, idx);
  if (series.length < HISTORY_MIN_LEVELS) return null;

  const current = series[series.length - 1];
  if (current.periodKey !== rows[idx].periodKey) return null; // this quarter's own figure was suppressed

  const values = series.map((s) => s.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi - lo < rangeFloor(spec)) return null; // degenerate case 9 — the whole range rounds to one number

  const atOrBelow = values.filter((v) => v <= current.value).length;
  const atOrAbove = values.filter((v) => v >= current.value).length;
  // Strict, or nothing. A tie with a prior quarter is not a record (degenerate case 8).
  const where = atOrBelow === 1 ? "lowest" : atOrAbove === 1 ? "highest" : null;
  if (!where) return null;

  return `the ${where} in ${quartersPhrase(series.length, series[0].periodKey)}`;
}

/** The prior row this row is compared against, under the SAME rule the card's own movement uses. */
function partnerOf(rows: AnyFamilyQuarter[], i: number, yearOnYear: boolean): AnyFamilyQuarter | null {
  if (!yearOnYear) return i > 0 ? rows[i - 1] : null;
  const fy = rows[i].fiscalYear;
  const m = /^FY(\d{2,4})$/.exec(fy);
  if (!m) return null;
  const prior = `FY${String(parseInt(m[1], 10) - 1).padStart(m[1].length, "0")}`;
  return rows.find((r) => r.quarter === rows[i].quarter && r.fiscalYear === prior) ?? null;
}

/** One row's movement in the unit the anchor compares: percent for money, display points otherwise.
 *  Null propagates every refusal the card itself makes — a percentage off a zero or negative base
 *  (rule 3, degenerate case 13) and a comparison against a suppressed figure. */
function moveOf(spec: MetricSpec, row: AnyFamilyQuarter, prior: AnyFamilyQuarter): number | null {
  const a = valueOf(row, spec.key);
  const b = valueOf(prior, spec.key);
  if (a === null || b === null || !withinBounds(spec, a) || !withinBounds(spec, b)) return null;
  if (spec.scale === "money") return b > 0 && a > 0 ? ((a - b) / b) * 100 : null;
  return toDisplayValue(spec, a) - toDisplayValue(spec, b);
}

function historyMoveAnchor(
  spec: MetricSpec,
  rows: AnyFamilyQuarter[],
  idx: number,
  yearOnYear: boolean,
): string | null {
  const moves: { periodKey: string; value: number }[] = [];
  for (let i = 0; i <= idx; i++) {
    const prior = partnerOf(rows, i, yearOnYear);
    if (!prior) continue;
    const d = moveOf(spec, rows[i], prior);
    if (d === null) continue;
    moves.push({ periodKey: rows[i].periodKey, value: d });
  }
  if (moves.length < HISTORY_MIN_MOVES) return null;

  const current = moves[moves.length - 1];
  if (current.periodKey !== rows[idx].periodKey) return null;

  const values = moves.map((m) => m.value);
  const atOrBelow = values.filter((v) => v <= current.value).length;
  const atOrAbove = values.filter((v) => v >= current.value).length;

  // A move anchor is only worth making at an EXTREME, and only in the direction the move actually went.
  // "The largest rise on file" for a figure that fell is arithmetically available and nonsense.
  const rising = current.value > 0;
  const isExtreme = rising ? atOrAbove === 1 : atOrBelow === 1;
  if (!isExtreme || current.value === 0) return null;

  const kind = yearOnYear ? "year-on-year" : "quarter-on-quarter";
  const word = spec.scale === "money" ? (rising ? "steepest rise" : "steepest fall") : rising ? "widest rise" : "widest fall";
  return `the ${word} in ${comparisonsPhrase(moves.length, kind, moves[0].periodKey)}`;
}

// ── Selection ──────────────────────────────────────────────────────────────────────────────────────

/** How many of its own steady bands this metric moved, or null when that cannot be judged.
 *  Money uses MONEY_STEADY_PCT — the verdict's own cut — so a line the badge calls a move is a line
 *  this file calls a move. Any metric with no band declared is not judged, never assumed steady. */
function bandsMoved(spec: MetricSpec, current: AnyFamilyQuarter, comparison: AnyFamilyQuarter | null): number | null {
  if (!comparison) return null;
  const d = moveOf(spec, current, comparison);
  if (d === null) return null;
  if (spec.scale === "money") return Math.abs(d) / MONEY_STEADY_PCT;
  if (spec.steadyBand === null || spec.steadyBand === 0) return null;
  return Math.abs(d) / spec.steadyBand;
}

export interface AnchorInputs {
  family: Family;
  /** Every quarter on file for this stock, oldest → newest. */
  rows: AnyFamilyQuarter[];
  /** Index of the quarter being written about. */
  idx: number;
  comparison: AnyFamilyQuarter | null;
  comparisonIsYearAgo: boolean;
  crossSection: PeerCrossSection | null;
  /** Metric keys that actually RENDERED on this card. A suppressed or unreported metric has no line
   *  to hang an anchor on — degenerate case 10, and the reason this is passed rather than re-derived. */
  rendered: ReadonlySet<MetricKey>;
}

/**
 * The anchors for one card, at most MAX_ANCHORS_PER_CARD, in the order they should be spent.
 *
 * ── THE RULE (1c) ────────────────────────────────────────────────────────────────────────────────
 *   1 · the family's ALWAYS metric, whether or not it moved;
 *   2 · then the metrics that moved at least MATERIAL_BANDS of their own steady band, largest first.
 *
 * ── AND THE SOURCE PRIORITY FOLLOWS THE REASON, WHICH IS NOT ARBITRARY ───────────────────────────
 *   selected as ALWAYS → PEER first. The question being answered is "is this ordinary for a company of
 *     this kind", and a cross-section answers it directly and without depending on our history depth.
 *   selected as MOVED → the MOVE anchor first. The question is "is this move unusual", and a peer
 *     LEVEL cannot answer it — a company can sit mid-group and still have had its worst quarter.
 * Each metric gets AT MOST ONE anchor, so a single figure never carries two competing positions.
 */
export function computeAnchors(input: AnchorInputs): Anchor[] {
  const { family, rows, idx, comparison, comparisonIsYearAgo, crossSection, rendered } = input;
  const current = rows[idx];

  const always = ANCHOR_ALWAYS[family] as MetricKey;
  const candidates: { key: MetricKey; reason: Anchor["reason"]; rank: number }[] = [];

  if (rendered.has(always)) candidates.push({ key: always, reason: "always", rank: Infinity });

  for (const spec of manifestFor(family)) {
    if (spec.key === always || !rendered.has(spec.key)) continue;
    const bands = bandsMoved(spec, current, comparison);
    if (bands === null || bands < MATERIAL_BANDS) continue;
    candidates.push({ key: spec.key, reason: "moved", rank: bands });
  }
  candidates.sort((a, b) => b.rank - a.rank);

  const out: Anchor[] = [];
  for (const cand of candidates) {
    if (out.length >= MAX_ANCHORS_PER_CARD) break;
    const spec = specFor(family, cand.key);
    if (!spec) continue;

    const raw = valueOf(current, cand.key);
    const mine = raw !== null && withinBounds(spec, raw) ? toDisplayValue(spec, raw) : null;

    // ⚠ MONEY IS NEVER PEER-ANCHORED ON ITS LEVEL — degenerate case 5, above.
    const peer =
      spec.scale !== "money" && crossSection && mine !== null ? peerAnchor(cand.key, mine, crossSection) : null;
    const move = historyMoveAnchor(spec, rows, idx, comparisonIsYearAgo);
    // ⚠ AND MONEY IS NEVER LEVEL-ANCHORED ON ITS HISTORY EITHER. MEASURED: "the highest revenue in the
    // N quarters on file" fires on 54% of non-financial cards and 84% of banking ones, because a
    // growing company sets a record almost every quarter. That is a restatement of growth wearing the
    // clothes of a magnitude anchor, and boilerplate on half the corpus is what 1c forbids.
    const level = spec.scale === "money" ? null : historyLevelAnchor(spec, rows, idx);

    const ordered: [Anchor["source"], string | null][] =
      cand.reason === "always"
        ? [["peer", peer], ["history_level", level], ["history_move", move]]
        : [["history_move", move], ["peer", peer], ["history_level", level]];

    const chosen = ordered.find(([, v]) => v !== null);
    if (!chosen) continue;
    out.push({ key: cand.key, source: chosen[0], reason: cand.reason, display: chosen[1]! });
  }

  return out;
}

/** The anchors, by metric key, for a renderer that walks the metric lines. */
export const anchorsByKey = (anchors: Anchor[]): Map<MetricKey, Anchor> =>
  new Map(anchors.map((a) => [a.key, a]));

/** The label a fact-text renderer needs when it names an anchored metric outside its own row. */
export const anchorLabel = (a: Anchor): string => metricGloss(a.key).label;

/**
 * ★★ THE ANCHOR IS ITS OWN FIELD. IT WAS FOLDED INTO `movement`, AND THE FOLD IS NOW UNDONE.
 *
 * The fold was the right call for one stage and the wrong one for this stage, and the reason is worth
 * keeping. It shipped because `BriefLine.comparison` already existed, already rendered and already
 * reached the grounding haystack — so an anchor riding it reached the reader with no schema change,
 * no renderer change and no second repo, where a new field would have been computed, stored and shown
 * to nobody until a frontend pass landed.
 *
 * ⚠ THAT PASS IS THIS ONE, AND THE FOLD HAS A COST THE FOLD COULD NOT PAY. Concatenated into the
 * movement, the anchor inherits the movement's typographic weight — which is the LOWEST-CONTRAST text
 * on the card. The highest-value new content in the build was rendering in the one style a reader
 * could not read, and no amount of frontend work can separate them again without splitting on "; ",
 * which is parsing our own prose: exactly the guessing-about-text that the prose renderer was deleted
 * for. A field cannot be un-concatenated. So it is a field.
 *
 * ⚠ `movement` IS NOW THE BARE MOVEMENT. Every consumer that wants both composes them — prompt.ts for
 * the fact text and the haystack, story.ts for the chain, schema.ts for the payload — each in one
 * place. Composing in three callers is the price of not having the two glued in the store.
 */
export function withAnchors(lines: readonly MetricLine[], anchors: Anchor[]): MetricLine[] {
  const by = anchorsByKey(anchors);
  return lines.map((l) => {
    const a = by.get(l.key);
    return a ? { ...l, anchor: a.display, anchorSource: a.source } : l;
  });
}

/** Movement and anchor as ONE string, for the two consumers that want a single sentence — the fact
 *  text and the story chain. Null only when the line has neither. Sentence-cased when the anchor
 *  stands alone: a card with no comparison period still has levels, and a level anchor is precisely
 *  the fact that survives when the comparison does not. */
export function movementWithAnchor(l: Pick<MetricLine, "movement" | "anchor">): string | null {
  if (l.movement && l.anchor) return `${l.movement}; ${l.anchor}`;
  if (l.movement) return l.movement;
  if (l.anchor) return `${l.anchor.charAt(0).toUpperCase()}${l.anchor.slice(1)}`;
  return null;
}
