// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// DECOMPOSITION · waterfall — §0.1's worked example, and the reason this stage exists.
//
// "A four-pillar decomposition delivered as SENTENCES is worse than the same decomposition delivered
// as a WATERFALL." The figures were never wrong; the shape was missing. This builds both objects from
// one resolve: bars for the browser, formatted lines for the model, and neither can see the other.
//
// ── ⚠ THE ABSENT BAR IS THE WHOLE TEST ────────────────────────────────────────────────────────────
// A pillar with `state: "unavailable_redistributed"` gets `bar: null` and an authored phrase — NOT a
// zero-height bar. Drawing it at zero says "this contributed nothing", which is false twice over:
// nothing was measured, and the OTHER bars are taller than their nominal weights because this one's
// weight was redistributed into them. Both halves of that have to reach the reader, so the renderer
// carries `weightApplied` beside `weightNominal` and states the redistribution.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { reasonPhrase } from "../../relational/coverage.js";
import { redistributionSentence } from "../../resolve/trajectory.js";
import type { PillarDecomposition, PillarKey } from "../../resolve/pillar-decomposition.js";
import type { Resolved } from "../../resolve/contract.js";
import type { AttributionRead } from "../../resolve/attribution.js";
import type { ChangeRead } from "../../resolve/trajectory.js";
import {
  digest, line, unchanged, withheld,
  type DigestGroup, type Section,
} from "../contract.js";

/** Reader-facing pillar names. One home — the renderer never title-cases an engine code itself. */
const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: "Foundation", momentum: "Momentum", market: "Market", ownership: "Ownership",
};

/** ★ ONE BAR. `value` is null for an unmeasured pillar and the renderer MUST draw an absent state for
 *  it — see N-4. `note` carries the authored phrase so the absent state has words, not a dash. */
export interface WaterfallBar {
  /**
   * ★ WIDENED FROM `PillarKey` TO `string` AT PHASE 2 · BATCH 1, AND IT IS A PARAMETER RATHER THAN A
   *   RENDERER (§4.1). A is a FIELD-grain decomposition of the same total — `Tier1`, `GNPA`, `NIM` —
   *   and the union could not name them. Nothing about the picture changes: a total, bars that sum to
   *   it, an absent state for what could not be measured. The key is still never rendered.
   */
  readonly key: string;
  readonly label: string;
  /** Contribution in composite points. `null` = not measured. Never 0-for-unknown. */
  readonly value: number | null;
  readonly subtotal: number | null;
  readonly weightApplied: number;
  readonly state: "scored" | "unavailable_redistributed" | "not_scored";
  readonly note: string | null;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★ THREE FIELDS ADDED FOR A · ATTRIBUTION, AND THE §4.1 TEST WAS RUN BEFORE ADDING THEM.
   *
   * The question was whether "the walk from 100 down to the score" is a SEVENTH `DECOMPOSITION`
   * renderer — the list is at 6 of 6, so it could not have one without an architecture ruling.
   *
   * ⚠ THE TEST THAT SETTLED IT IS THE ONE `statement-table` USED: does the payload GAIN fields, or is
   *   it REPLACED by a different shape? Here it gains three and keeps every existing one, and both
   *   readings draw the same picture — a total, bars that account for it, a note for the ones that
   *   could not be drawn. `basis` says which direction the eye travels. Compare `statement-trend`,
   *   where widening to N periods swapped the payload for a matrix and would have put two mutually
   *   exclusive shapes behind one renderer id. That was a renderer; this is a parameter.
   *
   * ★ AND THE ALTERNATIVE THAT LOOKED PLAUSIBLE WAS `margin-walk`, WHICH WAS DECLARED, UNIMPLEMENTED,
   *   AND IS LITERALLY THAT SHAPE — a bridge from one figure to another through signed steps. It was
   *   rejected at batch 1 on the `value-line` rule ("NAMED FOR THE SHAPE, NOT THE FAMILY"): a P&L name
   *   on a health chart. **Ruled and renamed to `bridge` at Phase 2 · Batch 2**, so the change
   *   decomposition now lives there — see `bridgeSection` below. This ruling stands unchanged: a
   *   SHORTFALL walk and a CHANGE bridge are two different objects and the contribution/shortfall
   *   split above is still a parameter, not a third renderer.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  /** Points BELOW a perfect reading. `null`, never 0, for a measure that could not be scored. */
  readonly gap?: number | null;
  /** Which pillar a field-grain bar sits under. Null on a pillar-grain bar. */
  readonly group?: string | null;
  /** Whether this bar is one measure or a whole pillar shown whole. */
  readonly grain?: "field" | "pillar";
  /** Where the value landed against its bar. ⚠ CONTEXT, NOT A VERDICT — see the resolver's note. */
  readonly band?: string | null;
  /** The most this bar could ever have contributed. Lets the renderer draw the ceiling honestly. */
  readonly ceilingShare?: number;
}

export interface WaterfallPayload {
  readonly symbol: string;
  readonly periodKey: string;
  readonly total: number;
  /** The persisted band token — the renderer maps it to a colour token, never to a hex. */
  readonly band: string;
  readonly bandLabel: string;
  readonly bars: readonly WaterfallBar[];
  /** Points the bars account for. Differs from `total` exactly when a pillar is unmeasured — stated
   *  rather than left for the reader to notice the bars do not sum. */
  readonly accountedFor: number;
  /**
   * ⚠ `redistributionReason` WAS HERE AND IS GONE. It carried an engine enum — `missing_pillar`,
   *   `market_unavailable` — and the frontend rendered it straight into a paragraph, so a reader on
   *   VEDL or LT was shown the literal token in a sentence slot. The first fix stopped rendering it
   *   and left the field; `C3 · every payload field is read by its renderer` then failed, correctly:
   *   a payload field with no reader is either a fact the reader was meant to get or a field that
   *   should not be in the payload, and this is the second. The enum still exists where it belongs,
   *   on `PillarDecomposition` and in the store. What crosses the boundary is the SENTENCE.
   */
  /** The authored sentence for the reader. `null` when no weight moved. */
  readonly redistributionNote: string | null;
  /** `contribution` — bars stack UP to the total. `shortfall` — bars step DOWN from `ceiling`. */
  readonly basis: "contribution" | "shortfall";
  /** The perfect reading a shortfall walk starts from. `null` on a contribution walk. */
  readonly ceiling: number | null;
  /**
   * ★ THE ARITHMETIC PROOF, CARRIED TO THE SCREEN. `false` means the bars do not account for the
   *   score — which means the per-pillar join is wrong, the exact defect `pillar-decomposition.ts`
   *   shipped once. A renderer must say so rather than draw a walk that does not close.
   */
  readonly reconciles: boolean;
  /** How far off the identity is, in composite points. */
  readonly residual: number;
  /** One sentence saying what the walk starts from and what it lands on. Always present. */
  readonly walkNote: string;
  /**
   * ★ THE FRAME, CARRIED AS STRUCTURE INSIDE ONE CARD RATHER THAN AS A SECOND CARD.
   *
   * ⚠ THE FIRST DRAFT OF A · ATTRIBUTION HAD TWO `DECOMPOSITION` SECTIONS — a four-pillar frame above
   *   a field-level walk — and it was wrong for a reason worth keeping: a reader shown two bar charts
   *   of the same score has to work out which one IS the score. The pillar structure is not a second
   *   answer, it is the grouping of the first, so it belongs in the payload as groups. Fifteen bars
   *   with no frame is also wrong; the frame just is not a separate chart.
   *
   * Empty on a contribution-basis walk, where every bar already IS a pillar.
   */
  readonly groups: readonly {
    readonly label: string;
    /** The pillar's own 0-100 reading. `null` when it could not be scored. */
    readonly subtotal: number | null;
    /** The weight ACTUALLY applied this period — post-redistribution, not the nominal one. */
    readonly weightApplied: number;
    readonly state: "scored" | "unavailable_redistributed";
  }[];
}

const pts = (v: number) => `${v.toFixed(1)} pts`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Build the section. Takes `Resolved<T>` and owns a visible absent state on BOTH arms (N-4) — the
 * ok:false path returns a real section with a real digest, not null. A composition that receives
 * `null` here would have to invent copy for the gap, which is how a component vanishing becomes a lie.
 */
export function waterfallSection(
  r: Resolved<PillarDecomposition>,
): Section<"DECOMPOSITION", WaterfallPayload | null> {
  if (!r.ok) {
    const phrase = reasonPhrase(r.absent.reason);
    return {
      kind: "DECOMPOSITION",
      renderer: "waterfall",
      payload: null,
      digest: digest("How the score breaks down", [
        { label: "Breakdown", lines: [withheld("Pillar contributions", phrase)] },
      ]),
      coverage: r.coverage,
      interactions: [],
    };
  }

  const d = r.data;
  const bars: WaterfallBar[] = d.parts.map((p) => ({
    key: p.pillar,
    label: PILLAR_LABEL[p.pillar],
    value: p.contribution,
    subtotal: p.subtotal,
    weightApplied: p.weightApplied,
    state: p.state,
    // The authored phrase for a pillar we could not score. `pillar_unavailable` is already in the
    // shared reason vocabulary (§3.2, N-5) — this defines no absent enum of its own.
    note: p.state === "scored" ? null : reasonPhrase("pillar_unavailable"),
  }));

  const accountedFor =
    Math.round(bars.reduce((a, b) => a + (b.value ?? 0), 0) * 100) / 100;

  const payload: WaterfallPayload = {
    symbol: d.symbol,
    periodKey: d.periodKey,
    total: Math.round(d.composite * 100) / 100,
    band: d.band,
    bandLabel: d.bandLabel,
    bars,
    accountedFor,
    // ★ THE AUTHORED SENTENCE, AND THE ONE THAT WAS MISSING. `redistributionSentence` is the single
    //   home for it — T's spine and A's walk render the same words, because it is the same fact.
    redistributionNote: redistributionSentence(
      d.redistributionReason,
      d.parts.filter((p) => p.state !== "scored").map((p) => p.pillar),
    ),
    basis: "contribution",
    ceiling: null,
    // The pillar walk closes by construction — `accountedFor` IS the sum of what was drawn, and the
    // gap to `total` is exactly the redistributed pillar, which is stated in its own digest group.
    reconciles: true,
    residual: 0,
    walkNote: `The four parts of the score, each shown at the weight actually applied this period. ` +
      `They add to ${pts(accountedFor)} of the ${pts(Math.round(d.composite * 100) / 100)} total.`,
    // Empty by construction: on a contribution walk every bar already IS a pillar, so a group layer
    // would be a list of one-member groups — furniture that says nothing.
    groups: [],
  };

  // ── THE DIGEST. Narrative order: the headline, then the parts largest-first, then what is missing.
  //    Schema order would be foundation/momentum/market/ownership every time; a person leads with
  //    whichever pillar did the most.
  const scored = bars.filter((b) => b.value !== null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const missing = bars.filter((b) => b.value === null);

  const groups: DigestGroup[] = [
    {
      label: "Where the score stands",
      lines: [
        // The band is the reader-facing WORD for the score and it belongs beside it in the digest —
        // a model handed "65.1 pts" alone will reach for its own adjective.
        line("Health score", pts(payload.total) + " — " + d.bandLabel),
        line("Period", d.periodKey),
      ],
    },
    {
      // ★ RULE 3 — EVERY RENDERED BAR APPEARS, INCLUDING THE ONES THAT DID NOTHING SURPRISING.
      //   A pillar omitted because it is unremarkable reads to the model as a pillar with no data,
      //   and it will write "we do not have momentum" rather than "momentum is doing its share".
      label: "What each part contributed",
      lines: scored.map((b) =>
        b.value !== null && Math.abs(b.value) < 0.05
          ? unchanged(b.label, `${pts(b.value)} (${pct(b.weightApplied)} weight) — no material contribution`)
          : line(b.label, `${pts(b.value!)} of the total, at ${pct(b.weightApplied)} weight`),
      ),
    },
  ];

  if (missing.length) {
    groups.push({
      label: "What is missing, and what it did to the rest",
      lines: [
        ...missing.map((b) => withheld(b.label, b.note!)),
        // ⚠ THE SECOND HALF OF THE ABSENCE. Without this the model can see a pillar is missing but not
        //   that the others are carrying its weight, and it will read the remaining bars as nominal.
        line(
          "Effect on the other parts",
          `${missing.map((m) => m.label).join(" and ")} could not be scored, so its weight was ` +
            `spread across the others — the parts shown carry more than their usual share.`,
        ),
        line("Bars account for", `${pts(accountedFor)} of the ${pts(payload.total)} total`),
      ],
    });
  }

  return {
    kind: "DECOMPOSITION",
    renderer: "waterfall",
    payload,
    digest: digest("How the score breaks down", groups),
    coverage: r.coverage,
    interactions: [{ id: "sort-contribution", kind: "sort", label: "Sort by contribution" }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// DECOMPOSITION · waterfall, SHORTFALL BASIS — A · Attribution's walk from 100 down to the score.
//
// Same renderer, same picture, read in the other direction. See `WaterfallBar`'s note for why this is
// a parameter and not a seventh `DECOMPOSITION` renderer, and why the CHANGE shape went to `bridge`.
//
// ── ⚠ WHAT THIS SECTION MUST NEVER DO, AND WHAT THAT COSTS IT ─────────────────────────────────────
// D-2 IS DECLINED, so no bar here publishes the CUT a measure was scored against. That is a real
// omission and it is worth naming rather than eliding: a reader can see that Cost-to-Income cost this
// bank 4.5 points and cannot see what number would have cost it nothing. The ruling is that the useful
// answer is "what is this and why does it matter", not "what number did it clear" — so the field's
// LANDING travels (`band`) and the THRESHOLD does not. A future widening of `ServedPatternFacts` is
// the only thing that changes this, and it would be an Operator ruling, not a build decision.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export function shortfallSection(
  r: Resolved<AttributionRead>,
  heading = "What the score is short of, and where",
): Section<"DECOMPOSITION", WaterfallPayload | null> {
  if (!r.ok) {
    const phrase = reasonPhrase(r.absent.reason);
    return {
      kind: "DECOMPOSITION",
      renderer: "waterfall",
      payload: null,
      digest: digest(heading, [{ label: "Breakdown", lines: [withheld("What is costing the score", phrase)] }]),
      coverage: r.coverage,
      interactions: [],
    };
  }

  const d = r.data;
  const bars: WaterfallBar[] = d.bars.map((b) => ({
    key: b.key,
    label: b.label,
    value: b.contribution,
    subtotal: b.score,
    weightApplied: b.ceilingShare / 100,
    state: b.state,
    note: b.note,
    gap: b.gap,
    group: b.group,
    grain: b.grain,
    band: b.band,
    ceilingShare: b.ceilingShare,
  }));

  const payload: WaterfallPayload = {
    symbol: d.symbol,
    periodKey: d.periodKey,
    total: d.composite,
    band: d.band,
    bandLabel: d.bandLabel,
    bars,
    accountedFor: d.gapAccountedFor,
    redistributionNote: d.redistributionNote,
    basis: "shortfall",
    ceiling: d.ceiling,
    reconciles: d.reconciles,
    residual: d.residual,
    walkNote:
      `Every measure starts at a perfect 100 and gives back what it actually scored. The bars below ` +
      `are what each one costs, largest first, and they add to ${pts(d.gapAccountedFor)} — which is ` +
      `exactly the distance from 100 down to ${pts(d.composite)}.`,
    groups: d.pillars.map((p) => ({
      label: p.label, subtotal: p.subtotal, weightApplied: p.weightApplied, state: p.state,
    })),
  };

  // ── THE DIGEST. Largest drag first, because that is the answer to the question asked. ────────────
  const drawn = d.bars.filter((b) => b.gap !== null);
  const missing = d.bars.filter((b) => b.gap === null);
  const groups: DigestGroup[] = [
    {
      label: "Where the score stands",
      lines: [
        line("Health score", `${pts(d.composite)} — ${d.bandLabel}`),
        line("Period", d.periodKey),
        line("Distance from a perfect reading", pts(Math.round((d.ceiling - d.composite) * 100) / 100)),
      ],
    },
    {
      // ★ RULE 3 AGAIN — EVERY DRAWN BAR APPEARS, including the ones costing almost nothing. A measure
      //   omitted because it is unremarkable reads to the model as a measure with no data.
      label: "What each measure costs the score",
      lines: drawn.map((b) =>
        b.gap !== null && b.gap < 0.05
          ? unchanged(b.label, `costs nothing — it is scoring at or near the top of its range`)
          : line(b.label,
              `costs ${pts(b.gap!)} of the ${pts(b.ceilingShare)} it could account for` +
              (b.band ? `, landing in the ${b.band.replace(/_/g, " ")} range` : "") +
              (b.grain === "pillar" && b.note ? ` — ${b.note}` : "")),
      ),
    },
  ];
  if (missing.length) {
    groups.push({
      label: "What could not be measured, and what it did to the rest",
      lines: [
        ...missing.map((b) => withheld(b.label, b.note ?? "could not be scored this period")),
        ...(d.redistributionNote ? [line("Effect on the other measures", d.redistributionNote)] : []),
      ],
    });
  }
  // ⚠ THE PROOF IS IN THE DIGEST TOO, so a model cannot narrate a walk that does not close.
  groups.push({
    label: "Does it add up",
    lines: [
      d.reconciles
        ? line("Reconciliation", `the bars account for the score exactly, to within ${Math.abs(d.residual).toFixed(2)} points of rounding`)
        : withheld("Reconciliation", `the bars do not account for the score — ${Math.abs(d.residual).toFixed(2)} points are unexplained, so this breakdown is not safe to read`),
    ],
  });

  return {
    kind: "DECOMPOSITION",
    renderer: "waterfall",
    payload,
    digest: digest(heading, groups),
    coverage: r.coverage,
    interactions: [{ id: "sort-contribution", kind: "sort", label: "Sort by what it costs" }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// DECOMPOSITION · bridge — a start value, signed steps, an end value.
//
// ★ THE RENAME THE OPERATOR RULED AT PHASE 2 · BATCH 2. It was `margin-walk`, declared for a P&L walk
//   and named for that family; the shape is a bridge and three callers now want it. The reasoning is
//   kept beside `set-table`'s in `section/contract.ts`, where the naming rule has worked examples.
//
// ── ⚠ EACH STEP IS SPLIT, AND THAT IS THE WHOLE REASON THIS EXISTS ────────────────────────────────
// A pillar's contribution can move because its READING moved or because its WEIGHT moved, and on the
// case this was built for the second is the larger half. Drawing only the total per pillar reproduces
// the naive chart the resolver's header shows to be wrong. Both halves travel; the renderer shows
// both; the digest states both.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export interface BridgeStep {
  readonly key: string;
  readonly label: string;
  /** The whole signed step, in the unit of the start and end values. */
  readonly delta: number;
  /** How the step splits, when it does. Empty ⇒ the step has one cause and needs no breakdown. */
  readonly parts: readonly { readonly label: string; readonly value: number }[];
  /** Why this step is the size it is, when the reason is not the obvious one. Authored, never a key. */
  readonly note: string | null;
}

export interface BridgePayload {
  readonly symbol: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly fromValue: number;
  readonly toValue: number;
  readonly steps: readonly BridgeStep[];
  /** Σ steps. `reconciles` is the proof it closes; see the shortfall walk's note on why that matters. */
  readonly accountedFor: number;
  readonly residual: number;
  readonly reconciles: boolean;
  /** What the two ends are, and what the split means. Always present. */
  readonly basisNote: string;
  /** Band labels for the two ends, so a step across a boundary reads as a change of label. */
  readonly fromBandLabel: string | null;
  readonly toBandLabel: string | null;
}

export function bridgeSection(
  r: Resolved<ChangeRead>,
  heading = "What moved the score, and how much of it was each part",
): Section<"DECOMPOSITION", BridgePayload | null> {
  if (!r.ok) {
    return {
      kind: "DECOMPOSITION",
      renderer: "bridge",
      payload: null,
      digest: digest(heading, [{
        label: "Change", lines: [withheld("What moved the score", reasonPhrase(r.absent.reason))],
      }]),
      coverage: r.coverage,
      interactions: [],
    };
  }

  const d = r.data;
  const steps: BridgeStep[] = [...d.steps]
    // Largest absolute mover first — the answer to "why did it fall" is the top row.
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .map((s) => ({
      key: s.key,
      label: s.label,
      delta: s.delta,
      // ⚠ NOT ON A CROSSING, AND NOT WHERE THE WEIGHT HELD. On a crossing both terms are exact and
      //   both are fiction — see `ChangeStep.crossing`. Where the weight simply held, a two-part
      //   breakdown is furniture that makes the common case look like the exceptional one.
      parts: s.crossing || Math.abs(s.weightEffect) < 0.05 ? [] : [
        { label: "its own reading moved", value: s.scoreEffect },
        { label: "its share of the score moved", value: s.weightEffect },
      ],
      note: s.note,
    }));

  const payload: BridgePayload = {
    symbol: d.symbol,
    fromLabel: d.fromPeriod,
    toLabel: d.toPeriod,
    fromValue: d.fromComposite,
    toValue: d.toComposite,
    steps,
    accountedFor: d.accountedFor,
    residual: d.residual,
    reconciles: d.reconciles,
    basisNote: d.basisSentence,
    fromBandLabel: d.fromBandLabel,
    toBandLabel: d.toBandLabel,
  };

  const groups: DigestGroup[] = [
    {
      label: "The move",
      lines: [
        line("From", `${pts(d.fromComposite)} at ${d.fromPeriod} — ${d.fromBandLabel}`),
        line("To", `${pts(d.toComposite)} at ${d.toPeriod} — ${d.toBandLabel}`),
        line("Change", `${d.delta > 0 ? "+" : ""}${d.delta.toFixed(1)} points`),
      ],
    },
    {
      // ★ RULE 3 — every part appears, including the ones that barely moved.
      label: "What each part did",
      lines: d.steps.map((s) =>
        Math.abs(s.delta) < 0.05
          ? unchanged(s.label, "did not move the score either way")
          : s.crossing
          // ⚠ NO SPLIT AND NO "ITS OWN READING" CLAUSE. Both halves are exact arithmetic over a stored
          //   zero and neither is a true sentence about the business — see `ChangeStep.crossing`.
          ? line(s.label,
              `${s.delta > 0 ? "+" : ""}${s.delta.toFixed(1)} points, and the whole of it is this part ` +
              `${s.weightReason === "became_scorable" ? "coming back into" : "dropping out of"} the score`)
          : line(s.label,
              `${s.delta > 0 ? "+" : ""}${s.delta.toFixed(1)} points` +
              (Math.abs(s.weightEffect) >= 0.05
                ? ` — ${s.scoreEffect > 0 ? "+" : ""}${s.scoreEffect.toFixed(1)} from its own reading and ` +
                  `${s.weightEffect > 0 ? "+" : ""}${s.weightEffect.toFixed(1)} from its share of the score changing`
                : "")),
      ),
    },
  ];

  const moved = d.steps.filter((s) => s.weightReason !== "none" && s.note);
  if (moved.length) {
    groups.push({
      label: "Why the shares changed",
      lines: moved.map((s) => line(s.label, s.note!)),
    });
  }

  groups.push({
    label: "Does it add up",
    lines: [
      d.reconciles
        ? line("Reconciliation", `the parts account for the whole move, to within ${Math.abs(d.residual).toFixed(2)} points of rounding`)
        : withheld("Reconciliation", `the parts do not account for the move — ${Math.abs(d.residual).toFixed(2)} points are unexplained, so this breakdown is not safe to read`),
    ],
  });

  return {
    kind: "DECOMPOSITION",
    renderer: "bridge",
    payload,
    digest: digest(heading, groups),
    coverage: r.coverage,
    interactions: [],
  };
}
