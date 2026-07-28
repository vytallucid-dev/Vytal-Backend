// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getStockQuarterlyResults — the quarter-by-quarter trend, BOUNDED to the last 8.
//
// ⚠ THE SOURCE SERIES IS UNBOUNDED. buildFundamentalsView returns EVERY quarter on file for the chosen
// basis (orderBy asc, no take) — for a long-listed company that is dozens of rows and thousands of tokens.
// Eight quarters is two full years: enough to see a trend and its seasonality, and the window a reader
// actually asks about. The bound is STATED in the output so the model never implies it saw everything.
//
// SHARES ITS READ with getStockFundamentals via ctx.once — one turn, one buildFundamentalsView call.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { FundamentalsView } from "../../scoring/read/fundamentals-view.types.js";
import { notInUniverse } from "./boundary.js";
import { familyPayload, readFundamentals } from "./get-stock-fundamentals.js";
import { kvLine, croreStr, pctPoint, signedPct, lastN, boundedNote, NA } from "./shared.js";
import type { ChatTool, ToolResult } from "./types.js";

interface Args {
  symbol?: unknown;
  quarters?: unknown;
  basis?: unknown;
}

const DEFAULT_QUARTERS = 8;
const MAX_QUARTERS = 12;

const DESCRIPTION =
  "Get a covered stock's recent quarterly results as a TREND — the last 8 quarters by default (two years, " +
  "so year-on-year seasonality is visible), up to 12. Each row carries the period, the top line, profit and " +
  "margins in the shape its industry reports. Call this when the reader asks how results have moved — " +
  "'are margins improving?', 'how was the last quarter versus a year ago?', 'has growth slowed?' — rather " +
  "than for a single snapshot (getStockFundamentals) or Vytal's health score (getStockFacts). The series is " +
  "deliberately capped; the output states how many quarters exist in total. Requires the exact NSE ticker.";

const PARAMETERS = {
  type: "object",
  properties: {
    symbol: { type: "string", description: 'NSE ticker, e.g. "INFY".' },
    quarters: { type: "integer", description: `Optional. How many recent quarters to return (1-${MAX_QUARTERS}, default ${DEFAULT_QUARTERS}).` },
    basis: { type: "string", enum: ["consolidated", "standalone"], description: "Optional reporting basis." },
  },
  required: ["symbol"],
  additionalProperties: false,
} as const;

type Row = Record<string, unknown>;

/** Per-family quarter line — the same family split as getStockFundamentals, one line per period. */
function quarterLine(family: string, q: Row): string {
  const head = `  ${String(q.periodKey ?? NA)} (reported ${String(q.reportDate ?? NA)}): `;
  if (family === "banking" || family === "nbfc") {
    return (
      head +
      `net interest income ${croreStr(q.nii)}, net profit ${croreStr(q.netProfit)}, ` +
      `gross NPA ${pctPoint(q.gnpaPct)}, net NPA ${pctPoint(q.nnpaPct)}` +
      (family === "banking" ? `, provisions ${croreStr(q.provisions)}` : "")
    );
  }
  if (family === "life_insurance" || family === "general_insurance") {
    return head + `net premium income ${croreStr(q.netPremiumIncome)}, profit after tax ${croreStr(q.profitAfterTax)}`;
  }
  return (
    head +
    `revenue ${croreStr(q.revenue)}, operating profit ${croreStr(q.operatingProfit)}, net profit ${croreStr(q.netProfit)}, ` +
    `operating margin ${pctPoint(q.operatingMargin)}, net margin ${pctPoint(q.netMargin)}, ` +
    `revenue YoY ${signedPct(q.revenueYoy)}, profit YoY ${signedPct(q.profitYoy)}`
  );
}

function render(v: FundamentalsView, want: number): string {
  const L: string[] = [`=== VYTAL QUARTERLY RESULTS: ${v.symbol} (${v.name}) ===`];
  L.push(kvLine("Industry family", v.family));
  L.push(kvLine("Reporting basis", v.basis));

  const p = familyPayload(v);
  const all = p?.quarters ?? [];
  if (!v.built || !all.length) {
    L.push(`No quarterly results are on file for this stock — the series is ${NA}.`);
    return L.join("\n");
  }
  const shown = lastN(all, want);
  L.push(`Quarters shown: ${shown.length} ${boundedNote(shown.length, all.length, "quarters")}, oldest → newest.`);
  L.push("");
  for (const q of shown) L.push(quarterLine(v.family, q));
  return L.join("\n");
}

export const getStockQuarterlyResultsTool: ChatTool<Args> = {
  name: "getStockQuarterlyResults",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const symbol = typeof args.symbol === "string" ? args.symbol.trim().toUpperCase() : "";
    if (!symbol) return { ok: false, error: "getStockQuarterlyResults requires a non-empty 'symbol' string (an NSE ticker)." };
    const want = Math.max(1, Math.min(typeof args.quarters === "number" ? args.quarters : DEFAULT_QUARTERS, MAX_QUARTERS));
    const basis = args.basis === "consolidated" || args.basis === "standalone" ? args.basis : undefined;
    try {
      const view = await readFundamentals(ctx, symbol, basis);
      if (!view) return { ok: true, content: notInUniverse(symbol) };
      return { ok: true, content: render(view, want) };
    } catch (e) {
      return { ok: false, error: `Could not read quarterly results for ${symbol}: ${(e as Error).message}` };
    }
  },
};
