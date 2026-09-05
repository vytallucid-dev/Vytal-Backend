// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVER — T · TRAJECTORY. How a company has moved, and where the turns are.
//
// ── ★ WHAT THIS FAMILY OWNS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────────────
// It owns **the score's own history** — Vytal's reading of the company over time. It does NOT own the
// company's filed history: that is F, which already draws it (`statement-table`, `stepped-filing-line`)
// and would become a second home for one concept if this family redrew it (N-3, N-5).
//
// The one place the two meet is the THIN path. A company we cover and do not score has no score
// history at all, and answering "how has it changed over time" with silence would be false — we hold
// its filings. So the thin arm draws the FILED series and SAYS SO. Which series a trajectory answer is
// drawing is never left for the reader to infer: see `SeriesBasis`.
//
// ── ⚠ JANUARY 2023 IS THE EPOCH, AND 14 IS A PRODUCT DEFINITION ───────────────────────────────────
// Measured: 14 in-force quarterly periods, FY23Q4 → FY27Q1, CONTIGUOUS, no stock with a hole in its
// own run, 94 stocks at 14 and one (MANKIND) at 13. The score does not exist before Jan 2023 because
// it was not computed before Jan 2023. So a reader asking for twenty quarters of score history is
// asking for something that has never existed, and the honest answer states the epoch rather than
// apologising for a gap. ⚠ NOBODY SHOULD READ 14 AS A DATA CEILING AND PROPOSE A BACKFILL — there is
// nothing to backfill, because the input to a backfill would be a score we would have to invent.
//
// ── ★ THE FUNDAMENTAL SERIES RUNS DEEPER, AND FOR THE BANKS IT DOES NOT ───────────────────────────
// The brief states "94 of 95 scored stocks hold 24 or more quarters". Measured against
// `quarterly_results`: 82 hold ≥ 24, 13 hold fewer, and **12 of those 13 hold ZERO** — and the 12 are
// exactly the 12 scored BANKS, which do not file into that table at all (they are in
// `banking_fundamentals`). The sentence is true of the non-financials and structurally false of the
// banks in the table an obvious query reads. `DepthProfile.quarters` is the five-table union and is
// therefore the number this resolver quotes, because that is the one that means "quarters we hold".
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { absent, coverageReadFailed, resolved, type Coverage, type Resolved } from "./contract.js";
import { resolveStockCoverage } from "./stock-coverage.js";
import { LABEL_BAND_MAP, labelFor } from "../scoring/composite/label.js";
import { stockSideEntry } from "../catalogue/index.js";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE CHANGE-POINT METHOD, AND WHY BOTH ITS CONSTANTS ARE DERIVED RATHER THAN CHOSEN.
//
// Binary segmentation on the mean: find the split that most separates the two halves' averages, take
// it if it clears the bar, recurse into each half. Over 14 points this is the right family of method —
// it is O(n²) at a size where that is nothing, it produces a nested set of cuts a person can read off
// the chart, and unlike a penalty method (PELT) it needs no tuning constant nobody can defend.
//
// ── MIN_PHASE = 3 · A PHASE HAS TO BE ABLE TO BE WRONG ────────────────────────────────────────────
// A phase of ONE point is a point. A phase of TWO is a line segment with no interior — any two points
// define a trend, so a two-point "phase" is an artefact of the method rather than an observation.
// THREE is the shortest run its own next point can contradict, and it is three separate quarters of
// filed evidence rather than a slope drawn through a pair.
//
// ★ AND IT IS ALSO THE PHASE-COUNT CAP, SO THERE IS NO SECOND CONSTANT. 14 points with a floor of 3
//   admits at most 4 phases. The brief asks for "three to five phases, not month-by-month narration";
//   a separate `MAX_PHASES` would be a number invented to enforce what the floor already enforces, and
//   two constants that must agree are one constant plus a future disagreement.
//   MEASURED over all 95: 59 stocks one phase, 25 two, 10 three, 1 four. The cap binds exactly once.
//
// ── MIN_STEP = the narrowest band we publish · A SPLIT MUST BE ONE THE READER COULD SEE ───────────
// `LABEL_BAND_MAP`'s narrowest finite bands are Steady [62,68) and Healthy [68,74) — both 6 wide. A
// mean shift smaller than that cannot carry a company from one label we publish to another, so calling
// it a phase change would name something the product's own vocabulary is blind to.
//
// ⚠ THE ALTERNATIVE WAS A STANDARD-DEVIATION MULTIPLE, AND IT IS WORSE HERE. A σ-based bar makes the
//   threshold a property of the stock: a placid company gets a hair trigger and a volatile one gets
//   none, so two readers comparing two answers are reading two different definitions of "phase" with
//   nothing on either screen saying so. Tying it to the published bands makes the definition the same
//   for every company and explainable to a reader in one sentence.
//
// ⚠ AND IT IS DERIVED FROM THE MAP RATHER THAN WRITTEN AS `6`. A re-band (the mapping is versioned —
//   `BAND_MAPPING_VERSION`) that narrowed a band would leave a hardcoded 6 silently too coarse.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const MIN_PHASE = 3;

/** Derived, not written down: the narrowest FINITE band in the published mapping. */
function narrowestBandWidth(): number {
  const widths = LABEL_BAND_MAP
    .filter((b) => Number.isFinite(b.min) && b.max !== null)
    .map((b) => (b.max as number) - b.min);
  return Math.min(...widths);
}

export const MIN_STEP = narrowestBandWidth();

/**
 * ★ THE BAND LABEL, SHORT ENOUGH TO SIT INSIDE A SENTENCE.
 *
 * ⚠ ONE PUBLISHED LABEL CARRIES ITS OWN EXPLANATION: "Pristine — fully priced". That is right on a
 *   card and wrong in prose, where it produced "averaging 76.4 — Pristine — fully priced." with two
 *   em dashes doing different jobs in one clause. The full label stays the authority and is what the
 *   payload carries; this is the inline form, taken from it rather than written a second time (N-5).
 */
export const bandWord = (label: string): string => label.split("—")[0].trim();

export type PillarKey = "foundation" | "momentum" | "market" | "ownership";

export interface TrajectoryPoint {
  readonly periodKey: string;
  readonly asOfDate: string;
  readonly composite: number;
  readonly band: string;
  /**
   * ⚠ `null`, NEVER 0, FOR A REDISTRIBUTED PILLAR. `score_snapshots` stores the subtotal of an
   * unscorable pillar as literal 0 — measured, 20 in-force periods across 8 stocks. Plotted straight, a
   * pillar line dives to the floor and comes back: the zero-for-unknown defect in the TIME dimension,
   * and the one this family is most exposed to because it draws lines rather than bars.
   */
  readonly pillars: Readonly<Record<PillarKey, number | null>>;
  /** Pillars whose weight was carried by the others this period. Empty is the common case. */
  readonly redistributed: readonly string[];
}

export interface Phase {
  readonly fromPeriod: string;
  readonly toPeriod: string;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly periods: number;
  readonly mean: number;
  readonly band: string;
  readonly bandLabel: string;
  /** Against the PREVIOUS phase's mean. `null` on the first phase — there is nothing before it. */
  readonly stepFromPrior: number | null;
  readonly direction: "opening" | "step up" | "step down";
}

/** A dated thing on the same axis as the score. `kind` decides the mark, never a colour. */
export interface TrajectoryEvent {
  readonly periodKey: string;
  readonly kind: "fired" | "expired" | "redistribution" | "turn";
  readonly key: string | null;
  readonly label: string;
  readonly detail: string | null;
}

/**
 * ★ WHICH SERIES THE ANSWER IS DRAWING, AS A FIRST-CLASS FIELD RATHER THAN A SENTENCE SOMEWHERE.
 *
 * The two series have different lengths and different meanings, and an answer that shows a line
 * without saying which one it is has told the reader something they cannot check. `sentence` is
 * authored here because only here is it known which arm was taken and how long it ran.
 */
export interface SeriesBasis {
  readonly source: "score" | "filed";
  readonly periods: number;
  readonly fromPeriod: string | null;
  readonly toPeriod: string | null;
  readonly sentence: string;
}

export interface PillarMove {
  readonly pillar: string;
  readonly delta: number | null;
  readonly note: string | null;
}

export interface TrajectoryRead {
  readonly symbol: string;
  readonly points: readonly TrajectoryPoint[];
  readonly phases: readonly Phase[];
  readonly events: readonly TrajectoryEvent[];
  readonly basis: SeriesBasis;
  /** Highest minus lowest across the window. */
  readonly range: number;
  /**
   * The largest single quarter-on-quarter move, with its period.
   *
   * ★ CARRIED EVEN WHEN THERE IS ONE PHASE — measured on LT: a 19.3-point range that binary
   *   segmentation correctly reports as ONE phase, because the moves cancel and the level never
   *   settled anywhere new. Reporting only the phase count there would say "nothing happened" about
   *   the single most eventful series in the set.
   */
  readonly largestStep: { readonly at: string; readonly from: string; readonly delta: number } | null;
  /** Pillars that moved most across the whole window, largest absolute move first. */
  readonly pillarMoves: readonly PillarMove[];
  /** Periods where the rules RAN AND NOTHING FIRED — a state, not a hole. See `witnessSentence`. */
  readonly witnessedEmpty: readonly string[];
  /** Periods where we cannot say whether the rules ran at all. */
  readonly unwitnessed: readonly string[];
  readonly epochSentence: string;
}

const PILLARS: readonly PillarKey[] = ["foundation", "momentum", "market", "ownership"];
const PILLAR_LABEL: Record<string, string> = {
  foundation: "Foundation", momentum: "Momentum", market: "Market", ownership: "Ownership",
};

const mean = (a: readonly number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Binary segmentation. Appends the indices AFTER which a phase ends. */
function changePoints(v: readonly number[], lo: number, hi: number, out: number[]): void {
  if (hi - lo + 1 < MIN_PHASE * 2) return;
  let best = -1;
  let gain = 0;
  for (let c = lo + MIN_PHASE - 1; c <= hi - MIN_PHASE; c++) {
    const g = Math.abs(mean(v.slice(lo, c + 1)) - mean(v.slice(c + 1, hi + 1)));
    if (g > gain) { gain = g; best = c; }
  }
  if (best < 0 || gain < MIN_STEP) return;
  out.push(best);
  changePoints(v, lo, best, out);
  changePoints(v, best + 1, hi, out);
}

export function detectPhases(points: readonly TrajectoryPoint[]): Phase[] {
  if (points.length === 0) return [];
  const v = points.map((p) => p.composite);
  const cuts: number[] = [];
  changePoints(v, 0, v.length - 1, cuts);
  cuts.sort((a, b) => a - b);

  const phases: Phase[] = [];
  let lo = 0;
  for (const end of [...cuts, v.length - 1]) {
    const seg = v.slice(lo, end + 1);
    const m = mean(seg);
    const prior = phases.length ? phases[phases.length - 1].mean : null;
    const step = prior === null ? null : round1(m - prior);
    const def = labelFor(m);
    phases.push({
      fromPeriod: points[lo].periodKey,
      toPeriod: points[end].periodKey,
      fromIndex: lo,
      toIndex: end,
      periods: seg.length,
      mean: round1(m),
      band: def.band,
      bandLabel: def.label,
      stepFromPrior: step,
      direction: step === null ? "opening" : step > 0 ? "step up" : "step down",
    });
    lo = end + 1;
  }
  return phases;
}

// ── the in-force reduction, the same rule every other resolver in this repo uses ────────────────────
const SERIES_SQL = `
WITH st AS (SELECT id FROM stocks WHERE symbol = $1),
inforce AS (
  SELECT DISTINCT ON (period_key) id, period_key, as_of_date, composite, label_band,
         foundation_subtotal, momentum_subtotal, market_subtotal, ownership_subtotal,
         foundation_pillar_id, momentum_pillar_id, market_pillar_id, ownership_pillar_id,
         weight_redistribution_reason, findings_evaluated_at, findings_fired_count
  FROM score_snapshots
  WHERE stock_id = (SELECT id FROM st) AND snapshot_type = 'quarterly'
  ORDER BY period_key, version DESC, as_of_date DESC
)
SELECT i.period_key, i.as_of_date, i.composite, i.label_band,
       i.foundation_subtotal, i.momentum_subtotal, i.market_subtotal, i.ownership_subtotal,
       i.weight_redistribution_reason, i.findings_evaluated_at, i.findings_fired_count,
       (SELECT ARRAY_AGG(sp.pillar::text ORDER BY sp.pillar) FROM score_pillars sp
         WHERE sp.id IN (i.foundation_pillar_id, i.momentum_pillar_id, i.market_pillar_id, i.ownership_pillar_id)
           AND sp.pillar_state <> 'scored') AS redistributed,
       (SELECT ARRAY_AGG(DISTINCT sp2.pattern_key) FROM score_patterns sp2
         WHERE sp2.snapshot_id = i.id) AS pattern_keys
FROM inforce i
ORDER BY i.period_key`;

interface Row {
  period_key: string; as_of_date: Date; composite: unknown; label_band: string;
  foundation_subtotal: unknown; momentum_subtotal: unknown;
  market_subtotal: unknown; ownership_subtotal: unknown;
  weight_redistribution_reason: string;
  findings_evaluated_at: Date | null; findings_fired_count: number | null;
  redistributed: string[] | null; pattern_keys: string[] | null;
}

const num = (v: unknown) => Number(v ?? 0);

/**
 * ★ THE READER-FACING SENTENCE FOR A WEIGHT REDISTRIBUTION — one home, here.
 *
 * ⚠ `weight_redistribution_reason` IS AN ENGINE ENUM AND IT WAS BEING PRINTED AS PROSE. The frontend
 *   waterfall renders `payload.redistributionReason` straight into a paragraph and the backend passes
 *   `d.redistributionReason` straight through — so a reader on VEDL or LT is shown the literal string
 *   `missing_pillar` in a sentence slot. That is the never-render-a-key rule broken end to end, and
 *   neither side is individually at fault: the backend never said the field was reader-facing and the
 *   frontend assumed it was. The fix is one authored sentence at the boundary, which is also the only
 *   place that knows WHICH pillar went missing — the enum does not carry it.
 */
export function redistributionSentence(reason: string, pillars: readonly string[]): string | null {
  if (!reason || reason === "none") return null;
  const named = pillars.length
    ? pillars.map((p) => PILLAR_LABEL[p] ?? p).join(" and ")
    : "One part of the score";
  return `${named} could not be scored this period, so that share of the weight was carried by the ` +
    `parts that could. The parts shown therefore count for more than their usual share, and the total ` +
    `is still out of 100.`;
}

/**
 * ★ A WITNESSED EMPTY IS A STATE WITH ITS OWN SENTENCE, NOT A BLANK.
 *
 * Measured over the 1,329 in-force periods: 1,125 were witnessed AND carry pattern rows, 93 were
 * witnessed and carry none (the honest empty), 106 carry rows with no witness stamp, and 5 have
 * neither. That is FOUR states, where the plan records three — the fourth ("rows, but no witness")
 * reads as evidence the rules ran without being a claim that they ran completely, so it is folded into
 * neither the clean state nor the unknown one here: it simply is not a witnessed empty and is not
 * counted as unknown either.
 */
export function witnessSentence(witnessedEmpty: number, unwitnessed: number, total: number): string | null {
  if (witnessedEmpty === 0 && unwitnessed === 0) return null;
  const parts: string[] = [];
  if (witnessedEmpty > 0) {
    parts.push(
      `In ${witnessedEmpty} of those ${total} quarters the checks ran and raised nothing. That is a ` +
      `result rather than a gap: the quarter was examined and came back clean.`,
    );
  }
  if (unwitnessed > 0) {
    parts.push(
      `For ${unwitnessed} of them we cannot say whether the checks ran, so we do not claim they came ` +
      `back clean.`,
    );
  }
  return parts.join(" ");
}

export async function resolveTrajectory(symbol: string): Promise<Resolved<TrajectoryRead>> {
  const cov = await resolveStockCoverage(symbol);
  if (coverageReadFailed(cov)) return absent<TrajectoryRead>("read_failed", { subject: null, query: null });
  const coverage: Coverage = cov.coverage;

  // ⚠ F-3. `no_prior_snapshots` reads to a reader as "a longer scoring history than this stock has
  //   with us" — so a failed query told them their company is young when the query was the problem.
  let seriesRead = true;
  const rows = await prisma.$queryRawUnsafe<Row[]>(SERIES_SQL, symbol)
    .catch(() => { seriesRead = false; return [] as Row[]; });
  if (!seriesRead) return absent<TrajectoryRead>("read_failed", coverage);
  if (rows.length === 0) return absent<TrajectoryRead>("no_prior_snapshots", coverage);

  const points: TrajectoryPoint[] = rows.map((r) => {
    const red = (r.redistributed ?? []).filter(Boolean);
    const held = (p: PillarKey, v: unknown) => (red.includes(p) ? null : num(v));
    return {
      periodKey: r.period_key,
      asOfDate: r.as_of_date.toISOString().slice(0, 10),
      composite: num(r.composite),
      band: r.label_band,
      pillars: {
        foundation: held("foundation", r.foundation_subtotal),
        momentum: held("momentum", r.momentum_subtotal),
        market: held("market", r.market_subtotal),
        ownership: held("ownership", r.ownership_subtotal),
      },
      redistributed: red,
    };
  });

  const phases = detectPhases(points);
  const values = points.map((p) => p.composite);
  const range = round1(Math.max(...values) - Math.min(...values));

  let largestStep: TrajectoryRead["largestStep"] = null;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].composite - points[i - 1].composite;
    if (largestStep === null || Math.abs(d) > Math.abs(largestStep.delta)) {
      largestStep = { at: points[i].periodKey, from: points[i - 1].periodKey, delta: round1(d) };
    }
  }

  // ── PILLAR MOVEMENT ACROSS THE WINDOW ────────────────────────────────────────────────────────────
  // ⚠ FIRST AND LAST **HELD** READINGS, NOT FIRST AND LAST ROWS. VEDL's Market pillar is unscorable in
  //   both of its two most recent periods; reading the last row would compare against a null, and
  //   reading the stored 0 would report a 71-point collapse that never happened. `note` says when the
  //   move is measured over a shorter run than the window, because a move over 12 of 14 quarters
  //   presented as a move over 14 is a quietly different claim.
  const pillarMoves: PillarMove[] = PILLARS.map((p) => {
    const held = points.filter((x) => x.pillars[p] !== null);
    if (held.length < 2) {
      return {
        pillar: PILLAR_LABEL[p],
        delta: null,
        note: held.length === 0
          ? "not scored in any quarter of this window"
          : "scored in only one quarter of this window, so there is no move to state",
      };
    }
    const first = held[0].pillars[p]!;
    const last = held[held.length - 1].pillars[p]!;
    return {
      pillar: PILLAR_LABEL[p],
      delta: round1(last - first),
      note: held.length < points.length
        ? `measured across the ${held.length} quarters of ${points.length} in which it could be scored`
        : null,
    };
  }).sort((a, b) => Math.abs(b.delta ?? -1) - Math.abs(a.delta ?? -1));

  // ── EVENTS ON THE SHARED AXIS ───────────────────────────────────────────────────────────────────
  // ⚠ ONLY AT THE TURNS, AND THAT IS AN INFORMATION DECISION RATHER THAN A ROW CAP. Measured on
  //   INDUSINDBK: 14 quarters carry roughly 60 pattern rows and FY25Q4 alone fires eight keys. A rail
  //   of every fired and expired finding across the window is a hundred rows nobody reads, and burying
  //   the two that coincide with a turn inside it is the same as not having them. The turns are what
  //   this family is FOR; the full census is PT's answer, and there is a chip pointing at it.
  const turnPeriods = new Set(phases.filter((p) => p.stepFromPrior !== null).map((p) => p.fromPeriod));
  const events: TrajectoryEvent[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (turnPeriods.has(p.periodKey)) {
      const ph = phases.find((x) => x.fromPeriod === p.periodKey)!;
      events.push({
        periodKey: p.periodKey,
        kind: "turn",
        key: null,
        label: ph.direction === "step up" ? "The score stepped up here" : "The score stepped down here",
        detail: `${ph.stepFromPrior! > 0 ? "+" : ""}${ph.stepFromPrior!.toFixed(1)} points against the run before it`,
      });
      const prev = new Set(i > 0 ? rows[i - 1].pattern_keys ?? [] : []);
      const now = new Set(rows[i].pattern_keys ?? []);
      // ⚠ DEDUPED BY THE WORDS, NOT BY THE KEY, AND THE KEYS ARE WHY. Several runtime-composed lens
      //   keys (`lens_lm7_CASA`, `lens_lm7_CI`, `lens_lm7_NII` …) resolve to ONE catalogue face and
      //   therefore to one sentence — measured, TCS and VEDL each produced "Weak on every lens" twice
      //   in the same quarter. Two identical rows in a rail read as two events; they are one event
      //   seen through several metric coordinates, and the coordinate is exactly what `lens-faces.ts`
      //   discards on purpose.
      const seen = new Set<string>();
      const push = (e: TrajectoryEvent) => {
        const id = `${e.periodKey}|${e.kind}|${e.label}`;
        if (seen.has(id)) return;
        seen.add(id);
        events.push(e);
      };
      for (const k of now) if (!prev.has(k)) push(eventFor(p.periodKey, "fired", k));
      for (const k of prev) if (!now.has(k)) push(eventFor(p.periodKey, "expired", k));
    }
    const before = i > 0 ? points[i - 1].redistributed : [];
    for (const pil of p.redistributed) {
      if (!before.includes(pil)) {
        events.push({
          periodKey: p.periodKey,
          kind: "redistribution",
          key: pil,
          label: `${PILLAR_LABEL[pil] ?? pil} stopped being scorable`,
          detail: "Its share of the weight moved to the parts that could be scored.",
        });
      }
    }
    for (const pil of before) {
      if (!p.redistributed.includes(pil)) {
        events.push({
          periodKey: p.periodKey,
          kind: "redistribution",
          key: pil,
          label: `${PILLAR_LABEL[pil] ?? pil} became scorable again`,
          detail: "The weights went back to their usual shares, which moves the score on its own.",
        });
      }
    }
  }

  const witnessedEmpty = rows
    .filter((r) => r.findings_evaluated_at !== null && (r.findings_fired_count ?? 0) === 0)
    .map((r) => r.period_key);
  const unwitnessed = rows.filter((r) => r.findings_evaluated_at === null).map((r) => r.period_key);

  const basis: SeriesBasis = {
    source: "score",
    periods: points.length,
    fromPeriod: points[0].periodKey,
    toPeriod: points[points.length - 1].periodKey,
    sentence:
      `This is our own score, quarter by quarter — ${points.length} readings from ${points[0].periodKey} ` +
      `to ${points[points.length - 1].periodKey}. It is not the company's filed history, which runs ` +
      `further back than we have been scoring.`,
  };

  return resolved<TrajectoryRead>({
    symbol,
    points,
    phases,
    events,
    basis,
    range,
    largestStep,
    pillarMoves,
    witnessedEmpty,
    unwitnessed,
    epochSentence:
      `We began scoring in January 2023, so ${points[0].periodKey} is the earliest reading that exists ` +
      `— not the earliest we happen to hold.`,
  }, coverage, ["score_snapshots"]);
}

/** Catalogue copy for a fired or expired key, degrading to the key's SHAPE rather than to the key. */
function eventFor(periodKey: string, kind: "fired" | "expired", key: string): TrajectoryEvent {
  const e = stockSideEntry(key);
  if (e && "name" in e && typeof e.name === "string") {
    return {
      periodKey,
      kind,
      key,
      label: kind === "fired" ? e.name : `${e.name} stopped applying`,
      detail: "description" in e && typeof e.description === "string" ? e.description : null,
    };
  }
  // ⚠ 69 OF THE KEYS LIVE IN `score_patterns` HAVE NO CATALOGUE ENTRY (measured) — runtime-composed
  //   lens keys, the `notcovered_*` family, and two retired trajectory keys. Rendering the raw key
  //   would break the never-render-a-key rule outright; dropping it silently would shorten the rail
  //   without saying so, which is the quiet-filter defect `DroppedFilter` exists to prevent. So it is
  //   KEPT, and the label says exactly what it is.
  return {
    periodKey,
    kind,
    key,
    label: kind === "fired"
      ? "A check fired that we have no published description for"
      : "A check we have no published description for stopped applying",
    detail: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE CHANGE DECOMPOSITION — "why did the score fall", raised at batch 1 and built here.
//
// ── ⚠ THE OBVIOUS ARITHMETIC IS WRONG, AND LT IS THE PROOF ────────────────────────────────────────
// FY26Q3 → FY26Q4 the composite falls 75.4 → 56.1, a 19.3-point drop. Each pillar's contribution now
// minus its contribution then gives:
//
//     Foundation  30.0 → 19.3   −10.7        Market      24.6 → 11.8   −12.8
//     Momentum     0.0 →  9.9    +9.9        Ownership   20.8 → 15.0    −5.8
//
// A reader shown that concludes Market and Foundation collapsed. They did not. Momentum had been
// UNSCORABLE for four quarters, its 0.25 weight carried by the other three; when it came back at 39.8
// the weights snapped to standard, and most of Foundation's and Market's "fall" is their weight
// returning from 0.467 and 0.267 to 0.35 and 0.20. Foundation's own reading moved 64.3 → 55.2 — real,
// and less than half the bar the naive method draws.
//
// ── ★ THE HONEST SPLIT IS AN EXACT IDENTITY, WHICH IS WHY IT IS SAFE TO DRAW ──────────────────────
//
//     Δ(s·w)  =  Δs · w_before   +   s_after · Δw
//                ^^^^^^^^^^^^^       ^^^^^^^^^^^^
//                the score moved     the weight moved
//
// Both terms are computed, both are shown, and their sum is the pillar's whole contribution change.
// Σ over four pillars = Δcomposite exactly — the same reconciliation proof the shortfall walk carries.
//
// ⚠ AND THE WEIGHT TERM IS NOT A FOOTNOTE. On LT it is the LARGER half for three of the four pillars.
//   A bridge that showed only the total per pillar would be the naive chart with extra steps.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** One signed step in the walk from the earlier composite to the later one. */
export interface ChangeStep {
  readonly key: PillarKey;
  readonly label: string;
  /** The pillar's whole contribution change, in composite points. `scoreEffect + weightEffect`. */
  readonly delta: number;
  /** The part from the pillar's OWN reading moving, at the weight it had before. */
  readonly scoreEffect: number;
  /** The part from its WEIGHT moving, at the reading it has now. ⚠ Zero only when the weight held. */
  readonly weightEffect: number;
  readonly fromSubtotal: number | null;
  readonly toSubtotal: number | null;
  readonly fromWeight: number;
  readonly toWeight: number;
  /** `became_scorable` / `stopped_being_scorable` / `none` — why the weight moved, if it did. */
  readonly weightReason: "became_scorable" | "stopped_being_scorable" | "reweighted" | "none";
  /**
   * ═════════════════════════════════════════════════════════════════════════════════════════════
   * ★★ TRUE WHEN THIS PILLAR CROSSED THE SCORABLE BOUNDARY, AND WHEN IT IS TRUE THE SPLIT ABOVE MUST
   *    NOT BE SHOWN OR DESCRIBED. THE ARITHMETIC IS STILL EXACT; THE ATTRIBUTION IS NOT.
   *
   * ⚠ `score_snapshots` STORES AN UNSCORABLE PILLAR'S SUBTOTAL AS LITERAL 0 — the same zero-for-unknown
   *   the spine and the waterfall both guard against, resurfacing one level up inside a DELTA. Feed it
   *   through `Δs·w0 + s1·Δw` and the identity holds while both terms become fiction:
   *
   *     LT · Momentum came back    score  0.0  weight +10.0   ← "its reading did not move" (it went
   *                                                             from unmeasurable to 39.8)
   *     VEDL · Market went away    score −17.3  weight  0.0   ← "its reading fell 17.3" (it did not
   *                                                             fall; it stopped being measurable)
   *
   *   Both sentences are false about the business and would be read as findings. The STEP is real —
   *   the composite genuinely moved by that much — so it is drawn; what is suppressed is the claim
   *   about WHY, which `note` states instead in the only terms that are true.
   *
   * ★ THIS IS WHY THE CHANGE DECOMPOSITION COULD NOT BE A ONE-LINE DELTA. Batch 1 raised it as an
   *   arithmetic problem; the arithmetic turned out to be the easy half.
   * ═════════════════════════════════════════════════════════════════════════════════════════════
   */
  readonly crossing: boolean;
  readonly note: string | null;
}

export interface ChangeRead {
  readonly symbol: string;
  readonly fromPeriod: string;
  readonly toPeriod: string;
  readonly fromComposite: number;
  readonly toComposite: number;
  readonly delta: number;
  readonly fromBandLabel: string;
  readonly toBandLabel: string;
  readonly steps: readonly ChangeStep[];
  /** Σ steps. Compared against `delta` — the proof the split is exact. */
  readonly accountedFor: number;
  readonly residual: number;
  readonly reconciles: boolean;
  /** True when any weight moved between the two periods — the case the naive method gets wrong. */
  readonly weightsMoved: boolean;
  readonly basisSentence: string;
}

const CHANGE_SQL = `
WITH st AS (SELECT id FROM stocks WHERE symbol = $1),
inforce AS (
  SELECT DISTINCT ON (period_key) period_key, as_of_date, composite, label_band,
         foundation_subtotal, momentum_subtotal, market_subtotal, ownership_subtotal,
         w_foundation, w_momentum, w_market, w_ownership,
         foundation_pillar_id, momentum_pillar_id, market_pillar_id, ownership_pillar_id
  FROM score_snapshots
  WHERE stock_id = (SELECT id FROM st) AND snapshot_type = 'quarterly'
  ORDER BY period_key, version DESC, as_of_date DESC
)
SELECT i.*,
       (SELECT ARRAY_AGG(sp.pillar::text ORDER BY sp.pillar) FROM score_pillars sp
         WHERE sp.id IN (i.foundation_pillar_id, i.momentum_pillar_id, i.market_pillar_id, i.ownership_pillar_id)
           AND sp.pillar_state <> 'scored') AS redistributed
FROM inforce i ORDER BY i.period_key`;

interface ChangeRow {
  period_key: string; composite: unknown; label_band: string;
  foundation_subtotal: unknown; momentum_subtotal: unknown;
  market_subtotal: unknown; ownership_subtotal: unknown;
  w_foundation: unknown; w_momentum: unknown; w_market: unknown; w_ownership: unknown;
  redistributed: string[] | null;
}

/**
 * The change between two consecutive in-force periods.
 *
 * ⚠ `toPeriod` DEFAULTS TO THE LATEST AND THE PAIR IS ALWAYS ADJACENT. A bridge across a gap would be
 *   a walk over quarters it does not draw, and every step in it would silently aggregate several
 *   moves — including weight moves that cancelled. The trajectory family is where a multi-quarter arc
 *   is answered; this answers ONE step of it.
 */
export async function resolveScoreChange(
  symbol: string,
  toPeriod?: string,
): Promise<Resolved<ChangeRead>> {
  const cov = await resolveStockCoverage(symbol);
  if (coverageReadFailed(cov)) return absent<ChangeRead>("read_failed", { subject: null, query: null });
  const coverage: Coverage = cov.coverage;

  // ⚠ C-1. `no_prior_snapshots` reads as "a longer scoring history than this stock has with us" — a
  //   statement about the company, from a query that threw. Same site class as SERIES_SQL above.
  let changeRead = true;
  const rows = await prisma.$queryRawUnsafe<ChangeRow[]>(CHANGE_SQL, symbol)
    .catch(() => { changeRead = false; return [] as ChangeRow[]; });
  if (!changeRead) return absent<ChangeRead>("read_failed", coverage);
  if (rows.length < 2) return absent<ChangeRead>("no_prior_snapshots", coverage);

  const toIdx = toPeriod ? rows.findIndex((r) => r.period_key === toPeriod) : rows.length - 1;
  if (toIdx < 1) return absent<ChangeRead>("no_prior_snapshots", coverage);
  const before = rows[toIdx - 1];
  const after = rows[toIdx];

  const sub = (r: ChangeRow, p: PillarKey) => Number(
    p === "foundation" ? r.foundation_subtotal : p === "momentum" ? r.momentum_subtotal
    : p === "market" ? r.market_subtotal : r.ownership_subtotal ?? 0);
  const wt = (r: ChangeRow, p: PillarKey) => Number(
    p === "foundation" ? r.w_foundation : p === "momentum" ? r.w_momentum
    : p === "market" ? r.w_market : r.w_ownership ?? 0);

  const redBefore = new Set((before.redistributed ?? []).filter(Boolean));
  const redAfter = new Set((after.redistributed ?? []).filter(Boolean));

  const steps: ChangeStep[] = PILLARS.map((p) => {
    const s0 = sub(before, p);
    const s1 = sub(after, p);
    const w0 = wt(before, p);
    const w1 = wt(after, p);
    // ★ THE EXACT SPLIT. Δ(s·w) = Δs·w0 + s1·Δw, in composite points (subtotals are 0–100).
    const scoreEffect = round1((s1 - s0) * w0);
    const weightEffect = round1(s1 * (w1 - w0));
    const wasOut = redBefore.has(p);
    const isOut = redAfter.has(p);
    const weightReason = wasOut && !isOut ? "became_scorable"
      : !wasOut && isOut ? "stopped_being_scorable"
      : Math.abs(w1 - w0) > 0.001 ? "reweighted" : "none";
    return {
      key: p,
      label: PILLAR_LABEL[p],
      delta: round1(s1 * w1 - s0 * w0),
      scoreEffect,
      weightEffect,
      // ⚠ `null`, NEVER THE STORED 0, on a side where the pillar was unscorable.
      fromSubtotal: wasOut ? null : round1(s0),
      toSubtotal: isOut ? null : round1(s1),
      fromWeight: w0,
      toWeight: w1,
      weightReason,
      crossing: wasOut !== isOut,
      note:
        weightReason === "became_scorable"
          ? `${PILLAR_LABEL[p]} could not be scored in ${before.period_key} and can be in ${after.period_key}. `
            + `Its share of the weight came back from the other parts, which moves them all.`
          : weightReason === "stopped_being_scorable"
          ? `${PILLAR_LABEL[p]} could be scored in ${before.period_key} and cannot be in ${after.period_key}. `
            + `Its share of the weight went to the parts that could.`
          : null,
    };
  });

  const c0 = Number(before.composite);
  const c1 = Number(after.composite);
  const delta = round1(c1 - c0);
  const accountedFor = round1(steps.reduce((a, x) => a + x.delta, 0));
  const residual = round1(delta - accountedFor);
  const weightsMoved = steps.some((x) => x.weightReason !== "none");

  const bandOf = (b: string) => LABEL_BAND_MAP.find((x) => x.band === b)?.label ?? b;

  return resolved<ChangeRead>({
    symbol,
    fromPeriod: before.period_key,
    toPeriod: after.period_key,
    fromComposite: round1(c0),
    toComposite: round1(c1),
    delta,
    fromBandLabel: bandOf(before.label_band),
    toBandLabel: bandOf(after.label_band),
    steps,
    accountedFor,
    residual,
    reconciles: Math.abs(residual) <= 0.15,
    weightsMoved,
    basisSentence: steps.some((x) => x.crossing)
      ? `Between ${before.period_key} and ${after.period_key} a part of the score crossed in or out of `
        + `being measurable at all, which moves every other part's share along with it. Where that `
        + `happened the move is shown whole rather than split, because there is no earlier reading to `
        + `compare the later one against.`
      : weightsMoved
      ? `Between ${before.period_key} and ${after.period_key} the weights themselves moved, so each part `
        + `below is split into two: how much its own reading changed, and how much its share of the `
        + `score changed. Reading only the totals would credit the move to the wrong part.`
      : `Between ${before.period_key} and ${after.period_key} the weights held, so each part's move is `
        + `entirely its own reading changing.`,
  }, coverage, ["score_snapshots"]);
}
