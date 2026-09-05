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
import { composeDiscussOpening, composeChatPageOpening } from "../../chat/compose.js";
import { resolveChatModel } from "../../chat/config.js";
import { runChatTurn } from "../../chat/engine.js";
import {
  findResumableDiscussSession,
  createDiscussSessionWithOpening,
  createChatPageSession,
  appendFollowup,
  appendUndeliveredUserMessage,
  planMessageEdit,
  applyMessageEdit,
  appendReplyAfterEdit,
  markMessageUndelivered,
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
import { unavailableState, quotaStateFrom, type ChatQuotaState } from "../../chat/unavailable.js";
import { peekAiCallQuota } from "../../ai/core/quota.js";
import { withAppLinks, withExternalSources } from "../../chat/voice.js";
import { resolveAppLinks } from "../../chat/links.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";
import type { Actor } from "../../ai/core/quota.js";
import { route, modelClassifier } from "../../router/route.js";
import { composeTurn } from "../../composition/compose.js";
import { accessibleText } from "../../composition/accessible-text.js";
import { wrapSections } from "../../composition/section-envelope.js";
import type { AnswerProse } from "../../composition/contract.js";
import type { AnySection } from "../../composition/contract.js";
import type { TurnResult } from "../../composition/compose.js";
import { readEnvelope } from "../../composition/section-envelope.js";
import { lastAssistantSections } from "../../chat/sessions.js";
import type { TurnContext } from "../../router/contract.js";

/** What the transcript renders, off ANY branch — see the note at the call site. */
function renderableOf(r: TurnResult): { sections: readonly AnySection[]; prose: AnswerProse } {
  return r.kind === "composed" ? { sections: r.sections, prose: r.prose } : r.render;
}
const compositionIdOf = (r: TurnResult): string => (r.kind === "composed" ? r.compositionId : r.kind);

/**
 * ★ THE CONTEXT THE NEXT TURN INHERITS, STAMPED WITH WHICH FAMILY ANSWERED — Phase 3 · MT.
 *
 * ⚠ THE ROUTER CANNOT FILL `lastFamily` AND CORRECTLY DECLARES `null`: which family answers is decided
 *   one layer later, by the composer. This is the one place that holds BOTH the context and the
 *   composed id, so it is the only place the stamp can honestly be made.
 *
 * ★ THE FAMILY, NOT THE ID. `patterns.stock` becomes `patterns` — a follow-up cares which KIND of
 *   answer is on screen, and variant names are a family's private business. See
 *   `TurnContext.lastFamily`.
 *
 * ⚠ AND ONLY FOR A COMPOSED FAMILY ANSWER. `planned:*` and `clarify_*` are not families; stamping
 *   either would teach the next turn to route toward a shape nothing owns.
 */
const withLastFamily = (ctx: TurnContext, r: TurnResult): TurnContext => {
  if (r.kind !== "composed") return { ...ctx, lastFamily: null };
  const id = r.compositionId;
  if (id.startsWith("planned:") || !id.includes(".")) return { ...ctx, lastFamily: null };
  return { ...ctx, lastFamily: id.split(".")[0]! };
};

/**
 * The slots the previous assistant turn settled, for a follow-up to inherit.
 *
 * ★ IT FAILS TO `null`, NEVER TO A GUESS. A missing envelope, an unreadable one, or one written
 * before stage 9 all mean "no context" — and no context is the behaviour every turn had until now,
 * so the worst case is the old behaviour rather than a wrong one.
 */
async function lastTurnContext(sessionId: string): Promise<TurnContext | null> {
  try {
    const raw = await lastAssistantSections(sessionId);
    if (!raw) return null;
    const read = readEnvelope(raw);
    return read.ok ? (read.envelope.context ?? null) : null;
  } catch {
    return null;
  }
}

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
/** An edit is a message send with a target row — same bounds as SendBody, deliberately (the composer the
 *  reader types the edit into is literally the same component, capped at the same MAX_MESSAGE_LENGTH). */
const EditBody = z.object({
  content: z.string().trim().min(1).max(4000),
  /** ★ The reader has been shown, and accepted, that a CONFIRMED WRITE in the discarded tail will not be
   *  undone. Absent/false with writes present ⇒ 409 rather than a silent destruction — see editMessage. */
  acknowledgeWrites: z.boolean().optional(),
});


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
  // ★ THE SEND INSTANT, TAKEN NOW — before routing, before composing. It becomes the user row's
  //   createdAt, which the transcript renders as "4m ago"; stamping it at the end of the turn would
  //   report the reader's message as having been sent when the answer finished.
  const sentAt = new Date();

  try {
    const got = await getSessionWithMessages(userId, id);
    if (!got) {
      return res.status(404).json({ success: false, error: "not_found", message: "Not your chat session" });
    }
    const { session } = got;
    const priorUserMessages = await countVisibleUserMessages(id);
    const isFirstChatPageExchange = session.origin === "chat_page" && priorUserMessages === 0;

    // ═══ THE SWITCHOVER (stage 8b) ═══════════════════════════════════════════════════════════════
    //
    // What used to be here: build a system prompt, replay history, ship 33 tool schemas, let the model
    // choose reads, loop up to N tool rounds, sweep a pending proposal, then compose text out of
    // whatever came back.
    //
    // What is here now: classify, resolve, compose. The model sees a small fixed prompt and a manifest
    // of what we HOLD; every figure is a query result it never saw (§5.3, N-1).
    //
    // ⚠ THERE IS NO `unavailable` BRANCH ANY MORE, AND ITS ABSENCE IS A FEATURE. The old path refused
    //   the turn when the spend gate said no. The router and planner each carry their own quota gate
    //   now and DEGRADE instead — a denied turn falls to the lexical classifier and the deterministic
    //   planner, so the reader still gets an answer and `RouterOutput.source` records that we could
    //   not ask (§6.5). Refusing to answer at all is strictly worse than answering plainly.
    // ★ THE PREVIOUS TURN, SO A FOLLOW-UP CAN REFER TO IT (stage 9). Read from the last assistant row
    //   this conversation stored. `null` on the first question, and null after a row written before
    //   stage 9 — in both cases the turn routes exactly as it did before, on its own text.
    const prior = await lastTurnContext(id);
    const routed = await route(message, modelClassifier, { userId }, prior);
    const composed = await composeTurn(routed, { userId });

    // ── One composed answer, two representations. `content` is the accessible/searchable form; the
    //    envelope is what the transcript replays. Both come from the SAME compose — never two runs.
    //
    // ★ `render` IS READ OFF EVERY BRANCH, NOT JUST `composed`. This used to take `sections` from a
    //   composed result and flatten everything else to a single sentence — which is how three
    //   resolved candidate companies reached the reader as one line of grey text with nothing to
    //   press. See composition/ask-back.ts.
    const { sections, prose } = renderableOf(composed);
    const assistantText = accessibleText(sections, prose);
    // Sections are stored whenever there ARE any — a clarify turn with chips replays as a clarify
    // turn with chips, rather than as prose that lost its affordances on reload.
    // ★ ONLY AN ANSWERED TURN SEEDS THE NEXT ONE'S CONTEXT.
    //
    // ⚠ A CLARIFY TURN RESOLVED NOTHING, AND LETTING IT SEED CONTEXT PRODUCED A REAL WRONG ANSWER:
    //   "how is HDFC doing" (ambiguous — no subject resolved, but the slots still said `orient`)
    //   followed by "TCS" inherited `orient` from a question that was never answered, so the bare
    //   ticker got a full orientation instead of being asked what the reader wanted to know. The
    //   context of a turn that asked the reader a question back is the reader's turn, not ours.
    const envelope = sections.length > 0
      ? wrapSections(sections, prose, compositionIdOf(composed), composed.kind === "composed" ? withLastFamily(routed.context, composed) : undefined)
      : undefined;

    const updated = await appendFollowup({
      session,
      sentAt,
      userText: message,
      assistantText,
      assistantSections: envelope,
      assistantUsage: null,
      // ⚠ NOT A GUARDRAIL BLOCK. The model writes no figures on this path, so there is nothing for the
      //   number guardrail to catch — the flag stays false rather than being repurposed.
      guardrailBlocked: false,
      regenerated: false,
      provisionalTitle: isFirstChatPageExchange ? truncateTitle(message) : undefined,
    });

    if (isFirstChatPageExchange) {
      try {
        await enqueueJob({ type: JobTypes.CHAT_TITLE_GENERATE, payload: { sessionId: id }, triggeredBy: `user:${userId}` });
      } catch (e) {
        console.warn("[chat] title job enqueue failed (non-fatal):", (e as Error).message);
      }
    }

    const reply = serializeVisibleMessages(updated.messages).at(-1) ?? null;
    return res.json({
      success: true,
      data: {
        session: serializeSession(updated.session),
        messages: serializeVisibleMessages(updated.messages),
        reply,
        // ★ `changed` IS NOW ALWAYS EMPTY, AND STAYS ON THE WIRE. Nothing this endpoint does writes to
        //   the reader's data — a write happens when they tap an ACTION control, which calls its own
        //   endpoint and invalidates its own caches. The field remains so no client has to test for it.
        changed: [] as string[],
        // What the router made of the question. Diagnostic, and what lets a bad answer be traced from
        // a transcript rather than only from a server log.
        routed: {
          scope: routed.router.scope, operation: routed.router.operation, lens: routed.router.lens,
          perspective: routed.router.perspective, action: routed.router.action, source: routed.router.source,
        },
      },
    });
  } catch (e) {
    console.error("[POST /me/chat/sessions/:id/messages]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to send message" });
  }
};

// ── PATCH /chat/sessions/:id/messages/:messageId — rewrite a message, discard what it invalidated ───
/**
 * REPLACE IN PLACE. The reader rewrites something they said; every turn after it was answered from a
 * premise that no longer exists, so it is deleted and a fresh reply is generated from that point.
 *
 * ── ★ THE 409 IS THE POINT, NOT AN ERROR CASE ──────────────────────────────────────────────────────
 * Deleting the transcript does NOT undo what a confirmed write did. A recorded transaction has already run
 * the FIFO replay and altered a real holding's cost basis; an alert is still armed; a watchlist removal is
 * still gone. None of those tables carries a session back-reference, so there is nothing to cascade even
 * in principle — the effect simply outlives the conversation that caused it, and after this call there is
 * no record left explaining where it came from.
 *
 * So the destruction is gated on the reader having been told THAT specific fact. `acknowledgeWrites` is not
 * a formality: the server computes the tail's write domains itself and refuses with 409 + the domains when
 * they were not acknowledged, which means a client working from a stale transcript — one that never saw
 * the confirming turn, so never warned about it — cannot destroy the record of a filed trade silently. It
 * gets the domains back and asks again. The reader is the only one who can authorise this, and they can
 * only authorise what they were shown.
 *
 * ── WARN RATHER THAN REFUSE, AND WHY THAT IS DEFENSIBLE HERE ───────────────────────────────────────
 * An outright refusal on a write-bearing tail would make one confirmed alert freeze a conversation's whole
 * history permanently — punishing the reader for having used the product. It is only defensible if the
 * warning is RELIABLE, and this one is: the evidence is `AiToolResult.effects`, written by
 * confirmPendingAction after the service returned, on the persisted tool turn. Not the model's prose, not
 * a heuristic over a receipt — a code-owned field set on exactly the path that performed the write. A
 * failed confirm records nothing, so the warning cannot fire on a write that did not happen.
 */
export const editMessage = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id ?? "");
  const messageId = String(req.params.messageId ?? "");
  const parsed = EditBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten() });
  }
  const { content, acknowledgeWrites } = parsed.data;

  try {
    const got = await getSessionWithMessages(userId, id);
    if (!got) {
      return res.status(404).json({ success: false, error: "not_found", message: "Not your chat session" });
    }

    const plan = await planMessageEdit(userId, id, messageId);
    if (plan === "not_found") {
      return res.status(404).json({ success: false, error: "not_found", message: "No such message in this conversation" });
    }
    if (plan === "opening_not_editable") {
      // The grounding scaffolding (chat/sessions.ts §EDITING). Rendered, but not editable — and the reason
      // is worth stating in the response rather than a bare 400, because the row LOOKS like an ordinary
      // question the reader asked.
      return res.status(400).json({
        success: false,
        error: "opening_not_editable",
        message: "This first message carries the conversation's grounding and can't be rewritten. Start a new conversation instead.",
      });
    }
    if (plan === "not_a_text_message") {
      return res.status(400).json({ success: false, error: "not_editable", message: "Only your own messages can be edited" });
    }

    if (plan.writeEffects.length && acknowledgeWrites !== true) {
      return res.status(409).json({
        success: false,
        error: "write_effects_unacknowledged",
        message: "Turns below this one made changes that deleting them will not undo.",
        details: { domains: plan.writeEffects, deleteCount: plan.visibleSuffixCount },
      });
    }

    // ── COMMIT THE DESTRUCTION, THEN GENERATE. In that order, deliberately: the alternative (generate
    //    first, delete on success) would leave the reader's edit unsaved whenever the generation failed,
    //    which is the state they are least able to recover from — they would have to retype it. This way a
    //    denied or failed regeneration leaves the rewritten message standing, marked, with its own retry.
    //    The pending proposal is cleared inside this transaction; see applyMessageEdit.
    await applyMessageEdit(userId, id, plan, content);

    // ── ★ THE SAME SWITCHOVER AS `sendMessage` (stage 8b). Regenerating an edited message is the same
    //    operation as answering a new one: classify, resolve, compose. There is no history to replay
    //    because the answer is a pure function of the question and the reader, which is also why an
    //    edit cannot inherit a premise from the turn it replaced.
    // ⚠ NO PRIOR CONTEXT ON AN EDIT, DELIBERATELY. An edited question replaces the one that was asked,
    //   so the turns after it no longer describe this conversation — inheriting a subject from a turn
    //   the edit has just invalidated is how a follow-up ends up answered about the wrong company.
    const routedEdit = await route(content, modelClassifier, { userId }, null);
    const composedEdit = await composeTurn(routedEdit, { userId });
    const { sections: editSections, prose: editProse } = renderableOf(composedEdit);
    const editEnvelope = editSections.length > 0
      ? wrapSections(editSections, editProse, compositionIdOf(composedEdit), withLastFamily(routedEdit.context, composedEdit))
      : undefined;
    const assistantText = accessibleText(editSections, editProse);

    const updated = await appendReplyAfterEdit({
      session: got.session,
      
      assistantText,
      assistantSections: editEnvelope,
      assistantUsage: null,
      guardrailBlocked: false,
      regenerated: true,
    });

    // ★ THE TITLE DOES NOT MOVE, and it structurally cannot: the model title job fires only when
    //   countVisibleUserMessages is 0, and the edited row is itself a visible user message, so the count
    //   is at least 1 on every possible edit. Editing the first message of a named conversation therefore
    //   leaves the name describing the question as it was first asked. Deliberate — a title that silently
    //   rewrote itself under a reader who was editing one word would be the surprising behaviour.
    const reply = serializeVisibleMessages(updated.messages).at(-1) ?? null;
    // Nothing on this path writes to the reader's data — a write happens when they tap a control,
    // which calls its own endpoint. The field stays so no client has to test for it.
    const changed: string[] = [];
    return res.json({
      success: true,
      data: {
        session: serializeSession(updated.session),
        messages: serializeVisibleMessages(updated.messages),
        reply,
        changed,
        deleted: plan.visibleSuffixCount,
      },
    });
  } catch (e) {
    console.error("[PATCH /me/chat/sessions/:id/messages/:messageId]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to edit message" });
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
