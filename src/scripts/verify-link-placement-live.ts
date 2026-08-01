// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PART 3c — LIVE. The five questions that actually produced the defect, asked again with the clause in
// place. ⚠ REAL, PAID GEMINI CALLS. Opt-in: LINK_LIVE=1.
//
// ★ EVERY QUESTION HERE IS A REPLAY, NOT AN INVENTION. Each one is traced to a delivered turn in the
// corpus that carries a misplaced link — the dividend history that put an anchor in the "(TICKER)"
// slot, the insurer answer that wrote "at its [the Overview tab for SBILIFE] page", the comparison and
// market questions that produced "the [the …]". A fresh set of questions would prove the clause is
// harmless; only the questions that broke it can prove it works.
//
// ⚠ PACED against the measured free-tier ceilings (15 req/min AND 250,000 input tok/min). A blank
// reply is rate limiting, never a clean pass, and three blanks abort the run.
//
//   LINK_LIVE=1 npx tsx src/scripts/verify-link-placement-live.ts
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { resolveChatModel } from "../chat/config.js";
import { isBlankReply } from "../chat/voice.js";
import { LINK_DEFECTS } from "./recon-link-defects.js";

if (process.env.LINK_LIVE !== "1") {
  console.log("SKIPPED — real paid model calls. Run with LINK_LIVE=1.");
  process.exit(0);
}
const PACE_MS = Number(process.argv.find((a) => a.startsWith("--pace="))?.slice(7) ?? 21000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const QUESTIONS: [string, string][] = [
  ["What's the dividend history of TCS", "produced the anchor-in-the-(TICKER)-slot AND the single-brace marker"],
  ["Tell me about SBI Life's financials", "produced \"at its [the Overview tab for SBILIFE] page\" — article AND noun doubled"],
  ["Tell me about Reliance's financials", "produced \"on the [the Overview tab for RELIANCE]\" twice in one reply"],
  ["How does TCS compare to other IT companies?", "produced \"check its [the Health Score tab for TCS]\""],
  ["Where can I see the whole market?", "produced \"the overview on the [the Health Hub]\""],
];

const authIds: string[] = [];
async function main() {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `linklive-${authId}@test.local`);
  authIds.push(authId);
  const userId = (await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } })).id;

  const app = express();
  app.use(express.json({ limit: "2mb" }));
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

  let anchors = 0, defects = 0;
  try {
    console.log(`LIVE — model=${resolveChatModel()} · ${QUESTIONS.length} replays of turns that carried a misplaced link\n`);
    for (let i = 0; i < QUESTIONS.length; i++) {
      const [q, why] = QUESTIONS[i];
      let reply = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        if (i || attempt) await sleep(attempt ? 45000 : PACE_MS);
        const opened = await post("/chat/sessions", { origin: "chat_page" });
        const sid = opened?.data?.session?.id;
        await post(`/chat/sessions/${sid}/messages`, { message: q });
        const rows = await prisma.chatMessage.findMany({ where: { sessionId: sid, role: "assistant", kind: "text" }, orderBy: { createdAt: "asc" } });
        reply = rows.map((r) => r.content).join("\n");
        if (!isBlankReply(reply)) break;
        console.log(`  ⏳ blank (rate-limited) on "${q}" — attempt ${attempt + 1}/3`);
      }
      if (isBlankReply(reply)) throw new Error(`3 blank replies for "${q}" — rate limiting, not a result.`);

      const found = LINK_DEFECTS.flatMap((d) => (reply.match(new RegExp(d.re.source, d.re.flags)) ?? []).map((m) => ({ id: d.id, m })));
      const myAnchors = (reply.match(/\]\(\/[^)\s]*\)/g) ?? []).length;
      anchors += myAnchors; defects += found.length;
      console.log("═".repeat(108));
      console.log(`READER │ ${q}\n  was  │ ${why}`);
      console.log(`VYTAL  │ ${reply.replace(/\n/g, "\n       │ ")}`);
      console.log(`LINKS  │ ${myAnchors} in-app anchor(s) · ${found.length === 0 ? "✅ no defect" : `❌ ${found.length}`}`);
      for (const f of found) console.log(`       │   ❌ ${f.id} → ${f.m.slice(0, 110)}`);
      console.log("");
    }
  } finally {
    server.close();
  }
  console.log("═".repeat(108));
  console.log(`REPLAY RESULT — ${QUESTIONS.length} turns · ${anchors} in-app anchors emitted · ${defects} defects`);
  console.log(`  ${defects === 0 ? "✅" : "❌"} every anchor sits where a destination belongs, with its own article and noun intact`);
  await prisma.$disconnect();
  process.exit(defects === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); })
  .finally(async () => { if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds); });
