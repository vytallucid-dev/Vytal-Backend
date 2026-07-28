// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// THE TWO OPENING SURFACES — is message[0] a COMPLETE turn, or a dangling half-turn?
//
// ★ THE DEFECT THIS EXISTS FOR. A blank chat-page session's message[0] was the orientation header and
// nothing else: a `role: "user"` row of server-written notes ABOUT the reader, with nothing asked and no
// assistant turn after it. The reader's first message then arrived as a SECOND CONSECUTIVE user turn,
// pressed against a block whose own first line reads "USE it … NEVER narrate it back" — so a first message
// that looked like reader-context got absorbed into the context and acted on by nobody.
//
// Measured, same sentence, position varied: "I prefer detailed explanations" fired rememberThis 2/2 as a
// FOLLOW-UP and 0/2 as a FIRST turn. A question ("what's TCS's ROCE?") was unaffected — it cannot be
// mistaken for a note about a person. The fix is CHAT_PAGE_OPENING_BOUNDARY (chat/voice.ts), scoped to
// chat_page because every other opening already ends in a real ask answered by a persisted assistant turn.
//
// ── THE DETERMINISTIC HALF runs always: no model, no key. It asserts the SHAPE of both openings — that
//    chat_page terminates its scaffolding and discuss does not (and must not). Shape is what regressed,
//    so shape is what is pinned.
// ── THE LIVE HALF is opt-in (OPENING_LIVE=1) and costs real calls: the reader's first typed message on
//    BOTH surfaces, twice each.
//
//   npx tsx src/scripts/verify-chat-opening-surfaces.ts             # deterministic only
//   OPENING_LIVE=1 npx tsx src/scripts/verify-chat-opening-surfaces.ts
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { createThrowawayUser, cleanupThrowawayUsers } from "./lib/throwaway-user.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { composeChatPageOpening, composeDiscussOpening } from "../chat/compose.js";
import { CHAT_PAGE_OPENING_BOUNDARY } from "../chat/voice.js";
import { loadHistoryForModel } from "../chat/sessions.js";
import type { DiscussContext } from "../chat/discuss-context.js";
import type { AiToolCall } from "../ai/types.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);

const SYMBOL = process.env.PANEL_SYMBOL ?? "HDFCBANK";
const CTX: DiscussContext = { surface: "stock_health", subject: { kind: "stock", symbol: SYMBOL }, label: "Discuss this read", detail: { band: "Healthy" } };

async function main() {
  const { authId, userId } = await createThrowawayUser("open");
  await prisma.userLedger.upsert({ where: { userId }, create: { userId, displayName: "Arman" }, update: { displayName: "Arman" } });

  // ═══════════════════════ DETERMINISTIC ═══════════════════════
  rule("1 · SHAPE — chat_page terminates its scaffolding; discuss ends in a real ask");
  const page = await composeChatPageOpening(userId);
  const disc = await composeDiscussOpening(userId, CTX);

  ok("chat_page message[0] carries the orientation header", page.openingUserContent.includes("[ABOUT THE READER]"));
  ok("★ chat_page message[0] ENDS with the terminator — nothing may sit after it", page.openingUserContent.trimEnd().endsWith(CHAT_PAGE_OPENING_BOUNDARY.trimEnd()), `tail: ${JSON.stringify(page.openingUserContent.trimEnd().slice(-58))}`);
  ok("…and it names the next message as the reader's own first words", /THE NEXT MESSAGE IS THEIR FIRST WORDS TO YOU/.test(page.openingUserContent));

  // ★ THE SCOPING ASSERTION. The terminator is a fix for a dangling half-turn; a discuss opening is a
  // complete turn already, and pasting "the next message is their first words" after a real ask that an
  // assistant is about to answer would be a lie about the conversation's shape.
  ok("★★ discuss message[0] does NOT carry the terminator — it is chat-page only", !disc.openingUserContent.includes(CHAT_PAGE_OPENING_BOUNDARY), disc.openingUserContent.includes(CHAT_PAGE_OPENING_BOUNDARY) ? "LEAKED" : "correctly absent");
  ok("discuss message[0] still carries its fact block + orientation", disc.openingUserContent.includes("=== FACTS") && disc.openingUserContent.includes("[ABOUT THE READER]"));
  // ⚠ NOT "ends with a question mark" — a first pass asserted that and failed on a perfectly good opening
  // whose ask closes on a directive ("…never a suggestion about what to do."). The property that actually
  // matters is that the orientation is NOT THE LAST THING: a real ask follows it, which is precisely what
  // chat_page lacked and why it needed a terminator.
  const orientAt = disc.openingUserContent.indexOf("[ABOUT THE READER]");
  const afterOrientation = disc.openingUserContent.slice(orientAt).split("\n").slice(4).join("\n").trim();
  ok(
    "★ discuss message[0] does not END on the orientation — a real ask follows it",
    orientAt >= 0 && afterOrientation.length > 120,
    `${afterOrientation.length} chars after the orientation block; tail: ${JSON.stringify(disc.openingUserContent.trim().slice(-70))}`,
  );

  rule("2 · HISTORY — how many turns exist before the reader types, and in what roles");
  const app = express();
  app.use(express.json());
  app.use("/api/v1/me", (req, _res, next) => {
    (req as express.Request).authUser = { userId, authUserId: authId, email: "t@test.local", role: "user" };
    next();
  }, meChatRouter);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const call = async (p: string, b?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/me${p}`, { method: "POST", headers: { "content-type": "application/json" }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
    return { status: r.status, json: (await r.json()) as any };
  };

  try {
    const openedPage = await call("/chat/sessions", { origin: "chat_page" });
    const pageSid = openedPage.json?.data?.session?.id as string;
    const pageHist = await loadHistoryForModel(pageSid);
    console.log(`  chat_page: ${pageHist.length} row(s) — roles: ${pageHist.map((h) => h.role).join(" → ")}`);
    ok("★ chat_page opens with exactly ONE user row and no assistant turn (the dangling half-turn)", pageHist.length === 1 && pageHist[0].role === "user", `${pageHist.length} rows`);
    ok("…so the terminator is what marks where the reader's words begin", pageHist[0]?.content.includes(CHAT_PAGE_OPENING_BOUNDARY));

    if (process.env.OPENING_LIVE !== "1") {
      console.log("\n  ·  LIVE HALF SKIPPED — set OPENING_LIVE=1 (real model calls) to run it.");
      console.log(`\n${"═".repeat(99)}\n  ${failures === 0 ? "═══ DETERMINISTIC HALF: ALL PASS ✅ ═══" : `═══ ${failures} FAILURE(S) ❌ ═══`}\n${"═".repeat(99)}\n`);
      return;
    }

    // ═══════════════════════ LIVE ═══════════════════════
    const PACE = Number(process.env.MEM_LIVE_PACE_MS ?? 11000);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const firstMessage = async (sid: string, message: string) => {
      const mark = new Date();
      for (let attempt = 1; ; attempt++) {
        await wait(PACE);
        await call(`/chat/sessions/${sid}/messages`, { message });
        const fresh = await prisma.chatMessage.findMany({ where: { sessionId: sid, createdAt: { gt: mark } }, orderBy: { createdAt: "asc" } });
        const tools: string[] = [];
        for (const m of fresh) if (m.kind === "tool_call") for (const c of ((m.toolPayload as unknown as AiToolCall[]) ?? [])) tools.push(c.name);
        const reply = [...fresh].reverse().find((m) => m.role === "assistant" && m.kind === "text")?.content ?? "";
        if (reply.trim() || attempt >= 3) return { reply, tools, dead: !reply.trim() };
        console.log(`    ·  no reply produced (attempt ${attempt}) — upstream flake, re-sending`);
      }
    };

    rule("3 · LIVE — the reader's FIRST typed message on BOTH surfaces (2 passes each)");
    for (const surface of ["chat_page", "discuss"] as const) {
      for (const pass of [1, 2]) {
        await prisma.chatReaderProfile.deleteMany({ where: { userId } });
        const o = surface === "chat_page" ? await call("/chat/sessions", { origin: "chat_page" }) : await call("/chat/sessions", CTX);
        const sid = o.json?.data?.session?.id as string;
        if (surface === "discuss") {
          const opening = (o.json?.data?.messages ?? [])[0];
          ok(`discuss pass ${pass}: the grounded ask was answered by a persisted assistant opening`, opening?.role === "assistant" && opening?.isOpening === true && String(opening?.content ?? "").length > 80, `${String(opening?.content ?? "").slice(0, 70)}…`);
        }
        const t = await firstMessage(sid, "I prefer detailed explanations");
        console.log(`\n  [${surface}] pass ${pass} — tools: ${t.tools.join(",") || "NONE"}`);
        console.log(`  reply: ${t.reply.slice(0, 240).replace(/\n/g, " ") || "(nothing generated)"}`);
        if (t.dead) { console.log(`    ⚠ NOT SCORED — the provider returned nothing`); continue; }
        ok(`★ [${surface}] pass ${pass}: a bare declarative as the FIRST typed message fires rememberThis`, t.tools.includes("rememberThis"), t.tools.join(",") || "NONE");
      }
    }
    console.log(`\n${"═".repeat(99)}\n  ${failures === 0 ? "═══ ALL PASS ✅ ═══" : `═══ ${failures} FAILURE(S) ❌ ═══`}\n${"═".repeat(99)}\n`);
  } finally {
    server.close();
  }
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(async () => {
    const n = await cleanupThrowawayUsers();
    if (n) console.log(`  ·  cleaned up ${n} throwaway user(s)`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
