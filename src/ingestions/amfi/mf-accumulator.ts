// ═══════════════════════════════════════════════════════════════
// THE STREAMING FOLD — the heart of Option B.
//
// One accumulator per scheme. Rows arrive chronologically and are FOLDED IN AND FORGOTTEN;
// the NAV series is never retained. Memory is therefore O(schemes), not O(rows): a 5-year
// run folds ~10.7 M rows through ~9,000 accumulators and the heap never notices.
//
// Everything Group-1 needs is foldable:
//   returns per horizon  → the NAV at the first observation on/after each anchor date
//   volatility           → running n, Σr, Σr²        (r = daily LOG return)
//   Sortino              → running Σ min(r,0)²
//   max drawdown         → running peak + worst peak-to-trough
//   rolling 1Y returns   → a date-aware ring of the trailing year
//
// THE ORDER GUARD (ruling ①): the fold is only valid if each scheme's rows arrive ASCENDING
// BY DATE. Recon verified 0 violations across 535,680 live rows — but a silent reordering by
// AMFI would corrupt EVERY volatility number in the table while looking perfectly healthy.
// So it is checked at runtime, per row, and a violation is a FAULT.
//
// WHY LOG RETURNS: they sum, so Σr and Σr² fold in constant space. Simple returns do not.
// ═══════════════════════════════════════════════════════════════

/** Horizons, in calendar days. */
export const H = { m1: 30, m3: 91, m6: 182, y1: 365, y3: 1095, y5: 1826 } as const;
export type Horizon = keyof typeof H;

/**
 * How late an anchor observation may be and still count as "the fund existed then".
 *
 * This is what separates a 5-year-old fund from a 4.9-year-old one. A fund launched 4.9 y
 * ago has its first NAV ~36 days after the 5Y anchor date → REJECTED → ret_5y_cagr is
 * honest-empty. A fund launched 5.0 y ago lands on the anchor → accepted. Without this, a
 * young fund's FIRST NAV would silently be used as its "5 years ago" price and we would
 * publish a fabricated 5-year return.
 *
 * 21 days absorbs holiday clusters and monthly-reporting funds without absorbing a
 * genuinely-too-young fund.
 */
export const ANCHOR_TOLERANCE_DAYS = 21;

/** Minimum daily returns before a volatility/Sharpe number means anything. */
const MIN_RETURNS: Record<"y1" | "y3" | "y5", number> = { y1: 30, y3: 90, y5: 150 };

// NOTE — the "is this benchmark a market-risk proxy at all?" floor (MIN_BENCHMARK_VOL) deliberately
// lives in mf-benchmark.ts, NOT here. It is a property of the INDEX, decided once from the index's
// own series. Deciding it in this file would make it depend on the FUND's sampling cadence — and
// that leaked a beta of −4.07 on a sparse annual-IDCW overnight fund. See BenchmarkSeries.isCashLike.

/** Ring capacity: liquid/overnight funds price EVERY calendar day, so a trailing year can
 *  hold 366 points — not the ~250 an equity fund posts. 420 gives headroom over both. */
const RING = 420;

/**
 * One horizon's running statistics. Nested windows (1Y ⊂ 3Y ⊂ 5Y) each keep their own.
 *
 * VARIANCE USES WELFORD'S ONLINE ALGORITHM, not the textbook Σr² − n·μ².
 *
 * This is not fastidiousness — the naive form is BROKEN for the funds we hold most of. A
 * liquid/overnight fund's daily log return is ~0.0004 and almost constant, so Σr² and n·μ² are
 * both ≈5.8e-5 and agree to ~15 significant figures. Subtracting them is CATASTROPHIC
 * CANCELLATION: the true variance (≈0) is swamped by float error and comes out as a tiny
 * NEGATIVE number. The guard then reads `variance < 0`, gives up, and returns null — so every
 * Overnight and Liquid fund (≈700 schemes) would silently show NO volatility, and the
 * honest-empty ledger would blame "insufficient history" for what was actually an arithmetic
 * bug. A hand-calc check on a constant series caught exactly this.
 *
 * Welford accumulates squared deviations directly, so M2 is a sum of non-negative terms and
 * cannot go negative. Same single pass, same O(1) memory.
 */
class StatSet {
  n = 0;          // daily log returns seen in this window
  private mean = 0; // running mean of r (Welford)
  private m2 = 0;   // running Σ(r − mean)² (Welford) — never negative
  downsq = 0;     // Σ min(r,0)²  — a sum of non-negative terms; no cancellation risk
  peak = 0;       // running high-water NAV
  maxDD = 0;      // worst (nav - peak)/peak, a NEGATIVE fraction
  firstDay = 0;
  lastDay = 0;
  points = 0;     // NAV observations (n + 1, absent gaps)

  observe(day: number, nav: number) {
    if (this.points === 0) {
      this.firstDay = day;
      this.peak = nav;
    }
    this.points++;
    this.lastDay = day;
    if (nav > this.peak) this.peak = nav;
    if (this.peak > 0) {
      const dd = (nav - this.peak) / this.peak;
      if (dd < this.maxDD) this.maxDD = dd;
    }
  }

  addReturn(r: number) {
    // Welford: mean and M2 updated together, in one pass, stably.
    this.n++;
    const delta = r - this.mean;
    this.mean += delta / this.n;
    this.m2 += delta * (r - this.mean);
    if (r < 0) this.downsq += r * r;
  }

  /** Observations per year, DERIVED from the data — never assumed to be 252.
   *  An equity fund posts ~250/yr; a liquid fund posts 365/yr. Annualising both by a
   *  hard-coded 252 would misstate one of them. */
  private obsPerYear(): number {
    const spanYears = (this.lastDay - this.firstDay) / 365.25;
    if (spanYears <= 0 || this.n === 0) return 0;
    return this.n / spanYears;
  }

  /** Annualised volatility (fraction), or null when the sample is too thin to mean anything.
   *  A genuinely flat fund correctly returns 0 — NOT null. Zero volatility is a real,
   *  meaningful answer for an overnight fund; "no answer" is not. */
  vol(min: number): number | null {
    if (this.n < min || this.n < 2) return null;
    const variance = this.m2 / (this.n - 1); // Welford — cannot be negative
    const ppy = this.obsPerYear();
    if (ppy <= 0) return null;
    return Math.sqrt(Math.max(0, variance)) * Math.sqrt(ppy);
  }

  /** Annualised DOWNSIDE deviation — the Sortino denominator. Only losses count. */
  downsideDev(min: number): number | null {
    if (this.n < min) return null;
    const ppy = this.obsPerYear();
    if (ppy <= 0) return null;
    return Math.sqrt(this.downsq / this.n) * Math.sqrt(ppy);
  }
}

/**
 * ONE HORIZON'S PAIRED (fund, benchmark) STATISTICS — the Group-3 fold (Step 18).
 *
 * beta = cov(rF, rB) / var(rB)   ·   trackingError = annualised stdev(rF − rB)
 *
 * ══ ONLINE COVARIANCE, FOR THE SAME REASON StatSet USES WELFORD ══
 * The textbook covariance — (Σ rF·rB − n·μF·μB) / (n−1) — has exactly the catastrophic-cancellation
 * failure that broke volatility for every liquid/overnight fund (see StatSet's header). Two nearly
 * equal large numbers are subtracted and the small true answer drowns in float error. For a fund
 * that tracks its index closely — which is PRECISELY the case tracking-error exists to measure —
 * cov(rF,rB) and var(rB) are almost identical, so the naive form would produce a beta of 0.97 or
 * 1.04 out of pure noise on a fund whose true beta is 1.000.
 *
 * So the co-moment is accumulated directly (a running sum of products of deviations), the same
 * single pass, the same O(1) memory. Note that beta = C / M2B needs no (n−1) at all: the divisor
 * cancels between covariance and variance.
 */
class PairSet {
  n = 0;
  private meanF = 0;
  private meanB = 0;
  /** Co-moment: Σ (rF − meanF)(rB − meanB), accumulated online. */
  private cMoment = 0;
  /** Σ (rB − meanB)² — the benchmark's variance numerator. Never negative. */
  private m2B = 0;
  /** Welford on the DIFFERENCE (rF − rB) — the tracking-error series. */
  private meanD = 0;
  private m2D = 0;
  firstDay = 0;
  lastDay = 0;

  observe(day: number, rF: number, rB: number) {
    if (this.n === 0) this.firstDay = day;
    this.lastDay = day;

    this.n++;
    const dF = rF - this.meanF;
    this.meanF += dF / this.n;

    const dB = rB - this.meanB;
    this.meanB += dB / this.n;
    // Both use the NEW meanB — this is the standard online co-moment/variance update.
    this.cMoment += dF * (rB - this.meanB);
    this.m2B += dB * (rB - this.meanB);

    const d = rF - rB;
    const dD = d - this.meanD;
    this.meanD += dD / this.n;
    this.m2D += dD * (d - this.meanD);
  }

  /** Observations per year, DERIVED — never a hard-coded 252. Same rule as StatSet. */
  private obsPerYear(): number {
    const spanYears = (this.lastDay - this.firstDay) / 365.25;
    if (spanYears <= 0 || this.n === 0) return 0;
    return this.n / spanYears;
  }

  /** The BENCHMARK's own annualised volatility — beta's denominator, in interpretable units. */
  benchmarkVol(): number | null {
    if (this.n < 2) return null;
    const ppy = this.obsPerYear();
    if (ppy <= 0) return null;
    return Math.sqrt(Math.max(0, this.m2B / (this.n - 1))) * Math.sqrt(ppy);
  }

  /**
   * β = cov / var(benchmark). Null when the sample is too thin — or when the BENCHMARK CARRIES NO
   * MARKET RISK TO BE SENSITIVE TO.
   *
   * ══ THE SECOND HALF OF THIS GUARD IS NOT PEDANTRY — IT WAS A LIVE BUG ══
   * The first full run produced β = −13.23 for ICICI's Overnight Funds, measured against the Nifty
   * 1D Rate Index. Arithmetically correct; financially meaningless. That index's annualised
   * volatility is 0.22% — it barely moves — so beta's DENOMINATOR is ≈0 and the ratio explodes on
   * noise. A −13 beta on a cash fund is not a signal, it is a division artefact wearing a decimal
   * point.
   *
   * And the principle is sharper than "small denominators are unstable". The Nifty 1D Rate Index IS
   * THE RISK-FREE RATE — it is literally the series risk-free.ts uses as rf. Beta to the risk-free
   * asset is UNDEFINED in CAPM by construction: rf has zero variance by definition, and "how
   * sensitive is this fund to an asset that carries no risk" is not a question with an answer.
   *
   * This is exactly the lesson MIN_DISPERSION already encodes for Sharpe (see mf-analytics.ts): a
   * ratio whose denominator is ~0 is UNDEFINED, not infinite, and the honest output is a null with a
   * reason — never a clamped or plausible-looking number.
   *
   * WHERE THE REAL GATE LIVES, and why it is NOT here: whether an index is a market-risk proxy is a
   * property of THE INDEX, answered once from its own series (BenchmarkSeries.isCashLike). Deciding
   * it HERE would make it depend on the FUND's sampling — and that leaked: an annual-IDCW overnight
   * fund reports so sparsely that the benchmark's multi-day spans between its NAVs looked volatile
   * enough to clear a floor, and it shipped a beta of −4.07 against the overnight rate. A question
   * about an index cannot have a different answer depending on who is looking at it.
   *
   * What remains here is the DEGENERATE case only: a benchmark that did not move AT ALL across the
   * paired sample. cov/0 is undefined — not infinite, and not 1.
   */
  beta(min: number): number | null {
    if (this.n < min || this.n < 2) return null;
    if (this.m2B <= 0) return null;
    return this.cMoment / this.m2B; // the (n−1) cancels between cov and var
  }

  /** Annualised tracking error. A perfect tracker genuinely returns ~0 — that is an ANSWER, not a null. */
  trackingError(min: number): number | null {
    if (this.n < min || this.n < 2) return null;
    const ppy = this.obsPerYear();
    if (ppy <= 0) return null;
    const variance = this.m2D / (this.n - 1); // Welford — cannot be negative
    return Math.sqrt(Math.max(0, variance)) * Math.sqrt(ppy);
  }
}

/**
 * The ONLY thing SchemeAcc needs from a benchmark series. Declared STRUCTURALLY, not imported from
 * mf-benchmark.ts — which imports H/ANCHOR_TOLERANCE_DAYS from THIS file, and a real import here
 * would close the cycle.
 */
export interface BenchmarkReturns {
  /** The benchmark's log return across EXACTLY (prevDay → day). Null ⇒ unpairable; the caller skips. */
  logReturnBetween(prevDay: number, day: number): number | null;
}

export interface AccInit {
  /** The fund's OWN latest NAV date (day-number), from Layer B. Anchors hang off THIS, not
   *  off "today" — so a dormant fund's returns are measured to its own last pricing day and
   *  labelled with it, rather than being silently measured to a date it never traded on. */
  asOfDay: number;
  /** The fund's benchmark series (Step 18). Absent ⇒ no Group-3 metrics, honest-null with a reason. */
  bench?: BenchmarkReturns | undefined;
}

export class SchemeAcc {
  readonly asOfDay: number;
  /** Step 18. Absent ⇒ this fund has no benchmark; the paired windows stay empty and Group-3 is null. */
  private readonly bench: BenchmarkReturns | undefined;

  // Anchor NAVs — the first observation on/after (asOfDay − horizon).
  private anchorNav: Partial<Record<Horizon, number>> = {};
  private anchorDay: Partial<Record<Horizon, number>> = {};

  // Nested windows.
  readonly w1 = new StatSet();
  readonly w3 = new StatSet();
  readonly w5 = new StatSet();

  // Nested PAIRED windows (Step 18) — fund return vs benchmark return, same days.
  readonly p1 = new PairSet();
  readonly p3 = new PairSet();
  readonly p5 = new PairSet();
  /** Fund returns we could NOT pair with a benchmark move. Surfaced, never silently dropped. */
  unpaired = 0;

  // Whole-fold facts.
  points = 0;
  firstDay = 0;
  firstNav = 0;
  lastDay = 0;
  lastNav = 0;
  private prevNav = 0;

  /** ORDER-GUARD violations. Non-zero ⇒ the fold's returns are untrustworthy ⇒ a FAULT. */
  outOfOrder = 0;

  // Rolling 1-year returns — a date-aware circular buffer of the trailing year.
  private rDay = new Int32Array(RING);
  private rNav = new Float64Array(RING);
  private head = 0; // next write slot
  private tail = 0; // oldest retained slot
  private size = 0;
  rollN = 0;
  rollSum = 0;
  rollMin = Infinity;
  rollMax = -Infinity;
  rollPos = 0;

  constructor(init: AccInit) {
    this.asOfDay = init.asOfDay;
    this.bench = init.bench;
  }

  push(day: number, nav: number) {
    // ── ORDER GUARD ─────────────────────────────────────────
    // Not defensive paranoia: r = log(nav_t / nav_{t−1}) is meaningless if t−1 isn't
    // actually before t. A reordered feed would produce plausible-looking, wrong volatility.
    if (this.points > 0 && day <= this.lastDay) {
      this.outOfOrder++;
      return; // refuse the row rather than fold a lie
    }

    if (this.points === 0) {
      this.firstDay = day;
      this.firstNav = nav;
    }

    // ── ANCHORS: first observation on/after (asOfDay − horizon) ──
    for (const k of Object.keys(H) as Horizon[]) {
      if (this.anchorNav[k] === undefined && day >= this.asOfDay - H[k]) {
        this.anchorNav[k] = nav;
        this.anchorDay[k] = day;
      }
    }

    // ── NESTED WINDOWS ──────────────────────────────────────
    const in5 = day >= this.asOfDay - H.y5;
    const in3 = day >= this.asOfDay - H.y3;
    const in1 = day >= this.asOfDay - H.y1;
    if (in5) this.w5.observe(day, nav);
    if (in3) this.w3.observe(day, nav);
    if (in1) this.w1.observe(day, nav);

    // ── DAILY LOG RETURN ────────────────────────────────────
    // A NAV of 0 is a real published value (written-off segregated portfolios) but a log
    // return through it is undefined, so it breaks the chain rather than poisoning Σr.
    if (this.points > 0 && this.prevNav > 0 && nav > 0) {
      const r = Math.log(nav / this.prevNav);
      if (in5) this.w5.addReturn(r);
      if (in3) this.w3.addReturn(r);
      if (in1) this.w1.addReturn(r);

      // ── THE PAIRED FOLD (Step 18) ─────────────────────────
      // `this.lastDay` is still the PREVIOUS observation's day — it is not updated until the end of
      // push(). That is exactly the `prevDay` the fund's return `r` spans FROM, so the benchmark's
      // return is measured across the SAME (prevDay → day) window.
      //
      // THIS IS THE STEP THAT WOULD SILENTLY CORRUPT EVERY BETA IF IT USED THE BENCHMARK'S
      // SINGLE-DAY RETURN INSTEAD. A fund's NAV does not print every day the index does: `r` may
      // span one day or five (a long weekend, a monthly-reporting fund). Pairing a 5-day fund move
      // against a 1-day index move computes the covariance of two different things — and produces a
      // beta that is stable, plausible, and wrong in every row.
      if (this.bench) {
        const rB = this.bench.logReturnBetween(this.lastDay, day);
        if (rB === null) {
          // Unpairable — the benchmark did not move, or could not be honestly aligned. REFUSED and
          // COUNTED. Never zero-filled: a 0 benchmark return against a real fund move would drag
          // every beta toward zero while looking like data.
          this.unpaired++;
        } else {
          if (in5) this.p5.observe(day, r, rB);
          if (in3) this.p3.observe(day, r, rB);
          if (in1) this.p1.observe(day, r, rB);
        }
      }
    }

    // ── ROLLING 1-YEAR ──────────────────────────────────────
    // Drop everything older than a year, then compare against the oldest survivor.
    while (this.size > 0 && this.rDay[this.tail]! < day - H.y1) {
      this.tail = (this.tail + 1) % RING;
      this.size--;
    }
    if (this.size > 0) {
      const oldDay = this.rDay[this.tail]!;
      const oldNav = this.rNav[this.tail]!;
      // Only a genuine ~1-year lag counts. A fund with a 6-month gap must not have that gap
      // reported as a "1-year rolling return".
      if (oldNav > 0 && oldDay <= day - H.y1 + ANCHOR_TOLERANCE_DAYS && oldDay >= day - H.y1 - ANCHOR_TOLERANCE_DAYS) {
        const rr = nav / oldNav - 1;
        this.rollN++;
        this.rollSum += rr;
        if (rr < this.rollMin) this.rollMin = rr;
        if (rr > this.rollMax) this.rollMax = rr;
        if (rr > 0) this.rollPos++;
      }
    }
    if (this.size === RING) {
      // Full: overwrite the oldest (it is >1 y old anyway after the drain above).
      this.tail = (this.tail + 1) % RING;
      this.size--;
    }
    this.rDay[this.head] = day;
    this.rNav[this.head] = nav;
    this.head = (this.head + 1) % RING;
    this.size++;

    this.prevNav = nav;
    this.lastDay = day;
    this.lastNav = nav;
    this.points++;
  }

  /** The anchor NAV for a horizon, or null when the fund did not exist that far back. */
  anchor(h: Horizon): number | null {
    const nav = this.anchorNav[h];
    const day = this.anchorDay[h];
    if (nav === undefined || day === undefined || nav <= 0) return null;
    const target = this.asOfDay - H[h];
    // Too LATE ⇒ the fund's history starts after the anchor ⇒ it is younger than the horizon.
    if (day - target > ANCHOR_TOLERANCE_DAYS) return null;
    return nav;
  }

  /** Simple return over a horizon (1M/3M/6M/1Y). */
  simpleReturn(h: Horizon): number | null {
    const a = this.anchor(h);
    if (a === null || this.lastNav <= 0) return null;
    return this.lastNav / a - 1;
  }

  /** CAGR over a horizon (3Y/5Y) — annualised over the ACTUAL elapsed span, not the nominal one. */
  cagr(h: Horizon): number | null {
    const a = this.anchor(h);
    const day = this.anchorDay[h];
    if (a === null || day === undefined || this.lastNav <= 0) return null;
    const years = (this.lastDay - day) / 365.25;
    if (years <= 0.5) return null; // too short to annualise without inventing a number
    return Math.pow(this.lastNav / a, 1 / years) - 1;
  }

  vol(w: "y1" | "y3" | "y5"): number | null {
    const s = w === "y1" ? this.w1 : w === "y3" ? this.w3 : this.w5;
    return s.vol(MIN_RETURNS[w]);
  }

  downsideDev(w: "y1" | "y3"): number | null {
    const s = w === "y1" ? this.w1 : this.w3;
    return s.downsideDev(MIN_RETURNS[w]);
  }

  /** Max drawdown within a window — NEGATIVE. Null when the window holds no observations. */
  maxDrawdown(w: "y1" | "y3" | "y5"): number | null {
    const s = w === "y1" ? this.w1 : w === "y3" ? this.w3 : this.w5;
    return s.points > 1 ? s.maxDD : null;
  }

  /** The annualised return used as Sharpe's/Sortino's numerator for a window. */
  annualisedReturn(w: "y1" | "y3" | "y5"): number | null {
    if (w === "y1") return this.simpleReturn("y1");
    return this.cagr(w === "y3" ? "y3" : "y5");
  }

  // ── GROUP-3 (Step 18) ────────────────────────────────────────────────────────────────────

  /**
   * The day the fund's own horizon window actually STARTS — its anchor observation.
   *
   * Alpha's benchmark leg must be measured over THE SAME DAYS as the fund's return, not over a
   * nominal 365/1095/1826-day horizon. A fund whose anchor lands 12 days late (a holiday cluster)
   * has a return over 353 days; comparing it against 365 days of index movement would make the
   * alpha wrong by the difference. So the exact anchor day is exposed, and alpha is computed
   * between it and `lastDay`.
   */
  anchorDayOf(h: Horizon): number | null {
    const day = this.anchorDay[h];
    if (day === undefined) return null;
    if (day - (this.asOfDay - H[h]) > ANCHOR_TOLERANCE_DAYS) return null; // too young for this horizon
    return day;
  }

  private pairSet(w: "y1" | "y3" | "y5"): PairSet {
    return w === "y1" ? this.p1 : w === "y3" ? this.p3 : this.p5;
  }

  /** β for a window. Null when the paired sample is too thin (the SAME MIN_RETURNS gate as vol).
   *  The "is this benchmark even a market-risk proxy?" gate is decided by the INDEX, upstream —
   *  see BenchmarkSeries.isCashLike and the note on PairSet.beta. */
  beta(w: "y1" | "y3" | "y5"): number | null {
    return this.pairSet(w).beta(MIN_RETURNS[w]);
  }

  /** The benchmark's own annualised volatility in this window — used to EXPLAIN a null beta. */
  benchmarkVol(w: "y1" | "y3" | "y5"): number | null {
    return this.pairSet(w).benchmarkVol();
  }

  /** Annualised tracking error for a window. ~0 for a good index tracker — a real answer, not a null. */
  trackingError(w: "y1" | "y3" | "y5"): number | null {
    return this.pairSet(w).trackingError(MIN_RETURNS[w]);
  }

  /** How many fund/benchmark return PAIRS were actually folded in this window — the evidence. */
  pairPoints(w: "y1" | "y3" | "y5"): number {
    return this.pairSet(w).n;
  }
}
