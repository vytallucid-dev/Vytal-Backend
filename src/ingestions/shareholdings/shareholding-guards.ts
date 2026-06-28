// ─────────────────────────────────────────────────────────────
// SHAREHOLDING detection-guard predicates (pure, no I/O).
//
// Same pattern as prices-guards.ts: threshold logic extracted so the
// live wiring AND the dry-run harness call the same code. Thresholds
// HARDCODED + grounded from real shareholding_patterns (2641 rows).
//
// The silent-failure surface here is the XBRL parser: context-ID lookups
// that default to 0/null on a new SEBI taxonomy vintage. Two maskers
// make it subtle — the CSV fallback hides a total XBRL break at the
// top level, and an empty filing index logs as "success". So the guards
// check the XBRL BREAKDOWN (fii/dii/pledge/shares), not the maskable
// promoter/public top-line.
// ─────────────────────────────────────────────────────────────

export const SHAREHOLDING_CRON = "shareholding_ingest";
export const SHAREHOLDING_SOURCE = "nse_shareholding_xbrl";

// ── GUARD 1: SHAPE / partition ──  promoter+public+empTrust partitions
// the register → sums to ~100 (real min 73.79). A total context break →
// sum≈0; a fraction-scale break (un-rescaled 0–1) → sum≈1. Either is < 50.
export const PARTITION_MIN = 50; // sum below this ⇒ broken parse → REJECT

// ── GUARD 2: COUNT / coverage (run-level) ──
export const COVERAGE_MIN_RATIO = 0.75; // successStocks/total below → high (PROVISIONAL — tune after observing real run-ratios)
export const ZERO_FILING_MAX_RATE = 0.1; // >10% of stocks returning 0 filings → high (index API break)

// ── GUARD 3: NULL-RATE (batch, sees through the CSV mask) ──
export const FII_DII_NULL_MAX = 0.1; // normal ~0.2%
export const BANKS_NULL_MAX = 0.15; // normal ~2.5%
export const PLEDGE_POS_MIN_RATE = 0.05; // normal 18.7% have pledge>0; collapse below 5% ⇒ pledge context broke
export const MIN_BATCH_FOR_RATE = 30; // batch rates are noise below this many new rows

// ── GUARD 4: RANGE / validity (per-record) ──
export const PCT_MIN = 0;
export const PCT_MAX = 100;

// ── GUARD 5: CONTINUITY (per-record, QoQ) ──  shareholding is sticky
// (avg |Δpromoter| 0.25pp); >10pp is rare (0.5%) and event-or-error.
export const CONTINUITY_PROMOTER_PP = 10;

/** Soft run-log ref. */
export const shareholdingRunRef = (asOnDate: Date) =>
  `xbrl:${asOnDate.toISOString().slice(0, 10)}`;

// ── Predicates ───────────────────────────────────────────────

/** GUARD 1 — true if the partition sum signals a broken parse (reject). */
export function checkPartitionBroken(
  promoterPct: number,
  publicPct: number,
  employeeTrustPct: number,
): boolean {
  return promoterPct + publicPct + employeeTrustPct < PARTITION_MIN;
}

export type CoverageVerdict = { severity: "high"; note: string } | null;

/** GUARD 2a — successStocks/total below floor. */
export function classifyCoverage(
  successStocks: number,
  totalStocks: number,
): CoverageVerdict {
  if (totalStocks === 0) return null;
  const ratio = successStocks / totalStocks;
  if (ratio < COVERAGE_MIN_RATIO)
    return {
      severity: "high",
      note: `${successStocks}/${totalStocks} stocks succeeded (<${(COVERAGE_MIN_RATIO * 100).toFixed(0)}%)`,
    };
  return null;
}

/** GUARD 2b — share of stocks that returned an EMPTY filing index. */
export function checkZeroFilingRate(
  zeroFilingStocks: number,
  totalStocks: number,
): number | null {
  if (totalStocks === 0) return null;
  const rate = zeroFilingStocks / totalStocks;
  return rate > ZERO_FILING_MAX_RATE ? rate : null;
}

/** GUARD 3 — null rate over a batch if it breaches `max` (null below MIN_BATCH). */
export function checkBatchNullRate(
  nulls: number,
  n: number,
  max: number,
): number | null {
  if (n < MIN_BATCH_FOR_RATE) return null;
  const rate = nulls / n;
  return rate > max ? rate : null;
}

/** GUARD 3 (pledge) — pledge-present rate collapsing toward 0 ⇒ pledge context broke. */
export function checkPledgeCollapse(
  pledgePresent: number,
  n: number,
): number | null {
  if (n < MIN_BATCH_FOR_RATE) return null;
  const rate = pledgePresent / n;
  return rate < PLEDGE_POS_MIN_RATE ? rate : null;
}

/** GUARD 4 — a single percentage outside [0,100]. */
export function checkPctRange(v: number | null): boolean {
  return v != null && (v < PCT_MIN || v > PCT_MAX);
}

/** GUARD 4 — share-count invariants. Returns the list of violated invariants. */
export function checkShareInvariants(shares: {
  totalShares: number | null;
  promoterShares: number | null;
  pledgedShares: number | null;
}): string[] {
  const out: string[] = [];
  const { totalShares, promoterShares, pledgedShares } = shares;
  if (totalShares != null && totalShares <= 0) out.push("totalShares<=0");
  if (totalShares != null && promoterShares != null && promoterShares > totalShares)
    out.push("promoterShares>totalShares");
  if (promoterShares != null && pledgedShares != null && pledgedShares > promoterShares)
    out.push("pledgedShares>promoterShares");
  return out;
}

/** GUARD 5 — QoQ promoter move beyond the noise band. Returns |Δpp| or null. */
export function checkPromoterContinuity(
  current: number,
  prior: number | null,
): number | null {
  if (prior == null) return null;
  const delta = Math.abs(current - prior);
  return delta > CONTINUITY_PROMOTER_PP ? delta : null;
}
