// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// INSTRUCTION-SHAPED PREFERENCES — OBEY *AND* STORE. THE LIVE CHECKS.
//
// ⚠ REAL GEMINI CALLS. Opt-in: MEM_LIVE=1.
//
// The bug: "Remember I like short answers" got "Got it — I'll keep my answers short" and NO tool call,
// while "Remember I prefer detailed explanations" called rememberThis. Identical whether the memory list
// was full or empty, so it was tool selection: the model can SATISFY an instruction in the same breath,
// so it obeys and considers the turn finished — silently dropping the standing half.
//
// ★ EVERY CASE RUNS TWICE, IN ITS OWN SESSION AND ITS OWN THROWAWAY READER. One pass on a
// non-deterministic model is an anecdote, not a rate; two independent passes is the minimum that can
// distinguish "fixed" from "got lucky". A case that passes once and fails once is REPORTED AS 1/2, never
// rounded up.
//
//   MUST STORE (standing preferences, instruction-shaped — the ones that missed):
//     1. "remember I like short answers"
//     2. "always keep it brief"
//     3. "don't use jargon with me"
//     4. "I prefer detailed explanations"        ← fact-shaped, must NOT regress
//   MUST NOT STORE (the over-fire checks):
//     5. "explain that simply"                   ← momentary: about ONE answer
//     6. "what's TCS's ROCE?"                    ← nowhere near a memory
//   AND:
//     7. when it DOES store, the same reply must also COMPLY — not propose a memory and ignore the ask.
//
//   MEM_LIVE=1 npx tsx src/scripts/verify-memory-instruction-live-chat.ts
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
const ok = (n: string, c: boolean, d = "") => { console.log(`    ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);
const verbatim = (l: string, s: string) =>
  console.log(`\n    ┌─ ${l} ${"─".repeat(Math.max(0, 88 - l.length))}\n${s.split("\n").map((x) => `    │ ${x}`).join("\n")}\n    └${"─".repeat(91)}`);

/** Does the reply actually DO what was asked, as well as proposing to keep it? Checked as "short is
 *  short", not as a phrase match — a model that says "I'll be brief" in 900 characters has not complied. */
const PACE = Number(process.env.MEM_LIVE_PACE_MS ?? 12000);

interface Case {
  key: string;
  ask: string;
  /** true ⇒ a memory MUST be proposed; false ⇒ a memory must NOT be proposed. */
  mustStore: boolean;
  /** Extra per-case check on the reply when it stores (compliance). */
  complies?: (reply: string) => { ok: boolean; detail: string };
  /**
   * ⚠ A TURN SENT FIRST, IN THE SAME SESSION. "Explain that simply" is only MOMENTARY if there is an
   * answer for "that" to refer to. A first pass asked it in a fresh session, where it has no referent at
   * all — the model just described Vytal, and the case passed for the wrong reason. A test for
   * momentary-vs-standing has to actually contain a moment.
   */
  priming?: string;
}

const CASES: Case[] = [
  {
    key: "1 · instruction-shaped: \"remember I like short answers\"",
    ask: "remember I like short answers",
    mustStore: true,
    complies: (r) => ({ ok: r.length <= 600, detail: `${r.length} chars (short means short)` }),
  },
  {
    key: "2 · instruction-shaped: \"always keep it brief\"",
    ask: "always keep it brief",
    mustStore: true,
    complies: (r) => ({ ok: r.length <= 600, detail: `${r.length} chars` }),
  },
  {
    key: "3 · instruction-shaped: \"don't use jargon with me\"",
    ask: "don't use jargon with me",
    mustStore: true,
  },
  {
    // ⚠ THE EXACT BASELINE SENTENCE FROM THE MEASURED MATRIX, prefix and all. A first pass shortened it to
    // a bare "I prefer detailed explanations" and reported a REGRESSION — but that is a different, harder
    // sentence (a bare declarative with no imperative), not the thing that was known to work. A regression
    // guard has to re-run the string that passed, or it is measuring something else and blaming the change.
    key: "4a · fact-shaped REGRESSION GUARD: \"Remember that I prefer detailed explanations\"",
    ask: "Remember that I prefer detailed explanations",
    mustStore: true,
  },
  {
    key: "4b · bare declarative as a FOLLOW-UP turn: \"I prefer detailed explanations\"",
    priming: "What does the Momentum pillar measure?",
    ask: "I prefer detailed explanations",
    mustStore: true,
  },
  {
    // ⚠⚠ KNOWN FAILING — A SEPARATE DEFECT, LEFT RED ON PURPOSE.
    //
    // The same sentence, in the FIRST turn of a fresh session. Measured 2/2 as a follow-up and 0/2 here,
    // so the shape is fine and the POSITION is the problem: on the opening turn the model answers
    // message[0]'s opening ask ("Hello Arman. How can I help you explore Vytal today?") and never engages
    // the reader's sentence AT ALL — it does not even acknowledge it, which is what distinguishes this
    // from the obey-instead-of-store bug this file was written for. No wording of THIS tool's description
    // fixes it; two attempts confirmed that. It lives in the opening composition, it plausibly affects any
    // short first message rather than preferences specifically, and it is out of scope here.
    //
    // It stays in the suite, and stays RED, because a green suite over a known live defect is worse than
    // a red one that names it.
    key: "4c · ⚠ KNOWN FAIL (separate defect): bare declarative as the FIRST turn of a session",
    ask: "I prefer detailed explanations",
    mustStore: true,
  },
  {
    key: "5 · ⚠ MOMENTARY, must NOT store: \"explain that simply\" (after a real answer)",
    priming: "What does the Foundation pillar measure?",
    ask: "explain that simply",
    mustStore: false,
  },
  {
    key: "6 · ⚠ not a preference at all: \"what's TCS's ROCE?\"",
    ask: "what's TCS's ROCE?",
    mustStore: false,
  },
];

async function main() {
  console.log(`\n★ INSTRUCTION-SHAPED PREFERENCES — OBEY *AND* STORE — LIVE (model: ${resolveChatModel()})`);
  console.log(`  every case runs TWICE, each in a fresh session on a fresh reader\n`);
  const { authId, userId } = await createThrowawayUser("instr");
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

  /** One turn in a FRESH session, with the same dead-turn discipline as the other live harnesses:
   *  reads are scoped to rows created after the send, and a turn that produced nothing is re-sent. */
  const turn = async (message: string, priming?: string) => {
    const opened = await call("/chat/sessions", { origin: "chat_page" });
    const sid = opened?.data?.session?.id as string;
    if (priming) {
      await new Promise((r) => setTimeout(r, PACE));
      await call(`/chat/sessions/${sid}/messages`, { message: priming });
    }
    const mark = new Date();
    for (let attempt = 1; ; attempt++) {
      await new Promise((r) => setTimeout(r, PACE));
      await call(`/chat/sessions/${sid}/messages`, { message });
      const fresh = await prisma.chatMessage.findMany({ where: { sessionId: sid, createdAt: { gt: mark } }, orderBy: { createdAt: "asc" } });
      const tools: string[] = [];
      for (const m of fresh) if (m.kind === "tool_call") for (const c of ((m.toolPayload as unknown as AiToolCall[]) ?? [])) tools.push(c.name);
      const reply = [...fresh].reverse().find((m) => m.role === "assistant" && m.kind === "text")?.content ?? "";
      if (reply.trim() || attempt >= 3) {
        if (!reply.trim()) console.log(`    ⚠ nothing generated after ${attempt} attempts — this result is NOT meaningful`);
        return { sid, reply, tools, pending: await peekProposal(sid, userId) };
      }
      console.log(`    ·  no reply produced (attempt ${attempt}) — upstream flake, re-sending`);
    }
  };

  const tally: Record<string, number> = {};
  /** Passes that could not be scored because the provider returned nothing. Never counted as either. */
  const invalid: Record<string, number> = {};

  try {
    for (const c of CASES) {
      rule(`LIVE ${c.key}`);
      for (const pass of [1, 2]) {
        console.log(`\n  ── pass ${pass} of 2 ──`);
        // A clean slate per pass: nothing stored, so "did it store?" is unambiguous.
        await prisma.chatReaderProfile.deleteMany({ where: { userId } });
        const t = await turn(c.ask, c.priming);
        if (c.priming) console.log(`    (primed with: ${JSON.stringify(c.priming)})`);
        verbatim(`ASKED: ${c.ask}`, t.reply);
        const proposed = t.tools.includes("rememberThis") && t.pending?.kind === "rememberThis";
        console.log(`    tools: ${t.tools.join(",") || "NONE"}${t.pending ? `   pending: ${t.pending.kind} → ${JSON.stringify(t.pending.fields?.[0]?.value ?? "")}` : "   pending: none"}`);

        // ⚠⚠ A DEAD TURN IS NEITHER A PASS NOR A FAIL — IT IS NO DATA, AND IT MUST NOT BE SCORED.
        // Measured: a provider outage produced 32 dead turns in one run, and the scorecard came back with
        // every must-STORE case at 0/2 and every must-NOT-STORE case at a clean 2/2 — because "no proposal
        // was made" is trivially true of a reply that never existed, and "the reply is under 600 chars" is
        // trivially true of the empty string. That reads exactly like a behavioural regression and is not
        // one. So a blank turn is counted separately, and a case with ANY blank turn cannot report a score.
        if (!t.reply.trim()) {
          invalid[c.key] = (invalid[c.key] ?? 0) + 1;
          console.log(`    ⚠ SKIPPED — no reply was generated, so nothing below could be asserted honestly`);
          continue;
        }

        if (c.mustStore) {
          ok("rememberThis proposed the preference", proposed, proposed ? "proposal held" : "NO PROPOSAL — obeyed without storing");
          if (proposed) {
            // ★ AND IT MUST ACTUALLY GO IN. Propose → confirm → assert the row, so "it called the tool"
            // can never stand in for "the reader's preference survives this conversation".
            await new Promise((r) => setTimeout(r, PACE));
            await call(`/chat/sessions/${t.sid}/messages`, { message: "yes" });
            const stored = (await listMemories(userId)).filter((m) => m.source === "stated" && !m.id.startsWith("inferred:"));
            ok("…and confirming stores it", stored.length === 1, stored.map((m) => `"${m.text}"`).join(", ") || "NOTHING STORED");
          }
          // 7 · compliance in the SAME reply.
          if (c.complies) {
            const v = c.complies(t.reply);
            ok("★ it also COMPLIES in that same reply — not a proposal that ignores the ask", v.ok, v.detail);
          }
          if (proposed) tally[c.key] = (tally[c.key] ?? 0) + 1;
        } else {
          ok("★ NO memory was proposed", !proposed, proposed ? `OVER-FIRED: ${JSON.stringify(t.pending?.fields?.[0]?.value)}` : "no proposal");
          const stored = (await listMemories(userId)).filter((m) => m.source === "stated" && !m.id.startsWith("inferred:"));
          ok("…and nothing was stored", stored.length === 0, stored.map((m) => m.text).join(" | ") || "empty");
          if (!proposed) tally[c.key] = (tally[c.key] ?? 0) + 1;
        }
      }
    }

    rule("SCORECARD — passes out of 2 per case (a 1/2 is NOT a pass)");
    let deadTurns = 0;
    for (const c of CASES) {
      const n = tally[c.key] ?? 0;
      const bad = invalid[c.key] ?? 0;
      deadTurns += bad;
      const scored = 2 - bad;
      const mark = bad === 2 ? "· " : n === scored && scored > 0 ? "✅" : n === 0 ? "❌" : "⚠ ";
      console.log(`  ${mark} ${n}/${scored}${bad ? `  (${bad} turn(s) NOT SCORED — provider returned nothing)` : ""}  ${c.key}`);
    }
    if (deadTurns) {
      console.log(
        `\n  ⚠⚠ ${deadTurns} turn(s) produced no reply at all. Those are UPSTREAM FAILURES, not results — ` +
          `re-run before drawing any conclusion from this scorecard.`,
      );
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
