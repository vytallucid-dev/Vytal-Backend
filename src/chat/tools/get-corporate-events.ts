// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getCorporateEvents — scheduled/past corporate actions for one covered stock.
//
// Reads buildCorporateEventsView (scoring/read/corporate-events.service.ts) — the query EXTRACTED from
// events-controllers.ts so the endpoint and this tool share one read. Bounded by the service's own
// 730-day clamp; the list is further capped here and the cap is stated.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { buildCorporateEventsView } from "../../scoring/read/corporate-events.service.js";
import type { CorporateEventsView } from "../../scoring/read/corporate-events.service.js";
import { notInUniverse } from "./boundary.js";
import { kvLine, numStr, NA, isNum } from "./shared.js";
import type { ChatTool, ToolResult } from "./types.js";

interface Args {
  symbol?: unknown;
  upcoming?: unknown;
  days?: unknown;
}

const CAP = 15;
const DEFAULT_DAYS = 365;

const DESCRIPTION =
  "Get scheduled or past CORPORATE EVENTS for a covered stock — earnings dates, dividends (with amount and " +
  "ex-date), bonus issues, stock splits, board meetings and AGMs. Call this when the reader asks what is " +
  "coming up for a company, when results are due, or about a dividend or split. Set upcoming=false to look " +
  "BACKWARD at events that already happened. Dates marked unconfirmed are exchange-indicated and can move — " +
  "say so rather than presenting them as fixed. This is calendar data only: it carries no view on the share " +
  "price. Requires the exact NSE ticker.";

const PARAMETERS = {
  type: "object",
  properties: {
    symbol: { type: "string", description: 'NSE ticker, e.g. "ITC".' },
    upcoming: { type: "boolean", description: "true (default) = events in the next `days`; false = events in the last `days`." },
    days: { type: "integer", description: `Optional window size in days (default ${DEFAULT_DAYS}, maximum 730).` },
  },
  required: ["symbol"],
  additionalProperties: false,
} as const;

function render(v: CorporateEventsView, upcoming: boolean, days: number): string {
  const L: string[] = [`=== VYTAL CORPORATE EVENTS: ${v.symbol} (${v.name}) ===`];
  L.push(`Window: ${upcoming ? "upcoming" : "past"} ${days} days.`);
  if (!v.events.length) {
    L.push(`No ${upcoming ? "upcoming" : "past"} corporate events are on file in this window. (A real, informative state — not missing data.)`);
    return L.join("\n");
  }
  const shown = v.events.slice(0, CAP);
  L.push(`Events: ${shown.length}${v.events.length > CAP ? ` (showing the first ${CAP} of ${v.events.length})` : ""}, in date order.`);
  for (const e of shown) {
    const extras: string[] = [];
    if (isNum(e.dividendAmount)) extras.push(`dividend ₹${numStr(e.dividendAmount)}/share${e.dividendType ? ` (${e.dividendType})` : ""}`);
    if (e.bonusRatio) extras.push(`bonus ratio ${e.bonusRatio}`);
    if (e.splitRatio) extras.push(`split ratio ${e.splitRatio}`);
    if (e.exDate) extras.push(`ex-date ${e.exDate}`);
    if (e.recordDate) extras.push(`record date ${e.recordDate}`);
    L.push(
      `  ${e.eventDate} · ${e.eventType} · impact ${e.impactLevel ?? NA} · ${e.isConfirmed ? "confirmed" : "NOT confirmed (exchange-indicated, may move)"}` +
        (extras.length ? ` — ${extras.join(", ")}` : "") +
        (e.description ? ` — ${e.description}` : ""),
    );
  }
  L.push(kvLine("Total events in window", v.events.length));
  return L.join("\n");
}

export const getCorporateEventsTool: ChatTool<Args> = {
  name: "getCorporateEvents",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args): Promise<ToolResult> {
    const symbol = typeof args.symbol === "string" ? args.symbol.trim().toUpperCase() : "";
    if (!symbol) return { ok: false, error: "getCorporateEvents requires a non-empty 'symbol' string (an NSE ticker)." };
    const upcoming = args.upcoming !== false;
    const days = Math.max(1, Math.min(typeof args.days === "number" ? args.days : DEFAULT_DAYS, 730));
    try {
      const view = await buildCorporateEventsView(symbol, { upcoming, days });
      if (!view) return { ok: true, content: notInUniverse(symbol) };
      return { ok: true, content: render(view, upcoming, days) };
    } catch (e) {
      return { ok: false, error: `Could not read corporate events for ${symbol}: ${(e as Error).message}` };
    }
  },
};
