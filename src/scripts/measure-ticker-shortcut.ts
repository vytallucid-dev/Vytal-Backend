// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT: does an EXACT TICKER now skip searchStocks and hit the stock tool directly?
//
// ⚠ REAL, PAID GEMINI CALLS. Changes nothing — one fresh session, one question, report what happened.
//
// Before the description fix the model called searchStocks even for a bare ticker, costing an extra
// generation (≈1 quota unit + ~11k prompt tokens) on every such turn. searchStocks now carries:
//   "If the reader already gave an exact ticker (all-caps, no spaces, e.g. ACC or HDFCBANK), skip this
//    and call the stock tool directly."
// This confirms the steering landed AND that the answer is still correct.
//
//   npx tsx src/scripts/measure-ticker-shortcut.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";

process.env.AI_PROVIDER = "gemini"; // real provider + real metering (see measure-full-drilldown.ts)

const { prisma } = await import("../db/prisma.js");
const { meChatRouter } = await import("../routes/me-chat-routes.js");
const { resolveChatModel } = await import("../chat/config.js");

const SUBJECT = "ABB"; // session opened here
const TARGET = "ACC"; // asked about by EXACT TICKER — searchStocks should be skipped
const QUESTION = `How is ${TARGET}'s health?`;

const tok = (s: string) => Math.ceil(s.length / 4);

const authIds: string[] = [];
async function newUser(): Promise<string> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `tick-${authId}@test.local`);
  authIds.push(authId);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error("signup trigger did not seed public.users");
  return u.id;
}
async function api(base: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + "/api/v1/me" + path, {
    method, headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: JSON.parse(await res.text()) as any };
}
async function unitsSoFar(model: string): Promise<number> {
  const r = await prisma.aiUsageCounter.findMany({ where: { scope: model }, select: { callCount: true }, orderBy: { windowKey: "desc" }, take: 1 });
  return r[0]?.callCount ?? 0;
}
async function withRetry<T>(fn: () => Promise<T>, check: (r: T) => boolean, attempts = 3): Promise<T> {
  let last!: T;
  for (let i = 1; i <= attempts; i++) {
    last = await fn();
    if (check(last)) return last;
    console.log(`   (attempt ${i} unusable — retrying)`);
  }
  return last;
}

async function main() {
  const model = resolveChatModel();
  console.log(`Provider: gemini (REAL, metered) · model: ${model}`);
  console.log(`Session subject: ${SUBJECT} · asked about: ${TARGET} (EXACT TICKER)\n`);

  const unitsStart = await unitsSoFar(model);
  const ref = { id: await newUser() };
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1/me", (req, _res, next) => {
    (req as express.Request).authUser = { userId: ref.id, authUserId: "auth-" + ref.id, email: "t@test.local", role: "user" };
    next();
  }, meChatRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const opened = await withRetry(
      () => api(base, "POST", "/chat/sessions", {
        surface: "stock_health",
        subject: { kind: "stock", symbol: SUBJECT, name: "ABB India Ltd" },
        label: "Discuss this read",
      }),
      (r) => !!r.json?.data?.session?.id,
    );
    const sessionId: string = opened.json?.data?.session?.id;
    if (!sessionId) throw new Error(`could not open session: ${JSON.stringify(opened.json).slice(0, 200)}`);
    console.log(`✔ fresh session opened on ${SUBJECT}\n`);

    const t = new Date();
    const r = await withRetry(() => api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: QUESTION }), (x) => !!x.json?.data?.reply);

    const rows = await prisma.chatMessage.findMany({
      where: { sessionId, createdAt: { gt: t } },
      orderBy: { createdAt: "asc" },
      select: { role: true, kind: true, content: true, toolPayload: true, promptTokens: true, outputTokens: true },
    });

    console.log("─".repeat(78));
    const called: string[] = [];
    for (const row of rows) {
      if (row.kind === "tool_call") {
        for (const c of ((row.toolPayload as any[]) ?? [])) {
          called.push(c.name);
          console.log(`  [hidden] TOOL CALL → ${c.name}(${JSON.stringify(c.args)})`);
        }
        console.log(`     [generation cost: prompt ${row.promptTokens} tok, output ${row.outputTokens} tok]`);
      } else if (row.kind === "tool_result") {
        const p = row.toolPayload as any;
        const out: string = p?.response?.output ?? `ERROR: ${p?.response?.error}`;
        console.log(`  [hidden] TOOL RESULT · ${p?.name} — ${tok(out)} tokens:`);
        console.log(out.split("\n").map((l) => "     │ " + l).join("\n"));
      } else if (row.role === "user") {
        console.log(`  USER: ${row.content}`);
      } else {
        console.log(`  ASSISTANT [prompt ${row.promptTokens} tok, output ${row.outputTokens} tok]:`);
        console.log(row.content.split("\n").map((l) => "     " + l).join("\n"));
      }
    }
    console.log("─".repeat(78));

    const usedSearch = called.includes("searchStocks");
    const usedFacts = called.includes("getStockFacts");
    console.log(`\n  tools called, in order: [${called.join(" → ")}]`);
    console.log(`  ★ searchStocks SKIPPED on an exact ticker? ${usedSearch ? "NO — still called (fix did not land)" : "YES (fix landed)"}`);
    console.log(`  ★ stock tool called directly?              ${usedFacts ? "YES" : "NO"}`);
    console.log(`  ★ round-trips this turn:                   ${rows.filter((x) => x.kind === "tool_call").length} (was 2 before the fix)`);

    const unitsEnd = await unitsSoFar(model);
    console.log(`\n  units consumed this run: ${unitsEnd - unitsStart}`);
  } finally {
    server.close();
    if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds);
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
