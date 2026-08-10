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
// ⚠ A VALUE IMPORT, not `import type`. `Prisma.DbNull` is the only way to write SQL NULL into a nullable
// Json column through the client (a bare `null` is a type error, because for Json columns `null` is
// ambiguous between the JSON value and the SQL one) — and clearing pending_proposal on an edit needs it.
import { Prisma } from "../generated/prisma/client.js";
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
function serializeMessage(m: ChatMessageRow, changed: string[] = []) {
  return {
    id: m.id,
    role: m.role,
    content: m.displayContent ?? m.content,
    isOpening: m.isOpening,
    guardrailBlocked: m.guardrailBlocked,
    regenerated: m.regenerated,
    // ★ WHAT THIS TURN CHANGED IN THE READER'S DATA — attributed to the assistant row that ended the
    //   turn (see serializeVisibleMessages). Empty on every ordinary answer. It exists because the tool
    //   turns that carry the evidence are stripped from this transcript, so without it the ONLY place a
    //   confirmed write is visible to a client is the live send response — which is exactly the thing a
    //   dropped connection loses, and exactly the thing an edit is about to delete.
    changed,
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
  const out: ReturnType<typeof serializeMessage>[] = [];
  // ── EFFECT ATTRIBUTION ────────────────────────────────────────────────────────────────────────────
  // A turn is written as one contiguous run: user → [tool_call → tool_result]* → assistant, with
  // strictly-increasing stamps (see appendFollowup §EXPLICIT createdAt). So the domains a confirmed write
  // changed — recorded on the tool_result's payload — always sit between a user row and the assistant row
  // that answered it, and belong to THAT assistant row. Accumulate, then flush onto it.
  //
  // Reset on a visible user row too: a run that produced no assistant row (which today cannot happen —
  // nothing is persisted until the terminal transaction) must not be able to leak its effects forward
  // onto some later turn's reply, where it would claim a write that a different exchange performed.
  let pending = new Set<string>();
  for (const m of messages) {
    if (m.kind === "tool_result") {
      const eff = (m.toolPayload as { effects?: unknown } | null)?.effects;
      if (Array.isArray(eff)) for (const d of eff) if (typeof d === "string") pending.add(d);
      continue;
    }
    if (m.kind !== "text") continue; // tool_call — internal, carries no effects of its own
    if (m.role === "user" && m.isOpening && m.displayContent == null) continue; // hidden scaffolding
    if (m.role === "user") {
      out.push(serializeMessage(m));
      pending = new Set();
      continue;
    }
    out.push(serializeMessage(m, [...pending]));
    pending = new Set();
  }
  return out;
}

// ── History for the model — ALL messages in order (incl. the grounded scaffolding AND the tool turns). ──
//
// ★ EXCEPT THE UNDELIVERED ONES. A quota-denied message was refused BEFORE any model call: the model has
//   never seen it, and replaying it now would both invent a turn that never happened and leave a user
//   message with no answer after it (two user turns in a row). The reader still sees the row — it is
//   their message, and they can retry it — but the model's history is exactly what it was before denied
//   messages were persisted at all. This is also why the denial notice is not stored as an assistant
//   message: there is no assistant row to exclude, so the model can never quote it back.
export async function loadHistoryForModel(
  sessionId: string,
  opts: { excludeMessageId?: string } = {},
): Promise<AiMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    // ★ `excludeMessageId` IS THE EDIT PATH, AND IT IS NOT A CONVENIENCE. An edit re-sends one existing
    //   row, and the row it re-sends must be dropped from the history and re-appended by the caller as
    //   `modelFacingUserTurn(newText)` — the per-turn language directive that every ordinary send gets and
    //   that is deliberately never persisted (compose.ts). Replaying the stored row instead would make the
    //   edited turn the ONE turn in the product generated without it.
    where: { sessionId, undelivered: false, ...(opts.excludeMessageId ? { id: { not: opts.excludeMessageId } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
  // ⚠ TIES BROKEN BY id, EVERYWHERE TRANSCRIPT ORDER IS READ. Within a turn the stamps are explicitly
  // strictly-increasing (§EXPLICIT createdAt below), but nothing prevents two SEPARATE transactions from
  // landing on the same millisecond, and `ORDER BY created_at` alone leaves that pair's order undefined —
  // it could differ between two reads of the same rows. That is tolerable for rendering and NOT tolerable
  // for the edit boundary, which is "every row after this one": an undefined order there is an undefined
  // set of rows to delete. One deterministic order, used by this read, the model's history read and the
  // edit plan alike, so all three agree about what "after" means.
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
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
  /**
   * ★ WHEN THE READER ACTUALLY PRESSED SEND — captured by the controller BEFORE the generation, not here.
   *
   * ⚠ WITHOUT IT THE USER ROW IS STAMPED AT THE WRONG MOMENT, and it took a reader-visible timestamp to
   * notice. This function runs AFTER the turn has been generated, so `Date.now()` here is send-time plus
   * the whole generation — a few seconds on an ordinary answer, and far longer on a tool-using turn that
   * made five round trips. Nothing cared while the stamp was only an ordering key; the transcript now
   * renders it as "4m ago", and a message would have claimed to be newer than it was, by an amount that
   * varies with how hard the question was.
   *
   * Optional, and IGNORED unless it is genuinely between the previous row and this transaction — see the
   * clamp below. The ordering invariant outranks the label.
   */
  sentAt?: Date;
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

  // ── THE USER ROW'S STAMP: the send instant, CLAMPED to the ordering invariant ────────────────────
  // `sentAt` is the honest moment (see FollowupInput). It is used only when it genuinely falls between the
  // conversation's newest surviving row and this transaction — which is the normal case, and is checked
  // rather than assumed because two tabs can be sending at once: a second tab that started BEFORE the
  // first tab's reply landed would otherwise stamp its question earlier than the answer above it and
  // silently reorder the transcript, which is the one thing every reader of these rows depends on.
  const floor = supersede ? null : (tail?.createdAt.getTime() ?? null);
  const userSlot = nextTs(); // consumed either way, so the tool/assistant stamps keep their positions
  const sent = input.sentAt?.getTime();
  const userTs =
    sent != null && sent < userSlot.getTime() && (floor == null || sent > floor) ? new Date(sent) : userSlot;

  await prisma.$transaction(async (tx) => {
    if (supersede) await tx.chatMessage.delete({ where: { id: supersede } });
    await tx.chatMessage.create({
      data: { sessionId: session.id, role: "user", content: input.userText, isOpening: false, kind: "text", createdAt: userTs },
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// EDITING A MESSAGE — REPLACE IN PLACE, AND DELETE WHAT IT INVALIDATED
//
// The reader rewrites something they said; everything after it was answered from a premise that no longer
// exists, so it goes. Destructive by design and by the reader's explicit choice — which is what buys the
// absence of a parent pointer, a branch UI, a lineage column and a second session in the list.
//
// ── ★ WHY THE BOUNDARY IS "EVERY ROW AFTER THE TARGET", AND WHY THAT CANNOT SPLIT A TOOL PAIR ──────
//
// A functionResponse with no functionCall before it is malformed history, and Gemini 3.x additionally
// rejects a replayed functionCall whose thoughtSignature is missing (400 INVALID_ARGUMENT) — so a cut
// that lands INSIDE a turn does not degrade the next generation, it kills it. The guarantee here is
// structural rather than a rule someone has to remember:
//
//   · a turn is persisted as one contiguous run in ONE transaction — user → [tool_call → tool_result]* →
//     assistant — with explicitly strictly-increasing stamps (§EXPLICIT createdAt in appendFollowup);
//   · therefore every tool row of turn N lies strictly between turn N's user row and turn N+1's user row;
//   · the target is required to be a `kind:"text"` user row, i.e. a turn's FIRST row;
//   · so "delete everything after the target" is always a cut at a turn boundary, and a pair is either
//     wholly before the cut or wholly after it. Never straddling. There is no pair-aware code below
//     because there is nothing for it to do.
//
// ⚠ `kind:"text"` IS LOAD-BEARING IN THAT ARGUMENT, not a tidiness check. A tool_result rides on
// role:"user" too (Gemini has no tool role), so "a user row" alone would admit a row in the MIDDLE of a
// turn and the cut would split exactly the pair this is protecting.
//
// ── ★ AND `isOpening:false` IS WHAT PROTECTS THE GROUNDING ────────────────────────────────────────
// message[0] is the server-composed scaffolding: the fact block, the orientation, the style example. On a
// discuss session it IS the fact block, and it is now VISIBLE to the reader (its display_content twin), so
// it looks exactly like something they said and could edit. Deleting or rewriting it silently un-grounds
// the conversation — every later answer would be generated against a world that was never described. It is
// the one row that is rendered and not editable, refused here as well as hidden client-side.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Why an edit was refused. `not_found` covers a foreign / unknown id (owner-scoped — same IDOR posture
 *  as everything else here); the other two are the two structural bars above. */
export type EditRefusal = "not_found" | "opening_not_editable" | "not_a_text_message";

export interface EditPlan {
  target: ChatMessageRow;
  /** Every row after the target, in transcript order — exactly what will be deleted. */
  suffixIds: string[];
  /** How many of those the READER can see. The count in the warning must be the count on their screen,
   *  not the row count, which includes tool traffic they have never been shown. */
  visibleSuffixCount: number;
  /**
   * ★ THE DOMAINS A CONFIRMED WRITE IN THE SUFFIX ALREADY CHANGED — the evidence behind the specific
   * warning. Read off the persisted tool results (AiToolResult.effects), which is the only honest source:
   * none of the tables a chat write touches carries a session back-reference, so the transcript is the
   * ONLY record that a given conversation caused a given change. Empty ⇒ nothing in the tail wrote
   * anything and the warning can say so plainly.
   */
  writeEffects: string[];
}

/** Build the plan without touching anything. Owner-scoped through the session. */
export async function planMessageEdit(userId: string, sessionId: string, messageId: string): Promise<EditPlan | EditRefusal> {
  const owned = await prisma.chatSession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
  if (!owned) return "not_found";
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], // the one deterministic order — see getSessionWithMessages
  });
  const at = rows.findIndex((r) => r.id === messageId);
  if (at < 0) return "not_found";
  const target = rows[at];
  if (target.role !== "user") return "not_a_text_message";
  if (target.kind !== "text") return "not_a_text_message"; // a tool_result also rides on role "user"
  if (target.isOpening) return "opening_not_editable"; // the grounding — see the header

  const suffix = rows.slice(at + 1);
  const writeEffects = new Set<string>();
  for (const r of suffix) {
    if (r.kind !== "tool_result") continue;
    const eff = (r.toolPayload as { effects?: unknown } | null)?.effects;
    if (Array.isArray(eff)) for (const d of eff) if (typeof d === "string") writeEffects.add(d);
  }
  return {
    target,
    suffixIds: suffix.map((r) => r.id),
    visibleSuffixCount: serializeVisibleMessages(suffix).length,
    writeEffects: [...writeEffects],
  };
}

/**
 * Commit the destructive half: drop the suffix, rewrite the target, disarm the session.
 *
 * ★ THE PENDING PROPOSAL IS CLEARED UNCONDITIONALLY, and it is the reason this is a transaction rather
 * than three statements. A proposal is "the change the next 'yes' refers to", and after this call the
 * message that produced it may not exist any more — so the referent is gone while the consent slot is
 * still armed. Leaving it would let a later "yes" execute values the reader was shown in a turn that has
 * been deleted, which is precisely the failure the one-proposal-per-session column exists to prevent.
 *
 * ★ AND THE TARGET'S DENIAL MARKS ARE CLEARED, which is what makes editing a never-sent message work at
 * all: `undelivered` rows are excluded from the model's history, so a row left flagged would be rewritten,
 * re-sent, answered — and invisible to the generation answering it.
 *
 * `createdAt` is deliberately NOT touched: the row keeps the moment the reader first sent it, which is
 * what the transcript's own relative-time label reports.
 */
export async function applyMessageEdit(userId: string, sessionId: string, plan: EditPlan, content: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // ★ EVERY STATEMENT RE-ASSERTS THE OWNER, rather than inheriting it from the plan that was built a
    //   moment ago. `updateMany`/`deleteMany` take a relation filter where `update` cannot, so this costs
    //   nothing and means the destructive half is scoped on its own terms — the same posture as
    //   deleteSession, and the reason a session id alone can never reach another reader's transcript.
    if (plan.suffixIds.length) {
      await tx.chatMessage.deleteMany({ where: { sessionId, session: { userId }, id: { in: plan.suffixIds } } });
    }
    await tx.chatMessage.updateMany({
      where: { id: plan.target.id, sessionId, session: { userId } },
      data: { content, undelivered: false, deniedReason: null, deniedScope: null, deniedResetAt: null },
    });
    await tx.chatSession.updateMany({
      where: { id: sessionId, userId },
      data: { lastMessageAt: new Date(), pendingProposal: Prisma.DbNull },
    });
  });
}

/** Append the fresh reply (and its tool turns) after an edited message. The user row already exists — this
 *  is appendFollowup minus the user write, minus promotion and minus titling (see the controller for why
 *  the title deliberately does not move). Same strictly-increasing stamp discipline. */
export interface EditedReplyInput {
  session: ChatSessionRow;
  toolTurns?: PersistedToolTurn[];
  assistantText: string;
  assistantUsage: TokenUsage | null;
  guardrailBlocked: boolean;
  regenerated: boolean;
}

export async function appendReplyAfterEdit(input: EditedReplyInput): Promise<{ session: ChatSessionRow; messages: ChatMessageRow[] }> {
  const { session } = input;
  const turns = input.toolTurns ?? [];
  const base = Date.now();
  let seq = 0;
  const nextTs = (): Date => new Date(base + seq++);

  await prisma.$transaction(async (tx) => {
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
    await tx.chatSession.update({ where: { id: session.id }, data: { lastMessageAt: new Date() } });
  });
  const got = await getSessionWithMessages(session.userId, session.id);
  return got!;
}

/** The edit was made but the spend gate refused the regeneration: the rewritten message stands, marked
 *  undelivered, carrying its own denial and its own retry — the same state a denied ordinary send leaves,
 *  reached from the one path that has an existing row to mark instead of a new one to write. */
export async function markMessageUndelivered(
  userId: string,
  sessionId: string,
  messageId: string,
  denial: { reason: string | null; scopeDenied: DeniedScope; resetAt: Date | null },
): Promise<{ session: ChatSessionRow; messages: ChatMessageRow[] } | null> {
  await prisma.chatMessage.updateMany({
    where: { id: messageId, sessionId, session: { userId } },
    data: {
      undelivered: true,
      deniedReason: denial.reason,
      deniedScope: denial.scopeDenied,
      deniedResetAt: denial.resetAt,
    },
  });
  return getSessionWithMessages(userId, sessionId);
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
