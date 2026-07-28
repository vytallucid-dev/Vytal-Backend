// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PROOF — a quota-denied message survives, explains itself, stays out of the model's head, and leaves
// no empty conversation behind.
//
// The failures this guards are all SILENT. Nothing throws if the denied row stops being written; the
// reader just loses what they typed on the next refresh. Nothing throws if it starts being replayed into
// the model's history; the model just begins answering a question it was never asked, or believing it once
// said "Vytal's assistant is at its daily limit". Nothing throws if the sweep widens; it just deletes
// conversations. So every one of them is asserted against REAL rows through the REAL functions.
//
// Fixtures are written, read back, and deleted. No model call, no quota spend, no network beyond the DB.
//
//   npx tsx src/scripts/verify-chat-denied-persistence.ts     (run from the backend root — needs .env)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  createChatPageSession,
  appendUndeliveredUserMessage,
  appendFollowup,
  serializeVisibleMessages,
  loadHistoryForModel,
  countVisibleUserMessages,
  getSessionWithMessages,
  sweepEmptyChatPageSessions,
} from "../chat/sessions.js";

let failures = 0;
const ok = (label: string, pass: boolean, detail?: string) => {
  console.log(`${pass ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
};

const ORIENTATION = "[ORIENTATION] The reader opened a blank chat. Nobody asked anything yet.";
const QUESTION = "How does Vytal read a company's health?";
const OTHER = "tell me about hdfc bank";

// ⚠ chat_sessions.user_id is FK-constrained, so fixtures hang off a REAL user. Cleanup deletes BY THE IDS
//   THIS SCRIPT CREATED — never by userId, which would take that user's real conversations with it.
const created: string[] = [];
const cleanup = async () => {
  if (created.length) await prisma.chatSession.deleteMany({ where: { id: { in: created } } });
};

const newSession = async (userId: string, title = "New conversation") => {
  const { session } = await createChatPageSession(userId, ORIENTATION, title);
  created.push(session.id);
  return session;
};

/** Backdate a session (and its rows) past the sweep's grace window. */
const backdate = async (id: string, hours: number) => {
  const at = new Date(Date.now() - hours * 3600_000);
  await prisma.chatSession.update({ where: { id }, data: { createdAt: at, lastMessageAt: at } });
  await prisma.chatMessage.updateMany({ where: { sessionId: id }, data: { createdAt: at } });
};

async function main() {
  const owner = await prisma.userLedger.findFirst({ select: { userId: true } });
  if (!owner) throw new Error("no user in user_ledger to hang the fixtures off");
  const userId = owner.userId;
  const FUTURE = new Date(Date.now() + 6 * 3600_000);
  const PAST = new Date(Date.now() - 30 * 3600_000);

  // ── 1. THE COLUMNS + THE INVARIANTS ──────────────────────────────────────────────────────────────
  const cols = await prisma.$queryRaw<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]>`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'chat_messages'
      AND column_name IN ('undelivered', 'denied_reason', 'denied_scope', 'denied_reset_at')
    ORDER BY column_name
  `;
  const byName = new Map(cols.map((c) => [c.column_name, c]));
  ok("all four denial columns exist", cols.length === 4, cols.map((c) => c.column_name).join(", "));
  ok(
    "undelivered is NOT NULL DEFAULT false (every existing row reads as delivered)",
    byName.get("undelivered")?.is_nullable === "NO" && (byName.get("undelivered")?.column_default ?? "").includes("false"),
  );
  ok("denied_reset_at is a timestamp, not text (rendered against the clock, never stored as prose)",
    (byName.get("denied_reset_at")?.data_type ?? "").startsWith("timestamp"));

  const s1 = await newSession(userId);
  await prisma
    .$executeRawUnsafe(
      `INSERT INTO chat_messages (id, session_id, role, content, undelivered) VALUES (gen_random_uuid(), $1, 'assistant', 'x', true)`,
      s1.id,
    )
    .then(() => ok("CHECK rejects an undelivered ASSISTANT row", false, "insert succeeded"))
    .catch((e: Error) => ok("CHECK rejects an undelivered ASSISTANT row", /undelivered_check/.test(e.message), e.message.slice(0, 60)));

  // ── 2. A DENIED SEND PERSISTS THE READER'S MESSAGE ───────────────────────────────────────────────
  const afterDeny = await appendUndeliveredUserMessage({
    session: s1,
    userText: QUESTION,
    reason: "user_daily_limit_reached",
    scopeDenied: "user",
    resetAt: FUTURE,
    provisionalTitle: QUESTION.slice(0, 40),
  });
  const vis1 = serializeVisibleMessages(afterDeny.messages);
  ok("the refused message is in the transcript", vis1.length === 1 && vis1[0].content === QUESTION, JSON.stringify(vis1.map((m) => m.content)));
  ok("…marked undelivered", vis1[0]?.undelivered === true);
  ok("…carrying its own explanation", typeof vis1[0]?.denial?.message === "string" && vis1[0]!.denial!.message.length > 0, vis1[0]?.denial?.message);
  ok("…scope-aware (personal ceiling)", vis1[0]?.denial?.scopeDenied === "user");
  ok("…with the reset instant, still ahead", vis1[0]?.denial?.resetAt === FUTURE.toISOString());
  ok("the conversation is no longer titled 'New conversation'", afterDeny.session.title === QUESTION.slice(0, 40), afterDeny.session.title);
  ok("a denial does NOT promote (an undelivered message earns no permanence)", afterDeny.session.origin !== "discuss" || !afterDeny.session.promoted);

  // ── 3. THE MODEL NEVER SEES IT ───────────────────────────────────────────────────────────────────
  const hist = await loadHistoryForModel(s1.id);
  ok("model history excludes the undelivered turn", !hist.some((h) => h.content.includes(QUESTION)), `${hist.length} turn(s)`);
  ok("model history is just the grounded opening", hist.length === 1 && hist[0].content === ORIENTATION);
  ok(
    "model history contains no denial prose (the notice is never an assistant message)",
    !hist.some((h) => /daily limit/i.test(h.content)),
  );
  ok("countVisibleUserMessages ignores it (the first DELIVERED message still gets the title job)", (await countVisibleUserMessages(s1.id)) === 0);

  // ── 4. RETRYING A DENIAL DOESN'T STACK DUPLICATES ────────────────────────────────────────────────
  const again = await appendUndeliveredUserMessage({
    session: afterDeny.session,
    userText: QUESTION,
    reason: "daily_call_budget_exhausted",
    scopeDenied: "global",
    resetAt: FUTURE,
  });
  const vis2 = serializeVisibleMessages(again.messages);
  ok("a re-denied retry UPDATES the row, never appends a second", vis2.length === 1, `${vis2.length} row(s)`);
  ok("…and refreshes which ceiling refused", vis2[0]?.denial?.scopeDenied === "global");

  // ── 5. A DENIAL READ THE NEXT DAY IS NOT STALE ───────────────────────────────────────────────────
  await prisma.chatMessage.updateMany({ where: { sessionId: s1.id, undelivered: true }, data: { deniedResetAt: PAST } });
  const stale = serializeVisibleMessages((await getSessionWithMessages(userId, s1.id))!.messages);
  ok("a passed reset is nulled, so no stale time can render", stale[0]?.denial?.resetAt === null, String(stale[0]?.denial?.resetAt));
  ok("…and the line reads in the past tense", /when you sent this/i.test(stale[0]?.denial?.message ?? ""), stale[0]?.denial?.message);
  ok("…still marked undelivered (it really never went)", stale[0]?.undelivered === true);

  // ── 6. A SUCCESSFUL RETRY SUPERSEDES THE ATTEMPT IT REPEATS ──────────────────────────────────────
  const done = await appendFollowup({
    session: (await getSessionWithMessages(userId, s1.id))!.session,
    userText: QUESTION,
    assistantText: "Vytal reads health across four pillars…",
    assistantUsage: null,
    guardrailBlocked: false,
    regenerated: false,
  });
  const vis3 = serializeVisibleMessages(done.messages);
  ok("retry-that-worked leaves ONE question + its reply, no ghost copy", vis3.length === 2 && vis3[0].content === QUESTION && vis3[1].role === "assistant", JSON.stringify(vis3.map((m) => `${m.role}:${m.undelivered ? "denied" : "ok"}`)));
  ok("…and nothing is left marked undelivered", vis3.every((m) => !m.undelivered));

  // ── 7. A DENIAL THAT IS *NOT* THE ONE BEING RETRIED SURVIVES ─────────────────────────────────────
  const s2 = await newSession(userId);
  const d2 = await appendUndeliveredUserMessage({ session: s2, userText: QUESTION, reason: null, scopeDenied: "user", resetAt: FUTURE });
  const after2 = await appendFollowup({
    session: d2.session,
    userText: OTHER, // a DIFFERENT message got through
    assistantText: "HDFC Bank is…",
    assistantUsage: null,
    guardrailBlocked: false,
    regenerated: false,
  });
  const vis4 = serializeVisibleMessages(after2.messages);
  ok(
    "a different successful send leaves the earlier denial standing, still retryable",
    vis4.length === 3 && vis4[0].content === QUESTION && vis4[0].undelivered === true && vis4[2].role === "assistant",
    JSON.stringify(vis4.map((m) => `${m.role}:${m.undelivered ? "denied" : "ok"}`)),
  );

  // ── 8. THE SWEEP: EMPTIES ONLY ───────────────────────────────────────────────────────────────────
  const empty = await newSession(userId); // nothing but the hidden opening row
  const heldDenial = await newSession(userId); // holds ONE undelivered message
  await appendUndeliveredUserMessage({ session: heldDenial, userText: QUESTION, reason: null, scopeDenied: "user", resetAt: FUTURE });
  const heldReply = await newSession(userId); // a real exchange
  await appendFollowup({ session: heldReply, userText: OTHER, assistantText: "…", assistantUsage: null, guardrailBlocked: false, regenerated: false });
  const young = await newSession(userId); // empty, but inside the grace window
  for (const id of [empty.id, heldDenial.id, heldReply.id]) await backdate(id, 26);

  const swept = await sweepEmptyChatPageSessions(userId);
  const alive = async (id: string) => (await prisma.chatSession.count({ where: { id } })) === 1;
  ok("the empty conversation is swept", !(await alive(empty.id)), `${swept} session(s) swept`);
  ok("a conversation holding a DENIED message is NOT swept", await alive(heldDenial.id));
  ok("a conversation with a real exchange is NOT swept", await alive(heldReply.id));
  ok("an empty conversation inside the grace window is NOT swept (a second tab may be mid-send)", await alive(young.id));
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(async () => {
    await cleanup();
    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
