// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE METRIC MANIFEST — what each family's quarter actually contains, and how each figure must be read.
//
// ── ★ WHY THIS FILE EXISTS: THE FLATTENING WAS THE BUG ────────────────────────────────────────────
// fact-block.ts normalises all five families down to a fifteen-field `QRow`. Everything outside those
// fifteen slots is discarded at the fetch, before any decision is made about it. Measured: the fact
// block carried 2–4 metrics out of the 15–28 each family files at ~100% coverage. Banking used 3 of 25.
// Life insurance used 3 of 28 — neither solvency nor any of the five persistency ratios, which are the
// metrics that actually describe a life insurer.
//
// The card was thin because the INPUT was thin. Across 4,272 generation runs, 2 failed on
// ungrounded_number and zero on evaluative, forward or heading language: the model was never the
// problem. So the fix is here, not in the prompt.
//
// ── THE ENFORCEMENT THAT STOPS IT COMING BACK ────────────────────────────────────────────────────
// `FamilyQuarter<F>.values` is `Record<MetricKeyOf<F>, number | null>` — a RECORD, not a Partial. A
// fetcher that omits a manifest metric does not compile. Adding a metric to a manifest breaks the
// build until the fetcher supplies it. There is no path back to a lowest-common-denominator row that
// typechecks.
//
// And `key: MetricKey` is `keyof typeof QUARTER_METRIC_GLOSSES`, so a metric with no authored gloss is
// a compile error too. Both halves of "every tracked metric, in plain language" are held by the
// compiler rather than by review.
//
// ── ★ SCALE IS THE HAZARD THIS FILE EXISTS TO CONTAIN ────────────────────────────────────────────
// These tables mix percent-scale and fraction-scale columns IN THE SAME ROW. general_insurance stores
// `net_margin` as a percent (-2.2853 → −2.29%) and `combined_ratio` as a fraction (1.2144 → 121.44%),
// side by side. Banking stores gnpa/nnpa/cet1/tier1/roa as fractions on a table whose net_margin is a
// percent. A consumer that forgets to convert prints "0.02% bad loans" for a 2% book — not a rounding
// error, a different number by two orders of magnitude, always in the flattering direction.
//
// So `scale` is declared per metric and conversion happens once, at the render boundary. Never inferred.
//
// ── ★ AND ONE GLOBAL RULE CANNOT WORK — margins.ts ALREADY LEARNED THIS ──────────────────────────
// margins.ts carries a per-series `maxAbs` because a general insurer's combined ratio is LEGITIMATELY
// above 100 while a net margin above 100 is a division artifact. The same split runs through this
// manifest: cost-to-income above 100 is a real quarter, solvency is a MULTIPLE and not a percentage at
// all, and persistency has a live mis-scaled value in the data that no bound on "is it a plausible
// percentage" would catch. Hence per-metric `bounds` with an authored `outOfRangeReason`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { MetricKey } from "../../catalogue/quarter-metrics.js";

export type Family = "non_financial" | "banking" | "nbfc" | "life_insurance" | "general_insurance";
export type Basis = "consolidated" | "standalone";

/** How a stored number relates to the number a reader should see.
 *  · money    — ₹ crore, as filed. Rendered by format.ts `money`.
 *  · percent  — ALREADY a percentage (18.2 means 18.2%).
 *  · fraction — a ratio (0.182 means 18.2%). MUST be multiplied by 100 before display.
 *  · multiple — a number of times over (2.12 means 2.12×). NEVER rendered with a % sign. */
export type Scale = "money" | "percent" | "fraction" | "multiple";

/** Driver-bullet eligibility (Stage 0, C17/C18).
 *  · eligible   — may be NAMED as the key driver when it clears the materiality cut.
 *  · context    — always reported, never named as the driver. The top line and the residual bucket.
 *  · ineligible — structurally cannot be a driver (a subtotal, the bridge's target, or a ratio). */
export type DriverRole = "eligible" | "context" | "ineligible";

/** Bounds ON THE DISPLAY VALUE (after `scale` conversion), not on the stored number. */
export interface MetricBounds {
  min: number | null;
  max: number | null;
}

export interface MetricSpec {
  /** Typed as MetricKey — a metric with no authored gloss is a compile error. */
  key: MetricKey;
  /** The column this reads, or the derivation. Documentation; the fetcher is the executable copy. */
  source: string;
  scale: Scale;
  /** Outside these DISPLAY-unit bounds the metric is suppressed whole, with `outOfRangeReason`. */
  bounds: MetricBounds | null;
  /** The reader's words for why it was withheld. Required whenever `bounds` is set. */
  outOfRangeReason: string | null;
  /** |Δ| below this, in DISPLAY units, reads as unchanged. NULL for money lines — those use the
   *  shared LINE_MATERIAL_PCT so a metric never reads "steady" on a card whose verdict says it moved. */
  steadyBand: number | null;
  /** Where the band came from. Kept so a recalibration knows what the number was fitted on. */
  steadyBandBasis: string | null;
  driver: DriverRole;
  /** Why this metric has the driver role it has, when the reason is not obvious. */
  driverNote?: string;
  /** True for ratios where a FALL is the favourable direction. Load-bearing — margins.ts's contract. */
  lowerIsBetter?: boolean;
  /** Anything a future reader of this file would otherwise have to rediscover. */
  note?: string;
}

/** Money lines read as unchanged below this percentage move. DELIBERATELY the verdict's own cut
 *  (verdict.ts LINE_MATERIAL_PCT): a line reading "steady" on a card whose badge says the quarter
 *  moved would be a contradiction inside one view. Do not introduce a second threshold. */
export const MONEY_STEADY_PCT = 3;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FIVE MANIFESTS
//
// Steady bands are each metric's OWN p25 of |year-on-year Δ|, measured across the universe. Per metric,
// not shared: a single 0.5pp floor gives a sensible ~10–15% "steady" bucket on margins but would call
// 57.6% of bank GNPA readings and 75% of general-insurance solvency readings unchanged. `net_margin`
// alone ranges from p25 = 0.2pp (life) to 1.0pp (banking) across the five families — which is the whole
// argument for the band living here rather than in a constant.
//
// ⚠ SMALL-n WARNING, STATED ONCE AND REPEATED IN EACH AFFECTED ENTRY. Life-insurance bands are fitted
// on n = 13 pairs and general-insurance on n = 8, because there are four issuers in each family. They
// are the best available evidence and they are thin. Treat any of them as provisional and recalibrate
// when the universe grows; do NOT quietly widen them to look confident.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ THE ONE REASON A MARGIN IS WITHHELD FOR EXCEEDING ITS OWN RANGE — and it is EXPORTED now because
 * three files need to agree on it.
 *
 * ⚠ IT WAS TWO COPIES. This literal was also written out longhand in margins.ts, where the series-level
 * check lives, and the two had to stay identical for fact-block.ts's gaps collapse to fold the metric
 * line and the margin series into ONE sentence instead of two near-identical ones. A shared string
 * silently duplicated is a stutter waiting for someone to reword half of it.
 *
 * ⚠⚠ AND IT IS NOW A MATCH TARGET, NOT ONLY COPY. Q-K (contrasts.ts) states the SAME underlying fact
 * with the arithmetic attached, so on a card where both fire the gaps line must defer rather than say
 * it again — see fact-block.ts. That match is by CONSTANT, never by reading the prose.
 */
export const PROFIT_EXCEEDS_REVENUE_REASON =
  "profit this quarter was far larger than revenue, so a margin would not describe anything real";

/**
 * The same fact, said as a reason for the missing MARGIN alone, for the cards where Q-K has already
 * stated the amount. No figure and no comparison — those belong to the rule that computed them.
 */
export const MARGIN_NOT_A_SHARE_REASON =
  "a margin is the share of revenue kept as profit, and this quarter's profit did not come from revenue alone";

const MARGIN_OUT_OF_RANGE = PROFIT_EXCEEDS_REVENUE_REASON;

export const FAMILY_MANIFEST = {
  // ── NON-FINANCIAL · 12 metrics ────────────────────────────────────────────────────────────────
  non_financial: [
    { key: "revenue", source: "quarterly_results.revenue", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "context",
      driverNote: "Revenue clears half the profit move in 90.3% of quarters. Naming it as the driver would put the same word on nine cards in ten, so it is always reported and never named." },
    { key: "otherIncome", source: "quarterly_results.other_income", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible" },
    { key: "expenses", source: "quarterly_results.expenses", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "context",
      note: "★ MEASURED: `expenses` SUBSUMES depreciation and interest. `PBT = revenue + other_income − expenses` closes exactly on 72% of FY26+ rows and within 1% on 85%; the same identity with depreciation and interest subtracted again closes on ZERO rows (median residual ₹94 crore). Do not add them to it." },
    { key: "depreciation", source: "quarterly_results.depreciation", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible",
      note: "A COMPONENT of `expenses`, reported separately. Wins the driver slot on 17% of qualifying quarters once the residual bucket is excluded — and on only 1.2% when it is not." },
    { key: "financeCosts", source: "quarterly_results.interest", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible",
      note: "A COMPONENT of `expenses`, reported separately." },
    { key: "otherOperatingCosts", source: "derived: expenses − depreciation − interest", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "context",
      driverNote: "★ THE RESIDUAL BUCKET. It is the largest non-revenue mover on 84.4% of quarters, and it is arithmetic leftovers rather than a thing that happened. Reported so the costs add up; never named as the driver, because 'day-to-day running costs moved' is not an explanation." },
    { key: "operatingProfit", source: "quarterly_results.operating_profit", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "⚠⚠ C15 — PERMANENTLY EXCLUDED FROM EVERY BRIDGE. It closes NO identity: `revenue − expenses` 4%, `revenue − expenses + dep + int` 1%, `OP + other_income − dep − int = PBT` 1%. Its definition is undocumented and does not reconcile to the lines beside it. It stays because margins.ts uses it as the operating-margin numerator and because it is a filed figure the reader can check against the statement — but it may never enter a decomposition. This note exists because a derived column that LOOKS like it should close an identity and does not is exactly the trap someone rebuilds in six months." },
    { key: "profitBeforeTax", source: "quarterly_results.profit_before_tax", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible", note: "A subtotal on the way to net profit, not a driver of it." },
    { key: "tax", source: "quarterly_results.tax", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible" },
    { key: "netProfit", source: "quarterly_results.net_profit", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible", note: "The bridge's TARGET. It cannot drive itself." },
    { key: "operatingMargin", source: "quarterly_results.operating_margin", scale: "percent",
      bounds: { min: -100, max: 100 }, outOfRangeReason: MARGIN_OUT_OF_RANGE,
      steadyBand: 1.4, steadyBandBasis: "p25 of |YoY Δ| = 1.3824pp, n=3656", driver: "ineligible" },
    { key: "netMargin", source: "quarterly_results.net_margin", scale: "percent",
      bounds: { min: -100, max: 100 }, outOfRangeReason: MARGIN_OUT_OF_RANGE,
      steadyBand: 0.9, steadyBandBasis: "p25 of |YoY Δ| = 0.9454pp, n=3645", driver: "ineligible" },
  ],

  // ── BANKING · 23 metrics ──────────────────────────────────────────────────────────────────────
  banking: [
    { key: "interestEarned", source: "banking_quarterly_results.interest_earned", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "context", note: "A component of net interest income." },
    { key: "interestExpended", source: "banking_quarterly_results.interest_expended", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "context", note: "A component of net interest income." },
    { key: "netInterestIncome", source: "banking_quarterly_results.nii", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "context",
      driverNote: "The family's top line — banking's equivalent of revenue, and treated the same way: always reported, never named as the driver. It clears half the profit move on 54% of quarters.",
      note: "MEASURED: nii = interest_earned − interest_expended, exactly, on 231/231 FY26+ rows." },
    { key: "otherIncome", source: "banking_quarterly_results.other_income", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible",
      note: "Wins the driver slot on 43.4% of qualifying banking quarters — the most common named driver in this family." },
    { key: "totalIncome", source: "banking_quarterly_results.total_income", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "A subtotal. MEASURED: total_income = interest_earned + other_income, exactly, on 231/231 rows." },
    { key: "staffCost", source: "banking_quarterly_results.employees_cost", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "context",
      note: "A COMPONENT of running costs, already inside them. MEASURED: operating_expenses ≥ employees_cost on 230/231 rows, median ratio 2.05. Never add the two together." },
    { key: "operatingExpenses", source: "derived: expenditure_excl_provisions − interest_expended", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible",
      note: "⚠ C19 — DERIVED BY SUBTRACTION, DELIBERATELY. `employees_cost + operating_expenses` is the wrong form and closed 0 of 231 rows with a ₹1,905 crore median residual, because operating_expenses already contains employees_cost. The subtraction form is measured identical to the stored `operating_expenses` column on 231/231 rows, and it is used instead because it is the term the bridge actually needs: PPOP = total_income − (interest_expended + operating_expenses)." },
    { key: "provisions", source: "banking_quarterly_results.provisions", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible", note: "Wins the driver slot on 25.6% of qualifying banking quarters." },
    { key: "exceptionalItems", source: "banking_quarterly_results.exceptional_items", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible",
      note: "Zero on nearly every row — `PBT = PPOP − provisions` and `PBT = PPOP − provisions − exceptional` both close on 96%. Eligible so that the rare quarter where it fires can be named." },
    { key: "preProvisionOperatingProfit", source: "banking_quarterly_results.ppop", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "A subtotal. MEASURED: ppop = total_income − expenditure_excl_provisions, exactly, on 231/231 rows." },
    { key: "profitBeforeTax", source: "banking_quarterly_results.profit_before_tax", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "tax", source: "banking_quarterly_results.tax", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible" },
    { key: "netProfit", source: "banking_quarterly_results.net_profit", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "The bridge's TARGET. `profit_after_tax` is a duplicate column — measured identical on 231/231 rows — and is deliberately not in this manifest." },
    { key: "grossNpaAmount", source: "banking_quarterly_results.gnpa_absolute", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible", lowerIsBetter: true },
    { key: "netNpaAmount", source: "banking_quarterly_results.nnpa_absolute", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible", lowerIsBetter: true },
    { key: "grossNpaRatio", source: "banking_quarterly_results.gnpa_pct", scale: "fraction",
      bounds: { min: 0, max: 100 }, outOfRangeReason: "the reported bad-loan share is outside the range a loan book can take",
      steadyBand: 0.25, steadyBandBasis: "p25 of |YoY Δ| = 0.25pp, n=87", driver: "ineligible", lowerIsBetter: true,
      note: "⚠ FRACTION-SCALE on a table whose net_margin is a percent. Stored 0.0183 means 1.83%. Universe max is 0.0502." },
    { key: "netNpaRatio", source: "banking_quarterly_results.nnpa_pct", scale: "fraction",
      bounds: { min: 0, max: 100 }, outOfRangeReason: "the reported uncovered bad-loan share is outside the range a loan book can take",
      steadyBand: 0.04, steadyBandBasis: "p25 of |YoY Δ| = 0.04pp, n=87", driver: "ineligible", lowerIsBetter: true,
      note: "⚠ FRACTION-SCALE. Moves very slowly — p25 is four hundredths of a point." },
    { key: "provisionCoverageRatio", source: "banking_quarterly_results.pcr", scale: "fraction",
      bounds: { min: 0, max: 200 }, outOfRangeReason: "the reported cover is outside the range this ratio can meaningfully take",
      steadyBand: 0.7, steadyBandBasis: "p25 of |YoY Δ| = 0.677pp, n=75", driver: "ineligible",
      note: "⚠ FRACTION-SCALE, and DEGENERATE WHEN THERE ARE NO BAD LOANS: pcr = 1 − (NNPA/GNPA) is undefined at GNPA = 0, and the universe minimum for gnpa_pct is exactly 0. Upper bound is 200 rather than 100 because technical write-offs can carry cover above the book." },
    { key: "cet1Ratio", source: "banking_quarterly_results.cet1_ratio", scale: "fraction",
      bounds: { min: 0, max: 100 }, outOfRangeReason: "the reported core-capital share is outside the range a capital ratio can take",
      steadyBand: 0.33, steadyBandBasis: "p25 of |YoY Δ| = 0.33pp, n=87", driver: "ineligible",
      note: "⚠ FRACTION-SCALE. Universe minimum is 0 — a stored zero means not disclosed this quarter, not a bank with no capital, and the lower bound suppresses it. ⚠⚠ `tier1_ratio` and `additional_tier1_ratio` ARE DELIBERATELY ABSENT FROM THIS MANIFEST, and not for tidiness: tier1 is a DERIVED column (cet1 + at1) built on a mis-parsed input. AXISBANK FY27Q1 stores cet1 14.64%, at1 15.35%, tier1 29.99% — a real additional-tier-1 sliver is one to two points, not fifteen. Measured on FY26+ banking rows: the MEDIAN tier1-minus-cet1 gap is 0.00pp, so on most rows tier1 carries no information cet1 does not, while 18 of 229 rows show a gap above 3pp and 21 exceed a 25% tier-1 ratio, topping out at CUB’s 42.7%. A derived figure that is either redundant or wrong is not a metric, and core capital is the one a reader needs. ⚠ BACKLOG — this fix belongs in the XBRL parser against the filed source (PB-2, xbrl/parser-backlog.ts). No single-metric bound can catch this — 29.99% is a perfectly plausible NUMBER and is only implausible BESIDE its own cet1." },
    { key: "returnOnAssetsQuarterly", source: "banking_quarterly_results.roa_quarterly", scale: "fraction",
      bounds: { min: -100, max: 100 }, outOfRangeReason: "the reported return is outside the range this ratio can meaningfully take",
      steadyBand: 0.03, steadyBandBasis: "p25 of |YoY Δ| = 0.03pp, n=87", driver: "ineligible",
      note: "⚠ FRACTION-SCALE, and a QUARTERLY rate — it must never be compared with an annual return without saying so. The gloss carries that." },
    { key: "costToIncomeRatio", source: "banking_quarterly_results.cost_to_income_ratio", scale: "fraction",
      bounds: { min: 0, max: 400 }, outOfRangeReason: "the reported cost share is outside the range this ratio can meaningfully take",
      steadyBand: 0.9, steadyBandBasis: "p25 of |YoY Δ| = 0.9348pp, n=299", driver: "ineligible", lowerIsBetter: true,
      note: "⚠⚠ FRACTION-SCALE **and** LEGITIMATELY ABOVE 100. Universe max is 1.043277 — a bank whose costs exceeded its income for the quarter. The ±100 bound that is correct for a margin would suppress exactly the quarters worth reading here, which is why the bound is per metric." },
    { key: "netMargin", source: "banking_quarterly_results.net_margin", scale: "percent",
      bounds: { min: -100, max: 100 }, outOfRangeReason: MARGIN_OUT_OF_RANGE,
      steadyBand: 1.0, steadyBandBasis: "p25 of |YoY Δ| = 0.9567pp, n=299", driver: "ineligible",
      note: "⚠ PERCENT-scale on the same row as five fraction-scale ratios above. This is the seam." },
  ],

  // ── NBFC · 17 metrics ─────────────────────────────────────────────────────────────────────────
  nbfc: [
    { key: "revenue", source: "nbfc_quarterly_results.revenue", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "context" },
    { key: "interestIncome", source: "nbfc_quarterly_results.interest_income", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "⚠ C17 — a SUB-COMPONENT. `revenue = interest_income + fees + fair-value gains` closes on only 11% of rows, so the components do not add up to the whole and cannot carry a share-of-move figure." },
    { key: "feeAndCommissionIncome", source: "nbfc_quarterly_results.fee_and_commission_income", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible", note: "⚠ C17 — sub-component; see interestIncome." },
    { key: "netGainOnFairValueChanges", source: "nbfc_quarterly_results.net_gain_on_fair_value_changes", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible", note: "⚠ C17 — sub-component; see interestIncome." },
    { key: "otherIncome", source: "nbfc_quarterly_results.other_income", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible" },
    { key: "totalIncome", source: "nbfc_quarterly_results.total_income", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "context",
      note: "MEASURED: total_income = revenue + other_income, exactly, on 335/335 FY26+ rows." },
    { key: "netInterestIncome", source: "nbfc_quarterly_results.nii", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "MEASURED: nii = interest_income − finance_costs, exactly, on 335/335 rows. Ineligible because both its inputs are." },
    { key: "financeCosts", source: "nbfc_quarterly_results.finance_costs", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible", note: "⚠ C17 — a component of total costs; the expense decomposition closes on only 70% of rows." },
    { key: "impairmentOnFinancialInstruments", source: "nbfc_quarterly_results.impairment_on_financial_instruments", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "⚠ C17 — the metric a reader would most want named as a driver, and the decomposition does not support it (70%). Enabling it needs its own per-row gate: emit only when `finance_costs + impairment + staff + depreciation + other_expenses = total_expenses` closes on BOTH periods. Not built in this stage." },
    { key: "staffCost", source: "nbfc_quarterly_results.employee_benefit_expense", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible", note: "⚠ C17 — component; see impairmentOnFinancialInstruments." },
    { key: "depreciation", source: "nbfc_quarterly_results.depreciation", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible", note: "⚠ C17 — component; see impairmentOnFinancialInstruments." },
    { key: "otherExpenses", source: "nbfc_quarterly_results.other_expenses", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible", note: "⚠ C17 — component; see impairmentOnFinancialInstruments." },
    { key: "totalExpenses", source: "nbfc_quarterly_results.total_expenses", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible",
      driverNote: "⚠ C17 — THE ONLY ELIGIBLE COST LINE FOR THIS FAMILY, and deliberately the aggregate. `PBT = total_income − total_expenses` closes within 1% on 96% of rows and 87.6% of year-on-year pairs; the decomposition beneath it closes on 70%. So the honest driver sentence names total costs, not what made them up." },
    { key: "profitBeforeTax", source: "nbfc_quarterly_results.profit_before_tax", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "tax", source: "nbfc_quarterly_results.tax", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible" },
    { key: "netProfit", source: "nbfc_quarterly_results.net_profit", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible", note: "The bridge's TARGET." },
    { key: "netMargin", source: "nbfc_quarterly_results.net_margin", scale: "percent",
      bounds: { min: -100, max: 100 }, outOfRangeReason: MARGIN_OUT_OF_RANGE,
      steadyBand: 0.9, steadyBandBasis: "p25 of |YoY Δ| = 0.9128pp, n=378", driver: "ineligible" },
  ],

  // ── LIFE INSURANCE · 24 metrics ───────────────────────────────────────────────────────────────
  // ⚠⚠ NO DRIVER BULLET FOR THIS FAMILY, AND IT IS STRUCTURAL — see `tax` below. Every entry is
  // context or ineligible; there is no `eligible` metric in this manifest, deliberately.
  life_insurance: [
    { key: "grossPremiumIncome", source: "life_insurance_quarterly_results.gross_premium_income", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "MEASURED: gross = first-year + renewal + single, exactly, on 34/34 FY26+ rows." },
    { key: "netPremiumIncome", source: "life_insurance_quarterly_results.net_premium_income", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "context",
      note: "The family's top line. MEASURED: net = gross − reinsurance ceded, exactly, on 34/34 rows." },
    { key: "incomeFirstYearPremium", source: "life_insurance_quarterly_results.income_first_year_premium", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "incomeRenewalPremium", source: "life_insurance_quarterly_results.income_renewal_premium", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "incomeSinglePremium", source: "life_insurance_quarterly_results.income_single_premium", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "reinsuranceCeded", source: "life_insurance_quarterly_results.reinsurance_ceded", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "incomeFromInvestments", source: "life_insurance_quarterly_results.income_from_investments", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "totalRevenuePolicyholders", source: "life_insurance_quarterly_results.total_revenue_policyholders", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "Does NOT equal net premium + investment income (closes on 0% exact, 47% within 1%) — the policyholder account carries revenue lines this table does not break out." },
    { key: "totalCommission", source: "life_insurance_quarterly_results.total_commission", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "insuranceRunningCosts", source: "life_insurance_quarterly_results.total_operating_expenses", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "benefitsPaidNet", source: "life_insurance_quarterly_results.benefits_paid_net", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "changeInValuationOfLiabilities", source: "life_insurance_quarterly_results.change_in_valuation_of_liabilities", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "profitBeforeTax", source: "life_insurance_quarterly_results.profit_before_tax", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "tax", source: "life_insurance_quarterly_results.tax", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "⚠⚠ C17 — THE REASON THIS FAMILY HAS NO DRIVER BULLET. DO NOT RETRY IT. `net_profit = profit_before_tax − tax` closes on 6% of rows exact and 65% within 1%. Worked example, LICI FY26Q4: PBT ₹23,403.28 cr, tax ₹−9,088.86 cr, net profit ₹23,420.43 cr — net profit is ESSENTIALLY EQUAL TO PBT and the residual equals |tax|. Policyholder tax is booked inside the revenue account, so `tax` on this table is not the deduction that produces `net_profit`. The shareholders'-account lines that would close it (transfer from policyholders, shareholders' investment income, shareholders' expenses) exist only on the ANNUAL table. This is broken by design, not by data quality, and no tolerance fixes it." },
    { key: "netProfit", source: "life_insurance_quarterly_results.net_profit", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "solvencyRatio", source: "life_insurance_quarterly_results.solvency_ratio", scale: "multiple",
      bounds: { min: 1, max: 10 }, outOfRangeReason: "the reported solvency figure is outside the range this measure takes for a licensed insurer",
      steadyBand: 0.07, steadyBandBasis: "p25 of |YoY Δ| = 0.07x, n=13 — SMALL SAMPLE, four issuers", driver: "ineligible",
      note: "⚠ A MULTIPLE, NOT A PERCENTAGE. Universe range 1.75–2.42. Rendering 2.12 as '2.12%' is the combined-ratio failure in a different unit — and the band is an absolute move in times-over, not percentage points." },
    { key: "persistencyRatio13Month", source: "life_insurance_quarterly_results.persistency_ratio_13_month", scale: "fraction",
      bounds: { min: 20, max: 100 }, outOfRangeReason: "the reported persistency figure is not a plausible share of policies and has been withheld",
      steadyBand: 0.7, steadyBandBasis: "p25 of |YoY Δ| = 0.7pp, n=13 — SMALL SAMPLE", driver: "ineligible",
      note: "⚠⚠ THIS BOUND SUPPRESSES A LIVE MIS-SCALED VALUE, IT DOES NOT ROUND IT. SBILIFE stores 0.0084–0.0088 across ALL FIVE persistency ratios in EVERY quarter on file — roughly one hundredth of its true ~85%. The distribution is bimodal with an empty gap: 5 rows below 0.10, ZERO rows between 0.10 and 0.40, 36 rows above 0.40. The same fault is in the annual table (2 of 14 rows). A cut anywhere in that empty gap is unambiguous, so 0.20 is chosen. Fixing it belongs in the XBRL parser against the filed source, not here (PB-1, xbrl/parser-backlog.ts); until then the metric is WITHHELD for that issuer and the withholding is stated in the card's gaps rather than passing silently." },
    { key: "persistencyRatio25Month", source: "life_insurance_quarterly_results.persistency_ratio_25_month", scale: "fraction",
      bounds: { min: 20, max: 100 }, outOfRangeReason: "the reported persistency figure is not a plausible share of policies and has been withheld",
      steadyBand: 2.1, steadyBandBasis: "p25 of |YoY Δ| = 2.05pp, n=13 — SMALL SAMPLE", driver: "ineligible",
      note: "⚠ Same mis-scale as the 13-month ratio; same issuer, same quarters." },
    { key: "persistencyRatio37Month", source: "life_insurance_quarterly_results.persistency_ratio_37_month", scale: "fraction",
      bounds: { min: 20, max: 100 }, outOfRangeReason: "the reported persistency figure is not a plausible share of policies and has been withheld",
      steadyBand: 1.6, steadyBandBasis: "p25 of |YoY Δ| = 1.63pp, n=13 — SMALL SAMPLE", driver: "ineligible",
      note: "⚠ Same mis-scale as the 13-month ratio." },
    { key: "persistencyRatio49Month", source: "life_insurance_quarterly_results.persistency_ratio_49_month", scale: "fraction",
      bounds: { min: 20, max: 100 }, outOfRangeReason: "the reported persistency figure is not a plausible share of policies and has been withheld",
      steadyBand: 0.5, steadyBandBasis: "p25 of |YoY Δ| = 0.54pp, n=13 — SMALL SAMPLE", driver: "ineligible",
      note: "⚠ Same mis-scale as the 13-month ratio." },
    { key: "persistencyRatio61Month", source: "life_insurance_quarterly_results.persistency_ratio_61_month", scale: "fraction",
      bounds: { min: 20, max: 100 }, outOfRangeReason: "the reported persistency figure is not a plausible share of policies and has been withheld",
      steadyBand: 0.7, steadyBandBasis: "p25 of |YoY Δ| = 0.65pp, n=13 — SMALL SAMPLE", driver: "ineligible",
      note: "⚠ Same mis-scale as the 13-month ratio." },
    { key: "newBusinessPremiumPct", source: "life_insurance_quarterly_results.new_business_premium_pct", scale: "fraction",
      bounds: { min: 0, max: 100 }, outOfRangeReason: "the reported share is outside the range this ratio can take",
      steadyBand: 0.9, steadyBandBasis: "p25 of |YoY Δ| = 0.926pp, n=13 — SMALL SAMPLE", driver: "ineligible",
      note: "⚠ FRACTION-SCALE. Universe range 0.063–0.260." },
    { key: "expenseRatioPolicyholders", source: "life_insurance_quarterly_results.expense_ratio_policyholders", scale: "fraction",
      bounds: { min: 0, max: 100 }, outOfRangeReason: "the reported cost share is outside the range this ratio can take",
      steadyBand: 0.4, steadyBandBasis: "p25 of |YoY Δ| = 0.3527pp, n=13 — SMALL SAMPLE", driver: "ineligible", lowerIsBetter: true,
      note: "⚠ FRACTION-SCALE. Universe range 0.052–0.121." },
    { key: "netMargin", source: "life_insurance_quarterly_results.net_margin", scale: "percent",
      bounds: { min: -100, max: 100 }, outOfRangeReason: MARGIN_OUT_OF_RANGE,
      steadyBand: 0.2, steadyBandBasis: "p25 of |YoY Δ| = 0.167pp, n=13 — SMALL SAMPLE", driver: "ineligible",
      note: "The tightest net-margin band of the five families, by a factor of five. Life margins are thin (universe p50 2.46%) and move very little, so the band that reads as 'steady' for a bank would call almost every life quarter unchanged." },
  ],

  // ── GENERAL INSURANCE · 20 metrics ────────────────────────────────────────────────────────────
  // ⚠ C17 — the driver bullet is scoped to the UNDERWRITING RESULT and may NEVER reach net profit.
  general_insurance: [
    { key: "grossPremiumsWritten", source: "general_insurance_quarterly_results.gross_premiums_written", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "context", note: "The family's top line." },
    { key: "netPremiumWritten", source: "general_insurance_quarterly_results.net_premium_written", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "`net_premium` is a third, near-identical premium column and is deliberately not in this manifest — three renderings of one idea is confusion, not completeness." },
    { key: "premiumEarned", source: "general_insurance_quarterly_results.premium_earned", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "context",
      note: "The base the underwriting bridge and every ratio are measured against — always reported, never named as the driver." },
    { key: "incomeFromInvestments", source: "general_insurance_quarterly_results.income_from_investments", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "⚠ OUTSIDE THE UNDERWRITING BRIDGE. `PBT = underwriting result + investment income + other income` closes on ZERO rows, with a consistently NEGATIVE residual (−302, −611, −947, −816 across ICICIGI/NIACL/GICRE) — a shareholders' outgo line that exists only on the annual table. Reported as a figure; never used in a decomposition." },
    { key: "otherIncome", source: "general_insurance_quarterly_results.other_income", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible", note: "⚠ Outside the underwriting bridge; see incomeFromInvestments." },
    { key: "totalIncome", source: "general_insurance_quarterly_results.total_revenue", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "MEASURED: total revenue = premium earned + investment income + other income, exactly, on 25/25 FY26+ rows." },
    { key: "claimsPaid", source: "general_insurance_quarterly_results.claims_paid", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "Cash paid out, NOT the charge for the quarter. `incurredClaims` is the bridge term." },
    { key: "incurredClaims", source: "general_insurance_quarterly_results.incurred_claims", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible", driverNote: "Underwriting bridge only." },
    { key: "netCommission", source: "general_insurance_quarterly_results.net_commission", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible", driverNote: "Underwriting bridge only." },
    { key: "insuranceRunningCosts", source: "general_insurance_quarterly_results.total_operating_expenses_related_to_insurance", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "eligible", driverNote: "Underwriting bridge only." },
    { key: "underwritingProfitOrLoss", source: "general_insurance_quarterly_results.underwriting_profit_or_loss", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "★ THE TARGET of this family's only bridge. MEASURED: underwriting result = premium earned − incurred claims − commission − running costs, closing within 1% on 100% of rows and on 8/8 year-on-year pairs. NEGATIVE on 31 of 31 quarters in the universe — that is a real fact about Indian general insurance, not a data problem, and the gloss states it." },
    { key: "profitBeforeTax", source: "general_insurance_quarterly_results.profit_before_tax", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible", note: "⚠ NOT REACHABLE from the underwriting bridge; see incomeFromInvestments." },
    { key: "tax", source: "general_insurance_quarterly_results.tax", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible",
      note: "`net profit = PBT − tax` closes on 25/25 rows, but PBT itself is not reachable from the quarterly lines, so tax cannot be named as a driver of anything this card can decompose." },
    { key: "netProfit", source: "general_insurance_quarterly_results.net_profit", scale: "money", bounds: null, outOfRangeReason: null,
      steadyBand: null, steadyBandBasis: null, driver: "ineligible" },
    { key: "combinedRatio", source: "general_insurance_quarterly_results.combined_ratio", scale: "fraction",
      bounds: { min: 0, max: 400 }, outOfRangeReason: "the reported combined ratio is outside the range this measure can meaningfully take",
      steadyBand: 0.9, steadyBandBasis: "p25 of |YoY Δ| = 0.85pp, n=8 — SMALL SAMPLE, four issuers", driver: "ineligible", lowerIsBetter: true,
      note: "⚠⚠ THE ORIGINAL SCALE BUG. FRACTION-scale (1.2144) on the same row as a PERCENT-scale net_margin. Unconverted it renders 121.44% as '1.2%' — an insurer paying out ₹121 per ₹100 of premium reads as almost costless. Bound is 400, not 100: above 100 is the normal, meaningful case for this metric and suppressing it would keep only the flattering readings. Universe: 31/31 rows fraction-scale, range 0.9919–1.3977." },
    { key: "incurredClaimRatio", source: "general_insurance_quarterly_results.incurred_claim_ratio", scale: "fraction",
      bounds: { min: 0, max: 400 }, outOfRangeReason: "the reported claims share is outside the range this measure can meaningfully take",
      steadyBand: 0.8, steadyBandBasis: "p25 of |YoY Δ| = 0.8pp, n=8 — SMALL SAMPLE", driver: "ineligible", lowerIsBetter: true,
      note: "⚠ FRACTION-SCALE, and can legitimately exceed 100 in a bad claims quarter. Universe range 0.6855–1.0866." },
    { key: "expensesOfManagementRatio", source: "general_insurance_quarterly_results.expenses_of_management_ratio", scale: "fraction",
      bounds: { min: 0, max: 200 }, outOfRangeReason: "the reported cost share is outside the range this measure can meaningfully take",
      steadyBand: 0.3, steadyBandBasis: "p25 of |YoY Δ| = 0.28pp, n=8 — SMALL SAMPLE", driver: "ineligible", lowerIsBetter: true,
      note: "⚠ FRACTION-SCALE. Universe range 0.0062–0.3545." },
    { key: "netRetentionRatio", source: "general_insurance_quarterly_results.net_retention_ratio", scale: "fraction",
      bounds: { min: 0, max: 100 }, outOfRangeReason: "the reported retention share is outside the range this measure can take",
      steadyBand: 0.6, steadyBandBasis: "p25 of |YoY Δ| = 0.57pp, n=8 — SMALL SAMPLE", driver: "ineligible",
      note: "⚠ FRACTION-SCALE. Deliberately NOT lowerIsBetter — neither direction is favourable, it is a choice about risk appetite, and the gloss says so." },
    { key: "solvencyRatio", source: "general_insurance_quarterly_results.solvency_ratio", scale: "multiple",
      bounds: { min: 1, max: 10 }, outOfRangeReason: "the reported solvency figure is outside the range this measure takes for a licensed insurer",
      steadyBand: 0.02, steadyBandBasis: "p25 of |YoY Δ| = 0.02x, n=8 — SMALL SAMPLE", driver: "ineligible",
      note: "⚠ A MULTIPLE. Universe range 1.79–4.21. The band is two hundredths of a time-over: a 0.5pp floor would call 75% of readings unchanged." },
    { key: "netMargin", source: "general_insurance_quarterly_results.net_margin", scale: "percent",
      bounds: { min: -100, max: 100 }, outOfRangeReason: MARGIN_OUT_OF_RANGE,
      steadyBand: 0.5, steadyBandBasis: "p25 of |YoY Δ| = 0.4515pp, n=8 — SMALL SAMPLE", driver: "ineligible",
      note: "⚠ PERCENT-scale beside five fraction-scale ratios and a multiple. `net_underwriting_margin` is deliberately NOT in this manifest: measured, it equals 1 − combined_ratio EXACTLY on 31/31 rows, so it is the same fact in a second unit and reporting both is saying one thing twice." },
  ],
} as const satisfies Record<Family, readonly MetricSpec[]>;

/** The metric keys THIS family reports. Per-family and literal — `MetricKeyOf<"banking">` includes
 *  `grossNpaRatio`; `MetricKeyOf<"life_insurance">` does not, and referencing it is a compile error. */
export type MetricKeyOf<F extends Family> = (typeof FAMILY_MANIFEST)[F][number]["key"];

/**
 * ONE quarter of ONE family, carrying EVERY metric that family's manifest declares.
 *
 * ★ `values` IS A Record, NOT A Partial, AND THAT IS THE WHOLE POINT. A fetcher that omits a manifest
 * metric does not compile; adding a metric to a manifest breaks the build until the fetcher supplies
 * it. The fifteen-slot QRow this replaces could silently discard twenty metrics because nothing in the
 * type system knew they existed.
 */
export interface FamilyQuarter<F extends Family> {
  family: F;
  periodKey: string;
  quarter: string;
  fiscalYear: string;
  resultType: Basis;
  reportDate: Date;
  filingDate: Date;
  /** Banking only; false elsewhere. Gates asset-quality and capital figures — see the gaps copy. */
  auditPending: boolean;
  /** Stored values in their NATIVE scale. Conversion happens at render, per `spec.scale`. */
  values: Record<MetricKeyOf<F>, number | null>;
}

/**
 * A quarter of ANY family — a DISCRIMINATED UNION on `family`, never `FamilyQuarter<Family>`.
 *
 * ⚠ THAT DISTINCTION IS LOAD-BEARING AND THE COMPILER FOUND IT. `FamilyQuarter<Family>` distributes
 * `Record<MetricKeyOf<Family>, …>` into a record over the UNION of all sixty-seven keys — i.e. it
 * demands every family supply every other family's metrics. A union of the five concrete types is what
 * "one of these five shapes" actually means, and it lets a consumer `switch (q.family)` and get that
 * family's exact key set. Do not "simplify" this back to the generic form.
 */
export type AnyFamilyQuarter =
  | FamilyQuarter<"non_financial">
  | FamilyQuarter<"banking">
  | FamilyQuarter<"nbfc">
  | FamilyQuarter<"life_insurance">
  | FamilyQuarter<"general_insurance">;

/** Read one metric off a quarter of unknown family. Returns null when that family does not report it —
 *  which is an honest absence, not a zero. The narrow per-family types are for code that KNOWS the
 *  family; this is for the manifest-driven loops that walk whatever the family declares. */
export const valueOf = (q: AnyFamilyQuarter, key: MetricKey): number | null =>
  (q.values as Record<string, number | null>)[key] ?? null;

/** The family's top line, by metric key — the figure the headline leads with.
 *
 *  ⚠ IT MUST MATCH WHAT THE RESULTS FEED PRINTS BESIDE IT. A brief that called a bank's net interest
 *  income "revenue" would contradict the card it sits on. And it lives HERE, not beside the fetchers,
 *  because family-rows.ts imports the DB client and the build gate that asserts C18 against this map
 *  must stay pure — see the note at the top of family-rows.ts. */
export const TOP_LINE_KEY = {
  non_financial: "revenue",
  banking: "netInterestIncome",
  nbfc: "revenue",
  life_insurance: "netPremiumIncome",
  general_insurance: "grossPremiumsWritten",
} as const satisfies Record<Family, MetricKey>;

/** The manifest for `family`, typed so `.key` narrows to that family's metric union. */
export const manifestFor = <F extends Family>(family: F): readonly MetricSpec[] =>
  FAMILY_MANIFEST[family] as readonly MetricSpec[];

/** Lookup within a family. Returns undefined for a metric that family does not report. */
export const specFor = (family: Family, key: MetricKey): MetricSpec | undefined =>
  manifestFor(family).find((m) => m.key === key);

/** The metrics this family may name as a driver. Empty for life_insurance, by design. */
export const driverEligible = (family: Family): readonly MetricSpec[] =>
  manifestFor(family).filter((m) => m.driver === "eligible");

/** THE display conversion. The ONE place a stored number becomes the number the reader sees.
 *  Money is returned unchanged (format.ts `money` renders ₹ crore); everything else is normalised
 *  into the unit its bounds and steady-band are expressed in. */
export function toDisplayValue(spec: MetricSpec, stored: number): number {
  return spec.scale === "fraction" ? stored * 100 : stored;
}

/** Is this figure inside the range where it means what its gloss says it means?
 *  ⚠ This is a MEANING check, not an arithmetic one. Every value it rejects divided correctly. */
export function withinBounds(spec: MetricSpec, stored: number): boolean {
  if (!spec.bounds) return true;
  const v = toDisplayValue(spec, stored);
  if (spec.bounds.min !== null && v < spec.bounds.min) return false;
  if (spec.bounds.max !== null && v > spec.bounds.max) return false;
  return true;
}

/** Did this metric move enough to be worth calling a change?
 *  Money lines use the verdict's own MONEY_STEADY_PCT so the card cannot contradict its own badge;
 *  everything else uses the per-metric band above. Returns null when there is nothing to compare. */
export function isSteady(spec: MetricSpec, current: number | null, prior: number | null): boolean | null {
  if (current === null || prior === null) return null;
  if (spec.scale === "money") {
    if (prior === 0) return null;
    return Math.abs(((current - prior) / prior) * 100) < MONEY_STEADY_PCT;
  }
  if (spec.steadyBand === null) return null;
  return Math.abs(toDisplayValue(spec, current) - toDisplayValue(spec, prior)) < spec.steadyBand;
}
