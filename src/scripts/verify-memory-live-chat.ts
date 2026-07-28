// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// USER-DIRECTED MEMORY + THE LANGUAGE-MIRROR FIX — THE LIVE CHECKS.
//
// ⚠ REAL GEMINI CALLS. Opt-in: MEM_LIVE=1.
//
//   1. ★ MIRRORING IN ONE SESSION — Hinglish turn → Hinglish, then an English turn → ENGLISH.
//      This is the measured bug: history mass was outvoting the mirror clause.
//   2. "Remember I prefer detailed explanations" → proposes → confirm → stored
//   3. "What do you remember about me?" → lists it, and distinguishes stated from inferred
//   4. "Forget the one about explanations" → removed, and the reply says so
//   5. "Remember I'm saving for my daughter's wedding" → DECLINED, nothing stored
//   6. Ambiguous forget → asks which
//   7. The cap → adding at 20 asks the reader to remove one
//
//   MEM_LIVE=1 npx tsx src/scripts/verify-memory-live-chat.ts
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { createThrowawayUser, cleanupThrowawayUsers } from "./lib/throwaway-user.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { resolveChatModel } from "../chat/config.js";
import { listMemories, MEMORY_MAX } from "../chat/memory.js";
import { detectReaderRegister } from "../chat/voice.js";
import type { AiToolCall } from "../ai/types.js";

if (process.env.MEM_LIVE !== "1") { console.log("SKIPPED — real model calls. Run with MEM_LIVE=1."); process.exit(0); }

let failures = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
const note = (n: string, d: string) => console.log(`  ·  ${n} — ${d}`);
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);
const verbatim = (l: string, s: string) =>
  console.log(`\n  ┌─ ${l} ${"─".repeat(Math.max(0, 92 - l.length))}\n${s.split("\n").map((x) => `  │ ${x}`).join("\n")}\n  └${"─".repeat(95)}`);

// ⚠ ASSERT WITH THE PRODUCTION DETECTOR, NOT A LOCAL WORD LIST. A first pass used a hand-written list of
// 20 markers and PASSED a reply of "Aapka naam Arman hai." as English, because "aapka"/"naam" were not in
// it. A test whose vocabulary is narrower than the thing it checks reports success it has not earned.
const registerOf = (s: string) => detectReaderRegister(s);

async function main() {
  console.log(`\n★ MEMORY + MIRRORING — LIVE (model: ${resolveChatModel()})`);
  const { authId, userId } = await createThrowawayUser("mem");
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

  /** Open one session and return a `say` bound to it, so multi-turn tests share history. */
  const session = async () => {
    const opened = await call("/chat/sessions", { origin: "chat_page" });
    const sid = opened?.data?.session?.id as string;
    // ⚠ EVERY READ IS SCOPED TO THIS TURN, AND A DEAD TURN IS RE-SENT. A turn that fails upstream (a 503,
    // a socket reset) persists no new assistant row, and "the last assistant text in this session" then
    // hands back the PREVIOUS turn's reply — which reads as a plausible answer and gets scored as one.
    // Measured: a 503 was reported as the model repeating its own proposal, and three dead turns were
    // reported green because every negative assertion is satisfied by an empty string.
    const say = async (message: string) => {
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

  try {
    // ── 1 ────────────────────────────────────────────────────────────────────────────────────────
    rule("LIVE 1 — ★ MIRRORING WITHIN ONE SESSION: Hinglish → Hinglish, then English → ENGLISH");
    const s1 = await session();
    const a = await s1.say("HDFC Bank ka health score kaisa hai? mujhe samjhao");
    verbatim("TURN 1 (Hinglish): HDFC Bank ka health score kaisa hai?", a.reply.slice(0, 460));
    ok("turn 1 answered in Hinglish", registerOf(a.reply) === "hi", `detected "${registerOf(a.reply)}"`);
    const b = await s1.say("what is my name?");
    verbatim("TURN 2 (English, SAME session): what is my name?", b.reply);
    ok("★ turn 2 answered in ENGLISH — history no longer outvotes the current message", registerOf(b.reply) === "en", `detected "${registerOf(b.reply)}"`);
    ok("…and it knows the name", /Arman/.test(b.reply), /Arman/.test(b.reply) ? "used it" : "did NOT");
    note("per-turn directive", `turn 2 detected as "${detectReaderRegister("what is my name?")}"`);

    // ── 2 ────────────────────────────────────────────────────────────────────────────────────────
    rule("LIVE 2 — \"Remember I prefer detailed explanations\" → propose → confirm → stored");
    const s2 = await session();
    const p = await s2.say("Remember that I prefer detailed explanations");
    verbatim("ASKED: Remember that I prefer detailed explanations", p.reply);
    ok("rememberThis was called", p.tools.includes("rememberThis"), p.tools.join(",") || "no tools");
    ok("it PROPOSED (nothing stored yet)", (await listMemories(userId)).filter((m) => m.source === "stated").length === 0, "store still empty");
    const c = await s2.say("yes");
    verbatim("ASKED: yes", c.reply);
    ok("confirmPendingAction executed it", c.tools.includes("confirmPendingAction"), c.tools.join(","));
    const stored = (await listMemories(userId)).filter((m) => m.source === "stated");
    ok("★ it is now stored", stored.length === 1, stored.map((m) => `"${m.text}"`).join(", ") || "NOTHING STORED");

    // ── 5 (before listing, so the list has only the legitimate one) ───────────────────────────────
    rule("LIVE 5 — \"Remember I'm saving for my daughter's wedding\" → DECLINED, nothing stored");
    const s5 = await session();
    const d = await s5.say("Remember I'm saving for my daughter's wedding");
    verbatim("ASKED: Remember I'm saving for my daughter's wedding", d.reply);
    const afterDecline = (await listMemories(userId)).filter((m) => m.source === "stated");
    ok("★ NOTHING was stored", afterDecline.length === 1 && !/wedding|daughter/i.test(JSON.stringify(afterDecline)), `${afterDecline.length} stored: ${afterDecline.map((m) => m.text).join(" | ")}`);
    ok("the reply declines rather than confirming", !/I'?ll remember that you'?re saving/i.test(d.reply));
    ok("it explains what it CAN remember instead", /explain|explanation|detail/i.test(d.reply), "offers the storable framing");

    // ── 3 ────────────────────────────────────────────────────────────────────────────────────────
    rule("LIVE 3 — \"What do you remember about me?\" → lists it, stated vs inferred distinguished");
    // Give the reader an INFERRED entry too, so the distinction has something to distinguish.
    await prisma.chatReaderProfile.upsert({ where: { userId }, create: { userId, preferredRegister: "hi-latin", registerSessionCount: 2 }, update: { preferredRegister: "hi-latin", registerSessionCount: 2 } });
    const s3 = await session();
    const l = await s3.say("What do you remember about me?");
    verbatim("ASKED: What do you remember about me?", l.reply);
    ok("listMemories was called", l.tools.includes("listMemories"), l.tools.join(","));
    ok("it mentions the stated memory", /detailed explanation/i.test(l.reply));
    ok("★ it distinguishes inferred from stated", /work(ed)? out|noticed|inferred|from how you|picked up|based on/i.test(l.reply), "provenance stated");

    // ── 6 ────────────────────────────────────────────────────────────────────────────────────────
    rule("LIVE 6 — ambiguous forget → asks which, does NOT guess");
    await prisma.chatReaderProfile.upsert({
      where: { userId },
      create: { userId, statedMemories: [] as unknown as object[] },
      update: { statedMemories: [
        { id: "amb-1", text: "prefers detailed explanations of the pillars", source: "stated", createdAt: new Date().toISOString() },
        { id: "amb-2", text: "prefers detailed explanations of the findings", source: "stated", createdAt: new Date().toISOString() },
      ] as unknown as object[] },
    });
    const s6 = await session();
    const amb = await s6.say("forget the one about detailed explanations");
    verbatim("ASKED: forget the one about detailed explanations", amb.reply);
    const still = (await listMemories(userId)).filter((m) => m.source === "stated" && m.id.startsWith("amb-"));
    ok("★ NOTHING was deleted on an ambiguous reference", still.length === 2, `${still.length} of 2 remain`);
    ok("the reply asks which one", /which|pillars|findings/i.test(amb.reply));

    // ── 4 ────────────────────────────────────────────────────────────────────────────────────────
    rule("LIVE 4 — \"Forget the one about the pillars\" → removed, and the reply says so");
    const s4 = await session();
    const fg = await s4.say("forget the one about the pillars");
    verbatim("ASKED: forget the one about the pillars", fg.reply);
    ok("forgetMemory was called", fg.tools.includes("forgetMemory"), fg.tools.join(","));
    const left = (await listMemories(userId)).filter((m) => m.id.startsWith("amb-"));
    ok("★ exactly the named one was removed", left.length === 1 && left[0].id === "amb-2", left.map((m) => m.id).join(","));
    ok("the reply confirms the removal", /forgot|forgotten|removed|no longer/i.test(fg.reply));

    // ── 7 ────────────────────────────────────────────────────────────────────────────────────────
    rule(`LIVE 7 — the ${MEMORY_MAX}-memory cap → adding asks the reader to remove one`);
    await prisma.chatReaderProfile.upsert({
      where: { userId },
      create: { userId },
      update: { statedMemories: Array.from({ length: MEMORY_MAX }, (_, i) => ({ id: `cap-${i}`, text: `filler preference number ${i}`, source: "stated", createdAt: new Date().toISOString() })) as unknown as object[] },
    });
    // ⚠ THE PHRASING WAS CHANGED, AND NOT TO MAKE THE TEST PASS. This asked "Remember that I like short
    // answers", which the model answers by simply COMPLYING — "Got it, I'll keep my answers short" — without
    // calling rememberThis at all. Measured over a 6-run matrix: that sentence misses the tool whether the
    // list is FULL or EMPTY, while "prefers detailed explanations" and "already understands options" hit it
    // in both states. So the miss is a tool-selection problem with that one sentence and has nothing to do
    // with the cap — but it meant this test could never reach the cap path it exists to check, and reported
    // a cap failure for a reason that was not the cap. A phrasing that describes a STANDING FACT about the
    // reader, rather than an instruction obeyable in the same breath, actually exercises the ceiling.
    // (The tool-selection miss is real and is tracked separately; it is not this test's subject.)
    const s7 = await session();
    const CAP_ASK = "Remember that I already understand options";
    const cap = await s7.say(CAP_ASK);
    verbatim(`ASKED (at the cap): ${CAP_ASK}`, cap.reply);
    const capCount = (await listMemories(userId)).filter((m) => m.source === "stated" && m.id.startsWith("cap-")).length;
    ok(`★ still exactly ${MEMORY_MAX} — nothing was silently evicted`, capCount === MEMORY_MAX, `${capCount} stored`);
    ok("rememberThis was called — the cap is reached through the tool, not guessed at", cap.tools.includes("rememberThis"), cap.tools.join(",") || "no tools");
    // ★ THE REGRESSION THIS LINE GUARDS. With MEMORY_MAX=30 against a SQL CHECK of 20, seeding the cap blew
    // up with a 23514 constraint violation before the model was ever asked — the friendly refusal was
    // unreachable because the DATABASE refused first.
    ok("the reply says the list is full and asks to remove one", /full|maximum|limit|remove|forget/i.test(cap.reply));

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
