// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CHAT TOOL REGISTRY — the ONE array of tools, and the two things a turn needs from it: the
// provider-facing declarations (`toolSpecs`) and the fail-soft dispatcher (`makeToolExecutor`).
//
// Same shape as ai/registry.ts (providers) and the broker-adapter registry: adding a tool is writing its
// file, importing it, and adding ONE line to CHAT_TOOLS. Nothing else in the system changes.
//
// TWO SEAMS, DELIBERATELY SPLIT:
//   · toolSpecs()        — the projection DOWN to AiToolSpec (name/description/parameters). This is all the
//                          provider ever sees; klass + handler never cross into src/ai. A turn declares these.
//   · makeToolExecutor() — binds the caller's ToolContext (userId from req.authUser, never args) and returns
//                          a dispatcher the engine calls per tool call. FAIL-SOFT by construction.
//
// ═══ ⚠ READ THIS BEFORE ADDING A TOOL — TWO THINGS ONLY A LIVE CALL CAN TELL YOU ════════════════════
//
// 1. HAND-BUILT FIXTURES CANNOT VERIFY A PROVIDER'S CONTRACT. The `thoughtSignature` bug is the standing
//    proof: Gemini 3.x attaches an opaque signature to every functionCall part and REJECTS the next
//    request (400 INVALID_ARGUMENT) if it is not echoed back, so the tool loop could call a tool exactly
//    once and then died. It passed ALL 33 deterministic proofs — because the fixtures were written by us,
//    and a self-made fixture can only contain fields we already knew about. It took one real call to find.
//    ⇒ Any NEW assumption about the provider's wire contract (a field, a required echo, a role mapping)
//      must be confirmed by a live call before it is trusted. `verify-tool-provider.ts` has an opt-in live
//      path (TOOL_PROVER_LIVE=1) for exactly this.
//
// 2. A DESCRIPTION IS A BEHAVIOURAL CLAIM, AND IT IS ALSO ONLY TESTABLE LIVE. Descriptions are prompt
//    engineering: how the model actually reads yours is an empirical question, not a review question.
//    searchStocks originally said "call this when the reader names a company in words rather than a
//    ticker" — plainly worded, and the model still called it on bare tickers, costing a whole extra
//    generation per turn. Measuring that needed a live conversation (`measure-full-drilldown.ts`), and
//    the fix was one added sentence. ⇒ Budget a live turn to check a new tool is called WHEN you meant
//    and NOT when you didn't; both failure directions cost real money on every future message.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { AiToolCall, AiToolResult, AiToolSpec } from "../../ai/types.js";
import type { AppLink, ChatTool, ToolContext, ToolContextInput, ToolMemo, WebCitation } from "./types.js";
import type { ChangeDomain } from "../proposals.js";
import { getStockFactsTool } from "./get-stock-facts.js";
import { searchStocksTool } from "./search-stocks.js";
import { getStockPriceTool } from "./get-stock-price.js";
import { getStockFundamentalsTool } from "./get-stock-fundamentals.js";
import { getStockQuarterlyResultsTool } from "./get-stock-quarterly-results.js";
import { getStockShareholdingTool, getStockDealsTool, getStockInsiderTradesTool } from "./get-stock-ownership.js";
import { getCorporateEventsTool } from "./get-corporate-events.js";
import { getPeerGroupTool, getPeerGroupMembersTool } from "./get-peer-group.js";
import { getInstrumentDetailsTool } from "./get-instrument-details.js";
import { getFundAnalyticsTool } from "./get-fund-analytics.js";
import { getPortfolioFactsTool } from "./get-portfolio-facts.js";
import { getStockRelationshipTool } from "./get-stock-relationship.js";
import { getStockNewsTool } from "./get-stock-news.js";
import { openComparisonTool } from "./open-comparison.js";
import { getWatchlistTool } from "./get-watchlist.js";
import { resolveDateTool } from "./resolve-date.js";
import { addToWatchlistWriteTool, removeFromWatchlistWriteTool } from "./watchlist-write.js";
import { rememberThisTool, listMemoriesTool, forgetMemoryTool } from "./memory.js";
import { createAlertWriteTool, deleteAlertWriteTool } from "./alerts-write.js";
import { setEventReminderTool } from "./reminders-write.js";
import { recordTransactionTool } from "./record-transaction.js";
import { confirmPendingActionTool, cancelPendingActionTool } from "./confirm.js";

// ── THE REGISTRY. One line per tool. ─────────────────────────────────────────────────────────────
export const CHAT_TOOLS: ChatTool[] = [
  // resolution
  searchStocksTool,
  // stock data
  getStockFactsTool,
  getStockPriceTool,
  getStockFundamentalsTool,
  getStockQuarterlyResultsTool,
  getStockShareholdingTool,
  getStockDealsTool,
  getStockInsiderTradesTool,
  getCorporateEventsTool,
  // peer groups
  getPeerGroupTool,
  getPeerGroupMembersTool,
  // instruments
  getInstrumentDetailsTool,
  getFundAnalyticsTool,
  // ── the web (klass:"web"). The ONE tool whose result is not Vytal's own word: live headlines from the
  //    public web, screened by an entity guard before the model sees them, framed by a hostile header,
  //    and disclaimed structurally by the controller. Gated by AI_CHAT_WEB_SEARCH — it registers when
  //    disabled and refuses honestly, so the fleet the model sees does not change with a flag. ──
  getStockNewsTool,
  // ── the action (klass:"action"). It navigates NOTHING: it validates a pair against the universe,
  //    returns the comparability verdict the model cannot derive alone, and offers a link the SERVER
  //    builds from universe rows. The verdict is the value; the link is the ending. ──
  openComparisonTool,
  // user context
  getPortfolioFactsTool,
  getStockRelationshipTool,
  getWatchlistTool,
  // ── date resolution. A read tool, but it exists FOR the write path: it is the only sanctioned way a
  //    phrase becomes a date, and recordTransaction refuses dates that did not come from it or from the
  //    reader's own words. See date-resolve.ts for the live finding that forced it. ──
  resolveDateTool,
  // ── writes (Stage 3). Every one of these PROPOSES; none of them writes. The two below are the only
  //    tools in the fleet that mutate anything, and they read their values from the stored proposal. ──
  addToWatchlistWriteTool,
  rememberThisTool,
  listMemoriesTool,
  forgetMemoryTool,
  removeFromWatchlistWriteTool,
  createAlertWriteTool,
  deleteAlertWriteTool,
  setEventReminderTool,
  recordTransactionTool,
  confirmPendingActionTool,
  cancelPendingActionTool,
];

const BY_NAME: Map<string, ChatTool> = new Map(CHAT_TOOLS.map((t) => [t.name, t]));

/** The provider-facing declarations for a turn: name + description (what the model sees) + JSON-Schema
 *  parameters. The klass and the handler are intentionally dropped — they are chat-layer business. */
export function toolSpecs(): AiToolSpec[] {
  return CHAT_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/** Look up a tool by the name the model called. */
export function findTool(name: string): ChatTool | undefined {
  return BY_NAME.get(name);
}

/**
 * The tools whose appearance means this turn is doing WRITE-CHAIN work and has earned a larger tool-round
 * budget (engine.ts's `extendedRounds`). Every `klass:"write"` tool, plus `resolveDate` — which is a read
 * tool but exists FOR the write path, and is usually the FIRST link in the chain, so triggering on it is
 * what gets the headroom granted early enough to matter.
 *
 * ★ THE ENGINE NEVER LEARNS WHAT A "WRITE TOOL" IS. It matches names it was handed. klass stays chat-layer
 * business, exactly as it does for the provider projection.
 */
export const EXTENDED_ROUND_TOOLS: readonly string[] = [
  ...CHAT_TOOLS.filter((t) => t.klass === "write").map((t) => t.name),
  "resolveDate",
];

/**
 * Build the executor a chat turn hands to the engine. Given a model tool call, it dispatches through the
 * registry with the caller's ToolContext and returns a neutral AiToolResult.
 *
 * ★ FAIL-SOFT BY CONSTRUCTION — this NEVER throws. An unknown tool, a handler that returns `{ ok:false }`,
 * or a handler that THROWS all resolve to a result whose `response.error` is handed back to the model, so
 * the turn survives and the model can apologise or try another path. The call `id` is echoed back so the
 * provider can pair result ↔ call (Gemini issues ids).
 */
/**
 * Build a ToolContext with a FRESH per-turn memo.
 *
 * ★ THE MEMO'S LIFETIME IS THIS OBJECT. One context per turn (makeToolExecutor calls this once per
 * request), so a cached read can never leak across messages. It caches the in-flight PROMISE so tools
 * running concurrently in the same Promise.all round collapse onto one read; a rejection is evicted so a
 * later call in the same turn can retry rather than inheriting a transient failure.
 */
export function makeToolContext(input: ToolContextInput): ToolContext {
  const inflight = new Map<string, Promise<unknown>>();
  // Per-turn provenance for resolveDate → recordTransaction's date guard. Same lifetime as the memo.
  const resolvedDates = new Set<string>();
  // Per-turn record of what actually CHANGED, for the client's cache invalidation.
  const effects = new Set<ChangeDomain>();
  // Per-turn record of EXTERNAL items served to the model — drives the structural disclaimer + citations.
  const webCitations: WebCitation[] = [];
  // Per-turn record of IN-APP destinations a tool validated — drives the structural link footer.
  const appLinks: AppLink[] = [];
  const once: ToolMemo = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const hit = inflight.get(key);
    if (hit) return hit as Promise<T>;
    const p = fn().catch((e) => {
      inflight.delete(key);
      throw e;
    });
    inflight.set(key, p);
    return p as Promise<T>;
  };
  return { ...input, once, resolvedDates, effects, webCitations, appLinks };
}

export function makeToolExecutor(input: ToolContextInput): (call: AiToolCall) => Promise<AiToolResult> {
  return makeToolExecutorFor(makeToolContext(input));
}

/**
 * The same dispatcher, bound to a context the CALLER already holds.
 *
 * ★ WHY THIS OVERLOAD EXISTS. `ctx` accumulates two things the caller needs AFTER the turn — the
 * dates resolveDate computed, and (the reason this was added) `effects`, the domains a confirmed write
 * actually changed. makeToolExecutor creates its context internally and throws it away, so a caller
 * using it can never read either. The controller builds the context itself and passes it here.
 */
export function makeToolExecutorFor(ctx: ToolContext): (call: AiToolCall) => Promise<AiToolResult> {
  return async (call: AiToolCall): Promise<AiToolResult> => {
    const base = { name: call.name, ...(call.id ? { id: call.id } : {}) };
    const tool = findTool(call.name);
    if (!tool) return { ...base, response: { error: `Unknown tool "${call.name}".` } };
    try {
      const result = await tool.handler(call.args, ctx);
      return result.ok ? { ...base, response: { output: result.content } } : { ...base, response: { error: result.error } };
    } catch (e) {
      return { ...base, response: { error: `Tool "${call.name}" failed: ${(e as Error).message}` } };
    }
  };
}
