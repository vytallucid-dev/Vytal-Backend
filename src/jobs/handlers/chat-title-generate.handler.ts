// ─────────────────────────────────────────────────────────────
// CHAT_TITLE_GENERATE HANDLER
//
// A tiny model call that writes a 4–6 word title for a CHAT-PAGE session, replacing the provisional
// (truncated-first-message) title. Enqueued on demand after the session's first exchange.
//
// ★ NEVER OVERWRITES A USER RENAME. titleSource='user' is checked up front AND enforced race-safely at the
//   write (updateMany WHERE titleSource <> 'user'), so a rename that lands WHILE the title is generating
//   still wins. A model title sets titleSource='model'.
//
// Metered like any real call: spendFor(model, {system job}) → GLOBAL budget only (no per-user cap for a
// system actor). Denied ⇒ skip, leave the provisional title. ⚠ On the free tier this costs a FULL unit.
// Served-by-mock ⇒ tokens are not recorded and the mock's echo is cleaned to a plausible title.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { ChatTitleGeneratePayload } from "../types.js";
import { prisma } from "../../db/prisma.js";
import { resolveChatProvider } from "../../chat/engine.js";
import { spendFor, servedByMock } from "../../ai/spend.js";
import { recordAiTokens, type Actor } from "../../ai/quota.js";
import { resolveChatModel } from "../../chat/config.js";

const TITLE_SYSTEM =
  "You write short, plain conversation titles. Output ONLY the title: 4 to 6 words, no quotation marks, " +
  "no trailing punctuation, no preamble. Describe the topic, not the answer.";

const buildTitlePrompt = (firstUser: string, firstAssistant: string): string =>
  `Write a 4–6 word title for this conversation.\n\nReader asked: ${firstUser.slice(0, 500)}\n\n` +
  `Assistant answered (for topic only): ${firstAssistant.slice(0, 400)}`;

/** Normalize a model title: strip quotes/wrapping, collapse whitespace, drop trailing punctuation, cap length. */
function cleanTitle(raw: string): string {
  let t = (raw ?? "").trim();
  // Drop a leading "[mock] " echo so a mock-served title is still plausible.
  t = t.replace(/^\[mock\]\s*/i, "");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim(); // surrounding quotes
  t = t.replace(/[.。!?;:,\s]+$/g, "").trim(); // trailing punctuation
  if (t.length > 60) t = t.slice(0, 59).trimEnd() + "…";
  return t;
}

export async function handleChatTitleGenerate(ctx: JobContext<ChatTitleGeneratePayload>) {
  const { sessionId } = ctx.payload;
  await ctx.reportProgress(5, `Titling chat session ${sessionId}`);

  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { id: true, titleSource: true, title: true },
  });
  if (!session) return { skipped: "session_gone" as const };
  // ★ Never overwrite a user rename (fast path; the write below re-checks race-safely).
  if (session.titleSource === "user") return { skipped: "user_titled" as const };

  const msgs = await prisma.chatMessage.findMany({
    where: { sessionId, isOpening: false },
    orderBy: { createdAt: "asc" },
    take: 2,
    select: { role: true, content: true },
  });
  const firstUser = msgs.find((m) => m.role === "user")?.content ?? session.title;
  const firstAssistant = msgs.find((m) => m.role === "assistant")?.content ?? "";

  const model = resolveChatModel();
  const actor: Actor = { kind: "system", job: "chat_title_generate" };
  const decision = await spendFor(model, actor)();
  if (!decision.allowed) {
    await ctx.reportProgress(100, `Skipped titling (quota: ${decision.reason})`);
    return { skipped: "quota" as const, reason: decision.reason };
  }

  const provider = resolveChatProvider();
  const r = await provider.generate({
    model,
    system: TITLE_SYSTEM,
    messages: [{ role: "user", content: buildTitlePrompt(firstUser, firstAssistant) }],
    maxTokens: 24,
    temperature: 0.3,
  });
  if (!servedByMock(r.usage)) await recordAiTokens(model, r.usage.promptTokens + r.usage.outputTokens);

  const title = cleanTitle(r.text);
  if (!title) {
    await ctx.reportProgress(100, "Model returned no usable title — kept the provisional");
    return { skipped: "empty_title" as const };
  }

  // ★ RACE-SAFE WRITE — only if the user hasn't renamed it in the meantime (titleSource still not 'user').
  const updated = await prisma.chatSession.updateMany({
    where: { id: sessionId, titleSource: { not: "user" } },
    data: { title, titleSource: "model" },
  });
  await ctx.reportProgress(100, updated.count ? `Titled: "${title}"` : "User renamed during titling — left as-is");
  return { updated: updated.count, title: updated.count ? title : session.title };
}
