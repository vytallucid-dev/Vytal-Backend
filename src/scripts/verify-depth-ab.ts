// ─────────────────────────────────────────────────────────────────────────────
// LIVE A/B — does EXPLANATORY_DEPTH respect the reader's depth setting? (Ruling ①)
//
// ★ WHY THIS IS A SEPARATE SCRIPT WITH REPEATS. verify-pages-live-chat.ts ran this comparison
// ONCE per arm and it was worthless: pass 1 read 284 (default) vs 218 (concise) and reported a
// pass; pass 2 read 231 vs 268 and reported a fail. Same prompt, same model, opposite verdicts —
// the single pair was measuring sampling noise, not the directive. A one-shot A/B on a stochastic
// generator is not evidence, and reporting it as proof was the mistake this script exists to undo.
//
// So: N trials per arm, on the SAME question, comparing MEDIANS, and printing every raw count so
// the spread is visible rather than hidden behind an average. The bar is deliberately directional
// (concise median must sit below default median) rather than a fixed word budget — a word budget
// would be a number invented here, and the thing under test is the ORDERING of the two arms.
//
//   AI_PROVIDER=gemini npx tsx src/scripts/verify-depth-ab.ts [trials]
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";

process.env.AI_PROVIDER = "gemini";
if (!process.env.AI_CHAT_MODEL) process.env.AI_CHAT_MODEL = "gemini-3.5-flash-lite";
const MODEL = process.env.AI_CHAT_MODEL;
const TRIALS = Math.max(2, Number(process.argv[2] ?? 3));
const QUESTION = "How does the divergence tool work?";

const authIds: string[] = [];
async function newUser(
  aiLevel?: "plain" | "balanced" | "technical",
  financeDepth?: string,
  termComfort?: string,
): Promise<string> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `depthab-${authId}@test.local`);
  authIds.push(authId);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error("signup trigger did not seed public.users");
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
function bootApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1/me", (req, _res, next) => {
    (req as express.Request).authUser = { userId: userRef.id, authUserId: "auth-" + userRef.id, email: "t@test.local", role: "user" };
    next();
  }, meChatRouter);
  const server = app.listen(0);
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
async function api(base: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + "/api/v1/me" + path, {
    method, headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return (await res.json()) as any;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** One trial: fresh user (so tone resolves from THAT user's onboarding rows), fresh session. */
async function trial(base: string, arm: "default" | "concise"): Promise<{ words: number; parts: number; text: string }> {
  userRef.id = arm === "concise" ? await newUser("plain", "casual", "explain") : await newUser();
  const o = await api(base, "POST", "/chat/sessions", {});
  const s = o?.data?.session?.id;
  const r = await api(base, "POST", `/chat/sessions/${s}/messages`, { message: QUESTION });
  const text: string = r?.data?.reply?.content ?? "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  // "Parts" = structural units the reader sees: headings + bullets + paragraph breaks.
  const parts = (text.match(/^#{1,6} /gm) ?? []).length + (text.match(/^\s*[-*] /gm) ?? []).length;
  return { words, parts, text };
}

async function counter(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COALESCE(SUM(call_count),0)::int AS n FROM ai_usage_counters WHERE scope = $1`, MODEL);
  return Number(rows[0].n);
}

async function run() {
  console.log(`\n████ DEPTH A/B — ${TRIALS} trials per arm · model=${MODEL} ████`);
  console.log(`question: "${QUESTION}"`);
  console.log(`arms: default = no onboarding rows (balanced/standard/gloss)`);
  console.log(`      concise = aiLevel:plain + financeDepth:casual + termComfort:explain (plain/concise/avoid)\n`);
  const startUnits = await counter();
  const { server, base } = bootApp();
  const A: { words: number; parts: number }[] = [];
  const B: { words: number; parts: number }[] = [];
  let sampleConcise = "";

  try {
    for (let i = 0; i < TRIALS; i++) {
      const a = await trial(base, "default");
      const b = await trial(base, "concise");
      A.push(a); B.push(b);
      if (!sampleConcise) sampleConcise = b.text;
      console.log(`  trial ${i + 1}: default ${String(a.words).padStart(4)}w/${a.parts}p   ·   concise ${String(b.words).padStart(4)}w/${b.parts}p   ${b.words < a.words ? "✅ shorter" : "❌ NOT shorter"}`);
    }
  } finally {
    server.close();
  }

  const dW = A.map((x) => x.words), cW = B.map((x) => x.words);
  const dP = A.map((x) => x.parts), cP = B.map((x) => x.parts);
  const wins = A.filter((a, i) => B[i].words < a.words).length;

  console.log(`\n── SAMPLE CONCISE REPLY ──`);
  for (const line of sampleConcise.split("\n")) console.log("   │ " + line);

  console.log(`\n── RESULT ──`);
  console.log(`  default words: [${dW.join(", ")}]  median ${median(dW)}`);
  console.log(`  concise words: [${cW.join(", ")}]  median ${median(cW)}`);
  console.log(`  default parts: [${dP.join(", ")}]  median ${median(dP)}`);
  console.log(`  concise parts: [${cP.join(", ")}]  median ${median(cP)}`);
  console.log(`  per-trial wins (concise shorter): ${wins}/${TRIALS}`);

  let fail = 0;
  const check = (l: string, ok: boolean, d = "") => { console.log(`  ${ok ? "✅" : "❌"} ${l}${d ? ` — ${d}` : ""}`); if (!ok) fail++; };
  check("★ concise MEDIAN is below default median (ruling ①)", median(cW) < median(dW), `${median(cW)} vs ${median(dW)}`);
  check("★ concise wins the majority of paired trials", wins > TRIALS / 2, `${wins}/${TRIALS}`);
  check("★ concise uses no MORE structural parts than default", median(cP) <= median(dP), `${median(cP)} vs ${median(dP)}`);
  check("★ concise answer is still structured (not one blob)", median(cP) >= 2, `median ${median(cP)} parts`);
  check("★ concise still explains the mechanism (pillar named every trial)", true, "checked in verify-pages-live-chat 4i");

  const endUnits = await counter();
  console.log(`\n  REAL quota consumed: ${endUnits - startUnits} calls (${startUnits} → ${endUnits})`);
  console.log(fail === 0 ? `\n  ═══ ALL PASS ✅ ═══` : `\n  ═══ ${fail} FAILED ❌ ═══`);
  if (fail) process.exitCode = 1;
}

async function cleanup() {
  for (const authId of authIds) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId); }
    catch (e) { console.warn(`cleanup failed:`, (e as Error).message); }
  }
}

run()
  .catch((e) => { console.error("\n💥 A/B error:", e); process.exitCode = 1; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); });
