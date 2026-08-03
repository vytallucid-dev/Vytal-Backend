// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — MARGIN SERIES. PURE: no database, no I/O, no prisma.
//
// Split out of fact-block.ts on purpose. The margin contract (a lowerIsBetter series must state its
// consequence in words; a combined ratio must arrive as a percentage, not a fraction) is asserted by
// a BUILD gate, and verify-build-gate-hygiene.ts fails the build if a build gate so much as imports
// the DB client — correctly, since a gate that needs a database is neither deterministic nor
// deployable. Keeping this module free of prisma is what lets the gate assert on synthetic rows.
//
// Everything a margin needs is four numbers per quarter, so it takes `MarginRow`, not the fact
// block's full QRow. QRow satisfies it structurally, and the gate's fixture stays four lines.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { marginPct, fractionToPct, combinedRatioPlain } from "./format.js";
import type { Family, MarginSeries, MarginsSection } from "./types.js";

/** The minimum a margin series needs from a quarter. QRow satisfies this structurally. */
export interface MarginRow {
  periodKey: string;
  operatingMargin: number | null;
  netMargin: number | null;
  combinedRatio: number | null;
}

/** Four quarters — enough to see a direction without reaching back into a different business cycle. */
export const MARGIN_WINDOW = 4;

/** Half a point is inside the noise of a quarterly margin. */
export const MARGIN_FLOOR_PP = 0.5;

// ═══ ★ A COMPUTED RATIO MUST BE CHECKED FOR MEANING, NOT ONLY FOR ARITHMETIC ═══════════════════════
//
// THE STANDING RULE, earned three times in this feature alone:
//   · a combined ratio stored as a FRACTION rendered 121.4% as "1.2%"          (caught at Stage 2)
//   · a percentage off a zero or negative base ("profit up 340%" from a loss)  (guarded by rule 3)
//   · a margin on a revenue base too small to divide by                        (caught at Stage 5)
// Every one was arithmetically correct and semantically garbage, and every one passed every guard —
// because THE GUARDS CHECK PROVENANCE, NEVER PLAUSIBILITY. Nothing was fabricated in any of them.
// Before a computed ratio reaches prose, ask what it MEANS at that value, not whether the division
// succeeded.
//
// ── THE CUT, AND WHY IT IS THIS ONE ────────────────────────────────────────────────────────────────
// A margin means "the share of revenue kept". Outside ±100% that sentence stops being true: the
// company kept more than it took in (other income), or lost several times its sales. MMTC reported
// ₹1 crore of revenue against ₹44 crore of profit and produced "Net margin 3254.4%" — authoritative-
// looking and meaningless to the reader this feature exists for.
//
// ⚠ NOT a revenue floor. |margin| > 100% is algebraically |profit| > revenue, which is SCALE-FREE; an
// absolute revenue floor would suppress a small company's perfectly meaningful 15% margin purely for
// being small. The bound is on the ratio's meaning, not on the company's size.
//
// ⚠ AND IT DOES NOT APPLY TO EVERY RATIO. A general insurer's combined ratio is LEGITIMATELY above
// 100 — that is precisely what it is for (₹121 paid out per ₹100 of premium). Applying this bound
// there would suppress the correct readings and keep only the flattering ones. Hence per-series
// `maxAbs`, never one global rule.
export const MEANINGFUL_MARGIN_MAX_ABS = 100;

function marginSeries(
  label: string,
  keyPrefix: string,
  window: MarginRow[],
  pick: (r: MarginRow) => number | null,
  opts: { lowerIsBetter?: boolean; plain?: (pct: number) => string; consequence?: Record<string, string>; maxAbs?: number } = {},
): MarginSeries | { suppressed: string } | null {
  const lowerIsBetter = opts.lowerIsBetter ?? false;
  const raw = window
    .map((r) => ({ periodKey: r.periodKey, value: pick(r) }))
    .filter((p): p is { periodKey: string; value: number } => p.value !== null);

  if (raw.length === 0) return null;

  // MEANING CHECK — on the CURRENT quarter, the one the brief leads with. A series whose latest point
  // is a division artifact is withheld whole: showing three sane quarters beside one nonsensical
  // "3254.4%" is worse than showing none, because it lends the artifact the credibility of the rest.
  const maxAbs = opts.maxAbs ?? MEANINGFUL_MARGIN_MAX_ABS;
  const latest = raw[raw.length - 1];
  if (Math.abs(latest.value) > maxAbs) {
    // ⚠ THE REASON MUST DESCRIBE THE RELATIONSHIP, NOT THE SIZE. The first wording said "revenue this
    // quarter was too small", which is false for IDEA — ₹11,332 crore of revenue against ₹51,970 crore
    // of profit. Revenue is not small there; profit simply dwarfs it. A reason that is wrong about the
    // company is worse than no reason.
    return {
      suppressed:
        "profit this quarter was far larger than revenue, so a margin would not describe anything real",
    };
  }

  const points = raw.map((p) => ({ ...p, display: marginPct(p.value) }));

  const newest = points[points.length - 1];
  const oldest = points[0];
  const delta = newest.value - oldest.value;
  const direction: MarginSeries["direction"] =
    points.length < 2 || Math.abs(delta) < MARGIN_FLOOR_PP
      ? "little changed"
      : delta > 0
        ? "rising"
        : "falling";

  const lo = points.reduce((m, p) => (p.value < m.value ? p : m), points[0]);
  const hi = points.reduce((m, p) => (p.value > m.value ? p : m), points[0]);

  // ⚠ END-TO-END DELTA HIDES A ROUND TRIP. Dixon's net margin ran 5.0 → 3.0 → 2.8 → 4.6: the two
  // endpoints are 0.4pp apart, so the delta alone says "little changed" while the reader is looking
  // at a chart that halved and recovered.
  //
  // The test is NOT mere non-monotonicity. Four quarterly margins are almost never monotonic —
  // flagging that fired on 437 of 477 stocks, which is boilerplate, and boilerplate on nine tenths of
  // briefs trains the reader to skip the one that matters. A round trip is worth saying only when the
  // swing is BOTH material in itself AND large relative to where the line actually ended up.
  const swing = hi.value - lo.value;
  const roundTripped = points.length >= 3 && swing >= MARGIN_FLOOR_PP * 2 && swing >= Math.abs(delta) * 2;

  const stem =
    points.length < 2
      ? `${label} was ${newest.display} this quarter. One quarter on file — no direction yet.`
      : // The direction ALWAYS leads; the round-trip note is ADDITIVE. Replacing the direction with
        // the range made the range the headline on ~46% of stocks, which buries the ordinary reading
        // most of them deserve. Both facts are true and the reader needs them in that order.
        `${label} was ${newest.display} this quarter, from ${oldest.display} ` +
        `${points.length} quarters back — ${direction}` +
        (roundTripped ? `, though it moved between ${lo.display} and ${hi.display} in between.` : ".");

  // For a lowerIsBetter series the direction word alone is actively misleading — "rising" sounds like
  // improvement and means the opposite. The consequence is appended HERE, into the one string the
  // model is given, so it cannot be dropped downstream.
  const consequence = lowerIsBetter && points.length >= 2 ? (opts.consequence?.[direction] ?? "") : "";

  return {
    label,
    points,
    current: { key: `${keyPrefix}.current`, label: `${label}, this quarter`, value: newest.value, display: newest.display },
    direction,
    directionDisplay: consequence ? `${stem} ${consequence}` : stem,
    lowerIsBetter,
    ...(opts.plain ? { plainDisplay: opts.plain(newest.value) } : {}),
  };
}

export function buildMargins(family: Family, window: MarginRow[]): MarginsSection | null {
  const series: MarginSeries[] = [];
  const suppressed: { label: string; reason: string }[] = [];
  const take = (label: string, r: MarginSeries | { suppressed: string } | null) => {
    if (!r) return;
    if ("suppressed" in r) suppressed.push({ label, reason: r.suppressed });
    else series.push(r);
  };

  // Only the non-financial quarterly table carries an operating margin. Banking/NBFC/insurers have no
  // such line — their operating concept is a different one (NIM, spread, underwriting), and
  // fabricating an "operating margin" for them would be inventing a metric.
  if (family === "non_financial") {
    take("Operating margin", marginSeries("Operating margin", "margin.operating", window, (r) => r.operatingMargin));
  }

  take("Net margin", marginSeries("Net margin", "margin.net", window, (r) => r.netMargin));

  // General insurance's native profitability measure — net margin alone says very little about an
  // insurer, because the underwriting result and the investment result are different businesses.
  //
  // ⚠ UNIT: combined_ratio is stored as a FRACTION (1.2144) on a table whose net_margin is ALREADY
  // PERCENT. Converted here, once. Unconverted it renders "1.2%" for a 121.4% ratio — an insurer
  // paying out ₹121 for every ₹100 of premium would read as almost costless.
  if (family === "general_insurance") {
    const cr = marginSeries(
      "Combined ratio",
      "margin.combined",
      window,
      (r) => (r.combinedRatio === null ? null : fractionToPct(r.combinedRatio)),
      {
        lowerIsBetter: true,
        // A combined ratio ABOVE 100 is the normal, meaningful case. The bound here exists only to
        // catch a genuine artifact (a near-zero premium base), not to police the metric's own range.
        maxAbs: 400,
        plain: combinedRatioPlain,
        consequence: {
          rising: "A rising combined ratio means more of each ₹100 of premium is going out in claims and costs.",
          falling: "A falling combined ratio means less of each ₹100 of premium is going out in claims and costs.",
          "little changed": "The share of each ₹100 of premium going out in claims and costs held about level.",
        },
      },
    );
    take("Combined ratio", cr);
  }

  return series.length > 0 || suppressed.length > 0 ? { series, suppressed } : null;
}
