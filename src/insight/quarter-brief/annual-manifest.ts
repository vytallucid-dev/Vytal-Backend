// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ANNUAL MANIFEST — what each family's FULL YEAR contains, and how each figure must be read.
//
// ── ★ WHY THIS FILE EXISTS: IT IS THE ONLY ROUTE TO A BALANCE-SHEET FACT ─────────────────────────
// Every quarterly table in this product is a P&L. Debt, equity, assets, cash flow, per-share figures
// and a lender's net interest margin and credit cost are filed ONCE A YEAR, and fact-block.ts's rule 1
// stated the consequence plainly: "no balance sheet". This manifest is the section that changes that,
// and it changes it on Q4 ONLY.
//
// ── ⚠⚠ Q4 ONLY, AND THE REASON IS NOT TIDINESS (4h) ─────────────────────────────────────────────
// On Q1 the newest annual row is up to twelve months older than the quarter beside it. A card headed
// "the three months ended 30 June 2026" carrying a debt figure as at 31 March 2026 invites the reader
// to treat one date as the other, and there is no wording that reliably stops that. THAT is the hazard
// the original annual ban existed to avoid, and it is real on Q1, Q2 and Q3. It is NOT real on Q4,
// where the year being reported ENDS on the quarter's own last day for 99.8% of rows — measured, 2040
// of 2045 paired non-financial rows and 100% of all four financial families. So the ban is not lifted;
// it is narrowed to the one quarter where its rationale does not apply, and the 0.2% where the two
// clocks genuinely differ get a SECOND, SEPARATELY LABELLED DATE rather than a shared one (4d).
//
// ── THE ENFORCEMENT, INHERITED UNCHANGED FROM manifest.ts ────────────────────────────────────────
// `FamilyAnnual<F>.values` is `Record<AnnualMetricKeyOf<F>, number | null>` — a RECORD, not a Partial.
// A fetcher that omits a manifest metric does not compile. And `key: AnnualMetricKey` is keyof the
// annual gloss catalogue, so a metric with no authored gloss is a compile error too.
//
// ── ★ AND THREE THINGS THIS MANIFEST HAS THAT THE QUARTERLY ONE DOES NOT ─────────────────────────
//
// 1 · TWO MORE SCALES. `perShare` (rupees per share — earnings per share is not ₹ crore and rendering
//     it through `money` would print "₹24 crore" for a ₹23.57 figure) and `days` (receivables days is
//     neither a percentage nor a multiple).
//
// 2 · ★ A CROSS-FIELD GUARD. manifest.ts's cet1/tier1 note ends "no single-metric bound can catch this
//     — 29.99% is a perfectly plausible NUMBER and is only implausible BESIDE its own cet1." That was
//     true and there was no mechanism for it. There is one now, and the annual data needs it
//     immediately: RETURN ON EQUITY COMPUTED AGAINST A NEGATIVE NET WORTH COMES OUT POSITIVE. IDEA's
//     FY26 consolidated net worth is −₹35,758 crore against a loss; divide one negative by the other
//     and the company with the largest negative equity in the universe reports a healthy positive
//     return on shareholders' money. No bound on "is this a plausible percentage" sees it, because the
//     number is plausible. The guard reads net worth and withholds. Same for debt-to-equity, which on
//     GMRAIRPORT FY26 renders −1,701.6% off the same negative denominator.
//
// 3 · NO DRIVER ROLE AT ALL. There is no annual driver bullet and no annual bridge, deliberately.
//     Measured on FY25+FY26 consolidated rows: `PBT = revenue + other income − expenses` closes within
//     1% on 56.1% of non-financial rows and `net profit = PBT − tax` on 65.3%; the NBFC equivalents are
//     79.7% and 81.4%. The quarter's driver bullet is computed from quarterly lines that DO close, and
//     one attribution per card is the honest number. So `DriverRole` is absent from this spec type
//     rather than present and always "ineligible" — a field that could only ever hold one value is an
//     invitation to change it.
//
// ── ★ C31 · THE POPULATION TEST, AND IT IS THE HEADER'S RULE FOR A REASON ────────────────────────
// AN ORDERING INVARIANT IS ONLY REAL IF THE TWO FIGURES DESCRIBE THE SAME POPULATION.
//
// The rule was bought in the cross-metric pass: gross premium ≥ net premium is real, because both
// describe the same policies and one is the other less reinsurance. 13-month versus 61-month
// persistency is NOT, because they describe DIFFERENT COHORTS of policyholders — and testing it would
// have flagged 26.5% of perfectly correct rows as broken.
//
// Applied to every ordering invariant considered for this manifest, with what the test and the data
// each said:
//
//   deposits ≥ advances (banking)          POPULATION TEST FAILS. Deposits are a liability to
//                                          customers; advances are an asset lent to borrowers. They are
//                                          different populations of money and the relation between them
//                                          is an economic regularity, not an accounting identity. It
//                                          holds on 51/51 measured rows AND IS STILL NOT ASSERTED — a
//                                          bank funded partly by bonds can lend more than it takes in
//                                          deposits without anything being wrong. This is the exact
//                                          shape C31 exists to stop: passing data is not a passing test.
//
//   total borrowings ≥ borrowings due       POPULATION TEST PASSES — the second is a subset of the
//   within a year (non-financial)           first, same money. Measured 100% (total_debt is the sum of
//                                           the current and non-current halves). Documented, not
//                                           enforced, because it is true by construction at the fetch.
//
//   gross NPA ≥ net NPA (banking)           POPULATION TEST PASSES, same loan book. 51/51. NOT CARRIED
//                                           HERE — the quarterly section already reports both, and this
//                                           section restates nothing the quarter can say.
//
//   surplus in the policyholder fund ≥      POPULATION TEST APPEARS TO PASS (the transfer comes out of
//   transfer to shareholders (life)         the surplus) AND THE DATA REFUSES IT: 6 of 8 rows. So it is
//                                           not asserted. A same-population candidate still has to be
//                                           measured, and this is the one that proves it.
//
// ── ⚠ SCALE, AGAIN, AND WITH A NEW SEAM ─────────────────────────────────────────────────────────
// `returnOnEquity` is stored as a PERCENT on `fundamentals.roe` (median 14.83) and as a FRACTION on all
// four financial tables (banking median 0.1324). Same gloss, same concept, two units — the first shared
// key in either manifest whose scale differs by family. It is declared per family, as everything else
// is, and verify-annual-metrics.ts requires any such key to be named in SCALE_SEAMS with its reason, so
// a divergence can exist but never silently.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { AnnualMetricKey } from "../../catalogue/annual-metrics.js";
import type { MoneySense } from "./format.js";
import { MONEY_STEADY_PCT, type Family } from "./manifest.js";

export type { Family };
export type { MoneySense };

/** How a stored ANNUAL number relates to the number a reader should see.
 *  · money    — ₹ crore, as filed. Rendered by format.ts `money`.
 *  · percent  — ALREADY a percentage (14.8 means 14.8%).
 *  · fraction — a ratio (0.148 means 14.8%). MUST be multiplied by 100 before display.
 *  · multiple — a number of times over (3.70 means 3.70×). NEVER rendered with a % sign.
 *  · perShare — RUPEES PER SHARE (23.57 means ₹23.57 a share). NOT ₹ crore; see the header.
 *  · days     — a number of days. Neither a percentage nor a multiple. */
export type AnnualScale = "money" | "percent" | "fraction" | "multiple" | "perShare" | "days";

/** Bounds ON THE DISPLAY VALUE (after `scale` conversion), not on the stored number. */
export interface AnnualBounds {
  min: number | null;
  max: number | null;
}

/**
 * ★ A CROSS-FIELD SUPPRESSION — for the failures a single-metric bound structurally cannot see.
 *
 * `read` is handed a lookup over THIS row's stored values (native scale, exactly as fetched). It
 * returns true to WITHHOLD. The metric keys it consults are declared in `reads` so the gate can prove
 * the guard is looking at something the family actually reports.
 */
export interface CrossFieldGuard {
  reads: readonly AnnualMetricKey[];
  suppress: (read: (key: AnnualMetricKey) => number | null) => boolean;
  /** The reader's words for why it was withheld. Required whenever a guard is set. */
  reason: string;
}

export interface AnnualMetricSpec {
  /** Typed as AnnualMetricKey — a metric with no authored gloss is a compile error. */
  key: AnnualMetricKey;
  /** The column this reads, or the derivation. Documentation; the fetcher is the executable copy. */
  source: string;
  scale: AnnualScale;
  /** ★ REQUIRED ON EVERY `money` METRIC, ABSENT ON EVERY OTHER. What a NEGATIVE amount on this line
   *  means, and therefore what it is called. See format.ts's `MoneySense` — this exists because the
   *  quarter's single answer ("a loss of") is wrong on two thirds of the annual money lines. */
  moneySense?: MoneySense;
  /** ★ FALSE ⇒ REPORT THE LEVEL, NEVER A YEAR-ON-YEAR MOVEMENT. Only the per-share figures set this;
   *  `comparabilityReason` says why and is surfaced into the card's gaps. Default (absent) is true. */
  comparable?: false;
  comparabilityReason?: string;
  /** ★ TRUE ⇒ THIS IS A BALANCE-SHEET LINE — something the company OWNS or OWES on the year-end date.
   *
   *  This flag is what makes the section's stated purpose executable. The whole justification for the
   *  annual section is that it is the only route to a balance-sheet fact; a row that carries none is
   *  not a thin version of that, it is a different thing wearing the same heading. See the fourth gate
   *  in annual-section.ts, and the measurement that made it necessary. */
  balanceSheet?: true;
  /** Outside these DISPLAY-unit bounds the metric is suppressed whole, with `outOfRangeReason`. */
  bounds: AnnualBounds | null;
  /** The reader's words for why it was withheld. Required whenever `bounds` is set. */
  outOfRangeReason: string | null;
  /** Withheld when another figure on the SAME ROW makes this one meaningless. See CrossFieldGuard. */
  guard?: CrossFieldGuard;
  /** |Δ| below this, in DISPLAY units, reads as unchanged. NULL for money lines — those use the shared
   *  MONEY_STEADY_PCT, so this feature has ONE "a rupee line moved" threshold and not two. */
  steadyBand: number | null;
  /** Where the band came from. Kept so a recalibration knows what the number was fitted on. */
  steadyBandBasis: string | null;
  /** True for figures where a FALL is the favourable direction. */
  lowerIsBetter?: boolean;
  /** Anything a future reader of this file would otherwise have to rediscover. */
  note?: string;
}

/** The comparison this section is measured against: the SAME company's previous full year. */
export const ANNUAL_REF = "against the year before";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CROSS-FIELD GUARD, DECLARED ONCE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** ★ A RATIO MEASURED AGAINST SHAREHOLDERS' MONEY IS MEANINGLESS WHEN THERE IS NONE.
 *
 *  Negative net worth is REAL and it is on file: IDEA (−₹35,758 crore FY26 consolidated), GMRAIRPORT
 *  (−₹2,480 crore FY26), TTML and, historically, INDIGO. Those rows must keep showing their net worth —
 *  it is a genuine and important fact and a bound that hid it would hide the most serious thing on the
 *  card. What must NOT show is anything DIVIDED by it, because dividing a loss by a negative
 *  denominator produces a positive number that reads as a good year. */
/**
 * ★★ WHY NO PER-SHARE FIGURE CARRIES A YEAR-ON-YEAR MOVEMENT — THE NINETEENTH DEGENERATE CASE, AND IT
 * WAS FOUND BY RENDERING TWO CARDS.
 *
 * HDFCBANK's annual card read "Profit per share ₹48.62 a share — down ₹39.67 a share against the year
 * before", beside a net worth UP 12% and a profit that rose. BAJFINANCE read "₹30.60 a share — down
 * ₹238.34 a share", beside a loan book up 22%. Neither company's earnings collapsed. Both issued bonus
 * shares: the denominator changed, and the per-share figure fell because it was divided among more
 * shares. Nothing on these tables records a bonus, a split or an issue.
 *
 * MEASURED, by implying the share count from `net_profit / basic_eps` on every consecutive annual pair
 * on file: 293 of 986 pairs — 29.7% — sit across a share-count change of more than 2%. Banking is the
 * worst at 44.8% and NBFC next at 38.9%. The changes are not marginal: HDFCBANK ×2.01, BSE ×3.00,
 * COFORGE ×4.94, KOTAKBANK ×5.00, BAJAJFINSV ×10.00, M&MFIN ×111.38.
 *
 * So on nearly a third of cards the comparison would be arithmetically impeccable and factually false,
 * and there is no way to tell which third from these tables alone. This is C31's shape once more —
 * two figures that are not describing the same population, here because the population is the SHARE
 * COUNT and it moved between them. The LEVEL is filed, checkable against the statement, and stays. The
 * movement is dropped, everywhere, and the card says it dropped it.
 *
 * ⚠ DO NOT "FIX" THIS BY DERIVING THE SHARE COUNT FROM `paid_up_equity_capital / face_value_share`.
 * Those are the two columns the KOTAKBANK row proves are mis-parsed (see banking.basicEps), and
 * face_value_share is 0% populated on the life-insurance table. A correction built on them would be a
 * guess wearing a division sign.
 */
// 2a · three clauses, one sentence, 34 words. Split; nothing about the reason itself changed.
const PER_SHARE_NOT_COMPARABLE =
  "the number of shares changes when a company issues bonus shares or splits them. The accounts do " +
  "not record when that happened. This year's per-share figure cannot be set against last year's";

const NEGATIVE_NET_WORTH_GUARD = (what: string): CrossFieldGuard => ({
  reads: ["netWorth"],
  suppress: (read) => {
    const nw = read("netWorth");
    return nw === null || nw <= 0;
  },
  reason:
    `the company owes more than it owns, so there is no shareholders' money left to measure ${what} against`,
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FIVE ANNUAL MANIFESTS
//
// Steady bands are each metric's OWN p25 of |year-on-year Δ| across every pair on file, in DISPLAY
// units — the same method manifest.ts uses, re-measured on annual pairs because a full year moves
// further than a quarter. ⚠ THE SMALL-n WARNING APPLIES HARDER HERE: life and general insurance have
// FOUR annual pairs each, not thirteen. Those bands are the best available evidence and they are very
// thin. Treat them as provisional; do NOT quietly widen them to look confident.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export const ANNUAL_MANIFEST = {
  // ── NON-FINANCIAL · 19 metrics ────────────────────────────────────────────────────────────────
  non_financial: [
    { key: "totalAssets", source: "fundamentals.total_assets", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "netWorth", source: "fundamentals.net_worth", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "⚠⚠ DELIBERATELY UNBOUNDED, AND NEGATIVE VALUES ARE REAL. Four rows on the preferred basis are below zero — IDEA at −₹35,758 crore and GMRAIRPORT at −₹2,480 crore for FY26, both consolidated. A lower bound of zero would look like tidiness and would suppress the single most important fact on those cards. MEASURED: net_worth equals `equity_attributable_to_owners` on 734/734 rows and `equity_share_capital + other_equity` on 734/734, but equals `total_equity` on only 66.3% — total_equity includes non-controlling interests, so it is a DIFFERENT figure and is deliberately not in this manifest. One idea, one line." },
    { key: "totalDebt", source: "fundamentals.total_debt", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "MEASURED: total_debt = borrowings_current + borrowings_noncurrent, exactly, on 734/734 FY25+FY26 rows." },
    { key: "debtDueWithinAYear", source: "fundamentals.borrowings_current", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "C31: a SUBSET of totalDebt — same population, so `totalDebt ≥ debtDueWithinAYear` is a real ordering invariant. True by construction at the fetch, so it is documented rather than enforced." },
    { key: "cashAndCashEquivalents", source: "fundamentals.cash_and_cash_equivalents", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, note: "Universe minimum is 0 and never negative — 734/734 rows at or above zero." },
    { key: "inventories", source: "fundamentals.inventories", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "Zero for services companies, and zero renders as nil rather than as a loss — see change.ts's `nil` kind." },
    { key: "tradeReceivables", source: "fundamentals.trade_receivables_current", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "The CURRENT half only. `trade_receivables_noncurrent` is 78.9% covered and is a different thing — money not expected within the year — so mixing them would change what the line means from row to row." },
    { key: "propertyPlantAndEquipment", source: "fundamentals.property_plant_and_equipment", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "cashFromOperating", source: "fundamentals.cash_from_operating", scale: "money", moneySense: "flow", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "cashFromInvesting", source: "fundamentals.cash_from_investing", scale: "money", moneySense: "flow", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "cashFromFinancing", source: "fundamentals.cash_from_financing", scale: "money", moneySense: "flow", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "⚠ `net_cash_flow` IS DELIBERATELY NOT IN THIS MANIFEST. It closes against the sum of these three on only 67.8% of rows at 1% and 77.7% at 5% — the residual is the effect of exchange-rate moves on cash held abroad, which is a real fourth line this table does not store. Printing a total beside three components that do not add up to it is the operatingProfit trap (C15) in a new place." },
    { key: "capitalExpenditure", source: "fundamentals.capex", scale: "money", moneySense: "level", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "Negative on 4 of 734 rows — a year in which sale proceeds exceeded purchases. Real, and left to render as a negative money line." },
    { key: "freeCashFlow", source: "fundamentals.fcf", scale: "money", moneySense: "level", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "MEASURED: fcf = cash_from_operating − capex, exactly, on 734/734 rows. Negative on 207 of them (28%), which is ordinary and is what the gloss says." },
    { key: "dividendsPaid", source: "fundamentals.dividends_paid", scale: "money", moneySense: "level", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "Exactly zero on 126 of 734 rows — a company that paid no dividend. Renders as nil, never as a loss." },
    { key: "basicEps", source: "fundamentals.basic_eps", scale: "perShare",
      comparable: false, comparabilityReason: PER_SHARE_NOT_COMPARABLE,
      bounds: null, outOfRangeReason: null,
      steadyBand: 2.29, steadyBandBasis: "p25 of |YoY Δ| = ₹2.29 a share, n=956",
      note: "⚠ UNBOUNDED ON PURPOSE. The universe maximum is ₹5,720 (MRF, whose shares trade above ₹1 lakh) and the minimum is −₹74.42. Both are real, and any bound tight enough to be useful would cut one of them. `diluted_eps` is deliberately absent — it differs from basic by a rounding on the median row and two near-identical per-share figures is saying one thing twice." },
    { key: "returnOnEquity", source: "fundamentals.roe", scale: "percent",
      bounds: { min: -200, max: 300 }, outOfRangeReason: "the reported return is outside the range this measure can meaningfully take",
      guard: NEGATIVE_NET_WORTH_GUARD("a return"),
      steadyBand: 1.3, steadyBandBasis: "p25 of |YoY Δ| = 1.312pp, n=662",
      note: "⚠ PERCENT-SCALE HERE AND FRACTION-SCALE ON ALL FOUR FINANCIAL TABLES — the manifest's one declared scale seam; see SCALE_SEAMS. Above 100% is real and not an error (ASTERDM FY25 at 157.75%, INDIGO FY25 at 127.74%): an asset-light company with little equity earns a very large return on it. ★ AND SEE THE GUARD — this is the metric the cross-field mechanism was built for." },
    { key: "debtToEquity", source: "fundamentals.debt_to_equity", scale: "percent",
      bounds: { min: 0, max: 2000 }, outOfRangeReason: "the borrowing is so large against the shareholders' money that the comparison stops describing anything",
      guard: NEGATIVE_NET_WORTH_GUARD("borrowings"),
      steadyBand: 0.5, steadyBandBasis: "p25 of |YoY Δ| = 0.5115pp, n=655", lowerIsBetter: true,
      note: "⚠⚠ PERCENT-SCALE, AND IT LOOKS LIKE A MULTIPLE. MEASURED: debt_to_equity = (total_debt / net_worth) × 100 on 734/734 rows, so a stored 35.6364 means the company has borrowed ₹35.64 for every ₹100 of shareholders' money — NOT 35.6 times over. Rendering it as a multiple would overstate the borrowing by a hundredfold, which is the combined-ratio failure with the sign of the error reversed." },
    { key: "interestCoverage", source: "fundamentals.interest_coverage", scale: "multiple",
      bounds: { min: -100, max: 200 }, outOfRangeReason: "the company's interest bill is too small for the number of times profit covers it to describe anything",
      steadyBand: 0.95, steadyBandBasis: "p25 of |YoY Δ| = 0.9508x, n=954",
      note: "⚠ THE UPPER BOUND SUPPRESSES A DIVISION ARTIFACT, NOT A GOOD YEAR. 12 of 734 rows exceed 1000, topping out at NBCC's 29,064 — companies with essentially no borrowings, where the denominator is a rounding. ⚠ THE LOWER BOUND IS NEGATIVE ON PURPOSE: 19 rows are below zero because the company made a trading loss, and that is the case a reader most needs. It is rendered in words rather than as a bare multiple — see format.ts `interestCoveragePlain`." },
    { key: "receivablesDays", source: "fundamentals.receivables_days", scale: "days",
      bounds: { min: 0, max: 365 }, outOfRangeReason: "the figure implies customers take more than a year to pay. That usually means the sales and the amounts owed are not describing the same business",
      steadyBand: 1.9, steadyBandBasis: "p25 of |YoY Δ| = 1.87 days, n=657", lowerIsBetter: true,
      note: "⚠ A DAYS SCALE, and the only metric in either manifest that uses it. 5 of 734 rows exceed a year (MMTC at 2,573 days), which is a trading company whose revenue and receivables are not the same population." },
  ],

  // ── BANKING · 15 metrics ──────────────────────────────────────────────────────────────────────
  // ⚠ ASSET QUALITY AND CAPITAL ARE NOT HERE. gnpa, nnpa, pcr and cet1 are already on the QUARTERLY
  // card, from the same company's Q4 filing. Restating them from the annual row would print the same
  // figure twice under two dates. This section carries only what the quarter structurally cannot.
  banking: [
    { key: "deposits", source: "banking_fundamentals.deposits", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "C31: `deposits ≥ advances` holds on 51/51 rows and IS NOT ASSERTED ANYWHERE. Deposits are owed to customers and advances are owed by borrowers — different populations, so the relation is an economic regularity and a bank funded partly by bonds may legitimately break it. See the header." },
    { key: "advances", source: "banking_fundamentals.advances", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "totalAssets", source: "banking_fundamentals.total_assets", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "MEASURED: total_assets = capital_and_liabilities on 51/51 rows, and equals the six asset lines summed on 51/51. A real balance sheet that balances — which, as the two insurance manifests below record, is not true everywhere." },
    { key: "netWorth", source: "banking_fundamentals.net_worth", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "MEASURED: net_worth = capital + reserves_and_surplus, exactly, on 51/51 rows. ⚠ `reserve_excl_revaluation` is 0% populated on every FY25+FY26 standalone row and is deliberately not in this manifest — a column with no data is not a metric." },
    { key: "bankBorrowings", source: "banking_fundamentals.borrowings", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "investmentBook", source: "banking_fundamentals.investments", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "⚠ `revenue_on_investments` is 0% populated on every FY25+FY26 standalone row, so what this book EARNED cannot be reported. The holding can; the return on it cannot, and the card says nothing rather than guessing." },
    { key: "cashFromOperating", source: "banking_fundamentals.cash_from_operating", scale: "money", moneySense: "flow", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "cashFromInvesting", source: "banking_fundamentals.cash_from_investing", scale: "money", moneySense: "flow", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "cashFromFinancing", source: "banking_fundamentals.cash_from_financing", scale: "money", moneySense: "flow", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "netInterestMargin", source: "banking_fundamentals.net_interest_margin", scale: "fraction",
      bounds: { min: 0, max: 25 }, outOfRangeReason: "the reported margin is outside the range a lender's interest margin can take",
      steadyBand: 0.09, steadyBandBasis: "p25 of |YoY Δ| = 0.0896pp, n=26",
      note: "★ ONE OF THE FOUR METRICS THIS SECTION EXISTS FOR. verify-quarter-metrics.ts §5 forbids `netInterestMargin` from the QUARTERLY catalogue because it needs average assets across a year — an input a quarter does not have. Here it is filed. ⚠ FRACTION-SCALE: stored 0.0355 means 3.55%. Universe range 2.44%–6.65%." },
    { key: "creditCost", source: "banking_fundamentals.credit_cost_pct", scale: "fraction",
      bounds: { min: -10, max: 25 }, outOfRangeReason: "the reported charge is outside the range this measure can meaningfully take",
      steadyBand: 0.08, steadyBandBasis: "p25 of |YoY Δ| = 0.076pp, n=26", lowerIsBetter: true,
      note: "⚠ FRACTION-SCALE, and NEGATIVE ON 2 OF 51 ROWS — a year in which the bank released more provisions than it made, because borrowers it had already written down came good. That is real and the lower bound is negative to let it through." },
    { key: "creditDepositRatio", source: "banking_fundamentals.credit_deposit_ratio", scale: "fraction",
      bounds: { min: 0, max: 200 }, outOfRangeReason: "the reported share is outside the range this measure can meaningfully take",
      steadyBand: 1.9, steadyBandBasis: "p25 of |YoY Δ| = 1.9095pp, n=26",
      note: "⚠ FRACTION-SCALE. Universe range 68.4%–96.5%. Deliberately NOT lowerIsBetter — neither direction is favourable, it is a choice about how much of the deposit base to keep in easily sold assets, and the gloss says so." },
    { key: "returnOnEquity", source: "banking_fundamentals.roe", scale: "fraction",
      bounds: { min: -100, max: 100 }, outOfRangeReason: "the reported return is outside the range this measure can meaningfully take",
      guard: NEGATIVE_NET_WORTH_GUARD("a return"),
      steadyBand: 0.54, steadyBandBasis: "p25 of |YoY Δ| = 0.5365pp, n=26",
      note: "⚠ FRACTION-SCALE here and PERCENT-SCALE on non_financial. The seam is declared in SCALE_SEAMS." },
    { key: "returnOnAssetsAnnual", source: "banking_fundamentals.roa_disclosed", scale: "fraction",
      bounds: { min: -10, max: 10 }, outOfRangeReason: "the reported return is outside the range this measure can meaningfully take",
      steadyBand: 0.02, steadyBandBasis: "p25 of |YoY Δ| = 0.02pp, n=29",
      note: "⚠ A DIFFERENT KEY FROM THE QUARTERLY `returnOnAssetsQuarterly`, ON PURPOSE. Same idea, different period, and the quarterly gloss already carries the warning that the two cannot be compared without adjusting for length. Two keys is what stops one card carrying both under one name." },
    { key: "basicEps", source: "banking_fundamentals.basic_eps", scale: "perShare",
      comparable: false, comparabilityReason: PER_SHARE_NOT_COMPARABLE,
      bounds: null, outOfRangeReason: null,
      steadyBand: 0.93, steadyBandBasis: "p25 of |YoY Δ| = ₹0.93 a share, n=29",
      note: "⚠⚠ `book_value_per_share` IS DELIBERATELY ABSENT FROM EVERY MANIFEST IN THIS FILE, and this is where the reason is on file. KOTAKBANK FY25 stored a book value per share of ₹117,239.89 — its ENTIRE NET WORTH IN ₹ CRORE — because `face_value_share` on that row was 994.11, byte-equal to `paid_up_equity_capital`. It looked at first like it belongs in the XBRL parser against the filed source (PB-3, xbrl/parser-backlog.ts) — it does not: verified against the raw filed XBRL, the two are DISTINCT facts that happen to share a numeral, a source-filing error, not a parser fault (the parser reads both tags correctly). ★ CLOSED 2026-08-11 — 'no single-metric bound catches it' was true of a magnitude bound alone but is SUPERSEDED: plausibleFaceValue now takes an optional 2nd param that rejects a face value byte-equal to its own paid-up capital regardless of size, and meaningfulBookValue bounds the OUTPUT at ₹1,00,000/share (MRF's ₹49,468 is the highest legitimate value anywhere across all five *_fundamentals tables) — together they catch both the face-value-side shape (KOTAKBANK, plus ITCHOTELS/JKTYRE/EXIDEIND found on THIS table) and the mirror paidUp-side shape (CANFINHOME). The exclusion from these manifests STAYS — a display column, not a score input, and a separate call from whether the stored value is now correct — but the value itself is no longer wrong." },
  ],

  // ── NBFC · 14 metrics ─────────────────────────────────────────────────────────────────────────
  nbfc: [
    { key: "loanBook", source: "nbfc_fundamentals.loans", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "Exactly zero on 2 of 59 rows — a holding company inside the NBFC family that lends nothing itself. Renders as nil, which is the honest reading." },
    { key: "totalAssets", source: "nbfc_fundamentals.total_assets", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "MEASURED: total_assets = financial_assets + non_financial_assets on 59/59 rows, and = total_liabilities + total_equity on 59/59." },
    { key: "totalLiabilities", source: "nbfc_fundamentals.total_liabilities", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "Carried as ONE line rather than as debt_securities / borrowings / subordinated_liabilities separately: the three-way split is 96.6% covered at its weakest and reads as jargon to this reader, while the total is 100% covered and answers the question." },
    { key: "netWorth", source: "nbfc_fundamentals.net_worth", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "MEASURED: net_worth = total_equity, exactly, on 59/59 rows — so `total_equity` is deliberately not a second line." },
    { key: "cashAndCashEquivalents", source: "nbfc_fundamentals.cash_and_cash_equivalents", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "cashFromOperating", source: "nbfc_fundamentals.cash_from_operating", scale: "money", moneySense: "flow", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "cashFromInvesting", source: "nbfc_fundamentals.cash_from_investing", scale: "money", moneySense: "flow", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "cashFromFinancing", source: "nbfc_fundamentals.cash_from_financing", scale: "money", moneySense: "flow", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "netInterestMargin", source: "nbfc_fundamentals.nim", scale: "fraction",
      bounds: { min: -25, max: 50 }, outOfRangeReason: "the reported margin is outside the range a lender's interest margin can take",
      steadyBand: 0.17, steadyBandBasis: "p25 of |YoY Δ| = 0.166pp, n=26",
      note: "⚠ FRACTION-SCALE, and NEGATIVE ON 2 OF 57 ROWS — a lender that paid more for its money than it earned on it. The bound is negative to let that through; suppressing it would keep only the flattering readings. Universe range −3.12% to 17.59%, far wider than banking's." },
    { key: "creditCost", source: "nbfc_fundamentals.credit_cost_pct", scale: "fraction",
      bounds: { min: -50, max: 50 }, outOfRangeReason: "the reported charge is outside the range this measure can meaningfully take",
      steadyBand: 0.14, steadyBandBasis: "p25 of |YoY Δ| = 0.1413pp, n=26", lowerIsBetter: true,
      note: "⚠ FRACTION-SCALE. Negative on 7 of 57 rows — write-backs, and far more common here than in banking. Universe range −16.52% to 20.41%." },
    { key: "costToIncomeAnnual", source: "nbfc_fundamentals.cost_to_income_ratio", scale: "fraction",
      bounds: { min: 0, max: 400 }, outOfRangeReason: "the reported cost share is outside the range this measure can meaningfully take",
      steadyBand: 0.55, steadyBandBasis: "p25 of |YoY Δ| = 0.5549pp, n=27", lowerIsBetter: true,
      note: "⚠ FRACTION-SCALE, and a SEPARATE KEY from banking's quarterly `costToIncomeRatio` because the two are not the same measure: banking's excludes deposit interest from the numerator by construction and an NBFC has no deposits to exclude. Universe range 5.22%–99.75%. The bound is 400, not 100, for the same reason banking's is — above 100 is a real year and suppressing it would keep only the good ones." },
    { key: "borrowingsToEquity", source: "nbfc_fundamentals.borrowings_to_equity", scale: "multiple",
      bounds: { min: 0, max: 50 }, outOfRangeReason: "the reported leverage is outside the range this measure can meaningfully take",
      steadyBand: 0.08, steadyBandBasis: "p25 of |YoY Δ| = 0.0759x, n=27",
      note: "⚠ A MULTIPLE, NOT A PERCENTAGE — and it sits beside non_financial's `debtToEquity`, which IS a percentage and is the same idea. They are separate keys precisely so the two units can never be rendered by the same code path. Universe range 0.03x–7.44x." },
    { key: "returnOnEquity", source: "nbfc_fundamentals.roe", scale: "fraction",
      bounds: { min: -100, max: 100 }, outOfRangeReason: "the reported return is outside the range this measure can meaningfully take",
      guard: NEGATIVE_NET_WORTH_GUARD("a return"),
      steadyBand: 0.56, steadyBandBasis: "p25 of |YoY Δ| = 0.5573pp, n=57",
      note: "⚠ FRACTION-SCALE. Negative on 3 of 59 rows, which is a loss-making year with positive equity — a real reading, not the guard's case." },
    { key: "basicEps", source: "nbfc_fundamentals.basic_eps", scale: "perShare",
      comparable: false, comparabilityReason: PER_SHARE_NOT_COMPARABLE,
      bounds: null, outOfRangeReason: null,
      steadyBand: 2.56, steadyBandBasis: "p25 of |YoY Δ| = ₹2.56 a share, n=83" },
  ],

  // ── LIFE INSURANCE · 11 metrics ───────────────────────────────────────────────────────────────
  // ⚠⚠ NO `totalAssets` FOR EITHER INSURANCE FAMILY — see the note on `policyholdersFunds`.
  // ⚠ NO CASH-FLOW LINES: neither insurance fundamentals table stores one.
  life_insurance: [
    { key: "policyholdersFunds", source: "life_insurance_fundamentals.policyholders_funds", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "⚠⚠ THIS LINE REPLACES `total_assets`, WHICH IS A TRAP ON BOTH INSURANCE TABLES. The stored `total_assets` is the Indian insurer format's APPLICATION OF FUNDS total — a balancing figure NET of current liabilities and provisions — not gross assets. MEASURED: it equals `total_application_of_funds` on 8/8 life rows and 8/8 general rows, and on GICRE it equals NET WORTH exactly (₹86,467 crore FY26) while that insurer's investments alone are ₹140,928 crore. Labelling it 'everything the company owns' would understate the balance sheet by 1.6× on that row and, on ICICIGI FY26, would print a total smaller than the net worth beside it. So neither insurance manifest carries it, and the holdings are reported directly instead." },
    { key: "investmentsPolicyholders", source: "life_insurance_fundamentals.investments_policyholders", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "investmentsShareholders", source: "life_insurance_fundamentals.investments_shareholders", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "assetsHeldToCoverLinkedLiabilities", source: "life_insurance_fundamentals.assets_held_to_cover_linked_liabilities", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "netWorth", source: "life_insurance_fundamentals.net_worth", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "MEASURED: net_worth = share_capital + reserves_and_surplus + fair_value_change_account on 8/8 rows, and NOT share_capital + reserves alone (0/8) — the unrealised investment gains are inside it. Stated because the obvious two-term identity is the wrong one." },
    { key: "surplusFromRevenueAccount", source: "life_insurance_fundamentals.surplus_from_revenue_account", scale: "money", moneySense: "level", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "C31: `surplus ≥ transferFromPolicyholders` looks like a same-population invariant — the transfer comes out of the surplus — AND THE DATA REFUSES IT, holding on only 6 of 8 rows. Not asserted. This is the case that proves a same-population candidate still has to be measured." },
    { key: "transferFromPolicyholders", source: "life_insurance_fundamentals.transfer_from_policyholders", scale: "money", moneySense: "level", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "★ THE LINE THE QUARTERLY MANIFEST SAYS IT CANNOT SEE. manifest.ts's life_insurance.tax note explains that the quarterly profit bridge fails because the shareholders'-account lines 'exist only on the ANNUAL table'. They do, and they are here. ⚠ BUT THE MEASUREMENT CORRECTS THE SECOND HALF OF THAT SENTENCE: having them does NOT close the bridge. `PBT = transfer + shareholders' investment income + other − shareholders' expenses` closes on 0 of 8 annual rows at 1% tolerance, and `net profit = PBT − tax` on 0 of 8 (LICI FY25 reports PBT and net profit as the SAME ₹48,151.17 crore with a ₹7,772.49 crore tax charge between them). So this line is reported as a filed figure and is not, and must not become, an input to any decomposition." },
    { key: "incomeFromInvestmentsShareholders", source: "life_insurance_fundamentals.income_from_investments_shareholders", scale: "money", moneySense: "level", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "shareholdersExpenses", source: "life_insurance_fundamentals.shareholders_expenses", scale: "money", moneySense: "level", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "returnOnEquity", source: "life_insurance_fundamentals.roe", scale: "fraction",
      bounds: { min: -100, max: 100 }, outOfRangeReason: "the reported return is outside the range this measure can meaningfully take",
      guard: NEGATIVE_NET_WORTH_GUARD("a return"),
      steadyBand: 0.08, steadyBandBasis: "p25 of |YoY Δ| = 0.0754pp, n=4 — VERY SMALL SAMPLE, four issuers, one pair each",
      note: "⚠ THE THINNEST BAND IN EITHER MANIFEST, on four pairs. Provisional. ICICIPRULI's net worth fell from ₹11,982 crore to ₹1,449 crore between FY25 and FY26, so this family's denominator is not as steady as four issuers suggest." },
    { key: "basicEps", source: "life_insurance_fundamentals.basic_eps", scale: "perShare",
      comparable: false, comparabilityReason: PER_SHARE_NOT_COMPARABLE,
      bounds: null, outOfRangeReason: null,
      steadyBand: 0.48, steadyBandBasis: "p25 of |YoY Δ| = ₹0.48 a share, n=4 — VERY SMALL SAMPLE",
      note: "⚠ `face_value_share` and `paid_up_equity_capital` are BOTH 0% populated on this table, which is a second, independent reason the per-share book value is absent everywhere: on this family it could not be derived at all." },
  ],

  // ── GENERAL INSURANCE · 8 metrics ─────────────────────────────────────────────────────────────
  // ⚠ TEN COLUMNS ON THIS TABLE ARE 0% POPULATED on every FY25+FY26 standalone row — reinsurance_ceded,
  // reinsurance_accepted, change_in_unexpired_risk_reserve, reinsurance_recoveries_on_claims,
  // commission_paid, commission_received_from_reinsurance, rent_rates_and_taxes,
  // legal_and_professional_charges, advertisement_and_publicity and face_value_share. None is in this
  // manifest. A column with no data is not a metric, and declaring one would make the fetcher supply a
  // permanent null that the card would then have to explain away on every single row.
  general_insurance: [
    { key: "insurerInvestments", source: "general_insurance_fundamentals.investments", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "A SEPARATE KEY from banking's `investmentBook`: a bank's securities are held largely because the regulator requires it, an insurer's are the float it collected in premiums. Similar column name, different thing, so a shared gloss would be subtly wrong for one of them." },
    { key: "netWorth", source: "general_insurance_fundamentals.net_worth", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "MEASURED: net_worth = share_capital + reserves_and_surplus + fair_value_change_account on 8/8 rows (and NOT the two-term form, 0/8). ⚠ On ICICIGI FY26 this figure EXCEEDS the stored `total_assets` — which is why that column is not in this manifest; see life_insurance.policyholdersFunds." },
    { key: "fairValueChangeAccount", source: "general_insurance_fundamentals.fair_value_change_account", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "⚠ MATERIAL, NOT A ROUNDING. On GICRE FY26 this is ₹32,728 crore of an ₹86,467 crore net worth — 38% of the owners' money is gains on investments that have not been sold. Reported for that reason. It is INSIDE net worth, not beside it, and the gloss says the gains can reverse." },
    { key: "cashAndCashEquivalents", source: "general_insurance_fundamentals.cash_and_bank_balances", scale: "money", moneySense: "level", balanceSheet: true, bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null },
    { key: "changeInOutstandingClaims", source: "general_insurance_fundamentals.change_in_outstanding_claims", scale: "money", moneySense: "reserveMove", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "Moves in both directions and is an estimate revising, not cash. Rendered as a money line, so a release renders as a negative amount and the gloss carries the reading." },
    { key: "premiumDeficiency", source: "general_insurance_fundamentals.premium_deficiency", scale: "money", moneySense: "reserveMove", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null,
      note: "⚠ A reserve MOVING, not a reserve held — the revenue account books the year's charge or credit here, so it goes negative when the reserve is released. Found by rendering: as a `level` it printed GICRE's prior year as 'negative ₹38 crore', which is a release described as a negative amount of money set aside. Zero on most rows, which is the normal case and is stated as such in the gloss rather than left as a bare nil." },
    { key: "returnOnEquity", source: "general_insurance_fundamentals.roe", scale: "fraction",
      bounds: { min: -100, max: 100 }, outOfRangeReason: "the reported return is outside the range this measure can meaningfully take",
      guard: NEGATIVE_NET_WORTH_GUARD("a return"),
      steadyBand: 0.68, steadyBandBasis: "p25 of |YoY Δ| = 0.6768pp, n=4 — VERY SMALL SAMPLE, four issuers, one pair each" },
    { key: "basicEps", source: "general_insurance_fundamentals.basic_eps", scale: "perShare",
      comparable: false, comparabilityReason: PER_SHARE_NOT_COMPARABLE,
      bounds: null, outOfRangeReason: null,
      steadyBand: 1.54, steadyBandBasis: "p25 of |YoY Δ| = ₹1.54 a share, n=4 — VERY SMALL SAMPLE",
      note: "⚠ `net_underwriting_margin` is deliberately absent, exactly as it is from the quarterly manifest: measured, it equals 1 − combined_ratio on 8/8 annual rows too, and the combined ratio is already on the quarterly card." },
  ],
} as const satisfies Record<Family, readonly AnnualMetricSpec[]>;

/**
 * ★ DECLARED SCALE DIVERGENCES. A key that means the same thing in two families should carry the same
 * unit in both; where the STORED data refuses that, the divergence is named here with its evidence and
 * verify-annual-metrics.ts fails on any un-named one. A seam that must exist can exist; a seam nobody
 * decided on cannot.
 */
export const SCALE_SEAMS: Readonly<Record<string, string>> = {
  returnOnEquity:
    "`fundamentals.roe` is stored as a PERCENT (universe median 14.83, range −65.14 to 157.75) while " +
    "banking, nbfc, life and general insurance all store `roe` as a FRACTION (banking median 0.1324). " +
    "Measured on FY25+FY26 rows of each table. The conversion is per family, at the render, via `scale`.",
};

/** The annual metric keys THIS family reports. Per-family and literal. */
export type AnnualMetricKeyOf<F extends Family> = (typeof ANNUAL_MANIFEST)[F][number]["key"];

/**
 * ONE FULL YEAR of ONE family, carrying EVERY annual metric that family's manifest declares.
 *
 * ★ `values` IS A Record, NOT A Partial — the same rule, and the same reason, as FamilyQuarter.
 */
export interface FamilyAnnual<F extends Family> {
  family: F;
  fiscalYear: string;
  resultType: "consolidated" | "standalone";
  /** ★ THE ANNUAL SECTION'S OWN AS-OF DATE (4d). The year-end the balance sheet describes. It matches
   *  the quarter's reportDate on 99.8% of rows and MUST be rendered wherever it does not. */
  asOfDate: Date;
  filingDate: Date;
  /** Stored values in their NATIVE scale. Conversion happens at render, per `spec.scale`. */
  values: Record<AnnualMetricKeyOf<F>, number | null>;
}

/** A full year of ANY family — a DISCRIMINATED UNION on `family`, never `FamilyAnnual<Family>`.
 *  ⚠ Same distinction manifest.ts's AnyFamilyQuarter documents: the generic form distributes the
 *  Record over the UNION of all keys and demands every family supply every other family's metrics. */
export type AnyFamilyAnnual =
  | FamilyAnnual<"non_financial">
  | FamilyAnnual<"banking">
  | FamilyAnnual<"nbfc">
  | FamilyAnnual<"life_insurance">
  | FamilyAnnual<"general_insurance">;

/** Read one annual metric off a year of unknown family. Null when that family does not report it. */
export const annualValueOf = (a: AnyFamilyAnnual, key: AnnualMetricKey): number | null =>
  (a.values as Record<string, number | null>)[key] ?? null;

/** The annual manifest for `family`, typed so `.key` narrows to that family's metric union. */
export const annualManifestFor = <F extends Family>(family: F): readonly AnnualMetricSpec[] =>
  ANNUAL_MANIFEST[family] as readonly AnnualMetricSpec[];

/** THE display conversion for an annual figure. `fraction` is the only scale that is rescaled;
 *  everything else is already in the unit its bounds and steady band are expressed in. */
export function toAnnualDisplayValue(spec: AnnualMetricSpec, stored: number): number {
  return spec.scale === "fraction" ? stored * 100 : stored;
}

/** Is this figure inside the range where it means what its gloss says it means?
 *  ⚠ A MEANING check, not an arithmetic one. Every value it rejects divided correctly. */
export function withinAnnualBounds(spec: AnnualMetricSpec, stored: number): boolean {
  if (!spec.bounds) return true;
  const v = toAnnualDisplayValue(spec, stored);
  if (spec.bounds.min !== null && v < spec.bounds.min) return false;
  if (spec.bounds.max !== null && v > spec.bounds.max) return false;
  return true;
}

/** Did this metric move enough to be worth calling a change?
 *  Money lines use MONEY_STEADY_PCT — the SAME threshold the quarterly section and the verdict use, so
 *  this feature has one answer to "did a rupee line move" and not two. */
export function isAnnualSteady(
  spec: AnnualMetricSpec,
  current: number | null,
  prior: number | null,
): boolean | null {
  if (current === null || prior === null) return null;
  if (spec.scale === "money") {
    if (prior === 0) return null;
    return Math.abs(((current - prior) / prior) * 100) < MONEY_STEADY_PCT;
  }
  if (spec.steadyBand === null) return null;
  return Math.abs(toAnnualDisplayValue(spec, current) - toAnnualDisplayValue(spec, prior)) < spec.steadyBand;
}
