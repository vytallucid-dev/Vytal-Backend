// ─────────────────────────────────────────────────────────────────────────────
// ALERT COVERAGE — LIVE MODEL. ⚠ REAL PAID CALLS. Opt-in: WRITE_TOOLS_LIVE=1.
//
// Three things only a real model can answer:
//   1. A chat-created alert → the response carries `changed:["alerts"]`, the wire signal the navbar
//      bell's refresh hangs off. (The client half — domain → invalidated query keys — is proven
//      deterministically in Vytal-Frontend/lib/api/change-keys.verify.ts; only the browser repaint
//      is beyond a headless run, and that is React's job, not ours.)
//   2. A band alert on an UNSCORED stock → refused, and the model relays it AND offers a price alert.
//   3. "alert me if TCS rises 5%" → the model reaches for thresholdPercent instead of doing the
//      arithmetic itself, and the restatement carries BOTH the percentage and the rupee figure.
//
//   WRITE_TOOLS_LIVE=1 npx tsx src/scripts/verify-alert-coverage-live.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { resolveChatModel } from "../chat/config.js";
import { peekProposal } from "../chat/proposals.js";
import type { AiToolCall } from "../ai/types.js";

if (process.env.WRITE_TOOLS_LIVE !== "1") {
  console.log("SKIPPED — real paid model calls. Run with WRITE_TOOLS_LIVE=1.");
  process.exit(0);
}
let failures = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
const section = (t: string) => console.log(`\n═══════════════ ${t} ═══════════════`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const authIds: string[] = [];
async function main() {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `acov-${authId}@test.local`);
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
  const post = async (path: string, body?: unknown) =>
    (await fetch(`http://127.0.0.1:${port}/api/v1/me${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })).json() as any;

  async function turn(sid: string, message: string) {
    const before = await prisma.chatMessage.count({ where: { sessionId: sid } });
    const res = await post(`/chat/sessions/${sid}/messages`, { message });
    const rows = (await prisma.chatMessage.findMany({ where: { sessionId: sid }, orderBy: { createdAt: "asc" } })).slice(before);
    const calls: { name: string; args: any }[] = [];
    const errs: string[] = [];
    let reply = "";
    for (const m of rows) {
      if (m.kind === "tool_call") for (const c of ((m.toolPayload as unknown as AiToolCall[]) ?? [])) calls.push({ name: c.name, args: c.args });
      else if (m.kind === "tool_result") { const r = m.toolPayload as any; if (r?.response?.error) errs.push(String(r.response.error)); }
      else if (m.role === "assistant") reply = m.content;
    }
    console.log(`\n  READER │ ${message}`);
    for (const c of calls) console.log(`  [called] ${c.name}(${JSON.stringify(c.args)})`);
    for (const e of errs) console.log(`  [tool refused] ${e.slice(0, 200)}…`);
    console.log(`  VYTAL  │ ${reply}`);
    console.log(`  ↳ wire: changed = ${JSON.stringify(res?.data?.changed)}`);
    return { calls, errs, reply, changed: res?.data?.changed as string[] | undefined };
  }
  const newSession = async () => (await post("/chat/sessions", { origin: "chat_page" }))?.data?.session?.id as string;

  console.log(`LIVE — model=${resolveChatModel()}`);
  try {
    // ═══ 1 · the change hint ══════════════════════════════════════════════════
    section("1 · A chat-created alert emits changed:[\"alerts\"] — the bell's refresh signal");
    {
      const s = await newSession();
      const t1 = await turn(s, "alert me if HDFCBANK falls below 1200");
      ok("proposed, not written", (await prisma.alert.count({ where: { userId } })) === 0);
      ok("★ nothing changed yet, so the wire says nothing changed", (t1.changed ?? []).length === 0, JSON.stringify(t1.changed));

      await sleep(5000);
      const t2 = await turn(s, "yes");
      ok("★★ the alert was written", (await prisma.alert.count({ where: { userId } })) === 1);
      ok("★★ the wire carries changed:[\"alerts\"] — what invalidates the bell's queries", (t2.changed ?? []).join() === "alerts", JSON.stringify(t2.changed));
      console.log("     → client maps \"alerts\" → invalidate [\"me\",\"alerts\"] → useAlerts refetches → the bell recomputes its active count.");
    }

    // ═══ 2 · the unscored guard ═══════════════════════════════════════════════
    await sleep(20000);
    section("2 · A band alert on an UNSCORED stock — refused, and a price alert offered");
    {
      const un = await prisma.$queryRawUnsafe<{ symbol: string }[]>(
        `SELECT s.symbol FROM stocks s WHERE NOT EXISTS (SELECT 1 FROM score_snapshots ss WHERE ss.stock_id = s.id) LIMIT 1`,
      );
      const SYM = un[0].symbol;
      const s = await newSession();
      const t = await turn(s, `alert me if ${SYM} drops below Steady`);
      ok("★★ nothing was created", (await prisma.alert.count({ where: { userId } })) === 1, "(the one from section 1)");
      ok("★★ nothing was even proposed", (await peekProposal(s, userId)) === null);
      ok("★ the tool refused with the unscored reason", t.errs.some((e) => /NOT SCORED/.test(e)));
      // ⚠ Detector, not model: the first version missed "doesn't have a health score yet" — the model's
      //   actual (and perfectly clear) phrasing. Match the CLAIM, not one way of wording it.
      ok("★★ the model relays that it isn't scored",
        /(not|isn'?t|no|does\s?n'?t have a?)\s*(health\s*)?scored?|without a (health )?score|no health score/i.test(t.reply),
        t.reply.slice(0, 110));
      ok("★★ …and offers a price alert instead", /price alert/i.test(t.reply));
      ok("no false claim of success", !/\b(i've|i have) (set|created)\b/i.test(t.reply));
    }

    // ═══ 3 · percentage ═══════════════════════════════════════════════════════
    await sleep(20000);
    section("3 · \"alert me if TCS rises 5%\" — both numbers in the restatement");
    {
      const s = await newSession();
      const t = await turn(s, "alert me if TCS rises 5%");
      const pend = await peekProposal(s, userId);
      const price = await prisma.stockPrice.findUnique({ where: { stockId: (await prisma.stock.findUniqueOrThrow({ where: { symbol: "TCS" }, select: { id: true } })).id }, select: { price: true } });
      const current = price ? Number(price.price) : null;
      const expected = current != null ? Number((current * 1.05).toFixed(2)) : null;

      ok("★★ the model used thresholdPercent (it did NOT do the arithmetic itself)",
        t.calls.some((c) => c.name === "createAlert" && c.args?.thresholdPercent === 5),
        JSON.stringify(t.calls.find((c) => c.name === "createAlert")?.args));
      ok("★★ the server resolved it to current × 1.05", !!pend && Number((pend.args as any).threshold) === expected,
        `current ${current} → stored ${(pend?.args as any)?.threshold} (expected ${expected})`);
      ok("★★ the restatement carries the PERCENTAGE", /5\s?%/.test(t.reply), t.reply.slice(0, 120));
      ok("★★ …and the resolved RUPEE figure", expected != null && new RegExp(String(Math.round(expected)).slice(0, 4)).test(t.reply.replace(/,/g, "")));
      ok("★ …and says it does not track the price", /not (follow|track|move)|fixed|does not change/i.test(t.reply), t.reply.slice(-160));
      ok("nothing written (still just the section-1 alert)", (await prisma.alert.count({ where: { userId } })) === 1);
    }

    const units = (await prisma.aiUsageCounter.findMany({ where: { scope: { startsWith: `user:${userId}:` } }, select: { callCount: true } }))
      .reduce((n, r) => n + r.callCount, 0);
    console.log(`\n  UNITS SPENT: ${units}`);
  } finally {
    server.close();
  }
  console.log(`${failures === 0 ? "\n═══ LIVE COVERAGE PASSED ✅ ═══" : `\n═══ ${failures} FAILURE(S) ❌ ═══`}`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds);
    await prisma.$disconnect();
  });
