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
//
// ★ DATE1 IS LOAD-BEARING AND MUST BE ASSERTED. It is the file's own
//   declaration of which session it holds, and GUARD 6 rejects the file when
//   it disagrees with the date we requested. If DATE1 were absent GUARD 6
//   would have nothing to compare and would silently degrade to "accept" —
//   so its absence has to fail here, LOUDLY, as a shape break.
export const REQUIRED_BHAV_COLUMNS = [
  "SYMBOL",
  "SERIES",
  "DATE1",
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

/**
 * ★ THE BAND SAYS "ABOVE CIRCUIT-BREAKERS" AND THEN INCLUDED ONE. `>=` 0.20 catches a move of
 *   EXACTLY 20%, which is not a suspicious move — it is the single most common LEGITIMATE large
 *   move on an Indian exchange, a stock closing at its upper circuit limit.
 *
 * MEASURED, and the measurement is unanimous: every DailyPrice continuity fault this guard has ever
 * raised — 5 of 5 — is exactly ±20.0000% with the close sitting AT the day's high.
 *     NIRAJISPAT  2026-08-31  O=H=L=C=355.08 on prev 295.90   ← locked upper circuit all session
 *     SRIKPRIND   2026-09-02  C=30.42 = high, prev 25.35      ← and 19.97% the day before
 *     CYBERMEDIA  2026-09-03  C=23.88 = high, prev 19.90
 *     XTRANET     2026-09-04  C=234.24 = high, prev 195.20
 *     NEXTMEDIA   2026-08-28  C=4.62 = high, prev 3.85        ← already triaged shut by hand
 * Not one true positive, one false alarm per circuit-hitting day, forever, and a human already
 * spent a triage on the fifth.
 *
 * ⚠ THE GUARD KEEPS ITS TEETH. Only a move landing ON a band edge is excused, within a tolerance
 *   narrow enough that 20.5% still fires. A mis-scaled or mis-mapped price does not arrive at
 *   1.2000 exactly — it arrives at 2×, 10×, 100×, or something arbitrary. Landing precisely on a
 *   regulated limit is itself the evidence that the exchange, not the parser, produced the number.
 */
export const CIRCUIT_BANDS = [0.02, 0.05, 0.1, 0.2] as const;
/** Half a basis point — absorbs float noise (234.24/195.2-1 is 0.20000000000000018) and nothing else. */
export const CIRCUIT_BAND_EPS = 0.00005;

/** True if a move lands on a regulated circuit-band edge — the exchange's limit, not a data break. */
export function isCircuitLimitMove(absPct: number): boolean {
  return CIRCUIT_BANDS.some((b) => Math.abs(absPct - b) <= CIRCUIT_BAND_EPS);
}

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

/** GUARD 6 — true if a day move sits in the suspicious continuity band.
 *  A move that lands on a circuit-band edge is the exchange's own limit and is NOT suspicious —
 *  see CIRCUIT_BANDS for the measurement that made this exclusion necessary. */
export function checkContinuity(dayChangePct: number | null): boolean {
  if (dayChangePct == null) return false;
  const abs = Math.abs(dayChangePct);
  if (isCircuitLimitMove(abs)) return false;
  return abs >= CONTINUITY_MIN && abs <= CONTINUITY_MAX;
}
