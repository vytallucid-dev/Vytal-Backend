// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CHAT TOOL — the descriptor every tool implements. Sibling to the AI-provider registry (ai/registry.ts)
// and the broker-adapter registry: a tool is a plain object, and adding one is a handler + one line in
// registry.ts. In its own file (not registry.ts) so a tool can import the types without importing the
// registry array — no import cycle.
//
// SEPARATION FROM TRANSPORT: this is the CHAT layer's richer shape (klass + handler + human description).
// The provider only ever sees the projection down to AiToolSpec (name/description/parameters) — the klass
// and the handler never cross into src/ai. That projection lives in registry.ts (`toolSpecs`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { ChangeDomain } from "../proposals.js";

/** The four tool classes (Stage 0 ships only `read`; the rest are declared for the shape). */
export type ToolClass = "read" | "web" | "write" | "action";

/** The identity a caller supplies when building an executor. ★ userId comes from req.authUser.userId —
 *  NEVER from the model's arguments. A model cannot name another user, so it cannot reach another user's
 *  data: IDOR is structurally impossible, exactly as in the /me/* controllers. */
export interface ToolContextInput {
  userId: string;
  sessionId: string;
  /**
   * ★ THE READER'S RAW MESSAGE THIS TURN — what they actually typed, not the model's reading of it.
   *
   * It exists for exactly one reason: a write tool sometimes has to check a value against the SOURCE
   * rather than against the model. `recordTransaction` uses it to answer "did the reader actually name
   * this date, or did the model invent it?" — a question no amount of schema validation can answer,
   * because an invented date is perfectly well-formed. Optional: absent ⇒ the guard falls back to
   * requiring a resolveDate call, which is the safe direction.
   */
  userMessage?: string;
}

/**
 * A PER-TURN memo. `once(key, fn)` runs `fn` at most once per turn and hands every later caller the
 * SAME promise.
 *
 * ★ WHY IT MEMOISES THE PROMISE, NOT THE VALUE. Tool calls in one round execute through Promise.all, so
 * three ownership tools start CONCURRENTLY — a resolved-value cache would still miss three times because
 * none has finished when the others start. Caching the in-flight promise is what actually collapses them
 * into one read. (buildOwnershipView backs shareholding + deals + insider; see get-stock-shareholding.ts.)
 *
 * Lifetime is ONE TURN by construction: the cache is created inside makeToolExecutor, which the
 * controller calls once per request — so nothing can go stale across messages.
 */
export type ToolMemo = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

/** One external item that was shown to the model and must be citable to the reader. `date` is the
 *  source's own RELATIVE phrase ("9 hours ago"), never converted — see get-stock-news.ts. */
export interface WebCitation {
  title: string;
  source: string;
  date: string;
  url: string;
}

/** An IN-APP destination a tool validated and is offering the reader. `path` is always root-relative
 *  ("/comparison/TCS-vs-INFY") and is built server-side from data the tool just checked — never from
 *  the model's arguments and never written by the model. See open-comparison.ts. */
export interface AppLink {
  label: string;
  path: string;
}

/** What a tool handler is handed on every call: the caller's identity plus the per-turn memo. */
export interface ToolContext extends ToolContextInput {
  once: ToolMemo;
  /**
   * Dates `resolveDate` produced THIS TURN, as YYYY-MM-DD. Written by resolveDate, read by
   * recordTransaction's date guard.
   *
   * ★ WHY A MUTABLE SET ON THE CONTEXT. The guard's real question is "where did this date come from?",
   * and provenance cannot travel in the model's arguments — a model that invents a date will just as
   * happily claim it resolved one. The context is the one channel the model cannot write to, so the
   * server records what it actually computed and checks against that.
   *
   * ONE TURN, by construction: makeToolContext creates it per request, exactly like `once`. A date
   * resolved in an earlier message does NOT carry over — the reader must have named it, or it must be
   * resolved again. That is the deliberate direction: a needless second resolveDate call costs a few
   * hundred tokens; a wrong trade date costs a corrupted cost basis.
   */
  resolvedDates: Set<string>;
  /**
   * ★ WHAT THIS TURN ACTUALLY CHANGED — the semantic domains of writes that EXECUTED (not proposed).
   * Written by confirmPendingAction after the service returns; read by the controller once the turn
   * ends and put on the wire as `data.changed`, so the client knows which of its caches are stale.
   *
   * Same seam and same lifetime as `resolvedDates`: created per request in makeToolContext. A proposal
   * that was only PROPOSED never lands here — nothing changed, so nothing is stale.
   */
  effects: Set<ChangeDomain>;
  /**
   * ★ THE EXTERNAL ITEMS THIS TURN ACTUALLY PUT IN FRONT OF THE MODEL — written by the `klass:"web"`
   * tool when it delivers items, read by the controller once the turn ends, and rendered beneath the
   * reply as the disclaimer plus the real citations.
   *
   * WHY IT IS STRUCTURAL AND NOT AN INSTRUCTION — TWO MEASURED REASONS.
   *   1. The disclaimer. External, unverified text needs a visible "this is not Vytal" line, and we run
   *      on the weaker instruction-follower by design (the same premise that makes guardrail.ts a gate
   *      rather than a request). That one line cannot be left to a request.
   *   2. ★ THE URLS, WHICH IS THE HARDER ONE. Asked to write the article link itself, the live model
   *      produced `https://www.google.com/goto?url=CAESswEB7keqTecMraDygoOruV_7WA31…` — a redirect URL
   *      that appeared NOWHERE in the tool result. It had emitted the correct link on the previous run,
   *      so it is intermittent, which is worse than consistently wrong. Copying a 100-character opaque
   *      string is exactly what a small model does badly, and a citation the reader cannot trust is
   *      worse than no citation. So the server carries the URLs and renders them; the tool's header
   *      forbids the model from writing any URL at all.
   *
   * Non-empty ⇔ at least one external item survived the entity guard and was shown. An honest-empty news
   * result adds nothing here: there is no external content in the reply to disclaim or cite.
   *
   * Same seam and same one-turn lifetime as `effects` and `resolvedDates`.
   */
  webCitations: WebCitation[];
  /**
   * ★ IN-APP DESTINATIONS THIS TURN VALIDATED AND IS OFFERING — written by a `klass:"action"` tool,
   * rendered by the controller beneath the reply.
   *
   * WHY IT IS A SEPARATE FIELD FROM `webCitations` AND NOT A REUSE OF IT. They look alike and mean
   * opposite things: a web citation is EXTERNAL and carries "Vytal has not verified this", while an app
   * link is Vytal's own page. Folding one into the other would either disclaim our own product or drop
   * the disclaimer from the news. Two fields, two footers, one rule each.
   *
   * WHY THE SERVER BUILDS THE PATH even though it is deterministic from two tickers: the model writes
   * company names where tickers belong, and `/comparison/TCS-vs-INFOSYS` is a WELL-FORMED slug that
   * passes the route's malformed-slug check and dies at the API instead — a dead end after a click,
   * which is worse than a link that never renders. The tool has the validated symbols already; there is
   * no reason to let them make the round trip through model text.
   *
   * Same seam and same one-turn lifetime as `effects`, `resolvedDates` and `webCitations`.
   */
  appLinks: AppLink[];
}

/** A tool's outcome. `ok:true` carries the text that becomes the model's tool result (closed-world,
 *  labeled — see the tool). `ok:false` carries an honest error that is ALSO handed to the model (fail-soft:
 *  a tool never throws the turn — the model apologises or tries another path). A "not covered" boundary is
 *  an `ok:true` result (a valid, honest answer), NOT an error. */
export type ToolResult =
  | {
      ok: true;
      content: string;
      /**
       * ★ WHAT THIS CALL ACTUALLY CHANGED — the durable twin of `ctx.effects`, carried out to the
       * persisted tool result (see AiToolResult.effects for why it never reaches the model).
       *
       * Only `confirmPendingAction` sets it, and only after the service returned: a proposal is not a
       * change, and a failed write is not one either. `ctx.effects` still exists and still drives the
       * live response's `changed` — this is the copy that survives the request, so a later reader of
       * the transcript (a recovered reply, an edit that is about to delete this turn) can tell that a
       * write happened here without re-reading anyone's prose.
       */
      effects?: readonly ChangeDomain[];
    }
  | { ok: false; error: string };

/** The tool descriptor. `description` is WHAT THE MODEL SEES — prompt engineering, not documentation.
 *  `parameters` is a JSON-Schema object (passed to the provider verbatim). */
export interface ChatTool<A = Record<string, unknown>> {
  name: string;
  klass: ToolClass;
  description: string;
  parameters: Record<string, unknown>;
  handler(args: A, ctx: ToolContext): Promise<ToolResult>;
}
