// ─────────────────────────────────────────────────────────────
// BLOCK-DEALS detection guard (pure, no I/O).
//
// The THINNEST cron — a single guard. SHAPE only. Everything else is N/A:
//   - NULL-RATE/RANGE: the parser pre-validates (transformDeal* drops rows
//     with missing/≤0 fields), so stored data is always clean.
//   - CATEGORIZATION: transactionType is binary (no "other" bucket); the
//     buy/sell ratio is too thin (7 deal-days) to guard. NOTE the latent
//     risk: the mapper is `BD_BUY_SELL === "BUY" ? "buy" : "sell"`, so a
//     label rename (e.g. "BUY"→"Buy") would mis-map all to "sell" — revisit
//     if block-deal volume ever grows enough for a buy/sell-ratio guard.
//   - COUNT: the all-market totalFetched baseline is reliably 105–209, but a
//     market HOLIDAY returns empty-with-no-market-closed-gate → a count guard
//     would false-flag holidays. SHAPE sidesteps it (holiday-immune).
//   - CONTINUITY: discrete deals, no time series.
//
// SHAPE = the key-rename-as-silent-empty trap: deals.ts reads
// `data.BULK_DEALS_DATA ?? []` etc., so a renamed key yields `[]` silently
// (a fake quiet day). Assert the keys the parser reads are arrays. An
// empty-but-present array is a legit quiet/holiday day → NOT flagged.
//
// Detection-only: the deals ingest triggers no rescore (Ownership D reads
// block_deals at scoring time).
// ─────────────────────────────────────────────────────────────

export const DEALS_CRON = "block_deals";
export const DEALS_SOURCE = "nse";

// Keys the daily snapshot parser actually reads (SHORT_DEALS_DATA is ignored).
export const REQUIRED_DAILY_KEYS = ["BULK_DEALS_DATA", "BLOCK_DEALS_DATA"] as const;

export const dealsRunRef = (fetchDate: Date, fetchType: string) =>
  `${fetchDate.toISOString().slice(0, 10)}:${fetchType}`;

// ── Predicates ───────────────────────────────────────────────

/**
 * Daily snapshot SHAPE — returns the required keys that are MISSING or
 * non-array ([] = healthy; empty-but-present arrays are a legit quiet day).
 */
export function checkDailyShape(data: unknown): string[] {
  if (data == null || typeof data !== "object") return [...REQUIRED_DAILY_KEYS];
  const d = data as Record<string, unknown>;
  return REQUIRED_DAILY_KEYS.filter((k) => !Array.isArray(d[k]));
}

/** Historical endpoint SHAPE — true if `data.data` is not an array (malformed). */
export function checkHistoricalShapeMalformed(data: unknown): boolean {
  if (data == null || typeof data !== "object") return true;
  return !Array.isArray((data as { data?: unknown }).data);
}
