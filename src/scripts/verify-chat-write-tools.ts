// ─────────────────────────────────────────────────────────────────────────────
// CHAT WRITE-TOOLS VERIFY HARNESS (Stage 3, Phase B) — propose → confirm → execute.
//
// Proves, over REAL HTTP against the REAL router/controller/registry/services:
//   1. A real conversation per write tool: propose → the model restates → the reader confirms →
//      executed. Verbatim, with the DB asserted to be UNTOUCHED at the moment of the restatement.
//   2. THE DRIFT TEST — the model restates the wrong numbers AND passes bogus arguments to
//      confirmPendingAction; the write still uses the stored values.
//   3. Cancellation — propose, change the subject, then say "yes": nothing fires.
//   4. One-at-a-time — propose A, propose B; A is gone and "yes" resolves to B.
//   5. recordTransaction ambiguity — "I bought some TCS last week" asks for specifics, never guesses.
//   6. Owner scoping — a proposal in one reader's session cannot execute for another.
//   7. Structural properties — confirmPendingAction has an EMPTY parameter schema; no write tool's
//      handler writes anything; every write description carries the restate-and-ask instruction.
//   8. Guardrail compatibility — realistic restatements and confirmations pass the advice gate.
//
// The provider is SCRIPTED (deterministic, no key): the tool calls it emits are exactly what a model
// emits. Everything downstream of that — the registry dispatch, the proposal store, the services, the
// FIFO replay, persistence, the sweep — is the real code path.
//
// Throwaway users (auth.users insert → signup trigger seeds public.users), cleaned up on exit.
//   npx tsx src/scripts/verify-chat-write-tools.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { createThrowawayUser } from "./lib/throwaway-user.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { __setDefaultChatProviderForTests } from "../chat/engine.js";
import { CHAT_TOOLS, makeToolContext, findTool } from "../chat/tools/registry.js";
import { peekProposal } from "../chat/proposals.js";
import { MEMORY_MAX, verifyMemoryCapMatchesDatabase } from "../chat/memory.js";
import { resolvePhrase } from "../chat/date-resolve.js";
import { scanExplanationText } from "../ai/guardrail.js";
import { buildScoredStocksList } from "../scoring/read/stocks-list.service.js";
import type { AiProvider, AiGenerateRequest, AiGenerateResult, AiToolCall, TokenUsage } from "../ai/types.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n═══════ ${t} ═══════`);

// ── scripted provider ────────────────────────────────────────────────────────
interface Step {
  text?: string;
  toolCalls?: AiToolCall[];
}
function synthUsage(req: AiGenerateRequest, text: string): TokenUsage {
  const promptChars = req.messages.reduce((n, m) => n + m.content.length, 0) + (req.system?.length ?? 0);
  return { promptTokens: Math.ceil(promptChars / 4), outputTokens: Math.ceil(text.length / 4), cachedTokens: 0, cacheHit: false, modelVersion: "scripted-write-1" };
}
function queuedProvider(): AiProvider & { push: (...s: Step[]) => void; pending: () => number } {
  const q: Step[] = [];
  return {
    push: (...s: Step[]) => q.push(...s),
    pending: () => q.length,
    async generate(req: AiGenerateRequest): Promise<AiGenerateResult> {
      const step = q.shift() ?? { text: "[script exhausted]" };
      const text = step.text ?? "";
      return { text, usage: synthUsage(req, text), ...(step.toolCalls?.length ? { toolCalls: step.toolCalls } : {}) };
    },
    async generateStructured() {
      throw new Error("scripted provider: generateStructured not used");
    },
    async ping() {
      return true;
    },
  };
}
const tc = (name: string, args: Record<string, unknown> = {}): AiToolCall => ({ id: randomUUID().slice(0, 8), name, args });

// ── throwaway users + HTTP ───────────────────────────────────────────────────
const authIds: string[] = [];
async function newUser(tag: string): Promise<string> {
  // Shared helper: sweeps leftovers from previous interrupted runs on first call (scripts/lib/throwaway-user.ts).
  const { authId } = await createThrowawayUser(`wtool-${tag}`);
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
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
async function api(base: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + "/api/v1/me" + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: JSON.parse(await res.text()) };
}

// ── transcript printing (visible messages + the HIDDEN tool turns, in true order) ──
const indent = (s: string, pad = "        ") => s.split("\n").map((l) => pad + l).join("\n");
async function printTranscript(sessionId: string, fromIndex = 0): Promise<number> {
  const rows = await prisma.chatMessage.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
  const slice = rows.slice(fromIndex);
  for (const m of slice) {
    if (m.kind === "tool_call") {
      const calls = (m.toolPayload as unknown as AiToolCall[]) ?? [];
      for (const c of calls) console.log(`  [tool call]  ${c.name}(${JSON.stringify(c.args)})`);
      if (m.content.trim()) console.log(`  [assistant preamble] ${m.content}`);
    } else if (m.kind === "tool_result") {
      const r = m.toolPayload as any;
      const body = r?.response?.output ?? r?.response?.error ?? "";
      console.log(`  [tool result → the model, ${r?.response?.error ? "ERROR" : "ok"}]`);
      console.log(indent(String(body)));
    } else if (m.role === "user" && m.isOpening) {
      console.log(`  [grounded opening scaffolding — hidden from the reader, ${m.content.length} chars]`);
    } else {
      console.log(`  ${m.role === "user" ? "READER" : "VYTAL "} │ ${m.content}`);
    }
  }
  return rows.length;
}

/** The date the resolver gives for "last Tuesday" — computed the same way the tool does, not hard-coded,
 *  so this harness keeps working on whatever day it runs. */
function lastTuesday(): string {
  const r = resolvePhrase("last Tuesday");
  if (!r.ok) throw new Error("resolver could not resolve 'last Tuesday'");
  return r.date;
}

// ── DB probes ────────────────────────────────────────────────────────────────
const watchCount = (userId: string, stockId?: string) => prisma.watchlist.count({ where: { userId, ...(stockId ? { stockId } : {}) } });
const alertCount = (userId: string) => prisma.alert.count({ where: { userId } });
const reminderCount = (userId: string) => prisma.eventReminder.count({ where: { userId } });
const txnCount = (userId: string) => prisma.transaction.count({ where: { userId } });

async function main() {
  // ★ UNMETERED SUITE — force the mock provider before anything runs.
  // ⚠ Without this the suite inherits AI_PROVIDER from .env (which is `gemini`), so `mockByConfig()` is
  // false and EVERY scripted generation consumes a real unit from the shared per-model budget — for calls
  // that never leave the process. Measured: ~91 user-scope units burned across three harnesses in one
  // sitting. The engine runs on the injected scripted provider either way; this only governs metering.
  process.env.AI_PROVIDER = "mock";

  const scored = await buildScoredStocksList();
  if (scored.length < 3) throw new Error("need ≥3 scored stocks for this proof");
  const A = scored[0]; // the session subject + the main write target
  const B = scored[1]; // the "propose B while A is pending" target
  const C = scored[2]; // the cancellation target
  // The list view carries no stock id — resolve the three so the DB assertions can be per-stock.
  const idBySymbol = new Map(
    (await prisma.stock.findMany({ where: { symbol: { in: [A.symbol, B.symbol, C.symbol] } }, select: { id: true, symbol: true } })).map((s) => [s.symbol, s.id]),
  );
  const ID = { A: idBySymbol.get(A.symbol)!, B: idBySymbol.get(B.symbol)!, C: idBySymbol.get(C.symbol)! };
  console.log(`Fixtures — subject/target: ${A.symbol} · second: ${B.symbol} · third: ${C.symbol}`);

  const userIdRef = { id: await newUser("main") };
  const USER = userIdRef.id;
  const OTHER = await newUser("other");
  const { server, base } = bootApp(userIdRef);
  const prov = queuedProvider();
  __setDefaultChatProviderForTests(prov);

  // one manual account so recordTransaction has a book to file into
  const account = await prisma.portfolioAccount.create({
    data: { userId: USER, name: "Test Book", broker: "other", state: "manual" },
    select: { id: true, name: true },
  });

  try {
    // Open a chat-page session (no subject grounding needed for writes).
    const opened = await api(base, "POST", "/chat/sessions", { origin: "chat_page" });
    const sessionId: string = opened.json?.data?.session?.id;
    ok("session opened", !!sessionId, `id=${String(sessionId).slice(0, 8)}…`);
    let cursor = await printTranscript(sessionId);

    // ═════════════════════════════════════════════════════════════════════════
    section("1 · addToWatchlist — the full loop, verbatim");
    {
      const before = await watchCount(USER);
      // Turn 1: the model proposes.
      prov.push(
        { toolCalls: [tc("addToWatchlist", { symbol: A.symbol })] },
        { text: `Before I do that — I'd be adding ${A.symbol} (${A.name}) to your watchlist, and Vytal would record its health at the moment of adding as ${A.composite != null ? Math.round(Number(A.composite)) : "unscored"}${A.band ? ` (${A.band})` : ""}. Shall I go ahead?` },
      );
      const t1 = await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `add ${A.symbol} to my watchlist` });
      ok("turn 1 succeeded", t1.status === 200);
      cursor = await printTranscript(sessionId, cursor);

      // ★ THE PROOF THAT PROPOSING IS NOT WRITING
      const mid = await watchCount(USER);
      ok("★ NOTHING WRITTEN at the moment of the restatement", mid === before, `watchlist rows ${before} → ${mid}`);
      const pend = await peekProposal(sessionId, USER);
      ok("a proposal is pending, holding the parsed values", pend?.kind === "addToWatchlist", `kind=${pend?.kind} fields=${pend?.fields.length}`);

      // Turn 2: the reader confirms.
      prov.push(
        { toolCalls: [tc("confirmPendingAction", {})] },
        { text: `Done — ${A.symbol} is on your watchlist, with its health at the moment of adding recorded.` },
      );
      const t2 = await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: "yes, go ahead" });
      ok("turn 2 succeeded", t2.status === 200);
      cursor = await printTranscript(sessionId, cursor);

      const after = await watchCount(USER);
      ok("★ WRITTEN only after the confirm", after === before + 1, `watchlist rows ${mid} → ${after}`);
      ok("proposal cleared on execute", (await peekProposal(sessionId, USER)) === null);
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("2 · createAlert — coherence rejection, then the full loop");
    {
      // 2a. The service's OWN coherence rule reaches the model verbatim (finding + threshold).
      prov.push(
        { toolCalls: [tc("createAlert", { symbol: A.symbol, type: "finding", operator: "fires", threshold: 100 })] },
        { text: "A finding alert doesn't take a price — it watches for findings appearing. Did you mean a price alert at ₹100, or an alert for any new finding?" },
      );
      const bad = await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `alert me on ${A.symbol} findings above 100` });
      ok("coherence-rejection turn survived (fail-soft)", bad.status === 200);
      cursor = await printTranscript(sessionId, cursor);
      ok("no alert written by a rejected proposal", (await alertCount(USER)) === 0);
      ok("no proposal stored by a rejected call", (await peekProposal(sessionId, USER)) === null);

      // 2b. The valid loop.
      const before = await alertCount(USER);
      prov.push(
        { toolCalls: [tc("createAlert", { symbol: A.symbol, type: "price", operator: "above", threshold: 1750.5 })] },
        { text: `I'd set a price alert on ${A.symbol}: it fires when the price goes above ₹1,750.50, once only, checked once a day on end-of-day data. Confirm?` },
      );
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `ok, price alert above 1750.50 on ${A.symbol}` });
      cursor = await printTranscript(sessionId, cursor);
      ok("★ no alert written at the restatement", (await alertCount(USER)) === before, `alerts=${await alertCount(USER)}`);

      prov.push({ toolCalls: [tc("confirmPendingAction", {})] }, { text: `Set — ${A.symbol} above ₹1,750.50, checked daily on end-of-day data.` });
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: "yes" });
      cursor = await printTranscript(sessionId, cursor);
      const created = await prisma.alert.findFirst({ where: { userId: USER }, select: { type: true, operator: true, thresholdPrice: true } });
      ok("★ alert written from the stored proposal", !!created && created.type === "price" && created.operator === "above" && Number(created.thresholdPrice) === 1750.5,
        created ? `${created.type}/${created.operator}/${Number(created.thresholdPrice)}` : "none");
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("3 · deleteAlert — resolved by ticker, then the full loop");
    {
      prov.push(
        { toolCalls: [tc("deleteAlert", { symbol: A.symbol })] },
        { text: `That would remove your price alert on ${A.symbol} — the one that fires above ₹1,750.50. Remove it?` },
      );
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `actually drop that alert on ${A.symbol}` });
      cursor = await printTranscript(sessionId, cursor);
      ok("★ alert still present at the restatement", (await alertCount(USER)) === 1);

      prov.push({ toolCalls: [tc("confirmPendingAction", {})] }, { text: `Removed — that alert on ${A.symbol} is gone.` });
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: "yes please" });
      cursor = await printTranscript(sessionId, cursor);
      ok("★ alert deleted after the confirm", (await alertCount(USER)) === 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("4 · setEventReminder — the full loop");
    {
      prov.push(
        { toolCalls: [tc("setEventReminder", { symbol: A.symbol, eventType: "earnings", daysBefore: 3 })] },
        { text: `I'd set an earnings reminder on ${A.symbol}, 3 days before the event. Confirm?` },
      );
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `remind me 3 days before ${A.symbol} earnings` });
      cursor = await printTranscript(sessionId, cursor);
      ok("★ no reminder written at the restatement", (await reminderCount(USER)) === 0);

      prov.push({ toolCalls: [tc("confirmPendingAction", {})] }, { text: "Set — you'll hear from us three days before." });
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: "yep" });
      cursor = await printTranscript(sessionId, cursor);
      const rem = await prisma.eventReminder.findFirst({ where: { userId: USER }, select: { eventType: true, daysBefore: true } });
      ok("★ reminder written from the stored proposal", rem?.eventType === "earnings" && rem?.daysBefore === 3, `${rem?.eventType}/${rem?.daysBefore}`);
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("5 · recordTransaction — AMBIGUITY: 'I bought some TCS last week'");
    {
      // The model, given a vague message, calls with what it actually has. It must be refused.
      prov.push(
        { toolCalls: [tc("recordTransaction", { symbol: A.symbol, type: "buy", tradeDate: "last week" })] },
        { text: `I don't want to guess at that one. How many shares did you buy, at what price, and on exactly which date?` },
      );
      const amb = await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `I bought some ${A.symbol} last week` });
      ok("ambiguous turn survived", amb.status === 200);
      cursor = await printTranscript(sessionId, cursor);
      ok("★ no transaction written", (await txnCount(USER)) === 0);
      ok("★ no proposal stored — it refused rather than guessing", (await peekProposal(sessionId, USER)) === null);

      // And the quantity/price half of the same rule, with a valid date.
      prov.push(
        { toolCalls: [tc("recordTransaction", { symbol: A.symbol, type: "buy", tradeDate: "2026-02-05" })] },
        { text: "I have the date, but I still need the quantity and the price you paid." },
      );
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: "it was on the 5th of Feb" });
      cursor = await printTranscript(sessionId, cursor);
      ok("★ still nothing written, still nothing pending", (await txnCount(USER)) === 0 && (await peekProposal(sessionId, USER)) === null);
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("6 · recordTransaction — the full loop, every field enumerated");
    {
      prov.push(
        { toolCalls: [tc("recordTransaction", { symbol: A.symbol, type: "buy", quantity: 40, price: 1750.5, tradeDate: "2026-02-05", fees: 12.5 })] },
        { text: `Here's exactly what I'd record: a BUY of 40 ${A.symbol} at ₹1,750.50 per share on 2026-02-05, with ₹12.50 in fees, into "${account.name}" — a total cost of ₹70,032.50. Confirm and I'll write it to your ledger.` },
      );
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `right — 40 shares of ${A.symbol} at 1750.50 on 2026-02-05, fees 12.50` });
      cursor = await printTranscript(sessionId, cursor);
      ok("★ ledger UNTOUCHED at the restatement", (await txnCount(USER)) === 0);

      prov.push({ toolCalls: [tc("confirmPendingAction", {})] }, { text: "Recorded. Your position and cost basis have been updated." });
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: "confirm" });
      cursor = await printTranscript(sessionId, cursor);
      const t = await prisma.transaction.findFirst({ where: { userId: USER }, select: { type: true, quantity: true, price: true, fees: true, tradeDate: true, accountId: true } });
      ok("★ transaction written from the stored proposal",
        !!t && t.type === "buy" && Number(t.quantity) === 40 && Number(t.price) === 1750.5 && Number(t.fees) === 12.5 && t.accountId === account.id,
        t ? `${t.type} ${Number(t.quantity)} @ ${Number(t.price)} fees ${Number(t.fees)}` : "none");
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("7 · ★ THE DRIFT TEST — the model echoes the WRONG numbers and passes bogus confirm args");
    {
      const beforeQty = 40;
      prov.push(
        { toolCalls: [tc("recordTransaction", { symbol: A.symbol, type: "buy", quantity: 7, price: 1000, tradeDate: "2026-03-10" })] },
        // ⚠ The restatement DELIBERATELY LIES: it says 700 shares at ₹10,000 — nothing like what was parsed.
        { text: `I'd record a BUY of 700 ${A.symbol} at ₹10,000.00 on 2026-03-10. Confirm?` },
      );
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `add a buy: 7 shares of ${A.symbol} at 1000 on 2026-03-10` });
      cursor = await printTranscript(sessionId, cursor);
      const pend = await peekProposal(sessionId, USER);
      ok("stored proposal holds the PARSED values, not the echoed ones",
        Number((pend?.args as any)?.quantity) === 7 && Number((pend?.args as any)?.price) === 1000,
        `stored qty=${(pend?.args as any)?.quantity} price=${(pend?.args as any)?.price} · model said 700 @ 10000`);

      // ⚠ And the confirm call carries FABRICATED arguments. The tool takes none; they must be inert.
      prov.push(
        { toolCalls: [tc("confirmPendingAction", { quantity: 700, price: 10000, symbol: "SOMETHINGELSE" })] },
        { text: "Recorded." },
      );
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: "yes" });
      cursor = await printTranscript(sessionId, cursor);

      const t = await prisma.transaction.findFirst({
        where: { userId: USER, tradeDate: new Date("2026-03-10T00:00:00.000Z") },
        select: { quantity: true, price: true, stockId: true },
      });
      ok("★★ WRITE USED THE STORED VALUES — 7 @ ₹1,000, not the echoed 700 @ ₹10,000",
        !!t && Number(t.quantity) === 7 && Number(t.price) === 1000,
        t ? `written: ${Number(t.quantity)} @ ${Number(t.price)}` : "no row");
      ok("bogus confirm arguments were inert", !!t && Number(t.quantity) !== 700 && Number(t.price) !== 10000);
      ok("the earlier 40-share lot is untouched", (await prisma.transaction.count({ where: { userId: USER, quantity: beforeQty } })) === 1);
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("8 · ★ CANCELLATION — propose, change the subject, then say 'yes'");
    {
      const before = await watchCount(USER);
      prov.push(
        { toolCalls: [tc("addToWatchlist", { symbol: C.symbol })] },
        { text: `I'd add ${C.symbol} (${C.name}) to your watchlist. Confirm?` },
      );
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `watch ${C.symbol} too` });
      cursor = await printTranscript(sessionId, cursor);
      ok("proposal pending after the propose turn", (await peekProposal(sessionId, USER))?.kind === "addToWatchlist");

      // The reader changes the subject entirely. The model answers normally — no confirm, no cancel.
      prov.push({ text: "Vytal's health score is a 0–100 composite of four pillars, computed from filed financials." });
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: "actually, what does the health score measure?" });
      cursor = await printTranscript(sessionId, cursor);
      ok("★ the server sweep cleared the abandoned proposal", (await peekProposal(sessionId, USER)) === null);

      // Now a bare "yes" — there must be nothing for it to attach to.
      prov.push({ toolCalls: [tc("confirmPendingAction", {})] }, { text: "There's nothing waiting to be confirmed — did you want me to add something?" });
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: "yes" });
      cursor = await printTranscript(sessionId, cursor);
      ok("★★ the abandoned proposal did NOT fire later", (await watchCount(USER)) === before, `watchlist rows ${before} → ${await watchCount(USER)}`);
      ok(`${C.symbol} was never added`, (await watchCount(USER, ID.C)) === 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("9 · explicit cancelPendingAction");
    {
      prov.push({ toolCalls: [tc("addToWatchlist", { symbol: C.symbol })] }, { text: `I'd add ${C.symbol}. Confirm?` });
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `watch ${C.symbol}` });
      cursor = await printTranscript(sessionId, cursor);

      prov.push({ toolCalls: [tc("cancelPendingAction", {})] }, { text: "No problem — I've dropped that, nothing was changed." });
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: "no, forget it" });
      cursor = await printTranscript(sessionId, cursor);
      ok("★ cancel cleared the proposal and wrote nothing", (await peekProposal(sessionId, USER)) === null && (await watchCount(USER, ID.C)) === 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("10 · ★ ONE AT A TIME — propose A, then propose B before confirming");
    {
      // A: add C. Then WITHOUT confirming, B: add the second stock. The column can hold only one.
      prov.push({ toolCalls: [tc("addToWatchlist", { symbol: C.symbol })] }, { text: `I'd add ${C.symbol}. Confirm?` });
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `add ${C.symbol}` });
      const pendA = await peekProposal(sessionId, USER);
      ok("proposal A pending", (pendA?.fields ?? []).some((f) => f.value.includes(C.symbol)), `A = ${pendA?.summary}`);
      cursor = await printTranscript(sessionId, cursor);

      prov.push({ toolCalls: [tc("addToWatchlist", { symbol: B.symbol })] }, { text: `Actually — I'd add ${B.symbol} instead. Confirm?` });
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `no wait, ${B.symbol} instead` });
      cursor = await printTranscript(sessionId, cursor);
      const pendB = await peekProposal(sessionId, USER);
      ok("★ A is GONE — exactly one proposal can be pending", !!pendB && pendB.id !== pendA?.id && !pendB.fields.some((f) => f.value.includes(C.symbol)), `B = ${pendB?.summary}`);

      prov.push({ toolCalls: [tc("confirmPendingAction", {})] }, { text: `Added ${B.symbol}.` });
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: "yes" });
      cursor = await printTranscript(sessionId, cursor);
      ok(`★★ "yes" resolved to B — ${B.symbol} added`, (await watchCount(USER, ID.B)) === 1);
      ok(`★★ A never happened — ${C.symbol} not added`, (await watchCount(USER, ID.C)) === 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("11 · ★ OWNER SCOPING — a proposal cannot execute for another reader");
    {
      // Store a proposal in USER's session by calling the write tool with USER's context.
      const ctxUser = makeToolContext({ userId: USER, sessionId });
      await findTool("addToWatchlist")!.handler({ symbol: C.symbol }, ctxUser);
      const stored = await peekProposal(sessionId, USER);
      ok("proposal stored in USER's session", !!stored);

      // OTHER now tries to confirm it, naming USER's session id. ctx.userId comes from auth, not args.
      const ctxOther = makeToolContext({ userId: OTHER, sessionId });
      const res = await findTool("confirmPendingAction")!.handler({}, ctxOther);
      const text = res.ok ? res.content : res.error;
      ok("★★ the other reader gets NOTHING PENDING", text.includes("NOTHING PENDING"), text.split("\n")[0].slice(0, 70));
      ok("★★ nothing was written for either reader", (await watchCount(OTHER)) === 0 && (await watchCount(USER, ID.C)) === 0);
      ok("★ USER's proposal survived the foreign attempt", (await peekProposal(sessionId, USER))?.id === stored?.id);

      // peek is owner-scoped too.
      ok("peek is owner-scoped", (await peekProposal(sessionId, OTHER)) === null);

      // And the legitimate owner can still confirm it — proving the refusal was about identity, not state.
      const okRes = await findTool("confirmPendingAction")!.handler({}, ctxUser);
      ok("the owner CAN confirm the same proposal", okRes.ok && okRes.content.includes("DONE"), okRes.ok ? "" : okRes.error);
      ok(`${C.symbol} now added for USER only`, (await watchCount(USER, ID.C)) === 1 && (await watchCount(OTHER)) === 0);

      // Clean up so later counts are predictable.
      await prisma.watchlist.deleteMany({ where: { userId: USER, stockId: ID.C } });
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("12 · single-use consume — a second confirm cannot re-fire the same proposal");
    {
      const ctxUser = makeToolContext({ userId: USER, sessionId });
      await findTool("addToWatchlist")!.handler({ symbol: C.symbol }, ctxUser);
      const first = await findTool("confirmPendingAction")!.handler({}, ctxUser);
      const second = await findTool("confirmPendingAction")!.handler({}, ctxUser);
      ok("first confirm executed", first.ok && first.content.includes("DONE"));
      ok("★ second confirm finds nothing pending", second.ok && second.content.includes("NOTHING PENDING"));
      ok("exactly one row written", (await watchCount(USER, ID.C)) === 1);
      await prisma.watchlist.deleteMany({ where: { userId: USER, stockId: ID.C } });

      // CONCURRENT confirms — the case the atomic consume exists for. Both fire at once against one
      // proposal; exactly one may come away with it, or a trade gets written twice.
      await findTool("addToWatchlist")!.handler({ symbol: C.symbol }, ctxUser);
      const [r1, r2] = await Promise.all([
        findTool("confirmPendingAction")!.handler({}, ctxUser),
        findTool("confirmPendingAction")!.handler({}, ctxUser),
      ]);
      const executed = [r1, r2].filter((r) => r.ok && r.content.includes("DONE")).length;
      const empty = [r1, r2].filter((r) => r.ok && r.content.includes("NOTHING PENDING")).length;
      ok("★★ concurrent confirms — exactly ONE executes, the other finds nothing", executed === 1 && empty === 1, `executed=${executed} empty=${empty}`);
      ok("and exactly one row exists", (await watchCount(USER, ID.C)) === 1);
      await prisma.watchlist.deleteMany({ where: { userId: USER, stockId: ID.C } });
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("13 · structural properties of the write fleet");
    {
      const writes = CHAT_TOOLS.filter((t) => t.klass === "write");
      // 9 since user-directed memory shipped: rememberThis joined the proposing fleet (chat/tools/memory.ts).
      ok("9 write tools registered", writes.length === 9, writes.map((w) => w.name).join(", "));

      // ★ THE ANTI-DRIFT PROPERTY, ASSERTED MECHANICALLY.
      const confirmParams = findTool("confirmPendingAction")!.parameters as any;
      ok("★★ confirmPendingAction takes NO arguments (nothing that could drift)",
        confirmParams?.type === "object" && Object.keys(confirmParams.properties ?? {}).length === 0 && confirmParams.additionalProperties === false,
        JSON.stringify(confirmParams));
      const cancelParams = findTool("cancelPendingAction")!.parameters as any;
      ok("cancelPendingAction takes no arguments either", Object.keys(cancelParams.properties ?? {}).length === 0);

      // Every proposing tool tells the model to restate and not to claim completion.
      const proposers = writes.filter((w) => w.name !== "confirmPendingAction" && w.name !== "cancelPendingAction");
      for (const w of proposers) {
        const d = w.description;
        const hasRestate = /state .*back to the reader/i.test(d) && /ask them to confirm/i.test(d);
        const hasNotDone = /never reply as though/i.test(d) || /DOES NOT/.test(d);
        const namesConfirm = d.includes("confirmPendingAction");
        ok(`${w.name}: description instructs restate-and-ask, denies completion, names confirmPendingAction`, hasRestate && hasNotDone && namesConfirm,
          `restate=${hasRestate} notDone=${hasNotDone} confirm=${namesConfirm}`);
      }

      // ★ NO PROPOSING HANDLER WRITES. Call each one and prove the row counts do not move.
      const ctxUser = makeToolContext({ userId: USER, sessionId });
      const snap = async () => [await watchCount(USER), await alertCount(USER), await reminderCount(USER), await txnCount(USER)].join("/");
      const beforeAll = await snap();
      await findTool("addToWatchlist")!.handler({ symbol: C.symbol }, ctxUser);
      await findTool("removeFromWatchlist")!.handler({ symbol: A.symbol }, ctxUser);
      await findTool("createAlert")!.handler({ symbol: A.symbol, type: "price", operator: "below", threshold: 10 }, ctxUser);
      await findTool("setEventReminder")!.handler({ symbol: B.symbol, eventType: "dividend" }, ctxUser);
      await findTool("recordTransaction")!.handler({ symbol: A.symbol, type: "buy", quantity: 1, price: 1, tradeDate: "2026-04-01" }, ctxUser);
      const afterAll = await snap();
      ok("★★ every proposing handler left the database untouched", beforeAll === afterAll, `watch/alert/reminder/txn ${beforeAll} → ${afterAll}`);
      await findTool("cancelPendingAction")!.handler({}, ctxUser);

      // ★ THE CAP LIVES IN TWO PLACES — assert they agree, mechanically.
      //
      // ⚠ THIS IS A REGRESSION TEST FOR A BUG THAT SHIPPED. MEMORY_MAX was raised to 30 while the SQL
      // CHECK stayed at 20, so the DATABASE won the race and a reader's 21st memory came back as a 23514
      // constraint violation — a 500 in place of the one thing the cap exists to produce, a sentence
      // asking which memory to drop. Nothing tied the two numbers together, so nothing caught it.
      //
      // It belongs HERE rather than at startup on purpose: a boot-time version would take the whole
      // product down over one feature's error message, and add a DB round-trip to every boot. This reads
      // the live predicate out of pg_constraint and names both numbers when they disagree.
      const cap = await verifyMemoryCapMatchesDatabase();
      ok(
        `★★ MEMORY_MAX (${MEMORY_MAX}) equals the SQL CHECK on stated_memories — the CODE cap must fire first`,
        cap.ok,
        cap.ok ? `both ${cap.dbCap}` : cap.reason,
      );
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("14 · guardrail compatibility — restatements and confirmations are not 'advice'");
    {
      const samples = [
        `Before I do that — I'd be adding ${A.symbol} to your watchlist, and Vytal would record its health at the moment of adding as 72 (healthy). Shall I go ahead?`,
        `I'd set a price alert on ${A.symbol}: it fires when the price goes above ₹1,750.50, once only, checked once a day on end-of-day data. Confirm?`,
        `Here's exactly what I'd record: a BUY of 40 ${A.symbol} at ₹1,750.50 per share on 2026-02-05, with ₹12.50 in fees, into "Test Book" — a total cost of ₹70,032.50. Confirm and I'll write it to your ledger.`,
        `That would remove your price alert on ${A.symbol} — the one that fires above ₹1,750.50. Remove it?`,
        `I'd set an earnings reminder on ${A.symbol}, 3 days before the event. Confirm?`,
        "Recorded. Your position and cost basis have been updated.",
        "No problem — I've dropped that, nothing was changed.",
        "I don't want to guess at that one. How many shares did you buy, at what price, and on exactly which date?",
      ];
      let clean = 0;
      for (const s of samples) {
        const r = scanExplanationText(s);
        if (r.clean) clean++;
        else console.log(`     ⚠ blocked: "${s.slice(0, 60)}…" → ${JSON.stringify(r)}`);
      }
      ok("★ all restate-and-ask / confirmation phrasings pass the advice guardrail", clean === samples.length, `${clean}/${samples.length}`);
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("16 · ★ THE DATE GUARD over HTTP — a date the reader never said is refused");
    {
      const before = await txnCount(USER);
      // The reader says "last week". The model does what it did live: invents a concrete date.
      prov.push(
        { toolCalls: [tc("recordTransaction", { symbol: A.symbol, type: "buy", quantity: 10, price: 3500, tradeDate: "2025-02-26" })] },
        { text: "I can't date that myself — which day last week was it?" },
      );
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `I bought 10 ${A.symbol} at 3500 last week` });
      cursor = await printTranscript(sessionId, cursor);
      ok("★★ the invented date was REFUSED", (await txnCount(USER)) === before && (await peekProposal(sessionId, USER)) === null,
        `transactions ${before} → ${await txnCount(USER)}, pending=${(await peekProposal(sessionId, USER))?.kind ?? "none"}`);

      // Same turn shape, but now the reader NAMED the date — it must go through.
      prov.push(
        { toolCalls: [tc("recordTransaction", { symbol: A.symbol, type: "buy", quantity: 10, price: 3500, tradeDate: "2026-01-09" })] },
        { text: "Here's what I'd record… confirm?" },
      );
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: `it was on 9 January 2026 — 10 ${A.symbol} at 3500` });
      cursor = await printTranscript(sessionId, cursor);
      const pend = await peekProposal(sessionId, USER);
      ok("★★ …but a date the reader DID name is accepted", pend?.kind === "recordTransaction" && (pend.args as any).tradeDate === "2026-01-09",
        pend ? String((pend.args as any).tradeDate) : "no proposal");

      // And the resolveDate route: the reader is vague, the model resolves, then records.
      await findTool("cancelPendingAction")!.handler({}, makeToolContext({ userId: USER, sessionId }));
      prov.push(
        { toolCalls: [tc("resolveDate", { phrase: "last Tuesday" })] },
        { toolCalls: [tc("recordTransaction", { symbol: A.symbol, type: "buy", quantity: 2, price: 100, tradeDate: lastTuesday() })] },
        { text: "Confirm?" },
      );
      await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: "actually it was last Tuesday" });
      cursor = await printTranscript(sessionId, cursor);
      const pend2 = await peekProposal(sessionId, USER);
      ok("★★ a resolveDate-provided date passes the guard in the same turn", pend2?.kind === "recordTransaction" && (pend2.args as any).tradeDate === lastTuesday(),
        pend2 ? String((pend2.args as any).tradeDate) : "no proposal");
      await findTool("cancelPendingAction")!.handler({}, makeToolContext({ userId: USER, sessionId }));
    }

    // ═════════════════════════════════════════════════════════════════════════
    section("15 · the reader's transcript never shows raw tool JSON");
    {
      const got = await api(base, "GET", `/chat/sessions/${sessionId}`);
      const msgs: any[] = got.json?.data?.messages ?? [];
      const leaked = msgs.filter((m) => /PROPOSED —|=== DONE|confirmPendingAction|NOTHING PENDING/.test(m.content));
      ok("★ no proposal/tool text leaked into the client transcript", leaked.length === 0, `${msgs.length} visible messages, ${leaked.length} leaked`);
      const hidden = await prisma.chatMessage.count({ where: { sessionId, kind: { in: ["tool_call", "tool_result"] } } });
      ok("tool turns ARE persisted for the model's history", hidden > 0, `${hidden} hidden tool turns`);
    }
  } finally {
    server.close();
    __setDefaultChatProviderForTests(null);
  }

  console.log(`\n${failures === 0 ? "═══ ALL WRITE-TOOL CHECKS PASSED ✅ ═══" : `═══ ${failures} FAILURE(S) ❌ ═══`}`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds);
    await prisma.$disconnect();
  });
