// ─────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE A/B — does COMPANY_ANSWER_SHAPE respect the reader's depth setting? (ruling 2a)
//
// ★ THE SIBLING OF verify-depth-ab.ts, AND IT EXISTS FOR THE SAME MEASURED REASON. That script proves
// EXPLANATORY_DEPTH (answers about VYTAL) stays under the reader's length instruction. This one proves
// the same thing for COMPANY_ANSWER_SHAPE (answers about a COMPANY), and it was written because the
// single-pair reading in the depth corpus flipped: the concise reader's answer came back LONGER than
// the default reader's on both company questions, which is exactly the failure EXPLANATORY_DEPTH's
// first draft had — and exactly the reading that turned out to be sampling noise the first time it was
// measured with one pair. One pair is not evidence in either direction. So: N trials per arm, MEDIANS
// compared, every raw count printed.
//
// ⚠ A COMPANY QUESTION COSTS TWO TOOL ROUNDS, so a trial is ~3 generations, not one. Paced against the
// measured free-tier ceilings (15 requests/min AND 250,000 input tokens/min at ~21k prompt tokens a
// generation). A blank reply is rate limiting, not a short answer, and is never counted as one.
//
//   AI_PROVIDER=gemini COMPANY_AB=1 npx tsx src/scripts/verify-company-depth-ab.ts [trials]
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { isBlankReply } from "../chat/voice.js";

process.env.AI_PROVIDER = "gemini";
if (!process.env.AI_CHAT_MODEL) process.env.AI_CHAT_MODEL = "gemini-3.5-flash-lite";
const MODEL = process.env.AI_CHAT_MODEL;
const TRIALS = Math.max(2, Number(process.argv[2] ?? 4));
const PACE_MS = Number(process.argv.find((a) => a.startsWith("--pace="))?.slice(7) ?? 20000);
const QUESTION = "How is TCS doing?";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (process.env.COMPANY_AB !== "1") {
  console.log("SKIPPED — real paid model calls. Run with COMPANY_AB=1.");
  process.exit(0);
}

const authIds: string[] = [];
async function newUser(aiLevel?: "plain" | "balanced" | "technical", financeDepth?: string, termComfort?: string): Promise<string> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `companyab-${authId}@test.local`);
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

const userRef = { id: "" };
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function main() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1/me", (req, _res, next) => {
    (req as express.Request).authUser = { userId: userRef.id, authUserId: "auth-" + userRef.id, email: "t@test.local", role: "user" };
    next();
  }, meChatRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (path: string, body?: unknown) =>
    (await fetch(`${base}/api/v1/me${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })).json() as any;

  async function trial(arm: "default" | "concise"): Promise<{ words: number; parts: number; text: string }> {
    userRef.id = arm === "concise" ? await newUser("plain", "casual", "explain") : await newUser("balanced", "formal", "follow");
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(attempt ? 45000 : PACE_MS);
      const o = await api("/chat/sessions", { origin: "chat_page" });
      const r = await api(`/chat/sessions/${o?.data?.session?.id}/messages`, { message: QUESTION });
      const text: string = r?.data?.reply?.content ?? "";
      if (isBlankReply(text)) { console.log(`    ⏳ blank (rate-limited) — ${arm} attempt ${attempt + 1}/3`); continue; }
      return {
        words: text.trim().split(/\s+/).length,
        // "Parts" = the structural units the reader sees. Ruling 2a is about COUNT as well as length:
        // EXPLANATORY_DEPTH's first draft failed by pinning the part count and shrinking only the parts.
        parts: (text.match(/^#{1,6} /gm) ?? []).length + (text.match(/^\s*[-*] /gm) ?? []).length,
        text,
      };
    }
    throw new Error(`3 blank replies on the ${arm} arm — rate limiting, not a result.`);
  }

  console.log(`\n████ COMPANY DEPTH A/B — ${TRIALS} trials per arm · model=${MODEL} ████`);
  console.log(`question: "${QUESTION}"  (a COMPANY question — 2 tool rounds per trial)`);
  console.log(`  default = balanced/formal/follow   →  DEPTH_CLAUSE.standard`);
  console.log(`  concise = plain/casual/explain     →  DEPTH_CLAUSE.concise\n`);
  const A: { words: number; parts: number }[] = [];
  const B: { words: number; parts: number }[] = [];
  let sample = "";
  try {
    for (let i = 0; i < TRIALS; i++) {
      const a = await trial("default");
      const b = await trial("concise");
      A.push(a); B.push(b);
      if (!sample) sample = b.text;
      console.log(
        `  trial ${i + 1}: default ${String(a.words).padStart(4)}w/${String(a.parts).padStart(2)}p   ·   ` +
          `concise ${String(b.words).padStart(4)}w/${String(b.parts).padStart(2)}p   ${b.words < a.words ? "✅ shorter" : "❌ NOT shorter"}`,
      );
    }
  } finally {
    server.close();
  }

  const dW = A.map((x) => x.words), cW = B.map((x) => x.words);
  const dP = A.map((x) => x.parts), cP = B.map((x) => x.parts);
  const wins = A.filter((a, i) => B[i].words < a.words).length;
  console.log(`\n── SAMPLE CONCISE REPLY ──`);
  for (const line of sample.split("\n")) console.log("   │ " + line);
  console.log(`\n── RESULT ──`);
  console.log(`  default words: [${dW.join(", ")}]  median ${median(dW)}`);
  console.log(`  concise words: [${cW.join(", ")}]  median ${median(cW)}`);
  console.log(`  default parts: [${dP.join(", ")}]  median ${median(dP)}`);
  console.log(`  concise parts: [${cP.join(", ")}]  median ${median(cP)}`);
  console.log(`  per-trial wins (concise shorter): ${wins}/${TRIALS}`);
  const pass = median(cW) < median(dW);
  console.log(
    `\n  ${pass ? "✅ PASS" : "❌ FAIL"} — ruling 2a: the concise reader's median must sit BELOW the default reader's ` +
      `(${median(cW)} vs ${median(dW)}).`,
  );
  if (!pass) console.log(`  ⚠ aiLevel is sovereign. A depth directive that a length setting cannot outrank is the bug EXPLANATORY_DEPTH already had once.`);
  await prisma.$disconnect();
  process.exit(pass ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); })
  .finally(async () => { if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds); });
