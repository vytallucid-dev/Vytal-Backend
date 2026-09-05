// ─────────────────────────────────────────────────────────────────────────────
// STAGE 5 — PROOF. LIVE calls, verbatim, no fixtures.
//
// ★ WHY LIVE AND WHY VERBATIM. Everything a fixture can prove was proved in stages 1–4: the shapes,
// the caps, the catalogue naming, the security. What is left is the only question that matters and the
// only one a fixture CANNOT answer — does a real model, handed these descriptions and these results,
// say the true thing? The registry's own header records two behavioural bugs (thoughtSignature, the
// searchStocks over-call) that passed every deterministic proof and died on the first real call.
//
// Real chat endpoints, real provider, real DB. Every reply is printed in full for a human to read; the
// assertions cover only what is mechanically checkable. In particular 5b's assertion is NEGATIVE —
// "no quarter stated as a cross-section" — because that is the falsifiable half.
//
//   AI_PROVIDER=gemini npx tsx src/scripts/verify-universe-scan-live.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { createThrowawayUser, cleanupThrowawayUsers } from "./lib/throwaway-user.js";
import { scanExplanationText } from "../ai/core/guardrail.js";

process.env.AI_PROVIDER = "gemini";
if (!process.env.AI_CHAT_MODEL) process.env.AI_CHAT_MODEL = "gemini-3.5-flash-lite";
const MODEL = process.env.AI_CHAT_MODEL;

// ── 5h · INTERNAL IDENTIFIERS. Anything here in a REPLY is a leak. ──
// The finding-key and lens-key shapes this build had to close, plus the read-layer's own field and
// service names, plus the raw band enum.
const INTERNAL_IDENTIFIERS: RegExp[] = [
  /\b(?:ownership|foundation|momentum|trajectory|divergence|composition)_[A-Za-z]?\d*_[a-z]/,
  /\blens_[a-z]{2}\d_/,
  /\b(?:LM|LP|PQ|PF)\d+\b/,
  /\bbelow_par\b|\blabelBand\b|\bfiredFlags\b|\bfiredPatterns\b|\btrajectoryMarker\b|\bperiodKey\b|\bpatternKey\b|\bflagKey\b/,
  /buildUniverseHealthView|universe-view|scope-aggregate|projectUniverse|getUniverseScan|UniverseHealthView|PathologyCensusItem|lensPathology/,
  /\bslice\s*=\s*(?:overview|census|movers|divergence|week|band|finding)\b/,
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
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as any };
}

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`   ✅ ${label}`); }
  else { fail++; console.log(`   ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
};
const note = (label: string, value: string) => console.log(`   · ${label}: ${value}`);

/**
 * ⚠ OBSERVED, NOT ASSERTED — the link layer, which this build does not own.
 *
 * Two defects showed up in the first paced live run, both the same root cause: the HEALTH HUB HAS NO
 * LINK MARKER (§POINTING AT A PAGE offers four kinds, and the Hub is not one), and this tool makes the
 * model want to point there on almost every market-wide answer.
 *   · it wrote `{{link:health-hub}}` — an unhandled kind. The server correctly dropped it, leaving the
 *     reader a literal hole: "you can check the  to see how many sit in each band".
 *   · it wrote `[the Health Hub's Flags & Patterns tab](/portfolio)` — a hand-typed ROOT-RELATIVE path,
 *     pointing at the WRONG page. verify-pages-live-chat.ts's fabricated-URL check only matches
 *     absolute URLs, so this shape slips through it today.
 * Counted separately from pass/fail because the fix is a decision about shared prompt surface (add a
 * marker kind / sanitise bare paths), not about this tool. Loud, so it cannot be lost.
 */
let warnings = 0;
function watchLinkLayer(text: string) {
  const hole = /\S {2,}\S|\bthe\s+to see\b|\bcheck the\s+to\b/.exec(text);
  const marker = /\{\{link:[a-z-]+\}\}/.exec(text);
  const typedPath = /\]\(\/[a-z][^)]*\)/i.exec(text);
  for (const [what, hit] of [["dropped-marker hole", hole], ["raw {{link:…}} survived", marker], ["hand-typed path", typedPath]] as const) {
    if (hit) {
      warnings++;
      console.log(`   ⚠ LINK LAYER (pre-existing, not this build): ${what} — ${JSON.stringify(hit[0]).slice(0, 80)}`);
    }
  }
}
const has = (t: string, ...needles: string[]) => needles.some((n) => new RegExp(n, "i").test(t));

function verbatim(text: string) {
  console.log("   ┌" + "─".repeat(104));
  for (const line of (text ?? "(empty)").split("\n")) console.log("   │ " + line);
  console.log("   └" + "─".repeat(104));
}

const totals = { p: 0, o: 0, latency: [] as number[] };

/**
 * ⚠ FREE-TIER PACING, NOT A MEASUREMENT ARTEFACT. Flash-Lite's free tier allows 15 requests/minute
 * PER MODEL, and a tool turn costs TWO generations (the tool round, then the answer) — so eight
 * questions is ~16 requests and the run walks into a 429 partway through. The pause happens BEFORE
 * the request and is excluded from the latency figure, which is timed around the HTTP call alone.
 */
const PACE_MS = 9000;
let firstAsk = true;

/** Ask one question; print the reply verbatim; return it. 5i's latency is the wall-clock the reader
 *  actually waits — the whole turn, tool rounds included, not the generation alone. */
async function ask(base: string, sessionId: string, q: string): Promise<string> {
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
  totals.p += u.promptTokens ?? 0;
  totals.o += u.outputTokens ?? 0;
  verbatim(text);
  note("5i · reader-visible latency", `${elapsed} ms`);
  note("shape", `${text.trim().split(/\s+/).length} words · prompt ${u.promptTokens ?? "?"} / output ${u.outputTokens ?? "?"} tok · regenerated=${reply?.regenerated} blocked=${reply?.guardrailBlocked}`);
  const leaks = INTERNAL_IDENTIFIERS.filter((re) => re.test(text));
  check("5h · no internal identifier in output", leaks.length === 0, leaks.map((re) => (text.match(re) ?? [""])[0]).join(", "));
  const g = scanExplanationText(text);
  check("guardrail clean on served text", g.clean, g.hardHits.map((h) => `${h.term}:"${h.match}"`).join(", "));
  watchLinkLayer(text);
  return text;
}

async function openGeneral(base: string): Promise<string> {
  const o = await api(base, "POST", "/chat/sessions", {});
  if (o.status >= 400) throw new Error(`open failed ${o.status}: ${JSON.stringify(o.json).slice(0, 300)}`);
  const opening = o.json?.data?.messages?.[0];
  if (opening?.usage) { totals.p += opening.usage.promptTokens ?? 0; totals.o += opening.usage.outputTokens ?? 0; }
  return o.json?.data?.session?.id;
}

async function newUser(tag: string): Promise<string> {
  const { userId } = await createThrowawayUser(`uslive-${tag}`);
  return userId;
}

/** ★ THE 5b ASSERTION, ISOLATED. A quarter label may appear (it is real), but never as a claim about
 *  the whole set. This matches the false SHAPE — "as of FY27Q1, 21 are Pristine" — in its plausible
 *  surface forms, and separately requires the per-company framing to be present. */
function statesQuarterAsCrossSection(t: string): string | null {
  const shapes: RegExp[] = [
    /\b(?:as of|as at|for|in|during)\s+(?:the\s+)?FY\d{2}\s?Q\d\b(?:[^.]{0,40})?\b(?:\d+|all|every|the universe|companies|stocks)\b/i,
    /\bFY\d{2}\s?Q\d\b[^.]{0,25}\b(?:\d{1,3})\s+(?:companies|stocks|names)\b/i,
    /\b(?:all|every|the)\s+\d{2,3}\s+(?:companies|stocks|names)[^.]{0,30}\bFY\d{2}\s?Q\d\b/i,
    /\bthe (?:latest|current|most recent) quarter\b[^.]{0,20}\bFY\d{2}\s?Q\d\b/i,
  ];
  for (const re of shapes) {
    const m = re.exec(t);
    if (m) return m[0];
  }
  return null;
}

async function run() {
  console.log(`\n████ STAGE 5 — LIVE PROOF · model=${MODEL} ████`);
  const { server, base } = bootApp();
  try {
    // ══════════ 5a ══════════
    console.log(`\n\n═════════ 5a · "How many stocks does Vytal score?" ═════════`);
    userRef.id = await newUser("5a");
    const t5a = await ask(base, await openGeneral(base), "How many stocks does Vytal score?");
    check("5a · states the real count (94)", /\b94\b/.test(t5a));
    check("5a · does NOT invent a different number", !/\b(?:93|100|224|500|505)\s+(?:stocks|companies)\b/i.test(t5a));

    // ══════════ 5b · THE PERIOD TEST ══════════
    console.log(`\n\n═════════ 5b · ★ "How many are Pristine?" ─ MUST NOT name a quarter as a cross-section ═════════`);
    userRef.id = await newUser("5b");
    const t5b = await ask(base, await openGeneral(base), "How many are Pristine?");
    check("5b · states the real count (21)", /\b21\b/.test(t5b));
    const bad5b = statesQuarterAsCrossSection(t5b);
    check("5b · ★ does NOT state a quarter as though it covered the whole set", bad5b === null, bad5b ?? "");
    check("5b · ★ uses the per-company framing", has(t5b,
      "most recent reported quarter", "its own most recent", "each at its", "own latest reported", "latest reported quarter",
      "each company'?s (own )?(most recent|latest)"));

    // ══════════ 5c ══════════
    console.log(`\n\n═════════ 5c · "Which stocks are firing red flags?" ─ canonical names + stated truncation ═════════`);
    userRef.id = await newUser("5c");
    const t5c = await ask(base, await openGeneral(base), "Which stocks are firing red flags?");
    check("5c · names the six companies (spot-check)", ["ASHOKLEY", "DIXON", "GLENMARK", "INFY", "NHPC", "SBIN"].filter((s) => t5c.includes(s)).length >= 5,
      ["ASHOKLEY", "DIXON", "GLENMARK", "INFY", "NHPC", "SBIN"].filter((s) => t5c.includes(s)).join(","));
    check("5c · ★ uses CANONICAL finding names, not codes",
      has(t5c, "Distribution Pattern", "Pledging Crisis", "Promoter Exit", "Interest Coverage Collapse"));
    // What must be true: a partial set cannot read as complete. The red-flag COMPANIES are fully
    // enumerated (all 6), so the truncation that needs stating is the FINDINGS list (12 of 22) — or,
    // equivalently, the count against the universe. Either satisfies the requirement; demanding one
    // exact phrasing is the too-narrow-regex trap this file already fell into twice.
    check("5c · ★ a count for the wider set, so nothing partial reads as complete",
      /(?:^|[^0-9])[0-9]{1,2}\s*(?:of|out of)(?:\s+the)?\s*94(?:[^0-9]|$)/.test(t5c) || /22[^.]{0,60}finding/i.test(t5c));

    // ══════════ 5d ══════════
    console.log(`\n\n═════════ 5d · "What patterns are firing across the market?" ═════════`);
    userRef.id = await newUser("5d");
    const t5d = await ask(base, await openGeneral(base), "What patterns are firing across the market?");
    check("5d · names real findings by their product names", has(t5d, "Deterioration", "Divergence", "Recovery from Weakness", "Margin"));
    // ⚠ EITHER ORDER. "6 of 94" and "Out of the 94 companies Vytal scores, 6 …" are the same fact;
    //   the first cut of this regex only accepted the former and failed a reply that stated both
    //   numbers correctly. What must be true is that a count appears ALONGSIDE the universe size.
    check("5d · carries counts against the universe size",
      /\b\d{1,2}\s*(?:of|\/|out of)\s*94\b/.test(t5d) || (/\b94\b/.test(t5d) && /\b\d{1,2}\s+compan(?:y|ies)\b/.test(t5d)));
    check("5d · ★ states the list was cut (12 of 22 shown)", has(t5d, "of the 22", "22 (findings|patterns)", "12 of", "most severe",
      "there are more", "others", "not (all|the full)", "top"));
    check("5d · ★ ONE divergence line, not four (§5C)", (t5d.match(/\bdivergence\b/gi) ?? []).length <= 4 &&
      !/(Ownership Against Fundamentals|Floor.Trajectory Split|Price Ahead of Fundamentals|Divergence Widening)[\s\S]{0,400}(Ownership Against Fundamentals|Floor.Trajectory Split|Price Ahead of Fundamentals|Divergence Widening)[\s\S]{0,400}(Ownership Against Fundamentals|Floor.Trajectory Split|Price Ahead of Fundamentals|Divergence Widening)/i.test(t5d));

    // ══════════ 5e ══════════
    console.log(`\n\n═════════ 5e · "Which stocks improved most recently?" ═════════`);
    userRef.id = await newUser("5e");
    const t5e = await ask(base, await openGeneral(base), "Which stocks improved most recently?");
    check("5e · names real movers", has(t5e, "AUROPHARMA", "MANKIND", "HCLTECH", "SOLARINDS", "TCS", "Aurobindo", "Mankind"));
    check("5e · ★ says WHAT it is compared against (own prior quarter / last week), not a bare 'recently'",
      has(t5e, "previous (reported )?quarter", "prior quarter", "own previous", "quarter[- ]on[- ]quarter",
        "last seven days", "past week", "last week"));
    check("5e · does NOT present the move as a forecast", !/will (keep|continue|rise|climb)|expect(ed)? to (rise|continue)/i.test(t5e));

    // ══════════ 5f · THE SEAM FROM THE LAST BUILD ══════════
    console.log(`\n\n═════════ 5f · ★ CRITICAL · "What is the divergence tool and which stocks show it right now?" ═════════`);
    userRef.id = await newUser("5f");
    const t5f = await ask(base, await openGeneral(base), "What is the divergence tool and which stocks show it right now?");
    check("5f · explains the mechanism (highest-vs-lowest pillar gap)",
      /pillar/i.test(t5f) && has(t5f, "highest", "lowest", "widest", "gap"));
    // NOT a count of ALL-CAPS tokens. The model names companies EITHER way — "ACC, AMBUJACEM, BHEL"
    // on one run, "ACC, Ambuja Cements, Bharat Heavy Electricals" on the next — and a ticker-shaped
    // regex fails the second, which is the more readable answer. Match on the real members, by ticker
    // OR by name.
    const DIVERGENT = ["ACC", "Ambuja", "AMBUJACEM", "BHEL", "Bharat Heavy", "Blue Star", "BLUESTARCO",
      "BPCL", "Bharat Petroleum", "Cochin Shipyard", "COCHINSHIP", "Crompton", "CROMPTON", "Dalmia",
      "DALBHARAT", "Dixon", "DIXON", "Reddy", "DRREDDY", "GAIL", "Glenmark", "GLENMARK"];
    const named5f = DIVERGENT.filter((n) => t5f.includes(n));
    check("5f - ANSWERS the second half, names companies", named5f.length >= 3, named5f.join(","));
    check("5f · ★ no longer says it cannot look this up (the seam closed)",
      !has(t5f, "can'?t pull", "cannot pull", "can'?t look", "cannot look", "not something i can", "unable to (list|fetch|pull)"));
    check("5f · ★ does NOT claim Vytal lacks the data (the older regression)",
      !/vytal (doesn'?t|does not) (have|run|offer|track|provide)|no such data/i.test(t5f));
    check("5f · ★ states how many, so the named few are not read as all", /\b38\b/.test(t5f));

    // ══════════ 5g · THE REGRESSION TEST FOR THE ORIGINAL DEFECT ══════════
    console.log(`\n\n═════════ 5g · ★ "Which stocks have ROE above 20%?" ─ honest cannot-do, no invented limitation ═════════`);
    userRef.id = await newUser("5g");
    const t5g = await ask(base, await openGeneral(base), "Which stocks have ROE above 20%?");
    // ⚠ DENIAL HAS MANY SURFACE FORMS — enumerate them, don't pick a favourite. The first cut of this
    //   regex omitted "does not use" and failed a perfectly correct reply ("Vytal does not use typed
    //   numbers or custom screens like 'ROE above 20%'"). Same mistake verify-pages-live-chat.ts already
    //   records making with "does not have".
    check("5g · ★ says it cannot do it", has(t5g, "can'?t", "cannot", "no (way|screen|filter|such)", "not (able|something|possible)",
      "does ?n[o']?t (let|allow|offer|support|use|have|provide|do|filter|screen)", "there is no", "isn'?t", "no typed", "named conditions"));
    check("5g · ★ does NOT fabricate a list of companies with numbers",
      !/\b[A-Z]{3,12}\b\s*[—:-]?\s*(?:ROE\s*)?\d{2}(?:\.\d)?\s*%/.test(t5g));
    check("5g · ★ does NOT invent a reason for the absence (THE original bug)",
      !/because vytal|vytal (deliberately|intentionally|doesn'?t believe|avoids|chose)|by design,? vytal|since vytal (focuses|is|believes)/i.test(t5g));
    check("5g · offers what DOES exist instead", has(t5g, "health hub", "screen", "band", "red flag", "pattern", "instead", "what i can", "closest"));

    // ══════════ 5f-bis · the same seam, but SCOPED (Stage 4 live) ══════════
    console.log(`\n\n═════════ 5·scope · "Of the stocks I hold, how many does Vytal score?" ─ owner-scoped, live ═════════`);
    userRef.id = await newUser("5s");
    const t5s = await ask(base, await openGeneral(base), "Of the stocks I hold, how many does Vytal score?");
    check("5·scope · answers about the READER's book, honestly empty", has(t5s,
      "does ?n[o']?t (have|hold|track)", "do ?n[o']?t (hold|have)", "any holdings", "no holdings", "nothing",
      "empty", "have ?n[o']?t added", "no stocks", "not holding", "zero"));

    check("5·scope · ★ does NOT relay the universe's 94 as the reader's own", !/\byou (hold|own)[^.]{0,30}\b94\b/i.test(t5s));
    check("5·scope · ★ does not frame the empty book as a Vytal gap",
      !/vytal (doesn'?t|does not) (support|track|cover) (your|holdings)/i.test(t5s));
  } finally {
    server.close();
    await cleanupThrowawayUsers();
  }

  const lat = totals.latency;
  console.log(`\n\n████ RESULT ████`);
  console.log(`  checks: ${pass} passed, ${fail} failed`);
  console.log(`  5i · reader-visible latency per turn: ${lat.map((n) => `${n}ms`).join(" · ")}`);
  console.log(`       min ${Math.min(...lat)} ms · median ${[...lat].sort((a, b) => a - b)[Math.floor(lat.length / 2)]} ms · max ${Math.max(...lat)} ms`);
  console.log(`  tokens across served turns: prompt=${totals.p} output=${totals.o} total=${totals.p + totals.o}`);
  console.log(`  ⚠ link-layer observations (pre-existing, outside this build): ${warnings}`);
  console.log(fail === 0 ? `\n  ═══ ALL PASS ✅ ═══\n` : `\n  ═══ ${fail} FAILED ❌ ═══\n`);
}

await run();
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
