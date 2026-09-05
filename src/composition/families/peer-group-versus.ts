// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PG · TWO PONDS, SIDE BY SIDE — `peers.versus`, N-1.
//
// ── ⚠ THE DEFECT IT CLOSES, MEASURED ON THE LIVE PATH ─────────────────────────────────────────────
// "compare pharma and FMCG" answered about **FMCG alone**, and "pharma vs cement" about Cement alone.
// `resolvePeerGroupByName` hands the WHOLE sentence to `matchPondName`, which returns its single best
// match — so both ponds matched on one token each, one won, and the other was dropped with nothing
// said. Every figure in those answers is real and the reader asked about two sets. That is §6.2's
// confident-wrong-artifact, and the matcher's own header names the shape: "a near-miss … answers a
// question about six companies with a different six."
//
// ── ★ WHY THIS IS PG AND NOT COMPARISON — the §4.1 test, run fresh ────────────────────────────────
// Comparison's verdict asks "can these two fairly be compared?" — same family, same peer group. For
// two ponds that question is EMPTY: they are different sets of companies by construction, so the
// answer is always "different" and carries no information. The pond question is a different one —
// does each side have a readable median, and are the two membership counts close enough that the two
// medians mean comparable things. Different question, different answer, so it is not Comparison's;
// and it wants PG's substrate, so it is PG's.
//
// ── ★ ZERO NEW RENDERERS ──────────────────────────────────────────────────────────────────────────
// `RELATIVE : opposed-bars` already draws two entities' pillar values against each other with
// `series: 0|1` — `compose/blocks-subject.ts` uses it for the stock comparison. Two ponds' pillar
// MEDIANS are the same shape with a different subject, so RELATIVE stays at 4 of 6 and SERIES /
// DECOMPOSITION are untouched at their ceiling.
//
// ── ⚠ AND THE ANSWER NAMES ITS OWN SLICE ──────────────────────────────────────────────────────────
// 13 of 23 ponds carry a readable median — 78 of 253 possible pairs. 2,143 of 2,291 stocks belong to
// no pond at all. An answer that compares two ponds without saying how little of the market that
// covers invites the reader to generalise from six companies to a market.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { AnySection } from "../contract.js";
import { coverageSection } from "../../section/kinds/coverage.js";
import { relativeSection, type RelativeMark } from "../../section/kinds/relative.js";
import { chipSection } from "../../section/kinds/anchor.js";
import { resolvePeerGroupVersus, type VersusSide } from "../../resolve/peer-group-versus.js";
import type { MarketTurnResult } from "./market.js";

const PILLARS = ["foundation", "momentum", "market", "ownership"] as const;
const nice = (k: string): string => k.charAt(0).toUpperCase() + k.slice(1);
const score = (n: number | null | undefined): string | null => (n == null ? null : n.toFixed(1));

/** A pond named with its denominator attached, because the count never leaves the sentence. */
const named = (s: VersusSide): string =>
  `${s.name} (${s.aggregate?.scoredCount ?? 0} of ${s.memberCount} scored)`;

export async function composeVersusAnswer(raw: string): Promise<MarketTurnResult | null> {
  const r = await resolvePeerGroupVersus(raw);
  if (r === null) return null;
  // ⚠ An absent arm here is `read_failed` only — the resolver returns `null`, not an absence, for
  //   "this is not a two-pond question", so a failure must not be answered as though it were one.
  if (!r.ok) return null;
  const { a, b, bothReadable, universe } = r.data;

  const sections: AnySection[] = [
    coverageSection(r.coverage, `${a.name} against ${b.name}`) as AnySection,
  ];

  const opening: string[] = [];
  const leads: Record<string, string> = {};

  if (bothReadable) {
    const aa = a.aggregate!, ba = b.aggregate!;
    // ── the composite median, then each pillar's — one mark per side, paired by label ─────────────
    const marks: RelativeMark[] = [
      { label: `${a.name} · Health`, value: aa.medianComposite, display: score(aa.medianComposite)!, role: "member", series: 0 },
      { label: `${b.name} · Health`, value: ba.medianComposite, display: score(ba.medianComposite)!, role: "member", series: 1 },
    ];
    for (const k of PILLARS) {
      const va = aa.pillarMedians[k] ?? null;
      const vb = ba.pillarMedians[k] ?? null;
      // ⚠ A PILLAR NEITHER SIDE IS SCORED ON IS OMITTED, NOT DRAWN AT ZERO. §3.1, and the same rule
      //   the stock comparison applies one file over.
      if (va === null && vb === null) continue;
      marks.push(
        { label: `${a.name} · ${nice(k)}`, value: va, display: score(va) ?? "not scored", role: "member", series: 0 },
        { label: `${b.name} · ${nice(k)}`, value: vb, display: score(vb) ?? "not scored", role: "member", series: 1 },
      );
    }
    sections.push(relativeSection({
      renderer: "opposed-bars",
      heading: "Two ponds, side by side",
      unit: "score",
      marks,
      referenceLabel: `${named(a)} against ${named(b)}`,
      // ★ THE DENOMINATOR IS THE REFERENCE COUNT, not a decoration. Phase 1 · Batch 2: a group median
      //   over a changing member set misleads unless the count is on screen. Two sets, two counts, so
      //   the reference count is the SMALLER — the one that bounds how much either median can mean.
      referenceCount: Math.min(aa.scoredCount, ba.scoredCount),
    }, r.coverage) as AnySection);

    const gap = aa.medianComposite - ba.medianComposite;
    opening.push(
      `${named(a)} reads a median health score of ${score(aa.medianComposite)}; ${named(b)} reads ` +
      `${score(ba.medianComposite)}. ${Math.abs(gap) < 0.05 ? "The two medians are level." :
        `${gap > 0 ? a.name : b.name} sits ${Math.abs(gap).toFixed(1)} points higher.`}`,
    );
    // ⚠ THE SPREAD, BECAUSE A MEDIAN ALONE HIDES IT. Two ponds can share a median and be nothing
    //   alike; the tighter pond's median describes its members and the looser one's barely does.
    opening.push(
      `${a.name} runs from ${score(aa.range?.min.composite ?? null) ?? "—"} to ${score(aa.range?.max.composite ?? null) ?? "—"}, ` +
      `${b.name} from ${score(ba.range?.min.composite ?? null) ?? "—"} to ${score(ba.range?.max.composite ?? null) ?? "—"}. ` +
      `A median describes a tight set better than a spread-out one.`,
    );
    // ★ AND THE COUNTS ARE NOT THE SAME, WHICH IS ITSELF A LIMIT ON THE COMPARISON.
    if (aa.scoredCount !== ba.scoredCount) {
      opening.push(
        `The two sets are not the same size — ${aa.scoredCount} against ${ba.scoredCount} scored companies — ` +
        `so a median from one is a steadier figure than the median from the other.`,
      );
    }
    leads[`RELATIVE:opposed-bars#0`] =
      "The composite first, then each of the four pillars the score is built from — each pond's median, not any one company's.";
  } else {
    // ── ⚠ ONE SIDE (OR BOTH) HAS NO READABLE MEDIAN. THE CHART IS OMITTED WHOLE ─────────────────
    //   The same ruling C applies to companies: "the health section is now OMITTED WHOLE when a side
    //   is unscored". Drawing one pond's bars beside an empty column invites the reader to read the
    //   blank as a zero, and a pond with nothing scored is not a pond that scored badly.
    const unreadable = [a, b].filter((s) => s.aggregate === null);
    const readable = [a, b].filter((s) => s.aggregate !== null);
    opening.push(
      unreadable.length === 2
        ? `Neither ${a.name} nor ${b.name} has a company we score, so there is no median on either side ` +
          `to compare. ${a.memberCount} and ${b.memberCount} companies are on the two rosters respectively; ` +
          `what is missing is our reading of them, not their filings.`
        : `${unreadable[0]!.name} has no company we score — ${unreadable[0]!.memberCount} on the roster, ` +
          `none with a health reading — so there is no median to set against ${readable[0]!.name}. ` +
          `That is a gap in what we score, not a judgement on those companies.`,
    );
    if (readable.length === 1) {
      const ra = readable[0]!.aggregate!;
      opening.push(
        `For the record, ${named(readable[0]!)} reads a median of ${score(ra.medianComposite)} — but a ` +
        `one-sided figure is not a comparison, and it is not offered as one.`,
      );
    }
  }

  // ⚠ THE SLICE, ALWAYS. Both arms get it: an answer about two ponds must not read as an answer about
  //   the market, and the arm that compared nothing needs it just as much.
  opening.push(
    `${universe.readable} of the ${universe.ponds} peer groups we hold have enough scored members for a ` +
    `median to be read at all. Peer groups cover a small, named part of the market — most listed ` +
    `companies belong to none.`,
  );

  sections.push(chipSection([
    { label: a.name, question: `how is the ${a.name} peer group doing`, surface: "Peer groups" },
    { label: b.name, question: `how is the ${b.name} peer group doing`, surface: "Peer groups" },
  ]) as AnySection);

  return {
    kind: "composed",
    compositionId: "peers.versus",
    sections,
    prose: {
      opening,
      leads,
      after: {},
      close: bothReadable
        ? `Both figures are medians of a set we chose, at one quarter. Neither pond is ranked against ` +
          `the other by us — what is above is where each one's middle sits, side by side.`
        : `The rosters are what we can stand behind here. A comparison would need readings we do not ` +
          `compute for one of these sets.`,
    },
    missLogged: false,
  };
}
