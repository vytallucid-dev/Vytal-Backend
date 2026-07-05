// ─────────────────────────────────────────────────────────────
// PRICES detection-guard predicates (pure, no I/O).
//
// The 5 guard families' threshold logic, extracted so BOTH the live
// wiring (nse-bhavcopy.ts / ingest-prices.ts) and the dry-run harness
// call the SAME code — the dry-run can't drift from production.
//
// Thresholds are HARDCODED + grounded from real prices data. Each
// predicate returns a violation descriptor (or null / [] when clean);
// the CALLER decides whether to reportIngestionError. Pure functions →
// trivially testable + reusable as the template for the next crons.
// ─────────────────────────────────────────────────────────────

export const PRICES_CRON = "daily_eod_prices";

// ── GUARD 1: SHAPE ──
// EXACT columns parseBhavcopy reads. A rename (CLOSE_PRICE→CLOSING_PRICE)
// passes a loose substring check but NaNs every close → looks like a
// holiday. Specific-column assertion catches the rename-as-holiday.
export const REQUIRED_BHAV_COLUMNS = [
  "SYMBOL",
  "SERIES",
  "OPEN_PRICE",
  "HIGH_PRICE",
  "LOW_PRICE",
  "CLOSE_PRICE",
  "TTL_TRD_QNTY",
  "PREV_CLOSE",
] as const;

// ── GUARD 2: SKIP-RATE ──  close/open/high/low are non-nullable; the
// parser DROPS NaN/≤0 rows before insert, so a DB null-rate on them can
// never fire. The real silent-loss signal is the parse skip rate.
export const MAX_PARSE_SKIP_RATE = 0.05; // > 5% of EQ rows → high

// ── GUARD 3: COUNT ──  DERIVED from the live active universe, so it self-
// scales as the universe grows (202 → 505 → …) instead of staling to a
// hardcoded row band. Bands are FRACTIONS of the active-stock count passed
// in at call time:
//   observed < FLOOR_FRAC·expected  → high   (truncated / missing ingests)
//   observed < LOW_FRAC·expected    → medium (short of coverage — investigate)
//   observed > CEIL_FRAC·expected   → high   (meaningfully exceeds → duplication)
//   else                            → healthy
// FLOOR/LOW leave downward tolerance for legit same-day shortfalls (a stock
// with no price — new listing, halt, suspension). CEIL keeps a sane
// duplication ceiling just above full coverage.
export const COUNT_FLOOR_FRAC = 0.75; // < 75% of universe → high (grounded on old 150/202)
export const COUNT_LOW_FRAC = 0.9; // [75%, 90%) of universe → medium (old 180/202)
export const COUNT_CEIL_FRAC = 1.1; // > 110% of universe → high · duplication (old 250/202 ≈ 1.24, tightened)

// ── GUARD 4: NULL-RATE ──  genuinely-nullable fields only.
export const PREV_CLOSE_NULL_MAX = 0.1; // normal ~1–3% (IPO days)
export const TRADED_VALUE_NULL_MAX = 0.15; // normal ~2–5%

// ── GUARD 5: RANGE ──  per-row close bounds.
export const CLOSE_MIN = 0.01;
export const CLOSE_MAX = 200000;

// ── GUARD 6: CONTINUITY ──  suspicious move band: above circuit-breakers
// (±10/20%), below split size. NOT SPLIT_DISCONTINUITY_THRESHOLD (0.35,
// a different multi-day, marketCap-gating assertion). Splits > 0.50 are
// the split-gate's job.
export const CONTINUITY_MIN = 0.2;
export const CONTINUITY_MAX = 0.5;

/** Soft run-log ref shared with PriceFetchLog's identity. */
export const runRef = (priceDate: Date, provider: string) =>
  `${priceDate.toISOString().slice(0, 10)}:${provider}`;

// ── Predicates ───────────────────────────────────────────────

/** GUARD 1 — returns the required columns MISSING from the header ([] = ok). */
export function checkShape(headerCols: string[]): string[] {
  return REQUIRED_BHAV_COLUMNS.filter((c) => !headerCols.includes(c));
}

/** GUARD 2 — returns the skip rate if it breaches, else null. */
export function checkSkipRate(
  skippedBadValue: number,
  totalEq: number,
): number | null {
  const rate = totalEq > 0 ? skippedBadValue / totalEq : 0;
  return rate > MAX_PARSE_SKIP_RATE ? rate : null;
}

export type CountVerdict = {
  severity: "high" | "medium";
  note: string;
} | null;

/** The derived row-count band for a given live active-universe size. */
export function countBand(expected: number): {
  floor: number;
  low: number;
  ceil: number;
} {
  return {
    floor: Math.floor(expected * COUNT_FLOOR_FRAC),
    low: Math.floor(expected * COUNT_LOW_FRAC),
    ceil: Math.ceil(expected * COUNT_CEIL_FRAC),
  };
}

/**
 * GUARD 3 — classify the day's persisted row-count against the LIVE active-
 * universe size (`expected`); null = healthy. Bands scale with `expected`,
 * so the guard self-adjusts as the universe grows and still catches real
 * duplication (observed meaningfully above full coverage).
 */
export function classifyCount(observed: number, expected: number): CountVerdict {
  // Unknown/degenerate universe → can't derive a band; a real empty-universe
  // problem surfaces via other guards, so don't false-flag here.
  if (expected <= 0) return null;

  const { floor, low, ceil } = countBand(expected);
  const pct = Math.round((observed / expected) * 100);

  if (observed < floor)
    return {
      severity: "high",
      note: `below floor (${observed}/${expected}, ${pct}% of active universe)`,
    };
  if (observed < low)
    return {
      severity: "medium",
      note: `short of expected coverage (${observed}/${expected}, ${pct}%) — investigate`,
    };
  if (observed > ceil)
    return {
      severity: "high",
      note: `above expected (${observed}/${expected}, ${pct}%) — possible duplication`,
    };
  return null;
}

/** GUARD 4 — returns the null rate if it breaches `max`, else null. */
export function checkNullRate(
  nulls: number,
  n: number,
  max: number,
): number | null {
  if (n === 0) return null;
  const rate = nulls / n;
  return rate > max ? rate : null;
}

/** GUARD 5 — true if a close is outside plausible bounds. */
export function checkCloseRange(close: number): boolean {
  return close < CLOSE_MIN || close > CLOSE_MAX;
}

/** GUARD 6 — true if a day move sits in the suspicious continuity band. */
export function checkContinuity(dayChangePct: number | null): boolean {
  if (dayChangePct == null) return false;
  const abs = Math.abs(dayChangePct);
  return abs >= CONTINUITY_MIN && abs <= CONTINUITY_MAX;
}
