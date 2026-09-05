// ─────────────────────────────────────────────────────────────────────────────
// STAGE 5 — LIVE PROOF for screenStocks. Verbatim, paced, no fixtures.
//
// ★ WHY LIVE. Stages 1–4 proved every shape, cap, denominator and exclusion deterministically. What is
// left is the only question a fixture cannot answer: handed these descriptions, does a real model call
// the right tool and say the true thing? The registry's own header records two behavioural bugs that
// passed every deterministic proof and died on the first real call.
//
// The two failures that matter most here are BOTH routing failures, and both are expensive in the same
// way — a whole extra generation on every future message of that shape:
//   · "how many stocks are Pristine"   calling screenStocks   (getUniverseScan answers it in one slice)
//   · "which stocks have low debt"     calling getUniverseScan (which structurally cannot answer it)
// So 5g reads the PERSISTED tool_call rows rather than inferring from the prose.
//
//   AI_PROVIDER=gemini npx tsx src/scripts/verify-screen-live.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { createThrowawayUser, cleanupThrowawayUsers } from "./lib/throwaway-user.js";
import { scanExplanationText } from "../ai/core/guardrail.js";
import { getUniverseHealthView } from "../scoring/read/universe-view.cache.js";
import { getUniverseMetricValues } from "../scoring/read/metric-values.cache.js";
import { screenUniverse } from "../scoring/read/screen.service.js";

process.env.AI_PROVIDER = "gemini";
if (!process.env.AI_CHAT_MODEL) process.env.AI_CHAT_MODEL = "gemini-3.5-flash-lite";
const MODEL = process.env.AI_CHAT_MODEL;

/** 5i · anything here in a REPLY is a leak. Engine metric codes are this build's own risk. */
const INTERNAL_IDENTIFIERS: RegExp[] = [
  /\b(?:ownership|foundation|momentum|trajectory|divergence|composition)_[A-Za-z]?\d*_[a-z]/,
  /\blens_[a-z]{2}\d_/,
  /\bbelow_par\b|\blabelBand\b|\bfiredFlags\b|\bfiredPatterns\b|\bperiodKey\b/,
  /screenUniverse|screen\.service|UniverseHealthView|score_metrics|raw_value|metricScore/,
  /(?<![A-Za-z0-9])(?:F(?:10|[1-9])|M[1-5])(?:_[A-Z_]+)?(?![A-Za-z0-9])/,
  /\b(?:Tier1|GNPAttm|NNPA|PCR|NPyoy|PPOP)\b/,
  /\bconditions\s*[:=]|\bminimum:|\bmin\s*=|\bfield\s*=/,
];

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
    method, headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as any };
}

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`   ✅ ${label}`); }
  else { fail++; console.log(`   ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
};
const note = (label: string, value: string) => console.log(`   · ${label}: ${value}`);
const has = (t: string, ...n: string[]) => n.some((x) => new RegExp(x, "i").test(t));

/**
 * ★ DID THE MODEL INVENT A THRESHOLD? The single most important behavioural check in this file, and
 * the one the first live run caught failing three separate ways ("anything under half a rupee of debt
 * … is considered low"; "38 companies have a Foundation score of 70 or above"). Matches the SHAPES in
 * which a chosen cut-off gets presented as a standard, so a reply that merely quotes the reader's own
 * number does not trip it.
 */
function inventedThreshold(t: string): string | null {
  const shapes: RegExp[] = [
    /\b(?:typically|generally|usually|commonly|conventionally|as a rule|rule of thumb)\b[^.]{0,60}?\d/i,
    /\b(?:is|are|counts? as|considered|regarded as|seen as|qualifies as)\s+(?:generally\s+)?(?:low|high|good|strong|healthy|solid|weak)\b/i,
    /\b(?:anything|any company|those)\s+(?:with\s+)?(?:under|below|above|over)\b[^.]{0,50}?\bis\b[^.]{0,25}\b(?:low|high|good|strong|healthy)\b/i,
    /\b(?:I|we)\s+(?:used|picked|chose|set|applied|took)\b[^.]{0,30}\b(?:threshold|cut-?off|bar|line)\b/i,
    /\b(?:threshold|cut-?off|benchmark|bar)\s+of\s+\d/i,
  ];
  // ⚠ NEGATION IS THE WHOLE DIFFICULTY, AND THE FIRST CUT MISSED IT — exactly as the Stage 2 check
  //   for "recommend" did. "there is no single threshold for what counts as strong" is the CORRECT
  //   reply and contains the phrase verbatim. A hit only counts when its own sentence does not deny it.
  for (const re of shapes) {
    const m = re.exec(t);
    if (!m) continue;
    const start = t.lastIndexOf(".", m.index) + 1;
    const end = t.indexOf(".", m.index + m[0].length);
    const sentence = t.slice(start, end === -1 ? undefined : end);
    if (/\b(?:no|not|n't|never|doesn|does not|isn|is not|rather than|instead of|without)\b/i.test(sentence)) continue;
    return m[0];
  }
  return null;
}

/**
 * ★ DID IT INVENT A PRODUCT RATIONALE FOR A GAP (the §THE PAGES failure)? Explaining the CONSEQUENCE
 * of missing data ("Because of that, there is no way to screen for cheap stocks") is correct and must
 * not trip this. Inventing a REASON Vytal lacks it ("because Vytal focuses on quality instead") is the
 * defect. The difference is whether the clause attributes a choice to Vytal.
 */
function inventedRationale(t: string): string | null {
  const shapes: RegExp[] = [
    /\bVytal\b[^.]{0,40}\b(?:focuses on|prioriti[sz]es|chose|chooses|decided|prefers|is designed to|by design|deliberately|intentionally)\b[^.]{0,60}/i,
    /\b(?:because|since|as)\b[^.]{0,25}\bVytal\b[^.]{0,25}\b(?:focuses|prioriti|believes|considers|is (?:a|an|built))\b[^.]{0,60}/i,
    /\b(?:rather than|instead of)\s+(?:valuation|price|multiples)\b[^.]{0,40}\bVytal\b/i,
  ];
  for (const re of shapes) { const m = re.exec(t); if (m) return m[0]; }
  return null;
}

function verbatim(text: string) {
  console.log("   ┌" + "─".repeat(104));
  for (const line of (text ?? "(empty)").split("\n")) console.log("   │ " + line);
  console.log("   └" + "─".repeat(104));
}

const totals = { p: 0, o: 0, latency: [] as number[] };
const PACE_MS = 9000;
let firstAsk = true;

/** Which tools did this session actually invoke? Read from the PERSISTED tool_call rows. */
async function toolsUsed(sessionId: string): Promise<string[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId, kind: "tool_call" },
    select: { toolPayload: true },
    orderBy: { createdAt: "asc" },
  });
  const names: string[] = [];
  for (const r of rows) for (const c of (r.toolPayload as unknown as { name: string }[]) ?? []) names.push(c.name);
  return names;
}

async function ask(base: string, sessionId: string, q: string): Promise<{ text: string; tools: string[] }> {
  if (!firstAsk) await new Promise((r) => setTimeout(r, PACE_MS));
  firstAsk = false;
  console.log(`\n🟩 USER: ${q}`);
  const t0 = Date.now();
  const r = await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: q });
  const elapsed = Date.now() - t0;
  totals.latency.push(elapsed);
  const reply = r.json?.data?.reply;
  const text: string = reply?.content ?? "(no content)";
  const u = reply?.usage ?? {};
  totals.p += u.promptTokens ?? 0; totals.o += u.outputTokens ?? 0;
  verbatim(text);
  const tools = await toolsUsed(sessionId);
  note("5j · reader-visible latency", `${elapsed} ms`);
  note("tools invoked", tools.length ? tools.join(" → ") : "(none)");
  note("shape", `${text.trim().split(/\s+/).length} words · prompt ${u.promptTokens ?? "?"} / output ${u.outputTokens ?? "?"} tok · blocked=${reply?.guardrailBlocked}`);
  const leaks = INTERNAL_IDENTIFIERS.filter((re) => re.test(text));
  check("5i · no internal identifier or metric code in output", leaks.length === 0, leaks.map((re) => (text.match(re) ?? [""])[0]).join(", "));
  const g = scanExplanationText(text);
  check("guardrail clean on served text", g.clean, g.hardHits.map((h) => `${h.term}:"${h.match}"`).join(", "));
  return { text, tools };
}

async function openGeneral(base: string): Promise<string> {
  const o = await api(base, "POST", "/chat/sessions", {});
  if (o.status >= 400) throw new Error(`open failed ${o.status}: ${JSON.stringify(o.json).slice(0, 300)}`);
  const opening = o.json?.data?.messages?.[0];
  if (opening?.usage) { totals.p += opening.usage.promptTokens ?? 0; totals.o += opening.usage.outputTokens ?? 0; }
  return o.json?.data?.session?.id;
}
const newUser = async (tag: string) => (await createThrowawayUser(`scrlive-${tag}`)).userId;

async function run() {
  console.log(`\n████ STAGE 5 — LIVE PROOF · screenStocks · model=${MODEL} ████`);
  const view = await getUniverseHealthView();
  const values = await getUniverseMetricValues();
  const TICKERS = view.members.map((m) => m.symbol);
  /** Ground truth straight from the service, for the attribution check. */
  const truthRoe20 = await screenUniverse(view, values, null, { conditions: [{ field: "returnOnEquity", min: 20 }] });
  const trueSet = truthRoe20.kind === "matches" ? new Set(truthRoe20.matches.shown.map((r) => r.symbol)) : new Set<string>();
  const trueVal = new Map<string, number>();
  if (truthRoe20.kind === "matches") for (const r of truthRoe20.matches.shown) trueVal.set(r.symbol, r.values[0].value);

  const { server, base } = bootApp();
  try {
    // ══════════ 5a ══════════
    console.log(`\n\n═════════ 5a · "Which stocks have ROE above 20%?" — the denominator ═════════`);
    userRef.id = await newUser("5a");
    const s5a = await openGeneral(base);
    const { text: t5a, tools: tools5a } = await ask(base, s5a, "Which stocks have ROE above 20%?");
    check("5a · screenStocks was the tool", tools5a.includes("screenStocks"), tools5a.join(","));
    check("5a · states the evaluable denominator (82)", /\b82\b/.test(t5a));
    check("5a · does NOT present the result as out of 94", !/\b(?:32|\d+)\s+of\s+94\b/.test(t5a) && !/out of (?:the )?94/i.test(t5a));
    check("5a · explains the banks are measured differently", has(t5a, "bank"));
    check("5a · does not call the banks a data gap", !has(t5a, "no data (for|on) bank", "missing data", "unavailable for bank"));

    // ── 5h · ATTRIBUTION, PER LINE. ──────────────────────────────────────────────────────────────
    // ★ THE FIRST CUT OF THIS CHECK WAS BROKEN IN THREE WAYS AND WOULD HAVE PASSED A REAL FABRICATION.
    //   It matched TICKERS, but the model writes company NAMES ("Cummins India Ltd"), so it saw one of
    //   twelve rows. It scanned a ±120-CHARACTER WINDOW, which spans neighbouring bullets, so it read
    //   the row above's figure as this row's. And it demanded 0.051 precision against a model that
    //   deliberately hedges ("a return on equity of about 30%"). Rewritten to resolve by name, scope
    //   each figure to ITS OWN LINE, and allow one rounding step — which is what actually catches the
    //   five-of-six mis-attribution this exists for.
    console.log(`\n   ── 5h · attribution check ──`);
    const nameOf = new Map(view.members.map((m) => [m.symbol, m.name]));
    /** Resolve a bullet line to a company: exact ticker, full name, or the name minus its suffix. */
    const resolveLine = (line: string): string | null => {
      for (const s of TICKERS) if (new RegExp(`\\b${s.replace(/-/g, "\\-")}\\b`).test(line)) return s;
      let best: string | null = null;
      for (const s of TICKERS) {
        const full = nameOf.get(s) ?? "";
        const stem = full.replace(/\s+(Ltd|Limited|Company|Corporation)\.?$/i, "").trim();
        if (stem.length > 4 && line.toLowerCase().includes(stem.toLowerCase())) {
          if (!best || stem.length > (nameOf.get(best) ?? "").length) best = s;
        }
      }
      return best;
    };
    const bulletLines = t5a.split("\n").filter((l) => /^\s*[*\-•]/.test(l));
    const resolved = bulletLines.map((l) => ({ line: l, sym: resolveLine(l) }));
    const namedSyms = [...new Set(resolved.map((r) => r.sym).filter((s): s is string => s !== null))];
    note("rows parsed", `${bulletLines.length} bullet lines · ${namedSyms.length} resolved to a company`);
    note("companies named", namedSyms.join(", ") || "(none)");
    check("5h · at least 8 of the 12 rows resolved (the parser sees the reply)", namedSyms.length >= 8, `${namedSyms.length}`);
    const fabricated = namedSyms.filter((s) => !trueSet.has(s));
    check("5h · every company named is in the true match set", fabricated.length === 0, fabricated.join(", "));
    let pairsChecked = 0, pairsWrong = 0;
    for (const { line, sym } of resolved) {
      if (!sym) continue;
      const real = trueVal.get(sym);
      if (real === undefined) continue;
      // Every percentage ON THIS LINE that is plausibly the metric (not the 0-100 health score,
      // which the line labels separately). A wrong-row figure is the failure being hunted.
      for (const m of line.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) {
        const claimed = Number(m[1]);
        pairsChecked++;
        // one rounding step: the model says "about 30%" for 29.5. A mis-attribution is off by far more.
        if (Math.abs(claimed - real) > 0.55) { pairsWrong++; console.log(`      ✗ ${sym}: line says ${claimed}%, its true value is ${real}%`); }
      }
    }
    check(`5h · every figure is on the RIGHT company's line, within one rounding step`,
      pairsWrong === 0 && pairsChecked >= 8, `${pairsChecked} figures checked, ${pairsWrong} mis-attributed`);

    // ══════════ 5b ══════════
    console.log(`\n\n═════════ 5b · "Pristine pharma with no red flags" — combination, expect 2 ═════════`);
    userRef.id = await newUser("5b");
    const s5b = await openGeneral(base);
    const { text: t5b, tools: tools5b } = await ask(base, s5b, "Show me Pristine pharma companies with no red flags.");
    check("5b · screenStocks was the tool", tools5b.includes("screenStocks"), tools5b.join(","));
    check("5b · names DIVISLAB", /DIVISLAB|Divi/i.test(t5b));
    check("5b · names LUPIN", /LUPIN|Lupin/i.test(t5b));
    const others = TICKERS.filter((s) => s !== "DIVISLAB" && s !== "LUPIN" && new RegExp(`\\b${s.replace(/[-]/g, "\\-")}\\b`).test(t5b));
    check("5b · names NO other company", others.length === 0, others.join(", "));

    // ══════════ 5c ══════════
    console.log(`\n\n═════════ 5c · "companies with good ROE" — MUST return the spread, MUST NOT pick a number ═════════`);
    userRef.id = await newUser("5c");
    const s5c = await openGeneral(base);
    const { text: t5c, tools: tools5c } = await ask(base, s5c, "Show me companies with good ROE.");
    check("5c · screenStocks was the tool", tools5c.includes("screenStocks"), tools5c.join(","));
    // ⚠ THE MODEL ROUNDS, DELIBERATELY AND HONESTLY ("around 17%", "below roughly 10%"). An exact-match
    //   assertion on 16.81 / 9.92 / 24.46 fails a correct reply. Accept the rounded neighbourhood.
    const nearAny = (t: string, targets: number[], tol = 1.2) =>
      [...t.matchAll(/(\d+(?:\.\d+)?)\s?%/g)].some((m) => targets.some((x) => Math.abs(Number(m[1]) - x) <= tol));
    check("5c · hands back the spread (quartiles/median, rounded or exact)", nearAny(t5c, [9.92, 16.81, 24.46, 83.66]));
    check("5c · asks the reader for a figure", has(t5c, "what (level|figure|number)", "which (level|figure|number)", "where would you", "\\?", "let me know", "tell me", "you.d like", "would you like", "name a figure"));
    // ⚠ WIDENED after two live runs phrased it two ways my first regex missed — "that judgment belongs
    //   to you" and "does not have a single fixed line for what counts as good". Matching the CLAIM,
    //   not one wording of it.
    check("5c · says the judgement is the reader's / Vytal has no such line",
      has(t5c, "(no|not|n.t)[^.]{0,45}(definition|line|threshold|cut-?off|bar)", "doesn.t (define|draw|have)", "does not (define|draw|have)",
          "your call", "up to you", "you decide", "belongs to you", "yours to set", "depends on what you", "no fixed"));
    check("5c · ★ invents NO threshold", inventedThreshold(t5c) === null, inventedThreshold(t5c) ?? "");
    check("5c · returns NO ranked company list", TICKERS.filter((s) => new RegExp(`\\b${s.replace(/[-]/g, "\\-")}\\b`).test(t5c)).length <= 1);

    // ══════════ 5d ══════════
    console.log(`\n\n═════════ 5d · "stocks with strong Foundation" — same path, and 'strong' is not a verdict ═════════`);
    userRef.id = await newUser("5d");
    const s5d = await openGeneral(base);
    const { text: t5d, tools: tools5d } = await ask(base, s5d, "Which stocks have strong Foundation?");
    check("5d · screenStocks was the tool", tools5d.includes("screenStocks"), tools5d.join(","));
    check("5d · hands back the Foundation spread", /\b(?:31|32|58|59|66|75|76|85|86)\b/.test(t5d));
    check("5d · asks for a figure rather than choosing one", has(t5d, "\\?", "let me know", "tell me", "would you like", "name a", "where would you"));
    check("5d · ★ invents NO Foundation threshold", inventedThreshold(t5d) === null, inventedThreshold(t5d) ?? "");
    // ⚠ BEHAVIOUR, NOT WORDING. The first two cuts of this check matched the exact phrasing of the
    //   PREVIOUS run and then missed "38 companies CLEAR a Foundation score of 70 or higher" on the
    //   next. The question contains no digit, so ANY filtered count reported at a specific cut means
    //   the cut was supplied by the model — whatever verb it reached for.
    const selfCut = /\b(\d+)\s+(?:companies|stocks|names)\s+\w+(?:\s+\w+){0,3}?\s+(?:score of\s+)?(\d+(?:\.\d+)?)\s*(?:or\s+(?:higher|above|more)|\+)/i.exec(t5d);
    check("5d · ★ reports no filtered count at a cut the reader never named", selfCut === null, selfCut?.[0] ?? "");
    // When the model DOES supply a figure, the result now requires it be said and made correctable.
    if (selfCut) {
      check("5d · …and if it did, it states the figure as changeable (the result's mitigation)",
        has(t5d, "tell me if", "if you.d (set|prefer|like)", "you can (change|adjust|set)", "let me know", "different (cut|figure|level|threshold)", "\\?"),
        "an invented cut must at least arrive as a stated, correctable assumption");
    }
    check("5d · ★ never calls a COMPANY strong", !/\b[A-Z]{3,}\b[^.]{0,40}\bis (?:a )?strong\b/i.test(t5d) && !/\bstrong (?:company|stock|business|pick)\b/i.test(t5d),
      (/\b\w+\b[^.]{0,30}\bis (?:a )?strong\b[^.]{0,20}/i.exec(t5d) ?? [""])[0]);
    check("5d · does not invent a Foundation band word", !has(t5d, "strong Foundation (band|rating|tier)", "Foundation is (rated|classified)"));

    // ══════════ 5e ══════════
    console.log(`\n\n═════════ 5e · "Find me cheap stocks" — MUST refuse, MUST NOT proxy from health ═════════`);
    userRef.id = await newUser("5e");
    const s5e = await openGeneral(base);
    const { text: t5e } = await ask(base, s5e, "Find me cheap stocks.");
    check("5e · says Vytal has no valuation measure",
      has(t5e, "(no|not|n.t)[^.]{0,60}(valuat|p/e|price.to.book|fair value|price multiple)",
          "can.t[^.]{0,40}(cheap|valuat|undervalu)", "cannot[^.]{0,40}(cheap|valuat|undervalu)"));
    check("5e · ★ does NOT proxy cheapness from the health score",
      !/\b(?:cheap|undervalued|good value|bargain)\b[^.]{0,60}\b(?:health|score|band|Fragile|Below Par)\b/i.test(t5e) &&
      !/\b(?:Fragile|Below Par|low(?:er)?[- ]scoring)\b[^.]{0,50}\b(?:cheap|undervalued|value)\b/i.test(t5e),
      (/\b(?:cheap|undervalued)\b[^.]{0,60}/i.exec(t5e) ?? [""])[0]);
    check("5e · names NO company", TICKERS.filter((s) => new RegExp(`\\b${s.replace(/[-]/g, "\\-")}\\b`).test(t5e)).length === 0,
      TICKERS.filter((s) => new RegExp(`\\b${s.replace(/[-]/g, "\\-")}\\b`).test(t5e)).join(", "));
    check("5e · quotes no P/E or valuation multiple from its own knowledge", !/\b\d+(?:\.\d+)?\s?(?:x|times)\s+(?:earnings|book)\b/i.test(t5e) && !/\bP\/E of \d/i.test(t5e));
    // ⚠ NARROWED AFTER THE FIRST LIVE RUN. The blunt /because/ matched "Because of that, there is no
    //   way to screen for cheap stocks" — a statement of CONSEQUENCE, which is correct and wanted. The
    //   §THE PAGES failure is inventing a REASON Vytal lacks the data; only that is asserted.
    check("5e · does NOT invent a product rationale for the gap", inventedRationale(t5e) === null, inventedRationale(t5e) ?? "");

    // ══════════ 5f ══════════
    console.log(`\n\n═════════ 5f · "banks with GNPA below 2%" — honest cannot-do, NOT an invented limitation ═════════`);
    userRef.id = await newUser("5f");
    const s5f = await openGeneral(base);
    const { text: t5f } = await ask(base, s5f, "Which banks have gross NPA below 2%?");
    check("5f · says it cannot screen on that",
      has(t5f, "can.t", "cannot", "doesn.t (cover|support|screen|have)", "does not (cover|support|screen|have)", "no.{0,20}screen", "not.{0,20}available"));
    // ⚠ THE READER'S OWN "2%" IS NOT A FABRICATION. The first cut flagged the model restating the
    //   question ("a GNPA below 2%"). Only a figure that is NOT the one asked about counts.
    const gnpaFigures = [...t5f.matchAll(/\b(\d+(?:\.\d+)?)\s?%/g)].map((m) => Number(m[1])).filter((n) => n !== 2);
    check("5f · ★ invents NO GNPA figure of its own", gnpaFigures.length === 0, `stray figures: ${gnpaFigures.join(", ")}`);
    check("5f · names no bank as an answer", !/\b(?:HDFCBANK|ICICIBANK|SBIN|AXISBANK|KOTAKBANK|INDUSINDBK|PNB|CANBK|BANKBARODA|UNIONBANK|INDIANB|FEDERALBNK)\b/i.test(t5f));
    check("5f · does NOT invent a product rationale for the gap", inventedRationale(t5f) === null, inventedRationale(t5f) ?? "");
    check("5f · frames it as a screen limit, not as Vytal lacking bank data",
      !has(t5f, "no data (on|for) bank", "doesn.t (track|have) (data )?(on|for) bank", "not covered"));

    // ══════════ 5g · ROUTING, BOTH DIRECTIONS ══════════
    console.log(`\n\n═════════ 5g · ROUTING — the expensive failure, both directions ═════════`);
    userRef.id = await newUser("5g1");
    const s5g1 = await openGeneral(base);
    const { tools: g1 } = await ask(base, s5g1, "How many stocks are Pristine?");
    check("5g · 'how many are Pristine' called getUniverseScan", g1.includes("getUniverseScan"), g1.join(","));
    check("5g · ★ and did NOT call screenStocks", !g1.includes("screenStocks"), g1.join(","));

    userRef.id = await newUser("5g2");
    const s5g2 = await openGeneral(base);
    const { tools: g2, text: tg2 } = await ask(base, s5g2, "Which stocks have low debt?");
    check("5g · 'which stocks have low debt' called screenStocks", g2.includes("screenStocks"), g2.join(","));
    check("5g · ★ and did NOT call getUniverseScan", !g2.includes("getUniverseScan"), g2.join(","));
    // ★ THE ASSERTION THAT MATTERED AND WAS TOO WEAK THE FIRST TIME. "low debt" names no number, so
    //   the reply must hand back the spread — not screen at a cut the model picked. The first run
    //   passed this on a substring while the model was writing "anything under half a rupee of debt
    //   for every rupee of equity is considered low" and screening at 0.5.
    check("5g · ★ 'low debt' invents NO threshold", inventedThreshold(tg2) === null, inventedThreshold(tg2) ?? "");
    check("5g · ★ returns the spread, not a list built on a self-chosen cut",
      !/\b\d+\s+(?:companies|stocks)\s+(?:keep|have|maintain)[^.]{0,40}\b(?:at or below|below|under)\s+0?\.\d/i.test(tg2),
      (/\b\d+\s+(?:companies|stocks)\s+(?:keep|have|maintain)[^.]{0,60}/i.exec(tg2) ?? [""])[0]);
    check("5g · asks the reader for a figure", has(tg2, "\\?", "let me know", "would you like", "name a", "where would you"));

    // ══════════ 5j ══════════
    console.log(`\n\n═════════ 5j · LATENCY, as the reader experiences it ═════════`);
    const L = [...totals.latency].sort((a, b) => a - b);
    console.log(`   turns ${L.length} · fastest ${L[0]}ms · median ${L[Math.floor(L.length / 2)]}ms · slowest ${L.at(-1)}ms`);
    console.log(`   tokens across the run: prompt ${totals.p} · output ${totals.o}`);

    console.log(`\n${fail === 0 ? "✅ STAGE 5 LIVE PROOF PASSED" : `❌ ${fail} FAILED`} — ${pass} passed, ${fail} failed`);
    process.exitCode = fail === 0 ? 0 : 1;
  } finally {
    server.close();
    await cleanupThrowawayUsers();
  }
}
run().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
