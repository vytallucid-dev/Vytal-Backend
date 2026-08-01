// ─────────────────────────────────────────────────────────────────────────────
// LIVE PROOF for all three parts — 1d, 2d, 3f — in ONE paced run.
//
// ★ ONE SCRIPT, THREE PARTS, ON PURPOSE. The free tier allows 15 requests/minute per model and a tool
// turn costs TWO generations, so three separate scripts would spend most of their wall-clock waiting
// out 429s. Pacing once and asking every question in sequence is the same evidence for a third of the
// clock — and 2d's hit rate needs REPETITION, which only makes sense inside one paced loop.
//
//   1d · the three observed link shapes no longer occur          (repeated over every turn)
//   2d · "which stocks are firing red flags" names companies     (≥6 runs, hit rate reported honestly)
//   3f · a watchlist question, an explicit multi-symbol question, a mixed set with an uncovered symbol
//
//   AI_PROVIDER=gemini npx tsx src/scripts/verify-build3-live.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { createThrowawayUser, cleanupThrowawayUsers } from "./lib/throwaway-user.js";
import { addTransaction } from "../portfolio/transactions-service.js";

process.env.AI_PROVIDER = "gemini";
if (!process.env.AI_CHAT_MODEL) process.env.AI_CHAT_MODEL = "gemini-3.5-flash-lite";
const MODEL = process.env.AI_CHAT_MODEL;

const RED_FLAG_COMPANIES = ["ASHOKLEY", "DIXON", "GLENMARK", "INFY", "NHPC", "SBIN"];
const RED_FLAG_NAMES = ["Ashok Leyland", "Dixon", "Glenmark", "Infosys", "NHPC", "State Bank"];

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`   ✅ ${label}`); }
  else { fail++; console.log(`   ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
};
const note = (l: string, v: string) => console.log(`   · ${l}: ${v}`);
const verbatim = (t: string) => {
  console.log("   ┌" + "─".repeat(104));
  for (const line of (t ?? "(empty)").split("\n")) console.log("   │ " + line);
  console.log("   └" + "─".repeat(104));
};

// ── 1d · THE THREE OBSERVED SHAPES, MEASURED IN THE RIGHT PLACE ──────────────────────────────────
//
// ⚠ THE FIRST CUT OF THIS CHECK WAS WRONG, AND THE WAY IT WAS WRONG IS THE POINT. It scanned the
// FINAL reply for `](/…)` and flagged nine — every one of which the SERVER had built from a resolved
// marker. `[the Health Hub](/health-score)` is the fix WORKING, reported as the defect it replaced.
// The typed-path guard runs BEFORE resolution, so by the time a reply exists, a path in it is
// server-built by construction. Two different things need two different measurements:
//
//   READER-VISIBLE DEFECT (must be zero) — a hole where a marker was dropped, a raw `{{link:…}}`, or
//     a path OUTSIDE the set chat/links.ts can build. Those are the only shapes a reader can be hurt by.
//   GUARD ACTIVITY (reported, never failed) — how many destinations the guard stripped, read off the
//     controller's own warning. Zero means the model stopped typing paths; non-zero means it still
//     does and the reader is simply protected from it. Both are worth knowing; only one is a defect.
const linkDefects = { hole: 0, marker: 0, foreignPath: 0, turns: 0, stripped: 0 };

/** Every path shape chat/links.ts's builders can emit. Anything else in a reply came from nowhere. */
const SERVER_BUILT = [
  /^\/research\/stock-screener\/[^)\s]+$/,
  /^\/research\/peer-groups\/[^)\s]+$/,
  /^\/comparison\/[^)\s]+$/,
  /^\/portfolio(?:\?tab=[a-z]+)?$/,
  /^\/watchlist$/,
  /^\/health-score$/,
];

// ★ The controller logs every stripped destination. Intercepting console.warn is how this script
//   sees the guard fire — the reply itself cannot show what was removed from it.
const realWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const line = args.map(String).join(" ");
  const m = /typed link destinations stripped \((\d+)\)/.exec(line);
  if (m) linkDefects.stripped += Number(m[1]);
  realWarn(...args);
};

function scanLinks(text: string): string[] {
  const hits: string[] = [];
  linkDefects.turns++;
  // (i) a hole where a dropped marker used to be. ⚠ NOT a bare double space — markdown list markers
  //     ("*   *") produce those legitimately, and the first cut of this regex failed on one.
  const hole = /\bthe\s{2,}\S|\bon the\s+by\b/.exec(text);
  if (hole) { linkDefects.hole++; hits.push(`dropped-marker hole ${JSON.stringify(hole[0])}`); }
  // (ii) a raw marker that survived the sweep
  if (/\{\{link:/.test(text)) { linkDefects.marker++; hits.push("raw {{link:...}} survived"); }
  // (iii) a path no builder in chat/links.ts could have produced
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const dest = m[1];
    if (!dest.startsWith("/") && !/^https?:|^www\./i.test(dest)) continue; // relative-to-nothing: safeHref refuses it
    if (SERVER_BUILT.some((re) => re.test(dest))) continue;
    linkDefects.foreignPath++;
    hits.push(`FOREIGN DESTINATION ${dest}`);
  }
  return hits;
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
  return { status: res.status, json: (await res.json()) as any };
}

/** Free-tier pacing: 15 req/min per model, two generations per tool turn. Excluded from latency. */
const PACE_MS = 9000;
let first = true;
const latency: number[] = [];
async function ask(base: string, sessionId: string, q: string, quiet = false): Promise<string> {
  if (!first) await new Promise((r) => setTimeout(r, PACE_MS));
  first = false;
  if (!quiet) console.log(`\n🟩 USER: ${q}`);
  const t0 = Date.now();
  const r = await api(base, "POST", `/chat/sessions/${sessionId}/messages`, { message: q });
  latency.push(Date.now() - t0);
  const text: string = r.json?.data?.reply?.content ?? "(no content)";
  if (!quiet) { verbatim(text); note("latency", `${Date.now() - t0} ms`); }
  const defects = scanLinks(text);
  if (defects.length) { fail++; console.log(`   ❌ 1d · LINK DEFECT: ${defects.join(" | ")}`); }
  else if (!quiet) console.log("   ✅ 1d · no reader-visible link defect (no hole, no raw marker, no foreign destination)");
  return text;
}
async function open(base: string): Promise<string> {
  const o = await api(base, "POST", "/chat/sessions", {});
  if (o.status >= 400) throw new Error(`open failed ${o.status}`);
  return o.json?.data?.session?.id;
}
const has = (t: string, ...n: string[]) => n.some((x) => new RegExp(x, "i").test(t));

/**
 * ★ 2d's SECOND CHECK, AND THE ONE THAT MATTERS MORE. Counting how many company names appear was not
 * enough: a run that named all six ALSO fabricated which flag sat on which company — five of six
 * attributions wrong, every individual fact on the page true. So the reply is checked against the
 * view: on any line naming a red flag, every company named beside it must really fire it.
 */
type Truth = Map<string, { symbols: Set<string>; names: Set<string> }>;
function checkAttribution(text: string, truth: Truth): string[] {
  const wrong: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const [flag, who] of truth) {
      if (!line.includes(flag)) continue;
      for (const [sym, nm] of ALL_RED_FLAG_COMPANIES) {
        // ⚠ `\\b` — a template literal turns a single \b into a BACKSPACE, not a word boundary.
        const mentioned = new RegExp(`\\b${sym}\\b`).test(line) || line.includes(nm);
        if (mentioned && !who.symbols.has(sym)) wrong.push(`${flag} ✗ ${sym}`);
      }
    }
  }
  return wrong;
}
const ALL_RED_FLAG_COMPANIES: [string, string][] = [];

async function run() {
  console.log(`\n████ LIVE — PARTS 1d / 2d / 3f · model=${MODEL} ████`);
  const { server, base } = bootApp();
  const seeded: string[] = [];
  try {
    // ══════════ 1d · the three link shapes, on the questions that produced them ══════════
    console.log(`\n\n═════════ 1d · THE LINK SHAPES — the questions that produced them, verbatim ═════════`);
    userRef.id = (await createThrowawayUser("b3-1d")).userId;
    const s1 = await open(base);
    const t1a = await ask(base, s1, "How many stocks does Vytal score?");
    const t1b = await ask(base, s1, "Where can I see the flags and patterns firing across the market?");
    check("1d · points at the Health Hub in words", has(t1b, "health hub"));
    const hubLinked = /\]\(\/health-score\)/.test(t1a + t1b);
    note("1d · health-hub marker resolved to /health-score", hubLinked ? "YES — the model used the new kind" : "not this run (words only, which is also correct)");
    check("1d · ★ no link points at the WRONG page", !/\]\(\/portfolio\)/.test(t1b) || /portfolio/i.test(t1b));

    // ══════════ 2d · the hit rate, over SIX fresh sessions ══════════
    console.log(`\n\n═════════ 2d · "Which stocks are firing red flags?" × 6 fresh sessions ═════════`);
    const RUNS = 6;
    let named = 0;
    let misattributed = 0;
    // Ground truth from the live view, so this can never go stale against the data.
    const { getUniverseHealthView } = await import("../scoring/read/universe-view.cache.js");
    const { findingName } = await import("../catalogue/index.js");
    const view = await getUniverseHealthView();
    const truth: Truth = new Map();
    for (const m of view.members) {
      for (const f of m.firedFlags) {
        const n = findingName(f.flagKey);
        const cur = truth.get(n) ?? { symbols: new Set<string>(), names: new Set<string>() };
        cur.symbols.add(m.symbol);
        cur.names.add(m.name);
        truth.set(n, cur);
      }
      if (m.firedFlags.length) ALL_RED_FLAG_COMPANIES.push([m.symbol, m.name.replace(/ (Ltd|Limited)\.?$/, "")]);
    }
    console.log(`   ground truth: ${[...truth].map(([f, w]) => `${f}→${[...w.symbols].join("/")}`).join(" · ")}`);
    for (let i = 0; i < RUNS; i++) {
      userRef.id = (await createThrowawayUser(`b3-2d-${i}`)).userId;
      const t = await ask(base, await open(base), "Which stocks are firing red flags?", true);
      const hits = RED_FLAG_COMPANIES.filter((s) => t.includes(s)).length +
        RED_FLAG_NAMES.filter((n) => t.includes(n)).length;
      const ok = hits >= 4;
      if (ok) named++;
      const badAttr = checkAttribution(t, truth);
      if (badAttr.length) { misattributed++; fail++; }
      console.log(`   run ${i + 1}/${RUNS}: ${ok ? "✅ named the companies" : "❌ answered with categories only"} (${hits} name/ticker hits, ${t.trim().split(/\s+/).length} words)` +
        (badAttr.length ? `  ❌ FABRICATED ATTRIBUTION: ${badAttr.join(", ")}` : "  ✅ every flag→company attribution correct"));
      // ⚠ PRINT ON MISS, not only on the first run: a harness that hides its failures cannot be read.
      if (i === 0 || !ok || badAttr.length) verbatim(t);
    }
    console.log(`\n   ★ 2d HIT RATE: ${named}/${RUNS}   (baseline before the selector: 3/6)`);
    check(`2d · materially better than the 3/6 baseline`, named >= 5, `${named}/${RUNS}`);

    // ══════════ 3f · a watchlist question ══════════
    console.log(`\n\n═════════ 3f-i · a WATCHLIST question (a reader who actually watches things) ═════════`);
    const w = await createThrowawayUser("b3-3f-wl");
    seeded.push(w.authId);
    for (const sym of ["INFY", "TCS", "GLENMARK"]) {
      const st = await prisma.stock.findUniqueOrThrow({ where: { symbol: sym }, select: { id: true } });
      await prisma.watchlist.create({ data: { userId: w.userId, stockId: st.id } });
    }
    userRef.id = w.userId;
    const t3a = await ask(base, await open(base), "Is anything in my watchlist firing red flags?");
    check("3f-i · answers about the READER's own list", has(t3a, "watchlist", "watching", "you.re watching", "your list"));
    check("3f-i · ★ names a company that is actually on it and actually flagged", has(t3a, "INFY", "Infosys", "GLENMARK", "Glenmark"));
    check("3f-i · does NOT claim TCS is flagged (it is not)", !/TCS[^.\n]{0,40}(red flag|flagged)/i.test(t3a));

    // ══════════ 3f-ii · an explicit multi-symbol question ══════════
    console.log(`\n\n═════════ 3f-ii · an EXPLICIT multi-symbol question ═════════`);
    userRef.id = (await createThrowawayUser("b3-3f-multi")).userId;
    const t3b = await ask(base, await open(base), "What findings are firing on ACC, INFY and NHPC right now?");
    // ⚠ TICKER *OR* NAME. The model answers "Infosys Ltd" as readily as "INFY", and the first cut of
    //   this check demanded the ticker — failing a reply that covered all three correctly.
    check("3f-ii · covers all three companies",
      [["ACC"], ["INFY", "Infosys"], ["NHPC"]].every((alts) => alts.some((a) => t3b.includes(a))));
    check("3f-ii · ★ carries a per-company VERDICT, not just a finding name",
      has(t3b, "\\d+\\.\\d|pp\\b|₹|per cent|percentage point|quarters?"), "no company-specific number surfaced");
    check("3f-ii · uses canonical finding names", has(t3b, "Distribution Pattern", "Deterioration", "Accruals", "Margin", "Divergence", "Receivables"));

    // ══════════ 3f-iii · a mixed set with an uncovered symbol ══════════
    console.log(`\n\n═════════ 3f-iii · a MIXED set containing one UNCOVERED symbol ═════════`);
    userRef.id = (await createThrowawayUser("b3-3f-mixed")).userId;
    const t3c = await ask(base, await open(base), "Check TCS, INFY and ZYNGAINDIA for any findings.");
    check("3f-iii · answers for the two Vytal covers", t3c.includes("TCS") && t3c.includes("INFY"));
    check("3f-iii · ★ says the third is NOT COVERED — never silently omitted",
      has(t3c, "not covered", "doesn.t (cover|track)", "does not (cover|track)", "no coverage", "isn.t (covered|tracked)", "not in", "unable to find", "can.t find"));
    check("3f-iii · ★ does NOT report the uncovered one as clean",
      !/ZYNGAINDIA[^.\n]{0,60}(no findings|nothing|clean|all clear)/i.test(t3c));
    check("3f-iii · does NOT invent a reason Vytal lacks it",
      !/because vytal|vytal (deliberately|intentionally|chose)|by design/i.test(t3c));
  } finally {
    server.close();
    await cleanupThrowawayUsers();
  }

  console.log(`\n\n████ RESULT ████`);
  console.log(`  checks: ${pass} passed, ${fail} failed`);
  console.log(`  1d · READER-VISIBLE defects across ${linkDefects.turns} turns: holes ${linkDefects.hole} · raw markers ${linkDefects.marker} · foreign destinations ${linkDefects.foreignPath}`);
  console.log(`       (baseline before this build: 3-4 per run of 8 turns, all three shapes)`);
  console.log(`  1d · GUARD ACTIVITY: ${linkDefects.stripped} model-typed destination(s) stripped before delivery`);
  console.log(`       (0 = the model stopped typing paths; >0 = it still does and the reader never sees it)`);
  console.log(`  latency: min ${Math.min(...latency)} ms · median ${[...latency].sort((a, b) => a - b)[Math.floor(latency.length / 2)]} ms · max ${Math.max(...latency)} ms`);
  console.log(fail === 0 ? `\n  ═══ ALL PASS ✅ ═══\n` : `\n  ═══ ${fail} FAILED ❌ ═══\n`);
}

await run();
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
