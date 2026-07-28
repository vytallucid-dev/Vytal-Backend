// ─────────────────────────────────────────────────────────────────────────────
// BARE-TICKER LIVE CHECK — does an exact ticker still detour through searchStocks?
//
// ⚠ REAL, PAID GEMINI CALLS. Opt-in: WRITE_TOOLS_LIVE=1. ONE turn, ~2-3 generations.
//
// THE QUESTION, AND WHY IT IS ONLY ANSWERABLE LIVE. Stage 2 tried a NEGATIVE instruction on
// searchStocks ("if the reader already gave an exact ticker, skip this") and the model kept calling it.
// The fix now under test is the inverse: a POSITIVE instruction on each RECEIVING tool
// (BARE_TICKER_DIRECT in tools/shared.ts) — "that IS the exact symbol: pass it straight to this tool" —
// read at the moment the model is deciding to call that tool. searchStocks' own wording is UNCHANGED,
// deliberately, so a pass or fail here attributes cleanly to the one change.
//
// The brief's instruction stands: if it still fires, report and STOP. Do not iterate on prompt wording.
//
//   WRITE_TOOLS_LIVE=1 npx tsx src/scripts/verify-bare-ticker-live.ts
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

if (process.env.WRITE_TOOLS_LIVE !== "1") {
  console.log("SKIPPED — real paid model calls. Run with WRITE_TOOLS_LIVE=1.");
  process.exit(0);
}

let failures = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };

const authIds: string[] = [];
async function main() {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `bareticker-${authId}@test.local`);
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

  console.log(`LIVE — model=${resolveChatModel()}`);
  try {
    const opened = await call("/chat/sessions", { origin: "chat_page" });
    const sid = opened?.data?.session?.id;

    // ⚠ THE CONTROL MATTERS MORE THAN THE CASE. Pick a phrasing that DEMONSTRABLY detoured before the
    //   change, or a pass proves nothing. From the earlier live logs, "remind me before ABB's results"
    //   called searchStocks("ABB") before calling setEventReminder; "add ACC to my watchlist" never did.
    //   Overridable so both can be checked.
    const message = process.argv.find((a) => a.startsWith("--message="))?.slice(10) ?? "remind me before ABB's results";
    await call(`/chat/sessions/${sid}/messages`, { message });

    const rows = await prisma.chatMessage.findMany({ where: { sessionId: sid }, orderBy: { createdAt: "asc" } });
    const calls: string[] = [];
    let reply = "";
    for (const m of rows) {
      if (m.kind === "tool_call") for (const c of ((m.toolPayload as unknown as AiToolCall[]) ?? [])) calls.push(c.name);
      else if (m.role === "assistant") reply = m.content;
    }
    console.log(`\n  READER │ ${message}`);
    for (const c of calls) console.log(`  [called] ${c}`);
    console.log(`  VYTAL  │ ${reply}\n`);

    const searched = calls.includes("searchStocks");
    ok("★★ a bare exact ticker did NOT detour through searchStocks", !searched, `tools called: ${calls.join(" → ") || "none"}`);
    ok("a write tool was still called", calls.some((c) => ["addToWatchlist", "setEventReminder", "createAlert", "recordTransaction"].includes(c)));
    ok("the reply is not blank", !isBlankReply(reply));
    ok("nothing was written without confirmation", (await prisma.watchlist.count({ where: { userId } })) === 0 && (await prisma.eventReminder.count({ where: { userId } })) === 0);
    console.log(searched
      ? "\n  → STILL FIRES. Reporting and stopping, per instruction — no further prompt iteration."
      : "\n  → The receiving-tool wording worked: one round saved on every write turn that names a ticker.");

    const units = (await prisma.aiUsageCounter.findMany({ where: { scope: { startsWith: `user:${userId}:` } }, select: { callCount: true } }))
      .reduce((n, r) => n + r.callCount, 0);
    console.log(`  UNITS SPENT: ${units}`);
  } finally {
    server.close();
  }
  if (failures) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds);
    await prisma.$disconnect();
  });
