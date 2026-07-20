// ─────────────────────────────────────────────────────────────────────────────
// SPLIT-ADJUST (Step 19) — THE ONE rule that back-adjusts a raw AMFI NAV onto today's unit basis.
//
// AMFI's NAV history is raw: an ETF that sub-divides its units 1:10 has its published NAV step down
// 90% overnight. Every consumer that must undo that — the nightly fold, the Step-21 weekly store,
// and the live /chart endpoint — divides a NAV struck on `day` by the cumulative factor of every
// REAL, dated split APPLIED after it. `appliedDay > day`, strictly: a NAV on or after the applied
// day is already on the new basis and is left alone.
//
// THIS FILE IS THE SINGLE SOURCE OF THAT RULE. It replaced two copies — the fold's inline loop and
// a duplicate `rescaleForSplits` in portfolio/history — so the three callers cannot drift. Add a
// caller, not a copy.
// ─────────────────────────────────────────────────────────────────────────────

/** A real, reconciled split (from instrument_corporate_events). `appliedDay` is integer epoch days. */
export interface SplitEvent {
  /** First day AMFI quoted the NEW basis (Math.floor(getTime()/86_400_000)). */
  appliedDay: number;
  /** oldFaceValue / newFaceValue, snapped — the exact divisor. */
  factor: number;
}

const MS_PER_DAY = 86_400_000;

/** Integer epoch day of a "YYYY-MM-DD" (UTC) — the same key the fold folds on. */
export function dayOf(iso: string): number {
  return Math.floor(Date.parse(iso + "T00:00:00Z") / MS_PER_DAY);
}

/** The cumulative divisor for a NAV struck on `day`: product of every split APPLIED after it (1 = none). */
export function splitDivisor(day: number, splits: SplitEvent[]): number {
  let f = 1;
  for (const s of splits) if (s.appliedDay > day) f *= s.factor;
  return f;
}

/** Back-adjust one NAV onto today's basis. Returns the input unchanged when no split applies. */
export function splitAdjustNav(nav: number, day: number, splits: SplitEvent[]): number {
  const f = splitDivisor(day, splits);
  return f === 1 ? nav : nav / f;
}

/** A dated value point (structurally the store's SeriesPoint). */
export interface DatedValue {
  date: string;
  value: number;
}

/**
 * Back-adjust a whole {date, value} series. A series with no splits is returned value-identical
 * (the object is reused); a point with no split after it is returned unchanged. Byte-identical, by
 * construction, to the fold — same divisor, same `appliedDay > day` boundary.
 */
export function rescaleForSplits<T extends DatedValue>(points: T[], splits: SplitEvent[]): T[] {
  if (splits.length === 0) return points;
  return points.map((p) => {
    const f = splitDivisor(dayOf(p.date), splits);
    return f === 1 ? p : { ...p, value: p.value / f };
  });
}
