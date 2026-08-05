// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE FINDING-LIFECYCLE SHAPES. PURE TYPES — no imports that reach a database, a clock or an env.
//
// ── ★ WHY THESE LEFT THE SERVICE ────────────────────────────────────────────────────────────
// `verdicts.ts` is a COPY module — pure, no I/O, imported by build gates that are forbidden from
// reaching the DB client (verify-build-gate-hygiene.ts enforces exactly that, and it caught this). The
// clause composer needs the lifecycle SHAPE to read a movement phase off it; it does not need, and must
// not acquire, the QUERY that produces one. A `import type` is erased at runtime, but the hygiene scan
// walks the import graph as written — and it is right to: a type-only edge is one keystroke from a
// value edge, and the day someone drops the `type` a pure copy module starts constructing a pg Pool.
//
// So the shapes live here, the query lives in finding-lifecycle.service.ts, and the composer imports
// only the former. One home per fact, and the dependency points the way the layering does.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

import type { Resolution } from "../findings/divergence/resolution.js";
import type { Pillar } from "../composite/types.js";


export type LifecycleState = "firing" | "ended";
export type LifecycleDirection = "widening" | "narrowing" | "steady";

/**
 * ★ WHAT THE QUANTITY IS DOING — the fact the `movement` clause turns into words. Derived from the
 * value series and nothing else; it is a statement about a number's path, NEVER about an outcome.
 *
 *   building    past the floor for the FIRST period — it has just got here
 *   widening    past the floor and growing
 *   narrowing   past the floor and shrinking (still past it)
 *   sticky      past the floor, flat, across more than one period — S2's own reading, generalised
 *   closed      was past the floor and no longer is
 *
 * ⚠ `closed` IS ABOUT THE QUANTITY, NOT ABOUT THE PATTERN'S ROW. A gap that fell back under its floor
 * has closed whether or not a row stopped being written, and the two can disagree — see
 * {@link FindingLifecycle.periodsPastFloor}.
 */
export type MovementPhase = "building" | "widening" | "narrowing" | "sticky" | "closed";

/** Which way a movement pattern's Δ must go to be the pattern's own condition. See the note on
 *  `moveSide` in the service's VALUE_SPEC for why this is declared rather than taken from a sign on
 *  `movementFloor`. */
export type MoveSide = "up" | "down";

/**
 * Which quantity `valueThen`/`valueNow` carry. Derived from the pattern's own `basis` — never chosen
 * per call site.
 *
 *   gap                  a standing distance between the two pillars the pattern names.
 *   delta                the Δ between two adjacent readings that the pattern fired on.
 *   distance_from_mark   ⚠ AN INTERPRETIVE CALL, STATED. A CROSSING pattern has no continuous
 *                        defining quantity of its own — it is a boundary event, and "the size of the
 *                        crossing" is precisely the thing the spec says is not the pattern (D6/D7's
 *                        headers, Trajectory §1.3). What DOES carry through a run is how far past the
 *                        crossed mark the reading now sits, so that is what is reported, and it is
 *                        named distinctly so no surface can mistake it for a gap or a move.
 */
export type LifecycleValueBasis = "gap" | "delta" | "distance_from_mark";

/** Which clock the run was measured on — carried so a reader of the payload can see it. */
export type LifecycleClock = "head_per_period" | "all_versions_in_current_period";

/**
 * ★ ONE POINT ON THE VALUE SERIES — the pattern's own quantity, recomputed from the stored pillar
 * subtotals at a period's head.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ WHY THIS EXISTS, AND THE LINE IT MUST NOT CROSS ★★
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * The row history answers "how long has this pattern been on the books" — and every live D/S/T run is
 * length 1, because the family is one quarter old. That is an honest answer to a question nobody is
 * asking. The reader wants "how has this quantity moved", and the pillar subtotals have carried that
 * answer all along.
 *
 * ⚠ THIS IS ARITHMETIC OVER STORED PILLAR VALUES, USING THE RECORD'S OWN `pillarPair`/`subject`. IT IS
 * NOT A REPLAY OF THE RULE. Nothing here asks "would the pattern have fired in FY26Q2" — that would be
 * running today's rules (or worse, retired ones) against old data and presenting the result as a
 * history that never existed. A gap of 31 in FY26Q2 is a FACT about two stored numbers. "D1 fired in
 * FY26Q2" would be a CLAIM, and we did not make it at the time.
 *
 * The two substrates are reported side by side and neither overwrites the other — see
 * {@link FindingLifecycle.valueSeries} and the IOC case in the build report.
 */
export interface ValuePoint {
  periodKey: string;
  /** The pattern's defining quantity at this period's head. Null when a pillar it needs was not
   *  scored then (the inert-0 guard) — a hole, never a zero. */
  value: number | null;
  /** Is the quantity past the floor its record declares? Null when `value` is null, or when the
   *  pattern declares no floor to be past. */
  pastFloor: boolean | null;
}

/** One point on a Market-clock pattern's intra-quarter path. */
export interface IntraPeriodPoint {
  version: number;
  asOfDate: string;
  /** Was the pattern firing at THIS version? */
  firing: boolean;
  /** The pattern's defining quantity at this version, when it was firing. Null when it was not. */
  value: number | null;
}

export interface FindingLifecycle {
  patternKey: string;
  state: LifecycleState;
  /** The period the pattern first fired in the CURRENT UNBROKEN run. Contiguous — a period in which
   *  it did not fire ends the run, exactly as S2's own sustain walk treats a closed gap. */
  firstSeen: string;
  /** The most recent period in which it fired. Equals the current period when `state` is "firing". */
  lastSeen: string;
  /** Consecutive periods in that run. 1 = fired this period only. NEVER a row count — see TRAP 1. */
  runLength: number;
  /**
   * The defining quantity at the start of the PAST-FLOOR run, and now — both taken from
   * {@link valueSeries} when it has them, because that series spans periods the row history cannot
   * reach. Falls back to the fired rows' own evidence when the series cannot be built.
   */
  valueThen: number | null;
  valueNow: number | null;
  valueBasis: LifecycleValueBasis | null;
  /**
   * ★ THE VALUE SERIES — the quantity at every period head we hold, oldest→newest. This is what makes
   * "a 31-point gap that was 14 last quarter" sayable. See {@link ValuePoint} for the line it does not
   * cross. Empty when the pattern's subject pillars were never scored together.
   */
  valueSeries: ValuePoint[];
  /**
   * How many CONSECUTIVE most-recent periods the quantity has been past its declared floor. 0 when it
   * is not past it now. ⚠ THIS IS NOT `runLength`: it counts the QUANTITY's periods, not the ROW's,
   * and on IOC's S2 the two legitimately differ (3 vs 1). Both travel.
   */
  periodsPastFloor: number;
  /** The floor the series is measured against — `gapFloor` for a gap, `movementFloor` for a movement,
   *  the crossed mark for a crossing. Null when the record declares none. */
  floor: number | null;
  /** Widening / narrowing / steady on |value|, against {@link LIFECYCLE_DIRECTION_DEADBAND}.
   *  Magnitude, not sign: D4's −12 → −18 is a BIGGER exit, not a smaller one. */
  direction: LifecycleDirection | null;
  directionDeadband: number;
  /** What the quantity is doing — see {@link MovementPhase}. Null when there is no usable series, in
   *  which case the `movement` clause is simply not emitted. Nothing is guessed to fill the slot. */
  movementPhase: MovementPhase | null;
  /** How the divergence ended. Non-null only when `state` is "ended" AND the pattern is gap-basis over
   *  two real pillars AND both ends are readable — see {@link EndedResolution}. */
  resolution: EndedResolution | null;
  /** Periods between `lastSeen` and the current period, in the stock's own scored sequence.
   *  0 while firing. */
  endedPeriodsAgo: number;
  clock: LifecycleClock;
  /** The intra-quarter path — populated ONLY on the Market clock (TRAP 2). Null otherwise, which is a
   *  statement that this pattern does not move within a quarter, not that the data was unavailable. */
  intraPeriod: IntraPeriodPoint[] | null;
}

/**
 * A typed closure. `type` is {@link typeResolution}'s discriminant, unchanged.
 *
 * ⚠ `resolved` IS A SEPARATE QUESTION FROM `type`, AND CONFLATING THEM WOULD OVERSTATE. A pattern can
 * stop firing with its gap still wide — D1 stops the moment Market drops below 74 even with a 30-point
 * gap standing. `type` says WHICH pillar did the moving; `resolved` says whether the tension actually
 * closed back into the aligned band (§1.4, S1's own ceiling via `isResolved`). Only both together
 * support "this divergence converged".
 */
export interface EndedResolution extends Resolution {
  /** Did the gap close back into S1's aligned band, or did the pattern merely stop firing? */
  resolved: boolean;
  leadPillar: Pillar;
  lagPillar: Pillar;
}

/** An ended finding carried for the tool surfaces — flagged, never mixed into the firing set. */
export interface EndedFinding {
  patternKey: string;
  lifecycle: FindingLifecycle;
}

