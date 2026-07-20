// ─────────────────────────────────────────────────────────────────────────────
// NAV ASSEMBLE — resolve a user's book into the NAV engine's inputs, then compute.
//
// (Step 21) The series is NO LONGER equity-only. A held non-stock instrument with a stored WEEKLY
// series (instrument_price_history — corrected fund NAV / udiff close) now joins the walk: its
// weekly points are fed into pricesBySymbol and the engine's carry-forward FORWARD-FILLS them to
// daily, so the stock lines keep their daily texture while the non-stock leg steps weekly. A
// non-stock with NO series yet is still EXCLUDED and NAMED (excludedFromSeries) — never valued at 0,
// never a book that silently shrinks.
//
// THE FINAL POINT IS PINNED LIVE (Ruling C): the last point's value is replaced by the LEDGERED
// book's live value from price-resolver.ts — the SAME resolver + net quantities the overview sums —
// so the chart endpoint equals the overview by construction, not by coincidence. The stored weekly
// point (up to 6 days stale) is never the last thing the user sees.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import {
  walkNav,
  type NavLedgerTxn,
  type NavPricePoint,
  type NavSeriesResult,
  type WalkResult,
} from "./engine.js";
import { computeTwr, type TwrResult } from "./twr.js";
import { readWeeklySeries } from "../history/series-store.js";
import { computeLedgerBookValue } from "../history/live-value.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A position the NAV/TWR series CANNOT include, and why. Never silently dropped. */
export interface ExcludedFromSeries {
  symbol: string;
  assetClass: string;
  /** `no_series_yet`: a non-stock with no stored weekly series (backfilling, unpriceable, or held
   *  less than one sample period). Stocks are never excluded. */
  reason: "no_series_yet";
}

interface AssembledInputs {
  ledger: NavLedgerTxn[];
  pricesBySymbol: Map<string, NavPricePoint[]>;
  excludedFromSeries: ExcludedFromSeries[];
  /** The ledgered book's live value (₹) — the pinned final point. null ⇔ no transactions. */
  liveValue: number | null;
  /** The date that live value is "as of" ("YYYY-MM-DD"). */
  liveAsOf: string | null;
  /** True ⇔ the book holds ANY non-stock instrument (charted or excluded). Drives the 4Y picker
   *  cap (R6): a blended/fund chart never offers "All" — funds reach 4y, listed non-stocks ~2.5y,
   *  and neither should imply the full daily-equity depth. */
  blended: boolean;
}

/** Feed non-stocks by a COLLISION-PROOF key: three bonds share "IMC1", so key on the instrument id,
 *  not its symbol. Stocks keep their symbol key (byte-identical to the pre-Step-21 walk). */
const instKey = (instrumentId: string) => `inst:${instrumentId}`;

async function assembleNavInputs(userId: string, accountId?: string): Promise<AssembledInputs | null> {
  // 1. The ledger (canonical order: tradeDate ASC, then same-day createdAt ASC). An optional
  //    `accountId` narrows it to ONE account against the existing
  //    @@index([accountId, instrumentId, tradeDate, createdAt]); omitted ⇒ the whole book (unchanged).
  //    Everything downstream — the price reads (they key off the scoped ledger's instruments), the
  //    walk, `blended`, the live pin — narrows automatically to that ledger with no other change.
  const txns = await prisma.transaction.findMany({
    where: { userId, ...(accountId ? { accountId } : {}) },
    orderBy: [{ tradeDate: "asc" }, { createdAt: "asc" }],
    include: {
      stock: { select: { id: true, symbol: true } },
      instrument: { select: { id: true, symbol: true, isin: true, assetClass: true } },
    },
  });
  if (txns.length === 0) return null;

  // The live-pinned endpoint (Ruling C) — computed once, applied to both NAV and TWR. Scoped to the
  // SAME account so the pinned terminal value is that account's live value (== its page "Value").
  const live = await computeLedgerBookValue(userId, accountId);

  // ── Which held non-stocks HAVE a stored weekly series? Those join the walk; the rest are named. ──
  const nonStockIds = [...new Set(txns.filter((t) => !t.stock).map((t) => t.instrument.id))];
  const blended = nonStockIds.length > 0;
  const seriesByInstrument = await readWeeklySeries(prisma, nonStockIds);

  const excludedFromSeries: ExcludedFromSeries[] = [];
  const excludedSeen = new Set<string>();
  const priced = txns.filter((t) => {
    if (t.stock) return true; // equities: unchanged, always in
    const hasSeries = (seriesByInstrument.get(t.instrument.id)?.length ?? 0) > 0;
    if (hasSeries) return true;
    if (!excludedSeen.has(t.instrument.id)) {
      excludedSeen.add(t.instrument.id);
      excludedFromSeries.push({
        symbol: t.instrument.symbol ?? t.instrument.isin,
        assetClass: t.instrument.assetClass,
        reason: "no_series_yet",
      });
    }
    return false;
  });

  if (priced.length === 0) {
    // Nothing chartable historically (every holding is a non-stock still awaiting its series).
    return { ledger: [], pricesBySymbol: new Map(), excludedFromSeries, liveValue: live.value, liveAsOf: live.asOf, blended };
  }

  // ── LEDGER — stocks keyed by symbol (unchanged), non-stocks by a collision-proof id key. ──
  const ledger: NavLedgerTxn[] = priced.map((t) => ({
    symbol: t.stock ? t.stock.symbol : instKey(t.instrument.id),
    type: t.type,
    quantity: t.quantity != null ? Number(t.quantity) : null,
    ratio: t.ratio,
    tradeDate: iso(t.tradeDate),
  }));

  const firstBuyDate = ledger[0].tradeDate; // earliest tradeDate == the first buy of ANY held instrument
  const pricesBySymbol = new Map<string, NavPricePoint[]>();

  // ── STOCK closes from daily_prices, first-buy forward (unchanged equity path). ──
  const stockIds = [...new Set(priced.filter((t) => t.stock).map((t) => t.stock!.id))];
  if (stockIds.length > 0) {
    const symbolById = new Map(priced.filter((t) => t.stock).map((t) => [t.stock!.id, t.stock!.symbol] as const));
    for (const sym of symbolById.values()) pricesBySymbol.set(sym, []);
    const prices = await prisma.dailyPrice.findMany({
      where: { stockId: { in: stockIds }, date: { gte: new Date(firstBuyDate) } },
      orderBy: { date: "asc" },
      select: { stockId: true, date: true, close: true },
    });
    for (const p of prices) {
      const sym = symbolById.get(p.stockId);
      if (sym) pricesBySymbol.get(sym)!.push({ date: iso(p.date), close: Number(p.close) });
    }
  }

  // ── NON-STOCK weekly points from the store (already corrected). Keyed by the same id key as the
  //    ledger; the engine carry-forwards them to daily (forward-fill, never interpolation). ──
  for (const t of priced) {
    if (t.stock) continue;
    const key = instKey(t.instrument.id);
    if (pricesBySymbol.has(key)) continue; // one series per instrument
    const pts = (seriesByInstrument.get(t.instrument.id) ?? []).map((p) => ({ date: p.date, close: p.value }));
    pricesBySymbol.set(key, pts);
  }

  return { ledger, pricesBySymbol, excludedFromSeries, liveValue: live.value, liveAsOf: live.asOf, blended };
}

/** Replace the final walk point's value with the live ledgered value (append if the live date is
 *  newer than the last close). The historical points are untouched; only the endpoint is pinned. */
function pinLive(walk: WalkResult, liveValue: number | null, liveAsOf: string | null): WalkResult {
  if (liveValue == null || walk.series.length === 0) return walk;
  const series = walk.series.slice();
  const last = series[series.length - 1];
  if (liveAsOf && liveAsOf > last.date) {
    series.push({ date: liveAsOf, value: round2(liveValue), cashFlow: 0 }); // no capital moved "today"
  } else {
    series[series.length - 1] = { ...last, value: round2(liveValue) };
  }
  return { ...walk, series, lastDate: series[series.length - 1].date };
}

/** Compute the full daily NAV (₹ value) series for a user's book, endpoint pinned live. Read-only.
 *  `accountId` (optional) scopes the whole computation to one owned account; omitted ⇒ whole book. */
export async function computePortfolioNav(
  userId: string,
  accountId?: string,
): Promise<NavSeriesResult & { excludedFromSeries: ExcludedFromSeries[]; blended: boolean }> {
  const inp = await assembleNavInputs(userId, accountId);
  if (!inp) {
    return { series: [], firstDate: null, lastDate: null, points: 0, symbolsNoPrice: [], excludedFromSeries: [], blended: false };
  }
  const walk = pinLive(walkNav(inp.ledger, inp.pricesBySymbol), inp.liveValue, inp.liveAsOf);
  return {
    series: walk.series.map((p) => ({ date: p.date, value: p.value })),
    firstDate: walk.firstDate,
    lastDate: walk.lastDate,
    points: walk.series.length,
    symbolsNoPrice: walk.symbolsNoPrice,
    excludedFromSeries: inp.excludedFromSeries,
    blended: inp.blended,
  };
}

/** Compute the full time-weighted return (cash-flow-neutral) series + scalars, endpoint pinned live.
 *  `accountId` (optional) scopes the whole computation to one owned account; omitted ⇒ whole book. */
export async function computePortfolioTwr(
  userId: string,
  accountId?: string,
): Promise<TwrResult & { excludedFromSeries: ExcludedFromSeries[]; blended: boolean }> {
  const inp = await assembleNavInputs(userId, accountId);
  if (!inp) {
    return { series: [], firstDate: null, lastDate: null, totalTwrPct: null, annualizedPct: null, days: 0, excludedFromSeries: [], blended: false };
  }
  const walk = pinLive(walkNav(inp.ledger, inp.pricesBySymbol), inp.liveValue, inp.liveAsOf);
  return { ...computeTwr(walk), excludedFromSeries: inp.excludedFromSeries, blended: inp.blended };
}
