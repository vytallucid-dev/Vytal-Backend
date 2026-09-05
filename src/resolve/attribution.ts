// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVER — A · ATTRIBUTION. Why the score is what it is, from the ceiling down.
//
// ── ★ THE SHAPE, AND WHY IT IS "CEILING TO ACTUAL" RATHER THAN "WHAT EACH PART CONTRIBUTED" ───────
// `pillar-decomposition.ts` already answers the second question and does it well: four bars, each the
// points a pillar put in, summing to the composite. That is a good ANATOMY and it is a poor
// EXPLANATION, because a reader looking at "Foundation 21.7, Momentum 11.4" cannot see which of those
// is doing badly — a small bar may be a small weight rather than a weak business.
//
// Starting at 100 and subtracting what each measure COST fixes that in one move. The bars are gaps,
// the biggest one is the answer to "why is it not higher", and the sum is checkable:
//
//     Σ gaps  =  100 − composite            ← and that identity is the proof the join is right
//
// ── ⚠ THE FIELD GRAIN DOES NOT REACH ALL FOUR PILLARS, AND PRETENDING IT DOES WOULD BE THE LIE ────
// The brief asks for "one bar per contributing field". Measured: `score_metrics` holds 12,627
// foundation rows and 6,197 momentum rows and **ZERO** for market and ownership. They are not missing;
// they are scored by different machinery with a different shape:
//
//   market     `score_market_subs` — SEVEN sub-components (A1, A2, B1, B2, B3, C1, D1), each a 0–100
//              Lens-1 score with an availability flag, rolled up through four CATEGORIES by weights
//              that live in code rather than in a column. There is no per-sub contribution to read.
//   ownership  `score_ownership`  — not weighted fields at all, but a WALK: a baseline (75), a
//              pledging adjustment, three penalties, a clamped flow adjustment. Measured on
//              INDUSINDBK FY27Q1: 75 − 2 = 73, +5 → 78. Signed steps from a starting position, which
//              is a different arithmetic from "parts of a whole" and would need a bridge to draw.
//
// ★ SO THE GRAIN IS MIXED AND THE MIXTURE IS DECLARED PER BAR (`grain`). Foundation and Momentum
//   decompose into their fields; Market and Ownership stay whole and say why. The arithmetic still
//   closes exactly, because a pillar-grain gap is just the sum of the field-grain gaps it would have
//   had. Inventing seven market bars from sub-scores whose rollup weights we cannot read would have
//   produced bars that do not sum to their own pillar — the exact failure the identity above exists to
//   catch, committed deliberately to make a chart look uniform.
//
// ── ★ `#5` — VERIFIED BEFORE BEING RELIED ON, AS THE BRIEF ASKS ───────────────────────────────────
// `MetricScore.contribution` is `Decimal` NOT NULL in the store, so #5 cannot be closed there. It is
// closed HERE and in `pillar-decomposition.ts`: `scoreState` is read first and a non-`scored` state
// produces `null`, never a zero. ⚠ MEASURED, THE DISCRIMINATOR HAS ONE VALUE IN LIVE DATA — all
// 11,452 in-force metric rows are `scored`, with not one `suppressed`, `missing_renorm` or
// `neutral_hold`. So the guard is real, exercised by no live row, and its negative control is the only
// thing standing between it and silent rot. That control is in `verify-harness-selftest.ts`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { absent, coverageReadFailed, resolved, type Coverage, type Resolved } from "./contract.js";
import { resolveStockCoverage } from "./stock-coverage.js";
import { canonicalMetric } from "../scoring/bars-loader/label-map.js";
import { LABEL_BAND_MAP } from "../scoring/composite/label.js";
import { redistributionSentence } from "./trajectory.js";

export type PillarKey = "foundation" | "momentum" | "market" | "ownership";

/** One row of the ceiling-to-actual walk. */
export interface AttributionBar {
  /** Stable id — a metric key or a pillar key. NEVER rendered; `label` is what a reader sees. */
  readonly key: string;
  readonly label: string;
  /** Which pillar this sits under. A pillar-grain bar is its own group. */
  readonly group: string;
  readonly grain: "field" | "pillar";
  /**
   * Points of the composite this measure is SHORT of a perfect reading.
   * ⚠ `null`, NEVER 0, when the measure could not be scored — a zero here reads as "this one is
   *   perfect", which is the inverse of the truth.
   */
  readonly gap: number | null;
  /** Points of the composite this measure actually put in. Same null rule. */
  readonly contribution: number | null;
  /** The measure's own 0–100 reading. */
  readonly score: number | null;
  /** Share of the composite this measure could account for at best. */
  readonly ceilingShare: number;
  readonly state: "scored" | "unavailable_redistributed" | "not_scored";
  /**
   * ★ WHERE THE VALUE LANDED AGAINST ITS BAR — `excellent` … `distress`, the engine's own token.
   *
   * ⚠ IT IS CONTEXT AND NOT A VERDICT, AND THE RENDERER IS WHAT HAS TO HOLD THAT LINE. The five
   *   tokens read as praise and blame in ordinary English, so a chart that colours them green-to-red
   *   turns a landing into a judgement — and this family's whole claim is that it explains rather than
   *   rates. The band travels as a token with no severity attached; see the frontend note.
   */
  readonly band: string | null;
  /** Why this bar cannot be broken down further, or could not be scored. Authored, never a key. */
  readonly note: string | null;
}

export interface AttributionRead {
  readonly symbol: string;
  readonly periodKey: string;
  readonly asOfDate: string;
  readonly composite: number;
  readonly band: string;
  readonly bandLabel: string;
  readonly ceiling: number;
  readonly bars: readonly AttributionBar[];
  /** Σ of the gaps actually drawn. Compared against `ceiling − composite` by `reconciles`. */
  readonly gapAccountedFor: number;
  /**
   * ★ THE ARITHMETIC PROOF, AS A FIELD RATHER THAN AS A COMMENT. `false` means the bars do not
   *   account for the score, which means the per-pillar join is wrong — the exact defect
   *   `pillar-decomposition.ts` shipped once (joining pillars on `(stock, asOf, run)` returned
   *   whichever single pillar that run touched). A composition MUST NOT draw an unreconciled walk.
   */
  readonly reconciles: boolean;
  readonly residual: number;
  readonly redistributed: readonly string[];
  readonly redistributionNote: string | null;
  /**
   * ★ WHETHER THE FIELD-LEVEL READ SUCCEEDED, AS A FACT RATHER THAN AS AN INFERENCE FROM AN EMPTY
   *   ARRAY. `false` means the walk is pillar-grain because a query failed, not because we hold
   *   nothing — and those must never render the same sentence. See `METRICS_SQL`.
   */
  readonly metricsRead: boolean;
  /** Pillar-level context: applied weight and subtotal, for the prose to name the mechanism. */
  readonly pillars: readonly {
    readonly key: PillarKey; readonly label: string; readonly subtotal: number | null;
    readonly weightApplied: number; readonly state: "scored" | "unavailable_redistributed";
  }[];
}

const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: "Foundation", momentum: "Momentum", market: "Market", ownership: "Ownership",
};

/**
 * ⚠ THE TOLERANCE IS NOT SLOP, IT IS THE STORED ROUNDING. `w_foundation … w_ownership` are
 * `Decimal(8,4)` and the four sum to 1.0001 on a normal snapshot — measured across all 1,329 in-force
 * periods, the worst |composite − Σ(subtotal × weight)| is 0.0084. A tolerance below that would fail
 * every answer; one far above it would stop catching the join defect it exists to catch. 0.15 is two
 * orders of magnitude above the observed residual and two orders below a single missing pillar.
 */
const RECONCILE_TOLERANCE = 0.15;

const num = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

// The in-force reduction PER PILLAR, bounded at the snapshot's as-of — the same rule and the same
// reasoning as `pillar-decomposition.ts`. Copying the SQL rather than the idea would be two homes for
// one rule, so this reads the pillar ids the snapshot itself points at, which is the reduction already
// resolved and frozen at stamp time.
const SQL = `
WITH st AS (SELECT id FROM stocks WHERE symbol = $1),
head AS (
  SELECT * FROM score_snapshots
  WHERE stock_id = (SELECT id FROM st) AND snapshot_type = 'quarterly'
  ORDER BY as_of_date DESC, version DESC LIMIT 1
)
SELECT h.period_key, h.as_of_date, h.composite, h.label_band,
       h.foundation_subtotal, h.momentum_subtotal, h.market_subtotal, h.ownership_subtotal,
       h.w_foundation, h.w_momentum, h.w_market, h.w_ownership,
       h.weight_redistribution_reason,
       h.foundation_pillar_id, h.momentum_pillar_id, h.market_pillar_id, h.ownership_pillar_id,
       (SELECT ARRAY_AGG(sp.pillar::text ORDER BY sp.pillar) FROM score_pillars sp
         WHERE sp.id IN (h.foundation_pillar_id, h.momentum_pillar_id, h.market_pillar_id, h.ownership_pillar_id)
           AND sp.pillar_state <> 'scored') AS redistributed
FROM head h`;

// ⚠ `IN ($1, $2)`, NOT `= ANY($1::uuid[])`, AND THE FIRST DRAFT USED THE SECOND AND FAILED SILENTLY.
//    Through this adapter the array form raises 42883 (`operator does not exist: uuid = text[]`), the
//    surrounding `.catch(() => [])` turned that into an empty result, and the empty result took the
//    no-fields fallback below — which renders a PILLAR-grain walk carrying the authored note "we hold
//    no field-level breakdown for this pillar on this reading". Every figure in it was correct and the
//    walk reconciled, so nothing caught it: a query error had been laundered into a confident, wrong
//    statement about our own coverage. That is §6.2's confident-wrong-artifact produced by an error
//    handler. `metricsRead` below is why it cannot happen again.
const METRICS_SQL = `
SELECT sm.pillar::text AS pillar, sm.metric_key, sm.metric_score, sm.effective_weight,
       sm.contribution, sm.score_state::text AS score_state, sm.l1_band::text AS l1_band
FROM score_metrics sm
WHERE sm.pillar_score_id IN ($1, $2)
ORDER BY sm.pillar, sm.contribution DESC`;

interface HeadRow {
  period_key: string; as_of_date: Date; composite: unknown; label_band: string;
  foundation_subtotal: unknown; momentum_subtotal: unknown;
  market_subtotal: unknown; ownership_subtotal: unknown;
  w_foundation: unknown; w_momentum: unknown; w_market: unknown; w_ownership: unknown;
  weight_redistribution_reason: string;
  foundation_pillar_id: string; momentum_pillar_id: string;
  market_pillar_id: string; ownership_pillar_id: string;
  redistributed: string[] | null;
}

interface MetricRow {
  pillar: string; metric_key: string; metric_score: unknown; effective_weight: unknown;
  contribution: unknown; score_state: string; l1_band: string | null;
}

export async function resolveAttribution(symbol: string): Promise<Resolved<AttributionRead>> {
  const cov = await resolveStockCoverage(symbol);
  if (coverageReadFailed(cov)) return absent<AttributionRead>("read_failed", { subject: null, query: null });
  const coverage: Coverage = cov.coverage;

  // ⚠ THE READ AND THE FAILURE ARE KEPT APART HERE TOO — F-3, and this line is why the class shipped
  //   a third time. `metricsRead` below was added at Phase 2 · Batch 1 with a header saying the defect
  //   "cannot happen again"; the guard went on the METRICS query and this one, one line above it, kept
  //   its bare catch. Any failure here became `no_prior_snapshots` — "a longer scoring history than
  //   this stock has with us" — which is a confident claim about our coverage produced by an error
  //   handler, on a company whose history may be complete.
  let headRead = true;
  const [head] = await prisma.$queryRawUnsafe<HeadRow[]>(SQL, symbol)
    .catch(() => { headRead = false; return [] as HeadRow[]; });
  if (!head) return absent<AttributionRead>(headRead ? "no_prior_snapshots" : "read_failed", coverage);

  const redistributed = (head.redistributed ?? []).filter(Boolean);
  const weight: Record<PillarKey, number> = {
    foundation: num(head.w_foundation), momentum: num(head.w_momentum),
    market: num(head.w_market), ownership: num(head.w_ownership),
  };
  const subtotal: Record<PillarKey, number> = {
    foundation: num(head.foundation_subtotal), momentum: num(head.momentum_subtotal),
    market: num(head.market_subtotal), ownership: num(head.ownership_subtotal),
  };
  const pillarIdOf: Record<"foundation" | "momentum", string> = {
    foundation: head.foundation_pillar_id, momentum: head.momentum_pillar_id,
  };

  // ★ THE READ AND THE FAILURE ARE KEPT APART. "We hold no fields for this pillar" and "we could not
  //   read the fields" are different sentences, and collapsing them is how the array-form bug above
  //   shipped a false coverage claim.
  let metricsRead = true;
  const metricRows = await prisma.$queryRawUnsafe<MetricRow[]>(
    METRICS_SQL, pillarIdOf.foundation, pillarIdOf.momentum,
  ).catch(() => { metricsRead = false; return [] as MetricRow[]; });

  const composite = num(head.composite);
  const ceiling = 100;
  const bars: AttributionBar[] = [];

  // ── FOUNDATION AND MOMENTUM, FIELD BY FIELD ─────────────────────────────────────────────────────
  // A field's share of the COMPOSITE is its intra-pillar weight times the pillar's applied weight.
  // `effective_weight` is a percentage (14.286 for one of seven equal foundation fields), which is why
  // it is divided here and not anywhere else.
  for (const p of ["foundation", "momentum"] as const) {
    if (redistributed.includes(p)) {
      bars.push({
        key: p, label: PILLAR_LABEL[p], group: PILLAR_LABEL[p], grain: "pillar",
        gap: null, contribution: null, score: null,
        ceilingShare: 0, state: "unavailable_redistributed", band: null,
        note: "could not be scored this period, so its share of the weight went to the parts that could",
      });
      continue;
    }
    const rows = metricRows.filter((m) => m.pillar === p);
    for (const m of rows) {
      const scored = m.score_state === "scored";
      const share = (num(m.effective_weight) / 100) * weight[p] * 100;
      const score = scored ? num(m.metric_score) : null;
      bars.push({
        key: m.metric_key,
        label: canonicalMetric(m.metric_key)?.label ?? m.metric_key,
        group: PILLAR_LABEL[p],
        grain: "field",
        // ★ #5 IN FORCE: `scoreState` decides, and a non-scored field is `null` on BOTH numbers.
        gap: scored ? r2(((100 - num(m.metric_score)) / 100) * (num(m.effective_weight) / 100) * weight[p] * 100) : null,
        contribution: scored ? r2(num(m.contribution) * weight[p]) : null,
        score,
        ceilingShare: r2(share),
        state: scored ? "scored" : "not_scored",
        band: m.l1_band,
        note: scored ? null : "held out of the score this period, so it neither helped nor hurt",
      });
    }
    // ⚠ A PILLAR WITH NO METRIC ROWS IS NOT A PILLAR WITH NOTHING WRONG. It falls back to pillar grain
    //   and says so, rather than silently contributing no bars and quietly breaking the identity.
    if (rows.length === 0) {
      bars.push(pillarBar(p, subtotal[p], weight[p], metricsRead
        ? "we hold no field-level breakdown for this pillar on this reading"
        : "we could not read the field-level breakdown for this pillar just now, so it is shown whole"));
    }
  }

  // ── MARKET AND OWNERSHIP, WHOLE ─────────────────────────────────────────────────────────────────
  bars.push(redistributed.includes("market")
    ? redistributedBar("market")
    : pillarBar("market", subtotal.market, weight.market,
        "scored from seven market sub-components rather than from filed line items, so it is shown whole"));
  bars.push(redistributed.includes("ownership")
    ? redistributedBar("ownership")
    : pillarBar("ownership", subtotal.ownership, weight.ownership,
        "scored as a starting position adjusted for pledging, penalties and flow, so it is shown whole"));

  const gapAccountedFor = r2(bars.reduce((a, b) => a + (b.gap ?? 0), 0));
  const residual = r2(ceiling - composite - gapAccountedFor);
  const reconciles = Math.abs(residual) <= RECONCILE_TOLERANCE;

  // largest drag first — the answer to "why is it not higher" is the top row, always.
  bars.sort((a, b) => (b.gap ?? -1) - (a.gap ?? -1));

  const def = LABEL_BAND_MAP.find((b) => b.band === head.label_band);

  return resolved<AttributionRead>({
    symbol,
    periodKey: head.period_key,
    asOfDate: head.as_of_date.toISOString().slice(0, 10),
    composite: r2(composite),
    band: head.label_band,
    bandLabel: def?.label ?? head.label_band,
    ceiling,
    bars,
    gapAccountedFor,
    reconciles,
    residual,
    redistributed,
    redistributionNote: redistributionSentence(head.weight_redistribution_reason, redistributed),
    metricsRead,
    pillars: (["foundation", "momentum", "market", "ownership"] as const).map((k) => ({
      key: k,
      label: PILLAR_LABEL[k],
      subtotal: redistributed.includes(k) ? null : r2(subtotal[k]),
      weightApplied: weight[k],
      state: redistributed.includes(k) ? "unavailable_redistributed" : "scored",
    })),
  }, coverage, ["score_snapshots"]);

  function pillarBar(p: PillarKey, sub: number, w: number, note: string): AttributionBar {
    return {
      key: p, label: PILLAR_LABEL[p], group: PILLAR_LABEL[p], grain: "pillar",
      gap: r2(((100 - sub) / 100) * w * 100),
      contribution: r2((sub / 100) * w * 100),
      score: r2(sub),
      ceilingShare: r2(w * 100),
      state: "scored", band: null, note,
    };
  }

  function redistributedBar(p: PillarKey): AttributionBar {
    return {
      key: p, label: PILLAR_LABEL[p], group: PILLAR_LABEL[p], grain: "pillar",
      // ⚠ `null`, NOT 0. Its applied weight IS zero, so a computed gap would legitimately be 0.00 —
      //   and a 0.00 in the gap column reads as "this one is perfect", which is the worst available
      //   reading of "we could not measure it". The state is what the renderer must key on.
      gap: null, contribution: null, score: null, ceilingShare: 0,
      state: "unavailable_redistributed", band: null,
      note: "could not be scored this period, so its share of the weight went to the parts that could",
    };
  }
}
