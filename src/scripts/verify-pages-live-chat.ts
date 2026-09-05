// ─────────────────────────────────────────────────────────────────────────────
// LIVE VERIFICATION — §THE PAGES (context-layer 1.2) + EXPLANATORY_DEPTH (tone.ts).
//
// ★ WHY THIS IS A LIVE SCRIPT AND NOT A FIXTURE. The change being proved is a BEHAVIOURAL one:
// the model used to invent product limitations to explain its own ignorance ("Vytal doesn't have a
// standalone divergence tool"). A hand-built fixture cannot prove a real model stopped doing that —
// it can only prove the string is present in the prompt, which was never in doubt. So this runs the
// REAL chat endpoints against the REAL provider (AI_PROVIDER=gemini), same code path as
// measure-chat-gemini.ts, and prints every reply VERBATIM for reading.
//
// It asserts only what is mechanically checkable (a phrase present / absent, a length bound, no
// internal identifier leaked). The judgement calls — "is this proportionate?", "is this structured?"
// — are printed for a human, not asserted, because a regex that thinks it can judge tone is a regex
// that will pass a bad answer and fail a good one.
//
//   AI_PROVIDER=gemini npx tsx src/scripts/verify-pages-live-chat.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { scanExplanationText } from "../ai/core/guardrail.js";

process.env.AI_PROVIDER = "gemini";
if (!process.env.AI_CHAT_MODEL) process.env.AI_CHAT_MODEL = "gemini-3.5-flash-lite";
const MODEL = process.env.AI_CHAT_MODEL;

// ── INTERNAL IDENTIFIERS — 4k. Anything here appearing in a REPLY is a §8 breach. ──
// Service/function names, metric + finding codes, table names, pillar-key casing.
const INTERNAL_IDENTIFIERS: RegExp[] = [
  /buildDivergenceScan|stocks-list|scope-aggregate|groundStockHealth|resolveTone|probeStockRelationship/i,
  /\bhighLowPair\b|\bpickScoredPair\b|\bbuildSpread\b|\bfloorCheck\b|\bdivergenceConfig\b/i,
  /\b(?:LM|LP|PQ|PF)\d+\b/, // lens / portfolio finding codes
  /\btrajectory_[A-Z]\b|\bdivergence_C\d|\bcomposition_F\d|\blens_[a-z]{2}\d/,
  /\bprice_ahead\b|\bbelow_par\b|\blabelBand\b|\bfiredFlags\b|\bfiredPatterns\b|\btrajectoryMarker\b/,
  /user_object_views|behavior_rollup|stock_peer_groups|alert_events|portfolio_accounts/i,
  /\bUniverseHealthView\b|\bUniverseMemberView\b|\bLeanSnap\b|\bPhsBand\b/,
];

const authIds: string[] = [];
async function newUser(
  tag: string,
  aiLevel?: "plain" | "balanced" | "technical",
  financeDepth?: string,
  termComfort?: string,
): Promise<string> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `pagesv-${tag}-${authId}@test.local`);
  authIds.push(authId);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error(`signup trigger did not seed public.users for ${tag}`);
  // Onboarding rows drive resolveTone — this is how 4i gets a genuinely CONCISE reader.
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
  app.use(
    "/api/v1/me",
    (req, _res, next) => {
      (req as express.Request).authUser = { userId: userRef.id, authUserId: "auth-" + userRef.id, email: "t@test.local", role: "user" };
      next();
    },
    meChatRouter,
  );
  const server = app.listen(0);
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
async function api(base: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + "/api/v1/me" + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as any };
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`   ✅ ${label}`); }
  else { fail++; console.log(`   ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
function note(label: string, value: string) {
  console.log(`   · ${label}: ${value}`);
}

const totals = { p: 0, o: 0 };
function verbatim(text: string) {
  console.log("   ┌" + "─".repeat(104));
  for (const line of (text ?? "(empty)").split("\n")) console.log("   │ " + line);
  console.log("   └" + "─".repeat(104));
}

/**
 * Ask one question in its own fresh session; print the reply verbatim; return it.
 *
 * ⚠ PACED, AND A BLANK IS RETRIED — ADDED AFTER A RUN WHERE 9 OF 11 "FAILURES" WERE RATE LIMITING.
 * Google's free tier allows 15 requests/min, and a question that calls two tools spends three. When
 * the ceiling is hit the provider returns 429, the turn delivers "(no content)", and every content
 * assertion downstream fails — producing a report that reads exactly like a broken product. A blank is
 * not a result: it is retried past the window the API itself names, and only then recorded.
 */
const PACE_MS = Number(process.env.PAGES_LIVE_PACE ?? 21000);
const napAsk = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ask(base: string, sessionId: string, q: string): Promise<string> {
  console.log(`\n🟩 USER: ${q}`);
  await napAsk(PACE_MS);
  let r = await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: q });
  for (let attempt = 0; attempt < 2 && !(r.json?.data?.reply?.content ?? "").trim(); attempt++) {
    console.log(`   ⏳ blank reply — rate limiting, not an answer. Waiting 45s and retrying (${attempt + 1}/2).`);
    await napAsk(45000);
    r = await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: q });
  }
  const reply = r.json?.data?.reply;
  const text: string = reply?.content ?? "(no content)";
  const u = reply?.usage ?? {};
  totals.p += u.promptTokens ?? 0;
  totals.o += u.outputTokens ?? 0;
  verbatim(text);
  const words = text.trim().split(/\s+/).length;
  const headers = (text.match(/^#{1,6} |^\*\*[^*\n]+\*\*\s*$/gm) ?? []).length;
  note("shape", `${words} words · ${headers} headings · guardrail regenerated=${reply?.regenerated} blocked=${reply?.guardrailBlocked}`);
  const leaks = INTERNAL_IDENTIFIERS.filter((re) => re.test(text));
  check("no internal identifier in output (4k)", leaks.length === 0, leaks.map(String).join(", "));
  const g = scanExplanationText(text);
  check("guardrail clean on served text", g.clean, g.hardHits.map((h) => `${h.term}:"${h.match}"`).join(", "));
  // ── The two link defects found on the first live pass. Both are checked on EVERY reply,
  //    because neither was specific to the question that surfaced it.
  //    (a) An unresolved marker is deleted by the server, leaving a hole. The hole is what
  //        the reader sees, so the hole is what we assert against: a doubled space or a
  //        dangling preposition mid-sentence is the visible symptom of a dropped marker.
  check("no leftover hole from a dropped link marker", !/\S {2,}\S|\bon the\s+by\b|\bat the\s+by\b/.test(text));
  check("no raw {{link:…}} marker survived into the reply", !/\{\{link:/.test(text));
  //    (c) A FABRICATED WEB ADDRESS. Observed live after the "no marker" line was added: told not to
  //        write a marker for a page that has none, the model substituted an invented URL —
  //        "[Market pillar](https://vytal.in)", twice in one reply. Worse than a dead marker: a link
  //        the reader would actually trust, pointing nowhere they asked to go. Only real citation URLs
  //        from the news tool are legitimate, and those are server-rendered into a footer, never typed.
  //    ★ AND (added after the universe-scan build) A ROOT-RELATIVE PATH. The original regex used
  //        `](?!/)` — it EXCLUDED destinations starting with "/", on the assumption that those were
  //        ours. They are not: "[the Flags & Patterns tab](/portfolio)" is a path the MODEL typed, it
  //        resolves, and it lands on the WRONG page. Worse than a dead link, because a dead link is
  //        visible and this one is not. Measured 3-4 times per live run until the typed-path guard in
  //        chat/links.ts closed it; the check now covers BOTH shapes, so a regression in that guard
  //        surfaces here rather than in front of a reader. Server-built paths reach a reply only via a
  //        resolved marker or an appended footer, and both footers are exempted below.
  //    ⚠⚠ AND THE CHECK ITSELF WAS WRONG — IT FIRED ON SUCCESS. Measured: two failures on a run whose
  //        replies were perfect, `](/health-score)` and `](/research/peer-groups/<uuid>)`. Both were
  //        SERVER-built, from markers the model wrote correctly. The comment above claims footers are
  //        the only way a server path reaches a reply; that has never been true — a resolved INLINE
  //        marker is the ordinary way, and it is the behaviour the vocabulary asks for.
  //   ★ WORSE, THE CHECK BECAME UNFALSIFIABLE THE DAY `stripTypedPaths` SHIPPED. That guard removes
  //        every model-authored destination BEFORE substitution, so a `](/…)` surviving into delivered
  //        text is necessarily one the server built. "No path in the output" could then only ever mean
  //        "the model emitted no link at all" — the check rewarded silence and failed the feature.
  //        So it is inverted into an assertion with teeth: every in-app destination must match a shape
  //        chat/links.ts can actually BUILD. A typed `/admin/retention` or `/portfolio` on a stock
  //        answer still fails; a resolved marker passes; and a regression in the guard still surfaces
  //        here, because a typed path that is not a real path shape is exactly what it would let past.
  const SERVER_BUILT = new RegExp(
    "^(?:" +
      "/research/stock-screener/[^/?\\s]+(?:\\?tab=(?:overview|health|fundamentals|technical|activity|events|news))?" +
      "|/portfolio(?:\\?tab=(?:overview|holdings|performance|health|transactions|accounts))?" +
      "|/watchlist|/health-score" +
      "|/research/peer-groups/[^/?\\s]+" +
      "|/comparison/[^/?\\s]+-vs-[^/?\\s]+" +
    ")$",
  );
  const modelTypedDestination = (text.match(/\]\((?:\/[^)\s]*|https?:\/\/[^)\s]*|www\.[^)\s]*)\)|(?<!\()\bhttps?:\/\/\S+/gi) ?? [])
    .filter((u) => !/^\s*-\s*\[/.test(u))   // the server-rendered external-source footer is exempt
    .filter((u) => !/^\s*→\s*\[/.test(u))  // ...as is the server-rendered app-link footer
    // ...and so is any in-app destination this codebase's own path builders could have produced.
    .filter((u) => !SERVER_BUILT.test(u.replace(/^\]\(/, "").replace(/\)$/, "")));
  check("* no URL OR PATH typed by the model (observed defect, both shapes)",
    modelTypedDestination.length === 0 || /_The headlines below came from the public web/.test(text),
    modelTypedDestination.join(" "));
  //    (b) A stock link for a company the reader never named — an unrequested recommendation.
  //        Only asserted where the question named no company at all.
  return text;
}

/** A blank chat-page session (empty body — the /chat entry point). This is the surface a
 *  "what is this page" question really arrives on: no stock subject, no fact block, so the
 *  ONLY thing the model has to answer from is the context layer. That is exactly the test. */
async function openGeneral(base: string): Promise<string> {
  const o = await api(base, "POST", "/chat/sessions", {});
  if (o.status >= 400) throw new Error(`open failed ${o.status}: ${JSON.stringify(o.json).slice(0, 300)}`);
  const s = o.json?.data?.session?.id;
  const opening = o.json?.data?.messages?.[0];
  if (opening?.usage) { totals.p += opening.usage.promptTokens ?? 0; totals.o += opening.usage.outputTokens ?? 0; }
  return s;
}

const has = (t: string, ...needles: string[]) => needles.some((n) => new RegExp(n, "i").test(t));

async function counter(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COALESCE(SUM(call_count),0)::int AS n FROM ai_usage_counters WHERE scope = $1`, MODEL);
  return Number(rows[0].n);
}

async function run() {
  console.log(`\n████ LIVE — §THE PAGES + EXPLANATORY_DEPTH · model=${MODEL} ████`);
  const startUnits = await counter();
  const { server, base } = bootApp();

  try {
    // ══════════ 4a — "How does the divergence tool work?" ══════════
    console.log(`\n\n═════════ 4a · "How does the divergence tool work?" ─ must be pillar-spread, structured ═════════`);
    userRef.id = await newUser("4a");
    const t4a = await ask(base, await openGeneral(base), "How does the divergence tool work?");
    check("describes the highest-vs-lowest PILLAR gap", has(t4a, "highest", "lowest", "widest", "pillar"));
    check("names 'pillar'", /pillar/i.test(t4a));
    check("mentions the gap moving (widening/narrowing/holding)", has(t4a, "widen", "narrow", "holding", "steady", "closing"));
    check("does NOT deny price (ruling ④)", !/not (about|price)|isn'?t about price|nothing to do with price/i.test(t4a));
    check("is not a one-liner (>90 words)", t4a.trim().split(/\s+/).length > 90);

    // ══════════ 4b — "Does Vytal have a divergence tool?" ══════════
    console.log(`\n\n═════════ 4b · "Does Vytal have a divergence tool?" ─ confirm, PROPORTIONATE ═════════`);
    userRef.id = await newUser("4b");
    const t4b = await ask(base, await openGeneral(base), "Does Vytal have a divergence tool?");
    check("confirms it exists", has(t4b, "yes", "it does", "divergence"));
    check("does NOT deny", !/doesn'?t have|does not have|no,? (vytal|we|there)/i.test(t4b));
    check("★ PROPORTIONATE — under 180 words (3a)", t4b.trim().split(/\s+/).length < 180,
      `${t4b.trim().split(/\s+/).length} words`);
    check("★ PROPORTIONATE — at most 2 headings (3a)", (t4b.match(/^#{1,6} |^\*\*[^*\n]+\*\*\s*$/gm) ?? []).length <= 2);

    // ══════════ 4c — "Can Vytal screen stocks?" ══════════
    console.log(`\n\n═════════ 4c · "Can Vytal screen stocks?" ─ the PAIR, neither denied nor inflated ═════════`);
    userRef.id = await newUser("4c");
    const t4c = await ask(base, await openGeneral(base), "Can Vytal screen stocks?");
    check("★ points at the Health Hub", /health hub/i.test(t4c));
    check("does NOT flatly deny screening", !/can'?t screen|cannot screen|no screening|doesn'?t (have|offer) (a )?screen/i.test(t4c));
    check("does NOT inflate — no invented numeric-filter capability",
      !/filter by (roe|p\/e|pe ratio|market cap|any metric)|set (a )?threshold|enter a value/i.test(t4c));

    // ══════════ 4d — "Can I filter stocks by red flags?"  ← the ③ test ══════════
    console.log(`\n\n═════════ 4d · "Can I filter stocks by red flags?" ─ ③: must land on the Screen tab ═════════`);
    userRef.id = await newUser("4d");
    const t4d = await ask(base, await openGeneral(base), "Can I filter stocks by red flags?");
    check("★ points at the Health Hub / Screen", has(t4d, "health hub", "screen"));
    check("★ does NOT invent a limitation", !/can'?t|cannot|isn'?t possible|not able to|doesn'?t (support|allow)/i.test(t4d));

    // ══════════ 4e — "Where's Vytal's sector analysis?"  ← the ⑤ test ══════════
    console.log(`\n\n═════════ 4e · "Where's Vytal's sector analysis?" ─ ⑤: must land on Peer Groups ═════════`);
    userRef.id = await newUser("4e");
    const t4e = await ask(base, await openGeneral(base), "Where's Vytal's sector analysis?");
    check("★ names Peer Groups", /peer group/i.test(t4e));
    check("★ does NOT deny sector analysis exists",
      !/doesn'?t have (a )?sector|no sector analysis|does not (have|offer) sector/i.test(t4e));

    // ══════════ 4f — a page that does NOT exist ══════════
    //
    // ⚠ THIS PROBE COLLIDES WITH THE GUARDRAIL, AND THAT IS ITSELF THE FINDING. Explaining what
    // short-selling IS requires the phrase "sell the stock/shares", which is an advice deny-list
    // pattern (guardrail.ts). Observed live: the turn was BLOCKED and replaced with the canned
    // redirect, so the "did it invent a page?" question never got exercised. Kept anyway, because
    // the interaction is real and worth watching — but 4f2 below is the probe that actually tests
    // the behaviour, using an absent page whose explanation shares no vocabulary with the deny-list.
    console.log(`\n\n═════════ 4f · "Vytal's short-selling tracker" ─ must NOT invent a page ═════════`);
    userRef.id = await newUser("4f");
    const t4f = await ask(base, await openGeneral(base), "Tell me about Vytal's short-selling tracker.");
    const blocked4f = /I can explain what these numbers mean, but I can't tell you what to do/i.test(t4f);
    if (blocked4f) {
      note("guardrail intercepted", "advice deny-list fired on the explanation — assertions below are moot, see 4f2");
      check("★ blocked turn still shipped no invented page", !/short[- ]selling (tracker|page|tool) (shows|lets|tracks)/i.test(t4f));
    } else {
    // ⚠ "does not have" belongs here. The first cut of this regex omitted it and failed a reply that
    // read "Vytal does not have a short-selling tracker." — a correct answer marked wrong by a
    // too-narrow assertion. Denial has many surface forms; enumerate them, don't pick a favourite.
    check("★ says it cannot find it", has(t4f, "can'?t find", "cannot find", "don'?t (see|have)", "does not have",
      "doesn'?t have", "isn'?t", "not (a|one of)", "no such"));
    check("★ does NOT describe a short-selling page as if real",
      !/the short[- ]selling (tracker|page|tool) (shows|lets|tracks|displays)/i.test(t4f));
    check("offers a real alternative (does not just refuse)",
      has(t4f, "ownership", "activity", "health hub", "watchlist", "instead", "closest", "nearest"));
    // The first live pass linked {{link:stock:INFY:activity}} here — a company the reader never
    // mentioned, pulled in purely to have something to point at. An unrequested ticker offered as
    // "the closest thing" reads as a suggestion, which is exactly what the spine forbids.
    check("★ does NOT drag in an unmentioned company to link (observed defect)",
      !/\/research\/stock-screener\/[A-Z]/.test(t4f), (t4f.match(/\/research\/stock-screener\/[A-Z]+/) ?? [""])[0]);
    }

    // ══════════ 4f2 — the CLEAN absent-page probe (no deny-list collision) ══════════
    // ⚠ WORDED TO CLEAR THE DENY-LIST, deliberately. Two earlier probes died to it: the short-selling
    // one needs the phrase "sell the stock" to explain itself, and "I want to test a strategy on past
    // data" reads as trading intent. An absent-page probe has to carry NO trading verb at all, or it
    // measures the guardrail instead of the thing under test.
    console.log(`\n\n═════════ 4f2 · "a dividend yield ranking page" ─ the probe that actually reaches the model ═════════`);
    userRef.id = await newUser("4f2");
    const t4f2 = await ask(base, await openGeneral(base), "Does Vytal have a page that ranks companies by dividend yield?");
    check("★ says it cannot find it", has(t4f2, "can'?t find", "cannot find", "don'?t (see|have)", "does not have",
      "doesn'?t have", "isn'?t", "no such", "not (a|one of|something)", "no dedicated", "there is no", "^no\\b"));
    check("★ does NOT describe the absent page as if real",
      !/the dividend[- ]yield (page|tool|screen|ranking) (shows|lets|allows|ranks)/i.test(t4f2));
    check("★ does NOT invent a policy for the absence (THE original bug)",
      !/because vytal|vytal (deliberately|intentionally|doesn'?t believe|avoids)|by design,? vytal|since vytal (focuses|is)/i.test(t4f2));
    check("offers a real alternative", has(t4f2, "trajectory", "health hub", "divergence", "watchlist",
      "calendar", "results", "fundamentals", "closest", "nearest", "instead"));
    check("★ does NOT drag in an unmentioned company to link",
      !/\/research\/stock-screener\/[A-Z]/.test(t4f2));

    // ══════════ 4g — THE CRITICAL SEAM ══════════
    console.log(`\n\n═════════ 4g · ★ CRITICAL · explain + "which stocks right now" ─ full half + honest half ═════════`);
    userRef.id = await newUser("4g");
    const t4g = await ask(base, await openGeneral(base),
      "What is the divergence page and which stocks show it right now?");
    check("explanation half is real (pillar spread named)", /pillar/i.test(t4g) && has(t4g, "highest", "lowest", "gap", "widest"));
    check("★ honest cannot-look-that-up", has(t4g, "can'?t pull", "cannot pull", "can'?t look", "cannot look",
      "don'?t have (access|a way)", "can'?t (fetch|retrieve|list)", "not something i can", "unable to"));
    check("★ does NOT claim Vytal lacks the data (THE regression)",
      !/vytal (doesn'?t|does not) (have|run|offer|track|provide)|no such data|isn'?t available in vytal/i.test(t4g));
    check("★ does NOT fabricate a stock list — no ticker+number pairs",
      !/\b[A-Z]{3,12}\b\s*[—:-]\s*(gap\s*)?\d{1,2}(\.\d)?\b/.test(t4g));
    check("points the reader at the page to see it", has(t4g, "divergence page", "the page", "open", "head to", "you'?ll (see|find)"));

    // ══════════ 4h — the two-ladder rule ══════════
    console.log(`\n\n═════════ 4h · two-ladder rule ─ 74 is Pristine as a stock, Steady as a portfolio ═════════`);
    userRef.id = await newUser("4h");
    const s4h = await openGeneral(base);
    const t4h = await ask(base, s4h,
      "My portfolio health is 74 and one of my stocks is also 74. Are they both in the same band?");
    check("★ says NO / different ladders", has(t4h, "no", "different", "not the same", "two (different )?(scale|ladder)"));
    check("★ 74 as a STOCK is Pristine", /pristine/i.test(t4h));
    check("★ 74 as a PORTFOLIO is Steady", /steady/i.test(t4h));
    check("★ does NOT call the portfolio Pristine",
      !/portfolio[^.]{0,60}pristine|pristine[^.]{0,40}portfolio/i.test(t4h));

    // ══════════ 4i — ruling ①: a CONCISE reader gets a SHORT structured answer ══════════
    console.log(`\n\n═════════ 4i · ★ RULING ① · same question, CONCISE reader (plain/casual) ═════════`);
    userRef.id = await newUser("4i", "plain", "casual", "explain");
    const t4i = await ask(base, await openGeneral(base), "How does the divergence tool work?");
    const w4a = t4a.trim().split(/\s+/).length;
    const w4i = t4i.trim().split(/\s+/).length;
    note("length comparison", `default reader = ${w4a} words · concise reader = ${w4i} words`);
    // ⚠ NOT a grep for "pillar". A plain reader resolves to jargon:avoid, and the correct behaviour
    // there is to drop the product term — observed live: "the gap between a company's highest-scoring
    // PART and its lowest-scoring PART". Asserting the jargon would fail the answer for obeying the
    // jargon axis. What must survive the shorter setting is the MECHANISM, whatever it is called.
    check("★ still describes the highest-vs-lowest gap (mechanism survived the shorter setting)",
      /highest[- ]scoring|strongest/i.test(t4i) && /lowest[- ]scoring|weakest/i.test(t4i));
    check("★ SHORTER than the default reader's answer (depth axis intact)", w4i < w4a, `${w4i} vs ${w4a}`);
    check("★ still structured, not one blob — has a break or list", /\n\n|\n[-*·]|\n\d\./.test(t4i));
  } finally {
    server.close();
  }

  const endUnits = await counter();
  console.log(`\n\n████ RESULT ████`);
  console.log(`  checks: ${pass} passed, ${fail} failed`);
  console.log(`  stored tokens across served turns: prompt=${totals.p} output=${totals.o} total=${totals.p + totals.o}`);
  console.log(`  REAL quota consumed (call-counter delta): ${endUnits - startUnits} calls (${startUnits} → ${endUnits})`);
  console.log(fail === 0 ? `\n  ═══ ALL PASS ✅ ═══` : `\n  ═══ ${fail} FAILED ❌ ═══`);
}

async function cleanup() {
  for (const authId of authIds) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId); }
    catch (e) { console.warn(`cleanup failed for ${authId}:`, (e as Error).message); }
  }
}

run()
  .catch((e) => { console.error("\n💥 verification error:", e); process.exitCode = 1; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); });
