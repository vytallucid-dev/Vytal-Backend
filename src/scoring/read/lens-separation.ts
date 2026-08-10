// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE THREE-LENS SEPARATION SECTION — composed here, rendered there.
//
// ── WHAT IT IS ────────────────────────────────────────────────────────────────────────────────────
// The peer group's metric-level lens findings, grouped BY METRIC instead of by company. A lens finding
// says one member sits on one side of the field on one metric; four of them presented per stock read
// as four unrelated facts about four companies. Grouped by the metric they read as ONE fact about the
// group — this is the axis these companies separate on, and here is which side each is on. That is
// the comparison a peer-group page exists to make, and it is the only place in the product that can
// make it.
//
// ── ★ THE ONE THING THIS FILE HAD TO DECIDE: WHAT "DIRECTION" MEANS ───────────────────────────────
// Direction was not served. Every escalated lens finding carries `direction: "negative"` and the PG
// census carries no direction column at all, so the side had to be derived — see field-side.ts for
// the derivation and for why it is checked against the primitive rather than trusted.
//
// The axis is L2, THE PEER LENS, and that choice is the section's whole register. L1 (the absolute
// bar) is a universal judgement and would make the same claim on every pond in the product; L2 is the
// only lens that is about THIS GROUP. So a block never says a member is bad — it says which side of
// this field it is on, which stays true and stays useful when the group as a whole is excellent.
//
//     above   LM3 — below the metric's bar, but ABOVE this field on it
//     below   LM7 — below the bar, BELOW this field, and below its own past
//
// ⚠ AND THE TWO SENTENCES ARE NOT MIRROR IMAGES, DELIBERATELY. They open identically — "N of the M
//   sit {above|below} the field on it" — so two poles of one metric read as one metric with two
//   poles. What follows differs because the faces differ: LM3's whole point is that the member leads
//   a field that is itself under the bar, and LM7's is that all three readings agree. Writing them as
//   a single sentence with one word swapped would have been prettier and would have claimed, of every
//   LM3 block, something only LM7 supports.
//
// ── PEER-RELATIVE, ALWAYS ─────────────────────────────────────────────────────────────────────────
// No valence, no instruction, no movement promise, no figure. A group of excellent companies still
// has a lower side, and if the copy does not carry that the section becomes a ranking. The section's
// boundary line says it once, in words, at the foot of the section; the sentences say it by never
// naming a quality — only a side and a bar.
//
// PURE. No DB, no I/O — the peer-group read service hands it rows it has already loaded.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { countWord, CountWord } from "../../lib/count-words.js";
import { lensFieldSide, type LensFieldSide } from "../lens-patterns/field-side.js";
import type {
  PeerGroupLensSeparation,
  PeerGroupLensSeparationBlock,
  PeerGroupLensSeparationPole,
} from "./peer-group-view.types.js";

/** One metric-level lens census row, as the peer-group read already has it. */
export interface LensSeparationRow {
  /** "LM3" | "LM7" — the face id, structurally recovered from the composed key. */
  face: string;
  metricKey: string;
  pillar: "foundation" | "momentum";
  /** Symbols firing this face on this metric, in the census's own order. */
  members: string[];
}

/** Number agreement, baked in rather than patched at the join. */
const sits = (n: number): string => (n === 1 ? "sits" : "sit");
const theirIts = (n: number): string => (n === 1 ? "its" : "their");

/**
 * ★ THE TWO POLE SENTENCES.
 *
 * `it` is the METRIC, which the block heading names immediately above — the same construction the
 * results-season sentence uses for its date, and the reason neither sentence has to repeat a label
 * the heading already carries in the catalogue's own words.
 *
 * "the bar" is this product's established word for a metric's own absolute threshold (the field-lens
 * section already speaks of clearing it and trailing it), so neither sentence introduces vocabulary.
 */
export function poleSentence(side: LensFieldSide, n: number, outOf: number): string {
  const head = `${CountWord(n)} of the ${countWord(outOf)} ${sits(n)}`;
  if (side === "above") {
    // LM3 — leads a field that is itself under the bar. The trailing clause is what stops "above the
    // field" reading as praise, which is the difference between a comparison and a ranking.
    return `${head} above the field on it, and still below the bar.`;
  }
  // LM7 — all three readings agree, which is the only case in the escalating set where they do.
  return `${head} below the field on it, below the bar, and below ${theirIts(n)} own past readings.`;
}

/**
 * ★ THE EMPTY STATE IS A FINDING, NOT AN ABSENCE.
 *
 * A pond where no lens fires is a pond whose members do not separate cleanly on any single metric,
 * and that is a real and useful thing to know about a group — arguably more useful than any one
 * block, because it says the companies are alike where the model measures them. Three of the thirteen
 * scored ponds are in this state today, so it is an ordinary answer rather than an edge case, and it
 * gets a composed sentence rather than a shrug.
 *
 * ⚠ IT CLAIMS ONLY WHAT THE ABSENCE SUPPORTS. "No member sits clearly on one side" is exactly what no
 *   fired face means. It does NOT claim the group is tightly clustered on every raw number — members
 *   of these ponds do sit below bars; what none of them does is land far enough to one side of the
 *   field for the lens library to say so.
 */
export const EMPTY_SENTENCE =
  "No single metric separates this group. On every measure it scores, no member sits clearly on one " +
  "side of the field — these companies are alike where they are measured.";

/**
 * The section's interpretive boundary. One per section rather than one per block: the blocks are the
 * same kind of claim about the same group, and repeating the caveat four times would make it wallpaper
 * by the second block.
 */
export const SEPARATION_DOESNT_MEAN =
  "A side of this field, not a verdict on a company. Every group has a lower side, including a group " +
  "of strong ones — so this says where a member sits inside this pond, and nothing about where it " +
  "sits outside it.";

/**
 * Group the metric-level lens rows by METRIC and compose each pole's line.
 *
 * ORDERED BY HOW MANY MEMBERS THE METRIC CAUGHT, DESCENDING — never by severity and never
 * alphabetically. The metric separating most of the group is the most informative thing the section
 * has to say about the group, whatever weight any individual reading carries: a `high`-severity face
 * catching one member says less about a pond of ten than a `medium` one catching four. Ties break on
 * the metric key so the order is stable across reads.
 *
 * `outOf` is the cross-section size — the same M the pathology census counts against.
 */
export function buildLensSeparation(
  rows: readonly LensSeparationRow[],
  outOf: number,
): PeerGroupLensSeparation {
  const byMetric = new Map<string, { pillar: "foundation" | "momentum"; poles: PeerGroupLensSeparationPole[] }>();

  for (const r of rows) {
    const side = lensFieldSide(r.face);
    // A face with no side is not a separation — LM6 sits AT the field, and the LP faces are pillar
    // roll-ups with no single peer position. Neither can head a block, so neither enters one.
    if (!side) continue;
    if (r.members.length === 0) continue;

    const bucket = byMetric.get(r.metricKey) ?? { pillar: r.pillar, poles: [] };
    bucket.poles.push({
      face: r.face,
      side,
      memberCount: r.members.length,
      members: [...r.members],
      sentence: poleSentence(side, r.members.length, outOf),
    });
    byMetric.set(r.metricKey, bucket);
  }

  const blocks: PeerGroupLensSeparationBlock[] = [...byMetric.entries()]
    .map(([metricKey, b]): PeerGroupLensSeparationBlock => ({
      metricKey,
      pillar: b.pillar,
      // ★ THE ORDERING KEY IS THE METRIC'S TOTAL, ACROSS BOTH POLES. A metric that caught three on one
      //   side and two on the other separates five of the group and outranks one that caught four on
      //   a single side — which is the point of grouping by metric rather than by finding.
      memberCount: b.poles.reduce((a, p) => a + p.memberCount, 0),
      outOf,
      // Heavier pole first; `below` wins a tie, so the two poles of one metric always appear in the
      // same order as each other across every pond.
      poles: b.poles.sort(
        (x, y) => y.memberCount - x.memberCount || (x.side === y.side ? 0 : x.side === "below" ? -1 : 1),
      ),
    }))
    .sort((a, b) => b.memberCount - a.memberCount || a.metricKey.localeCompare(b.metricKey));

  return {
    blocks,
    emptySentence: blocks.length === 0 ? EMPTY_SENTENCE : null,
    doesntMean: SEPARATION_DOESNT_MEAN,
  };
}
