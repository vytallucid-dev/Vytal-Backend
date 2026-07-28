// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOLS: getStockShareholding · getStockDeals · getStockInsiderTrades — THREE tools, ONE read.
//
// ★ WHY THEY LIVE IN ONE FILE. buildOwnershipView serves all three: the holding split rides on `series`,
// block/bulk deals on `events.block`, insider trades on `events.insider`. They are separate TOOLS because
// they answer separate questions (and a reader asking about pledging should not be handed 25 deal rows),
// but they must not be three reads. `readOwnership` routes every one of them through ctx.once(...), so a
// conversation that asks about all three in one turn pays for ONE buildOwnershipView — and because the
// memo caches the in-flight PROMISE, that holds even when the loop executes them concurrently.
//
// BOUNDS: the source caps deals/insider at 25 in-window; these tools show the 10 most recent and SAY so.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { buildOwnershipView } from "../../scoring/read/ownership-series.service.js";
import type { OwnershipSeriesView } from "../../scoring/read/ownership-series.types.js";
import { notInUniverse } from "./boundary.js";
import { kvLine, pctPoint, croreStr, numStr, lastN, boundedNote, NA, isNum } from "./shared.js";
import type { ChatTool, ToolContext, ToolResult } from "./types.js";

interface Args {
  symbol?: unknown;
}

const WINDOW_QUARTERS = 8; // two years of the holding split — the same bound as the quarterly tool
const EVENT_CAP = 10;

/** The ONE read, memoised per turn and shared by all three tools. */
function readOwnership(ctx: ToolContext, symbol: string): Promise<OwnershipSeriesView | null> {
  return ctx.once(`ownership:${symbol}:${WINDOW_QUARTERS}`, () => buildOwnershipView(symbol, WINDOW_QUARTERS));
}

const symbolOf = (args: Args): string => (typeof args.symbol === "string" ? args.symbol.trim().toUpperCase() : "");

const SYMBOL_PARAM = {
  type: "object",
  properties: { symbol: { type: "string", description: 'NSE ticker, e.g. "RELIANCE".' } },
  required: ["symbol"],
  additionalProperties: false,
} as const;

// ── 1. SHAREHOLDING ───────────────────────────────────────────────────────────────────────────────
const SHAREHOLDING_DESCRIPTION =
  "Get who OWNS a covered stock and how that has shifted: the promoter / foreign-institutional (FII) / " +
  "domestic-institutional (DII) / retail split over the last 8 quarters, plus promoter share PLEDGING " +
  "(shares posted as loan collateral). Call this for questions about promoter stake changes, institutional " +
  "buying or selling, or pledging risk. For individual insider transactions use getStockInsiderTrades; for " +
  "large one-off trades use getStockDeals. Requires the exact NSE ticker; an uncovered symbol returns an " +
  "honest 'not covered' result.";

function renderShareholding(v: OwnershipSeriesView): string {
  const L: string[] = [`=== VYTAL SHAREHOLDING: ${v.symbol} (${v.name}) ===`];
  const points = lastN(v.series, WINDOW_QUARTERS);
  if (!points.length) {
    L.push(`No shareholding history is on file — the ownership split is ${NA}.`);
    return L.join("\n");
  }
  L.push(`Holding split by quarter, oldest → newest ${boundedNote(points.length, v.series.length, "quarters")}:`);
  // ⚠ RETAIL vs OTHERS. In the ingested source these two columns are IDENTICAL for some stocks (the same
  // figure stored twice, not two measurements). Printing both as separate labelled facts invites the model
  // to add them into a doubled "retail + others" share that no filing supports. So when they coincide we
  // state it ONCE, with the reason — the honest reading of a value we cannot separate — and print both
  // only when the source genuinely distinguishes them.
  let coincident = false;
  for (const p of points) {
    const h = p.holding;
    const same = isNum(h?.retailPct) && isNum(h?.othersPct) && Math.abs((h!.retailPct as number) - (h!.othersPct as number)) < 0.005;
    if (same) coincident = true;
    const tail = same
      ? `retail/others (reported as one figure) ${pctPoint(h?.retailPct)}`
      : `retail ${pctPoint(h?.retailPct)}, others ${pctPoint(h?.othersPct)}`;
    L.push(
      `  ${p.periodKey} (as-on ${h?.asOnDate ?? NA}): promoter ${pctPoint(h?.promoterPct)}, FII ${pctPoint(h?.fiiPct)}, ` +
        `DII ${pctPoint(h?.diiPct)}, ${tail}` +
        (isNum(h?.pledgedPctOfPromoter) ? `, promoter shares pledged ${pctPoint(h?.pledgedPctOfPromoter)} of promoter holding` : ""),
    );
  }
  if (coincident) {
    L.push(
      "Note: for this stock the source reports the retail and 'others' shares as the same single figure, so they " +
        "cannot be separated — state it as one combined non-institutional share and never add the two together.",
    );
  }
  const latestPledge = lastN(v.pledging, 1)[0] ?? null;
  L.push("");
  L.push(kvLine("Latest pledging observation", latestPledge ? `as-on ${latestPledge.asOnDate} — ${pctPoint(latestPledge.pledgedPctOfPromoter)} of promoter holding (${pctPoint(latestPledge.pledgedPctOfTotal)} of total shares)` : null));
  L.push(kvLine("Promoter-pledge red flag currently fired", v.current ? (v.current.r1Fired ? "yes" : "no") : null));
  return L.join("\n");
}

export const getStockShareholdingTool: ChatTool<Args> = {
  name: "getStockShareholding",
  klass: "read",
  description: SHAREHOLDING_DESCRIPTION,
  parameters: SYMBOL_PARAM as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const symbol = symbolOf(args);
    if (!symbol) return { ok: false, error: "getStockShareholding requires a non-empty 'symbol' string (an NSE ticker)." };
    try {
      const v = await readOwnership(ctx, symbol);
      if (!v) return { ok: true, content: notInUniverse(symbol) };
      return { ok: true, content: renderShareholding(v) };
    } catch (e) {
      return { ok: false, error: `Could not read shareholding for ${symbol}: ${(e as Error).message}` };
    }
  },
};

// ── 2. BLOCK / BULK DEALS ─────────────────────────────────────────────────────────────────────────
const DEALS_DESCRIPTION =
  "Get recent BLOCK and BULK deals in a covered stock — large single trades reported to the exchange, with " +
  "the counterparty name, side (buy or sell), quantity and value. Call this when the reader asks who has been " +
  "buying or selling big stakes, or about a specific large transaction. These are exchange-reported market " +
  "trades by any large participant; they are NOT insider disclosures (use getStockInsiderTrades) and NOT the " +
  "quarterly ownership split (use getStockShareholding). Shows the 10 most recent in a two-year window. " +
  "Requires the exact NSE ticker.";

function renderDeals(v: OwnershipSeriesView): string {
  const L: string[] = [`=== VYTAL BLOCK / BULK DEALS: ${v.symbol} (${v.name}) ===`];
  const all = v.events.block;
  if (!all.length) {
    L.push("No block or bulk deals are on file for this stock in the last two years. (An absence of deals is a real, informative state — not missing data.)");
    return L.join("\n");
  }
  const shown = all.slice(0, EVENT_CAP); // source is newest-first
  L.push(`Showing the ${shown.length} most recent of ${all.length} deal(s) on file (newest first; the source caps this window at 25):`);
  for (const d of shown) {
    L.push(`  ${d.dealDate} · ${d.dealType} · ${d.transactionType.toUpperCase()} · ${d.clientName} — ${numStr(Number(d.quantity), 0)} shares at ₹${numStr(d.price)}${isNum(d.valueCr) ? `, value ${croreStr(d.valueCr)}` : `, value ${NA}`}`);
  }
  return L.join("\n");
}

export const getStockDealsTool: ChatTool<Args> = {
  name: "getStockDeals",
  klass: "read",
  description: DEALS_DESCRIPTION,
  parameters: SYMBOL_PARAM as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const symbol = symbolOf(args);
    if (!symbol) return { ok: false, error: "getStockDeals requires a non-empty 'symbol' string (an NSE ticker)." };
    try {
      const v = await readOwnership(ctx, symbol);
      if (!v) return { ok: true, content: notInUniverse(symbol) };
      return { ok: true, content: renderDeals(v) };
    } catch (e) {
      return { ok: false, error: `Could not read deals for ${symbol}: ${(e as Error).message}` };
    }
  },
};

// ── 3. INSIDER TRADES ─────────────────────────────────────────────────────────────────────────────
const INSIDER_DESCRIPTION =
  "Get recent INSIDER transactions in a covered stock — trades disclosed under SEBI's insider-trading rules " +
  "by promoters, directors, key management and their relatives, with the person, their category, the type " +
  "(buy, sell, pledge, revoke-pledge, ESOP) and the value. Call this when the reader asks whether management " +
  "or promoters have been buying or selling their own shares. These are regulatory disclosures by people " +
  "connected to the company — distinct from open-market block/bulk deals (getStockDeals) and from the " +
  "quarterly ownership split (getStockShareholding). Shows the 10 most recent in a two-year window. " +
  "Requires the exact NSE ticker.";

function renderInsider(v: OwnershipSeriesView): string {
  const L: string[] = [`=== VYTAL INSIDER TRADES: ${v.symbol} (${v.name}) ===`];
  const all = v.events.insider;
  if (!all.length) {
    L.push("No insider transactions are on file for this stock in the last two years. (An absence of disclosures is a real, informative state — not missing data.)");
    return L.join("\n");
  }
  const shown = all.slice(0, EVENT_CAP); // source is newest-first
  L.push(`Showing the ${shown.length} most recent of ${all.length} disclosure(s) on file (newest first; the source caps this window at 25):`);
  for (const t of shown) {
    L.push(
      `  ${t.tradeDate ?? NA} · ${t.personName} (${t.personCategory}) · ${t.transactionType} · ` +
        `${t.securitiesTraded ? `${numStr(Number(t.securitiesTraded), 0)} shares` : `${NA} shares`}` +
        `${isNum(t.tradeValueCr) ? `, value ${croreStr(t.tradeValueCr)}` : ""}` +
        `${isNum(t.holdingPctDelta) ? `, holding change ${numStr(t.holdingPctDelta, 4)} pp` : ""}` +
        ` · mode ${t.acquisitionMode ?? NA} · regulation ${t.regulation}`,
    );
  }
  return L.join("\n");
}

export const getStockInsiderTradesTool: ChatTool<Args> = {
  name: "getStockInsiderTrades",
  klass: "read",
  description: INSIDER_DESCRIPTION,
  parameters: SYMBOL_PARAM as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const symbol = symbolOf(args);
    if (!symbol) return { ok: false, error: "getStockInsiderTrades requires a non-empty 'symbol' string (an NSE ticker)." };
    try {
      const v = await readOwnership(ctx, symbol);
      if (!v) return { ok: true, content: notInUniverse(symbol) };
      return { ok: true, content: renderInsider(v) };
    } catch (e) {
      return { ok: false, error: `Could not read insider trades for ${symbol}: ${(e as Error).message}` };
    }
  },
};
