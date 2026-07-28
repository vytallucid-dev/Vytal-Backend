// ─────────────────────────────────────────────────────────────────────────────
// getStockNews — THE LIVE CONVERSATION CHECKS. The claims no fixture can settle.
//
// ⚠ REAL PAID GEMINI CALLS + REAL SERPER CREDITS. Opt-in: NEWS_LIVE_CHAT=1. Four turns over real HTTP.
//
// A TOOL DESCRIPTION IS A BEHAVIOURAL CLAIM (registry.ts §2), and this one makes a claim in BOTH
// directions — it must fire when news is RELEVANT, not merely when demanded, and it must NOT fire when
// the fact block already answers. Only a live conversation can settle either, and both failures cost
// money on every future message: a tool that never fires is dead weight, one that always fires spends a
// round and a web call to add noise.
//
//   1. NEWS QUESTION      "any news on Cyient?"          → fires; reply carries sources, relative dates,
//                                                          links, attribution, and the structural disclaimer
//   2. METRIC QUESTION    "what is TCS's ROCE?"          → must NOT fire
//   3. UNEXPLAINED MOVE   "why did HDFC Bank drop…"      → must fire (nothing in Vytal explains a move)
//   4. UNCOVERED SYMBOL   "any news on CYIENTDLM?"       → the coverage boundary, not a guess
//
//   NEWS_LIVE_CHAT=1 npx tsx src/scripts/verify-stock-news-live-chat.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { resolveChatModel } from "../chat/config.js";
import { isBlankReply, EXTERNAL_SOURCE_DISCLAIMER } from "../chat/voice.js";
import type { AiToolCall } from "../ai/types.js";

if (process.env.NEWS_LIVE_CHAT !== "1") {
  console.log("SKIPPED — real paid model calls + Serper credits. Run with NEWS_LIVE_CHAT=1.");
  process.exit(0);
}
// The tool refuses unless this is on; the harness turns it on for its own process so the check does not
// depend on the operator's .env being flipped first.
process.env.AI_CHAT_WEB_SEARCH = "1";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);

const authIds: string[] = [];

async function main() {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `news-${authId}@test.local`);
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

  /** One fresh session, one message; returns the tools called, the delivered reply, and every URL the
   *  TOOL actually returned this turn (recovered from the persisted tool_result payloads). */
  const ask = async (message: string): Promise<{ calls: string[]; reply: string; toolUrls: string[] }> => {
    const opened = await call("/chat/sessions", { origin: "chat_page" });
    const sid = opened?.data?.session?.id;
    await call(`/chat/sessions/${sid}/messages`, { message });
    const rows = await prisma.chatMessage.findMany({ where: { sessionId: sid }, orderBy: { createdAt: "asc" } });
    const calls: string[] = [];
    const toolUrls: string[] = [];
    let reply = "";
    for (const m of rows) {
      if (m.kind === "tool_call") for (const c of ((m.toolPayload as unknown as AiToolCall[]) ?? [])) calls.push(`${c.name}(${JSON.stringify(c.args)})`);
      else if (m.kind === "tool_result") {
        const out = ((m.toolPayload as any)?.response?.output ?? "") as string;
        for (const u of out.match(/https?:\/\/\S+/g) ?? []) toolUrls.push(u.trim());
      } else if (m.role === "assistant") reply = m.content;
    }
    console.log(`\n  READER │ ${message}`);
    for (const c of calls) console.log(`  [called] ${c}`);
    console.log(`  VYTAL  │ ${reply.split("\n").join("\n         │ ")}\n`);
    return { calls, reply, toolUrls };
  };
  const fired = (calls: string[]) => calls.some((c) => c.startsWith("getStockNews"));

  // --only=1,4 re-runs a subset, so iterating on one turn does not re-spend on the others.
  const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim())) : null;
  const run = (n: string) => !only || only.has(n);

  console.log(`LIVE — model=${resolveChatModel()} · AI_CHAT_WEB_SEARCH=${process.env.AI_CHAT_WEB_SEARCH}${only ? ` · turns ${[...only].join(",")}` : ""}`);
  try {
    if (run("1")) {
    rule("1 — A NEWS QUESTION ON A COVERED STOCK");
    const a = await ask("any news on Cyient?");
    ok("★ getStockNews fired", fired(a.calls), a.calls.join(" → ") || "no tools called");
    ok("the reply is not blank", !isBlankReply(a.reply));
    const hasLink = /https?:\/\//.test(a.reply);
    const namesSource = /(moneycontrol|economic times|business standard|mint|ndtv|reuters|pti|scanx|financial express|times of india|fortune|whalesbook|business upturn|cnbc|hindu|deccan|zee|upstox|angel)/i.test(a.reply);
    const relDate = /\b\d+\s+(hour|hours|day|days|minute|minutes|week|weeks)\s+ago\b/i.test(a.reply);
    ok("carries at least one article LINK", hasLink);
    // ★ THE CITATION-INTEGRITY CHECK. A live run produced a google.com/goto redirect that was in NO tool
    //   result — an invented citation. Every URL in the delivered reply must be one the tool returned.
    const replyUrls = (a.reply.match(/https?:\/\/[^\s)\]]+/g) ?? []).map((u) => u.replace(/[.,]+$/, ""));
    const invented = replyUrls.filter((u) => !a.toolUrls.some((t) => t.startsWith(u) || u.startsWith(t)));
    ok("★ EVERY url in the reply came from the tool result (no invented links)", invented.length === 0, invented.join(" ") || `${replyUrls.length} url(s), all verified against ${a.toolUrls.length} tool url(s)`);
    ok("names the SOURCE publication", namesSource);
    ok("states recency as a RELATIVE phrase (never a fabricated date)", relDate);
    ok("does NOT invent a calendar date for an item", !/\b(published|dated)\s+on\s+\d{1,2}\s+\w+\s+20\d\d/i.test(a.reply));
    ok("★ the STRUCTURAL disclaimer is on the delivered reply", a.reply.includes(EXTERNAL_SOURCE_DISCLAIMER));
    ok("the reply attributes rather than asserting flatly (a source is named beside a claim)", namesSource);
    }

    if (run("2")) {
    rule("2 — A METRIC QUESTION MUST *NOT* FIRE IT (the fact block already answers)");
    const b = await ask("what is TCS's ROCE?");
    ok("★ getStockNews did NOT fire", !fired(b.calls), b.calls.join(" → ") || "no tools called");
    ok("…and the question was still answered", !isBlankReply(b.reply));
    ok("no external disclaimer on a reply with no external content", !b.reply.includes(EXTERNAL_SOURCE_DISCLAIMER));
    }

    if (run("3")) {
    rule("3 — AN UNEXPLAINED PRICE MOVE MUST FIRE IT (Vytal's own data cannot explain a move)");
    const c = await ask("why did HDFC Bank drop today?");
    ok("★ getStockNews fired", fired(c.calls), c.calls.join(" → ") || "no tools called");
    ok("the reply is not blank", !isBlankReply(c.reply));
    }

    if (run("4")) {
    rule("4 — AN UNCOVERED SYMBOL GETS THE COVERAGE BOUNDARY, NOT A GUESS");
    const d = await ask("any news on CYIENTDLM?");
    const saysBoundary =
      /((is\s?n[o']t|is not|not)\s+(in|part of|within|inside)\s+.{0,40}(cover|universe)|(do(es)?\s+not|do(es)?n'?t)\s+cover|outside .{0,25}(coverage|universe)|not covered)/i.test(d.reply);
    ok("the reply states the coverage boundary honestly", saysBoundary, d.reply.slice(0, 120));
    ok("no headline is invented for an uncovered name", !/https?:\/\//.test(d.reply));
    }

    const units = (await prisma.aiUsageCounter.findMany({ where: { scope: { startsWith: `user:${userId}:` } }, select: { callCount: true } }))
      .reduce((n, r) => n + r.callCount, 0);
    console.log(`\n  GEMINI UNITS SPENT: ${units}`);
    const key = (process.env.SERPER_API_KEY ?? "").trim();
    if (key) {
      const acct = (await (await fetch("https://google.serper.dev/account", { headers: { "X-API-KEY": key } })).json()) as { balance: number };
      console.log(`  SERPER BALANCE NOW: ${acct.balance}`);
    }
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
