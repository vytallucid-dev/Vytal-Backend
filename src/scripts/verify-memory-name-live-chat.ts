// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SELF-NAMING CARVE-OUT — THE LIVE CHECKS.
//
// ⚠ REAL GEMINI CALLS. Opt-in: MEM_LIVE=1.
//
// The bug this proves fixed: "my name is Arman but I want you to call me Ronaldo from now" was answered
// with "I can't save your name — rules prevent me from holding personal details like names", which was
// false on its face (the account name is injected into every session and the assistant had just used it),
// and was followed by an offer to remember something the reader never mentioned.
//
//   1. "Call me Ronaldo"            → PROPOSES the form of address → confirm → stored on stated_name
//   2. a greeting in a NEW session  → uses RONALDO, not the account name
//   3. "What's my name?"            → answers Ronaldo
//   4. "Remember I'm saving for a house"    → still DECLINED, and NO substitute memory is proposed
//   5. "Remember my wife's name is Priya"   → still DECLINED (a third party's name is not the reader's)
//
//   MEM_LIVE=1 npx tsx src/scripts/verify-memory-name-live-chat.ts
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { createThrowawayUser, cleanupThrowawayUsers } from "./lib/throwaway-user.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { resolveChatModel } from "../chat/config.js";
import { listMemories } from "../chat/memory.js";
import { peekProposal } from "../chat/proposals.js";
import type { AiToolCall } from "../ai/types.js";

if (process.env.MEM_LIVE !== "1") { console.log("SKIPPED — real model calls. Run with MEM_LIVE=1."); process.exit(0); }

let failures = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);
const verbatim = (l: string, s: string) =>
  console.log(`\n  ┌─ ${l} ${"─".repeat(Math.max(0, 92 - l.length))}\n${s.split("\n").map((x) => `  │ ${x}`).join("\n")}\n  └${"─".repeat(95)}`);

/** ★ THE DECLINE-THEN-SUBSTITUTE DETECTOR. The failure is not the refusal — it is the unrequested offer
 *  that followed it. These are the shapes that offer holds a memory the reader never asked for. */
const SUBSTITUTE_OFFER =
  /\b(?:would you like|shall i|want me to|should i|can i|i could|happy to)\b[^.?!]{0,80}\b(?:remember|note|keep in mind|store)\b/i;

/** An actual refusal TO STORE. ⚠ Not a bare "cannot": the non-advisory spine puts "I cannot offer advice
 *  on which stocks to buy" in almost every reply, and a bare negation matched THAT — scoring a turn that
 *  never refused anything as a clean decline. The verb has to be a memory verb. */
const REFUSAL =
  /\b(?:can'?t|cannot|can not|won'?t|will not|not able to|unable to|don'?t|do not|isn'?t|is not)\b[^.!?]{0,60}\b(?:remember|store|storing|keep|keeping|hold|holding|record|recording|save|saving that|retain)\b|\b(?:isn'?t|is not|not)\s+something\s+(?:Vytal|I)\b/i;

async function main() {
  console.log(`\n★ SELF-NAMING CARVE-OUT — LIVE (model: ${resolveChatModel()})`);
  const { authId, userId } = await createThrowawayUser("name");
  await prisma.userLedger.upsert({ where: { userId }, create: { userId, displayName: "Arman" }, update: { displayName: "Arman" } });

  const app = express();
  app.use(express.json());
  app.use("/api/v1/me", (req, _res, next) => {
    (req as express.Request).authUser = { userId, authUserId: authId, email: "t@test.local", role: "user" };
    next();
  }, meChatRouter);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const call = async (p: string, b?: unknown) =>
    (await fetch(`http://127.0.0.1:${port}/api/v1/me${p}`, { method: "POST", headers: { "content-type": "application/json" }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) })).json() as any;

  const PACE = Number(process.env.MEM_LIVE_PACE_MS ?? 9000);
  let first = true;
  const pace = async () => { if (first) { first = false; return; } await new Promise((r) => setTimeout(r, PACE)); };

  const session = async () => {
    const opened = await call("/chat/sessions", { origin: "chat_page" });
    const sid = opened?.data?.session?.id as string;
    // ⚠ A BLANK REPLY IS A PROVIDER FLAKE, NOT AN OBSERVATION — and it silently PASSES every negative
    // assertion in this file ("nothing was stored", "no substitute offered"). Measured: one run reported
    // green on three turns that had all failed upstream, and a later run reported a behavioural failure
    // that was really a 503. So a blank turn is re-sent rather than scored; only a real reply is asserted on.
    const say = async (message: string) => {
      // ⚠ THE MARK. A turn that DIES upstream persists no new assistant row, and "the last assistant text
      // in this session" then returns the PREVIOUS turn's reply — which reads as a plausible answer and is
      // scored as one. Measured: a 503 on the "yes" turn was reported as the model repeating its proposal.
      // So every read is scoped to rows created after the send, and a turn that produced none is a flake.
      const mark = new Date();
      for (let attempt = 1; ; attempt++) {
        await pace();
        await call(`/chat/sessions/${sid}/messages`, { message });
        const fresh = await prisma.chatMessage.findMany({ where: { sessionId: sid, createdAt: { gt: mark } }, orderBy: { createdAt: "asc" } });
        const tools: string[] = [];
        for (const m of fresh) if (m.kind === "tool_call") for (const c of ((m.toolPayload as unknown as AiToolCall[]) ?? [])) tools.push(c.name);
        const reply = [...fresh].reverse().find((m) => m.role === "assistant" && m.kind === "text")?.content ?? "";
        if (reply.trim() || attempt >= 3) {
          if (!reply.trim()) console.log(`  ⚠ the model returned nothing after ${attempt} attempts — the checks below are NOT meaningful`);
          return { reply, tools };
        }
        console.log(`  ·  no reply produced (attempt ${attempt}) — upstream flake, re-sending`);
      }
    };
    return { sid, say };
  };

  const nameNow = async () => (await prisma.chatReaderProfile.findUnique({ where: { userId }, select: { statedName: true } }))?.statedName ?? null;

  try {
    // ── 1 ────────────────────────────────────────────────────────────────────────────────────────
    rule("LIVE 1 — \"Call me Ronaldo\" → proposes the form of address → confirm → stored");
    const s1 = await session();
    const p = await s1.say("my name is Arman but I want you to call me Ronaldo from now");
    verbatim("ASKED: my name is Arman but I want you to call me Ronaldo from now", p.reply);
    ok("★ rememberThis was CALLED — not refused conversationally", p.tools.includes("rememberThis"), p.tools.join(",") || "no tools");
    ok("the reply does not claim names cannot be held", !/can'?t (?:save|remember|store|hold|keep)[^.]{0,40}name|rules prevent|not able to (?:remember|store) (?:your )?name/i.test(p.reply));
    ok("it PROPOSED (nothing stored yet)", (await nameNow()) === null, `stated_name = ${JSON.stringify(await nameNow())}`);
    ok("the proposal restates the name it would use", /Ronaldo/.test(p.reply));

    const c = await s1.say("yes");
    verbatim("ASKED: yes", c.reply);
    ok("confirmPendingAction executed it", c.tools.includes("confirmPendingAction"), c.tools.join(","));
    ok("★ stated_name is now Ronaldo", (await nameNow()) === "Ronaldo", `stated_name = ${JSON.stringify(await nameNow())}`);
    const entries = await listMemories(userId);
    ok("…and it shows up in what the assistant remembers", entries.some((e) => e.id === "inferred:name" && /Ronaldo/.test(e.text)), entries.map((e) => e.text).join(" | ") || "empty");
    ok("…without consuming an explanation-preference slot", entries.filter((e) => e.source === "stated" && !e.id.startsWith("inferred:")).length === 0, "the 30-item list is untouched");

    // ── 2 ────────────────────────────────────────────────────────────────────────────────────────
    rule("LIVE 2 — a greeting in a NEW session uses RONALDO, not the account name");
    const s2 = await session();
    const g = await s2.say("hey, good morning");
    verbatim("ASKED (new session): hey, good morning", g.reply);
    ok("★ the reply greets them as Ronaldo", /Ronaldo/i.test(g.reply), /Arman/i.test(g.reply) ? "used ARMAN instead" : "no name used at all");
    ok("…and does not use the account name instead", !/\bArman\b/.test(g.reply));

    // ── 3 ────────────────────────────────────────────────────────────────────────────────────────
    rule("LIVE 3 — \"What's my name?\" → answers correctly");
    const s3 = await session();
    const w = await s3.say("what's my name?");
    verbatim("ASKED: what's my name?", w.reply);
    ok("★ it answers Ronaldo", /Ronaldo/i.test(w.reply));
    ok("it does not deny knowing the name", !/(?:don'?t|do not|can'?t|cannot)\s+(?:know|remember|have)[^.]{0,30}name/i.test(w.reply));

    // ── 4 ────────────────────────────────────────────────────────────────────────────────────────
    rule("LIVE 4 — \"Remember I'm saving for a house\" → still DECLINED, and NO substitute proposed");
    const s4 = await session();
    const d = await s4.say("Remember I'm saving for a house");
    verbatim("ASKED: Remember I'm saving for a house", d.reply);
    const stated4 = (await listMemories(userId)).filter((m) => m.source === "stated" && !m.id.startsWith("inferred:"));
    ok("★ NOTHING was stored", stated4.length === 0 && !/house|saving/i.test(JSON.stringify(stated4)), `${stated4.length} stored: ${stated4.map((m) => m.text).join(" | ")}`);
    ok("it does not claim to have remembered it", !/I'?ll remember that you'?re saving|\bnoted\b|I'?ve (?:saved|stored|remembered)/i.test(d.reply));
    // ⚠ A POSITIVE ASSERTION, DELIBERATELY. A first pass checked only that the reply did not CONFIRM, and
    // passed on a turn where the model never called the tool at all and simply pivoted to stock talk —
    // "nothing was stored" is true there, and the reader is still left not knowing they were refused.
    ok("★ the reply actually REFUSES — the reader is told it cannot be kept", REFUSAL.test(d.reply), REFUSAL.exec(d.reply)?.[0] ?? "NO REFUSAL — it pivoted instead");
    ok("★★ NO SUBSTITUTE MEMORY IS OFFERED", !SUBSTITUTE_OFFER.test(d.reply), SUBSTITUTE_OFFER.exec(d.reply)?.[0] ?? "no offer");
    const pending4 = await peekProposal(s4.sid, userId);
    ok("…and no proposal is left hanging", pending4 === null, pending4 ? `pending: ${pending4.kind} — ${pending4.summary}` : "none");

    // ── 5 ────────────────────────────────────────────────────────────────────────────────────────
    rule("LIVE 5 — \"Remember my wife's name is Priya\" → still DECLINED (a third party's name)");
    const s5 = await session();
    const t = await s5.say("Remember my wife's name is Priya");
    verbatim("ASKED: Remember my wife's name is Priya", t.reply);
    ok("★ stated_name is UNCHANGED — Priya did not overwrite Ronaldo", (await nameNow()) === "Ronaldo", `stated_name = ${JSON.stringify(await nameNow())}`);
    const stated5 = (await listMemories(userId)).filter((m) => m.source === "stated" && !m.id.startsWith("inferred:"));
    ok("★ nothing about Priya was stored", stated5.length === 0 && !/priya|wife/i.test(JSON.stringify(await listMemories(userId))), stated5.map((m) => m.text).join(" | ") || "list empty");
    ok("★★ NO SUBSTITUTE MEMORY IS OFFERED", !SUBSTITUTE_OFFER.test(t.reply), SUBSTITUTE_OFFER.exec(t.reply)?.[0] ?? "no offer");

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
