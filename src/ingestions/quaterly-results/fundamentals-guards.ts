// ─────────────────────────────────────────────────────────────
// FUNDAMENTALS (Ind-AS non-financial) detection-guard predicates.
//
// Same pattern as prices-/shareholding-guards: pure threshold logic the
// live wiring AND the dry-run share. Thresholds HARDCODED + grounded from
// real fundamentals/quarterly_results (1326 + 4802 rows).
//
// SCOPE: the non-financial Ind-AS path only. Banking/NBFC/LI/GI have
// different tables, fields and invariants (GNPA/CET1/NIM, CASA [15,60],
// Tier-1 [5,25]) and get their own grounding + wiring later.
//
// The silent-failure surface is the regex tag-name extractor: a renamed/
// missing XBRL tag → null (no fallback on core fields), and the ÷1e7
// INR→₹Cr scaling means a field mis-tagged `pure` lands 10,000,000× too
// big. Guards watch the RAW line items; derived ratios are NOT guarded
// (roe→409, netMargin→±1266 are legitimately wild — they inherit trust
// from the guarded raws).
// ─────────────────────────────────────────────────────────────

export const RESULTS_CRON = "results_ingest";
export const RESULTS_SOURCE = "nse_xbrl";

// ── GUARD 1: SHAPE / P&L content ──  revenue & netProfit are NEVER null
// historically (0%); both-null ⇒ the P&L tags didn't resolve (rename) →
// a contentless parse → REJECT (don't store / overwrite a good row).
// (Either-null is caught by the batch NULL-RATE, not rejected.)

// ── GUARD 2: COUNT / coverage (run-level, PROVISIONAL) ──
export const FAILED_RATE_MAX = 0.25; // failures are rare (10/6300) — judgment, tune after a real results season
export const MIN_RUN_FOR_FAILRATE = 20; // don't flag a single-symbol scan

// ── GUARD 3: NULL-RATE (batch — the workhorse for tag-rename cascades) ──
export const CORE_NULL_MAX = 0.05; // revenue/netProfit normal 0%
export const BS_NULL_MAX = 0.5; // totalAssets/totalEquity normal 24.4% (a QUARTER legitimately lack BS) → only a spike past 50% is a break
export const MIN_BATCH_FOR_RATE = 30; // batch rates are noise below this

// ── GUARD 4: RANGE / scale + validity (per-record) ──
export const SCALE_CEIL_CR = 10_000_000; // ₹1e7 Cr. Real max ~2.18M Cr; a ÷1e7 unit break lands at ≥1e9 → caught
export const BS_IMBALANCE_MAX = 0.05; // |assets−(equity+curLiab+noncurLiab)|/assets > 5% (0.5% historical)

// ── GUARD 5: CONTINUITY (per-record, YoY) ──  revenue YoY is sticky-ish
// (max real 238%); >300% ⇒ a per-period scale break or anomaly. NOT
// profit YoY — turnarounds legitimately hit 6779%.
export const REVENUE_YOY_MAX_PCT = 300;

export const resultsRunRef = (label: string) => `results:${label}`;

// ── Predicates ───────────────────────────────────────────────

/** GUARD 1 — both core P&L lines absent ⇒ contentless parse (reject). */
export function checkPlContentless(
  revenue: number | null,
  netProfit: number | null,
): boolean {
  return revenue == null && netProfit == null;
}

export type FailedRateVerdict = { severity: "high"; note: string } | null;

/** GUARD 2 — run-level failure-rate spike. */
export function classifyFailedRate(
  failed: number,
  attempted: number,
): FailedRateVerdict {
  if (attempted < MIN_RUN_FOR_FAILRATE) return null;
  const rate = failed / attempted;
  return rate > FAILED_RATE_MAX
    ? { severity: "high", note: `${failed}/${attempted} attempts failed (${(rate * 100).toFixed(0)}%)` }
    : null;
}

/** GUARD 3 — batch null rate if it breaches `max` (skips small batches). */
export function checkBatchNullRate(
  nulls: number,
  n: number,
  max: number,
): number | null {
  if (n < MIN_BATCH_FOR_RATE) return null;
  const rate = nulls / n;
  return rate > max ? rate : null;
}

/** GUARD 4 — a ₹Cr line item beyond the scale ceiling (the ÷1e7 unit break). */
export function checkScale(v: number | null): boolean {
  return v != null && Math.abs(v) > SCALE_CEIL_CR;
}

/** GUARD 4 — a PRESENT revenue that is non-positive (0 historical). */
export function checkRevenueNonPositive(revenue: number | null): boolean {
  return revenue != null && revenue <= 0;
}

/**
 * GUARD 4 — balance-sheet identity. CONDITIONAL: returns the relative
 * imbalance ONLY when assets + all three components are present and
 * assets>0. A NULL balance sheet is NORMAL (24.4% of rows lack BS) and is
 * never flagged here — get this wrong and a quarter of rows false-flag.
 */
export function checkBsImbalance(bs: {
  totalAssets: number | null;
  totalEquity: number | null;
  currentLiabilities: number | null;
  noncurrentLiabilities: number | null;
}): number | null {
  const { totalAssets, totalEquity, currentLiabilities, noncurrentLiabilities } = bs;
  if (
    totalAssets == null ||
    totalEquity == null ||
    currentLiabilities == null ||
    noncurrentLiabilities == null ||
    totalAssets <= 0
  )
    return null; // not checkable — NOT a violation
  const lae = totalEquity + currentLiabilities + noncurrentLiabilities;
  const rel = Math.abs(totalAssets - lae) / totalAssets;
  return rel > BS_IMBALANCE_MAX ? rel : null;
}

/** GUARD 5 — revenue YoY beyond the sticky band (max real 238%). */
export function checkRevenueYoyAnomaly(yoyPct: number | null): boolean {
  return yoyPct != null && Math.abs(yoyPct) > REVENUE_YOY_MAX_PCT;
}
