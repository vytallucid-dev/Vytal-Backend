// ─────────────────────────────────────────────────────────────────────────────
// TIME-WEIGHTED RETURN (TWR) — the CASH-FLOW-NEUTRAL performance series.
//
// Raw NAV rebased to 100 lies: deposits read as gains (a book that grew only because
// the user added capital would "beat" the index). TWR strips cash-flow timing so
// portfolio vs index is a fair "how did the money perform" read — the industry standard.
//
// Method (daily linking): each trading day's return is the pure % move of the capital
// that was ALREADY invested the day before, with that day's external cash flow removed:
//     r_D = (V_D − CF_D) / V_{D-1}          (V = day-close value, CF = net cash in/out at close)
// Chain the daily returns geometrically → a cumulative index (100 at the first day).
// Because CF_D is valued at the same close V_D uses, a PURE DEPOSIT is neutral:
//     V_D = V_{D-1} + CF_D  ⇒  r_D = 1  (0% — the deposit is not return).
// Only price movement of held capital moves the index. Pure + deterministic; no DB.
// ─────────────────────────────────────────────────────────────────────────────
import type { WalkResult } from "./engine.js";

export interface TwrPoint {
  date: string;
  twrIndex: number; // cumulative TWR, indexed to 100 at the first day (4dp)
}

export interface TwrResult {
  series: TwrPoint[];
  firstDate: string | null;
  lastDate: string | null;
  /** Cumulative time-weighted return over the whole series, % (index − 100). Null when empty. */
  totalTwrPct: number | null;
  /** Annualized (CAGR of the TWR index) %, or null when the span is < ~30 days (misleading). */
  annualizedPct: number | null;
  /** Calendar days spanned (first → last). */
  days: number;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function computeTwr(walk: WalkResult): TwrResult {
  const pts = walk.series;
  if (pts.length === 0) {
    return { series: [], firstDate: null, lastDate: null, totalTwrPct: null, annualizedPct: null, days: 0 };
  }

  // Index starts at 100 on the first day (all of V_0 is the opening cash flow — no prior
  // capital to have earned a return, so day 0 has no r).
  const series: TwrPoint[] = [{ date: pts[0].date, twrIndex: 100 }];
  let idx = 100;
  for (let i = 1; i < pts.length; i++) {
    const vPrev = pts[i - 1].value;
    if (vPrev > 0) {
      // Pure return of yesterday's capital over today, with today's cash flow removed.
      const r = (pts[i].value - pts[i].cashFlow) / vPrev;
      idx = idx * r;
    }
    // vPrev == 0 (book was empty / fully exited the day before): the new capital just
    // enters — no return to record — so the index holds flat across the gap.
    series.push({ date: pts[i].date, twrIndex: round4(idx) });
  }

  const firstDate = pts[0].date;
  const lastDate = pts[pts.length - 1].date;
  const days = (Date.parse(lastDate) - Date.parse(firstDate)) / 86_400_000;
  const lastIndex = series[series.length - 1].twrIndex;
  const totalTwrPct = round4(lastIndex - 100);
  const years = days / 365.25;
  const annualizedPct =
    days >= 30 && years > 0 ? round4((Math.pow(lastIndex / 100, 1 / years) - 1) * 100) : null;

  return { series, firstDate, lastDate, totalTwrPct, annualizedPct, days };
}
