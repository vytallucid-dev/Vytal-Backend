// ─────────────────────────────────────────────────────────────────────────────
// CHAT TOOL-LOOP VERIFY HARNESS (Stage 0, Phase B — the tool loop end to end).
//
// Proves:
//   1. A REAL conversation over HTTP where the model calls getStockFacts for a stock the session was NOT
//      opened on: the tool call → the LEAN result → the final answer. Verbatim.
//   2. Tool turns are HIDDEN from the client transcript but PRESENT in the model's replayed history.
//   3. Universe boundary: an uncovered symbol returns the honest "NOT COVERED" result (not an error).
//   4. Tool failure is FAIL-SOFT: an unknown tool AND a bad-arg handler both come back as errors the model
//      can see — the turn survives.
//   5. MAX_ROUNDS cap: an always-calling model is forced to a final no-tools answer, and the truncation is logged.
//   6. The guardrail runs on the FINAL text ONLY: advice in a tool-call preamble does NOT block; advice in
//      the final answer DOES (→ the fixed redirect).
//   7. Token counts: the lean output size, the full-block size, and the tool-definitions fixed cost.
//
// Uses a SCRIPTED provider (no key, deterministic) — the composed opening, grounding, registry dispatch,
// persistence, quota gate and guardrail are all the REAL code. Throwaway user, cleaned up on exit.
//   npx tsx src/scripts/verify-chat-tools.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { __setDefaultChatProviderForTests, runChatTurn } from "../chat/engine.js";
import { loadHistoryForModel } from "../chat/sessions.js";
import { toolSpecs, makeToolExecutor, makeToolContext } from "../chat/tools/registry.js";
import { getStockFactsTool } from "../chat/tools/get-stock-facts.js";
import { buildScoredStocksList } from "../scoring/read/stocks-list.service.js";
import { LAYER3_REDIRECT_LEAD } from "../chat/voice.js";
import type { AiProvider, AiGenerateRequest, AiGenerateResult, AiToolCall, TokenUsage } from "../ai/types.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n══ ${t} ══`);
const approxTokens = (s: string) => Math.ceil(s.length / 4);

interface Step {
  text?: string;
  toolCalls?: AiToolCall[];
}
function synthUsage(req: AiGenerateRequest, text: string): TokenUsage {
  const promptChars = req.messages.reduce((n, m) => n + m.content.length, 0) + (req.system?.length ?? 0);
  return { promptTokens: Math.ceil(promptChars / 4), outputTokens: Math.ceil(text.length / 4), cachedTokens: 0, cacheHit: false, modelVersion: "scripted-tools-1" };
}

/** A provider driven by a mutable FIFO queue (for the HTTP flow — push steps before each call). */
function queuedProvider(): AiProvider & { push: (...s: Step[]) => void } {
  const q: Step[] = [];
  return {
    push: (...s: Step[]) => q.push(...s),
    async generate(req: AiGenerateRequest): Promise<AiGenerateResult> {
      const step = q.shift() ?? { text: "[script exhausted]" };
      const text = step.text ?? "";
      return { text, usage: synthUsage(req, text), ...(step.toolCalls && step.toolCalls.length ? { toolCalls: step.toolCalls } : {}) };
    },
    async generateStructured() {
      throw new Error("scripted provider: generateStructured not used");
    },
    async ping() {
      return true;
    },
  };
}
/** A fixed-script provider (for the direct engine proofs). */
function scriptProvider(steps: Step[]): AiProvider {
  let i = 0;
  return {
    async generate(req: AiGenerateRequest): Promise<AiGenerateResult> {
      const step = steps[i++] ?? { text: "[script exhausted]" };
      const text = step.text ?? "";
      return { text, usage: synthUsage(req, text), ...(step.toolCalls && step.toolCalls.length ? { toolCalls: step.toolCalls } : {}) };
    },
    async generateStructured() {
      throw new Error("not used");
    },
    async ping() {
      return true;
    },
  };
}
const call = (name: string, args: Record<string, unknown>, id = randomUUID().slice(0, 8)): AiToolCall => ({ id, name, args });

// ── throwaway user + HTTP (mirrors verify-chat.ts) ──
const authIds: string[] = [];
async function newUser(tag: string): Promise<string> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `tools-${tag}-${authId}@test.local`);
  authIds.push(authId);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error(`signup trigger did not seed public.users for ${tag}`);
  return u.id;
}
function bootApp(userIdRef: { id: string }) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(
    "/api/v1/me",
    (req, _res, next) => {
      (req as express.Request).authUser = { userId: userIdRef.id, authUserId: "auth-" + userIdRef.id, email: "t@test.local", role: "user" };
      next();
    },
    meChatRouter,
  );
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}
async function api(base: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + "/api/v1/me" + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: JSON.parse(await res.text()) };
}

async function main() {
  // Pick two REAL scored stocks: one to open the session on (SUBJECT), one for the tool to fetch (TARGET).
  const scored = await buildScoredStocksList();
  if (scored.length < 2) throw new Error("need ≥2 scored stocks in the universe for this proof");
  const SUBJECT = scored[0];
  const TARGET = scored[1];
  console.log(`Subject (session opened on): ${SUBJECT.symbol} · Tool target (fetched mid-chat): ${TARGET.symbol}`);

  const userIdRef = { id: "" };
  userIdRef.id = await newUser("http");
  const { server, base } = bootApp(userIdRef);

  try {
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    section("1 · HTTP conversation — the model calls getStockFacts for a DIFFERENT stock");
    const prov = queuedProvider();
    __setDefaultChatProviderForTests(prov);

    // Opening (no tools — the controller only enables tools on follow-ups). One text generation.
    prov.push({ text: `Here's a read on ${SUBJECT.symbol}. Ask me anything.` });
    const opened = await api(base, "POST", "/chat/sessions", {
      surface: "stock_health",
      subject: { kind: "stock", symbol: SUBJECT.symbol, name: SUBJECT.name },
      label: "Discuss this read",
      detail: { band: SUBJECT.band },
    });
    const sessionId: string = opened.json?.data?.session?.id;
    ok("opening created a session", !!sessionId && opened.status === 201, `status=${opened.status}`);

    // Follow-up about the OTHER stock → the model calls getStockFacts(TARGET), then answers from the result.
    prov.push(
      { text: "", toolCalls: [call("getStockFacts", { symbol: TARGET.symbol })] },
      { text: `Compared with ${SUBJECT.symbol}, ${TARGET.symbol} reads differently — here's what its pillars show.` },
    );
    const followup = await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `How does ${TARGET.symbol} compare?` });
    ok("follow-up returned a reply", followup.status === 200 && !!followup.json?.data?.reply, `status=${followup.status}`);

    // ── Verbatim: the hidden tool turns + the visible transcript ──
    const rows = await prisma.chatMessage.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" }, select: { role: true, kind: true, content: true, toolPayload: true } });
    const callRow = rows.find((r) => r.kind === "tool_call");
    const resultRow = rows.find((r) => r.kind === "tool_result");
    const leanText = (resultRow?.toolPayload as any)?.response?.output ?? "";
    console.log("\n  ┌─ TOOL CALL (hidden turn):");
    console.log("  │  " + JSON.stringify((callRow?.toolPayload as any)?.[0] ?? null));
    console.log("  ├─ LEAN TOOL RESULT (hidden turn, fed back to the model):");
    console.log(leanText.split("\n").map((l: string) => "  │  " + l).join("\n"));
    console.log("  └─ FINAL ANSWER (shown to the user):");
    console.log("     " + (followup.json?.data?.reply?.content ?? ""));

    ok("a tool_call turn was persisted (kind=tool_call)", !!callRow);
    ok("a tool_result turn was persisted (kind=tool_result)", !!resultRow);
    ok("the tool result is the LEAN block for the TARGET", leanText.includes("VYTAL HEALTH (lean)") && leanText.includes(TARGET.symbol));

    // ── Hidden from the transcript, present in the model history ──
    const visible = await api(base, "GET", `/chat/sessions/${sessionId}`);
    const visKinds = visible.json?.data?.messages ?? [];
    const anyToolJsonVisible = visKinds.some((m: any) => typeof m.content === "string" && (m.content.includes("VYTAL HEALTH (lean)") || m.content.includes("functionCall")));
    ok("client transcript HIDES tool turns (no tool JSON in any visible message)", !anyToolJsonVisible, `visible count=${visKinds.length}`);
    ok("visible transcript = opening + user + final (3 messages)", visKinds.length === 3, `got ${visKinds.length}`);

    const history = await loadHistoryForModel(sessionId);
    const histHasCall = history.some((m) => m.role === "assistant" && !!m.toolCalls?.length);
    const histHasResult = history.some((m) => m.role === "user" && !!m.toolResult);
    ok("model history INCLUDES the tool_call (assistant + toolCalls)", histHasCall);
    ok("model history INCLUDES the tool_result (user + toolResult)", histHasResult);

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // Direct engine proofs — precise control over provider + rounds. Real registry executor throughout.
    const execCtx = makeToolContext({ userId: userIdRef.id, sessionId: "direct" });
    const executor = makeToolExecutor(execCtx);
    const baseInput = { model: "gemini-3.5-flash-lite", system: "You are a stock assistant.", actor: { kind: "user" as const, userId: userIdRef.id }, subjectLabel: SUBJECT.symbol, tools: toolSpecs(), executeTool: executor };

    section("2 · Universe boundary — an uncovered symbol returns an honest 'NOT COVERED' result");
    {
      const provB = scriptProvider([{ text: "", toolCalls: [call("getStockFacts", { symbol: "ZZZFAKE123" })] }, { text: "That symbol isn't in Vytal's coverage." }]);
      const turn = await runChatTurn({ ...baseInput, messages: [{ role: "user", content: "How is ZZZFAKE123?" }] }, { provider: provB });
      const res = turn.toolTurns.find((t) => t.kind === "tool_result");
      const out = (res?.toolPayload as any)?.response?.output ?? "";
      ok("turn completed (status ok)", turn.status === "ok");
      ok("the tool result is the NOT COVERED boundary message", out.includes("NOT COVERED") && out.includes("ZZZFAKE123"));
      console.log("  boundary result → " + out.slice(0, 120) + "…");
    }

    section("3 · Tool failure is fail-soft — the turn survives");
    {
      // (a) unknown tool, (b) getStockFacts with no symbol (handler returns ok:false).
      const provC = scriptProvider([
        { text: "", toolCalls: [call("doesNotExist", {}), call("getStockFacts", {})] },
        { text: "I couldn't complete those lookups, but here's what I can say." },
      ]);
      const turn = await runChatTurn({ ...baseInput, messages: [{ role: "user", content: "do two broken things" }] }, { provider: provC });
      const errs = turn.toolTurns.filter((t) => t.kind === "tool_result").map((t) => (t.toolPayload as any)?.response?.error);
      ok("turn still produced a final answer (status ok, not thrown)", turn.status === "ok" && !!turn.text);
      ok("unknown-tool call returned an error result (not a throw)", errs.some((e) => typeof e === "string" && e.includes("Unknown tool")));
      ok("bad-arg getStockFacts returned an error result", errs.some((e) => typeof e === "string" && e.toLowerCase().includes("symbol")));
      console.log("  fail-soft errors → " + JSON.stringify(errs));
    }

    section("4 · MAX_ROUNDS cap — an always-calling model is forced to a final answer");
    {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
      const alwaysCall: Step[] = [
        { text: "", toolCalls: [call("getStockFacts", { symbol: TARGET.symbol })] },
        { text: "", toolCalls: [call("getStockFacts", { symbol: TARGET.symbol })] },
        { text: "", toolCalls: [call("getStockFacts", { symbol: TARGET.symbol })] },
        { text: "Forced final answer after the cap." },
      ];
      const turn = await runChatTurn({ ...baseInput, messages: [{ role: "user", content: "keep looking" }], maxRounds: 2 }, { provider: scriptProvider(alwaysCall) });
      console.warn = origWarn;
      const callTurns = turn.toolTurns.filter((t) => t.kind === "tool_call").length;
      ok("loop stopped at the cap and forced a final answer", turn.status === "ok" && turn.text === "Forced final answer after the cap.");
      ok("exactly maxRounds (2) tool rounds executed — no runaway", callTurns === 2, `executed ${callTurns} rounds`);
      ok("the truncation was LOGGED (not silent)", warnings.some((w) => w.includes("tool round cap")), warnings.find((w) => w.includes("cap")) ?? "");
    }

    section("5 · Guardrail runs on the FINAL text ONLY");
    {
      // 5a — advice in the tool-call PREAMBLE must NOT block (intermediate turns are not scanned).
      const prov5a = scriptProvider([
        { text: "you should buy this now", toolCalls: [call("getStockFacts", { symbol: TARGET.symbol })] },
        { text: "Foundation measures balance-sheet strength and profitability; this is a description, not guidance." },
      ]);
      const t5a = await runChatTurn({ ...baseInput, messages: [{ role: "user", content: "explain" }] }, { provider: prov5a });
      ok("5a · advice in a tool-call preamble does NOT block (served the clean final answer)", !t5a.guardrailBlocked && !!t5a.text?.startsWith("Foundation measures"));

      // 5b — advice in the FINAL answer DOES block → the fixed redirect (guardrail active on final).
      const prov5b = scriptProvider([
        { text: "", toolCalls: [call("getStockFacts", { symbol: TARGET.symbol })] },
        { text: "you should sell this now" }, // final: advice → hard hit
        { text: "you should sell this now" }, // retry: still advice → redirect
      ]);
      const t5b = await runChatTurn({ ...baseInput, messages: [{ role: "user", content: "what do I do?" }] }, { provider: prov5b });
      ok("5b · advice in the FINAL answer IS caught → the fixed redirect", t5b.guardrailBlocked && !!t5b.text?.startsWith(LAYER3_REDIRECT_LEAD));
    }

    section("6 · Token counts");
    {
      const lean = await getStockFactsTool.handler({ symbol: TARGET.symbol }, execCtx);
      const full = await getStockFactsTool.handler({ symbol: TARGET.symbol, full: true }, execCtx);
      const leanStr = lean.ok ? lean.content : "";
      const fullStr = full.ok ? full.content : "";
      const specsStr = JSON.stringify(toolSpecs());
      ok("lean output is small", approxTokens(leanStr) < 600, `lean ≈ ${approxTokens(leanStr)} tok (${leanStr.length} chars)`);
      ok("full drill-down is the big block", approxTokens(fullStr) > approxTokens(leanStr) * 3, `full ≈ ${approxTokens(fullStr)} tok`);
      console.log(`  lean getStockFacts   ≈ ${approxTokens(leanStr)} tokens`);
      console.log(`  full getStockFacts   ≈ ${approxTokens(fullStr)} tokens`);
      console.log(`  tool defs (${toolSpecs().length} tool, every message) ≈ ${approxTokens(specsStr)} tokens`);
    }
  } finally {
    server.close();
    __setDefaultChatProviderForTests(null);
    if (authIds.length) {
      await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds);
    }
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "✅ ALL PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
