// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT: does the model reach for getStockFacts(full=true) on a genuine drill-down?
//
// ⚠ THIS MAKES REAL, PAID GEMINI CALLS and consumes real quota units. It changes nothing — it opens a
// session, asks two questions, and reports exactly what the model did.
//
//   Turn 1 (DRILL-DOWN)  — a question about a stock the session was NOT opened on, which the lean
//                          summary cannot answer (per-metric detail inside a pillar). Expect full=true.
//   Turn 2 (CASUAL)      — a plain "how is X's health?" about a third stock. Expect NO full=true.
//
// Units are read straight off ai_usage_counters (before/after) so the cost is measured, not estimated.
//
//   npx tsx src/scripts/measure-full-drilldown.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";

// ★ REAL provider + REAL metering. Set BEFORE anything resolves a provider: the registry reads
//   AI_PROVIDER lazily per call, and spend.ts's mockByConfig() keys off the same var — leaving it unset
//   would silently serve a mock AND skip the spend gate, making this measurement meaningless.
process.env.AI_PROVIDER = "gemini";

const { prisma } = await import("../db/prisma.js");
const { meChatRouter } = await import("../routes/me-chat-routes.js");
const { resolveChatModel } = await import("../chat/config.js");

const SUBJECT = "ABB"; // the session is opened on this
const DRILLDOWN_TARGET = "ACC"; // turn 1 asks about THIS (not the subject) — the tool is required
const CASUAL_TARGET = "HDFCBANK"; // turn 2 asks a shallow question about THIS

const DRILLDOWN_Q = `Walk me through every metric inside Foundation for ${DRILLDOWN_TARGET} and how each one scored — I want the individual metrics, not the pillar total.`;
const CASUAL_Q = `How is ${CASUAL_TARGET}'s health?`;

const tok = (s: string) => Math.ceil(s.length / 4);
const line = (n = 78) => console.log("─".repeat(n));

// ── throwaway user + HTTP (same pattern as the verify harnesses) ──
const authIds: string[] = [];
async function newUser(): Promise<string> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `drill-${authId}@test.local`);
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

/** Units consumed so far today against the chat model (the gate's own counter). */
async function unitsSoFar(model: string): Promise<number> {
  const rows = await prisma.aiUsageCounter.findMany({ where: { scope: model }, select: { callCount: true, windowKey: true }, orderBy: { windowKey: "desc" }, take: 1 });
  return rows[0]?.callCount ?? 0;
}

/** Gemini free tier 503s intermittently (documented in quota.ts). Retry the TURN, report the cost. */
async function withRetry<T>(label: string, fn: () => Promise<T>, check: (r: T) => boolean, attempts = 3): Promise<T> {
  let last: T | undefined;
  for (let i = 1; i <= attempts; i++) {
    last = await fn();
    if (check(last)) return last;
    console.log(`   (${label}: attempt ${i} did not return a usable reply — retrying)`);
  }
  return last as T;
}

/** Dump every message of a session, marking hidden tool turns and showing tool ARGS verbatim. */
async function dumpTurn(sessionId: string, sinceIso: Date, header: string) {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId, createdAt: { gt: sinceIso } },
    orderBy: { createdAt: "asc" },
    select: { role: true, kind: true, content: true, toolPayload: true, promptTokens: true, outputTokens: true },
  });
  console.log(`\n${header}`);
  line();
  for (const r of rows) {
    if (r.kind === "tool_call") {
      const calls = (r.toolPayload as any[]) ?? [];
      console.log(`  [hidden] TOOL CALL${calls.length > 1 ? `S (${calls.length})` : ""}:`);
      for (const c of calls) console.log(`     → ${c.name}(${JSON.stringify(c.args)})`);
      if (r.content?.trim()) console.log(`     (model preamble: "${r.content.trim()}")`);
      console.log(`     [generation cost: prompt ${r.promptTokens} tok, output ${r.outputTokens} tok]`);
    } else if (r.kind === "tool_result") {
      const p = r.toolPayload as any;
      const out: string = p?.response?.output ?? `ERROR: ${p?.response?.error}`;
      console.log(`  [hidden] TOOL RESULT · ${p?.name} — ${tok(out)} tokens:`);
      console.log(out.split("\n").map((l) => "     │ " + l).join("\n"));
    } else if (r.role === "user") {
      console.log(`  USER: ${r.content}`);
    } else {
      console.log(`  ASSISTANT [prompt ${r.promptTokens} tok, output ${r.outputTokens} tok]:`);
      console.log(r.content.split("\n").map((l) => "     " + l).join("\n"));
    }
  }
  line();
  return rows;
}

/** Every getStockFacts call in a turn, with the full flag as the model actually sent it. */
function factsCalls(rows: Array<{ kind: string; toolPayload: unknown }>): Array<{ symbol: unknown; full: unknown }> {
  const out: Array<{ symbol: unknown; full: unknown }> = [];
  for (const r of rows) {
    if (r.kind !== "tool_call") continue;
    for (const c of ((r.toolPayload as any[]) ?? [])) {
      if (c?.name === "getStockFacts") out.push({ symbol: c.args?.symbol, full: c.args?.full });
    }
  }
  return out;
}

async function main() {
  const model = resolveChatModel();
  console.log(`Provider: gemini (REAL, metered) · model: ${model}`);
  console.log(`Session subject: ${SUBJECT} · drill-down target: ${DRILLDOWN_TARGET} · casual target: ${CASUAL_TARGET}\n`);

  const unitsStart = await unitsSoFar(model);
  const ref = { id: await newUser() };
  const { server, base } = bootApp(ref);

  try {
    // ── Open the session on SUBJECT (grounded opening — 1 generation) ──
    const t0 = new Date();
    const opened = await withRetry(
      "open",
      () => api(base, "POST", "/chat/sessions", {
        surface: "stock_health",
        subject: { kind: "stock", symbol: SUBJECT, name: "ABB India Ltd" },
        label: "Discuss this read",
      }),
      (r) => !!r.json?.data?.session?.id,
    );
    const sessionId: string = opened.json?.data?.session?.id;
    if (!sessionId) throw new Error(`could not open a session: ${JSON.stringify(opened.json).slice(0, 300)}`);
    console.log(`✔ session opened on ${SUBJECT} (${sessionId.slice(0, 8)}…)`);

    // ══ TURN 1 — THE DRILL-DOWN ══
    const t1 = new Date();
    const r1 = await withRetry("turn1", () => api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: DRILLDOWN_Q }), (r) => !!r.json?.data?.reply);
    const rows1 = await dumpTurn(sessionId, t1, `═══ TURN 1 · DRILL-DOWN (about ${DRILLDOWN_TARGET}, NOT the session subject) ═══`);
    const calls1 = factsCalls(rows1);
    console.log(`  getStockFacts calls this turn: ${calls1.length ? JSON.stringify(calls1) : "none"}`);
    console.log(`  ★ full=true passed? ${calls1.some((c) => c.full === true) ? "YES" : "NO"}`);
    if (!r1.json?.data?.reply) console.log(`  (no reply — payload: ${JSON.stringify(r1.json).slice(0, 200)})`);

    // ══ TURN 2 — THE CASUAL QUESTION (reverse check) ══
    const t2 = new Date();
    const r2 = await withRetry("turn2", () => api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: CASUAL_Q }), (r) => !!r.json?.data?.reply);
    const rows2 = await dumpTurn(sessionId, t2, `═══ TURN 2 · CASUAL (about ${CASUAL_TARGET}) — expect NO full=true ═══`);
    const calls2 = factsCalls(rows2);
    console.log(`  getStockFacts calls this turn: ${calls2.length ? JSON.stringify(calls2) : "none"}`);
    console.log(`  ★ full=true passed? ${calls2.some((c) => c.full === true) ? "YES (unexpected — expensive path on a casual question)" : "NO (correct)"}`);
    if (!r2.json?.data?.reply) console.log(`  (no reply — payload: ${JSON.stringify(r2.json).slice(0, 200)})`);

    // ══ COST ══
    const unitsEnd = await unitsSoFar(model);
    const all = await prisma.chatMessage.findMany({ where: { sessionId }, select: { promptTokens: true, outputTokens: true } });
    const prompt = all.reduce((n, m) => n + (m.promptTokens ?? 0), 0);
    const output = all.reduce((n, m) => n + (m.outputTokens ?? 0), 0);
    console.log(`\n═══ COST ═══`);
    console.log(`  units consumed (real Gemini calls, off ai_usage_counters): ${unitsEnd - unitsStart}`);
    console.log(`  provider-reported tokens across the session: prompt ${prompt}, output ${output}`);
  } finally {
    server.close();
    if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds);
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
