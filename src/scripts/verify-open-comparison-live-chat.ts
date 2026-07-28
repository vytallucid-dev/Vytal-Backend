// ─────────────────────────────────────────────────────────────────────────────
// openComparison — THE LIVE CONVERSATION CHECKS.
//
// ⚠ REAL PAID GEMINI CALLS. Opt-in: CMP_LIVE_CHAT=1. Four turns over real HTTP.
//
// Three claims here are behavioural and only a live turn can settle them:
//   · the tool fires on a comparison request, and the VERDICT (not the link) leads the answer
//   · the model OFFERS the link and never claims to have opened, loaded or read the page
//   · ★ every /comparison/ link the reader receives was built by the SERVER — asserted against the
//     paths the tool actually returned, recovered from the persisted tool_result payloads. This is the
//     same integrity check getStockNews needed after the model invented a google.com/goto URL.
//
//   CMP_LIVE_CHAT=1 npx tsx src/scripts/verify-open-comparison-live-chat.ts [--only=1,3]
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { resolveChatModel } from "../chat/config.js";
import { isBlankReply } from "../chat/voice.js";
import type { AiToolCall } from "../ai/types.js";

if (process.env.CMP_LIVE_CHAT !== "1") {
  console.log("SKIPPED — real paid model calls. Run with CMP_LIVE_CHAT=1.");
  process.exit(0);
}

let failures = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);

/** Claims of having navigated — the one thing this tool must never let the model say. */
const NAVIGATION_CLAIM =
  /\b(i(?:'ve| have)?\s+(?:just\s+)?(?:opened|loaded|pulled up|brought up|navigated|launched|displayed)|taking you (?:to|there)|i(?:'ve| have)\s+set up the (?:comparison|page)|here is the comparison page showing)\b/i;

const authIds: string[] = [];

async function main() {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `cmp-${authId}@test.local`);
  authIds.push(authId);
  const userId = (await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } })).id;

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

  /** One fresh session, one message → tools called, delivered reply, and the paths the TOOL produced. */
  const ask = async (message: string): Promise<{ calls: string[]; reply: string; toolPaths: string[] }> => {
    const opened = await call("/chat/sessions", { origin: "chat_page" });
    const sid = opened?.data?.session?.id;
    await call(`/chat/sessions/${sid}/messages`, { message });
    const rows = await prisma.chatMessage.findMany({ where: { sessionId: sid }, orderBy: { createdAt: "asc" } });
    const calls: string[] = [];
    const toolPaths: string[] = [];
    let reply = "";
    for (const m of rows) {
      if (m.kind === "tool_call") for (const c of ((m.toolPayload as unknown as AiToolCall[]) ?? [])) calls.push(`${c.name}(${JSON.stringify(c.args)})`);
      else if (m.kind === "tool_result") {
        const out = ((m.toolPayload as any)?.response?.output ?? "") as string;
        for (const p of out.match(/\/comparison\/\S+?(?=[)\s.,]|$)/g) ?? []) toolPaths.push(p);
      } else if (m.role === "assistant") reply = m.content;
    }
    console.log(`\n  READER │ ${message}`);
    for (const c of calls) console.log(`  [called] ${c}`);
    console.log(`  VYTAL  │ ${reply.split("\n").join("\n         │ ")}\n`);
    return { calls, reply, toolPaths };
  };
  const fired = (calls: string[]) => calls.some((c) => c.startsWith("openComparison"));
  /** ★ Every comparison link in the reply must be one the server constructed. */
  const linksAreServerBuilt = (r: { reply: string; toolPaths: string[] }) => {
    const inReply = (r.reply.match(/\/comparison\/[^\s)\]]+/g) ?? []).map((p) => p.replace(/[.,]+$/, ""));
    return { inReply, invented: inReply.filter((p) => !r.toolPaths.includes(p)) };
  };

  const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim())) : null;
  const run = (n: string) => !only || only.has(n);

  console.log(`LIVE — model=${resolveChatModel()}${only ? ` · turns ${[...only].join(",")}` : ""}`);
  try {
    if (run("1")) {
      rule("1 — A SAME-FAMILY COMPARISON REQUEST");
      const a = await ask("Compare TCS and Infosys");
      ok("★ openComparison fired", fired(a.calls), a.calls.join(" → ") || "no tools called");
      ok("the reply is not blank", !isBlankReply(a.reply));
      ok("the reader is offered the comparison link", a.reply.includes("/comparison/TCS-vs-INFY"));
      const l1 = linksAreServerBuilt(a);
      ok("★ every comparison link came from the SERVER (none invented)", l1.invented.length === 0, l1.invented.join(" ") || `${l1.inReply.length} link(s) verified against ${a.toolPaths.length} tool path(s)`);
      ok("★ it does NOT claim to have navigated or opened anything", !NAVIGATION_CLAIM.test(a.reply), (a.reply.match(NAVIGATION_CLAIM) ?? [])[0] ?? "");
      ok("the comparability verdict is surfaced, not just the link", /same (industry )?family|both .{0,30}non-financial|directly comparable|line up/i.test(a.reply));
    }

    if (run("2")) {
      rule("2 — A CROSS-FAMILY PAIR (a bank vs a manufacturer) — the warning must reach the reader");
      const b = await ask("How does HDFC Bank compare with Maruti Suzuki?");
      ok("★ openComparison fired", fired(b.calls), b.calls.join(" → ") || "no tools called");
      ok("★ the cross-family limit is stated to the reader", /different (industry )?famil|only .{0,25}universal|not directly comparable|don'?t line up|do not line up/i.test(b.reply));
      const l2 = linksAreServerBuilt(b);
      ok("★ every comparison link came from the SERVER", l2.invented.length === 0, l2.invented.join(" ") || `${l2.inReply.length} verified`);
      ok("it does NOT claim to have navigated", !NAVIGATION_CLAIM.test(b.reply), (b.reply.match(NAVIGATION_CLAIM) ?? [])[0] ?? "");
    }

    if (run("3")) {
      rule("3 — AN UNCOVERED SYMBOL IN THE PAIR");
      const c = await ask("Compare TCS with Cyient DLM");
      const saysBoundary = /((is\s?n[o']t|is not|not)\s+(in|part of|within|inside)\s+.{0,40}(cover|universe)|(do(es)?\s+not|do(es)?n'?t)\s+cover|outside .{0,25}(coverage|universe)|not covered)/i.test(c.reply);
      ok("the coverage boundary is stated honestly", saysBoundary, c.reply.slice(0, 120));
      ok("★ NO comparison link is offered for an uncovered pair", !/\/comparison\//.test(c.reply), (c.reply.match(/\/comparison\/\S+/) ?? [])[0] ?? "");
    }

    if (run("4")) {
      rule("4 — THE SAME STOCK TWICE");
      const d = await ask("Compare TCS with TCS");
      const refusedInTool = d.calls.some((c) => c.startsWith("openComparison"));
      ok("the turn survives (fail-soft — a refusal never kills the turn)", !isBlankReply(d.reply));
      ok("★ NO comparison link is offered for a self-pair", !/\/comparison\//.test(d.reply), (d.reply.match(/\/comparison\/\S+/) ?? [])[0] ?? "");
      ok("the reply asks for a second company / says it cannot compare a stock with itself",
         /itself|second (company|stock)|another (company|stock)|which .{0,20}compare|two different/i.test(d.reply), d.reply.slice(0, 130));
      console.log(`     (the tool ${refusedInTool ? "WAS called and refused" : "was not called — the model declined on its own"}; either is honest)`);
    }

    const units = (await prisma.aiUsageCounter.findMany({ where: { scope: { startsWith: `user:${userId}:` } }, select: { callCount: true } }))
      .reduce((n, r) => n + r.callCount, 0);
    console.log(`\n  GEMINI UNITS SPENT: ${units}`);
  } finally {
    server.close();
  }
  rule(failures === 0 ? "✅ ALL PASS" : `❌ ${failures} FAILURE(S)`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds);
    await prisma.$disconnect();
  });
