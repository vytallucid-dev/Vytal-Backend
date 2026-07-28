// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SESSION LIFECYCLE — the DB half of chat. Pure persistence + the lifecycle rules; NO generation here
// (that is engine.ts) and NO composition (compose.ts). Every read/write is owner-scoped by userId.
//
// THE RULES, IN ONE PLACE:
//   · RESUME (discuss): the newest (userId, surface, subjectKind, subjectSymbol) discuss session whose
//     lastMessageAt is within 24h. The window measures from lastMessageAt (activity extends it), NOT
//     createdAt. No match ⇒ the caller composes a fresh opening.
//   · PROMOTE: a discuss session flips promoted=true on the user's FIRST non-opening message (one is
//     enough). A chat_page session is BORN promoted=true — it is permanent chat-page history from creation,
//     which makes `promoted=true` mean exactly "permanent + chat-page-visible" for BOTH origins. That single
//     meaning powers the visibility filter AND the retention exemption (unpromoted_only spares promoted=true).
//   · VISIBILITY (chat page): promoted=true — chat_page (always) ∪ discuss (once promoted). A query filter,
//     not a data difference. The sidebar never lists; it only ever resumes-or-creates the current subject.
//   · TWO CLOCKS: the 24h window governs sidebar RESUMABILITY; `promoted` governs chat-page VISIBILITY +
//     prune survival. A promoted session past 24h no longer resumes in the sidebar but stays on the chat page.
//
// The opening USER message (message[0]) carries the grounded context and is internal scaffolding — it is
// EXCLUDED from the serialized transcript (the client sees the assistant's opening + the real exchange),
// but KEPT in the DB so full-history resend carries the grounding.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import type { AiMessage, AiToolCall, AiToolResult, TokenUsage } from "../ai/types.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { DiscussContext } from "./discuss-context.js";
import type { PersistedToolTurn } from "./engine.js";
import { canonicalSubjectSymbol } from "./compose.js";
import { denialFor, type DeniedScope } from "./unavailable.js";

/** The sidebar resume window — measured from lastMessageAt. */
export const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

type ChatSessionRow = Awaited<ReturnType<typeof prisma.chatSession.findFirstOrThrow>>;
type ChatMessageRow = Awaited<ReturnType<typeof prisma.chatMessage.findFirstOrThrow>>;

// ── Serialization for the envelope ─────────────────────────────────────────────────────────────────
export function serializeSession(s: ChatSessionRow) {
  return {
    id: s.id,
    origin: s.origin,
    surface: s.surface,
    subjectKind: s.subjectKind,
    subjectSymbol: s.subjectSymbol,
    subjectName: s.subjectName,
    title: s.title,
    titleSource: s.titleSource,
    promoted: s.promoted,
    asOfSnapshot: s.asOfSnapshot,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    lastMessageAt: s.lastMessageAt.toISOString(),
  };
}

/** A visible transcript row.
 *
 *  ★ `content` IS SUBSTITUTED WHEN A DISPLAY TWIN EXISTS. On a discuss session's opening user row,
 *  `content` is the full grounded ask (fact block, orientation, style example) — model-facing scaffolding
 *  that must never reach a browser — and `displayContent` is the one line the reader sees themselves say.
 *  Substituting here, at the single serialization point, is what makes every read path agree: open,
 *  resume, and GET-by-id all render the same line without any of them knowing about the split. The
 *  model's copy is untouched — loadHistoryForModel reads the row directly and never comes through here. */
function serializeMessage(m: ChatMessageRow) {
  return {
    id: m.id,
    role: m.role,
    content: m.displayContent ?? m.content,
    isOpening: m.isOpening,
    guardrailBlocked: m.guardrailBlocked,
    regenerated: m.regenerated,
    // ★ THE DENIAL TRAVELS WITH THE MESSAGE IT REFUSED. Not as a trailing notice on the transcript —
    //   that is exactly what could not tell the reader WHICH of two messages went unanswered, and what
    //   vanished on refresh. `denial` is composed here, against the clock, from the stored scope + reset
    //   instant (see unavailable.ts), so a denial read tomorrow never promises a reset that has passed.
    undelivered: m.undelivered,
    denial: m.undelivered ? denialFor(m) : null,
    usage:
      m.promptTokens != null || m.outputTokens != null
        ? { promptTokens: m.promptTokens, outputTokens: m.outputTokens, cachedTokens: m.cachedTokens, modelVersion: m.modelVersion }
        : null,
    createdAt: m.createdAt.toISOString(),
  };
}

/** The client-facing transcript: everything EXCEPT the internal grounded opening user scaffolding AND the
 *  internal tool turns (tool_call / tool_result — the user must never see raw tool JSON). The assistant's
 *  opening (kind text, isOpening, role=assistant) IS shown — it is the opening the reader reads.
 *
 *  ★ AN OPENING USER ROW WITH A DISPLAY TWIN IS SHOWN. `displayContent != null` is precisely the test for
 *  "this scaffolding stands in for something the reader asked", and it is the only thing that changed
 *  here: the row is still dropped whenever the twin is absent, which covers every chat_page opening
 *  (orientation, nobody asked anything) and every discuss opening written before the twin existed. So the
 *  hidden-by-default posture is intact — a row earns visibility by having a reader-facing text, never by
 *  being an opening. serializeMessage above then swaps in that text for `content`. */
export function serializeVisibleMessages(messages: ChatMessageRow[]) {
  return messages
    .filter((m) => m.kind === "text" && !(m.role === "user" && m.isOpening && m.displayContent == null))
    .map(serializeMessage);
}

// ── History for the model — ALL messages in order (incl. the grounded scaffolding AND the tool turns). ──
//
// ★ EXCEPT THE UNDELIVERED ONES. A quota-denied message was refused BEFORE any model call: the model has
//   never seen it, and replaying it now would both invent a turn that never happened and leave a user
//   message with no answer after it (two user turns in a row). The reader still sees the row — it is
//   their message, and they can retry it — but the model's history is exactly what it was before denied
//   messages were persisted at all. This is also why the denial notice is not stored as an assistant
//   message: there is no assistant row to exclude, so the model can never quote it back.
export async function loadHistoryForModel(sessionId: string): Promise<AiMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId, undelivered: false },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, kind: true, toolPayload: true },
  });
  // ⚠ TRUNCATION SEAM (config.ts): if this grows unbounded, keep rows[0] (the grounding) and summarize/drop
  //    the oldest middle turns. Never drop rows[0] — that silently un-grounds the conversation. A tool_call
  //    and its tool_result must be kept or dropped TOGETHER (a functionResponse with no functionCall is
  //    malformed history) — so the truncation unit is a (call → result) pair, not a single message.
  return rows.map((r): AiMessage => {
    if (r.kind === "tool_call") {
      return { role: "assistant", content: r.content, toolCalls: (r.toolPayload as unknown as AiToolCall[]) ?? [] };
    }
    if (r.kind === "tool_result") {
      return { role: "user", content: "", toolResult: r.toolPayload as unknown as AiToolResult };
    }
    return { role: r.role as AiMessage["role"], content: r.content };
  });
}

// ── RESUME (discuss) ────────────────────────────────────────────────────────────────────────────────
/** The newest resumable discuss session for this exact subject, or null. Matches on the RAW card surface
 *  (so two cards of the same surface resume the same session) + subject + the 24h activity window. */
export async function findResumableDiscussSession(userId: string, ctx: DiscussContext): Promise<ChatSessionRow | null> {
  const cutoff = new Date(Date.now() - RESUME_WINDOW_MS);
  return prisma.chatSession.findFirst({
    where: {
      userId,
      origin: "discuss",
      surface: ctx.surface,
      subjectKind: ctx.subject.kind,
      subjectSymbol: canonicalSubjectSymbol(ctx.subject), // null matches IS NULL (portfolio / concept)
      lastMessageAt: { gte: cutoff },
    },
    orderBy: { lastMessageAt: "desc" },
  });
}

export async function getSessionWithMessages(userId: string, id: string): Promise<{ session: ChatSessionRow; messages: ChatMessageRow[] } | null> {
  const session = await prisma.chatSession.findFirst({ where: { id, userId } });
  if (!session) return null;
  const messages = await prisma.chatMessage.findMany({ where: { sessionId: id }, orderBy: { createdAt: "asc" } });
  return { session, messages };
}

// ── Persistence of a turn's usage → the per-message metering columns ────────────────────────────────
const meterCols = (usage: TokenUsage | null) => ({
  promptTokens: usage?.promptTokens ?? null,
  outputTokens: usage?.outputTokens ?? null,
  cachedTokens: usage?.cachedTokens ?? null,
  modelVersion: usage?.modelVersion ?? null,
});

// ── CREATE (discuss, with the opening exchange already generated) ───────────────────────────────────
export interface DiscussCreateInput {
  userId: string;
  surface: string; // the RAW card surface
  subjectKind: string | null;
  subjectSymbol: string | null;
  subjectName: string | null;
  title: string;
  asOfSnapshot: string | null;
  openingUserContent: string; // the grounded scaffolding (message[0]) — MODEL-facing
  openingDisplayContent: string; // its reader-facing twin (message[0].display_content)
  assistantText: string;
  assistantUsage: TokenUsage | null;
  guardrailBlocked: boolean;
  regenerated: boolean;
}

export async function createDiscussSessionWithOpening(input: DiscussCreateInput): Promise<{ session: ChatSessionRow; messages: ChatMessageRow[] }> {
  const id = await prisma.$transaction(async (tx) => {
    const session = await tx.chatSession.create({
      data: {
        userId: input.userId,
        origin: "discuss",
        surface: input.surface,
        subjectKind: input.subjectKind,
        subjectSymbol: input.subjectSymbol,
        subjectName: input.subjectName,
        title: input.title,
        titleSource: "derived", // card-originated titles are derived immediately, no model call
        promoted: false, // a fresh discuss session is unpromoted until the first follow-up
        asOfSnapshot: input.asOfSnapshot,
      },
    });
    await tx.chatMessage.create({
      // ONE row, TWO texts: `content` is what the model gets forever (full history resend), and
      // `displayContent` is what the reader sees. Written together so they can never be out of step.
      data: {
        sessionId: session.id,
        role: "user",
        content: input.openingUserContent,
        displayContent: input.openingDisplayContent,
        isOpening: true,
      },
    });
    await tx.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: input.assistantText,
        isOpening: true,
        guardrailBlocked: input.guardrailBlocked,
        regenerated: input.regenerated,
        ...meterCols(input.assistantUsage),
      },
    });
    return session.id;
  });
  const got = await getSessionWithMessages(input.userId, id);
  return got!;
}

// ── CREATE (chat page — empty, born promoted; the orientation scaffolding is message[0]) ────────────
export async function createChatPageSession(userId: string, openingUserContent: string, provisionalTitle: string): Promise<{ session: ChatSessionRow; messages: ChatMessageRow[] }> {
  const id = await prisma.$transaction(async (tx) => {
    const session = await tx.chatSession.create({
      data: {
        userId,
        origin: "chat_page",
        surface: null,
        subjectKind: null,
        subjectSymbol: null,
        subjectName: null,
        title: provisionalTitle,
        titleSource: "derived",
        promoted: true, // permanent chat-page history from birth (see header)
        asOfSnapshot: null,
      },
    });
    await tx.chatMessage.create({
      // NO displayContent — deliberately. This message[0] is orientation the server wrote about the
      // reader, not a question they asked, so it has no honest first-person twin and stays hidden. A
      // chat-page transcript correctly begins at the reader's own first typed message.
      data: { sessionId: session.id, role: "user", content: openingUserContent, isOpening: true },
    });
    return session.id;
  });
  const got = await getSessionWithMessages(userId, id);
  return got!;
}

// ── APPEND a follow-up exchange (user → [tool turns] → assistant), bump lastMessageAt, PROMOTE if applicable ──
export interface FollowupInput {
  session: ChatSessionRow;
  userText: string;
  /** The internal tool turns that occurred this message (from the engine), written HIDDEN between the user
   *  message and the final assistant message. Empty/absent ⇒ a plain exchange, exactly as before. */
  toolTurns?: PersistedToolTurn[];
  assistantText: string;
  assistantUsage: TokenUsage | null;
  guardrailBlocked: boolean;
  regenerated: boolean;
  /** Optionally set the provisional title in the same txn (chat_page's first message). */
  provisionalTitle?: string;
}

/** The newest message on a session, or null. Used to decide whether a send SUPERSEDES a denied attempt. */
async function newestMessage(sessionId: string): Promise<ChatMessageRow | null> {
  return prisma.chatMessage.findFirst({ where: { sessionId }, orderBy: { createdAt: "desc" } });
}

/** Is `row` a denied attempt at exactly this text, sitting at the tail? Then the send now happening is a
 *  RETRY of it, not a new message — see the two callers below for what each does about that. */
const isRetryOf = (row: ChatMessageRow | null, text: string): boolean =>
  row != null && row.undelivered && row.role === "user" && row.content.trim() === text.trim();

// ── PERSIST A DENIED MESSAGE (the spend gate refused it — nothing was generated) ─────────────────────
export interface DeniedInput {
  session: ChatSessionRow;
  userText: string;
  reason: string | null;
  scopeDenied: DeniedScope;
  /** When the denying ceiling clears; null when the gate couldn't say. */
  resetAt: Date | null;
  /** Optionally set the provisional title in the same txn (chat_page's first message) — a conversation
   *  holding one undelivered question is still a conversation, and must not be listed as "New conversation". */
  provisionalTitle?: string;
}

/**
 * Write the reader's refused message so it survives a refresh, marked undelivered.
 *
 * ★ DOES NOT PROMOTE, and that is the cleanup half of the fix. `promoted` means "permanent chat-page
 *   history"; a discuss session whose only content is a message that never went anywhere has not earned
 *   that, so it stays unpromoted and the ordinary 24h prune can still reach it.
 *
 * ★ RETRYING A DENIAL UPDATES THE ROW, never appends a second one. The tail row is the same text, already
 *   marked undelivered — the reader pressed Retry and was refused again. Appending would grow one duplicate
 *   "not sent" bubble per attempt.
 */
export async function appendUndeliveredUserMessage(input: DeniedInput): Promise<{ session: ChatSessionRow; messages: ChatMessageRow[] }> {
  const { session } = input;
  const deniedCols = {
    undelivered: true,
    deniedReason: input.reason,
    deniedScope: input.scopeDenied,
    deniedResetAt: input.resetAt,
  };
  const tail = await newestMessage(session.id);
  const retry = isRetryOf(tail, input.userText);

  await prisma.$transaction(async (tx) => {
    if (retry) {
      // Same message, refused again → refresh its denial (the reset instant may have moved on).
      await tx.chatMessage.update({ where: { id: tail!.id }, data: deniedCols });
    } else {
      await tx.chatMessage.create({
        data: { sessionId: session.id, role: "user", content: input.userText, isOpening: false, kind: "text", ...deniedCols },
      });
    }
    await tx.chatSession.update({
      where: { id: session.id },
      data: {
        lastMessageAt: new Date(),
        ...(input.provisionalTitle && session.titleSource === "derived" ? { title: input.provisionalTitle } : {}),
      },
    });
  });
  const got = await getSessionWithMessages(session.userId, session.id);
  return got!;
}

export async function appendFollowup(input: FollowupInput): Promise<{ session: ChatSessionRow; messages: ChatMessageRow[] }> {
  const { session } = input;
  // A discuss session promotes on the FIRST non-opening user message. chat_page is already promoted.
  const promote = session.origin === "discuss" && !session.promoted;
  const turns = input.toolTurns ?? [];

  // ★ EXPLICIT, STRICTLY-INCREASING createdAt. Postgres CURRENT_TIMESTAMP is TRANSACTION-constant, so every
  //   row created in this one $transaction would otherwise share a timestamp — and with 3+ rows (user +
  //   tool_call + tool_result + assistant) `ORDER BY created_at` could interleave a functionResponse before
  //   its functionCall, corrupting the replayed history. Stamping base+seq guarantees the transcript order.
  const base = Date.now();
  let seq = 0;
  const nextTs = (): Date => new Date(base + seq++);

  // ★ A SUCCESSFUL RETRY SUPERSEDES THE ATTEMPT IT REPEATS. If the tail is this exact text marked
  //   undelivered, the reader pressed Retry and it worked this time — so that row is replaced by the
  //   delivered pair below rather than left above it, which would show the same question twice with the
  //   first copy stamped "not sent". A DIFFERENT text leaves the denied row alone: that message really
  //   was never sent, and it keeps its own mark and its own retry.
  const tail = await newestMessage(session.id);
  const supersede = isRetryOf(tail, input.userText) ? tail!.id : null;

  await prisma.$transaction(async (tx) => {
    if (supersede) await tx.chatMessage.delete({ where: { id: supersede } });
    await tx.chatMessage.create({
      data: { sessionId: session.id, role: "user", content: input.userText, isOpening: false, kind: "text", createdAt: nextTs() },
    });
    for (const t of turns) {
      await tx.chatMessage.create({
        data: {
          sessionId: session.id,
          role: t.role,
          content: t.content,
          isOpening: false,
          kind: t.kind,
          toolPayload: t.toolPayload as unknown as Prisma.InputJsonValue,
          createdAt: nextTs(),
          ...meterCols(t.usage),
        },
      });
    }
    await tx.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: input.assistantText,
        isOpening: false,
        kind: "text",
        guardrailBlocked: input.guardrailBlocked,
        regenerated: input.regenerated,
        createdAt: nextTs(),
        ...meterCols(input.assistantUsage),
      },
    });
    await tx.chatSession.update({
      where: { id: session.id },
      data: {
        lastMessageAt: new Date(),
        ...(promote ? { promoted: true } : {}),
        // Provisional title only if still derived (never clobber a user rename or a model title).
        ...(input.provisionalTitle && session.titleSource === "derived" ? { title: input.provisionalTitle } : {}),
      },
    });
  });
  const got = await getSessionWithMessages(session.userId, session.id);
  return got!;
}

// ── VISIBILITY (chat page list) ─────────────────────────────────────────────────────────────────────
/** The chat-page list: promoted=true — all chat_page sessions ∪ discuss sessions that were promoted. The
 *  sidebar never calls this; it only ever resumes-or-creates the current subject. */
export async function listVisibleSessions(userId: string, limit = 100): Promise<ChatSessionRow[]> {
  return prisma.chatSession.findMany({
    where: { userId, promoted: true },
    orderBy: { lastMessageAt: "desc" },
    take: Math.min(limit, 200),
  });
}

// ── RENAME (owner-scoped; sets titleSource=user so the title job never overwrites it) ───────────────
export async function renameSession(userId: string, id: string, title: string): Promise<ChatSessionRow | null> {
  const owned = await prisma.chatSession.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) return null;
  return prisma.chatSession.update({ where: { id: owned.id }, data: { title, titleSource: "user" } });
}

// ── DELETE (owner-scoped; the turns cascade with it) ────────────────────────────────────────────────
/** Delete a conversation in ONE atomic, owner-scoped statement. The WHERE includes userId, so a
 *  non-owner (or unknown) id deletes 0 rows → the caller 404s and nothing is touched (same IDOR posture
 *  as removeFromWatchlist). chat_messages.session_id is ON DELETE CASCADE, so a session's messages go
 *  with it. Returns whether a row was actually removed. */
export async function deleteSession(userId: string, id: string): Promise<boolean> {
  const result = await prisma.chatSession.deleteMany({ where: { id, userId } });
  return result.count > 0;
}

/** Count of non-opening messages on a session — used to detect a chat_page session's FIRST exchange.
 *
 *  ⚠ UNAFFECTED BY display_content, and the filter is why: it counts `isOpening: false` rows, so an
 *  opening user row is excluded whether or not it now renders in the transcript. "Visible" here means
 *  "a real exchange", never "shown to the client" — the two senses diverged when openings became
 *  displayable, and this one did not move. The chat-page provisional-title + title-job trigger therefore
 *  still fires on the reader's genuine first message.
 *
 *  ⚠ AND UNDELIVERED ROWS DO NOT COUNT. A refused message is not an exchange — nothing was generated and
 *  nothing was titled. Counting it would mean the FIRST message that actually lands is treated as a
 *  follow-up: no title job, and the conversation would keep the truncated-text placeholder forever. */
export async function countVisibleUserMessages(sessionId: string): Promise<number> {
  return prisma.chatMessage.count({ where: { sessionId, isOpening: false, role: "user", undelivered: false } });
}

// ── THE EMPTY-CONVERSATION SWEEP ────────────────────────────────────────────────────────────────────
/**
 * Delete this user's own chat_page sessions that never received a single real message — the blank
 * "New conversation" rows a failed first send used to leave behind.
 *
 * ★ SCOPED BY "NO NON-OPENING MESSAGE AT ALL", not by "no reply". A conversation whose latest send was
 *   DENIED now holds that message (appendUndeliveredUserMessage), so it is structurally outside this
 *   sweep — as is any conversation that ever got a reply. The only rows this can reach are ones with
 *   nothing in them but the hidden orientation scaffolding.
 *
 * ★ WHY HERE AND NOT IN THE RETENTION PRUNER. chat_page sessions are born promoted=true, and the
 *   chat_sessions prune spares promoted rows (exemption unpromoted_only) — so these accumulate forever,
 *   and the rule is `armed=false` besides. Sweeping at the moment the reader starts a new conversation
 *   is self-healing, owner-scoped, and cannot outlive the account.
 *
 * ★ THE AGE FLOOR is what makes it safe against a second tab: a session younger than this may be one the
 *   reader is mid-send on. An abandoned empty is worth exactly nothing, so waiting an hour costs nothing.
 */
export const EMPTY_SESSION_GRACE_MS = 60 * 60 * 1000;

export async function sweepEmptyChatPageSessions(userId: string, graceMs = EMPTY_SESSION_GRACE_MS): Promise<number> {
  const cutoff = new Date(Date.now() - graceMs);
  const stale = await prisma.chatSession.findMany({
    where: {
      userId,
      origin: "chat_page",
      createdAt: { lt: cutoff },
      lastMessageAt: { lt: cutoff },
      messages: { none: { isOpening: false } },
    },
    select: { id: true },
    take: 100,
  });
  if (stale.length === 0) return 0;
  const result = await prisma.chatSession.deleteMany({
    // Re-assert ownership in the delete itself (same IDOR posture as deleteSession).
    where: { userId, id: { in: stale.map((s) => s.id) } },
  });
  return result.count;
}
