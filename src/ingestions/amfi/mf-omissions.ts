// ─────────────────────────────────────────────────────────────
// THE HONEST-EMPTY LEDGER — reason CODES, not prose.
//
// Every NULL metric in mf_analytics carries an entry here saying WHY. A NULL with no reason is
// an unexplained gap, and an unexplained gap is indistinguishable from a bug.
//
// WHY CODES AND NOT SENTENCES: the first build stored the full human sentence per metric per
// scheme — "insufficient_history: 412 NAV points from 2024-01-05; this horizon needs coverage
// from 2021-07-12". Correct, but it wrote the SAME sentence thousands of times and pushed the
// table to 15.1 MB, against a Gate-1 promise of single-digit MB and only 80 MB of free-tier
// headroom. Every number those sentences quoted is ALREADY a column on the row (nav_points,
// window_from, as_of_date, rank_bucket_size), so the prose was pure duplication.
//
// So: store the code, compose the sentence at READ time from the code + the row's own columns.
// Same information, none of the repetition — and the reasons become a closed, greppable set
// instead of free text that drifts.
// ─────────────────────────────────────────────────────────────

export const OmissionCode = {
  /** The fund is younger than the horizon (or has too few points in it). NOT an error. */
  INSUFFICIENT_HISTORY: "insufficient_history",
  /** The fund's last NAV predates the whole 5-year fold window — dead long before it. */
  NO_NAV_IN_WINDOW: "no_nav_in_window",
  /** We hold no risk-free series reaching back that far. Gate (ii) of Sharpe/Sortino. */
  RISK_FREE_TOO_SHORT: "risk_free_too_short",
  /** No G-Sec / 1D-Rate series in index_prices at all. */
  RISK_FREE_ABSENT: "risk_free_absent",
  /** Return dispersion ≈ 0 (overnight/liquid funds) → a risk-ADJUSTED return has no meaning. */
  ZERO_DISPERSION: "zero_dispersion",
  /** The computed value could not fit its column — absurd source data, refused rather than rounded. */
  OUT_OF_RANGE: "out_of_range",

  // ── RETIRED: NO_EARLIEST_ANCHOR ("no_earliest_anchor") and SPAN_TOO_SHORT
  //    ("span_too_short_to_annualise"). Both explained a missing `ret_since_earliest_cagr`, and that
  //    metric is GONE — not because it was hard to populate, but because AMFI's raw NAV cannot
  //    support it honestly. The since-earliest span is the WORST case for the two corruptions Step 19
  //    exists to handle: the further back the anchor, the more unit splits and IDCW payouts sit
  //    between it and today, and unlike the 1Y/3Y/5Y windows there is no bounded slice of history we
  //    can reconstruct from a real corporate action. A number we cannot compute honestly should not
  //    have a reason code explaining why it is missing — it should not be a column.

  // ── STEP 19: AMFI's NAV IS RAW — neither split-adjusted nor total-return. ──
  /**
   * The computed value is OUTSIDE THE PHYSICALLY POSSIBLE RANGE for this kind of fund, so it is
   * withheld. See mf-implausible.ts.
   *
   * ⚠️  THIS CODE SAYS ONLY WHAT WE ACTUALLY KNOW, AND ITS NAME IS THE POINT.
   *
   *     There was very nearly a `split_unadjustable_no_source` here instead — "a split happened that
   *     we could not source". It was RETIRED before it ever shipped, because it NAMES AN INFERRED
   *     CAUSE. We cannot source the cause; that is the entire problem. Claiming one in the reason
   *     string would smuggle back in exactly the inference this design forbids — and it would be a
   *     lie in the one place a user goes to find out why a number is missing.
   *
   *     A -99% drawdown on a LIQUID fund is something we can OBSERVE. Why it is there — a unit split,
   *     a wind-up, a data error at the AMC — we genuinely do not know, and no source will tell us.
   *     So the ledger says: withheld, implausible. Full stop.
   *
   *     It only ever WITHHOLDS. It never derives a ratio, never adjusts a series, never produces a
   *     "corrected" number. Every correction in Step 19 comes from a real, dated NSE corporate action.
   */
  WITHHELD_IMPLAUSIBLE: "withheld_implausible",
  /**
   * This is an IDCW / payout plan, so its NAV is a PRICE series, not a TOTAL-RETURN one: the NAV
   * FALLS by the distribution on every payout. A return computed from it understates the fund by
   * exactly what it paid out — measured across the book, a mean 3.9pp and up to 19.3pp on ret_3y.
   *
   * Where the same fund publishes a Growth plan in the same PLAN TIER (Direct↔Direct,
   * Regular↔Regular), that sibling's NAV *is* total return for the identical portfolio, and this
   * plan inherits its figures. Where it does not — an IDCW-only fund — there is nothing honest to
   * compute: no distribution history is sourceable, so the metric is declined with this reason.
   */
  IDCW_NAV_NOT_TOTAL_RETURN: "idcw_nav_not_total_return",
  // ── GROUP-3 / BENCHMARK reasons (Step 18) ──
  /** The fund's real benchmark is a CRISIL CREDIT index. NSE does not publish it, so we do not have
   *  it — and the G-Sec index we DO have would report the fund's credit spread as alpha. */
  CREDIT_BENCHMARK_UNAVAILABLE: "credit_benchmark_unavailable",
  /** A fund-of-funds' benchmark is its UNDERLYING's. We hold no such mapping. */
  FOF_NO_DIRECT_BENCHMARK: "fund_of_funds_no_direct_benchmark",
  /** Overseas indices are not in index_prices at all. */
  OVERSEAS_INDEX_UNAVAILABLE: "overseas_index_not_available",
  /** A commodity fund (gold/silver) is benchmarked to a metal PRICE, not to any equity index. */
  COMMODITY_NO_EQUITY_BENCHMARK: "commodity_no_equity_benchmark",
  /** A thematic fund whose theme has no clean, defensible index (Business Cycle, Quant, …). */
  THEMATIC_NO_CLEAN_INDEX: "thematic_no_clean_index",
  /** Goal-based / bespoke-benchmark products, and any leaf the map deliberately does not cover. */
  NO_BENCHMARK_FOR_CATEGORY: "no_benchmark_for_category",
  NO_DEFENSIBLE_BENCHMARK: "no_defensible_benchmark",
  /** Gate (ii) of TWO: the fund is old enough, but its BENCHMARK series is not. */
  BENCHMARK_TOO_SHORT: "benchmark_too_short",
  /** The benchmark is mapped and long enough, but too few fund/benchmark return PAIRS survived
   *  alignment to mean anything. */
  INSUFFICIENT_PAIRED_HISTORY: "insufficient_paired_history",
  /** The benchmark carries no market risk to be sensitive TO — an overnight/cash-rate index barely
   *  moves, so β = cov/≈0 is a division artefact, not a measurement. See MIN_BENCHMARK_VOL. */
  BENCHMARK_NO_MARKET_RISK: "benchmark_no_market_risk",
  // ── Not-ranked reasons ──
  NOT_RANKED_CLOSE_ENDED: "not_ranked_close_ended",
  NOT_RANKED_DORMANT: "not_ranked_dormant",
  NOT_RANKED_PLAN_UNKNOWN: "not_ranked_plan_unknown",
  NOT_RANKED_NO_CATEGORY: "not_ranked_no_category",
  NOT_RANKED_BUCKET_TOO_SMALL: "not_ranked_bucket_too_small",
} as const;

export type OmissionCodeValue = (typeof OmissionCode)[keyof typeof OmissionCode];

/** The row's own columns — everything the prose needs. Nothing is stored twice. */
export interface OmissionContext {
  navPoints?: number | null;
  windowFrom?: Date | string | null;
  asOfDate?: Date | string | null;
  rankBucketSize?: number | null;
  riskFreeIndex?: string | null;
  riskFreeSpanYears?: number | null;
  /** Step 18 — the benchmark this row was (or would have been) measured against. */
  benchmarkIndex?: string | null;
}

const iso = (d: Date | string | null | undefined) =>
  !d ? "?" : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);

/**
 * Render one omission code into the sentence a human should read.
 * Called at READ time (the API), never at write time.
 */
export function explainOmission(code: string, ctx: OmissionContext = {}): string {
  switch (code) {
    case OmissionCode.INSUFFICIENT_HISTORY:
      return (
        `Not enough history: this fund has ${ctx.navPoints ?? "?"} NAV observations` +
        (ctx.windowFrom ? `, starting ${iso(ctx.windowFrom)}` : "") +
        `, which does not cover this horizon. This is a data state, not an error — a young fund ` +
        `genuinely has no long-run number.`
      );
    case OmissionCode.NO_NAV_IN_WINDOW:
      return (
        `This fund's last NAV (${iso(ctx.asOfDate)}) predates the 5-year window entirely — it ` +
        `stopped pricing long before it. There is nothing to compute from.`
      );
    case OmissionCode.RISK_FREE_TOO_SHORT:
      return (
        `We hold no risk-free rate reaching back that far` +
        (ctx.riskFreeIndex ? ` ("${ctx.riskFreeIndex}"` : "") +
        (ctx.riskFreeSpanYears ? ` covers ${ctx.riskFreeSpanYears.toFixed(1)} years)` : ctx.riskFreeIndex ? ")" : "") +
        `. A Sharpe computed against a risk-free rate we do not have would be a fabricated ` +
        `number. Deepen the index backfill to fix this.`
      );
    case OmissionCode.RISK_FREE_ABSENT:
      return `No G-Sec / overnight-rate series is loaded, so a risk-adjusted return cannot be computed.`;
    case OmissionCode.ZERO_DISPERSION:
      return (
        `This fund's returns have effectively zero dispersion (typical of overnight and liquid ` +
        `funds), so a risk-adjusted return is undefined — not infinite, and not zero.`
      );
    case OmissionCode.OUT_OF_RANGE:
      return (
        `The computed value was outside the range we can honestly store. Rather than round an ` +
        `absurd number into a plausible-looking one, it is withheld.`
      );
    case OmissionCode.WITHHELD_IMPLAUSIBLE:
      return (
        `The figure we computed for this period is outside the range that is physically possible ` +
        `for this kind of fund, so we will not show it. Something in the published NAV history for ` +
        `this window does not describe the fund's actual performance — we can see that, but we ` +
        `cannot source what it was, and we will not guess. The fund's other periods are unaffected ` +
        `and are shown as normal.`
      );
    case OmissionCode.IDCW_NAV_NOT_TOTAL_RETURN:
      return (
        `This is a distributing plan (IDCW, payout, or bonus): its NAV drops every time it hands ` +
        `value back to holders, so a return measured from NAV alone understates what the fund ` +
        `actually earned. The figure would normally be taken from the same fund's Growth plan in the ` +
        `same tier, whose NAV keeps everything and therefore IS the total return. We cannot do that ` +
        `here — either the fund publishes no such Growth plan, or the one it publishes has no NAV ` +
        `history of its own, or it publishes more than one under the same name and they disagree, so ` +
        `we cannot tell which belongs to this plan. No distribution history is available to ` +
        `reconstruct the figure either, so it is withheld rather than guessed.`
      );
    // ── GROUP-3 / BENCHMARK (Step 18) ──
    case OmissionCode.CREDIT_BENCHMARK_UNAVAILABLE:
      return (
        `No benchmark: this fund is benchmarked (by its own AMC) against a CRISIL credit index, ` +
        `which NSE does not publish and we therefore do not hold. We could measure it against a ` +
        `government-bond index instead — but a credit fund's excess return over G-Secs is mostly its ` +
        `CREDIT SPREAD, the compensation it earns for taking default risk. Reporting that as "alpha" ` +
        `would dress a risk premium up as manager skill. We would rather show you nothing than that.`
      );
    case OmissionCode.FOF_NO_DIRECT_BENCHMARK:
      return (
        `No benchmark: a fund-of-funds' benchmark is whatever its UNDERLYING funds are benchmarked ` +
        `to. Measuring it against a broad index would describe those underlying funds, not this one.`
      );
    case OmissionCode.OVERSEAS_INDEX_UNAVAILABLE:
      return `No benchmark: this fund invests overseas, and we hold no overseas index series.`;
    case OmissionCode.COMMODITY_NO_EQUITY_BENCHMARK:
      return (
        `No benchmark: this fund tracks a metal price (gold / silver). No equity index is a ` +
        `meaningful benchmark for it, and we do not hold a commodity price series.`
      );
    case OmissionCode.THEMATIC_NO_CLEAN_INDEX:
      return (
        `No benchmark: this fund's theme has no clean, defensible index (business cycle, quant, ` +
        `special situations and the like). Forcing a plausible-looking index onto it would produce a ` +
        `beta and an alpha that are wrong in a way you could not see.`
      );
    case OmissionCode.NO_BENCHMARK_FOR_CATEGORY:
    case OmissionCode.NO_DEFENSIBLE_BENCHMARK:
      return `No benchmark: this category has no standard index we can honestly measure it against.`;
    case OmissionCode.BENCHMARK_TOO_SHORT:
      return (
        `The fund is old enough for this horizon, but its benchmark` +
        (ctx.benchmarkIndex ? ` ("${ctx.benchmarkIndex}")` : "") +
        ` is not — our series for it does not reach back that far. This is a gap in OUR index history, ` +
        `not in the fund's record.`
      );
    case OmissionCode.INSUFFICIENT_PAIRED_HISTORY:
      return (
        `Too few days where BOTH this fund and its benchmark` +
        (ctx.benchmarkIndex ? ` ("${ctx.benchmarkIndex}")` : "") +
        ` moved together. A beta needs paired observations; we will not pad the gaps with zeros, ` +
        `because a fabricated flat day drags a beta toward zero while looking like real data.`
      );
    case OmissionCode.BENCHMARK_NO_MARKET_RISK:
      return (
        `No beta: this fund's benchmark` +
        (ctx.benchmarkIndex ? ` ("${ctx.benchmarkIndex}")` : "") +
        ` carries essentially no market risk — it is an overnight/cash-rate index that barely moves. ` +
        `Beta is covariance ÷ the benchmark's variance, and dividing by a variance of nearly zero ` +
        `produces a number that swings wildly on noise (we measured −13 on an overnight fund before ` +
        `this guard existed). "How sensitive is this fund to an asset that carries no risk" is not a ` +
        `question with an answer. The fund's own volatility and returns are still shown.`
      );
    case OmissionCode.NOT_RANKED_CLOSE_ENDED:
      return (
        `Not ranked: this is a close-ended / interval scheme. It is not purchasable, and ranking ` +
        `it against open-ended funds would pollute their percentiles.`
      );
    case OmissionCode.NOT_RANKED_DORMANT:
      return `Not ranked: dormant (no NAV in the last 30 days). A stale return would distort a live pool.`;
    case OmissionCode.NOT_RANKED_PLAN_UNKNOWN:
      return (
        `Not ranked: this scheme's plan type (Direct / Regular) is not stated by AMFI. Direct plans ` +
        `out-return their Regular twins by the expense gap, so we will not guess which pool this ` +
        `belongs to — guessing the bucket would be as dishonest as guessing the plan.`
      );
    case OmissionCode.NOT_RANKED_NO_CATEGORY:
      return `Not ranked: no AMFI category for this scheme.`;
    case OmissionCode.NOT_RANKED_BUCKET_TOO_SMALL:
      return (
        `Not ranked: only ${ctx.rankBucketSize ?? "a handful of"} comparable funds share this ` +
        `category and plan. A rank in a pool that small is noise, not information.`
      );
    default:
      return code;
  }
}

/** Expand a stored ledger into human sentences. The API's read path. */
export function explainOmissions(
  omissions: unknown,
  ctx: OmissionContext = {},
): Record<string, { code: string; reason: string }> {
  if (!omissions || typeof omissions !== "object") return {};
  const out: Record<string, { code: string; reason: string }> = {};
  for (const [field, code] of Object.entries(omissions as Record<string, string>)) {
    out[field] = { code, reason: explainOmission(code, ctx) };
  }
  return out;
}
