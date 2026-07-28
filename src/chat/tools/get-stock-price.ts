// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getStockPrice — current price, 52-week range position, and trailing returns vs benchmark/sector.
//
// ⚠ THE ~820-POINT DAILY SERIES IS DROPPED. buildPriceView returns up to ~3.2 years of daily closes for
// the stock AND for two index lines — thousands of points that would dominate the context and that a
// conversation never needs point-by-point. We keep the CURRENT state and the per-window RETURNS (which
// are what the series was going to be used to say anyway) and state the coverage depth honestly instead.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { buildPriceView } from "../../scoring/read/price-view.service.js";
import type { PriceReturnSet, StockPriceView } from "../../scoring/read/price-view.types.js";
import { notInUniverse } from "./boundary.js";
import { kvLine, croreStr, signedPct, numStr, NA, isNum } from "./shared.js";
import type { ChatTool, ToolResult } from "./types.js";

interface Args {
  symbol?: unknown;
}

const DESCRIPTION =
  "Get a covered stock's CURRENT share price, its position in its 52-week range, and its trailing returns " +
  "(1m/3m/6m/1y/3y) alongside the Nifty 50 and its sector index for comparison. Call this for questions about " +
  "price, market value, recent moves, or how a stock has performed versus the market — NOT for health or " +
  "fundamentals (use getStockFacts). This is backward-looking price behaviour only: it says nothing about " +
  "what the price will do next. Requires the exact NSE ticker (use searchStocks first if you only have a " +
  "name). An uncovered symbol returns an honest 'not covered' result.";

const PARAMETERS = {
  type: "object",
  properties: { symbol: { type: "string", description: 'NSE ticker, e.g. "TCS".' } },
  required: ["symbol"],
  additionalProperties: false,
} as const;

const returnsLine = (r: PriceReturnSet): string =>
  `1m ${signedPct(r.r1m)} · 3m ${signedPct(r.r3m)} · 6m ${signedPct(r.r6m)} · 1y ${signedPct(r.r1y)} · 3y ${signedPct(r.r3y)}`;

function render(v: StockPriceView): string {
  const L: string[] = [`=== VYTAL PRICE: ${v.symbol} (${v.name}) ===`];
  L.push(kvLine("As-of date", v.asOfDate));
  if (!v.hasPrice) {
    L.push("No price data is on file for this stock — price, range and returns are all not available.");
    return L.join("\n");
  }
  const c = v.current;
  L.push(kvLine("Current price", isNum(c.price) ? `₹${numStr(c.price)}` : null));
  L.push(kvLine("Change on the day", signedPct(c.dayChangePct)));
  L.push(kvLine("Market capitalisation", isNum(c.marketCap) ? croreStr(c.marketCap) : null));
  L.push(kvLine("52-week high", isNum(c.week52High) ? `₹${numStr(c.week52High)}` : null));
  L.push(kvLine("52-week low", isNum(c.week52Low) ? `₹${numStr(c.week52Low)}` : null));
  L.push(kvLine("Distance from 52-week high", signedPct(c.pctFrom52WHigh)));
  L.push(kvLine("Distance from 52-week low", signedPct(c.pctFrom52WLow)));
  L.push(`Trailing returns — ${v.symbol}: ${returnsLine(v.stock.returns)}`);
  L.push(
    v.benchmark
      ? `Trailing returns — benchmark ${v.benchmark.label}: ${returnsLine(v.benchmark.returns)}`
      : kvLine("Trailing returns — benchmark", null),
  );
  L.push(
    v.sector
      ? `Trailing returns — sector index ${v.sector.label}: ${returnsLine(v.sector.returns)}`
      : kvLine("Trailing returns — sector index", null),
  );
  L.push(`Price-history depth: ${v.stock.coverageDays} trading days on file (the daily series itself is not included here; a return shown as "${NA}" means history does not reach back that far).`);
  return L.join("\n");
}

export const getStockPriceTool: ChatTool<Args> = {
  name: "getStockPrice",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args): Promise<ToolResult> {
    const symbol = typeof args.symbol === "string" ? args.symbol.trim().toUpperCase() : "";
    if (!symbol) return { ok: false, error: "getStockPrice requires a non-empty 'symbol' string (an NSE ticker such as TCS)." };
    try {
      const view = await buildPriceView(symbol);
      if (!view) return { ok: true, content: notInUniverse(symbol) };
      return { ok: true, content: render(view) };
    } catch (e) {
      return { ok: false, error: `Could not read price for ${symbol}: ${(e as Error).message}` };
    }
  },
};
