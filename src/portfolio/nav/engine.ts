// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO NAV ENGINE (pure) — the daily value-over-time backbone.
//
// A daily time series of the portfolio's total market value, one point per TRADING
// DAY from the first buy to the last close: value(D) = Σ over every symbol held on D
// of (quantity held on D × that symbol's close on D). DERIVED from the ledger × daily
// closes — never a stored figure. No DB here; the assemble layer feeds it.
//
// LAWS (enforced here, not just copied):
//  • EOD, not live — values come from daily closes; the last point is "at last close".
//  • Starts at first buy — no value before the user owned anything (young book = short
//    series; NEVER a fabricated backfill).
//  • Trading-day points only — the calendar is the union of close DATES for the held
//    symbols; weekends/holidays have no close, so gaps are natural (not zero-filled).
//  • Price gap ≠ vanished holding — a held symbol missing a day's close CARRIES FORWARD
//    its last known close; a symbol that never had a close contributes nothing (honestly
//    absent), never a fabricated price.
//  • Exits leave the book — once held qty hits 0 the symbol stops contributing from that
//    day (that value became realized P&L, not NAV).
// The split/bonus quantity factor reuses the SAME convention as the FIFO engine
// (corporateActionFactor) — one source of truth for "a:b".
// ─────────────────────────────────────────────────────────────────────────────
import { corporateActionFactor } from "../fifo-engine.js";

export type NavTxnType = "buy" | "sell" | "split" | "bonus" | "dividend";

/** One ledger row, reduced to what NAV needs (total held qty over time — no lots/cost).
 *  Dates are "YYYY-MM-DD" (ISO, lexicographic-comparable == chronological). */
export interface NavLedgerTxn {
  symbol: string;
  type: NavTxnType;
  quantity: number | null; // buy/sell share count; null for split/bonus/dividend
  ratio: string | null; // "a:b" for split/bonus; null otherwise
  tradeDate: string; // "YYYY-MM-DD"
}

/** One daily close for a symbol. */
export interface NavPricePoint {
  date: string; // "YYYY-MM-DD"
  close: number;
}

export interface NavPoint {
  date: string; // trading day
  value: number; // portfolio market value at that day's closes (₹, 2dp)
}

export interface NavSeriesResult {
  series: NavPoint[];
  firstDate: string | null; // first emitted point (first trading day ≥ first buy)
  lastDate: string | null; // last close in the series ("at last close")
  points: number;
  /** Held symbols that never had ANY close in range → contributed nothing (honest). */
  symbolsNoPrice: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Reuse the FIFO engine's ratio convention so split/bonus scale qty identically. */
function factorOf(ratio: string | null): number {
  return Number(corporateActionFactor(ratio));
}

/** One walked trading day: portfolio market value + the NET external cash flow that
 *  landed that day, valued at the SAME carry-forward close the value uses (buy = +,
 *  sell = −; split/bonus/dividend = 0 — no cash moved). This is the shared core: NAV
 *  reads `value`; TWR reads `value` + `cashFlow` (to strip inflows from return). */
export interface WalkPoint {
  date: string;
  value: number; // ₹ 2dp
  cashFlow: number; // ₹ 2dp — capital in(+)/out(−) that day, at that day's close
}
export interface WalkResult {
  series: WalkPoint[];
  firstDate: string | null;
  lastDate: string | null;
  symbolsNoPrice: string[];
}

/**
 * The shared day-walk. For each trading day: advance every symbol's carry-forward close,
 * apply the day's ledger txns (accumulating net cash flow at that close), then value the
 * book. Pure + deterministic. `pricesBySymbol` values MUST be sorted ascending by date.
 */
export function walkNav(
  ledger: NavLedgerTxn[],
  pricesBySymbol: Map<string, NavPricePoint[]>,
): WalkResult {
  // Ledger in canonical order — tradeDate ASC (stable sort preserves the caller's
  // same-day createdAt order, which matters when a split shares a day with a buy).
  const txns = [...ledger].sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0));
  const symbols = [...new Set(txns.map((t) => t.symbol))];
  const symbolsNoPrice = symbols.filter((s) => (pricesBySymbol.get(s) ?? []).length === 0);

  if (txns.length === 0) return { series: [], firstDate: null, lastDate: null, symbolsNoPrice };
  const firstBuyDate = txns[0].tradeDate; // earliest tradeDate == the first buy

  // Trading-day calendar = union of close DATES (for the held symbols) on/after the
  // first buy. Non-trading days simply aren't present (natural gaps, never zero-filled).
  const dateSet = new Set<string>();
  for (const sym of symbols) {
    for (const p of pricesBySymbol.get(sym) ?? []) {
      if (p.date >= firstBuyDate) dateSet.add(p.date);
    }
  }
  const days = [...dateSet].sort();
  if (days.length === 0) return { series: [], firstDate: null, lastDate: null, symbolsNoPrice };

  // Per-symbol carry-forward pointer (index of the latest close ≤ the current day) and
  // running held quantity. Both advance monotonically as the day loop moves forward.
  const priceIdx = new Map<string, number>();
  const held = new Map<string, number>();
  for (const s of symbols) {
    priceIdx.set(s, -1);
    held.set(s, 0);
  }

  let ti = 0; // ledger cursor
  const series: WalkPoint[] = [];

  for (const day of days) {
    // 1. Advance every symbol's carry-forward pointer → its close ≤ day (null until its
    //    first close). Doing this for not-yet-held symbols is harmless (held=0 → 0 value)
    //    and keeps a fresh buy's cash-flow value consistent with how its shares enter `value`.
    const closeOf = new Map<string, number | null>();
    for (const sym of symbols) {
      const arr = pricesBySymbol.get(sym) ?? [];
      let idx = priceIdx.get(sym)!;
      while (idx + 1 < arr.length && arr[idx + 1].date <= day) idx++;
      priceIdx.set(sym, idx);
      closeOf.set(sym, idx >= 0 ? arr[idx].close : null);
    }

    // 2. Apply the day's txns. Cash flow = the buy/sell value AT THAT CLOSE (the capital
    //    that entered/left — NOT return). split/bonus scale qty (no cash), dividend no-op.
    //    A buy/sell of an unpriced symbol adds 0 to both value and cash flow (consistent).
    let cashFlow = 0;
    while (ti < txns.length && txns[ti].tradeDate <= day) {
      const t = txns[ti++];
      const cur = held.get(t.symbol) ?? 0;
      const close = closeOf.get(t.symbol) ?? null;
      if (t.type === "buy") {
        held.set(t.symbol, cur + (t.quantity ?? 0));
        if (close != null) cashFlow += (t.quantity ?? 0) * close;
      } else if (t.type === "sell") {
        held.set(t.symbol, Math.max(0, cur - (t.quantity ?? 0)));
        if (close != null) cashFlow -= (t.quantity ?? 0) * close;
      } else if (t.type === "split" || t.type === "bonus") {
        held.set(t.symbol, cur * factorOf(t.ratio));
      }
      // dividend: no register change, no cash flow
    }

    // 3. Value = Σ held × carry-forward close (unpriced held symbol → 0, honestly absent).
    let value = 0;
    for (const sym of symbols) {
      const q = held.get(sym) ?? 0;
      if (q <= 0) continue;
      const close = closeOf.get(sym);
      if (close != null) value += q * close;
    }
    series.push({ date: day, value: round2(value), cashFlow: round2(cashFlow) });
  }

  return { series, firstDate: days[0], lastDate: days[days.length - 1], symbolsNoPrice };
}

/**
 * The daily NAV series — public shape unchanged ({date, value}). A thin projection of
 * walkNav (drops cash flow). Pure + deterministic.
 */
export function computeNavSeries(
  ledger: NavLedgerTxn[],
  pricesBySymbol: Map<string, NavPricePoint[]>,
): NavSeriesResult {
  const w = walkNav(ledger, pricesBySymbol);
  return {
    series: w.series.map((p) => ({ date: p.date, value: p.value })),
    firstDate: w.firstDate,
    lastDate: w.lastDate,
    points: w.series.length,
    symbolsNoPrice: w.symbolsNoPrice,
  };
}
