// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CHAT — the authenticated user's conversations (req.authUser). Discuss sidebar + chat page.
//
//   POST  /api/v1/me/chat/sessions            DiscussContext (sidebar) | {} / {origin:"chat_page"}  → open|resume
//   POST  /api/v1/me/chat/sessions/:id/messages { message }                                          → send + reply
//   GET   /api/v1/me/chat/sessions                                                                   → chat-page list
//   GET   /api/v1/me/chat/sessions/:id                                                               → one + messages
//   PATCH /api/v1/me/chat/sessions/:id        { title }                                              → rename
//
// SECURITY: owner = req.authUser.userId, NEVER the payload — there is no userId input, so IDOR is
// structurally impossible. Every read/write is scoped by userId. Envelope: { success, data } /
// { success:false, error, … } — matches the other /me/*.
//
// UNAVAILABLE: when the spend gate denies, we return an honest in-band unavailable state (200,
// success:true, data.unavailable). A new sidebar open that is unavailable creates no session at all —
// there is nothing to attach anything to.
//
// ★ BUT A DENIED FOLLOW-UP NOW PERSISTS THE READER'S MESSAGE, marked undelivered. It used to persist
//   NOTHING, which meant the one thing the reader actually produced — their own typed question — lived
//   only in browser memory: refresh, and the message, its "not sent" mark and the explanation were all
//   gone, leaving an empty conversation titled "New conversation". The message is theirs; losing it is
//   the worst part of being denied. It is written with the denial's scope + reset instant beside it
//   (chat_messages.denied_*), EXCLUDED from the model's history (it never saw it), and retryable.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { z } from "zod";
import { DiscussContextSchema } from "../../chat/discuss-context.js";
import { composeDiscussOpening, composeChatPageOpening, resolveTurnSystem, modelFacingUserTurn } from "../../chat/compose.js";
import { resolveChatModel, CHAT_MAX_TOOL_ROUNDS_WRITE } from "../../chat/config.js";
import { runChatTurn } from "../../chat/engine.js";
import { toolSpecs, makeToolContext, makeToolExecutorFor, EXTENDED_ROUND_TOOLS } from "../../chat/tools/registry.js";
import {
  findResumableDiscussSession,
  createDiscussSessionWithOpening,
  createChatPageSession,
  appendFollowup,
  appendUndeliveredUserMessage,
  sweepEmptyChatPageSessions,
  listVisibleSessions,
  getSessionWithMessages,
  renameSession as renameSessionSvc,
  deleteSession as deleteSessionSvc,
  loadHistoryForModel,
  countVisibleUserMessages,
  serializeSession,
  serializeVisibleMessages,
} from "../../chat/sessions.js";
import { peekProposal, sweepProposal } from "../../chat/proposals.js";
import { unavailableState, quotaStateFrom, type ChatQuotaState } from "../../chat/unavailable.js";
import { peekAiCallQuota } from "../../ai/quota.js";
import { withAppLinks, withExternalSources } from "../../chat/voice.js";
import { resolveAppLinks } from "../../chat/links.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";
import type { Actor } from "../../ai/quota.js";

// ── THE COMPOSER'S QUOTA STATE ──────────────────────────────────────────────────────────────────────
/**
 * The read-only quota read that rides on every conversation fetch — so the composer's lock is SERVER
 * state the first paint already has, not something the client infers from a send that failed ten minutes
 * ago and then forgets on refresh.
 *
 * ★ DEGRADES TO ALLOWING, TWICE OVER. peekAiCallQuota fails open internally, and this wrapper swallows
 *   anything it might still throw. A monitoring read must never be able to lock a reader out of a
 *   product that would have served them — the cost of wrongly allowing is one send that comes back with
 *   an honest denial, which is a state this surface handles well. Deliberately the opposite posture to
 *   the spend gate, which fails CLOSED because it guards money rather than a text input.
 */
async function readQuotaState(userId: string): Promise<ChatQuotaState> {
  try {
    return quotaStateFrom(await peekAiCallQuota(resolveChatModel(), { kind: "user", userId }));
  } catch (e) {
    console.warn("[chat] quota peek failed (non-fatal, allowing):", (e as Error).message);
    return { canSend: true, scopeDenied: null, resetAt: null, unavailable: null };
  }
}

const SendBody = z.object({ message: z.string().trim().min(1).max(4000) });
const PatchBody = z.object({ title: z.string().trim().min(1).max(200) });

/** Provisional title for a chat-page session: the truncated first user message. */
function truncateTitle(text: string, max = 48): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** The honest unavailable payload — which ceiling refused (personal vs system) and WHEN it clears
 *  (`resetAt`, ISO; the client renders it in the reader's local time). The wording lives in
 *  chat/unavailable.ts, shared with the serializer so a REMEMBERED denial reads in the same voice. */
const unavailablePayload = (
  reason: string | undefined,
  scopeDenied: "user" | "global" | null | undefined,
  resetAt: string | undefined,
) => ({ unavailable: unavailableState(reason, scopeDenied, resetAt) });

// ── POST /chat/sessions — open or resume ────────────────────────────────────────────────────────────
export const openOrResumeSession = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const wantsChatPage = body.origin === "chat_page" || Object.keys(body).length === 0;

  try {
    if (wantsChatPage) {
      // ★ SWEEP THE READER'S OWN ABANDONED EMPTIES FIRST. A chat_page session is created BEFORE the first
      //   send and there is no spend gate on this path at all, so a first send that never landed (denied,
      //   or a dropped request) used to leave a permanent blank "New conversation" in the list — born
      //   promoted=true, so the 24h prune could never reach it. Best-effort: a sweep failure must never
      //   cost the reader the conversation they are asking for. See sweepEmptyChatPageSessions for why
      //   this cannot touch a conversation that holds a denied message.
      try {
        const swept = await sweepEmptyChatPageSessions(userId);
        if (swept > 0) console.log(`[chat] swept ${swept} empty chat-page session(s) for user ${userId}`);
      } catch (e) {
        console.warn("[chat] empty-session sweep failed (non-fatal):", (e as Error).message);
      }

      // Chat page: ALWAYS a new session. No card, no subject, no grounding — the orientation scaffolding
      // becomes message[0]. No generation here; the reader drives with their first message.
      const opening = await composeChatPageOpening(userId);
      const { session, messages } = await createChatPageSession(userId, opening.openingUserContent, "New conversation");
      return res.status(201).json({
        success: true,
        data: { session: serializeSession(session), messages: serializeVisibleMessages(messages), resumed: false, quota: await readQuotaState(userId) },
      });
    }

    // Sidebar: validate the DiscussContext.
    const parsed = DiscussContextSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten() });
    }
    const ctx = parsed.data;

    // RESUME within 24h if an active session for this exact subject exists.
    const resumable = await findResumableDiscussSession(userId, ctx);
    if (resumable) {
      const got = await getSessionWithMessages(userId, resumable.id);
      return res.json({
        success: true,
        data: { session: serializeSession(got!.session), messages: serializeVisibleMessages(got!.messages), resumed: true, quota: await readQuotaState(userId) },
      });
    }

    // NEW session → compose + run the opening exchange so the sheet has content immediately.
    const opening = await composeDiscussOpening(userId, ctx);
    const actor: Actor = { kind: "user", userId };
    const turn = await runChatTurn({
      model: opening.model,
      system: opening.system,
      messages: [{ role: "user", content: opening.openingUserContent }],
      actor,
      subjectLabel: opening.subjectLabel,
    });

    if (turn.status === "unavailable") {
      // Persist NOTHING — no session, no messages. The user can retry.
      return res.json({ success: true, data: { session: null, messages: [], resumed: false, ...unavailablePayload(turn.reason, turn.scopeDenied, turn.resetAt) } });
    }

    // ★ THE OPENING NEEDS THE RESOLVER TOO. It calls no tools, so it has no appLinks and never needed
    //   the footer — but it is a MODEL GENERATION, so it can emit a `{{link:…}}` placeholder just as a
    //   follow-up can. Without this, the one turn every discuss session starts with is the one turn
    //   that would show a reader raw braces. Best-effort: a resolver failure must not cost the session.
    let openingText = turn.text!;
    try {
      openingText = (await resolveAppLinks(openingText)).text;
    } catch (e) {
      console.warn("[chat] opening link resolution failed (non-fatal):", (e as Error).message);
    }

    const created = await createDiscussSessionWithOpening({
      userId,
      surface: ctx.surface,
      subjectKind: opening.subjectKind,
      subjectSymbol: opening.subjectSymbol,
      subjectName: opening.subjectName,
      title: opening.derivedTitle,
      asOfSnapshot: opening.asOfSnapshot,
      openingUserContent: opening.openingUserContent,
      openingDisplayContent: opening.openingDisplayContent,
      assistantText: openingText,
      assistantUsage: turn.usage,
      guardrailBlocked: turn.guardrailBlocked,
      regenerated: turn.regenerated,
    });
    return res.status(201).json({
      success: true,
      data: { session: serializeSession(created.session), messages: serializeVisibleMessages(created.messages), resumed: false, quota: await readQuotaState(userId) },
    });
  } catch (e) {
    console.error("[POST /me/chat/sessions]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to open chat session" });
  }
};

// ── POST /chat/sessions/:id/messages — send a message, get the reply ────────────────────────────────
export const sendMessage = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id ?? "");
  const parsed = SendBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten() });
  }
  const message = parsed.data.message;

  try {
    const got = await getSessionWithMessages(userId, id);
    if (!got) {
      return res.status(404).json({ success: false, error: "not_found", message: "Not your chat session" });
    }
    const { session } = got;

    // Is this a chat_page session's FIRST real exchange? (drives the provisional title + the title job)
    const priorUserMessages = await countVisibleUserMessages(id);
    const isFirstChatPageExchange = session.origin === "chat_page" && priorUserMessages === 0;

    // Grounding + orientation are carried in message[0]; the follow-up system is tone + context-layer only.
    const system = await resolveTurnSystem(userId);
    const history = await loadHistoryForModel(id);
    const subjectLabel = session.subjectName ?? session.subjectSymbol ?? "this";
    const actor: Actor = { kind: "user", userId };

    // ★ THE PROPOSAL THAT WAS PENDING WHEN THIS MESSAGE ARRIVED (Stage 3). Recorded now, swept below.
    //   A write tool proposes but does not write; the write happens only if THIS turn calls
    //   confirmPendingAction. So consent is scoped to exactly one message — see the sweep.
    const proposalIdAtTurnStart = (await peekProposal(id, userId))?.id ?? null;

    // ★ THE TOOL CONTEXT IS BUILT HERE, not inside makeToolExecutor, because the controller needs to
    //   READ it after the turn: `effects` carries which domains a confirmed write actually changed, and
    //   that is the only signal the client can use to refresh its caches (tool turns are hidden from the
    //   transcript, so the browser cannot see the write happen).
    const toolCtx = makeToolContext({ userId, sessionId: id, userMessage: message });

    // Follow-ups can call tools (the opening is already grounded, so it doesn't). The executor binds the
    // ToolContext — ★ userId from req.authUser, NEVER from the model — so a tool cannot reach another user.
    const turn = await runChatTurn({
      model: resolveChatModel(),
      system,
      // ★ The MODEL-FACING copy carries the per-turn language directive; the PERSISTED message is the
      //   reader's raw text (appendFollowup below). See compose.ts §modelFacingUserTurn.
      messages: [...history, { role: "user", content: modelFacingUserTurn(message) }],
      actor,
      subjectLabel,
      tools: toolSpecs(),
      // ★ userMessage (on the context above) is the reader's RAW text — recordTransaction's date guard
      //   checks a proposed tradeDate against what they actually said, not the model's reading of it.
      executeTool: makeToolExecutorFor(toolCtx),
      // A write chain needs more tool rounds than a question does; the budget is raised only once the
      // turn actually reaches for one of these, so ordinary turns cost nothing extra.
      extendedRounds: { tools: EXTENDED_ROUND_TOOLS, maxRounds: CHAT_MAX_TOOL_ROUNDS_WRITE },
    });

    if (turn.status === "unavailable") {
      // ★ PERSIST THE READER'S MESSAGE, MARKED UNDELIVERED. Nothing was generated and nothing was spent,
      //   but they still typed a question, and it has to survive a refresh. The denial's scope + reset
      //   instant ride on that row, so the reason can be re-rendered later against the clock rather than
      //   frozen into a sentence. Retrying it updates the row instead of stacking duplicates.
      //   The pending proposal is left ALONE on purpose: this message was never processed, so the reader's
      //   "yes" has not been spent and their next attempt should still find something to confirm.
      const denied = await appendUndeliveredUserMessage({
        session,
        userText: message,
        reason: turn.reason ?? null,
        scopeDenied: turn.scopeDenied ?? null,
        resetAt: turn.resetAt ? new Date(turn.resetAt) : null,
        // A conversation holding one undelivered question is still a conversation — title it, or the list
        // shows the blank "New conversation" this whole fix is about.
        provisionalTitle: isFirstChatPageExchange ? truncateTitle(message) : undefined,
      });
      return res.json({
        success: true,
        data: {
          session: serializeSession(denied.session),
          // The transcript comes back on this path too, so the client can swap its optimistic row for the
          // persisted one and a retry after a refresh behaves exactly like a retry before one.
          messages: serializeVisibleMessages(denied.messages),
          reply: null,
          ...unavailablePayload(turn.reason, turn.scopeDenied, turn.resetAt),
        },
      });
    }

    // ── THE SWEEP. Clear the pending proposal iff it is STILL the one this turn started with — i.e. the
    //    turn neither confirmed it (confirmPendingAction consumed it) nor replaced it with a new one.
    //    This is what makes an unconfirmed proposal unable to linger and fire against a later, unrelated
    //    "yes": consent lives for exactly one message. Best-effort — a sweep failure must not fail a
    //    turn that has already been generated (the next turn's sweep catches it).
    try {
      await sweepProposal(id, userId, proposalIdAtTurnStart);
    } catch (e) {
      console.warn("[chat] pending-proposal sweep failed (non-fatal):", (e as Error).message);
    }

    // ★ THE STRUCTURAL EXTERNAL-SOURCE FOOTER. If a web tool actually put outside headlines in front of
    //   the model this turn, the reply carries the "not Vytal, not verified" line AND the real links to
    //   every item, whether or not the model remembered either — appended here, so it is persisted in
    //   the transcript rather than re-derived on every render. Skipped on a guardrail redirect: that
    //   text carries no news.
    //   ★ ORDER MATTERS: in-app links first, external sources last, so the "not verified by Vytal"
    //   sentence stays adjacent to the external headlines it describes and never reads as though it
    //   applied to Vytal's own comparison page.
    let assistantText = turn.text!;
    // ★ THE PLACEHOLDER RESOLVER RUNS FIRST, AND UNCONDITIONALLY.
    //   FIRST, because it writes real paths into the body, and withAppLinks dedupes on `(${path})` —
    //   so a turn where the model already pointed at the comparison inline does not also get a footer
    //   repeating it. UNCONDITIONALLY (unlike the two footers, which a guardrail redirect skips)
    //   because its last act is to sweep malformed `{{link…` debris: a footer that goes missing on a
    //   redirect costs nothing, but raw braces reaching a reader is a visible defect. Best-effort —
    //   a resolver failure must never fail a turn that has already been generated and paid for.
    try {
      const linked = await resolveAppLinks(assistantText);
      assistantText = linked.text;
      if (linked.unresolved.length) {
        // The signal that the vocabulary is drifting from what the model reaches for — a kind it wants
        // that does not exist, or a ticker it invented. Cheap to log, and it is the input to whether
        // the four kinds should become five.
        console.warn(`[chat] unresolved link placeholders (${linked.unresolved.length}):`, linked.unresolved.join(" · "));
      }
      if (linked.strippedPaths.length) {
        // The model typed a link destination instead of writing a marker. The reader is protected —
        // the destination is gone and the words remain — but this is the vocabulary being ignored,
        // and it is the signal that a page the model keeps reaching for may need a marker of its own.
        console.warn(`[chat] typed link destinations stripped (${linked.strippedPaths.length}):`, linked.strippedPaths.join(" · "));
      }
      if (linked.malformed.length) {
        // ★ A SYNTAX failure, not a coverage one — which is why it is logged apart from `unresolved`
        // rather than folded into it. "The ticker did not exist" is answered by the universe; "the
        // model wrote one brace" is answered by the vocabulary, and a log that merges the two reports
        // a number with no cause attached. The reader is protected either way: the marker is gone and
        // the subject remains as ordinary words.
        console.warn(`[chat] MALFORMED link markers stripped (${linked.malformed.length}):`, linked.malformed.join(" · "));
      }
    } catch (e) {
      console.warn("[chat] link resolution failed (non-fatal):", (e as Error).message);
    }
    if (!turn.guardrailBlocked) {
      if (toolCtx.appLinks.length) assistantText = withAppLinks(assistantText, toolCtx.appLinks);
      if (toolCtx.webCitations.length) assistantText = withExternalSources(assistantText, toolCtx.webCitations);
    }

    const updated = await appendFollowup({
      session,
      userText: message,
      toolTurns: turn.toolTurns, // hidden tool_call/tool_result turns, persisted between user & assistant
      assistantText,
      assistantUsage: turn.usage,
      guardrailBlocked: turn.guardrailBlocked,
      regenerated: turn.regenerated,
      provisionalTitle: isFirstChatPageExchange ? truncateTitle(message) : undefined,
    });

    // Chat-page first exchange → enqueue the model-written title job (best-effort; never fail the message).
    if (isFirstChatPageExchange) {
      try {
        await enqueueJob({ type: JobTypes.CHAT_TITLE_GENERATE, payload: { sessionId: id }, triggeredBy: `user:${userId}` });
      } catch (e) {
        console.warn("[chat] title job enqueue failed (non-fatal):", (e as Error).message);
      }
    }

    // The reply is the last assistant message.
    const reply = serializeVisibleMessages(updated.messages).at(-1) ?? null;
    // ★ `changed` — the semantic domains a CONFIRMED write touched this turn (empty on an ordinary
    //   question). The client maps these to its own cache keys; we deliberately do not put query keys
    //   on the wire. Always present so the client never has to test for the field.
    const changed = [...toolCtx.effects];
    return res.json({ success: true, data: { session: serializeSession(updated.session), messages: serializeVisibleMessages(updated.messages), reply, changed } });
  } catch (e) {
    console.error("[POST /me/chat/sessions/:id/messages]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to send message" });
  }
};

// ── GET /chat/quota — the composer's lock, on its own ───────────────────────────────────────────────
/**
 * The same state the conversation fetch carries, addressable by itself — because `resetAt` is a claim
 * about the FUTURE, and a composer that has been open since this morning is holding a value it read
 * hours ago. When that instant passes, the client asks HERE rather than proving the window rolled over
 * by sending a message and having it refused.
 *
 * Read-only (peekAiCallQuota consumes nothing) and degrades to allowing — see readQuotaState.
 */
export const getQuota = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  return res.json({ success: true, data: { quota: await readQuotaState(userId) } });
};

// ── GET /chat/sessions — the chat-page list (visibility filter applied) ─────────────────────────────
export const listSessions = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  try {
    const sessions = await listVisibleSessions(userId);
    return res.json({ success: true, data: { sessions: sessions.map(serializeSession), count: sessions.length } });
  } catch (e) {
    console.error("[GET /me/chat/sessions]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to load chat sessions" });
  }
};

// ── GET /chat/sessions/:id — one session with its messages ──────────────────────────────────────────
export const getSession = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id ?? "");
  try {
    const got = await getSessionWithMessages(userId, id);
    if (!got) {
      return res.status(404).json({ success: false, error: "not_found", message: "Not your chat session" });
    }
    // The quota rides along, so the first paint knows whether the composer can be typed into — no second
    // request, and no window in which a capped reader is shown a live input.
    return res.json({
      success: true,
      data: { session: serializeSession(got.session), messages: serializeVisibleMessages(got.messages), quota: await readQuotaState(userId) },
    });
  } catch (e) {
    console.error("[GET /me/chat/sessions/:id]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to load chat session" });
  }
};

// ── PATCH /chat/sessions/:id — rename (sets titleSource=user) ───────────────────────────────────────
export const renameSession = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id ?? "");
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten() });
  }
  try {
    const updated = await renameSessionSvc(userId, id, parsed.data.title);
    if (!updated) {
      return res.status(404).json({ success: false, error: "not_found", message: "Not your chat session" });
    }
    return res.json({ success: true, data: { session: serializeSession(updated) } });
  } catch (e) {
    console.error("[PATCH /me/chat/sessions/:id]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to rename chat session" });
  }
};

// ── DELETE /chat/sessions/:id — delete a conversation (owner-scoped; messages cascade) ──────────────
export const deleteSession = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id ?? "");
  try {
    const removed = await deleteSessionSvc(userId, id);
    if (!removed) {
      return res.status(404).json({ success: false, error: "not_found", message: "Not your chat session" });
    }
    return res.json({ success: true, data: { removed: true, id } });
  } catch (e) {
    console.error("[DELETE /me/chat/sessions/:id]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to delete chat session" });
  }
};
