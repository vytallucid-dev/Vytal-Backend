// ─────────────────────────────────────────────────────────────
// INDEX-PRICES detection-guard predicates (pure, no I/O).
//
// The closest cron to the equity-prices template — same daily NSE CSV,
// same transport, same market_closed/self-heal. Four high-value families
// (SHAPE, SKIP-RATE, COUNT, NULL-RATE). RANGE/CONTINUITY are skipped:
// display-only, the 12,000× cross-index close spread gives no useful band,
// and change_pct is NSE-computed (catches an NSE anomaly, not OUR break).
//
// Thresholds HARDCODED + grounded from real index_prices (35,771 rows /
// 160 indices / 248 days) + index_fetch_logs.
// ─────────────────────────────────────────────────────────────

export const INDEX_CRON = "index_eod_prices";
export const INDEX_SOURCE = "nse-index-csv";

// ── GUARD 1: SHAPE ──  the EXACT columns parseIndexBhavcopy reads (the
// file's "Index Date" is ignored — canonical fetch date is used — so it's
// not asserted). The current code only substring-checks Index Name +
// Closing Index Value, so a rename of any OTHER column silently nulls it.
export const REQUIRED_INDEX_COLUMNS = [
  "Index Name",
  "Open Index Value",
  "High Index Value",
  "Low Index Value",
  "Closing Index Value",
  "Points Change",
  "Change(%)",
  "Volume",
  "Turnover (Rs. Cr.)",
  "P/E",
  "P/B",
  "Div Yield",
] as const;

// ── GUARD 2: SKIP-RATE ──  rows dropped for no-valid-close. Normal ~0%.
// A spike = a value-parse break — and if it drops EVERY row it would
// masquerade as a market holiday (values=0), so this also distinguishes a
// fake holiday from a real 404 (real 404 returns before parse: skipped=0).
export const MAX_SKIP_RATE = 0.05;

// ── GUARD 3: COUNT ──  indices ingested. Normal 135–160 and GROWING (NSE
// adds indices), so a floor only — no ceiling (upsert dedups anyway).
export const COUNT_FLOOR = 120;

// ── GUARD 4: NULL-RATE ──  guard the always-present tight; threshold the
// legitimately-sparse above its baseline (G-Sec/rate/bond indices publish
// close-only and carry no valuation/turnover/volume).
export const CHANGEPCT_NULL_MAX = 0.05; // normal 0.7%
export const OHL_NULL_MAX = 0.25; // open/high/low normal 10.2%
export const VALUATION_NULL_MAX = 0.3; // pe/pb/divYield/turnover/volume normal 15–16%
export const MIN_BATCH_FOR_RATE = 30; // index always ~144; guard against a severe-partial denominator

export const indexRunRef = (date: Date) =>
  `${date.toISOString().slice(0, 10)}:${INDEX_SOURCE}`;

// ── Predicates ───────────────────────────────────────────────

/** GUARD 1 — required columns MISSING from the header ([] = ok). */
export function checkShape(headerCols: string[]): string[] {
  return REQUIRED_INDEX_COLUMNS.filter((c) => !headerCols.includes(c));
}

/** GUARD 2 — skip rate over the fetched rows if it breaches, else null. */
export function checkSkipRate(skipped: number, total: number): number | null {
  if (total <= 0) return null;
  const rate = skipped / total;
  return rate > MAX_SKIP_RATE ? rate : null;
}

export type CountVerdict = { severity: "high"; note: string } | null;

/** GUARD 3 — indices ingested below the floor (normal 135–160). */
export function classifyCount(inserted: number): CountVerdict {
  return inserted < COUNT_FLOOR
    ? { severity: "high", note: `${inserted} indices (<${COUNT_FLOOR}; normal 135–160)` }
    : null;
}

/** GUARD 4 — batch null rate if it breaches `max` (skips small batches). */
export function checkNullRate(
  nulls: number,
  n: number,
  max: number,
): number | null {
  if (n < MIN_BATCH_FOR_RATE) return null;
  const rate = nulls / n;
  return rate > max ? rate : null;
}
