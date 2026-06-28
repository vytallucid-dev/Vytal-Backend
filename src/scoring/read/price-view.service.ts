// File: src/scoring/read/price-view.service.ts
//
// THE per-stock price-performance assembler for the Overview tab (§1 price line, §2
// Price Performance). Bundles the stock's own price series + the broad benchmark
// (Nifty 50) + the stock's SECTOR index into one DISPLAY view. Computes per-window
// returns consistently from each series so stock and index are apples-to-apples;
// honest-empties (null) any line or window the data can't support — never fabricates.
//
// No verdict, no momentum language, no valuation lens — this view states price facts.

import { prisma } from "../../db/prisma.js";
import type {
  StockPriceView,
  IndexLine,
  PriceReturnSet,
  PriceSeriesPoint,
} from "./price-view.types.js";

const DAY_MS = 86_400_000;
const num = (v: unknown): number | null =>
  v == null ? null : typeof (v as { toString(): string }).toString === "function" ? parseFloat((v as { toString(): string }).toString()) : Number(v);
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** The broad-market benchmark every stock is compared against. */
const BENCHMARK_INDEX = "Nifty 50";

/** Sector.name → the NSE sector index in `index_prices` (exact indexName). The most
 *  accurate sector match is chosen; where the precise index has only days of history
 *  (Power/Insurance/Capital Goods/Cement/Hospitality) the per-window returns simply
 *  honest-empty for windows the series can't reach — never extrapolated. */
export const SECTOR_INDEX_MAP: Record<string, string> = {
  automobile: "Nifty Auto",
  banks: "Nifty Bank",
  capital_goods_engineering: "Nifty Capital Goods",
  capital_markets: "Nifty Capital Markets",
  cement_construction: "Nifty Cement",
  chemicals_agrochemicals: "Nifty Chemicals",
  consumer_discretionary_retail: "Nifty Consumer Durables",
  fmcg_consumer: "Nifty FMCG",
  hospitality_travel: "Nifty Consumer Services",
  insurance: "Nifty Insurance",
  it_technology: "Nifty IT",
  logistics_infrastructure: "Nifty India Infrastructure & Logistics",
  metals_mining: "Nifty Metal",
  nbfc: "Nifty Financial Services Ex-Bank",
  new_economy_internet: "Nifty India Digital",
  oil_gas_energy: "Nifty Oil & Gas",
  pharma_healthcare: "Nifty Pharma",
  power: "Nifty Power",
  real_estate: "Nifty Realty",
  telecom: "Nifty Telecommunications",
};

const WINDOW_DAYS = { r1m: 30, r3m: 91, r6m: 182, r1y: 365, r3y: 1095 } as const;

/** % return over a trailing window, measured from the close on-or-before (latest−days).
 *  null when the series doesn't reach that far back — an honest "can't measure" rather
 *  than a misleading short-window number. Series is oldest→newest. */
function pctReturn(series: PriceSeriesPoint[], days: number): number | null {
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  const targetMs = new Date(latest.date).getTime() - days * DAY_MS;
  let base: PriceSeriesPoint | null = null;
  for (const p of series) {
    if (new Date(p.date).getTime() <= targetMs) base = p;
    else break; // ascending — no later point can qualify
  }
  if (!base || base.close <= 0) return null;
  return round2((latest.close / base.close - 1) * 100);
}

function returnsOf(series: PriceSeriesPoint[]): PriceReturnSet {
  return {
    r1m: pctReturn(series, WINDOW_DAYS.r1m),
    r3m: pctReturn(series, WINDOW_DAYS.r3m),
    r6m: pctReturn(series, WINDOW_DAYS.r6m),
    r1y: pctReturn(series, WINDOW_DAYS.r1y),
    r3y: pctReturn(series, WINDOW_DAYS.r3y),
  };
}

/** Load an index's series (oldest→newest) + computed per-window returns, or null when
 *  the index has no rows at all. Windowed to ≤~3.2Y so a deep index doesn't bloat the payload. */
async function loadIndexLine(indexName: string, label: string): Promise<IndexLine | null> {
  const rows = await prisma.indexPrice.findMany({
    where: { indexName },
    orderBy: { date: "desc" },
    take: 820,
    select: { date: true, close: true },
  });
  if (rows.length === 0) return null;
  const series: PriceSeriesPoint[] = rows
    .map((r) => ({ date: ymd(r.date), close: num(r.close) ?? 0 }))
    .reverse();
  return { indexName, label, series, returns: returnsOf(series), coverageDays: series.length };
}

/**
 * Build the price view for one stock. Returns null when the symbol is unknown
 * (→ controller 404). A stock with no price rows returns hasPrice=false with empty
 * series so the tab honest-empties §1's price line and §2 rather than blanking.
 */
export async function buildPriceView(symbol: string): Promise<StockPriceView | null> {
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true, symbol: true, name: true, sector: { select: { name: true, displayName: true } } },
  });
  if (!stock) return null;

  const [snapshot, dailyDesc] = await Promise.all([
    prisma.stockPrice.findUnique({
      where: { stockId: stock.id },
      select: {
        price: true,
        dayChangePct: true,
        marketCap: true,
        week52High: true,
        week52Low: true,
        priceDate: true,
      },
    }),
    prisma.dailyPrice.findMany({
      where: { stockId: stock.id },
      orderBy: { date: "desc" },
      take: 820, // ≈3.2Y of trading days — enough for the r3y window + the 3Y chart
      select: { date: true, close: true },
    }),
  ]);

  const stockSeries: PriceSeriesPoint[] = dailyDesc
    .map((r) => ({ date: ymd(r.date), close: num(r.close) ?? 0 }))
    .reverse();

  const hasPrice = stockSeries.length > 0 || snapshot != null;

  const price = num(snapshot?.price);
  const week52High = num(snapshot?.week52High);
  const week52Low = num(snapshot?.week52Low);
  const dayChangeFrac = num(snapshot?.dayChangePct); // stored as a fraction
  const asOfDate = snapshot?.priceDate
    ? ymd(snapshot.priceDate)
    : stockSeries.length
      ? stockSeries[stockSeries.length - 1].date
      : null;

  // Benchmark + sector index lines (parallel). Sector resolves through the map; an
  // unmapped sector yields a null sector line (honest-empty, not an error).
  const sectorIndexName = stock.sector?.name ? SECTOR_INDEX_MAP[stock.sector.name] ?? null : null;
  const [benchmark, sector] = await Promise.all([
    loadIndexLine(BENCHMARK_INDEX, BENCHMARK_INDEX),
    sectorIndexName ? loadIndexLine(sectorIndexName, sectorIndexName) : Promise.resolve(null),
  ]);

  return {
    symbol: stock.symbol,
    name: stock.name,
    hasPrice,
    asOfDate,
    current: {
      price,
      dayChangePct: dayChangeFrac == null ? null : round2(dayChangeFrac * 100),
      marketCap: num(snapshot?.marketCap),
      week52High,
      week52Low,
      pctFrom52WHigh:
        price != null && week52High != null && week52High > 0 ? round2((price / week52High - 1) * 100) : null,
      pctFrom52WLow:
        price != null && week52Low != null && week52Low > 0 ? round2((price / week52Low - 1) * 100) : null,
    },
    stock: { series: stockSeries, returns: returnsOf(stockSeries), coverageDays: stockSeries.length },
    benchmark,
    sector,
  };
}
