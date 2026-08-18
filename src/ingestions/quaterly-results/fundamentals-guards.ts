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

// ── GUARD 6: EMPTY DISCOVERY (per-symbol) ────────────────────
//
// ★ A DISCOVERY THAT RETURNS ZERO FILINGS FOR AN ACTIVE STOCK IS NOT A SUCCESS.
//
// It was logged as one. MEASURED 2026-08-17: `result_fetch_logs` holds 443 rows with
// source='nse_filings_api'; three of them carry error="0 filings discovered" and
// status="success" — ABBOTINDIA (2026-07-09), BAYERCROP (2026-07-09), MCX (2026-05-11).
// Each of those three holds ZERO rows in all ten result tables, and each was scanned
// exactly ONCE. Nothing retried, nothing alerted, and three stocks in the scored
// universe have carried no fundamentals for one to three months.
//
// ⚠ BUT ZERO IS NOT ALWAYS A FAULT, AND THAT IS THE WHOLE DIFFICULTY. The per-symbol
//   endpoint answers "what has this company filed under the integrated regime" — a
//   company that has filed nothing NEW since our last pass legitimately returns rows we
//   already hold, and a narrow enough call legitimately returns none. Making every zero
//   a fault would put a row in the triage queue for every quiet stock, every run, which
//   is the alarm-fatigue failure this codebase already ruled against (see the
//   expected-failure baseline in jobs/health/check.ts).
//
// So the classifier asks the question the log could not: DO WE HOLD ANYTHING?
//
//   never    — zero result rows, any table, ever.        FAULT, high.    3 stocks today.
//   stopped  — rows held, but the newest reporting period is older than a full filing
//              cycle plus grace.                          FAULT, medium.  0 stocks today.
//   quiet    — rows held and current. Nothing is wrong.   NOT a fault.   the other 439.
//
// THE THRESHOLD IS GROUNDED, NOT GUESSED. Reg 33 gives a listed company 45 days after a
// quarter end to file (60 for the year), so the newest period we hold should never be
// more than ~135 days stale on a healthy filer. MEASURED over the 442-stock cohort on
// 2026-08-17: 436 stocks sit at report_date 2026-06-30 (48 days), 3 at 2026-03-31
// (139 days — Q1 FY27 not yet filed), 3 hold nothing. 200 days clears the entire live
// distribution with room to spare and still fires after two consecutive missed
// quarters, which is the shortest silence that cannot be a filing-calendar artifact.
export const EMPTY_DISCOVERY_STALE_DAYS = 200;

/** What an empty discovery MEANS for a stock, given what we already hold. */
export type EmptyDiscoveryKind = "never" | "stopped" | "quiet";

/**
 * GUARD 6 — classify a zero-filing discovery. Pure; the caller supplies what it holds.
 *
 * @param rowsHeld       total result rows across every result table for this stock
 * @param newestReportMs newest report_date held (ms), or null when nothing is held
 * @param nowMs          clock, injected so the gate can pin this without a real date
 */
export function classifyEmptyDiscovery(
  rowsHeld: number,
  newestReportMs: number | null,
  nowMs: number,
): { kind: EmptyDiscoveryKind; ageDays: number | null } {
  if (rowsHeld === 0) return { kind: "never", ageDays: null };
  if (newestReportMs === null) return { kind: "never", ageDays: null };
  const ageDays = Math.floor((nowMs - newestReportMs) / 86_400_000);
  return { kind: ageDays > EMPTY_DISCOVERY_STALE_DAYS ? "stopped" : "quiet", ageDays };
}

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
