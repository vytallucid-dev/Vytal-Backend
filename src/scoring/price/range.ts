// File: src/scoring/price/range.ts
//
// SHARED 52-WEEK RANGE KERNEL (CN-1, LOCKED single source of truth).
//
// The trailing-52-week, daily-CLOSE-based range position on a given as-of day,
// requiring ≥180 trailing trading days. This is the ONE definition used by BOTH:
//   • Ownership A1 — the inter-filing-window "close touched bottom-25% of 52w
//     range" conviction-buy condition (src/scripts/ownership-full-check.ts:
//     makePriceProbe now calls this per window-day), and
//   • Market sub-component 1 — "where the current price sits in its 52w range"
//     (src/scoring/market/subcomponents.ts calls this at the snapshot day).
// Extracted here from the previously-inline A1 logic so A1 and Market can NEVER
// disagree on "bottom 25% of range" / "range position" for the same stock/day.
//
// PURE: no DB, no I/O. Caller supplies the daily CLOSE series.

/** ≥180 trading days of trailing history required for a meaningful 52w range.
 *  Was MIN_TRAILING_DAYS in the A1 harness; now the shared constant. */
export const MIN_TRAILING_DAYS = 180;

/** One trading day's close (ascending-date series; one row per date). */
export interface DailyClose {
  date: Date;
  close: number;
}

export interface RangePosition {
  available: boolean; // false ⇒ insufficient history / no close on-or-before asOf
  /** (close − low) / (high − low) in the trailing window, a FRACTION in [0,1].
   *  null when unavailable or the window is degenerate (high == low). */
  position: number | null;
  low: number | null; // trailing-window min close
  high: number | null; // trailing-window max close
  close: number | null; // the evaluation day's close
  evalDate: string | null; // YYYY-MM-DD of the evaluation day (last close ≤ asOf)
  trailingDays: number; // count of closes in the trailing window
  reason: string | null; // why unavailable / degenerate
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Range position of the latest close ON OR BEFORE `asOf`, within its own trailing
 * 52 weeks. IDENTICAL math to the original A1 probe: window = (evalDate − 1 UTC
 * year, evalDate], min/max of CLOSE, ≥180 days required, fraction (close−lo)/
 * (hi−lo). A1 calls this once per inter-filing-window day; Market once per
 * snapshot. Single source ⇒ A1 and Market agree by construction.
 */
export function rangePositionAsOf(series: DailyClose[], asOf: Date): RangePosition {
  // Evaluation day = the most recent close on or before asOf (one row per date).
  let d: DailyClose | null = null;
  for (const s of series) {
    if (s.date <= asOf && (d === null || s.date > d.date)) d = s;
  }
  if (d === null) {
    return { available: false, position: null, low: null, high: null, close: null, evalDate: null, trailingDays: 0, reason: "no close on or before as-of date" };
  }

  // Trailing 52 weeks: (evalDate − 1 UTC year, evalDate]. EXACT A1 replication.
  const lo = new Date(d.date);
  lo.setUTCFullYear(lo.getUTCFullYear() - 1);
  const trailing = series.filter((s) => s.date > lo && s.date <= d!.date);

  if (trailing.length < MIN_TRAILING_DAYS) {
    return { available: false, position: null, low: null, high: null, close: d.close, evalDate: iso(d.date), trailingDays: trailing.length, reason: `only ${trailing.length} trailing trading days (<${MIN_TRAILING_DAYS})` };
  }

  let mn = Infinity, mx = -Infinity;
  for (const t of trailing) {
    if (t.close < mn) mn = t.close;
    if (t.close > mx) mx = t.close;
  }
  if (mx === mn) {
    return { available: false, position: null, low: mn, high: mx, close: d.close, evalDate: iso(d.date), trailingDays: trailing.length, reason: "degenerate 52w range (high == low)" };
  }

  return {
    available: true,
    position: (d.close - mn) / (mx - mn),
    low: mn,
    high: mx,
    close: d.close,
    evalDate: iso(d.date),
    trailingDays: trailing.length,
    reason: null,
  };
}
