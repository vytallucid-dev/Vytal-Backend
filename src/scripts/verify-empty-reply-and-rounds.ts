// ─────────────────────────────────────────────────────────────────────────────
// EMPTY-REPLY FALLBACK + TOOL-ROUND HEADROOM — deterministic proofs.
//
// Both fixes are engine behaviour driven by the provider's output, so a scripted provider can engineer
// exactly the failure that occurred live: a terminal generation with empty text, and a write chain one
// round longer than the old cap allowed. No model call needed for either.
//
// Proves:
//   1. An empty terminal generation NEVER reaches the reader — the fallback serves instead, and nothing
//      blank is persisted. Covered at every path that can deliver: plain, after tools, after the round
//      cap, and after a guardrail regeneration.
//   2. The round-cap case gets the DIFFERENT, more useful fallback ("narrow it down"), because "rephrase
//      it" is useless advice when the real problem was too many lookups.
//   3. A write turn that previously died at the cap now completes: the budget is raised the moment a
//      write-chain tool is called, and only then.
//   4. A read-only turn does NOT get the raise — the extra rounds cost quota, so they stay unbought.
//
//   npx tsx src/scripts/verify-empty-reply-and-rounds.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { __setDefaultChatProviderForTests, runChatTurn } from "../chat/engine.js";
import { EMPTY_REPLY_FALLBACK, TOOL_CAP_FALLBACK, isBlankReply } from "../chat/voice.js";
import { CHAT_MAX_TOOL_ROUNDS, CHAT_MAX_TOOL_ROUNDS_WRITE } from "../chat/config.js";
import { EXTENDED_ROUND_TOOLS, makeToolExecutor, toolSpecs } from "../chat/tools/registry.js";
import type { AiProvider, AiGenerateRequest, AiGenerateResult, AiToolCall, TokenUsage } from "../ai/types.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n══ ${t} ══`);

interface Step { text?: string; toolCalls?: AiToolCall[] }
function usage(req: AiGenerateRequest, text: string): TokenUsage {
  const c = req.messages.reduce((n, m) => n + m.content.length, 0) + (req.system?.length ?? 0);
  return { promptTokens: Math.ceil(c / 4), outputTokens: Math.ceil(text.length / 4), cachedTokens: 0, cacheHit: false, modelVersion: "scripted-empty-1" };
}
/** A provider that replays a fixed script and COUNTS its generations (how many rounds were actually run). */
function scripted(steps: Step[]): AiProvider & { calls: () => number } {
  let i = 0;
  let n = 0;
  return {
    calls: () => n,
    async generate(req: AiGenerateRequest): Promise<AiGenerateResult> {
      n++;
      const s = steps[i++] ?? { text: "[script exhausted]" };
      const text = s.text ?? "";
      return { text, usage: usage(req, text), ...(s.toolCalls?.length ? { toolCalls: s.toolCalls } : {}) };
    },
    async generateStructured() { throw new Error("unused"); },
    async ping() { return true; },
  };
}
const tc = (name: string, args: Record<string, unknown> = {}): AiToolCall => ({ id: randomUUID().slice(0, 8), name, args });

/** An always-allow spend gate. These are ENGINE proofs — the quota gate has its own suite
 *  (verify-ai-quota-subcap.ts) and is orthogonal here. Without it the fake model id falls to the
 *  conservative 5/day default and the multi-round cases die as "unavailable" instead of testing rounds. */
const allowAll = async () => ({ allowed: true, remaining: 999, limit: 999, resetAt: new Date(Date.now() + 86400000), scopeDenied: null, reason: "ok" });
const noopTool = async (call: AiToolCall) => ({ name: call.name, id: call.id, response: { output: "ok" } });

const authIds: string[] = [];
async function newUser(): Promise<string> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `empty-${authId}@test.local`);
  authIds.push(authId);
  return (await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } })).id;
}

async function main() {
  const userId = await newUser();
  const actor = { kind: "user", userId } as const;
  const base = { model: "test-model", system: "sys", actor, subjectLabel: "ACC" };

  // ═══════════════════════════════════════════════════════════════════════════
  section("1 · An empty terminal generation never reaches the reader");
  {
    // (a) plain turn, no tools — the model just returns "".
    let p = scripted([{ text: "" }]);
    let t = await runChatTurn({ ...base, messages: [{ role: "user", content: "hi" }] }, { provider: p, spend: allowAll });
    ok("empty plain generation → the fallback, not \"\"", t.text === EMPTY_REPLY_FALLBACK, JSON.stringify(t.text));
    ok("nothing blank is delivered", !isBlankReply(t.text));

    // (b) whitespace-only — renders identically blank, so it must be caught identically.
    p = scripted([{ text: "   \n  \t " }]);
    t = await runChatTurn({ ...base, messages: [{ role: "user", content: "hi" }] }, { provider: p, spend: allowAll });
    ok("★ whitespace-only is treated as empty", t.text === EMPTY_REPLY_FALLBACK, JSON.stringify(t.text));

    // (c) AFTER a tool round — the case observed live (a tool ran, then the model said nothing).
    p = scripted([{ toolCalls: [tc("getStockFacts", { symbol: "ACC" })] }, { text: "" }]);
    t = await runChatTurn(
      { ...base, messages: [{ role: "user", content: "tell me about ACC" }], tools: toolSpecs(), executeTool: noopTool },
      { provider: p, spend: allowAll },
    );
    ok("★ empty AFTER a tool round → the fallback", t.text === EMPTY_REPLY_FALLBACK, JSON.stringify(t.text));
    ok("the tool turns are still returned for persistence", t.toolTurns.length === 2, `${t.toolTurns.length} turns`);

    // (d) a real answer is untouched.
    p = scripted([{ text: "ACC sits at 63, in the steady band." }]);
    t = await runChatTurn({ ...base, messages: [{ role: "user", content: "hi" }] }, { provider: p, spend: allowAll });
    ok("a non-empty reply is passed through unchanged", t.text === "ACC sits at 63, in the steady band.");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("2 · The ROUND-CAP case gets its own, more useful fallback");
  {
    // Always-calling model → cap → forced final answer, which also comes back empty. Exactly the live shape.
    const steps: Step[] = Array.from({ length: 12 }, () => ({ toolCalls: [tc("getStockFacts", { symbol: "ACC" })] }));
    steps.push({ text: "" }); // the forced no-tools answer says nothing
    const p = scripted(steps);
    const t = await runChatTurn(
      { ...base, messages: [{ role: "user", content: "everything" }], tools: toolSpecs(), executeTool: noopTool, maxRounds: 2 },
      { provider: p, spend: allowAll },
    );
    ok("★★ capped-out AND empty → the CAP fallback, not the generic one", t.text === TOOL_CAP_FALLBACK, JSON.stringify(t.text?.slice(0, 60)));
    ok("…which tells the reader to narrow it down", /narrow it down/i.test(t.text ?? ""));
    ok("…and states nothing was changed", /nothing has been changed/i.test(t.text ?? ""));
    ok("the generic fallback says something different", EMPTY_REPLY_FALLBACK !== TOOL_CAP_FALLBACK);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("3 · An empty GUARDRAIL RETRY is caught too");
  {
    // First answer trips the gate → one regeneration → which returns "". Without the check that empty
    // retry would be scanned "clean" (there is no advice in nothing) and delivered blank.
    const p = scripted([{ text: "You should buy ACC now." }, { text: "" }]);
    const t = await runChatTurn({ ...base, messages: [{ role: "user", content: "hi" }] }, { provider: p, spend: allowAll });
    ok("★ empty regeneration → the fallback, never a blank", t.text === EMPTY_REPLY_FALLBACK, JSON.stringify(t.text));
    ok("…and it is still marked as a regeneration", t.regenerated === true);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("4 · ★ TOOL-ROUND HEADROOM on a write chain");
  {
    console.log(`  base cap = ${CHAT_MAX_TOOL_ROUNDS} · write cap = ${CHAT_MAX_TOOL_ROUNDS_WRITE} · extend on: ${EXTENDED_ROUND_TOOLS.join(", ")}`);
    const executeTool = makeToolExecutor({ userId, sessionId: "s", userMessage: "x" });

    // THE EXACT LIVE SHAPE that died: searchStocks → resolveDate → recordTransaction(refused) →
    // resolveDate → recordTransaction → final answer. Five rounds; the old cap of 4 cut it at four.
    const chain: Step[] = [
      { toolCalls: [tc("searchStocks", { query: "TCS" })] },
      { toolCalls: [tc("resolveDate", { phrase: "last Tuesday" })] },
      { toolCalls: [tc("recordTransaction", { symbol: "TCS", type: "buy", quantity: 1, price: 1, tradeDate: "2020-01-01" })] },
      { toolCalls: [tc("resolveDate", { phrase: "last Tuesday" })] },
      { toolCalls: [tc("recordTransaction", { symbol: "TCS", type: "buy", quantity: 1, price: 1, tradeDate: "2020-01-02" })] },
      { text: "Here's what I'd record… confirm?" },
    ];

    // WITHOUT the extension: the old behaviour. Capped, forced answer.
    const pOld = scripted([...chain, { text: "forced" }]);
    const tOld = await runChatTurn(
      { ...base, messages: [{ role: "user", content: "I bought TCS last Tuesday" }], tools: toolSpecs(), executeTool, maxRounds: CHAT_MAX_TOOL_ROUNDS },
      { provider: pOld, spend: allowAll },
    );
    ok("★ with the OLD cap the chain is truncated", tOld.toolTurns.filter((x) => x.kind === "tool_call").length === CHAT_MAX_TOOL_ROUNDS,
      `${tOld.toolTurns.filter((x) => x.kind === "tool_call").length} rounds ran (cap ${CHAT_MAX_TOOL_ROUNDS})`);

    // WITH the extension: the same chain completes and the model's own final answer is served.
    const pNew = scripted(chain);
    const tNew = await runChatTurn(
      {
        ...base, messages: [{ role: "user", content: "I bought TCS last Tuesday" }],
        tools: toolSpecs(), executeTool,
        extendedRounds: { tools: EXTENDED_ROUND_TOOLS, maxRounds: CHAT_MAX_TOOL_ROUNDS_WRITE },
      },
      { provider: pNew, spend: allowAll },
    );
    ok("★★ the write chain now COMPLETES — all 5 rounds ran", tNew.toolTurns.filter((x) => x.kind === "tool_call").length === 5,
      `${tNew.toolTurns.filter((x) => x.kind === "tool_call").length} rounds`);
    ok("★★ the model's OWN answer is served (not a cap fallback)", tNew.text === "Here's what I'd record… confirm?", JSON.stringify(tNew.text));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("5 · A read-only turn does NOT buy the extra rounds");
  {
    const executeTool = makeToolExecutor({ userId, sessionId: "s" });
    const readChain: Step[] = Array.from({ length: 10 }, () => ({ toolCalls: [tc("getStockFacts", { symbol: "ACC" })] }));
    readChain.push({ text: "answer" });
    const p = scripted(readChain);
    const t = await runChatTurn(
      {
        ...base, messages: [{ role: "user", content: "tell me everything" }],
        tools: toolSpecs(), executeTool,
        extendedRounds: { tools: EXTENDED_ROUND_TOOLS, maxRounds: CHAT_MAX_TOOL_ROUNDS_WRITE },
      },
      { provider: p, spend: allowAll },
    );
    const rounds = t.toolTurns.filter((x) => x.kind === "tool_call").length;
    ok("★★ a read-only loop stays on the TIGHT cap — the raise costs quota, so it stays unbought",
      rounds === CHAT_MAX_TOOL_ROUNDS, `${rounds} rounds (base ${CHAT_MAX_TOOL_ROUNDS}, write ${CHAT_MAX_TOOL_ROUNDS_WRITE})`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("6 · Over HTTP — nothing blank is ever PERSISTED");
  {
    const app = express();
    app.use(express.json());
    app.use("/api/v1/me", (req, _res, next) => {
      (req as express.Request).authUser = { userId, authUserId: "auth-" + userId, email: "t@test.local", role: "user" };
      next();
    }, meChatRouter);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const call = async (path: string, body?: unknown) =>
      (await fetch(`http://127.0.0.1:${port}/api/v1/me${path}`, {
        method: "POST", headers: { "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })).json() as any;

    try {
      __setDefaultChatProviderForTests(scripted([{ text: "" }, { text: "" }, { text: "" }]));
      const opened = await call("/chat/sessions", { origin: "chat_page" });
      const sid = opened?.data?.session?.id;
      const sent = await call(`/chat/sessions/${sid}/messages`, { message: "hello" });
      const reply = sent?.data?.reply?.content ?? "";
      ok("★★ the HTTP reply is the fallback, not an empty string", reply === EMPTY_REPLY_FALLBACK, JSON.stringify(reply.slice(0, 60)));
      const persisted = await prisma.chatMessage.findMany({ where: { sessionId: sid, role: "assistant", kind: "text" }, select: { content: true } });
      ok("★★ NO blank assistant message was persisted", persisted.length > 0 && persisted.every((m) => !isBlankReply(m.content)),
        `${persisted.length} assistant rows, blanks=${persisted.filter((m) => isBlankReply(m.content)).length}`);
    } finally {
      server.close();
      __setDefaultChatProviderForTests(null);
    }
  }

  console.log(`\n${failures === 0 ? "═══ ALL EMPTY-REPLY / ROUND CHECKS PASSED ✅ ═══" : `═══ ${failures} FAILURE(S) ❌ ═══`}`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds);
    await prisma.$disconnect();
  });
