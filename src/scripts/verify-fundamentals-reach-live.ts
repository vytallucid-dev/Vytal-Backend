// ─────────────────────────────────────────────────────────────────────────────────────────────────
// STAGE 4 — LIVE PROOF that getStockFundamentals is now REACHABLE, and that reaching it did not make
// the model reach for everything.
//
// ⚠ REAL, PAID GEMINI CALLS. Opt-in: FUNDAMENTALS_REACH_LIVE=1.
//
// ★ WHY THIS CANNOT BE A FIXTURE. A description is a behavioural claim (tools/registry.ts §2). The
// baseline being tested against is measured, not assumed: getStockFundamentals was called ZERO times
// across 17 live sessions / 54 tool rounds, while getStockQuarterlyResults — the SAME read through the
// same ctx.once key — was called 4 times.
//
// ★★ BOTH ARMS RUN, AND THE OVER-FETCH ARM IS THE ONE THAT CAN STOP THE SHIP. Every extra tool round
// resends the whole prompt (~16,000 tokens measured), and Flash-Lite's 480 RPD is the real ceiling. A
// description broad enough to fire on "How is TCS doing?" would cost a round on every casual message
// forever. That case is asserted, not merely observed.
//
// ★★★ AND EVERY REPLY IS SCANNED FOR UNGROUNDED NUMBERS — the ₹57 defect this whole build exists to
// close. The scan here is INDEPENDENT of the engine's log: it rebuilds the haystack from the persisted
// turn and re-checks, so a silent logger cannot produce a false pass.
//
//   FUNDAMENTALS_REACH_LIVE=1 npx tsx src/scripts/verify-fundamentals-reach-live.ts
//   …optionally --repeats=N (default 3) for the stochastic arms.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { resolveChatModel } from "../chat/config.js";
import { isBlankReply, buildSystemPrompt } from "../chat/voice.js";
import { resolveTone } from "../ai/tone.js";
import { toolSpecs } from "../chat/tools/registry.js";
import { scanUngroundedNumbers, buildNumberHaystack } from "../ai/number-grounding.js";
import type { AiToolCall } from "../ai/types.js";

if (process.env.FUNDAMENTALS_REACH_LIVE !== "1") {
  console.log("SKIPPED — real paid model calls. Run with FUNDAMENTALS_REACH_LIVE=1.");
  process.exit(0);
}

const REPEATS = Number(process.argv.find((a) => a.startsWith("--repeats="))?.slice(10) ?? 3);
/**
 * ★ PACING IS NOT OPTIONAL, AND THE FIRST RUN OF THIS SCRIPT PROVED IT.
 *
 * Fired back-to-back, this harness hit TWO Google per-minute ceilings within four turns and every
 * subsequent turn came back blank with a 429:
 *     GenerateRequestsPerMinutePerProjectPerModel-FreeTier    limit 15/min
 *     GenerateContentInputTokensPerModelPerMinute-FreeTier    limit 250,000 input tokens/min
 * ⚠ NEITHER IS THE 480 RPD DAILY CEILING the quota layer meters. At ~21,000 prompt tokens per
 * generation and 2–3 generations per turn, the TOKEN limit binds first: ~11 generations a minute, so
 * roughly 4 turns a minute. A blank reply from a 429 looks exactly like a model that called no tools,
 * which would have silently turned every over-fetch assertion into a false PASS.
 */
const PACE_MS = Number(process.argv.find((a) => a.startsWith("--pace="))?.slice(7) ?? 21000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };

// ── Capture the engine's own UNGROUNDED_NUMBER log (4i) without changing the engine. ──
const warnLog: string[] = [];
const realWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => { const s = args.map(String).join(" "); warnLog.push(s); realWarn(...args); };

const SYS = buildSystemPrompt(resolveTone(null, null).systemDirective);
const SPECS = JSON.stringify(toolSpecs());

interface TurnResult {
  message: string; tools: string[]; rounds: number; reply: string;
  promptTokens: number[]; ms: number; ungrounded: { raw: string; context: string }[];
  checked: number; skipped: number; toolOutputs: string[];
}

const authIds: string[] = [];

async function main() {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `reach-${authId}@test.local`);
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

  /** One message in its OWN fresh session, so no history bleeds between cases. */
  async function ask(message: string): Promise<TurnResult> {
    const opened = await post("/chat/sessions", { origin: "chat_page" });
    const sid = opened?.data?.session?.id;
    const t0 = Date.now();
    await post(`/chat/sessions/${sid}/messages`, { message });
    const ms = Date.now() - t0;
    const rows = await prisma.chatMessage.findMany({ where: { sessionId: sid }, orderBy: { createdAt: "asc" } });
    const tools: string[] = []; const promptTokens: number[] = []; const toolOutputs: string[] = [];
    const msgs: { content: string; toolResult?: unknown }[] = [];
    let rounds = 0; let reply = "";
    for (const m of rows) {
      if (m.kind === "tool_call") {
        rounds++;
        for (const c of ((m.toolPayload as unknown as AiToolCall[]) ?? [])) tools.push(c.name);
        if (m.promptTokens != null) promptTokens.push(m.promptTokens);
        msgs.push({ content: m.content });
      } else if (m.kind === "tool_result") {
        const p = m.toolPayload as any;
        toolOutputs.push(String(p?.response?.output ?? p?.response?.error ?? ""));
        msgs.push({ content: "", toolResult: p });
      } else if (m.role === "assistant") {
        reply = m.content; if (m.promptTokens != null) promptTokens.push(m.promptTokens);
      } else msgs.push({ content: m.content });
    }
    const g = scanUngroundedNumbers(reply, buildNumberHaystack({ system: SYS, toolSpecsJson: SPECS, messages: msgs as never }));
    return { message, tools, rounds, reply, promptTokens, ms, ungrounded: g.hits, checked: g.checked, skipped: g.skipped, toolOutputs };
  }

  const show = (t: TurnResult) => {
    console.log(`\n  READER │ ${t.message}`);
    console.log(`  tools  │ ${t.tools.join(" → ") || "(none)"}   rounds=${t.rounds}  prompt=${t.promptTokens.join("/")}  ${t.ms}ms`);
    console.log(`  VYTAL  │ ${t.reply.replace(/\n/g, "\n         │ ")}`);
    if (t.ungrounded.length) console.log(`  ★ UNGROUNDED: ${t.ungrounded.map((h) => `"${h.raw}"`).join(", ")}`);
  };

  const all: TurnResult[] = [];
  /**
   * One paced turn, with a retry on a rate-limited (blank) reply.
   * ★ A BLANK REPLY IS TREATED AS "NOT A RESULT", NEVER AS "NO TOOLS CALLED". That conflation is how a
   * 429 storm would turn the over-fetch arm green while proving nothing.
   */
  const run = async (m: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (all.length || attempt) await sleep(attempt ? 45000 : PACE_MS);
      const t = await ask(m);
      if (!isBlankReply(t.reply)) { all.push(t); show(t); return t; }
      console.log(`  ⏳ blank reply (rate-limited) on "${m}" — attempt ${attempt + 1}/3, backing off`);
    }
    throw new Error(`3 blank replies for "${m}" — rate limiting, not a behavioural result. Aborting rather than reporting a false pass.`);
  };

  try {
    console.log(`LIVE — model=${resolveChatModel()} · repeats=${REPEATS}`);

    // ══ 4a · THE ORIGINAL DEFECT ══════════════════════════════════════════════════════════════
    console.log(`\n══ 4a · "the annual report for Reliance" (${REPEATS}×) ══`);
    const a: TurnResult[] = [];
    for (let i = 0; i < REPEATS; i++) a.push(await run("Tell me the annual report for Reliance"));
    ok("★★ getStockFundamentals fires", a.every((t) => t.tools.includes("getStockFundamentals")),
      a.map((t) => t.tools.join("+") || "none").join(" | "));
    ok("★★ never claims Vytal has no annual reports",
      a.every((t) => !/does\s?n[o']t\s+(hold|have|display|carry)|no(t)?\s+(hold|host)/i.test(t.reply) || /figure|revenue|profit|margin/i.test(t.reply)));
    ok("answers with real figures", a.every((t) => /crore|₹/i.test(t.reply)));

    // ══ 4b + 4h · THE DIVIDEND TURN ═══════════════════════════════════════════════════════════
    console.log(`\n══ 4b/4h · "dividend history of TCS" (${REPEATS}×) — reach AND no-arithmetic ══`);
    const b: TurnResult[] = [];
    for (let i = 0; i < REPEATS; i++) b.push(await run("What's the dividend history of TCS"));
    ok("★ reaches fundamentals for payout/yield, not events alone",
      b.every((t) => t.tools.includes("getStockFundamentals")), b.map((t) => t.tools.join("+")).join(" | "));
    ok("★★★ NO ₹57 (or any other computed total) in any run",
      b.every((t) => t.ungrounded.length === 0),
      b.flatMap((t) => t.ungrounded.map((h) => h.raw)).join(", ") || "every number traced to a tool result");
    for (const t of b) console.log(`     run: ${t.checked} numbers checked, ${t.skipped} skipped (≤12/years — the blind spot)`);

    // ══ 4c · SINGLE-LINE PHRASINGS ════════════════════════════════════════════════════════════
    console.log(`\n══ 4c · single financial lines ══`);
    const c1 = await run("What's TCS's revenue");
    const c2 = await run("how profitable is Infosys");
    const c3 = await run("dividend yield of ITC");
    ok("\"revenue\" reaches fundamentals", c1.tools.includes("getStockFundamentals"), c1.tools.join("+"));
    ok("\"how profitable\" reaches fundamentals", c2.tools.includes("getStockFundamentals"), c2.tools.join("+"));
    ok("\"dividend yield\" reaches fundamentals", c3.tools.includes("getStockFundamentals"), c3.tools.join("+"));

    // ══ 4d · THE FIXED FINANCIAL-FAMILY TABLES ════════════════════════════════════════════════
    console.log(`\n══ 4d · bank / NBFC / insurer — Stage 1's fixed tables ══`);
    const d1 = await run("What are HDFCBANK's deposits and advances for the full year?");
    const d2 = await run("What's HUDCO's loan book and net profit?");
    const d3 = await run("What premium income and profit did GICRE report?");
    ok("bank figures reached the reader", d1.tools.includes("getStockFundamentals") && /crore|₹/i.test(d1.reply));
    ok("NBFC figures reached the reader", d2.tools.includes("getStockFundamentals") && /crore|₹/i.test(d2.reply));
    ok("★ GICRE premium AND profit are real, not \"not available\"",
      d3.tools.includes("getStockFundamentals") && /crore|₹/i.test(d3.reply) && !/not available/i.test(d3.reply), d3.tools.join("+"));

    // ══ 4e · ★ THE OVER-FETCH ARM — CAN STOP THE SHIP ═════════════════════════════════════════
    console.log(`\n══ 4e · ★ OVER-FETCH: "How is TCS doing?" (${REPEATS}×) ══`);
    const e: TurnResult[] = [];
    for (let i = 0; i < REPEATS; i++) e.push(await run("How is TCS doing?"));
    const worst = Math.max(...e.map((t) => t.rounds));
    const avgTools = e.reduce((n, t) => n + t.tools.length, 0) / e.length;
    ok("★★ a casual health question stays at ≤2 rounds", worst <= 2, `worst=${worst} rounds, avg ${avgTools.toFixed(1)} tools`);
    ok("★★ it does NOT pull getStockFundamentals", e.every((t) => !t.tools.includes("getStockFundamentals")),
      e.map((t) => t.tools.join("+") || "none").join(" | "));
    console.log(`     prompt tokens per run: ${e.map((t) => t.promptTokens.reduce((a2, b2) => a2 + b2, 0)).join(", ")}`);

    // ══ 4f · TREND QUESTIONS STILL ROUTE TO QUARTERLY ═════════════════════════════════════════
    console.log(`\n══ 4f · trend phrasing must still pick getStockQuarterlyResults ══`);
    const f1 = await run("Have TCS's margins been improving over the last two years?");
    const f2 = await run("How was Infosys's last quarter versus a year ago?");
    ok("trend question reaches getStockQuarterlyResults", f1.tools.includes("getStockQuarterlyResults") || f2.tools.includes("getStockQuarterlyResults"),
      `${f1.tools.join("+")} | ${f2.tools.join("+")}`);

    // ══ 4g · TRIVIAL INPUT — ZERO TOOLS ═══════════════════════════════════════════════════════
    console.log(`\n══ 4g · trivial input must cost nothing ══`);
    const g1 = await run("hey");
    const g2 = await run("thanks!");
    ok("★ a greeting fires no tools", g1.tools.length === 0, g1.tools.join("+") || "none");
    ok("★ a one-word thanks fires no tools", g2.tools.length === 0, g2.tools.join("+") || "none");

    // ══ 4i · THE ENGINE'S OWN LOG ═════════════════════════════════════════════════════════════
    console.log(`\n══ 4i · what number-grounding logged across the whole run ══`);
    const fired = warnLog.filter((l) => l.includes("UNGROUNDED_NUMBER"));
    if (!fired.length) {
      console.log("     NOTHING LOGGED across every turn above.");
      console.log("     ⚠ A CLEAN LOG IS NOT PROOF. Integers ≤12 and years are not checked at all, so an");
      console.log("       invented COUNT (\"4 block deals\" when there were 2) would not appear here.");
      const totalSkipped = all.reduce((n, t) => n + t.skipped, 0);
      console.log(`       ${totalSkipped} figures across this run went unchecked for exactly that reason.`);
    } else for (const l of fired) console.log(`     ${l}`);
    ok("independent re-scan agrees with the engine's log",
      (all.some((t) => t.ungrounded.length > 0)) === (fired.length > 0));

    // ══ 4j · NO INTERNAL IDENTIFIERS ══════════════════════════════════════════════════════════
    console.log(`\n══ 4j · no internal identifier in any reply ══`);
    const LEAKS = [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, /\b(stockId|periodKey|flagKey|patternKey|snapshotId|peerGroupId)\b/,
      /\b(ownership_R\d|foundation_R\d|momentum_P\d\d?)\b/, /\braw \d/];
    const leaked = all.filter((t) => LEAKS.some((re) => re.test(t.reply)));
    ok("★ no UUID, internal key or raw-value leak", leaked.length === 0,
      leaked.map((t) => t.message).join(" | ") || `${all.length} replies clean`);

    // ══ 4k · COST ═════════════════════════════════════════════════════════════════════════════
    const units = (await prisma.aiUsageCounter.findMany({ where: { scope: { startsWith: `user:${userId}:` } }, select: { callCount: true } }))
      .reduce((n, r) => n + r.callCount, 0);
    const lat = all.map((t) => t.ms).sort((x, y) => x - y);
    console.log(`\n══ 4k · cost ══`);
    console.log(`     turns ${all.length} · quota units ${units} · latency median ${lat[Math.floor(lat.length / 2)]}ms · max ${lat[lat.length - 1]}ms`);
    console.log(`     total tool rounds ${all.reduce((n, t) => n + t.rounds, 0)} · total prompt tokens ${all.reduce((n, t) => n + t.promptTokens.reduce((a2, b2) => a2 + b2, 0), 0)}`);
  } finally {
    server.close();
  }
  console.log(`\n${failures === 0 ? "✅ ALL PASS" : `❌ ${failures} FAILED`}`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds);
    await prisma.$disconnect();
  });
