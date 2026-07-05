// ─────────────────────────────────────────────────────────────────────────────
// XIRR — money-weighted (internal) rate of return over dated cashflows. PURE.
//
// The complement to TWR: TWR strips cashflows to ask "how did the picks do"; XIRR keeps
// them to ask "what did MY timing/sizing earn". Solve for the annual rate r that makes
// the discounted sum of every dated cashflow zero:
//
//     Σ  cf_i / (1 + r)^( days(t_i − t_0) / 365 )  =  0
//
// Sign convention (set by the caller): buys are NEGATIVE (capital out), sells/dividends
// POSITIVE (capital in), and the current portfolio value is a final POSITIVE flow today.
//
// SOLVER: Newton–Raphson from a 10% seed (fast when the function is well-behaved), with a
// bracketing BISECTION fallback when Newton stalls/diverges (flat derivative, domain
// escape, oscillation). r is annual BY CONSTRUCTION (the 365-day exponent) — there is no
// separate "annualize" step.
//
// HONEST-NULL, never a garbage number: < 2 flows, no sign change (no root exists), a span
// too short to annualize sanely, or genuine non-convergence → xirrPct = null + a state
// that says why. Nothing is fabricated.
// ─────────────────────────────────────────────────────────────────────────────

/** One dated cashflow. `date` is "YYYY-MM-DD"; `amount` is signed ₹ (buy −, sell/div +). */
export interface XirrCashflow {
  date: string;
  amount: number;
}

export type XirrState =
  | "ok"
  | "empty" // no cashflows at all
  | "single_cashflow" // < 2 flows → a rate is undefined
  | "no_sign_change" // all one sign → the NPV curve never crosses zero, no IRR exists
  | "insufficient_history" // span too short to annualize without exploding
  | "non_convergent"; // a root should exist but neither method pinned it

export interface XirrResult {
  xirrPct: number | null; // annualized money-weighted return %, null on any non-"ok" state
  state: XirrState;
  method: "newton" | "bisection" | null; // how it converged (null when not computed)
  flowCount: number; // dated cashflows considered (incl. the terminal value flow)
  firstDate: string | null;
  lastDate: string | null;
  days: number; // span first → last cashflow
}

const DAY_MS = 86_400_000;
/** Whole calendar days a → b (b later ⇒ positive). Dates are UTC-parsed "YYYY-MM-DD". */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

// A window shorter than this can't be annualized honestly — a +3% month becomes a
// meaningless triple-digit "annual" rate. Mirrors the TWR annualization floor (~30d).
const MIN_SPAN_DAYS = 30;

/** NPV of the flows at annual rate `r`, discounting each by (days/365). Returns NaN when
 *  1+r ≤ 0 (outside the valid domain) so callers can reject that region. */
function xnpv(r: number, flows: XirrCashflow[], t0: string): number {
  const base = 1 + r;
  if (base <= 0) return NaN;
  let sum = 0;
  for (const cf of flows) {
    const yrs = dayDiff(t0, cf.date) / 365;
    sum += cf.amount / Math.pow(base, yrs);
  }
  return sum;
}

/** d(NPV)/dr — the analytic derivative, for Newton's step. */
function dxnpv(r: number, flows: XirrCashflow[], t0: string): number {
  const base = 1 + r;
  if (base <= 0) return NaN;
  let sum = 0;
  for (const cf of flows) {
    const yrs = dayDiff(t0, cf.date) / 365;
    sum += (-yrs * cf.amount) / Math.pow(base, yrs + 1);
  }
  return sum;
}

/** Newton–Raphson from a 10% seed. Returns the converged rate, or null to fall back. */
function solveNewton(flows: XirrCashflow[], t0: string): number | null {
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const f = xnpv(r, flows, t0);
    const df = dxnpv(r, flows, t0);
    if (!Number.isFinite(f) || !Number.isFinite(df) || Math.abs(df) < 1e-10) return null;
    const next = r - f / df;
    if (!Number.isFinite(next) || next <= -0.9999) return null; // escaped the domain → bisection
    if (Math.abs(next - r) < 1e-8) return next;
    r = next;
  }
  return null; // didn't settle in the iteration budget
}

/** Bracketing bisection — robust where Newton stalls. Scans up from a valid lower bound
 *  for a sign change, then halves. Returns the root, or null when no bracket exists. */
function solveBisection(flows: XirrCashflow[], t0: string): number | null {
  let lo = -0.9999;
  let hi = 1.0; // 100%; expanded upward until the sign flips or we give up
  let flo = xnpv(lo, flows, t0);
  let fhi = xnpv(hi, flows, t0);
  let expand = 0;
  while (Number.isFinite(flo) && Number.isFinite(fhi) && flo * fhi > 0 && hi < 1e7 && expand++ < 200) {
    hi *= 2;
    fhi = xnpv(hi, flows, t0);
  }
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null; // no bracket

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = xnpv(mid, flows, t0);
    if (!Number.isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-7 || (hi - lo) / 2 < 1e-9) return mid;
    if (flo * fm < 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Solve XIRR over the given cashflows. Pure + deterministic. The caller supplies the sign
 * convention (buys −, sells/dividends +, current value + at today).
 */
export function computeXirr(cashflows: XirrCashflow[]): XirrResult {
  const flowCount = cashflows.length;
  const base = (state: XirrState): XirrResult => ({
    xirrPct: null,
    state,
    method: null,
    flowCount,
    firstDate: null,
    lastDate: null,
    days: 0,
  });

  if (flowCount === 0) return base("empty");
  if (flowCount < 2) return base("single_cashflow");

  const sorted = [...cashflows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const t0 = sorted[0].date;
  const tN = sorted[sorted.length - 1].date;
  const days = dayDiff(t0, tN);

  if (days < MIN_SPAN_DAYS) return { ...base("insufficient_history"), firstDate: t0, lastDate: tN, days };

  // A root exists only if the discounted sum can be pushed through zero — i.e. flows carry
  // both signs. All-positive or all-negative → no IRR (honest null, not a fabricated 0%).
  const hasPos = sorted.some((c) => c.amount > 0);
  const hasNeg = sorted.some((c) => c.amount < 0);
  if (!hasPos || !hasNeg) return { ...base("no_sign_change"), firstDate: t0, lastDate: tN, days };

  const newton = solveNewton(sorted, t0);
  const rate = newton != null ? newton : solveBisection(sorted, t0);
  if (rate == null || !Number.isFinite(rate) || rate <= -1) {
    return { ...base("non_convergent"), firstDate: t0, lastDate: tN, days };
  }

  return {
    xirrPct: rate * 100,
    state: "ok",
    method: newton != null ? "newton" : "bisection",
    flowCount,
    firstDate: t0,
    lastDate: tN,
    days,
  };
}
