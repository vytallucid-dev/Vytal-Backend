// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PROOF — editing a message: the cut lands on a turn boundary, the grounding is unreachable, the
// confirmed-write warning fires on the tail and ONLY on the tail, and the consent slot is disarmed.
//
// Every failure this guards is silent and expensive:
//   · a cut that splits a tool pair leaves a functionResponse with no functionCall — Gemini answers 400
//     INVALID_ARGUMENT and the NEXT generation dies, not this one, so it surfaces as "chat is broken"
//     with nothing pointing back here;
//   · a cut that reaches message[0] un-grounds the conversation permanently, and every later answer is
//     confidently wrong about a world nobody described;
//   · a write-effect warning that misses makes the reader destroy the only record of a filed trade;
//   · a write-effect warning that OVER-fires (naming a write that survives the cut) trains them to click
//     through it, which is the same failure one step later;
//   · a pending proposal surviving the edit lets a later "yes" execute values the reader was shown in a
//     turn that no longer exists.
//
// Fixtures are written, read back through the REAL functions, and deleted. No model call, no quota spend,
// no network beyond the DB.
//
//   npx tsx src/scripts/verify-chat-message-edit.ts     (run from the backend root — needs .env)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  createChatPageSession,
  appendFollowup,
  appendUndeliveredUserMessage,
  appendReplyAfterEdit,
  applyMessageEdit,
  planMessageEdit,
  markMessageUndelivered,
  loadHistoryForModel,
  serializeVisibleMessages,
  getSessionWithMessages,
  type EditPlan,
} from "../chat/sessions.js";
import { storeProposal, peekProposal } from "../chat/proposals.js";
import type { PersistedToolTurn } from "../chat/engine.js";

let failures = 0;
const ok = (label: string, pass: boolean, detail?: string) => {
  console.log(`${pass ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
};

const ORIENTATION = "[ORIENTATION] The reader opened a blank chat. Nobody asked anything yet.";

const created: string[] = [];
// ⚠ Cleanup deletes BY THE IDS THIS SCRIPT CREATED — never by userId, which would take that user's real
//   conversations with it. Same rule as verify-chat-denied-persistence.
const cleanup = async () => {
  if (created.length) await prisma.chatSession.deleteMany({ where: { id: { in: created } } });
};

const newSession = async (userId: string) => {
  const { session } = await createChatPageSession(userId, ORIENTATION, "New conversation");
  created.push(session.id);
  return session;
};

/** A tool-using turn: the model called ONE tool and (optionally) the result recorded a confirmed write. */
const toolTurns = (effects?: string[]): PersistedToolTurn[] => [
  {
    role: "assistant",
    kind: "tool_call",
    content: "",
    toolPayload: [{ name: "confirmPendingAction", args: {} }],
    usage: null,
  },
  {
    role: "user",
    kind: "tool_result",
    content: "",
    toolPayload: {
      name: "confirmPendingAction",
      response: { output: "=== DONE — THIS HAS NOW BEEN WRITTEN ===" },
      ...(effects ? { effects } : {}),
    },
    usage: null,
  },
];

/** Row shorthand for readable assertions: "user:text" / "assistant:tool_call" … */
const shapeOf = async (sessionId: string): Promise<string[]> => {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { role: true, kind: true },
  });
  return rows.map((r) => `${r.role}:${r.kind}`);
};

const isPlan = (p: EditPlan | string): p is EditPlan => typeof p !== "string";

async function main() {
  const owner = await prisma.userLedger.findFirst({ select: { userId: true } });
  if (!owner) throw new Error("no user in user_ledger to hang the fixtures off");
  const userId = owner.userId;

  // ── 1. A FOUR-TURN CONVERSATION, THE MIDDLE TURN USING A TOOL THAT WROTE ─────────────────────────
  const s = await newSession(userId);
  await appendFollowup({ session: s, userText: "Q1", assistantText: "A1", assistantUsage: null, guardrailBlocked: false, regenerated: false });
  const afterQ2 = await appendFollowup({
    session: s, userText: "Q2", toolTurns: toolTurns(["portfolio"]),
    assistantText: "A2", assistantUsage: null, guardrailBlocked: false, regenerated: false,
  });
  await appendFollowup({ session: afterQ2.session, userText: "Q3", assistantText: "A3", assistantUsage: null, guardrailBlocked: false, regenerated: false });

  const full = (await getSessionWithMessages(userId, s.id))!;
  // ⚠ A chat_page opening is ONE row — the hidden orientation, role:user, with no assistant reply beside
  //   it (createChatPageSession). Only a DISCUSS session opens with a generated exchange.
  ok(
    "the fixture is one hidden opening + three turns, tool pair inside turn 2",
    (await shapeOf(s.id)).join(" ") ===
      "user:text user:text assistant:text user:text assistant:tool_call user:tool_result assistant:text user:text assistant:text",
    (await shapeOf(s.id)).join(" "),
  );

  // ── 2. EFFECT ATTRIBUTION — the write lands on the assistant row that ENDED that turn ────────────
  const visible = serializeVisibleMessages(full.messages);
  ok("the hidden orientation scaffolding is still hidden", visible.length === 6, `${visible.length} visible row(s)`);
  const changedAt = visible.map((m) => m.changed.join(",") || "-");
  ok(
    "`changed` is attributed to turn 2's REPLY and to nothing else",
    changedAt.join(" ") === "- - - portfolio - -",
    changedAt.join(" "),
  );

  // ── 3. WHAT CANNOT BE EDITED ─────────────────────────────────────────────────────────────────────
  const rows = full.messages;
  const opening = rows.find((r) => r.isOpening && r.role === "user")!;
  const toolResult = rows.find((r) => r.kind === "tool_result")!;
  const assistantRow = rows.find((r) => r.role === "assistant" && r.content === "A1")!;
  const q2 = rows.find((r) => r.content === "Q2")!;
  const q3 = rows.find((r) => r.content === "Q3")!;

  ok("message[0] (the grounding) is refused", (await planMessageEdit(userId, s.id, opening.id)) === "opening_not_editable");
  ok(
    "a tool_result is refused — it rides on role:user and would split its own pair",
    (await planMessageEdit(userId, s.id, toolResult.id)) === "not_a_text_message",
  );
  ok("an assistant row is refused", (await planMessageEdit(userId, s.id, assistantRow.id)) === "not_a_text_message");
  ok("an unknown message id is not_found", (await planMessageEdit(userId, s.id, opening.id.replace(/.$/, "0")) as string) === "not_found");
  const foreign = await prisma.userLedger.findFirst({ where: { userId: { not: userId } }, select: { userId: true } });
  if (foreign) {
    ok("another reader cannot plan an edit on this session (owner-scoped)", (await planMessageEdit(foreign.userId, s.id, q2.id)) === "not_found");
  } else {
    console.log("… skipped the foreign-owner check (only one user in user_ledger)");
  }

  // ── 4. THE BOUNDARY ──────────────────────────────────────────────────────────────────────────────
  const planQ2 = await planMessageEdit(userId, s.id, q2.id);
  if (!isPlan(planQ2)) throw new Error(`expected a plan for Q2, got ${planQ2}`);
  ok("editing Q2 discards 5 rows — its own tool pair, its reply, and all of turn 3", planQ2.suffixIds.length === 5, `${planQ2.suffixIds.length}`);
  ok("…which is 3 rows the READER can see (the count the warning quotes)", planQ2.visibleSuffixCount === 3, `${planQ2.visibleSuffixCount}`);
  ok("…and names the confirmed write inside them", planQ2.writeEffects.join(",") === "portfolio", planQ2.writeEffects.join(",") || "(none)");

  // ★ THE OVER-FIRE CHECK. Editing Q3 cuts BELOW the write, so the write survives and there is nothing
  //   to warn about. A warning here would be a false alarm on every later edit in the conversation.
  const planQ3 = await planMessageEdit(userId, s.id, q3.id);
  if (!isPlan(planQ3)) throw new Error(`expected a plan for Q3, got ${planQ3}`);
  ok("editing Q3 warns about NOTHING — the write is above the cut and survives it", planQ3.writeEffects.length === 0, planQ3.writeEffects.join(","));
  ok("…and discards only its own reply", planQ3.suffixIds.length === 1 && planQ3.visibleSuffixCount === 1);

  // ── 5. THE CUT ITSELF — a proposal is armed first, so the disarm is observable ────────────────────
  await storeProposal(s.id, userId, {
    kind: "recordTransaction",
    summary: "Record a BUY",
    fields: [{ label: "Quantity", value: "40" }],
    args: { quantity: 40 },
  });
  ok("a proposal is armed before the edit", (await peekProposal(s.id, userId)) != null);

  const q2StampBefore = q2.createdAt.getTime();
  await applyMessageEdit(userId, s.id, planQ2, "Q2 rewritten");

  const cut = (await getSessionWithMessages(userId, s.id))!;
  ok(
    "the cut lands on a turn boundary — nothing after Q2 survives, and no orphan tool row does",
    (await shapeOf(s.id)).join(" ") === "user:text user:text assistant:text user:text",
    (await shapeOf(s.id)).join(" "),
  );
  const toolRows = cut.messages.filter((m) => m.kind !== "text").length;
  ok("★ TOOL PAIRS WENT WHOLE — zero tool rows remain, so no functionResponse is orphaned", toolRows === 0, `${toolRows} tool row(s)`);
  const q2After = cut.messages.find((m) => m.id === q2.id)!;
  ok("the edited row keeps its identity (same id — the bubble does not become a new message)", q2After.id === q2.id);
  ok("…and its text is the rewrite", q2After.content === "Q2 rewritten", q2After.content);
  ok("…and its createdAt is untouched (the relative-time label still reports the original send)", q2After.createdAt.getTime() === q2StampBefore);
  ok("★ THE CONSENT SLOT IS DISARMED — a later 'yes' has nothing to execute", (await peekProposal(s.id, userId)) === null);
  ok("the grounding survived the cut", cut.messages.some((m) => m.isOpening && m.role === "user" && m.content === ORIENTATION));

  // ── 6. THE REGENERATION READS THE RIGHT HISTORY ──────────────────────────────────────────────────
  const hist = await loadHistoryForModel(s.id, { excludeMessageId: q2.id });
  ok(
    "history excludes the edited row — the caller re-appends it with the per-turn language directive",
    hist.length === 3 && !hist.some((h) => h.content.includes("Q2 rewritten")),
    hist.map((h) => `${h.role}:${h.content.slice(0, 12)}`).join(" | "),
  );
  ok("…and still leads with the grounding (rows[0] is never dropped)", hist[0].content === ORIENTATION);

  const replied = await appendReplyAfterEdit({
    session: cut.session, toolTurns: toolTurns(), assistantText: "A2 fresh",
    assistantUsage: null, guardrailBlocked: false, regenerated: false,
  });
  ok(
    "the fresh reply is appended AFTER the edited row, tool turns and all",
    (await shapeOf(s.id)).join(" ") === "user:text user:text assistant:text user:text assistant:tool_call user:tool_result assistant:text",
    (await shapeOf(s.id)).join(" "),
  );
  const vis = serializeVisibleMessages(replied.messages);
  ok("…and the transcript ends with it", vis.at(-1)?.content === "A2 fresh", vis.at(-1)?.content);
  ok("…carrying no `changed` (this tool result recorded no write)", (vis.at(-1)?.changed.length ?? -1) === 0);

  // ── 7. A DENIED REGENERATION LEAVES THE EDIT STANDING, MARKED ────────────────────────────────────
  const s2 = await newSession(userId);
  const t2 = await appendFollowup({ session: s2, userText: "Ask one", assistantText: "Answer one", assistantUsage: null, guardrailBlocked: false, regenerated: false });
  const target2 = (await getSessionWithMessages(userId, s2.id))!.messages.find((m) => m.content === "Ask one")!;
  const plan2 = await planMessageEdit(userId, s2.id, target2.id);
  if (!isPlan(plan2)) throw new Error("expected a plan");
  await applyMessageEdit(userId, s2.id, plan2, "Ask one, rewritten");
  const denied = (await markMessageUndelivered(userId, s2.id, target2.id, {
    reason: "user_daily_limit_reached",
    scopeDenied: "user",
    resetAt: new Date(Date.now() + 6 * 3600_000),
  }))!;
  const deniedRow = serializeVisibleMessages(denied.messages).find((m) => m.id === target2.id)!;
  ok("a denied regeneration keeps the rewritten text", deniedRow.content === "Ask one, rewritten", deniedRow.content);
  ok("…marked undelivered, with its own explanation", deniedRow.undelivered && deniedRow.denial != null, deniedRow.denial?.message);
  const histDenied = await loadHistoryForModel(s2.id);
  ok("…and excluded from the model's history until it lands", !histDenied.some((h) => h.content.includes("rewritten")));
  void t2;

  // ── 8. EDITING A NEVER-SENT MESSAGE RE-ENTERS IT INTO HISTORY ────────────────────────────────────
  // ★ THE SUBTLE ONE. `undelivered` rows are excluded from the model's history, so an edit that left the
  //   flag on would rewrite the message, send it, and generate an answer to a question the model was never
  //   shown. applyMessageEdit clears the denial columns for exactly this reason.
  const plan3 = await planMessageEdit(userId, s2.id, target2.id);
  if (!isPlan(plan3)) throw new Error("expected a plan");
  await applyMessageEdit(userId, s2.id, plan3, "Ask one, third time");
  const revived = (await getSessionWithMessages(userId, s2.id))!.messages.find((m) => m.id === target2.id)!;
  ok("editing a never-sent message clears its denial marks", revived.undelivered === false && revived.deniedScope === null);
  const histRevived = await loadHistoryForModel(s2.id, { excludeMessageId: target2.id });
  ok("…so the regeneration's history is the grounding alone, with the edit re-appended by the caller", histRevived.length === 1);
  const histIncluding = await loadHistoryForModel(s2.id);
  ok("…and the row IS in history once it is no longer excluded", histIncluding.some((h) => h.content === "Ask one, third time"));

  // ── 9. THE USER ROW IS STAMPED WHEN THE READER SENT, NOT WHEN THE REPLY LANDED ───────────────────
  // ★ appendFollowup runs AFTER the generation, so its own Date.now() is send-time + however long the turn
  //   took. That was invisible while the stamp was only an ordering key; the transcript now renders it as
  //   "4m ago" beside the message, so the offset became a visible lie that grows with how hard the question
  //   was. `sentAt` carries the real instant — clamped, because the ordering invariant outranks the label.
  {
    const s4 = await newSession(userId);
    // Age the session's existing rows, so the send instant below genuinely falls BETWEEN them and now —
    // which is the only shape the clamp accepts, and the only shape production ever produces. (A fresh
    // fixture's orientation row is stamped "just now", so a backdated sentAt would sit before it and be
    // refused — correctly, and that refusal is asserted separately below.)
    await prisma.chatMessage.updateMany({ where: { sessionId: s4.id }, data: { createdAt: new Date(Date.now() - 600_000) } });
    const sentAt = new Date(Date.now() - 90_000); // "sent 90s ago; the model thought for 90 seconds"
    const r4 = await appendFollowup({
      session: s4, sentAt, userText: "slow question", assistantText: "slow answer",
      assistantUsage: null, guardrailBlocked: false, regenerated: false,
    });
    const rows4 = r4.messages.filter((m) => !m.isOpening);
    const userRow = rows4.find((m) => m.role === "user")!;
    const replyRow = rows4.find((m) => m.role === "assistant")!;
    ok("the user row carries the SEND instant, not the persist instant", userRow.createdAt.getTime() === sentAt.getTime(), userRow.createdAt.toISOString());
    ok("…and the reply is still stamped after it (order is never traded for the label)", replyRow.createdAt > userRow.createdAt);

    // The clamp: a second tab whose send predates the newest existing row must NOT reorder the transcript.
    const stale = new Date(userRow.createdAt.getTime() - 60_000);
    const r5 = await appendFollowup({
      session: r4.session, sentAt: stale, userText: "second tab", assistantText: "second answer",
      assistantUsage: null, guardrailBlocked: false, regenerated: false,
    });
    const ordered = r5.messages.map((m) => m.createdAt.getTime());
    ok(
      "★ a stale sentAt is REFUSED — the transcript stays monotonic across concurrent tabs",
      ordered.every((t, i) => i === 0 || t >= ordered[i - 1]!),
      ordered.join(" < "),
    );
    const secondQ = r5.messages.find((m) => m.content === "second tab")!;
    ok("…so that row falls back to the transaction's own stamp", secondQ.createdAt.getTime() > stale.getTime());
  }

  // ── 10. A DENIED TAIL IS STILL RETRYABLE THE OLD WAY (the edit path must not have moved isRetryOf) ──
  const s3 = await newSession(userId);
  const d3 = await appendUndeliveredUserMessage({
    session: s3, userText: "refused text", reason: "user_daily_limit_reached", scopeDenied: "user", resetAt: new Date(Date.now() + 3600_000),
  });
  const ok3 = await appendFollowup({ session: d3.session, userText: "refused text", assistantText: "landed", assistantUsage: null, guardrailBlocked: false, regenerated: false });
  const shape3 = serializeVisibleMessages(ok3.messages).map((m) => `${m.role}:${m.undelivered ? "denied" : "ok"}`);
  ok("a successful retry still supersedes its denied row — no ghost copy", shape3.join(" ") === "user:ok assistant:ok", shape3.join(" "));
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
