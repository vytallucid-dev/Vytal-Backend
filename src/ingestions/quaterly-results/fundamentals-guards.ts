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
//
// ⚠ A ZERO-FILLED P&L REACHES THE SAME PLACE BY A DIFFERENT ROAD. A filer reporting only the full
//   year still ships the quarterly column with 0.00 on every line, which is not null and so slips
//   past this guard entirely. zero-block-guard.ts RULE 4 catches it at parse time and writes NULL,
//   at which point it arrives here and is rejected exactly as a tag rename would be. The two are
//   the same failure — a document with no content for this period — and they now share one exit.

// ── GUARD 2: COUNT / coverage (run-level, PROVISIONAL) ──
export const FAILED_RATE_MAX = 0.25; // failures are rare (10/6300) — judgment, tune after a real results season
export const MIN_RUN_FOR_FAILRATE = 20; // don't flag a single-symbol scan

// ── GUARD 3: NULL-RATE (batch — the workhorse for tag-rename cascades) ──
export const CORE_NULL_MAX = 0.05; // revenue/netProfit normal 0%
export const BS_NULL_MAX = 0.5; // totalAssets/totalEquity normal 24.4% (a QUARTER legitimately lack BS) → only a spike past 50% is a break
export const MIN_BATCH_FOR_RATE = 30; // batch rates are noise below this

// ── GUARD 4: RANGE / scale + validity (per-record) ──
export const SCALE_CEIL_CR = 10_000_000; // ₹1e7 Cr. Real max ~2.18M Cr; a ÷1e7 unit break lands at ≥1e9 → caught
export const BS_IMBALANCE_MAX = 0.05; // |assets−(equity+liabilities)|/assets > 5% (0.5% historical)

// ── GUARD 5: CONTINUITY (per-record, YoY) ──  revenue YoY is sticky-ish
// (max real 238%); >300% ⇒ a per-period scale break or anomaly. NOT
// profit YoY — turnarounds legitimately hit 6779%.
export const REVENUE_YOY_MAX_PCT = 300;

// ── GUARD 5's MATERIALITY FLOOR — the base the percentage was computed FROM. ──
//
// ★ A PERCENTAGE OFF A TINY BASE IS ARITHMETIC, NOT EVIDENCE. This guard shipped with no floor,
//   grounded on 500 large caps where "max real 238%" was true. The universe is now 2,291 names,
//   most of them small, and a company whose quarter went from ₹0.03 Cr to ₹8.46 Cr has not had a
//   28,000% anomaly — it has had a normal quarter for a company that size. 188 rows were sitting
//   in the triage queue saying otherwise, on a guard whose own detail line asks a human to eyeball
//   every one.
//
// ★ THE FLOOR IS MEASURED, NOT PICKED. Over all 13,088 quarterly YoY pairs with a positive base,
//   the share of rows breaching 300% falls monotonically with the base and has a clear knee:
//         base ₹0–1 Cr   22.29%      base ₹10–25 Cr   3.37%
//         base ₹1–5 Cr   12.06%      base ₹50–100     1.68%
//         base ₹5–10 Cr   8.14%      base ₹500+       0.18%
//   Below ₹10 Cr the guard fires on one row in eight to one in five — that is not a detector. At
//   ₹10 Cr and above it fires on one in thirty and keeps falling. The 5,524 ANNUAL pairs have the
//   same shape (10.9–26.7% below ₹10 Cr, 3.75% at ₹10–25 Cr, 0.09% above ₹500 Cr), so one floor
//   serves both.
//
// ★ AND IT DOES NOT SILENCE THE REAL FAULTS, which is the test that matters. Every scale break the
//   guard has actually caught sits ABOVE the floor and stays flagged: SRF Q4 FY24 (base ₹37.78 Cr
//   against a true ₹3,778 Cr — a 100× filer mis-scale), DLF Q1 FY21 (₹13.31), ADANIGREEN Q3 FY20
//   (₹21.29), UBL Q4 FY23 (₹36.62), PAYTM Q3 FY24 (₹206.22 — a 10× mis-scale). It removes 91 of
//   172 breaches and keeps all of those.
export const YOY_BASE_MIN_CR = 10;

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
//   not_due  — LISTED TOO RECENTLY TO HAVE FILED ANYTHING YET.  NOT a fault.
//
// ★ THE FOURTH ANSWER WAS MISSING, AND IT WAS 13 OF THE 13 REMAINING FAULTS. `never` reads "zero
//   result rows, ever" as evidence of a break, and for an established company it is. For a company
//   that started trading LAST WEEK it is a statement about the calendar. MEASURED on the 13 stocks
//   still carrying this fault: every one has its first daily price between 4 and 15 days ago —
//   SHIPROCKET, MILKYMIST, MOLBIO, LALITHAA and LEAPIND are 2026 IPOs, TECHNOCRAF and HORIZONIND
//   are demergers. Not one has had a filing deadline pass. They were being reported as high-severity
//   faults for not having filed results they cannot yet have filed, and no amount of re-probing
//   would ever have cleared them — the fault could only heal by the passage of time.
//
//   THE THRESHOLD IS THE ONE ALREADY DERIVED IN THIS FILE. Reg 33 gives 45 days after a quarter
//   end to file, so the earliest a newly-listed company can owe us anything is the end of the first
//   quarter that closes after it lists, plus that 45 days — at most 92 + 45 = 137 days, and the
//   comment below already uses ~135 for exactly this arithmetic. Past it, silence is a real fault
//   and `never` applies again; this only declines to call a company late before it is due.
//
// THE THRESHOLD IS GROUNDED, NOT GUESSED. Reg 33 gives a listed company 45 days after a
// quarter end to file (60 for the year), so the newest period we hold should never be
// more than ~135 days stale on a healthy filer. MEASURED over the 442-stock cohort on
// 2026-08-17: 436 stocks sit at report_date 2026-06-30 (48 days), 3 at 2026-03-31
// (139 days — Q1 FY27 not yet filed), 3 hold nothing. 200 days clears the entire live
// distribution with room to spare and still fires after two consecutive missed
// quarters, which is the shortest silence that cannot be a filing-calendar artifact.
export const EMPTY_DISCOVERY_STALE_DAYS = 200;

/**
 * A NEWLY-LISTED COMPANY CANNOT BE LATE. One full quarter (92 days) plus Reg 33's 45-day filing
 * window: until this much time has passed since a stock's first trading day, zero filings is the
 * expected state, not a missing one.
 */
export const LISTING_GRACE_DAYS = 137;

/** What an empty discovery MEANS for a stock, given what we already hold. */
export type EmptyDiscoveryKind = "never" | "stopped" | "quiet" | "not_due";

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
  /** First day we have any market data for this stock — the listing proxy. Null when unknown, and
   *  an unknown listing date is NEVER treated as recent: silence is not evidence of youth. */
  firstSeenMs?: number | null,
): { kind: EmptyDiscoveryKind; ageDays: number | null; listedDays?: number | null } {
  const listedDays =
    firstSeenMs == null ? null : Math.floor((nowMs - firstSeenMs) / 86_400_000);

  if (rowsHeld === 0 || newestReportMs === null) {
    // Nothing held — but a company that listed last week owes us nothing yet.
    if (listedDays !== null && listedDays < LISTING_GRACE_DAYS) {
      return { kind: "not_due", ageDays: null, listedDays };
    }
    return { kind: "never", ageDays: null, listedDays };
  }
  const ageDays = Math.floor((nowMs - newestReportMs) / 86_400_000);
  return { kind: ageDays > EMPTY_DISCOVERY_STALE_DAYS ? "stopped" : "quiet", ageDays, listedDays };
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

/**
 * GUARD 4 — A ZEROED P&L BLOCK: every line present reads exactly 0.
 *
 * ⚠ THIS REPLACES `revenue <= 0`, AND THAT PREDICATE WAS WRONG ABOUT THE WORLD. It was grounded
 *   when this database held 500 large caps and measured "0 historical" — true of that cohort, and
 *   false the moment the universe went to 2,291 names. MEASURED on the open queue: 257 quarterly
 *   rows and 66 annual rows flagged, of which
 *     · 225 are a company that genuinely earned nothing FROM OPERATIONS and says so with a real
 *       P&L beside it — RPOWER standalone (₹0 revenue, ₹7.41 Cr profit: a holding company living
 *       on other income), DCMFINSERV, OLAELEC standalone, and every dormant shell on the exchange;
 *     · 20 are NEGATIVE and arithmetically PROVEN correct — revenue + other income − expenses
 *       reproduces the filed PBT to the paisa on HINDOILEXP, 21STCENMGM, DHRUV, WEALTH and LASA.
 *       A Q4 derived as (full year − 9M) goes negative when the year is revised down. That is what
 *       was filed.
 *   Not one of those 245 is a fault, and every one of them was pointed at an admin_fill button
 *   asking a human to type in a number that was already right.
 *
 * ★ WHAT IS A FAULT IS THE CONJUNCTION, and it is the ruling zero-block-guard.ts already made for
 *   banks: not "revenue is zero" but "EVERY LINE is zero" — no revenue, no other income, NO
 *   EXPENSES, no tax, no profit. A dormant company still pays its auditor. A P&L with nothing in
 *   it anywhere is a column the filer did not fill, and it belongs in the queue as a shape break
 *   (severity critical, source_code), not as a value an admin can source.
 *
 * The parser now refuses this block at parse time and writes NULL (zero-block-guard.ts RULE 4),
 * so a fresh row can no longer land in this state. This predicate is the second line of defence,
 * for rows that arrive by other routes (the BSE writer) and for anything already stored.
 */
export function checkZeroedPnlBlock(pnl: {
  revenue: number | null;
  otherIncome?: number | null;
  expenses?: number | null;
  profitBeforeTax?: number | null;
  netProfit: number | null;
}): boolean {
  const lines = [pnl.revenue, pnl.otherIncome, pnl.expenses, pnl.profitBeforeTax, pnl.netProfit]
    .filter((v): v is number => v != null);
  // Fewer than three lines present is GUARD 1's business (a thin/contentless parse), not this one's.
  return lines.length >= 3 && lines.every((v) => v === 0);
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
  /** The filing's OWN `Liabilities` subtotal. Preferred over the two-part reconstruction. */
  totalLiabilities?: number | null;
}): number | null {
  const { totalAssets, totalEquity, currentLiabilities, noncurrentLiabilities, totalLiabilities } = bs;
  if (totalAssets == null || totalEquity == null || totalAssets <= 0) return null;

  // ★ THE FILING'S OWN TOTAL WINS, AND ALL 48 FAULTS WERE THE RECONSTRUCTION'S.
  //   Ind-AS says Assets = Equity + Liabilities. `Liabilities` is a subtotal the filer TAGS; the
  //   two-part sum below is our reconstruction of it, and it is short by every bucket that is
  //   neither current nor non-current. A company with a disposal group tags a third —
  //   LiabilitiesDirectlyAssociatedWithAssetsInDisposalGroupClassifiedAsHeldForSale — and RAYMOND
  //   FY25's ₹1,350.41 Cr "28.4% imbalance" IS that bucket, to the paisa. UPL FY24's ₹3,665.00 Cr
  //   likewise. MEASURED against every filing behind the 48 open faults: 48 of 48 close on the
  //   filing's own total, and NOT ONE of those balance sheets was ever out of balance.
  const liabilities =
    totalLiabilities ??
    (currentLiabilities != null && noncurrentLiabilities != null
      ? currentLiabilities + noncurrentLiabilities
      : null);
  if (liabilities == null) return null; // not checkable — NOT a violation

  const rel = Math.abs(totalAssets - (totalEquity + liabilities)) / totalAssets;
  return rel > BS_IMBALANCE_MAX ? rel : null;
}

/**
 * GUARD 5 — revenue YoY beyond the sticky band (max real 238%), AND computed off a base big
 * enough for the percentage to mean anything.
 *
 * `baseCr` is the PRIOR-PERIOD line item the growth was measured from. Pass it always: omitting it
 * (or passing null, which a genuinely-absent prior row does) falls back to the un-floored
 * behaviour, because "we do not know the base" is not the same claim as "the base was small", and
 * a guard must not go quiet on a case it cannot see. See YOY_BASE_MIN_CR for the measurements.
 */
export function checkRevenueYoyAnomaly(
  yoyPct: number | null,
  baseCr?: number | null,
): boolean {
  if (yoyPct == null || Math.abs(yoyPct) <= REVENUE_YOY_MAX_PCT) return false;
  if (baseCr != null && Math.abs(baseCr) < YOY_BASE_MIN_CR) return false;
  return true;
}
