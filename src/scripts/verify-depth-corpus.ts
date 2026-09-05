// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE DEPTH CORPUS — the before/after measurement for the company-answer depth directive, and the
// calibration sample the evaluative tier's promote-to-BLOCK decision is read from.
//
// ★ IT IS RUN TWICE: once BEFORE the directive exists and once AFTER, over the SAME questions with the
// SAME readers. Each run writes a JSON arm file, and `--diff a.json b.json` prints them side by side.
// There is no feature flag: the "before" arm is the shipped code at the moment it runs, which is the
// only arm that cannot be faked by a switch someone forgot to flip.
//
// WHAT IT MEASURES, per turn:
//   · the reply VERBATIM (3a) — plus three mechanical reads of its shape:
//       leadsWithFigure   — does a digit appear in the first sentence?
//       opensWithDefinition — does the first sentence define a term rather than answer?
//       restatesQuestion  — does it open by repeating the question back?
//   · tool rounds and PROMPT TOKENS (3b over-fetch: a directive that buys depth with an extra
//     generation on every casual question is a permanent tax, not a feature)
//   · word count (3b over-length: ruling 2a fails if a CONCISE reader's answer grows)
//   · the evaluative tier's hits (3c) and the ungrounded-number scan (3e)
//
// ⚠ PACED. Google enforces 15 requests/min AND 250,000 input tokens/min on the free tier — far below the
// 480 RPD the quota layer meters. At ~21k prompt tokens a generation that is ~4 turns a minute. A 429
// comes back as a BLANK reply that looks exactly like "the model had nothing to say", so a blank is
// retried and then ABORTS the run. A blank is never recorded as a result.
//
//   DEPTH_CORPUS=1 npx tsx src/scripts/verify-depth-corpus.ts <arm-name>
//   npx tsx src/scripts/verify-depth-corpus.ts --diff before.json after.json
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import { writeFileSync, readFileSync } from "fs";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { resolveChatModel } from "../chat/config.js";
import { isBlankReply } from "../chat/voice.js";
import { scanExplanationText } from "../ai/core/guardrail.js";
import type { AiToolCall } from "../ai/types.js";

interface Turn {
  id: string;
  reader: string;
  question: string;
  reply: string;
  tools: string[];
  rounds: number;
  promptTokens: number;
  outputTokens: number;
  words: number;
  leadsWithFigure: boolean;
  opensWithDefinition: boolean;
  restatesQuestion: boolean;
  evaluative: { term: string; match: string; attributed: boolean; context: string }[];
  ms: number;
}

// ── The mechanical shape reads. Deliberately crude and deliberately stated: they are a SCREEN over the
//    verbatim text, not a verdict on it. Every reply is printed in full so the reader of the report
//    checks the classification rather than trusting it. ──
const firstSentence = (t: string): string => {
  const body = t.replace(/^\s*(?:#{1,6}\s*.*\n+)?/, "").trim(); // a leading markdown heading is not the lead
  return (body.split(/(?<=[.!?])\s/)[0] ?? body).slice(0, 400);
};
const leadsWithFigure = (t: string): boolean => /\d/.test(firstSentence(t));
const opensWithDefinition = (t: string): boolean =>
  /\b(?:is|are|refers?\s+to|means?)\s+(?:essentially\s+|basically\s+|simply\s+)?(?:a|an|the)\b[^.!?]*\b(?:portion|share|part|payment|profit|amount|measure|percentage|ratio|figure)\b/i.test(
    firstSentence(t),
  ) || /^\s*(?:A|An|The)\s+\w[\w\s-]{0,30}\s+(?:is|are)\s+(?:a|an|the)\b/i.test(firstSentence(t));
const restatesQuestion = (t: string): boolean =>
  /^\s*(?:(?:sure|certainly|of\s+course|absolutely|great\s+question|happy\s+to)[,!.]?\s*)?(?:you(?:'re| are)?\s+ask|let(?:'s| us)\s+(?:look|take|dive)|here(?:'s| is)\s+(?:a\s+)?(?:look|breakdown|summary)|to\s+answer\s+your|regarding\s+your)/i.test(
    t.trim(),
  );

const QUESTIONS: { id: string; reader: "default" | "concise"; q: string }[] = [
  // ── 3a — DEPTH. The four measured failures plus a bank, an NBFC and an insurer. ──
  { id: "3a-1-tcs-dividend", reader: "default", q: "What's the dividend history of TCS" },
  { id: "3a-2-tcs-doing", reader: "default", q: "How is TCS doing?" },
  { id: "3a-3-ril-financials", reader: "default", q: "Tell me about Reliance's financials" },
  { id: "3a-4-infy-quarter", reader: "default", q: "What happened with Infosys last quarter?" },
  { id: "3a-5-bank", reader: "default", q: "Tell me about HDFC Bank's financials" },
  { id: "3a-6-nbfc", reader: "default", q: "Tell me about Bajaj Finance's financials" },
  { id: "3a-7-insurer", reader: "default", q: "Tell me about SBI Life's financials" },
  // ── 3b — OVER-LENGTH. The same question to a reader whose depth resolves to `concise`. Ruling 2a
  //    fails if this arm GROWS. ──
  { id: "3b-concise-dividend", reader: "concise", q: "What's the dividend history of TCS" },
  { id: "3b-concise-doing", reader: "concise", q: "How is TCS doing?" },
  // ── 3b — TRIVIAL INPUT. Structure must not appear where there is nothing to structure. ──
  { id: "3b-trivial-hey", reader: "default", q: "hey" },
  { id: "3b-trivial-thanks", reader: "default", q: "thanks" },
];

const PACE_MS = Number(process.argv.find((a) => a.startsWith("--pace="))?.slice(7) ?? 21000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (n: number, d: number): string => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

// ── DIFF MODE — no model calls, just the two arm files. ─────────────────────────────────────────
function diff(aPath: string, bPath: string): void {
  const A: Turn[] = JSON.parse(readFileSync(aPath, "utf8"));
  const B: Turn[] = JSON.parse(readFileSync(bPath, "utf8"));
  const byId = new Map(A.map((t) => [t.id, t]));
  console.log("═".repeat(118));
  console.log("DEPTH A/B — BEFORE vs AFTER, same questions, same readers\n");
  const head = `${"turn".padEnd(22)}${"lead-figure".padEnd(15)}${"opens-def".padEnd(13)}${"restates".padEnd(12)}${"words".padEnd(14)}${"rounds".padEnd(11)}${"prompt tok".padEnd(15)}eval`;
  console.log(head);
  console.log("─".repeat(118));
  const yn = (a: boolean, b: boolean) => `${a ? "yes" : "no"}→${b ? "yes" : "no"}`.padEnd(a === b ? 0 : 0);
  for (const b of B) {
    const a = byId.get(b.id);
    if (!a) continue;
    console.log(
      b.id.padEnd(22) +
        yn(a.leadsWithFigure, b.leadsWithFigure).padEnd(15) +
        yn(a.opensWithDefinition, b.opensWithDefinition).padEnd(13) +
        yn(a.restatesQuestion, b.restatesQuestion).padEnd(12) +
        `${a.words}→${b.words}`.padEnd(14) +
        `${a.rounds}→${b.rounds}`.padEnd(11) +
        `${a.promptTokens}→${b.promptTokens}`.padEnd(15) +
        `${a.evaluative.length}→${b.evaluative.length}`,
    );
  }
  console.log("─".repeat(118));
  const sum = (t: Turn[], f: (x: Turn) => number) => t.reduce((n, x) => n + f(x), 0);
  const cnt = (t: Turn[], f: (x: Turn) => boolean) => t.filter(f).length;
  for (const [label, arr] of [["BEFORE", A], ["AFTER", B]] as [string, Turn[]][]) {
    console.log(
      `${label.padEnd(8)} leads-with-figure ${cnt(arr, (t) => t.leadsWithFigure)}/${arr.length} · ` +
        `opens-with-definition ${cnt(arr, (t) => t.opensWithDefinition)} · restates ${cnt(arr, (t) => t.restatesQuestion)} · ` +
        `total rounds ${sum(arr, (t) => t.rounds)} · total prompt tokens ${sum(arr, (t) => t.promptTokens).toLocaleString()} · ` +
        `evaluative hits ${sum(arr, (t) => t.evaluative.length)} (${sum(arr, (t) => t.evaluative.filter((e) => !e.attributed).length)} unattributed)`,
    );
  }
  console.log("═".repeat(118));
}

const args = process.argv.slice(2);
if (args[0] === "--diff") {
  diff(args[1], args[2]);
  process.exit(0);
}
if (process.env.DEPTH_CORPUS !== "1") {
  console.log("SKIPPED — real paid model calls. Run with DEPTH_CORPUS=1 <arm-name>, or --diff a.json b.json.");
  process.exit(0);
}
const ARM = args.find((a) => !a.startsWith("--")) ?? "arm";

const authIds: string[] = [];
async function newUser(aiLevel?: "plain" | "balanced" | "technical", financeDepth?: string, termComfort?: string): Promise<string> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `depthcorpus-${authId}@test.local`);
  authIds.push(authId);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  if (aiLevel) await prisma.userRegister.upsert({ where: { userId: u.id }, create: { userId: u.id, aiLevel }, update: { aiLevel } });
  if (financeDepth || termComfort)
    await prisma.userLedger.upsert({
      where: { userId: u.id },
      create: { userId: u.id, ...(financeDepth ? { financeDepth } : {}), ...(termComfort ? { termComfort } : {}) },
      update: { ...(financeDepth ? { financeDepth } : {}), ...(termComfort ? { termComfort } : {}) },
    });
  return u.id;
}

async function main() {
  // Two readers. `default` is the balanced baseline; `concise` resolves through LEVEL_SPEC to
  // DEPTH_CLAUSE.concise — the arm ruling 2a is about.
  const readers = {
    default: await newUser("balanced", "formal", "follow"),
    concise: await newUser("plain", "casual", "explain"),
  };
  const userRef = { id: readers.default };

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1/me", (req, _res, next) => {
    (req as express.Request).authUser = { userId: userRef.id, authUserId: "auth-" + userRef.id, email: "t@test.local", role: "user" };
    next();
  }, meChatRouter);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const post = async (path: string, body?: unknown) =>
    (await fetch(`http://127.0.0.1:${port}/api/v1/me${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })).json() as any;

  const turns: Turn[] = [];
  try {
    console.log(`DEPTH CORPUS — arm="${ARM}" model=${resolveChatModel()} · ${QUESTIONS.length} turns · pace ${PACE_MS}ms\n`);
    for (let i = 0; i < QUESTIONS.length; i++) {
      const { id, reader, q } = QUESTIONS[i];
      userRef.id = readers[reader];
      let turn: Turn | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (i || attempt) await sleep(attempt ? 45000 : PACE_MS);
        const t0 = Date.now();
        const opened = await post("/chat/sessions", { origin: "chat_page" });
        const sid = opened?.data?.session?.id;
        await post(`/chat/sessions/${sid}/messages`, { message: q });
        const ms = Date.now() - t0;
        const rows = await prisma.chatMessage.findMany({ where: { sessionId: sid }, orderBy: { createdAt: "asc" } });
        const tools: string[] = [];
        let reply = "", rounds = 0, promptTokens = 0, outputTokens = 0;
        for (const m of rows) {
          promptTokens += m.promptTokens ?? 0;
          outputTokens += m.outputTokens ?? 0;
          if (m.kind === "tool_call") { rounds++; for (const c of ((m.toolPayload as unknown as AiToolCall[]) ?? [])) tools.push(c.name); }
          else if (m.role === "assistant" && m.kind === "text") reply = m.content;
        }
        if (isBlankReply(reply)) { console.log(`  ⏳ blank (rate-limited) on "${q}" — attempt ${attempt + 1}/3`); continue; }
        const ev = scanExplanationText(reply).evaluativeHits;
        turn = {
          id, reader, question: q, reply, tools, rounds, promptTokens, outputTokens,
          words: reply.trim().split(/\s+/).length,
          leadsWithFigure: leadsWithFigure(reply),
          opensWithDefinition: opensWithDefinition(reply),
          restatesQuestion: restatesQuestion(reply),
          evaluative: ev.map((h) => ({ term: h.term, match: h.match, attributed: h.attributed, context: h.context })),
          ms,
        };
        break;
      }
      // ⚠ A blank is rate limiting, NOT a clean pass. Never record it as one.
      if (!turn) throw new Error(`3 blank replies for "${q}" — rate limiting, not a result.`);
      turns.push(turn);
      console.log("═".repeat(112));
      console.log(`[${turn.id}] reader=${turn.reader}\nREADER │ ${turn.question}`);
      console.log(`tools  │ ${turn.tools.join(" → ") || "(none)"}   rounds=${turn.rounds} promptTok=${turn.promptTokens} ${turn.ms}ms`);
      console.log(`VYTAL  │ ${turn.reply.replace(/\n/g, "\n       │ ")}`);
      console.log(
        `SHAPE  │ leads-with-figure=${turn.leadsWithFigure} opens-with-definition=${turn.opensWithDefinition} ` +
          `restates-question=${turn.restatesQuestion} words=${turn.words}`,
      );
      console.log(`GUARD  │ ★ evaluative=${turn.evaluative.length}${turn.evaluative.map((e) => `\n       │   ${e.term}${e.attributed ? "[attributed]" : "[MODEL'S OWN]"} → "${e.match}" · ${e.context}`).join("")}`);
      console.log("");
    }
  } finally {
    server.close();
  }

  const out = `${process.env.TEMP ?? "."}/depth-${ARM}.json`.replace(/\\/g, "/");
  writeFileSync(out, JSON.stringify(turns, null, 2));
  const units = (await prisma.aiUsageCounter.findMany({ where: { scope: { startsWith: `user:` } }, select: { callCount: true } })).length;
  console.log("═".repeat(112));
  console.log(`ARM "${ARM}" — ${turns.length} turns`);
  console.log(`  leads with a figure     ${turns.filter((t) => t.leadsWithFigure).length}/${turns.length} (${pct(turns.filter((t) => t.leadsWithFigure).length, turns.length)})`);
  console.log(`  opens with a definition ${turns.filter((t) => t.opensWithDefinition).length}`);
  console.log(`  restates the question   ${turns.filter((t) => t.restatesQuestion).length}`);
  console.log(`  total tool rounds       ${turns.reduce((n, t) => n + t.rounds, 0)} · total prompt tokens ${turns.reduce((n, t) => n + t.promptTokens, 0).toLocaleString()}`);
  console.log(`  ★ evaluative hits       ${turns.reduce((n, t) => n + t.evaluative.length, 0)} (${turns.reduce((n, t) => n + t.evaluative.filter((e) => !e.attributed).length, 0)} unattributed)`);
  console.log(`  counter rows touched    ${units}`);
  console.log(`  written → ${out}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); })
  .finally(async () => { if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds); });
