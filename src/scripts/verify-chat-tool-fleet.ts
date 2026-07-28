// ─────────────────────────────────────────────────────────────────────────────
// CHAT TOOL FLEET VERIFY HARNESS (Stage 1 — the read/Vytal fleet).
//
// Proves:
//   1. The registry is coherent (unique names, every tool declared, definition cost measured).
//   2. A REAL conversation over HTTP exercising FOUR different tools in one turn — verbatim.
//   3. ★ buildOwnershipView is read ONCE for all three ownership tools (the per-turn memo), and
//      groundStockHealth once across getStockFacts + getStockRelationship.
//   4. The universe boundary holds across the fleet (spot-check on several tools).
//   5. Fail-soft holds across the fleet (bad args → ok:false, never a thrown turn).
//   6. Every tool's typical output size, measured.
//
// Scripted provider (no key, deterministic); the registry, the reads, persistence and the loop are real.
//   npx tsx src/scripts/verify-chat-tool-fleet.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { createThrowawayUser } from "./lib/throwaway-user.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { __setDefaultChatProviderForTests } from "../chat/engine.js";
import { CHAT_TOOLS, toolSpecs, makeToolContext, findTool } from "../chat/tools/registry.js";
import type { ToolContext, ToolMemo } from "../chat/tools/types.js";
import { buildScoredStocksList } from "../scoring/read/stocks-list.service.js";
import type { AiProvider, AiGenerateRequest, AiGenerateResult, AiToolCall, TokenUsage } from "../ai/types.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n══ ${t} ══`);
const tok = (s: string) => Math.ceil(s.length / 4);

interface Step { text?: string; toolCalls?: AiToolCall[] }
function synthUsage(req: AiGenerateRequest, text: string): TokenUsage {
  const chars = req.messages.reduce((n, m) => n + m.content.length, 0) + (req.system?.length ?? 0);
  return { promptTokens: Math.ceil(chars / 4), outputTokens: Math.ceil(text.length / 4), cachedTokens: 0, cacheHit: false, modelVersion: "scripted-fleet-1" };
}
function queuedProvider(): AiProvider & { push: (...s: Step[]) => void; lastPromptTokens: () => number } {
  const q: Step[] = [];
  let lastPrompt = 0;
  return {
    push: (...s: Step[]) => q.push(...s),
    lastPromptTokens: () => lastPrompt,
    async generate(req: AiGenerateRequest): Promise<AiGenerateResult> {
      const step = q.shift() ?? { text: "[script exhausted]" };
      const text = step.text ?? "";
      const usage = synthUsage(req, text);
      lastPrompt = usage.promptTokens;
      return { text, usage, ...(step.toolCalls?.length ? { toolCalls: step.toolCalls } : {}) };
    },
    async generateStructured() { throw new Error("not used"); },
    async ping() { return true; },
  };
}
const call = (name: string, args: Record<string, unknown>): AiToolCall => ({ id: randomUUID().slice(0, 8), name, args });

const authIds: string[] = [];
async function newUser(tag: string): Promise<string> {
  // Shared helper: sweeps leftovers from previous interrupted runs on first call (scripts/lib/throwaway-user.ts).
  const { authId } = await createThrowawayUser(`fleet-${tag}`);
  authIds.push(authId);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error("signup trigger did not seed public.users");
  return u.id;
}
function bootApp(ref: { id: string }) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1/me", (req, _res, next) => {
    (req as express.Request).authUser = { userId: ref.id, authUserId: "auth-" + ref.id, email: "t@test.local", role: "user" };
    next();
  }, meChatRouter);
  const server = app.listen(0);
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
async function api(base: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + "/api/v1/me" + path, {
    method, headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: JSON.parse(await res.text()) as any };
}

/** A ToolContext whose memo COUNTS how many times each key's underlying read actually ran. */
function countingContext(userId: string): { ctx: ToolContext; runs: Map<string, number> } {
  const base = makeToolContext({ userId, sessionId: "fleet" });
  const runs = new Map<string, number>();
  const once: ToolMemo = <T>(key: string, fn: () => Promise<T>): Promise<T> =>
    base.once(key, () => { runs.set(key, (runs.get(key) ?? 0) + 1); return fn(); });
  return { ctx: { ...base, once }, runs };
}

async function main() {
  // ★ UNMETERED SUITE — force the mock provider before anything runs.
  // ⚠ Without this the suite inherits AI_PROVIDER from .env (which is `gemini`), so `mockByConfig()` is
  // false and EVERY scripted generation consumes a real unit from the shared per-model budget — for calls
  // that never leave the process. Measured: ~91 user-scope units burned across three harnesses in one
  // sitting. The engine runs on the injected scripted provider either way; this only governs metering.
  process.env.AI_PROVIDER = "mock";

  const scored = await buildScoredStocksList();
  if (scored.length < 2) throw new Error("need ≥2 scored stocks");
  const SUBJECT = scored[0];
  const TARGET = scored[1];
  console.log(`Subject: ${SUBJECT.symbol} · Tool target: ${TARGET.symbol}`);

  const ref = { id: await newUser("http") };
  const { server, base } = bootApp(ref);

  try {
    // ══════════════════════════════════════════════════════════════════════════
    section("1 · Registry coherence + definition cost");
    {
      const specs = toolSpecs();
      const names = specs.map((s) => s.name);
      ok("every registered tool is declared to the provider", specs.length === CHAT_TOOLS.length, `${specs.length} tools`);
      ok("tool names are unique", names.length === new Set(names).size);
      ok("every tool has a non-trivial description (steering, not a label)", specs.every((s) => s.description.length > 120));
      ok("every tool exposes an object JSON-Schema", specs.every((s) => (s.parameters as any)?.type === "object"));
      ok("every tool resolves through findTool", names.every((n) => !!findTool(n)));
      const total = specs.reduce((n, s) => n + tok(JSON.stringify(s)), 0);
      console.log(`  → tool definitions: ${specs.length} tools ≈ ${total} tokens on every message`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    section("2 · HTTP conversation exercising FOUR tools in one turn");
    const prov = queuedProvider();
    __setDefaultChatProviderForTests(prov);

    prov.push({ text: `Here's the read on ${SUBJECT.symbol}.` });
    const opened = await api(base, "POST", "/chat/sessions", {
      surface: "stock_health",
      subject: { kind: "stock", symbol: SUBJECT.symbol, name: SUBJECT.name },
      label: "Discuss this read",
    });
    const sessionId: string = opened.json?.data?.session?.id;
    ok("session opened", !!sessionId);

    // One round, four different tools — the loop executes them in parallel.
    prov.push(
      { text: "", toolCalls: [
        call("searchStocks", { query: TARGET.name.split(" ")[0] }),
        call("getStockPrice", { symbol: TARGET.symbol }),
        call("getStockShareholding", { symbol: TARGET.symbol }),
        call("getCorporateEvents", { symbol: TARGET.symbol, upcoming: false, days: 365 }),
      ] },
      { text: `Putting those together for ${TARGET.symbol}: the price line, who owns it, and what's already happened this year.` },
    );
    const fu = await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `Tell me about ${TARGET.name} — price, ownership and recent events.` });
    ok("four-tool turn returned a reply", fu.status === 200 && !!fu.json?.data?.reply);

    const rows = await prisma.chatMessage.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" }, select: { kind: true, toolPayload: true, content: true } });
    const calls = rows.filter((r) => r.kind === "tool_call");
    const results = rows.filter((r) => r.kind === "tool_result");
    ok("one tool_call turn carrying 4 calls", calls.length === 1 && ((calls[0].toolPayload as any[])?.length === 4));
    ok("four tool_result turns persisted", results.length === 4);

    console.log("\n  ┌─ THE FOUR TOOL CALLS (hidden turn):");
    for (const c of (calls[0]?.toolPayload as any[]) ?? []) console.log(`  │   ${c.name}(${JSON.stringify(c.args)})`);
    for (const r of results) {
      const p = r.toolPayload as any;
      const out: string = p?.response?.output ?? `ERROR: ${p?.response?.error}`;
      console.log(`  ├─ RESULT · ${p?.name} (${tok(out)} tok):`);
      console.log(out.split("\n").slice(0, 8).map((l: string) => "  │    " + l).join("\n"));
      if (out.split("\n").length > 8) console.log("  │    …");
    }
    console.log("  └─ FINAL ANSWER (shown to the user):");
    console.log("     " + fu.json?.data?.reply?.content);

    const visible = await api(base, "GET", `/chat/sessions/${sessionId}`);
    const vis = visible.json?.data?.messages ?? [];
    ok("tool turns stay hidden from the transcript", vis.length === 3 && !vis.some((m: any) => String(m.content).includes("=== VYTAL")));
    console.log(`  → prompt on the final generation ≈ ${prov.lastPromptTokens()} tokens (history + 4 tool results)`);

    // ══════════════════════════════════════════════════════════════════════════
    section("3 · Per-turn memo — one read shared across tools");
    {
      const { ctx, runs } = countingContext(ref.id);
      await Promise.all([
        findTool("getStockShareholding")!.handler({ symbol: TARGET.symbol }, ctx),
        findTool("getStockDeals")!.handler({ symbol: TARGET.symbol }, ctx),
        findTool("getStockInsiderTrades")!.handler({ symbol: TARGET.symbol }, ctx),
      ]);
      const ownKey = [...runs.keys()].find((k) => k.startsWith("ownership:")) ?? "";
      ok("★ 3 ownership tools (run CONCURRENTLY) → buildOwnershipView ran ONCE", runs.get(ownKey) === 1, `runs=${runs.get(ownKey)} key=${ownKey}`);

      const { ctx: ctx2, runs: runs2 } = countingContext(ref.id);
      await Promise.all([
        findTool("getStockFacts")!.handler({ symbol: TARGET.symbol }, ctx2),
        findTool("getStockRelationship")!.handler({ symbol: TARGET.symbol }, ctx2),
      ]);
      const hKey = [...runs2.keys()].find((k) => k.startsWith("stockHealth:")) ?? "";
      ok("getStockFacts + getStockRelationship → groundStockHealth ran ONCE", runs2.get(hKey) === 1, `runs=${runs2.get(hKey)}`);

      const { ctx: ctx3, runs: runs3 } = countingContext(ref.id);
      await Promise.all([
        findTool("getStockFundamentals")!.handler({ symbol: TARGET.symbol }, ctx3),
        findTool("getStockQuarterlyResults")!.handler({ symbol: TARGET.symbol }, ctx3),
      ]);
      const fKey = [...runs3.keys()].find((k) => k.startsWith("fundamentals:")) ?? "";
      ok("fundamentals + quarterly results → buildFundamentalsView ran ONCE", runs3.get(fKey) === 1, `runs=${runs3.get(fKey)}`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    section("4 · Universe boundary spot-check across the fleet");
    {
      const ctx = makeToolContext({ userId: ref.id, sessionId: "boundary" });
      const FAKE = "ZZZFAKE123";
      for (const name of ["getStockFacts", "getStockPrice", "getStockShareholding", "getCorporateEvents", "getPeerGroup", "getStockRelationship"]) {
        const r = await findTool(name)!.handler({ symbol: FAKE }, ctx);
        const isBoundary = r.ok && r.content.includes("NOT COVERED");
        ok(`${name} → honest NOT COVERED (an ok result, not an error)`, isBoundary);
      }
      const s = await findTool("searchStocks")!.handler({ query: "zzzznotacompany" }, ctx);
      ok("searchStocks → honest NO MATCH that does not claim the company is unreal", s.ok && s.content.includes("NO MATCH") && s.content.includes("rather than nonexistent"));
    }

    // ══════════════════════════════════════════════════════════════════════════
    section("5 · Fail-soft spot-check across the fleet");
    {
      const ctx = makeToolContext({ userId: ref.id, sessionId: "failsoft" });
      for (const name of ["getStockFacts", "getStockPrice", "getStockQuarterlyResults", "getPeerGroupMembers", "getInstrumentDetails", "getFundAnalytics", "searchStocks"]) {
        const r = await findTool(name)!.handler({}, ctx); // no required arg
        ok(`${name} with missing args → ok:false error (never throws)`, r.ok === false && typeof r.error === "string" && r.error.length > 10);
      }
      const bad = await findTool("getFundAnalytics")!.handler({ schemeCode: "not-a-number" }, ctx);
      ok("getFundAnalytics rejects a non-numeric scheme code", bad.ok === false);
    }

    // ══════════════════════════════════════════════════════════════════════════
    section("6 · Measured output size per tool (typical call)");
    {
      const ctx = makeToolContext({ userId: ref.id, sessionId: "sizing" });
      const inst = await prisma.instrument.findFirst({ where: { assetClass: { in: ["mutual_fund", "etf"] }, amfiSchemeCode: { not: null } }, select: { symbol: true, isin: true, amfiSchemeCode: true } });
      const cases: Array<[string, Record<string, unknown>]> = [
        ["searchStocks", { query: TARGET.name.split(" ")[0] }],
        ["getStockFacts", { symbol: TARGET.symbol }],
        ["getStockFacts (full=true)", { symbol: TARGET.symbol, full: true }],
        ["getStockPrice", { symbol: TARGET.symbol }],
        ["getStockFundamentals", { symbol: TARGET.symbol }],
        ["getStockQuarterlyResults", { symbol: TARGET.symbol }],
        ["getStockShareholding", { symbol: TARGET.symbol }],
        ["getStockDeals", { symbol: TARGET.symbol }],
        ["getStockInsiderTrades", { symbol: TARGET.symbol }],
        ["getCorporateEvents", { symbol: TARGET.symbol, upcoming: false }],
        ["getPeerGroup", { symbol: TARGET.symbol }],
        ["getPeerGroupMembers", { symbol: TARGET.symbol }],
        ["getInstrumentDetails", { identifier: inst?.symbol ?? inst?.isin ?? TARGET.symbol }],
        ["getFundAnalytics", { schemeCode: inst?.amfiSchemeCode ?? "0" }],
        ["getPortfolioFacts", {}],
        ["getStockRelationship", { symbol: TARGET.symbol }],
        ["getWatchlist", {}],
      ];
      console.log("  " + "tool".padEnd(30) + "output tokens");
      console.log("  " + "-".repeat(46));
      for (const [label, args] of cases) {
        const toolName = label.split(" ")[0];
        const r = await findTool(toolName)!.handler(args, ctx);
        const text = r.ok ? r.content : `(error) ${r.error}`;
        console.log("  " + label.padEnd(30) + String(tok(text)).padStart(8));
      }
    }
  } finally {
    server.close();
    __setDefaultChatProviderForTests(null);
    if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds);
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "✅ ALL PASSED" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
