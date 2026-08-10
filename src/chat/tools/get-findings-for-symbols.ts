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
//
// ── ★ AND THE STATE IN WORDS WAS ITSELF WRONG, UNTIL NOW ─────────────────────────────────────────
// The unscored row said "there are no findings to report" — one clause after instructing the model to
// distinguish the two silences. `symbol-findings.service.ts` had been attaching a populated `filing`
// section to EVERY row since the filing pass, scored or not; this renderer read `findings` (the SCORE
// channel, empty by construction on an unscored row) and emitted a hardcoded sentence beside it.
// Asked live for the notable findings on 360ONE, the assistant answered "no findings or red flags to
// report" over a standing critical flag: 90% of the promoter holding pledged, FY27Q1 shareholding.
//
// Both channels now render, per row, through the ONE model-facing renderer (ai/filing-facts.ts) — and
// the SCORE channel's lines say so in their own labels, because "none fired" is a claim of absence and
// a claim of absence has to name what it covers.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFindingsForSymbols, MAX_SYMBOLS, type SymbolFindings } from "../../scoring/read/symbol-findings.service.js";
import { getUniverseHealthView } from "../../scoring/read/universe-view.cache.js";
// ★ ONE RENDERER FOR THE FILING CHANNEL, SHARED WITH ai/grounding.ts AND boundary.ts — see that file's
//   header for why this block is not composed per surface.
import { renderFilingFacts, FILING_CHANNEL_NOTE } from "../../ai/filing-facts.js";
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
  "company as one with nothing wrong. ★ AND AN UNSCORED COMPANY IS NOT AN EMPTY ANSWER: Vytal's filing " +
  "checks (promoter pledging, promoter exits, earnings quality, receivables, margins, insider and block " +
  "deals) run on every company it tracks, scored or not, so this returns what those found for it too — " +
  "an unscored company can be carrying a critical red flag right now." +
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
    // The one status where "no findings" is the whole truth: outside the universe there is no score
    // AND no filing of ours to have checked. `r.filing` is null here, correctly.
    L.push(`${r.symbol} — NOT COVERED BY VYTAL. Vytal does not track this symbol, so it has no score and no findings. That is a coverage boundary, not a clean result — do not report it as "nothing firing".`);
    return L;
  }
  if (r.status === "unscored") {
    // ★ THIS LINE USED TO END "…so there are no findings to report", one clause after instructing the
    //   model to distinguish the two silences. The service was already attaching `filing` to this row.
    L.push(
      `${r.symbol} — ${r.name ?? NA} — TRACKED BUT NOT SCORED. Vytal follows this company but has not produced a health score for it, so it has no composite, no band, and no score-derived findings. ⚠ THAT IS NOT "no findings" — Vytal's filing checks run on it regardless, and their result is below. Not the same as "no findings fired": say which it is.`,
    );
    L.push(...renderFilingFacts(r.filing, { subject: r.symbol, indent: "  ", note: false }));
    return L;
  }
  L.push(
    `${r.symbol} — ${r.name ?? NA} · health ${r.score == null ? NA : scoreStr(r.score)} (${r.band ?? NA}) · read at its ${r.quarter ?? NA} results, rescored ${r.asOfDate ?? NA}` +
      (r.notRescored ? " · ⚠ NO LONGER BEING RESCORED — these findings are real but not current" : ""),
  );
  if (r.findings.total === 0) {
    // ⚠ NAMED TO ITS CHANNEL, for the same reason as the unscored line above: since the 22 filing
    //   rules left the score pass, "nothing met a trigger" is true of one channel and says nothing
    //   about the other. The filing block that follows is what makes the difference reportable.
    L.push("  Score-channel findings firing: none. Vytal ran its SCORE rules on this company and nothing met a trigger — a real result, not missing data, and NOT a statement about the filing findings below.");
  } else {
    L.push(
      r.findings.total > r.findings.shown.length
        ? `  Score-channel findings firing: ${r.findings.total}, the ${r.findings.shown.length} most severe below — SAY "${r.findings.shown.length} of ${r.findings.total}".`
        : `  Score-channel findings firing: ${r.findings.total}, all below.`,
    );
    for (const f of r.findings.shown) {
      L.push(`   · ${f.name} (${f.kind}) — Vytal's read on ${r.symbol}: ${f.verdict}`);
      if (f.subForms?.length && f.subForms.length > 1) {
        L.push(`     (one finding, ${f.subForms.length} forms at once: ${f.subForms.join(", ")} — say ONE divergence, not ${f.subForms.length}.)`);
      }
    }
  }
  // ★ A SCORED COMPANY HAS BOTH CHANNELS. BEL is scored, fires one score pattern — and four filing
  //   findings that this tool held on the row and never rendered.
  L.push(...renderFilingFacts(r.filing, { subject: r.symbol, indent: "  ", note: false }));
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
      // ★ ONCE FOR THE WHOLE CALL, like the finding descriptions at the foot. What this channel IS is
      //   rule-level copy, identical for all twenty rows; each company's own filing block follows its
      //   row below.
      L.push(FILING_CHANNEL_NOTE);
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
      // ★ THE FILING CHANNEL'S OWN DEFINITIONS — computed and returned by the service since the filing
      //   pass, and until now never emitted. Kept in their own list for the same reason the channels
      //   are: a reader asking "is this common?" needs to know which population the answer is drawn
      //   from, and merging the two lists would put a 504-stock rule beside a 95-stock one unlabelled.
      if (res.filingDefinitions.length) {
        L.push("");
        L.push("WHAT EACH FILING FINDING MEANS (rule-level; these run on every company Vytal tracks, scored or not):");
        for (const d of res.filingDefinitions) {
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
