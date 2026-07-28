// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getStockFundamentals — the latest annual + latest quarter headline financials.
//
// FIVE FAMILIES, ONE RENDERER. buildFundamentalsView dispatches on industryType (non-financial / banking /
// nbfc / life insurance / general insurance) and populates exactly one payload; a bank's headline numbers
// (NIM, GNPA, capital adequacy) are not a manufacturer's (margins, ROCE, debt/equity). Rather than five
// renderers, the family's headline fields are declared as [label, key] tables below and read off the
// payload — so an unmapped field is honestly "not available" instead of silently missing.
//
// SHARES ITS READ. buildFundamentalsView also backs getStockQuarterlyResults; both go through
// ctx.once(...) so a conversation asking for fundamentals AND quarterly results pays for ONE read.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { buildFundamentalsView } from "../../scoring/read/fundamentals-view.service.js";
import type { FundamentalsView } from "../../scoring/read/fundamentals-view.types.js";
import { notInUniverse } from "./boundary.js";
import { kvLine, croreStr, pctPoint, numStr, signedPct, NA } from "./shared.js";
import type { ChatTool, ToolContext, ToolResult } from "./types.js";

interface Args {
  symbol?: unknown;
  basis?: unknown;
}

const DESCRIPTION =
  "Get a covered stock's headline FINANCIALS: the latest full-year figures (profitability, growth, leverage, " +
  "cash) and the latest reported quarter, in the shape appropriate to its industry — a bank reports net " +
  "interest margin, bad-loan ratios and capital adequacy where a manufacturer reports operating margin, " +
  "return on capital and debt-to-equity. Call this when the reader asks what the company actually earns, " +
  "owes or converts to cash. For the quarter-by-quarter TREND use getStockQuarterlyResults; for Vytal's " +
  "health SCORE use getStockFacts. Requires the exact NSE ticker. An uncovered symbol returns an honest " +
  "'not covered' result, and any figure the company does not disclose reads 'not available'.";

const PARAMETERS = {
  type: "object",
  properties: {
    symbol: { type: "string", description: 'NSE ticker, e.g. "HDFCBANK".' },
    basis: { type: "string", enum: ["consolidated", "standalone"], description: "Optional reporting basis; defaults to whichever the company primarily reports." },
  },
  required: ["symbol"],
  additionalProperties: false,
} as const;

type Row = Record<string, unknown>;
type Field = [label: string, key: string, kind: "pct" | "money_cr" | "num" | "ratio" | "signed_pct"];

const fmt = (v: unknown, kind: Field[2]): string =>
  kind === "pct" ? pctPoint(v) : kind === "signed_pct" ? signedPct(v) : kind === "money_cr" ? croreStr(v) : kind === "ratio" ? numStr(v, 2) : numStr(v, 2);

/** Headline ANNUAL fields per family. */
const ANNUAL_FIELDS: Record<string, Field[]> = {
  non_financial: [
    ["Return on equity", "roe", "pct"], ["Return on capital employed", "roce", "pct"],
    ["Operating margin", "operatingMargin", "pct"], ["Net margin", "netMargin", "pct"],
    ["Revenue growth YoY", "revenueGrowthYoy", "signed_pct"], ["Profit growth YoY", "profitGrowthYoy", "signed_pct"],
    ["Debt to equity", "debtToEquity", "ratio"], ["Interest coverage", "interestCoverage", "ratio"],
    ["Current ratio", "currentRatio", "ratio"], ["Net profit", "netProfit", "money_cr"],
    ["Free cash flow", "fcf", "money_cr"], ["Cash from operations", "cashFromOperating", "money_cr"],
    ["Dividend payout", "dividendPayout", "pct"],
  ],
  banking: [
    ["Return on equity", "roe", "pct"], ["Return on assets (disclosed)", "roaDisclosed", "pct"],
    ["Net interest margin", "nim", "pct"], ["Cost to income", "costToIncome", "pct"],
    ["Credit cost", "creditCostPct", "pct"], ["Net interest income", "nii", "money_cr"],
    ["Other income", "otherIncome", "money_cr"], ["Pre-provision operating profit", "ppop", "money_cr"],
    ["Provisions", "provisions", "money_cr"],
  ],
  nbfc: [
    ["Return on equity", "roe", "pct"], ["Return on assets", "roa", "pct"],
    ["Net interest margin", "nim", "pct"], ["Net interest income", "nii", "money_cr"],
    ["Provisions", "provisions", "money_cr"],
  ],
  life_insurance: [
    ["Solvency ratio", "solvencyRatio", "ratio"], ["Net premium income", "netPremiumIncome", "money_cr"],
    ["Profit after tax", "profitAfterTax", "money_cr"],
  ],
  general_insurance: [
    ["Combined ratio", "combinedRatio", "pct"], ["Solvency ratio", "solvencyRatio", "ratio"],
    ["Net premium income", "netPremiumIncome", "money_cr"], ["Profit after tax", "profitAfterTax", "money_cr"],
  ],
};

/** Headline LATEST-QUARTER fields per family. */
const QUARTER_FIELDS: Record<string, Field[]> = {
  non_financial: [
    ["Revenue", "revenue", "money_cr"], ["Operating profit", "operatingProfit", "money_cr"],
    ["Net profit", "netProfit", "money_cr"], ["Operating margin", "operatingMargin", "pct"],
    ["Net margin", "netMargin", "pct"], ["Revenue YoY", "revenueYoy", "signed_pct"], ["Profit YoY", "profitYoy", "signed_pct"],
  ],
  banking: [
    ["Net interest income", "nii", "money_cr"], ["Total income", "totalIncome", "money_cr"],
    ["Pre-provision operating profit", "ppop", "money_cr"], ["Provisions", "provisions", "money_cr"],
    ["Net profit", "netProfit", "money_cr"], ["Gross NPA", "gnpaPct", "pct"], ["Net NPA", "nnpaPct", "pct"],
    ["Provision coverage ratio", "pcr", "pct"], ["CET1 capital", "cet1", "pct"], ["Tier-1 capital", "tier1", "pct"],
  ],
  nbfc: [
    ["Net interest income", "nii", "money_cr"], ["Net profit", "netProfit", "money_cr"],
    ["Gross NPA", "gnpaPct", "pct"], ["Net NPA", "nnpaPct", "pct"],
  ],
  life_insurance: [["Net premium income", "netPremiumIncome", "money_cr"], ["Profit after tax", "profitAfterTax", "money_cr"]],
  general_insurance: [["Net premium income", "netPremiumIncome", "money_cr"], ["Profit after tax", "profitAfterTax", "money_cr"], ["Combined ratio", "combinedRatio", "pct"]],
};

/** The one populated family payload (they are mutually exclusive by construction). */
export function familyPayload(v: FundamentalsView): { quarters: Row[]; annual: Row | null; yields: Row | null } | null {
  const p = (v.nonFinancial ?? v.banking ?? v.nbfc ?? v.lifeInsurance ?? v.generalInsurance) as Row | null;
  if (!p) return null;
  return {
    quarters: (p.quarters as Row[] | undefined) ?? [],
    annual: (p.annual as Row | null | undefined) ?? null,
    yields: (p.yields as Row | null | undefined) ?? null,
  };
}

/** Shared, memoised read — getStockQuarterlyResults uses the SAME entry so one turn pays once. */
export function readFundamentals(ctx: ToolContext, symbol: string, basis?: "consolidated" | "standalone") {
  return ctx.once(`fundamentals:${symbol}:${basis ?? "default"}`, () => buildFundamentalsView(symbol, basis ? { basis } : {}));
}

function render(v: FundamentalsView): string {
  const L: string[] = [`=== VYTAL FUNDAMENTALS: ${v.symbol} (${v.name}) ===`];
  L.push(kvLine("Industry family", v.family));
  L.push(kvLine("Reporting basis", v.basis));
  L.push(kvLine("Bases available", v.basisAvailable.length ? v.basisAvailable.join(", ") : null));
  L.push(kvLine("History depth", `${v.historyDepth.quarters} quarters, ${v.historyDepth.years} years`));
  if (v.notes.length) L.push(`Data notes: ${v.notes.join(" · ")}`);

  if (!v.built) {
    L.push(`Detailed financials for the ${v.family} family are not yet built in Vytal — the figures are ${NA}. Say so plainly rather than estimating.`);
    return L.join("\n");
  }
  const p = familyPayload(v);
  if (!p) {
    L.push(`No financial payload is on file — figures are ${NA}.`);
    return L.join("\n");
  }

  const aFields = ANNUAL_FIELDS[v.family] ?? [];
  L.push("");
  if (p.annual) {
    L.push(`[LATEST FULL YEAR — ${String(p.annual.fiscalYear ?? NA)}]`);
    for (const [label, key, kind] of aFields) L.push(kvLine(label, fmt(p.annual[key], kind)));
  } else {
    L.push(`[LATEST FULL YEAR] ${NA} — no annual statement on file.`);
  }

  const latestQ = p.quarters.length ? p.quarters[p.quarters.length - 1] : null;
  const qFields = QUARTER_FIELDS[v.family] ?? [];
  L.push("");
  if (latestQ) {
    L.push(`[LATEST QUARTER — ${String(latestQ.periodKey ?? NA)} (reported ${String(latestQ.reportDate ?? NA)})]`);
    for (const [label, key, kind] of qFields) L.push(kvLine(label, fmt(latestQ[key], kind)));
  } else {
    L.push(`[LATEST QUARTER] ${NA} — no quarterly results on file.`);
  }

  if (p.yields) {
    L.push("");
    L.push("[YIELDS vs CURRENT MARKET CAP]");
    L.push(kvLine("Market capitalisation", croreStr(p.yields.marketCap)));
    L.push(kvLine("Free-cash-flow yield", pctPoint(p.yields.fcfYield)));
    L.push(kvLine("Dividend yield", pctPoint(p.yields.dividendYield)));
    L.push(kvLine("Basis", p.yields.asOfBasis));
  }
  L.push("");
  L.push("(Headline figures only — call getStockQuarterlyResults for the quarter-by-quarter trend.)");
  return L.join("\n");
}

export const getStockFundamentalsTool: ChatTool<Args> = {
  name: "getStockFundamentals",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const symbol = typeof args.symbol === "string" ? args.symbol.trim().toUpperCase() : "";
    if (!symbol) return { ok: false, error: "getStockFundamentals requires a non-empty 'symbol' string (an NSE ticker)." };
    const basis = args.basis === "consolidated" || args.basis === "standalone" ? args.basis : undefined;
    try {
      const view = await readFundamentals(ctx, symbol, basis);
      if (!view) return { ok: true, content: notInUniverse(symbol) };
      return { ok: true, content: render(view) };
    } catch (e) {
      return { ok: false, error: `Could not read fundamentals for ${symbol}: ${(e as Error).message}` };
    }
  },
};
