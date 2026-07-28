// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getFundAnalytics — computed returns / risk / rank / benchmark for one mutual fund or ETF.
//
// Reads buildFundAnalyticsView (scoring/read/fund-analytics.service.ts) — the read EXTRACTED from
// mf-controllers.ts so the endpoint and this tool share one query.
//
// ⚠ TWO HONEST GAPS, STATED IN WORDS. `mf_analytics` carries returns, risk, rolling-1y, rank and
// benchmark. It carries NO portfolio HOLDINGS and NO EXPENSE RATIO — those inputs are not ingested at all.
// A reader asking "what does this fund own?" must be told we don't have it, not handed silence. And every
// null that IS present already ships with its own reason (`omissions`), which is surfaced verbatim.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { buildFundAnalyticsView } from "../../scoring/read/fund-analytics.service.js";
import type { FundAnalyticsView } from "../../scoring/read/fund-analytics.service.js";
import { kvLine, signedPct, numStr, NA } from "./shared.js";
import type { ChatTool, ToolResult } from "./types.js";

interface Args {
  schemeCode?: unknown;
}

const DESCRIPTION =
  "Get computed performance and risk for one mutual fund or ETF by its AMFI scheme code: trailing returns " +
  "(1m to 5y), volatility, Sharpe and Sortino ratios, maximum drawdown, rolling one-year outcomes, its rank " +
  "within its category, and benchmark-relative beta/alpha/tracking error. Call this when the reader asks how " +
  "a fund has performed or how risky it has been. Get the scheme code from getInstrumentDetails first. " +
  "IMPORTANT — Vytal does NOT hold fund PORTFOLIO HOLDINGS or EXPENSE RATIOS; if asked what a fund owns or " +
  "what it charges, say plainly that Vytal does not carry that data rather than estimating. Every figure " +
  "that is unavailable comes with the reason it is unavailable; relay the reason rather than the blank.";

const PARAMETERS = {
  type: "object",
  properties: { schemeCode: { type: "string", description: 'The numeric AMFI scheme code as a string, e.g. "120503".' } },
  required: ["schemeCode"],
  additionalProperties: false,
} as const;

function render(v: FundAnalyticsView): string {
  const s = v.scheme;
  const r = v.returns as Record<string, unknown>;
  const risk = v.risk as Record<string, unknown>;
  const roll = v.rolling1y as Record<string, unknown>;
  const bm = v.benchmark as Record<string, unknown>;

  const L: string[] = [`=== VYTAL FUND ANALYTICS: ${s?.name ?? `scheme ${v.schemeCode}`} ===`];
  L.push(kvLine("Scheme code", v.schemeCode));
  L.push(kvLine("Fund house", s?.fundHouse));
  L.push(kvLine("Category", s?.category));
  L.push(kvLine("Plan type", s?.planType));
  L.push(kvLine("Asset class", s?.assetClass));
  L.push(kvLine("Exchange ticker", s?.symbol)); // null for a plain mutual fund — legitimately "not available"
  L.push(kvLine("Current NAV", s?.currentNav != null ? String(s.currentNav) : null));
  L.push(kvLine("NAV date", s?.navDate ? new Date(s.navDate).toISOString().split("T")[0] : null));
  L.push(kvLine("Still active", s ? (s.isActive ? "yes" : "no") : null));
  L.push(kvLine("Analytics as-of", v.asOfDate ? new Date(v.asOfDate).toISOString().split("T")[0] : null));
  L.push(kvLine("NAV observations used", v.navPoints));
  L.push("");
  L.push(`[RETURNS] 1m ${signedPct(r.m1)} · 3m ${signedPct(r.m3)} · 6m ${signedPct(r.m6)} · 1y ${signedPct(r.y1)} · 3y CAGR ${signedPct(r.y3Cagr)} · 5y CAGR ${signedPct(r.y5Cagr)}`);
  L.push(`[RISK] volatility 1y ${numStr(risk.vol1y)} / 3y ${numStr(risk.vol3y)} · Sharpe 1y ${numStr(risk.sharpe1y)} / 3y ${numStr(risk.sharpe3y)} · Sortino 1y ${numStr(risk.sortino1y)} · max drawdown 1y ${signedPct(risk.maxDrawdown1y)} / 3y ${signedPct(risk.maxDrawdown3y)} / 5y ${signedPct(risk.maxDrawdown5y)}`);
  L.push(`[ROLLING 1-YEAR] windows ${numStr(roll.n, 0)} · min ${signedPct(roll.min)} · max ${signedPct(roll.max)} · average ${signedPct(roll.avg)} · share positive ${numStr(roll.pctPositive)}`);
  if (v.rank) {
    const k = v.rank as Record<string, unknown>;
    L.push(`[CATEGORY RANK] category ${String(k.category ?? NA)} (${String(k.planType ?? NA)}), category size ${numStr(k.bucketSize, 0)} — 1y rank ${numStr(k.y1, 0)} of ${numStr(k.pool1y, 0)} · 3y rank ${numStr(k.y3, 0)} of ${numStr(k.pool3y, 0)} · 5y rank ${numStr(k.y5, 0)} of ${numStr(k.pool5y, 0)}`);
  } else {
    L.push(`[CATEGORY RANK] ${NA} — this fund is not ranked in a category bucket.`);
  }
  L.push(`[VS BENCHMARK] index ${String(bm.index ?? NA)} (via ${String(bm.via ?? NA)}) — beta 1y ${numStr(bm.beta1y)} / 3y ${numStr(bm.beta3y)} · alpha 1y ${signedPct(bm.alpha1y)} / 3y ${signedPct(bm.alpha3y)} · tracking error 1y ${numStr(bm.trackingError1y)}`);
  L.push("");
  L.push(`[WHY ANY FIGURE ABOVE IS UNAVAILABLE] ${v.omissions && Object.keys(v.omissions as object).length ? JSON.stringify(v.omissions) : "no omissions recorded — every figure above that reads \"not available\" simply has no stored value"}`);
  L.push(`[NOT CARRIED BY VYTAL] Portfolio holdings (what this fund owns) and the expense ratio are ${NA} — Vytal does not ingest them at all. State that plainly if asked; do not estimate either.`);
  return L.join("\n");
}

export const getFundAnalyticsTool: ChatTool<Args> = {
  name: "getFundAnalytics",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args): Promise<ToolResult> {
    const raw = args.schemeCode;
    const schemeCode = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
    if (!/^\d+$/.test(schemeCode)) {
      return { ok: false, error: "getFundAnalytics requires 'schemeCode' to be a numeric AMFI scheme code (get it from getInstrumentDetails)." };
    }
    try {
      const view = await buildFundAnalyticsView(schemeCode);
      if (!view) {
        return {
          ok: true,
          content:
            `NO ANALYTICS: Vytal has not computed analytics for AMFI scheme ${schemeCode}. This is expected for a ` +
            `newly-listed fund and is not an error — say so honestly and state no performance figures for it.`,
        };
      }
      return { ok: true, content: render(view) };
    } catch (e) {
      return { ok: false, error: `Could not read fund analytics for scheme ${schemeCode}: ${(e as Error).message}` };
    }
  },
};
