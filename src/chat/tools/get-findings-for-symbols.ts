// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getFindingsForSymbols — findings for a NAMED SET of companies, each with Vytal's own verdict.
//
// ── WHAT THIS COMPLETES ───────────────────────────────────────────────────────────────────────────
// getUniverseScan answers "how many" and "which companies". It cannot answer "and what does Vytal
// actually SAY about each of them", because a census row is an aggregate over N companies and has no
// single company's numbers to bind a sentence to — which is why per-stock verdicts were refused
// there, correctly. This is the read that has them: the row's own rendered verdict, straight from
// `renderVerdict`, the same authority the stock page and the watchlist rows go through.
//
// ── 3e · THE OVERLAP WITH getUniverseScan, AND WHY IT IS NOT ONE ──────────────────────────────────
// Both can answer "anything in my watchlist firing flags?". They are not interchangeable:
//
//   getUniverseScan(scope=watchlist)   COUNTS and NAMES, across the reader's OWN list, and only for
//                                      stocks Vytal SCORES. One call, no symbols to supply. It is the
//                                      right tool when the question is "how many / which ones".
//   getFindingsForSymbols(symbols[])   VERDICTS, for symbols the model already has in hand — from a
//                                      previous result, or because the reader named them. It is the
//                                      only one that reaches stocks OUTSIDE the scored universe, and
//                                      it says so per symbol instead of silently omitting them.
//
// The rule both descriptions state: COUNT or WHICH → the scan. WHAT VYTAL SAYS about a handful you
// can already name → this. Naming twenty symbols to ask "how many are firing" is the wrong shape and
// costs a round; asking the scan "what does Vytal say about TCS and INFY specifically" cannot be
// answered at all.
//
// ── PAYLOAD ───────────────────────────────────────────────────────────────────────────────────────
// Twenty symbols is the cap. Descriptions are rule-level, so they are emitted ONCE for the whole call
// rather than per row — repeating a 50-token description twenty times would say the same sentence
// twenty times. Measured worst case (the 20 busiest names in the live book, 100 findings between
// them) is reported in the build note.
//
// ── 3c · AN EMPTY LIST IS NEVER THE ANSWER FOR A STOCK VYTAL DOES NOT SCORE ───────────────────────
// "No findings" reads as a clean bill of health. So an unscored symbol and an uncovered symbol each
// produce their STATE in words, never an empty findings array beside a scored company's real one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFindingsForSymbols, MAX_SYMBOLS, type SymbolFindings } from "../../scoring/read/symbol-findings.service.js";
import { getUniverseHealthView } from "../../scoring/read/universe-view.cache.js";
import { scoreStr, NA, BARE_TICKER_DIRECT } from "./shared.js";
import type { ChatTool, ToolResult } from "./types.js";

interface Args {
  symbols?: unknown;
}

const DESCRIPTION =
  "Get what Vytal SAYS about specific companies — for each ticker you name, the findings firing on it " +
  "right now with Vytal's own verdict sentence for that company (\"promoter holding fell 6.2 points this " +
  "quarter\"), plus its health score and band. Call this when the reader names companies and wants to " +
  "know what is flagged on them, or when you already have tickers from an earlier result and need the " +
  "detail behind them. Up to " +
  MAX_SYMBOLS +
  " tickers in ONE call — do not call it once per company. " +
  "★ NOT THE SAME AS getUniverseScan. For a COUNT or for WHICH companies (\"how many are firing red " +
  "flags\", \"which stocks in my watchlist have flags\") use getUniverseScan — it needs no tickers and " +
  "covers the whole scored set. Use THIS one when you can already name the companies and want the " +
  "per-company verdict. It is also the only way to ask about a stock Vytal does not score: it answers " +
  "\"not covered\" or \"not scored yet\" per ticker, which is a real answer — never read a missing " +
  "company as one with nothing wrong." +
  BARE_TICKER_DIRECT;

const PARAMETERS = {
  type: "object",
  properties: {
    symbols: {
      type: "array",
      items: { type: "string" },
      description: `NSE tickers, e.g. ["TCS","INFY","HDFCBANK"]. Up to ${MAX_SYMBOLS}; extras are dropped and reported.`,
    },
  },
  required: ["symbols"],
  additionalProperties: false,
} as const;

// ── render ─────────────────────────────────────────────────────────────────────────────────────────

function renderRow(r: SymbolFindings): string[] {
  const L: string[] = [];
  if (r.status === "not-covered") {
    L.push(`${r.symbol} — NOT COVERED BY VYTAL. Vytal does not track this symbol, so it has no score and no findings. That is a coverage boundary, not a clean result — do not report it as "nothing firing".`);
    return L;
  }
  if (r.status === "unscored") {
    L.push(`${r.symbol} — ${r.name ?? NA} — TRACKED BUT NOT SCORED. Vytal follows this company but has not produced a health score for it, so there are no findings to report. Not the same as "no findings fired" — say which it is.`);
    return L;
  }
  L.push(
    `${r.symbol} — ${r.name ?? NA} · health ${r.score == null ? NA : scoreStr(r.score)} (${r.band ?? NA}) · read at its ${r.quarter ?? NA} results, rescored ${r.asOfDate ?? NA}` +
      (r.notRescored ? " · ⚠ NO LONGER BEING RESCORED — these findings are real but not current" : ""),
  );
  if (r.findings.total === 0) {
    L.push("  Findings firing: none. Vytal ran its rules on this company and nothing met a trigger — a real result, not missing data.");
    return L;
  }
  L.push(
    r.findings.total > r.findings.shown.length
      ? `  Findings firing: ${r.findings.total}, the ${r.findings.shown.length} most severe below — SAY "${r.findings.shown.length} of ${r.findings.total}".`
      : `  Findings firing: ${r.findings.total}, all below.`,
  );
  for (const f of r.findings.shown) {
    L.push(`   · ${f.name} (${f.kind}) — Vytal's read on ${r.symbol}: ${f.verdict}`);
    if (f.subForms?.length && f.subForms.length > 1) {
      L.push(`     (one finding, ${f.subForms.length} forms at once: ${f.subForms.join(", ")} — say ONE divergence, not ${f.subForms.length}.)`);
    }
  }
  return L;
}

export const getFindingsForSymbolsTool: ChatTool<Args> = {
  name: "getFindingsForSymbols",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const raw = Array.isArray(args.symbols) ? args.symbols : typeof args.symbols === "string" ? [args.symbols] : null;
    if (!raw || raw.length === 0) {
      return { ok: false, error: 'getFindingsForSymbols requires a non-empty "symbols" array of NSE tickers, e.g. ["TCS","INFY"].' };
    }
    try {
      // The universe's freshest rescore date, for the staleness read. Free: the same cached view the
      // scan uses, memoised per turn — staleness is relative to the whole book, and a two-symbol call
      // has no book of its own to be behind (head-snapshot.ts).
      const view = await ctx.once("universeView", () => getUniverseHealthView());
      const freshestAsOf = view.asOfDate ? new Date(`${view.asOfDate}T00:00:00.000Z`) : null;

      const res = await readFindingsForSymbols(raw as string[], { freshestAsOf });
      if (res.rows.length === 0) {
        return { ok: false, error: "getFindingsForSymbols got no usable tickers — pass NSE symbols such as TCS or HDFCBANK." };
      }

      const L: string[] = [`=== VYTAL — FINDINGS FOR ${res.rows.length} NAMED COMPAN${res.rows.length === 1 ? "Y" : "IES"} ===`];
      L.push(
        "★ HOW TO SAY THE DATE. Each company below is read at ITS OWN most recent reported quarter — named on its own line, because they differ. Never state one quarter as though it covered them all.",
      );
      if (res.droppedForCap.length) {
        L.push(`⚠ ${MAX_SYMBOLS} companies is the limit for one call. NOT READ: ${res.droppedForCap.join(", ")}. Say so — do not imply they came back clean.`);
      }
      for (const r of res.rows) L.push(...renderRow(r));

      if (res.definitions.length) {
        L.push("");
        L.push("WHAT EACH OF THESE FINDINGS MEANS (rule-level — the same for every company firing it):");
        for (const d of res.definitions) {
          L.push(` · ${d.name}: ${d.description}`);
          L.push(`   Doesn't mean: ${d.doesntMean}`);
        }
      }
      L.push("");
      L.push(
        "(A finding is an observation to investigate, never a recommendation. The verdict above is what happened at THAT company — quote it for that company only.)",
      );
      return { ok: true, content: L.join("\n") };
    } catch (e) {
      return { ok: false, error: `Could not read findings for those symbols: ${(e as Error).message}` };
    }
  },
};
