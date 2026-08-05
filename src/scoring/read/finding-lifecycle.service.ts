// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FINDING LIFECYCLE RESOLVER — how long has this been true, which way is it moving, and did it end.
//
// ── ★ WHAT THIS ANSWERS THAT NOTHING ANSWERED ─────────────────────────────────────────────────────
// Every surface could only see TODAY. A 31-point gap read identically whether it was 14 last quarter
// or 40, and when a divergence CLOSED it simply vanished — no card, no record that it had existed.
// Both facts were already in the database and nothing read them:
//
//   score_patterns is APPEND-ONLY. A superseded row is never deleted, so a pattern that fired across
//   28 consecutive snapshot versions and then stopped is still fully queryable — with nothing
//   whatsoever marking it ended (BHEL's ownership_P5_insider_distress is exactly this).
//
// So this is a READ over existing rows. NO NEW TABLE, no new write path, and — critically — no rule
// is re-run and no firing decision is revisited. Every number here is read off a row a rule already
// wrote, or off a snapshot's own persisted pillar subtotals.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ TRAP 1 — VERSION CHURN IS NOT HISTORY. Read this before touching the query. ★
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// score_patterns has NO uniqueness constraint on (stock, period). It carries one row per snapshot
// VERSION: S2 alone has 136 rows across 45 stock-period groups; ACC/FY27Q1 exists at versions 11, 12
// and 13; GLENMARK/FY26Q4 at 36. Counting rows — or counting distinct (stock, key) rows — reads
// version churn as pattern history and inflates every run length several-fold.
//
// The collapse is `headOfChainByPeriod` (trajectory/load-series.ts), the SAME reduction the trajectory
// loader has always run, extracted so there is one copy rather than two that can drift.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ TRAP 2 — THERE ARE TWO CLOCKS, AND THE RECORD DECIDES WHICH ONE RUNS. ★
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PillarScore carries a DIFFERENT asOfDate per pillar. Market tracks the price date and moves on
// nearly every version; Foundation lags to the filing date and stays bit-identical for a whole
// quarter — GLENMARK's FY26Q4 has 36 versions with Foundation frozen at 35.0 throughout while Market
// travelled 83.8 → 69.9 → 71.3.
//
// A Market-driven gap can therefore OPEN, WIDEN AND COLLAPSE ENTIRELY INSIDE ONE QUARTER, and at
// head-per-period granularity that whole path is invisible — the head is one arbitrary point on it.
// So a pattern whose `pillarPair` includes `market` gets ALL versions within the CURRENT period
// (prior periods still collapse to head — the intra-quarter path of a closed quarter is not what a
// reader is asking about, and loading it for every period would be unbounded).
//
// ⚠ THE RECORD DECIDES. `FACTS.pillarPair.includes("market")` — no config flag, no per-key list to
// keep in sync. A pattern that is repointed onto Market picks up the right clock in the same edit
// that repoints it.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ TRAP 3 — A RETIRED RULE LOOKS EXACTLY LIKE A COLLAPSE IN THE ROW DATA. ★
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GLENMARK's divergence rows are C1/C2/C3 — every one RETIRED in the D-family rebuild. In the rows,
// "fired for six periods then stopped" is byte-identical whether the tension resolved or the rule was
// swapped out from under it. Reporting C2's retirement as "this divergence converged" would be a
// fabricated claim about a company, sourced from a change we made to our own catalogue.
//
// So RETIRED_FINDING_KEYS is excluded BEFORE any lifecycle is computed — not filtered from the output
// afterwards, because a retired key must never reach the run-walk at all (it would also truncate the
// live successor's run by occupying its periods).
//
// ⚠ AND THE CONVERSE, WHICH IS NOT A DEFECT: a live pattern's run can only start where its RULE
// starts. D1 cannot show a run reaching back into a quarter scored under C1, because no D1 row exists
// there. A short run on a young rule is an honest reading of what we actually recorded, and the
// resolver states the era it can see rather than extrapolating across it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import { headOfChainByPeriod, periodOrdinal } from "../findings/trajectory/load-series.js";
import { roundToPrecision } from "../findings/format.js";
import { isResolved, typeResolution, type Resolution } from "../findings/divergence/resolution.js";
import { isRetiredFinding } from "../../catalogue/retired-findings.js";
import { PATTERN_FACTS, isPatternKey, type PatternBasis, type PatternKey, type PatternSubject } from "../../catalogue/pattern-facts.js";
import type { Pillar } from "../composite/types.js";

// ── declared constants ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ THE DIRECTION DEADBAND, DECLARED. Below this the quantity is reported `steady` rather than being
 * labelled a move.
 *
 * ⚠ IT CLASSIFIES NOTHING AND GATES NOTHING. No rule reads it, no finding fires or is suppressed by
 * it; it decides one descriptive word on a card that is already being shown. That is why it lives
 * here as a display constant rather than on a pattern record — putting it there would dress a
 * presentation choice up as a scoring bar.
 *
 * WHY 1.0 AND NOT AN INVENTED NUMBER: the movement-floor ruling already fixed 1.0pp as this
 * codebase's answer to "is this move big enough to be worth calling a move" (T7/T8/T9's enforced
 * floors — below it the move is real but too small to be the thing the study measured). Reusing that
 * figure for a strictly weaker, descriptive question keeps one convention instead of two.
 */
export const LIFECYCLE_DIRECTION_DEADBAND = 1.0;

/**
 * ★ THE RECENTLY-ENDED WINDOW, DECLARED. Four quarters — one year. An ended finding older than this
 * is history, not context, and a tool surface that showed it beside today's firing set would be
 * competing with the reader's own sense of what is current.
 *
 * Stated as a number of PERIODS in the stock's own scored sequence, not as calendar time: a stock
 * with a gap in its coverage should not have an ending age out faster than one without.
 */
export const RECENTLY_ENDED_WINDOW_PERIODS = 4;

// ── the shape of a lifecycle — ★ DECLARED IN finding-lifecycle.types.ts (pure), re-exported here so
//    every existing importer of this service keeps working. See that file for why they moved.
export type {
  LifecycleState, LifecycleDirection, MovementPhase, LifecycleValueBasis, LifecycleClock,
  ValuePoint, IntraPeriodPoint, FindingLifecycle, EndedResolution, EndedFinding, MoveSide,
} from "./finding-lifecycle.types.js";
import type {
  LifecycleDirection, LifecycleState, MovementPhase, MoveSide, LifecycleValueBasis, ValuePoint, FindingLifecycle, IntraPeriodPoint,
  EndedResolution, EndedFinding,
} from "./finding-lifecycle.types.js";

// ── where each pattern's defining quantity lives in its own evidence ────────────────────────────────

/**
 * ⚠ `subject` AND `side` ARE DECLARED, NOT INFERRED FROM `pillarPair`'s ORDER. The moving/crossing
 * pillar is at index 0 for T5/T6/T7/T8/T9 and D3/D4, and at index 1 for D6/D7 (whose pair is
 * [foundation, momentum] but whose crossing subject is Momentum). Reading it by position would be
 * right eleven times and silently wrong twice, and the two it got wrong would report the WRONG
 * PILLAR's history under the pattern's name.
 */
type ValueSpec =
  | { readonly kind: "gap"; readonly field: string }
  | { readonly kind: "delta"; readonly field: string; readonly subject: PatternSubject; readonly moveSide: MoveSide }
  | {
      readonly kind: "distance_from_mark";
      readonly levelField: string;
      readonly markField: string;
      readonly subject: PatternSubject;
      /** Which side of the mark the pattern lives on — `crossedBelow` ⇒ "below". Decides what "past
       *  the floor" means for a crossing, which is directional in a way a gap is not. */
      readonly side: "below" | "above";
    };

/**
 * ★ THE RECORD'S OWN `basis` DECIDES WHICH SHAPE IS LEGAL. `PATTERN_FACTS` is declared with
 * `satisfies`, so each record's `basis` keeps its LITERAL type — which lets this mapped type demand
 * the matching spec shape per key, at compile time. Repoint a pattern from "gap" to "crossing" in the
 * catalogue and this table stops compiling until it is repointed too. That is the whole reason the
 * correspondence is expressed as a type rather than asserted in a comment.
 */
type ValueSpecFor<B extends PatternBasis> = B extends "gap"
  ? { readonly kind: "gap"; readonly field: string }
  : B extends "movement"
    ? { readonly kind: "delta"; readonly field: string; readonly subject: PatternSubject; readonly moveSide: MoveSide }
    : B extends "crossing"
      ? {
          readonly kind: "distance_from_mark";
          readonly levelField: string;
          readonly markField: string;
          readonly subject: PatternSubject;
          readonly side: "below" | "above";
        }
      : never;

/**
 * The evidence field each pattern's defining quantity is written to — read off the RULES that write
 * them, never guessed — plus the pillar that quantity is ABOUT, which is what lets the value series
 * (below) recompute the same quantity from stored pillar subtotals on periods that carry no row.
 * A misspelled field here would silently report `null` forever, which is why every one is asserted
 * against live rows in the lifecycle proof.
 */
const VALUE_SPEC = {
  // gap basis — every one writes `gapPp`; the pair is the record's own `pillarPair`
  divergence_S1_aligned: { kind: "gap", field: "gapPp" }, // never_emitted; present for totality only
  divergence_D1_price_ahead_quality: { kind: "gap", field: "gapPp" },
  divergence_D2_price_ahead_trajectory: { kind: "gap", field: "gapPp" },
  divergence_D5_laggard_catching_up: { kind: "gap", field: "gapPp" },
  divergence_S2_sticky_divergence: { kind: "gap", field: "gapPp" },
  // movement basis — the Δ the rule fired on, and whose Δ it is
  divergence_D3_ownership_building_weak_foundation: { kind: "delta", field: "ownershipDeltaPp", subject: "ownership", moveSide: "up" },
  divergence_D4_ownership_exiting_healthy: { kind: "delta", field: "ownershipDeltaPp", subject: "ownership", moveSide: "down" },
  trajectory_D_T1_recovery_low_zone: { kind: "delta", field: "movePp", subject: "composite", moveSide: "up" },
  trajectory_B_T2_deterioration_high_base: { kind: "delta", field: "movePp", subject: "composite", moveSide: "down" },
  trajectory_D_T7_momentum_improving_while_weak: { kind: "delta", field: "risePp", subject: "momentum", moveSide: "up" },
  trajectory_D_T8_foundation_strong_improving: { kind: "delta", field: "risePp", subject: "foundation", moveSide: "up" },
  trajectory_B_T9_foundation_weak_declining: { kind: "delta", field: "fallPp", subject: "foundation", moveSide: "down" },
  // crossing basis — the level, the mark it crossed, and which side of it the pattern lives on
  divergence_D6_quality_rolling_over: { kind: "distance_from_mark", levelField: "momentum", markField: "crossedBelow", subject: "momentum", side: "below" },
  divergence_D7_trajectory_breaking_base_holds: { kind: "distance_from_mark", levelField: "momentum", markField: "crossedBelow", subject: "momentum", side: "below" },
  trajectory_B_T3_falling_out_of_pristine: { kind: "distance_from_mark", levelField: "compositeNow", markField: "crossedBelow", subject: "composite", side: "below" },
  trajectory_D_T4_recovering_out_of_below_par: { kind: "distance_from_mark", levelField: "compositeNow", markField: "crossedAbove", subject: "composite", side: "above" },
  trajectory_D_T5_foundation_out_of_weak: { kind: "distance_from_mark", levelField: "foundationNow", markField: "crossedAbove", subject: "foundation", side: "above" },
  trajectory_B_T6_momentum_breaking_into_weak: { kind: "distance_from_mark", levelField: "momentumNow", markField: "crossedBelow", subject: "momentum", side: "below" },
} satisfies { [K in PatternKey]: ValueSpecFor<(typeof PATTERN_FACTS)[K]["basis"]> };

const BASIS_OF: Record<ValueSpec["kind"], LifecycleValueBasis> = {
  gap: "gap",
  delta: "delta",
  distance_from_mark: "distance_from_mark",
};

// ── row plumbing ───────────────────────────────────────────────────────────────────────────────────

const num = (d: unknown): number | null => {
  if (d == null) return null;
  const n = typeof d === "object" && d !== null && "toNumber" in d ? (d as { toNumber(): number }).toNumber() : Number(d);
  return Number.isFinite(n) ? n : null;
};
const evNum = (ev: unknown, field: string): number | null => {
  if (!ev || typeof ev !== "object") return null;
  const v = (ev as Record<string, unknown>)[field];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

interface SnapRow {
  id: string;
  periodKey: string;
  version: number;
  asOfDate: Date;
  /** Always a number when a snapshot exists — the composite is never "unavailable". */
  composite: number | null;
  foundation: number | null;
  momentum: number | null;
  market: number | null;
  ownership: number | null;
}

interface PatRow {
  snapshotId: string;
  patternKey: string;
  evidence: unknown;
}

/** The four pillar subtotals, INERT-0 GUARDED. An `unavailable_redistributed` pillar persists a 0
 *  that is not a score; differencing against it would fabricate a ~60-point gap and turn a resolved
 *  divergence into a maximal one. Availability is read off the APPLIED WEIGHT, the only honest signal
 *  on a historical row — the same guard trajectory/load-series.ts applies. */
function pillarsOf(r: {
  foundationSubtotal: unknown; momentumSubtotal: unknown; marketSubtotal: unknown; ownershipSubtotal: unknown;
  wFoundation: unknown; wMomentum: unknown; wMarket: unknown; wOwnership: unknown;
}): Pick<SnapRow, "foundation" | "momentum" | "market" | "ownership"> {
  const w = (x: unknown) => (num(x) ?? 0) > 0;
  return {
    foundation: w(r.wFoundation) ? num(r.foundationSubtotal) : null,
    momentum: w(r.wMomentum) ? num(r.momentumSubtotal) : null,
    market: w(r.wMarket) ? num(r.marketSubtotal) : null,
    ownership: w(r.wOwnership) ? num(r.ownershipSubtotal) : null,
  };
}

// ── the resolver ───────────────────────────────────────────────────────────────────────────────────

export interface LifecycleResult {
  /** Lifecycle for every key FIRING at the current head, keyed by patternKey. */
  firing: Map<string, FindingLifecycle>;
  /** Keys that fired in a prior period's head and are absent from the current one, newest ending
   *  first, bounded to {@link RECENTLY_ENDED_WINDOW_PERIODS}. Retired keys are never here. */
  recentlyEnded: EndedFinding[];
}

/**
 * Resolve every finding lifecycle for a stock, against its current head period.
 *
 * PURE READ. Two queries, no writes, no rule evaluation. Returns empty maps for an unscored stock.
 *
 * @param currentPeriodKey ⚠ PASS THIS WHENEVER THE CALLER ALREADY RESOLVED A HEAD SNAPSHOT.
 *        There are TWO head-resolution orderings in this codebase and they are not the same function:
 *        `getLatestSnapshotRef` picks the newest by **asOfDate** across periods, while a period-series
 *        walk (this module, loadTrajectorySeries) orders by **periodOrdinal**. They agree on today's
 *        data and would silently disagree on a stock whose newest asOfDate sits on an older periodKey
 *        — and the disagreement would not look like a bug: every lifecycle would simply come back
 *        `null` for findings that are visibly firing, because "current" meant two different periods on
 *        the two sides of the join. Taking the caller's own answer removes the question rather than
 *        keeping two derivations in step. Omitted ⇒ this module derives it (the standalone path).
 */
export async function resolveFindingLifecycles(
  stockId: string,
  currentPeriodKey?: string,
): Promise<LifecycleResult> {
  const snapRowsRaw = await prisma.scoreSnapshot.findMany({
    where: { stockId, snapshotType: "quarterly" },
    select: {
      id: true, periodKey: true, version: true, asOfDate: true, composite: true,
      foundationSubtotal: true, momentumSubtotal: true, marketSubtotal: true, ownershipSubtotal: true,
      wFoundation: true, wMomentum: true, wMarket: true, wOwnership: true,
    },
  });
  if (snapRowsRaw.length === 0) return { firing: new Map(), recentlyEnded: [] };

  const snaps: SnapRow[] = snapRowsRaw.map((r) => ({
    id: r.id, periodKey: r.periodKey, version: r.version, asOfDate: r.asOfDate,
    composite: num(r.composite), ...pillarsOf(r),
  }));

  // ★ TRAP 1 — collapse version churn to one row per period. The SAME reduction the trajectory
  //   loader runs (headOfChainByPeriod), not a second implementation of it.
  const headSnapByPeriod = headOfChainByPeriod(snaps);
  const periodsAsc = [...headSnapByPeriod.keys()].sort((a, b) => periodOrdinal(a) - periodOrdinal(b));
  // The caller's head wins when it gave one — see the param note. Its absence from our own period
  // list would mean the two sides disagree about which periods exist at all, which is not something
  // to paper over: fall back to our derivation rather than index off the end.
  const callerIndex = currentPeriodKey === undefined ? -1 : periodsAsc.indexOf(currentPeriodKey);
  const currentIndex = callerIndex >= 0 ? callerIndex : periodsAsc.length - 1;
  const currentPeriod = periodsAsc[currentIndex];
  const currentHead = headSnapByPeriod.get(currentPeriod)!;

  const patRows: PatRow[] = await prisma.scorePattern.findMany({
    where: { snapshotId: { in: snaps.map((s) => s.id) } },
    select: { snapshotId: true, patternKey: true, evidence: true },
  });

  // ★ TRAP 3 — retired keys are dropped HERE, before any run is walked. A retired key left in would
  //   both fabricate a resolution event and truncate its live successor's run by occupying periods.
  //   (RETIRED_FINDING_KEYS is the registry; isRetiredFinding is its predicate.)
  const live = patRows.filter((p) => !isRetiredFinding(p.patternKey));

  // fired keys per HEAD snapshot, by period
  const snapById = new Map(snaps.map((s) => [s.id, s]));
  const headIds = new Set([...headSnapByPeriod.values()].map((s) => s.id));
  const firedByPeriod = new Map<string, Map<string, PatRow>>();
  for (const p of live) {
    if (!headIds.has(p.snapshotId)) continue;
    const period = snapById.get(p.snapshotId)!.periodKey;
    if (!firedByPeriod.has(period)) firedByPeriod.set(period, new Map());
    firedByPeriod.get(period)!.set(p.patternKey, p);
  }

  // every key that has EVER fired on a head, live-catalogue only
  const allKeys = new Set<string>();
  for (const m of firedByPeriod.values()) for (const k of m.keys()) allKeys.add(k);

  const firing = new Map<string, FindingLifecycle>();
  const ended: EndedFinding[] = [];

  for (const key of allKeys) {
    // ── the run walk: newest period in which it fired, then backwards while CONTIGUOUS ──
    // ⚠ Starts at `currentIndex`, NOT at the end of the array. When the caller supplied a head that
    // is not the last period we hold, everything after it is the FUTURE relative to this read, and a
    // fire there must not be reported as "still firing" — the same point-in-time discipline
    // loadTrajectorySeries enforces with its strictlyBefore cut.
    let lastIdx = -1;
    for (let i = currentIndex; i >= 0; i--) {
      if (firedByPeriod.get(periodsAsc[i])?.has(key)) { lastIdx = i; break; }
    }
    if (lastIdx === -1) continue;
    let firstIdx = lastIdx;
    while (firstIdx - 1 >= 0 && firedByPeriod.get(periodsAsc[firstIdx - 1])?.has(key)) firstIdx--;

    const isFiring = lastIdx === currentIndex;
    const thenRow = firedByPeriod.get(periodsAsc[firstIdx])!.get(key)!;
    const nowRow = firedByPeriod.get(periodsAsc[lastIdx])!.get(key)!;

    const facts = isPatternKey(key) ? PATTERN_FACTS[key] : null;
    const spec: ValueSpec | null = isPatternKey(key) ? VALUE_SPEC[key] : null;

    // ── the VALUE series: the quantity itself, over every head, independent of where rows exist ──
    const built = facts && spec
      ? buildValueSeries(facts, spec, periodsAsc, headSnapByPeriod, currentIndex)
      : { series: [] as ValuePoint[], floor: null };
    const valueSeries = built.series;
    const periodsPastFloor = countPastFloor(valueSeries);

    // ★ valueThen / valueNow COME FROM THE SERIES when it has them — the series reaches periods the
    //   row history cannot, which is the whole point of Part 1. The fired rows' own evidence is the
    //   fallback, used when a pattern's subject pillars were never scored together.
    const seriesNow = valueSeries.length ? valueSeries[valueSeries.length - 1].value : null;
    // "Then" is the start of the PAST-FLOOR run when there is one (that is the span the reader is
    // being told about); otherwise the oldest point we hold.
    const thenIdx = periodsPastFloor > 0 ? valueSeries.length - periodsPastFloor : 0;
    const seriesThen = valueSeries.length ? valueSeries[thenIdx].value : null;

    const valueThen = seriesThen ?? (spec ? readValue(spec, thenRow.evidence) : null);
    const valueNow = seriesNow ?? (isFiring && spec ? readValue(spec, nowRow.evidence) : null);

    const direction = directionOf(valueThen, valueNow);

    // ── resolution: gap-basis, two real pillars, ended, both ends readable ──
    let resolution: EndedResolution | null = null;
    if (!isFiring && facts && spec?.kind === "gap") {
      resolution = resolveClosure(facts.pillarPair, thenRow.evidence, currentHead);
    }

    const lc: FindingLifecycle = {
      patternKey: key,
      state: isFiring ? "firing" : "ended",
      firstSeen: periodsAsc[firstIdx],
      lastSeen: periodsAsc[lastIdx],
      runLength: lastIdx - firstIdx + 1,
      valueThen,
      valueNow,
      valueBasis: spec ? BASIS_OF[spec.kind] : null,
      valueSeries,
      periodsPastFloor,
      floor: built.floor,
      direction,
      directionDeadband: LIFECYCLE_DIRECTION_DEADBAND,
      movementPhase: movementPhaseOf(valueSeries, periodsPastFloor, direction, isFiring ? "firing" : "ended"),
      resolution,
      endedPeriodsAgo: currentIndex - lastIdx,
      // ★ TRAP 2 — the RECORD decides the clock. No flag.
      clock: usesMarketClock(facts) ? "all_versions_in_current_period" : "head_per_period",
      intraPeriod: usesMarketClock(facts)
        ? buildIntraPeriodPath(key, spec, currentPeriod, snaps, live)
        : null,
    };

    if (isFiring) firing.set(key, lc);
    else if (lc.endedPeriodsAgo <= RECENTLY_ENDED_WINDOW_PERIODS) ended.push({ patternKey: key, lifecycle: lc });
  }

  ended.sort((a, b) => a.lifecycle.endedPeriodsAgo - b.lifecycle.endedPeriodsAgo);
  return { firing, recentlyEnded: ended };
}

function usesMarketClock(facts: { pillarPair: readonly string[] } | null): boolean {
  return facts !== null && facts.pillarPair.includes("market");
}

/** One subject's stored value at a head — pillar subtotal, or the composite. Inert-0 guarded upstream
 *  (`pillarsOf`), so a null here means "not scored then", never "scored zero". */
function subjectValue(subject: PatternSubject, s: SnapRow): number | null {
  return subject === "composite" ? s.composite : s[subject];
}

/**
 * ★ THE FLOOR THE QUANTITY IS MEASURED AGAINST — read off the record, per basis. Null when the record
 * declares none, in which case `pastFloor` is null everywhere and no "how long past the floor"
 * language is available. Nothing is invented to fill that in.
 */
function floorOf(facts: (typeof PATTERN_FACTS)[PatternKey], spec: ValueSpec): number | null {
  if (spec.kind === "gap") return facts.gapFloor;
  if (spec.kind === "delta") return facts.movementFloor;
  return evNumOrNull(facts.evidencedTier); // a crossing's floor IS the mark it crossed
}
const evNumOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Is this value past the floor, IN THE SENSE THE PATTERN MEANS?
 *
 *   gap        by MAGNITUDE — a gap has no direction of its own.
 *   crossing    by SIDE — below the mark for D6/D7/T3/T6, at-or-above it for T4/T5.
 *   movement    by MAGNITUDE **AND SIGN**.
 *
 * ⚠ THE SIGN ON A MOVEMENT IS NOT OPTIONAL, AND LEAVING IT OUT PRODUCED A FALSE SENTENCE. GLENMARK's
 * Momentum moved −1.1 into FY26Q4 and +5.6 into FY27Q1. On magnitude alone BOTH clear T7's 1.0pp
 * floor, so the series read "past the floor for 2 readings" and the card said "it has been this way
 * for 2 readings" — about a quarter in which the trajectory FELL. T7 is `now > prev`; a fall is not a
 * quieter version of it, it is the opposite condition (and is T6's territory outright).
 *
 * The side is DECLARED on the spec rather than taken from a sign on `movementFloor`, because the
 * record deliberately stores magnitude only — t2-deterioration-high-base.ts states the rule: "the SIGN
 * IS THE PATTERN'S, NOT THE RECORD'S", which is what makes T2 the mirror of T1 with one shared floor.
 */
function isPastFloor(spec: ValueSpec, value: number, floor: number): boolean {
  if (spec.kind === "distance_from_mark") return spec.side === "below" ? value < floor : value >= floor;
  if (spec.kind === "delta") return spec.moveSide === "up" ? value >= floor : value <= -floor;
  return Math.abs(value) >= floor;
}

/**
 * ★ THE VALUE SERIES — the pattern's own quantity at every period head, recomputed from stored pillar
 * subtotals. See {@link ValuePoint} for why this is arithmetic and not a rule replay.
 *
 *   gap        |pillarA − pillarB| from the record's own pillarPair
 *   movement   the Δ of the declared subject between ADJACENT heads (so the oldest head has no point)
 *   crossing   the declared subject's LEVEL
 */
function buildValueSeries(
  facts: (typeof PATTERN_FACTS)[PatternKey],
  spec: ValueSpec,
  periodsAsc: readonly string[],
  headByPeriod: ReadonlyMap<string, SnapRow>,
  upToIndex: number,
): { series: ValuePoint[]; floor: number | null } {
  const floor = floorOf(facts, spec);
  const series: ValuePoint[] = [];
  const at = (i: number) => headByPeriod.get(periodsAsc[i])!;

  for (let i = 0; i <= upToIndex; i++) {
    const s = at(i);
    let value: number | null = null;

    if (spec.kind === "gap") {
      const pair = gapPair(facts.pillarPair);
      if (pair) {
        const a = subjectValue(pair[0], s);
        const b = subjectValue(pair[1], s);
        value = a === null || b === null ? null : Math.abs(a - b);
      }
    } else if (spec.kind === "delta") {
      // A movement needs two adjacent readings. The oldest head has no predecessor — that is a hole in
      // the series, not a zero move.
      if (i > 0) {
        const now = subjectValue(spec.subject, s);
        const prev = subjectValue(spec.subject, at(i - 1));
        value = now === null || prev === null ? null : now - prev;
      }
    } else {
      value = subjectValue(spec.subject, s);
    }

    series.push({
      periodKey: periodsAsc[i],
      // ★ ROUNDED ONCE, AT THE PATTERN’S OWN DECLARED PRECISION. The raw subtraction carries float
      // residue (22.283299999999997); serving that would put a number on the wire that no surface
      // should print and that no reader could reconcile with the pillars it came from.
      value: value === null ? null : roundToPrecision(value, facts.displayPrecision),
      // ⚠ the FLOOR TEST USES THE RAW VALUE, not the rounded one — rounding first would let a
      //   quantity a hair under its floor round up onto it, which is the display-precision defect the
      //   firing gates already close (format.ts). Display rounds; decisions do not.
      pastFloor: value === null || floor === null ? null : isPastFloor(spec, value, floor),
    });
  }
  return { series, floor };
}

/** Consecutive most-recent periods whose quantity is past the floor. A null point BREAKS the run — an
 *  unscored quarter is not evidence that the condition held through it. */
function countPastFloor(series: readonly ValuePoint[]): number {
  let n = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].pastFloor !== true) break;
    n++;
  }
  return n;
}

/**
 * ★ THE MOVEMENT PHASE — see {@link MovementPhase}. Pure derivation over the series and the direction
 * the deadband already decided; it introduces no threshold of its own.
 *
 * Returns null when the series says nothing usable: no points, no floor to be past, or a quantity
 * that has never been past the floor at all. A null phase emits NO movement clause — the card simply
 * does not describe a path it cannot see, which is the honest degrade.
 */
function movementPhaseOf(
  series: readonly ValuePoint[],
  periodsPastFloor: number,
  direction: LifecycleDirection | null,
  state: LifecycleState,
): MovementPhase | null {
  if (series.length === 0) return null;
  const everPastFloor = series.some((p) => p.pastFloor === true);
  if (!everPastFloor) return null; // nothing to say — it has never been past the floor
  if (periodsPastFloor === 0) {
    // ★ THE TWO SUBSTRATES CONTRADICT EACH OTHER HERE, AND SILENCE IS THE HONEST OUTPUT.
    // A FIRING row says the pattern holds; a quantity under its floor says it does not. That happens
    // on a stale head — BHEL's T7 row was written on an earlier version and its current Δ is under the
    // 1.0pp floor. Rendering "this has closed" on a card the reader can see is firing would be a
    // visible self-contradiction, and asserting either side over the other would be picking a winner
    // between two substrates we have deliberately kept separate. So: no movement clause. The
    // disagreement stays legible in `periodsPastFloor` / `runLength` for anyone reading the facts.
    return state === "firing" ? null : "closed";
  }
  if (periodsPastFloor === 1) return "building"; // first period past — it has just got here
  if (direction === "widening") return "widening";
  if (direction === "narrowing") return "narrowing";
  return "sticky"; // past the floor, flat, more than one period — S2's own reading
}

function readValue(spec: ValueSpec, evidence: unknown): number | null {
  if (spec.kind === "distance_from_mark") {
    const level = evNum(evidence, spec.levelField);
    const mark = evNum(evidence, spec.markField);
    return level === null || mark === null ? null : level - mark;
  }
  return evNum(evidence, spec.field);
}

/** |value| grew / shrank / held, against the declared deadband. Magnitude, not sign — see the
 *  `direction` field note. */
function directionOf(then: number | null, now: number | null): LifecycleDirection | null {
  if (then === null || now === null) return null;
  const d = Math.abs(now) - Math.abs(then);
  return d > LIFECYCLE_DIRECTION_DEADBAND ? "widening" : d < -LIFECYCLE_DIRECTION_DEADBAND ? "narrowing" : "steady";
}

/** Exactly the two real pillars a gap-basis pattern names, or null. S1 names four and never fires. */
function gapPair(pillarPair: readonly string[]): [Pillar, Pillar] | null {
  if (pillarPair.length !== 2) return null;
  const [a, b] = pillarPair;
  if (a === "composite" || b === "composite") return null;
  return [a as Pillar, b as Pillar];
}

/**
 * Type the closure of an ended gap-basis pattern.
 *
 * `*Then` comes off the fired row's OWN evidence at run start — every gap-basis rule writes its two
 * pillar readings under the pillar's own name (`market`/`foundation`/`momentum`), so the pair is read
 * by name, not by position. `*Now` comes off the current head's pillars. Which pillar LED is decided
 * by the THEN values: the divergence was defined by whichever was on top when it opened, and a
 * leader that has since fallen below the laggard is precisely the collapse case — re-deciding the
 * roles from today's values would erase it.
 */
function resolveClosure(pillarPair: readonly string[], thenEvidence: unknown, head: SnapRow): EndedResolution | null {
  const pair = gapPair(pillarPair);
  if (!pair) return null;
  const aThen = evNum(thenEvidence, pair[0]);
  const bThen = evNum(thenEvidence, pair[1]);
  if (aThen === null || bThen === null) return null;

  const [leadPillar, lagPillar] = aThen >= bThen ? [pair[0], pair[1]] : [pair[1], pair[0]];
  const leaderThen = Math.max(aThen, bThen);
  const laggardThen = Math.min(aThen, bThen);
  const leaderNow = head[leadPillar];
  const laggardNow = head[lagPillar];
  if (leaderNow === null || laggardNow === null) return null;

  const r = typeResolution({ laggardThen, leaderThen, laggardNow, leaderNow });
  return { ...r, resolved: isResolved(r.gapNow), leadPillar, lagPillar };
}

/**
 * ★ TRAP 2's payload — the intra-quarter path for a Market-clock pattern.
 *
 * Every version of the CURRENT period in version order, each marked with whether the pattern was
 * firing at that version and, if so, its defining quantity. This is what makes "the gap opened,
 * widened and collapsed inside one quarter" readable at all; at head-per-period it is one point.
 */
function buildIntraPeriodPath(
  key: string,
  spec: ValueSpec | null,
  currentPeriod: string,
  snaps: readonly SnapRow[],
  live: readonly PatRow[],
): IntraPeriodPoint[] {
  const bySnap = new Map<string, PatRow>();
  for (const p of live) if (p.patternKey === key) bySnap.set(p.snapshotId, p);
  return snaps
    .filter((s) => s.periodKey === currentPeriod)
    .sort((a, b) => a.version - b.version)
    .map((s) => {
      const row = bySnap.get(s.id) ?? null;
      return {
        version: s.version,
        asOfDate: s.asOfDate.toISOString().slice(0, 10),
        firing: row !== null,
        value: row && spec ? readValue(spec, row.evidence) : null,
      };
    });
}
