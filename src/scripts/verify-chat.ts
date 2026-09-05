// ─────────────────────────────────────────────────────────────────────────────
// CHAT VERIFY HARNESS (Stage 2 — the conversation engine, backend only).
//
// Proves, end to end:
//   1. Tables + the retention_policy row exist as built.
//   2. A REAL conversation over HTTP, verbatim — a booted Express listener + the REAL meChatRouter +
//      controllers + envelope; open a sidebar session on a stock, read the opening exchange, ask two
//      follow-ups, show every message. (Assistant replies come from a SCRIPTED provider — deterministic,
//      no API key; the composed openings, grounding, guardrail scan, persistence and lifecycle are all real.)
//   3. Each composed opening ask verbatim (all five surfaces) + the assembled grounded opening for a stock.
//   4. Lifecycle: resume within 24h · new session after 24h · promotion on first follow-up · the visibility
//      filter (unpromoted absent from the list, promoted present).
//   5. The guardrail path: advice → regeneration → the fixed redirect (+ the advice → clean-retry path),
//      and the honest "unavailable" state (spend denied → persist nothing) over HTTP.
//   6. The retention row + the unpromoted_only exemption protecting promoted sessions (dry-run).
//   7. Titling: a derived title, a model title, and proof a user rename survives the title job.
//
// Throwaway users (auth.users insert → signup trigger seeds public.users), cleaned up on exit (cascade).
//   npx tsx src/scripts/verify-chat.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { createThrowawayUser } from "./lib/throwaway-user.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { __setDefaultChatProviderForTests, runChatTurn } from "../chat/engine.js";
import { resolveOpening } from "../chat/openings.js";
import { composeDiscussOpening } from "../chat/compose.js";
import type { DiscussContext } from "../chat/discuss-context.js";
import { scanExplanationText } from "../ai/core/guardrail.js";
import { checkAndConsumeAiCall, userScopeOf } from "../ai/core/quota.js";
import { resolveChatModel } from "../chat/config.js";
import { runRetention } from "../retention/engine.js";
import { EXEMPTIONS } from "../retention/policy.js";
import { renameSession as renameSessionSvc } from "../chat/sessions.js";
import { handleChatTitleGenerate } from "../jobs/handlers/chat-title-generate.handler.js";
import type { AiProvider, AiGenerateRequest, AiGenerateResult, TokenUsage } from "../ai/types.js";
import type { JobContext } from "../jobs/context.js";
import type { ChatTitleGeneratePayload } from "../jobs/types.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n══ ${t} ══`);

// ── A scripted provider — deterministic in-voice replies, so the HTTP conversation reads realistically
//    and the guardrail path is exactly controllable. Set as the default via the engine's test seam. ──
function scriptedProvider(): AiProvider & { queue: string[] } {
  const queue: string[] = [];
  const provider: AiProvider & { queue: string[] } = {
    queue,
    async generate(req: AiGenerateRequest): Promise<AiGenerateResult> {
      const text = queue.shift() ?? "[scripted:empty]";
      const promptChars = req.messages.reduce((n, m) => n + m.content.length, 0) + (req.system?.length ?? 0);
      const usage: TokenUsage = {
        promptTokens: Math.ceil(promptChars / 4),
        outputTokens: Math.ceil(text.length / 4),
        cachedTokens: 0,
        cacheHit: false,
        modelVersion: "scripted-chat-1",
      };
      return { text, usage };
    },
    async generateStructured() {
      throw new Error("scripted provider: generateStructured not used by chat");
    },
    async ping() {
      return true;
    },
  };
  return provider;
}

// ── throwaway users ──
const authIds: string[] = [];
async function newUser(tag: string): Promise<string> {
  // Shared helper: sweeps leftovers from previous interrupted runs on first call (scripts/lib/throwaway-user.ts).
  const { authId } = await createThrowawayUser(`chat-${tag}`);
  authIds.push(authId);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error(`signup trigger did not seed public.users for ${tag}`);
  return u.id;
}

// ── HTTP: a real listener mounting the REAL router behind a stub auth (JWT verification is proven in the
//    auth build and unchanged here; the seeded authUser is exactly what requireAuth would attach). ──
function bootApp(userIdRef: { id: string }) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(
    "/api/v1/me",
    (req, _res, next) => {
      (req as express.Request).authUser = { userId: userIdRef.id, authUserId: "auth-" + userIdRef.id, email: "t@test.local", role: "user" };
      next();
    },
    meChatRouter,
  );
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}
async function api(base: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + "/api/v1/me" + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    throw new Error(`non-JSON ${res.status} from ${method} ${path}: ${text.slice(0, 200)}`);
  }
}

const SYMBOL = "HDFCBANK";

/**
 * Every counter row for `model` — the global scope plus every `user:*:<model>` scope, across all windows.
 * Keyed for a MONOTONICITY check in section 8.
 *
 * ★ WHY THIS ASSERTS "NOTHING WAS LOST", NOT "NOTHING CHANGED". The first version compared a
 * byte-for-byte fingerprint before/after, and it failed — correctly detecting a change, but not one this
 * suite caused. Root-caused: the suite ENQUEUES real `chat_title_generate` jobs, and if a dev server is
 * running, ITS worker process picks them up and meters a real (tiny) Gemini call there — where
 * AI_PROVIDER is `.env`'s `gemini`, immune to the `mock` this process forces. Counter rows can therefore
 * legitimately INCREASE mid-suite through no fault of the suite.
 *
 * The bug being guarded against was a wildcard DELETE. Its signature is a row VANISHING or a count going
 * BACKWARDS — never an increment. So that is exactly what is asserted, which makes the guard both precise
 * and immune to concurrent legitimate traffic. tokenCount is a BigInt; compared as such.
 */
type CounterRow = { key: string; callCount: number; tokenCount: bigint };
async function snapshotRealCounters(model: string): Promise<CounterRow[]> {
  const rows = await prisma.aiUsageCounter.findMany({
    where: { OR: [{ scope: model }, { scope: { endsWith: `:${model}` } }] },
    select: { scope: true, windowKey: true, callCount: true, tokenCount: true },
    orderBy: [{ scope: "asc" }, { windowKey: "asc" }],
  });
  return rows.map((r) => ({ key: `${r.scope}|${r.windowKey}`, callCount: r.callCount, tokenCount: r.tokenCount }));
}

/** Rows that DISAPPEARED, or whose counts went BACKWARDS — the wildcard-DELETE signature. */
function counterRegressions(before: CounterRow[], after: CounterRow[]): string[] {
  const now = new Map(after.map((r) => [r.key, r]));
  const out: string[] = [];
  for (const b of before) {
    const a = now.get(b.key);
    if (!a) { out.push(`${b.key} — ROW DELETED (was callCount=${b.callCount})`); continue; }
    if (a.callCount < b.callCount) out.push(`${b.key} — callCount went BACKWARDS ${b.callCount} → ${a.callCount}`);
    if (a.tokenCount < b.tokenCount) out.push(`${b.key} — tokenCount went BACKWARDS ${b.tokenCount} → ${a.tokenCount}`);
  }
  return out;
}

async function main() {
  // ★ THIS SUITE IS UNMETERED, AND NOW SAYS SO IN CODE RATHER THAN IN A COMMENT.
  //
  // ⚠ It previously inherited AI_PROVIDER from .env — which is `gemini` — so `mockByConfig()` was false
  // and EVERY section consumed real units from the shared per-model budget, for generations that never
  // left the process (the engine runs on the scripted provider below). Section 8 then printed
  // "units spent: 0", which was simply untrue. Forcing `mock` here is what makes that claim correct:
  // spendFor returns the unmetered decision, and recordAiTokens is skipped via servedByMock.
  // Section 5b flips this to `gemini` for exactly as long as it needs a real denial, then puts it back.
  process.env.AI_PROVIDER = "mock";

  // Baseline every counter row belonging to the REAL chat model — the global scope AND every per-user
  // scope for it — so section 8 can PROVE, rather than assert, that this suite left them alone. This is
  // the standing regression guard for the wildcard-DELETE bug fixed in 5b.
  const realModel = resolveChatModel();
  const realCountersBefore = await snapshotRealCounters(realModel);

  const sp = scriptedProvider();
  __setDefaultChatProviderForTests(sp);

  // ═══════════════════════════════════════════════════════════════
  section("1 · Tables + retention policy row");
  {
    const cs = await prisma.chatSession.count();
    const cm = await prisma.chatMessage.count();
    ok("chat_sessions + chat_messages queryable", Number.isInteger(cs) && Number.isInteger(cm), `sessions=${cs} messages=${cm}`);
    const pol = await prisma.$queryRawUnsafe<any[]>(
      `SELECT mode, days, floor, ts_column, except_where, enabled, armed FROM retention_policy WHERE table_name='chat_sessions'`,
    );
    const p = pol[0];
    ok("retention row: time/last_message_at/1d, except_where=unpromoted_only, enabled=true, armed=false",
      !!p && p.mode === "time" && p.ts_column === "last_message_at" && Number(p.days) === 1 && p.except_where === "unpromoted_only" && p.enabled === true && p.armed === false,
      p ? `days=${p.days} except=${p.except_where} armed=${p.armed}` : "missing");
    ok("unpromoted_only exemption registered in the engine", EXEMPTIONS.unpromoted_only?.deleteClause?.includes(`"promoted" = false`),
      EXEMPTIONS.unpromoted_only?.deleteClause);
  }

  const stock = await prisma.stock.findUnique({ where: { symbol: SYMBOL }, select: { id: true, name: true } });
  if (!stock) throw new Error(`${SYMBOL} not found — pick a scored stock present in this DB`);

  // ═══════════════════════════════════════════════════════════════
  section("3 · Each composed opening ask, VERBATIM (all five surfaces)");
  const SURation: { key: string; ctx: DiscussContext }[] = [
    { key: "stock_health", ctx: { surface: "stock_health", subject: { kind: "stock", symbol: SYMBOL }, label: "Discuss this read", detail: { band: "Healthy" } } },
    { key: "finding", ctx: { surface: "finding", subject: { kind: "finding", symbol: SYMBOL, name: "Promoter pledging" }, label: "Ask about this finding", detail: { name: "Promoter pledging" } } },
    { key: "metric_verdict", ctx: { surface: "metric_verdict", subject: { kind: "stock", symbol: SYMBOL }, label: "Explain this metric", detail: { metric: "Net Interest Margin" } } },
    { key: "portfolio_health", ctx: { surface: "portfolio_health", subject: { kind: "portfolio", name: "Your portfolio" }, label: "Discuss my portfolio" } },
    { key: "concept", ctx: { surface: "concept", subject: { kind: "stock", symbol: SYMBOL, name: "Return on Capital Employed" }, label: "What is this?" } },
  ];
  for (const s of SURation) {
    const r = resolveOpening(s.ctx);
    console.log(`\n┌─ surface="${s.key}"  (grounding=${r.spec.grounding}, subjectLabel="${r.subjectLabel}", derivedTitle="${r.spec.deriveTitle(s.ctx, r.subjectLabel)}")`);
    console.log(r.spec.buildAsk(s.ctx, r.subjectLabel).split("\n").map((l) => "│ " + l).join("\n"));
    console.log("└─");
    ok(`opening "${s.key}" composed (non-empty, no leaked {placeholders})`, r.spec.buildAsk(s.ctx, r.subjectLabel).length > 50 && !r.spec.buildAsk(s.ctx, r.subjectLabel).includes("{"));
  }
  // Prove the concept branch carries NO fact block / NO closed-world header, and stock DOES.
  {
    const uTmp = await newUser("compose");
    const stockComposed = await composeDiscussOpening(uTmp, SURation[0].ctx);
    const conceptComposed = await composeDiscussOpening(uTmp, SURation[4].ctx);
    ok("stock opening message[0] carries the CLOSED-WORLD fact block", stockComposed.openingUserContent.includes("ONLY facts available") && stockComposed.openingUserContent.includes(`FACTS: ${SYMBOL}`));
    ok("stock opening message[0] carries the [ABOUT THE READER] orientation header", stockComposed.openingUserContent.includes("[ABOUT THE READER]"));
    ok("stock opening message[0] carries the [YOUR RELATIONSHIP TO THIS STOCK] block", stockComposed.openingUserContent.includes("[YOUR RELATIONSHIP TO THIS STOCK]"));
    ok("★ concept opening carries NO fact block and NO closed-world header (the branch that proves the rule)", !conceptComposed.openingUserContent.includes("ONLY facts available") && !conceptComposed.openingUserContent.includes("=== FACTS"));
    // show the assembled stock opening with the fact block truncated for readability
    const lines = stockComposed.openingUserContent.split("\n");
    const factEnd = lines.findIndex((l) => l.includes("[ABOUT THE READER]"));
    console.log(`\n── assembled stock opening message[0] (fact block truncated) ──`);
    console.log(lines.slice(0, 6).join("\n"));
    console.log(`   …[${factEnd - 7} more fact lines]…`);
    console.log(lines.slice(factEnd).join("\n").slice(0, 1400));
  }

  // ═══════════════════════════════════════════════════════════════
  section("2 · A real conversation over HTTP, VERBATIM");
  const mainUser = await newUser("main");
  // Give the reader a watch relationship so the personalization is non-trivial (a "deciding" posture).
  await prisma.watchlist.create({ data: { userId: mainUser, stockId: stock.id, pinnedHealth: 65, pinnedBand: "steady" } });

  const OPENING_REPLY =
    "What's carrying HDFCBANK's health is mostly the durable quality of the bank itself — how well it turns capital into profit and the cushion of capital it holds against its loan book; Vytal groups that into the Foundation pillar. Softer right now is the trajectory of those fundamentals — the pace of earnings and margin improvement has cooled — which is the Momentum pillar. The Market pillar reads only the share price's own behaviour, and Ownership looks at who holds the bank and how firmly. In plain terms: a fundamentally sound bank whose recent momentum has flattened. Want me to open up any one of those?";
  const FOLLOWUP1_REPLY =
    "Momentum here is about the TRAJECTORY of the fundamentals, never the share price. It asks whether earnings, revenue and margins are still improving and steady, or slipping and choppy. So a bank can have a rising share price while its Momentum reading falls, if the underlying growth is decelerating. It is fundamental momentum, not an RSI or a price chart.";
  const FOLLOWUP2_REPLY =
    "A flattening Momentum pillar means the pace of improvement in the underlying fundamentals has slowed — earnings and margins are steady rather than accelerating. It describes what is happening now; it is not a prediction of where the price goes, and I can't tell you what to do about it. What I can do is walk through which specific fundamentals drove the change, if that would help.";
  // guardrail sanity: the three scripted replies must themselves pass the guardrail (else they'd regenerate)
  for (const [i, t] of [OPENING_REPLY, FOLLOWUP1_REPLY, FOLLOWUP2_REPLY].entries()) {
    ok(`scripted reply ${i + 1} is guardrail-clean`, scanExplanationText(t).clean);
  }
  sp.queue.push(OPENING_REPLY, FOLLOWUP1_REPLY, FOLLOWUP2_REPLY);

  const userRef = { id: mainUser };
  const { server, base } = bootApp(userRef);
  let sidebarSessionId = "";
  try {
    // OPEN (sidebar) — composes + runs the opening exchange
    const open = await api(base, "POST", "/chat/sessions", SURation[0].ctx);
    sidebarSessionId = open.json?.data?.session?.id;
    ok("POST /chat/sessions → 201, session created, resumed=false", open.status === 201 && !!sidebarSessionId && open.json.data.resumed === false, `title="${open.json?.data?.session?.title}"`);
    ok("opening exchange present (1 assistant opening, user scaffolding hidden)", open.json.data.messages.length === 1 && open.json.data.messages[0].role === "assistant" && open.json.data.messages[0].isOpening === true);
    console.log(`\n  [session ${sidebarSessionId}]  title: "${open.json.data.session.title}"  subject: ${open.json.data.session.subjectSymbol}`);
    console.log(`\n  🟦 ASSISTANT (opening):\n${wrap(open.json.data.messages[0].content)}`);
    console.log(`     ↳ metering: ${JSON.stringify(open.json.data.messages[0].usage)}  guardrailBlocked=${open.json.data.messages[0].guardrailBlocked}`);

    // FOLLOW-UP 1
    const f1 = await api(base, "POST", `/chat/sessions/${sidebarSessionId}/messages`, { message: "What is the Momentum pillar actually measuring?" });
    ok("POST first follow-up → 200 + reply", f1.status === 200 && !!f1.json?.data?.reply);
    console.log(`\n  🟩 USER: What is the Momentum pillar actually measuring?`);
    console.log(`  🟦 ASSISTANT:\n${wrap(f1.json.data.reply.content)}`);

    // FOLLOW-UP 2 (a leading question — the reply must stay descriptive)
    const f2 = await api(base, "POST", `/chat/sessions/${sidebarSessionId}/messages`, { message: "Does the flattening momentum mean I should be worried?" });
    ok("POST second follow-up → 200 + reply", f2.status === 200 && !!f2.json?.data?.reply);
    console.log(`\n  🟩 USER: Does the flattening momentum mean I should be worried?`);
    console.log(`  🟦 ASSISTANT:\n${wrap(f2.json.data.reply.content)}`);

    // GET the whole session — show the full visible transcript shape
    const get = await api(base, "GET", `/chat/sessions/${sidebarSessionId}`);
    ok("GET /chat/sessions/:id → full transcript (opening + 2 exchanges = 5 visible msgs)", get.status === 200 && get.json.data.messages.length === 5,
      `roles=[${get.json.data.messages.map((m: any) => m.role).join(",")}]`);
    ok("promotion: session flipped promoted=true after the follow-ups", get.json.data.session.promoted === true);

    // IDOR: another user cannot read this session
    const other = await newUser("idor");
    userRef.id = other; // the stub auth now presents a DIFFERENT user
    const steal = await api(base, "GET", `/chat/sessions/${sidebarSessionId}`);
    ok("IDOR: a non-owner GET on the session → 404", steal.status === 404);
    userRef.id = mainUser;

    // ═══════════════════════════════════════════════════════════════
    section("4 · Lifecycle — resume / expiry / promotion / visibility");
    // RESUME within 24h — same subject → same session
    const resume = await api(base, "POST", "/chat/sessions", SURation[0].ctx);
    ok("resume within 24h → SAME session id, resumed=true, no new opening", resume.status === 200 && resume.json.data.session.id === sidebarSessionId && resume.json.data.resumed === true);

    // NEW after 24h — backdate lastMessageAt, then re-open → a different session
    await prisma.chatSession.update({ where: { id: sidebarSessionId }, data: { lastMessageAt: new Date(Date.now() - 25 * 3600 * 1000) } });
    sp.queue.push("A fresh opening for the expired-sidebar case.");
    const after = await api(base, "POST", "/chat/sessions", SURation[0].ctx);
    ok("after 24h → a NEW session (the old one no longer resumes in the sidebar)", after.status === 201 && after.json.data.session.id !== sidebarSessionId && after.json.data.resumed === false);
    const freshId = after.json.data.session.id;

    // The backdated-but-promoted session STILL exists (promoted survives even when the sidebar can't resume it)
    const oldStill = await prisma.chatSession.findUnique({ where: { id: sidebarSessionId }, select: { promoted: true } });
    ok("two clocks: the promoted session persists past its 24h resume window", oldStill?.promoted === true);

    // PROMOTION granularity — a brand-new sidebar session is unpromoted until the first follow-up
    sp.queue.push("Opening for the promotion-granularity check.");
    const promoUser = await newUser("promo");
    userRef.id = promoUser;
    const p1 = await api(base, "POST", "/chat/sessions", SURation[0].ctx);
    const promoId = p1.json.data.session.id;
    ok("fresh sidebar session starts promoted=false", p1.json.data.session.promoted === false);
    sp.queue.push("A reply to the very first follow-up, which promotes the session.");
    await api(base, "POST", `/chat/sessions/${promoId}/messages`, { message: "One quick question about Foundation." });
    const promoted = await prisma.chatSession.findUnique({ where: { id: promoId }, select: { promoted: true } });
    ok("promotion flips on the FIRST non-opening message (one is enough)", promoted?.promoted === true);

    // VISIBILITY filter — GET list shows promoted discuss + all chat_page; NOT unpromoted discuss
    userRef.id = mainUser;
    sp.queue.push("Opening for an UNPROMOTED session that must stay out of the list.");
    const unpromoUser = await newUser("unpromo");
    userRef.id = unpromoUser;
    const up = await api(base, "POST", "/chat/sessions", SURation[0].ctx);
    const unpromotedId = up.json.data.session.id;
    const listUnpromo = await api(base, "GET", "/chat/sessions");
    ok("visibility: an UNPROMOTED discuss session is ABSENT from the chat-page list", listUnpromo.json.data.sessions.every((s: any) => s.id !== unpromotedId) && listUnpromo.json.data.count === 0);
    // promote it, then it appears
    sp.queue.push("A reply that promotes the previously-hidden session.");
    await api(base, "POST", `/chat/sessions/${unpromotedId}/messages`, { message: "Follow-up that promotes me." });
    const listPromo = await api(base, "GET", "/chat/sessions");
    ok("visibility: once PROMOTED, the same session APPEARS in the list", listPromo.json.data.sessions.some((s: any) => s.id === unpromotedId) && listPromo.json.data.count === 1);
    userRef.id = mainUser;
    void freshId;

    // ═══════════════════════════════════════════════════════════════
    section("5b · The honest 'unavailable' state over HTTP (spend denied → persist nothing)");
    {
      // A FRESH user (no resumable session, so the open must CREATE → it hits the spend gate).
      const unavailUser = await newUser("unavail");
      userRef.id = unavailUser;
      const before = await prisma.chatSession.count({ where: { userId: unavailUser } });

      // ═══════════════════════════════════════════════════════════════════════════════════════════
      // ★ THIS TEST METERS FOR REAL, SO IT METERS AGAINST A MODEL THAT DOES NOT EXIST.
      //
      // ⚠ WHAT THE OLD VERSION DID, AND WHY IT WAS A BUG. It exhausted the counter for the REAL chat
      // model and then cleaned up with `DELETE FROM ai_usage_counters WHERE scope LIKE
      // '%gemini-3.5-flash-lite'`. That wildcard matches the GLOBAL scope `gemini-3.5-flash-lite` AND
      // every `user:<uuid>:gemini-3.5-flash-lite`, with no window filter — so it deleted the real
      // shared RPD counter and every real user's sub-counter, for every window. Measured: it wiped a
      // live user's CURRENT-window row (27 metered generations that day) plus the global row at 44
      // calls. `ai_usage_counters` HOLDS REAL CONSUMPTION — it is what the free-tier RPD and both
      // ceilings are checked against — so resetting it mid-window silently un-caps the gate.
      //
      // The old comment claimed "mock is the normal provider so there is no real gemini usage in this
      // DB to disturb". That was true in the card era; `.env` now carries AI_PROVIDER=gemini and every
      // chat turn meters, so it is false. The code was right for a world that has changed.
      //
      // THE PATTERN (verify-ai-quota-subcap.ts, followed exactly): use a FAKE, UNLISTED model id so
      // every row this test creates is synthetic, and clean up by an EXPLICIT scope list — never a
      // wildcard. `AI_CHAT_MODEL` is re-read per call (chat/config.ts), so pointing it at a fake id
      // makes the endpoint under test meter into scopes that cannot collide with anything real.
      // ═══════════════════════════════════════════════════════════════════════════════════════════
      const FAKE_MODEL = "verify-chat-unavail-model"; // unlisted ⇒ gated at quota.ts's conservative fallback
      const FAKE_SCOPES = [FAKE_MODEL, userScopeOf(unavailUser, FAKE_MODEL)];
      const savedProvider = process.env.AI_PROVIDER;
      const savedChatModel = process.env.AI_CHAT_MODEL;
      process.env.AI_PROVIDER = "gemini"; // spendFor METERS (mockByConfig=false); the engine still uses the scripted test provider
      process.env.AI_CHAT_MODEL = FAKE_MODEL; // …and it meters into a scope no real caller ever uses
      try {
        // Exhaust the fake model's global budget, WHATEVER it is: loop until the gate itself says no.
        // Self-calibrating on purpose — the old version hard-coded a budget of 1 via an env override,
        // which silently stops working the moment the budget resolution changes. Bounded so a gate that
        // never denies fails the run loudly instead of spinning.
        let consumed = 0;
        for (;;) {
          const d = await checkAndConsumeAiCall(FAKE_MODEL, { kind: "system", job: "verify-exhaust" });
          if (!d.allowed) break;
          if (++consumed > 200) throw new Error(`${FAKE_MODEL} budget never exhausted — the spend gate is not denying`);
        }
        const denied = await api(base, "POST", "/chat/sessions", SURation[0].ctx);
        ok("spend denied → 200 with an honest unavailable state (session=null)", denied.status === 200 && denied.json.data.session === null && !!denied.json.data.unavailable, `reason=${denied.json?.data?.unavailable?.reason} scope=${denied.json?.data?.unavailable?.scopeDenied}`);
        const afterCount = await prisma.chatSession.count({ where: { userId: unavailUser } });
        ok("unavailable → PERSIST NOTHING (no session, no messages created)", afterCount === before && afterCount === 0);
      } finally {
        if (savedChatModel === undefined) delete process.env.AI_CHAT_MODEL; else process.env.AI_CHAT_MODEL = savedChatModel;
        // ★ RESTORE TO MOCK, NOT TO THE .env VALUE. The rest of this suite runs on the scripted test
        // provider, so metering it would consume real shared budget for calls that never leave the
        // process — and would make section 8's "units spent: 0" a false claim. `mock` is what the whole
        // suite is entitled to assume (see the forced default at the top of main).
        process.env.AI_PROVIDER = "mock";
        void savedProvider; // deliberately NOT restored — see above
        // Cleanup by EXPLICIT SCOPE: only the two rows this test created can possibly match.
        await prisma.aiUsageCounter.deleteMany({ where: { scope: { in: FAKE_SCOPES } } });
      }
      userRef.id = mainUser;
    }

    // ═══════════════════════════════════════════════════════════════
    section("7 · Titling — derived · model · user-rename survives the job");
    {
      // derived (from the sidebar open, already asserted title). Re-read to show it.
      const derivedTitleSession = await prisma.chatSession.findUnique({ where: { id: sidebarSessionId }, select: { title: true, titleSource: true } });
      ok("card-originated title is DERIVED immediately (no model call)", derivedTitleSession?.titleSource === "derived" && derivedTitleSession.title === `${SYMBOL} — health read`, `"${derivedTitleSession?.title}"`);

      // chat-page → provisional derived title, then the model title job replaces it
      const cp = await api(base, "POST", "/chat/sessions", {}); // chat_page: empty body
      const cpId = cp.json.data.session.id;
      ok("chat-page open → new session, promoted=true (permanent), provisional title", cp.status === 201 && cp.json.data.session.promoted === true && cp.json.data.session.origin === "chat_page");
      sp.queue.push("A general reply about what a P/E ratio is.");
      await api(base, "POST", `/chat/sessions/${cpId}/messages`, { message: "Can you explain what a P/E ratio is in simple terms?" });
      const provisional = await prisma.chatSession.findUnique({ where: { id: cpId }, select: { title: true, titleSource: true } });
      ok("chat-page first message → provisional derived title (truncated first message)", provisional?.titleSource === "derived" && /P\/E ratio/i.test(provisional?.title ?? ""), `"${provisional?.title}"`);

      // run the title job with a scripted clean title
      sp.queue.push("Understanding the P/E ratio");
      await handleChatTitleGenerate(mkJobCtx({ sessionId: cpId }));
      const titled = await prisma.chatSession.findUnique({ where: { id: cpId }, select: { title: true, titleSource: true } });
      ok("title job writes a MODEL title, titleSource=model", titled?.titleSource === "model" && titled.title === "Understanding the P/E ratio", `"${titled?.title}"`);

      // user rename must survive the job
      const cp2 = await api(base, "POST", "/chat/sessions", {});
      const cp2Id = cp2.json.data.session.id;
      sp.queue.push("A reply about diversification.");
      await api(base, "POST", `/chat/sessions/${cp2Id}/messages`, { message: "What does diversification actually protect against?" });
      await renameSessionSvc(mainUser, cp2Id, "My renamed thread");
      sp.queue.push("This model title MUST be ignored");
      const jobResult = await handleChatTitleGenerate(mkJobCtx({ sessionId: cp2Id }));
      const afterRename = await prisma.chatSession.findUnique({ where: { id: cp2Id }, select: { title: true, titleSource: true } });
      ok("★ a user rename SURVIVES the title job (title + titleSource untouched)", afterRename?.titleSource === "user" && afterRename.title === "My renamed thread", `job=${JSON.stringify(jobResult)} title="${afterRename?.title}"`);
    }
  } finally {
    server.close();
  }

  // ═══════════════════════════════════════════════════════════════
  section("5a · Guardrail — advice → regeneration → fixed redirect (engine-level, deterministic)");
  {
    const ADVICE = "Given the strong Foundation, you should add to this position at these levels before the next results.";
    ok("the advice string trips a HARD guardrail term", !scanExplanationText(ADVICE).clean, scanExplanationText(ADVICE).hardHits.map((h) => h.term).join(","));

    // advice → advice → the FIXED redirect (blocked)
    const gp1 = scriptedProvider();
    gp1.queue.push(ADVICE, ADVICE);
    const blocked = await runChatTurn(
      { model: "gemini-3.5-flash-lite", system: "sys", messages: [{ role: "user", content: "should I buy?" }], actor: { kind: "user", userId: "x" }, subjectLabel: SYMBOL },
      { provider: gp1, spend: async () => ({ allowed: true, remaining: 9, limit: 9, resetAt: new Date(), scopeDenied: null }) },
    );
    ok("advice twice → served the FIXED redirect, guardrailBlocked=true, regenerated=true", blocked.guardrailBlocked === true && blocked.regenerated === true && !!blocked.text);
    console.log(`\n  🔒 LAYER-3 REDIRECT (verbatim):\n${wrap(blocked.text ?? "")}`);

    // advice → clean retry → served the clean retry (regenerated, not blocked)
    const gp2 = scriptedProvider();
    const CLEAN_RETRY = "Foundation is the durable quality of the business — how profitably it turns capital into earnings and how solid the balance sheet is. That is what the pillar describes; it says nothing about what to do next.";
    ok("the clean retry passes the guardrail", scanExplanationText(CLEAN_RETRY).clean);
    gp2.queue.push(ADVICE, CLEAN_RETRY);
    const fixed = await runChatTurn(
      { model: "gemini-3.5-flash-lite", system: "sys", messages: [{ role: "user", content: "explain foundation" }], actor: { kind: "user", userId: "x" }, subjectLabel: SYMBOL },
      { provider: gp2, spend: async () => ({ allowed: true, remaining: 9, limit: 9, resetAt: new Date(), scopeDenied: null }) },
    );
    ok("advice → ONE regeneration → clean reply served (regenerated=true, blocked=false)", fixed.regenerated === true && fixed.guardrailBlocked === false && fixed.text === CLEAN_RETRY);

    // spend denied on attempt 1 → unavailable, nothing generated
    const gp3 = scriptedProvider();
    gp3.queue.push("should never be reached");
    const unavail = await runChatTurn(
      { model: "gemini-3.5-flash-lite", system: "sys", messages: [{ role: "user", content: "hi" }], actor: { kind: "user", userId: "x" }, subjectLabel: SYMBOL },
      { provider: gp3, spend: async () => ({ allowed: false, remaining: 0, limit: 20, resetAt: new Date(), scopeDenied: "user", reason: "user_daily_limit_reached" }) },
    );
    ok("spend denied on attempt 1 → status=unavailable, text=null, provider untouched", unavail.status === "unavailable" && unavail.text === null && gp3.queue.length === 1);
  }

  // ═══════════════════════════════════════════════════════════════
  section("6 · Retention — the unpromoted_only exemption protects promoted sessions (dry-run)");
  {
    const rUser = await newUser("retain");
    // one unpromoted + one promoted session, BOTH expired (last_message_at 2 days old)
    const expired = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    const mkSession = async (promoted: boolean) => {
      const s = await prisma.chatSession.create({
        data: { userId: rUser, origin: "discuss", surface: "stock_health", subjectKind: "stock", subjectSymbol: SYMBOL, subjectName: stock.name, title: "t", titleSource: "derived", promoted, lastMessageAt: expired },
      });
      return s.id;
    };
    const unpromotedExpired = await mkSession(false);
    const promotedExpired = await mkSession(true);

    const rawFalse = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM chat_sessions WHERE last_message_at < now() - interval '1 day' AND promoted = false`);
    const rawTrue = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM chat_sessions WHERE last_message_at < now() - interval '1 day' AND promoted = true`);
    const nFalse = Number(rawFalse[0].n);
    const nTrue = Number(rawTrue[0].n);

    const report = await runRetention({ dryRun: true, only: ["chat_sessions"] });
    const cr = report.results.find((r) => r.table === "chat_sessions");
    ok("retention run found the chat_sessions rule (mode=time, exemption=unpromoted_only)", !!cr && cr.mode === "time" && cr.exemption === "unpromoted_only");
    ok("dry-run matched EXACTLY the unpromoted-expired rows (promoted excluded by the exemption)", cr!.matched === nFalse, `matched=${cr!.matched} unpromoted_expired=${nFalse} promoted_expired(spared)=${nTrue}`);
    ok("at least one PROMOTED expired session exists and was SPARED (not matched)", nTrue >= 1 && cr!.matched < nFalse + nTrue);
    ok("dry-run + unarmed → deleted nothing, armed=false", cr!.deleted === 0 && cr!.armed === false);
    // prove the spared promoted session is still on disk
    const stillThere = await prisma.chatSession.findUnique({ where: { id: promotedExpired }, select: { id: true } });
    ok("the promoted expired session is still present after the dry-run", !!stillThere);
    void unpromotedExpired;
  }

  // ═══════════════════════════════════════════════════════════════
  section("8 · Summary");
  // ★ MEASURED, NOT CLAIMED. This line used to be a hard-coded "0" that read nothing — which is how a
  // suite that was in fact consuming real units, and deleting real counter rows, went on reporting that
  // it spent none. Now the real model's rows are diffed against the baseline taken before section 1.
  const realCountersAfter = await snapshotRealCounters(realModel);
  const regressions = counterRegressions(realCountersBefore, realCountersAfter);
  ok(
    `★ no REAL counter row for ${realModel} was deleted or reset by this suite (wildcard-DELETE regression guard)`,
    regressions.length === 0,
    regressions.length === 0
      ? `${realCountersBefore.length} row(s) all still present, counts monotonic`
      : `REGRESSED —\n    ${regressions.join("\n    ")}`,
  );
  // Any INCREASE is reported, not failed: an out-of-process worker (a running dev server draining the
  // chat_title_generate jobs this suite enqueues) meters legitimately and is not this suite's doing.
  const grew = realCountersAfter
    .map((a) => { const b = realCountersBefore.find((x) => x.key === a.key); return b && a.callCount > b.callCount ? `${a.key}: ${b.callCount}→${a.callCount}` : null; })
    .filter(Boolean);
  if (grew.length) {
    console.log(`  ⓘ counters INCREASED during the run (not this process): ${grew.join(", ")}`);
    console.log(`    → a dev server is running and its worker drained the enqueued chat_title_generate job(s), spending real units.`);
  }
  console.log(`  units spent by THIS process (real Gemini calls): 0 — it forces AI_PROVIDER=mock, so spendFor is unmetered`);
  console.log(failures === 0 ? `\n✅ ALL CHAT PROOFS PASSED` : `\n❌ ${failures} CHECK(S) FAILED`);
}

// ── helpers ──
function wrap(s: string, width = 108): string {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      if ((line + " " + word).trim().length > width) {
        out.push("     " + line.trim());
        line = word;
      } else line += " " + word;
    }
    if (line.trim()) out.push("     " + line.trim());
  }
  return out.join("\n");
}
function mkJobCtx(payload: ChatTitleGeneratePayload): JobContext<ChatTitleGeneratePayload> {
  return {
    jobId: "verify-title",
    payload,
    signal: new AbortController().signal,
    async reportProgress() {},
    async shouldCancel() {
      return false;
    },
  };
}

async function cleanup() {
  __setDefaultChatProviderForTests(null);
  for (const authId of authIds) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId);
    } catch (e) {
      console.warn(`cleanup failed for ${authId}:`, (e as Error).message);
    }
  }
}

main()
  .catch((e) => {
    console.error("\n💥 harness error:", e);
    failures++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
