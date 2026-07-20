// ═══════════════════════════════════════════════════════════════════════════
// STEP 19 — THE IMPLAUSIBILITY GUARD. It WITHHOLDS. It never corrects.
//
// ⚠️  READ THE BRIGHT LINE BEFORE CHANGING ANYTHING HERE.
//
//     ALLOWED (this file):   "this number is outside what is physically possible for this kind of
//                             fund → withhold it." An observation about the OUTPUT. It makes no
//                             claim about corporate actions, derives no ratio, corrects nothing.
//
//     FORBIDDEN (never):     "this NAV step means a 1:10 split → adjust by 10." An assertion about
//                             a corporate FACT, inferred from the shape of a series, and then acted
//                             on to manufacture a "corrected" number. A step-detector cannot tell a
//                             sub-division from a credit fund writing off a defaulted bond, so it
//                             would erase a real 90% loss as readily as a fake one.
//
//     Every CORRECTION in Step 19 comes from a real, dated NSE corporate action in
//     `instrument_corporate_events`. This guard is the other half: for the funds where no such
//     event exists — and can never exist, because they do not trade on an exchange — we still must
//     not SHIP a number we can see is impossible. So we withhold it, and we say only what we
//     actually know: the value is outside the possible range. We do NOT say why. We can't source why.
//
// WHY THE REASON CODE IS `withheld_implausible` AND NOT `split_unadjustable_no_source`:
// the latter NAMES AN INFERRED CAUSE ("a split happened that we couldn't source") — which is exactly
// the inference we forbid. The honest statement is "withheld: implausible", full stop.
//
// WHAT IT CATCHES (all measured, all live before this guard existed):
//     BANKIETF          max_drawdown_5y  -90.8%   ← a bank index ETF cannot fall 91%
//     Navi Liquid       max_drawdown_5y  -99.0%   ← a LIQUID fund cannot fall 99%
//     UTI Liquid        vol_1y           230.3%   ← a LIQUID fund cannot realise 230% volatility
//     LIC MF Gold ETF   vol_3y           269.8%
//     ICICI Overnight   vol_3y           205.2%
//     Franklin (wound)  max_drawdown     -100%
// For contrast, the ceiling across every HEALTHY fund in the book is ~30% volatility and ~-20%
// drawdown. The bounds below sit far outside anything real, so a true catastrophe still ships.
//
// HORIZON-SCOPED, AND THAT MATTERS: BANKIETF's 1Y and 3Y numbers are perfectly good (vol 15.9%,
// drawdown -18.3%) — only its 5Y window straddles the unit-basis break. Withholding the whole row
// would destroy two sound windows to suppress one bad one. Only the contaminated window is withheld.
// ═══════════════════════════════════════════════════════════════════════════
import { OmissionCode } from "./mf-omissions.js";
import type { Computed } from "./mf-analytics.js";

/**
 * The bounds. Each is set FAR outside anything a real fund has ever produced, because the cost of a
 * false positive (withholding a true catastrophe) is as real as the cost of a false negative.
 */
export const BOUNDS = {
  /** Annualised volatility. An unleveraged, long-only Indian fund does not realise 100%/yr — the
   *  worst healthy fund in the book is ~30%. Measured on broken series: 133%, 205%, 270%. */
  VOL_MAX: 1.0,
  /** Max drawdown. The deepest drawdown Indian equities have EVER produced is ~-60% (2008), and the
   *  worst healthy fund here is ~-20%. Measured on broken series: -90%, -99%, -100%. */
  DD_MIN: -0.85,
  /** A multi-year ANNUALISED return. -60%/yr sustained over three years is a ~-94% cumulative loss:
   *  the fund would not still be open. */
  CAGR_MIN: -0.6,
  /** A LIQUID / OVERNIGHT / MONEY-MARKET fund holds overnight-to-90-day paper and accrues interest
   *  daily. It cannot lose a tenth of its value per year — not through a credit event, not through
   *  anything. (Healthy money-market worst: -2.5%. Overnight worst: -0.6%.) */
  CASH_RET_MIN: -0.1,
} as const;

/** SEBI's cash-equivalent categories. A negative multi-year return here is not a bad year — it is
 *  a broken series, because the instrument cannot produce one. */
export function isCashFund(category: string | null, schemeName: string | null): boolean {
  const s = `${category ?? ""} ${schemeName ?? ""}`.toLowerCase();
  return /liquid|overnight|money market/.test(s);
}

/** The windows, and the mf_analytics columns that live and die with each. A window's return, its
 *  volatility, its Sharpe, its drawdown and its beta are all folded from the SAME stretch of NAV —
 *  so if that stretch is not describing the fund, none of them is. */
/** Exported for the STRUCTURAL WIRING GATE (`verify-t4-guard.ts`, `cv2-t4-guard-not-blind`): a gate that
 *  feeds each window a fully-populated `Computed` and asserts its `get()` SURFACES every dimension the
 *  fold computes for that horizon — the check that would have caught y5's hardcoded `vol: null` the day it
 *  was written. Also exported so the guard's bounds and the `Dim` shape are testable without re-declaring. */
export const WINDOWS = [
  {
    key: "y1",
    cols: ["ret_1y", "vol_1y", "sharpe_1y", "sortino_1y", "max_drawdown_1y",
      "roll_1y", "roll_1y_min", "roll_1y_max", "roll_1y_avg", "roll_1y_pct_positive",
      "beta_1y", "alpha_1y", "tracking_error_1y"],
    get: (c: Computed) => ({ ret: c.ret.y1 ?? null, vol: c.vol1y, dd: c.maxDD1y, annualised: false }),
    clear: (c: Computed) => {
      delete c.ret.y1;
      c.vol1y = null; c.sharpe1y = null; c.sortino1y = null; c.maxDD1y = null;
      c.roll1yN = null; c.roll1yMin = null; c.roll1yMax = null; c.roll1yAvg = null;
      c.roll1yPctPositive = null;
      c.beta1y = null; c.alpha1y = null; c.te1y = null;
    },
  },
  {
    key: "y3",
    cols: ["ret_3y_cagr", "vol_3y", "sharpe_3y", "sortino_3y", "max_drawdown_3y",
      "beta_3y", "alpha_3y", "tracking_error_3y"],
    get: (c: Computed) => ({ ret: c.ret.y3 ?? null, vol: c.vol3y, dd: c.maxDD3y, annualised: true }),
    clear: (c: Computed) => {
      delete c.ret.y3;
      c.vol3y = null; c.sharpe3y = null; c.sortino3y = null; c.maxDD3y = null;
      c.beta3y = null; c.alpha3y = null; c.te3y = null;
    },
  },
  {
    key: "y5",
    // vol_5y is computed for Sharpe but never STORED, so it is not a column here. ★ (T-4) It IS a fact,
    // though — carried on `Computed.vol5y` as a transient — and the guard now READS it. Passing `null`
    // here left the 5-year window's volatility untested: 65 side-pocketed defaulted-debt rows tripped
    // VOL_MAX at y1/y3 and were cleared, but y5 saw a drawdown of 0, was never volatility-tested, and
    // shipped it. "A value computed but not stored is still a fact." (`cv2-t4-guard-not-blind`.)
    cols: ["ret_5y_cagr", "sharpe_5y", "max_drawdown_5y", "beta_5y", "alpha_5y", "tracking_error_5y"],
    get: (c: Computed) => ({ ret: c.ret.y5 ?? null, vol: c.vol5y, dd: c.maxDD5y, annualised: true }),
    clear: (c: Computed) => {
      delete c.ret.y5;
      c.sharpe5y = null; c.maxDD5y = null;
      c.beta5y = null; c.alpha5y = null; c.te5y = null;
    },
  },
] as const;

/** The short simple returns. Guarded ONLY by the cash rule: a -60% six-month move is survivable for
 *  a wild thematic equity fund (so we must not withhold it), but it is flatly impossible for a fund
 *  whose entire job is to behave like cash. */
const SHORT = [
  { key: "m1", col: "ret_1m" },
  { key: "m3", col: "ret_3m" },
  { key: "m6", col: "ret_6m" },
] as const;

export interface ImplausibleResult {
  /** Schemes with at least one window withheld. */
  schemes: number;
  /** Individual (scheme × window) withholdings. */
  windows: number;
}

/**
 * MUTATES `computed` in place.
 *
 * MUST run AFTER applyDistributionHandling — an IDCW plan that inherits a contaminated Growth twin's
 * figures inherits its impossibility too, and has to be caught here rather than shipped.
 * MUST run BEFORE applyRanks — a fund must never be ranked on a number we are about to withhold.
 */
export function applyImplausibilityGuard(
  computed: Computed[],
  classOf: Map<string, { category: string | null; schemeName: string | null }>,
): ImplausibleResult {
  const res: ImplausibleResult = { schemes: 0, windows: 0 };

  for (const c of computed) {
    const meta = classOf.get(c.schemeCode);
    const cash = isCashFund(meta?.category ?? null, meta?.schemeName ?? null);
    let touched = false;

    for (const w of WINDOWS) {
      const { ret, vol, dd, annualised } = w.get(c);

      // Each test is a statement about the VALUE, and about nothing else.
      const impossible =
        (vol !== null && vol > BOUNDS.VOL_MAX) ||
        (dd !== null && dd < BOUNDS.DD_MIN) ||
        (ret !== null && annualised && ret < BOUNDS.CAGR_MIN) ||
        (ret !== null && cash && ret < BOUNDS.CASH_RET_MIN);

      if (!impossible) continue;

      w.clear(c);
      for (const col of w.cols) c.omissions[col] = OmissionCode.WITHHELD_IMPLAUSIBLE;
      res.windows++;
      touched = true;
    }

    if (cash) {
      for (const s of SHORT) {
        const v = c.ret[s.key];
        if (v === null || v === undefined || v >= BOUNDS.CASH_RET_MIN) continue;
        delete c.ret[s.key];
        c.omissions[s.col] = OmissionCode.WITHHELD_IMPLAUSIBLE;
        res.windows++;
        touched = true;
      }
    }

    if (touched) res.schemes++;
  }

  return res;
}
