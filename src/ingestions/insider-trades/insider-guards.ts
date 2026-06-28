// ─────────────────────────────────────────────────────────────
// INSIDER-TRADES detection-guard predicates (pure, no I/O).
//
// Structurally different from the file crons: an NSE API feed with
// legitimately BURSTY volume (1–157/day, median 8, p10=1) — so there is NO
// single-day count guard. The feed-down signal is the trailing-window-zero
// (3 consecutive daily no_data), which already exists as checkNoDataStreak;
// the detection layer just REPORTS it.
//
// Thresholds HARDCODED + grounded from real insider_trades (3040 rows /
// 66 stocks) + insider_trade_fetch_logs. Detection-only: the insider ingest
// triggers no rescore (Ownership C/D read insider_trades at scoring time).
// ─────────────────────────────────────────────────────────────

export const INSIDER_CRON = "insider_pit";
export const INSIDER_SOURCE = "nse_pit";

// ── CATEGORIZATION (batch ≥ 30) ──
// PRIMARY: transactionType "other" — protects the buy/sell DIRECTIONAL
// signal Ownership C depends on; baseline 0.1% → tight threshold.
export const TXN_OTHER_MAX = 0.1;
// SECONDARY: personCategory "other" — gross categorizer break; baseline
// 48.1% (incl. legit Reg-7(3) "Connected Person") → threshold well above.
export const CAT_OTHER_MAX = 0.65;
export const MIN_BATCH_FOR_RATE = 30; // daily in-universe batch ~12 is too small for a rate

// ── NULL-RATE (batch) ──  always-present fields vs the ~1.3% value field.
export const CORE_NULL_MAX = 0.05; // securitiesTraded/tradeDate/holdingPctPost normal 0%
export const VALUE_NULL_MAX = 0.1; // tradeValueCr normal 1.3%

export const insiderRunRef = (fetchDate: Date, fetchType: string) =>
  `${fetchDate.toISOString().slice(0, 10)}:${fetchType}`;

// ── Predicates ───────────────────────────────────────────────

/**
 * SHAPE — the gg feed returned a response whose `data` is NOT an array (the
 * empty-array trap: {data:{}} / {data:null} / {error:…}). A `data:[]` array
 * is NOT malformed — that's a legit quiet day (the streak guard handles
 * persistent emptiness).
 */
export function isFeedMalformed(response: unknown): boolean {
  return (
    response != null &&
    typeof response === "object" &&
    !Array.isArray((response as { data?: unknown }).data)
  );
}

/** Batch rate if it breaches `max` (skips small batches), else null. */
export function checkBatchRate(
  count: number,
  n: number,
  max: number,
): number | null {
  if (n < MIN_BATCH_FOR_RATE) return null;
  const rate = count / n;
  return rate > max ? rate : null;
}

/** Per-record validity — an intimation date in the future (a date-parse quirk). */
export function checkFutureDate(d: Date, now: Date): boolean {
  return d.getTime() > now.getTime();
}
